import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parse } from "dotenv";
import { NextRequest } from "next/server";

async function main() {
  Object.assign(process.env, parse(readFileSync(".env.absent.local")), { KISSA_TRACE_DB: "0" });
  assert.equal(new URL(process.env.DATABASE_URL!).searchParams.get("schema"), "kissa_absent_orders_preview");
  const testUrl = new URL(process.env.DATABASE_URL!);
  testUrl.searchParams.set("connect_timeout", "15"); testUrl.searchParams.set("socket_timeout", "20");
  process.env.DATABASE_URL = testUrl.href;
  const { prisma } = await import("../lib/db");
  const { createSession } = await import("../lib/server/auth");
  const { hashSecret } = await import("../lib/crypto");
  const absent = await import("../app/api/counter/absent/route");
  const targets = await import("../app/api/counter/targets/route");
  const calls = await import("../app/api/counter/call/route");
  const display = await import("../app/api/order-display/route");
  const kitchen = await import("../app/api/kitchen/queue/route");
  const serveItem = await import("../app/api/counter/serve-item/route");
  const serveOrder = await import("../app/api/counter/serve-order/route");
  const undo = await import("../app/api/undo/route");
  const prefix = `absent-test-${randomUUID().slice(0,8)}`;
  const actorIds = ["WAITER", "KITCHEN", "ORDER_DISPLAY", "POS"].map(type => `${prefix}-${type}`);
  const tokens: Record<string,string> = {};
  const orderIds: string[] = [], menuIds: string[] = [];
  let categoryId: string | undefined;
  const req = (path: string, role?: string, body?: unknown) => new NextRequest(`http://localhost:3118${path}`, {
    ...(body ? { method:"POST", body: JSON.stringify(body) } : {}),
    headers: { Origin:"http://localhost:3118", "Content-Type":"application/json", ...(role ? { Cookie:`kissa_session=${tokens[role]}` } : {}) },
  });
  const data = async (response: Response) => { const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body.data; };
  try {
    for (const [index, actorType] of (["WAITER","KITCHEN","ORDER_DISPLAY","POS"] as const).entries()) {
      const id=actorIds[index];await prisma.actor.create({data:{id,actorType,label:prefix,secretHash:await hashSecret(randomUUID())}});
      tokens[actorType]=(await createSession({id,actorType})).token;
    }
    console.log("Isolated API test sessions created.");
    categoryId=(await prisma.menuCategory.create({data:{name:prefix}})).id;
    for (const name of ["A","B"]) {
      const menu=await prisma.menu.create({data:{name:`${prefix}-${name}`,priceJpy:100,workloadSeconds:10,categoryId}});menuIds.push(menu.id);
      await prisma.menuKitchenAssignment.create({data:{menuId:menu.id,kitchenId:actorIds[1]}});
      await prisma.menuStock.create({data:{menuId:menu.id,readyCount:name==="A"?1:0}});
    }
    const makeOrder = async (statuses: Array<"QUEUED"|"SERVED">, menus: number[]) => {
      const order=await prisma.order.create({data:{createdByActorId:actorIds[3],confirmedAt:new Date(),fulfillmentType:"DINE_IN",partySize:1,ageRangesJson:[],paymentMethod:"CASH",paymentStatus:"PAID",events:[],orderStatus:"PREPARING",totalPriceJpy:statuses.length*100,
        items:{create:statuses.map((status,index)=>({menuId:menuIds[menus[index]],itemNameSnapshot:`${prefix}-${menus[index]}`,unitPriceJpy:100,workloadSecondsSnapshot:10,kitchenId:actorIds[1],status,...(status==="SERVED"?{servedAt:new Date(),servedByActorId:actorIds[0]}:{})}))}}});orderIds.push(order.id);return order;
    };
    const ghost=await makeOrder(["QUEUED","QUEUED","SERVED"],[0,1,0]);
    const active=await makeOrder(["QUEUED"],[0]);
    const notReady=await makeOrder(["QUEUED"],[1]);
    const absentBody={orderId:ghost.id,confirm:true,idempotencyKey:randomUUID()};
    assert.equal((await absent.POST(req("/api/counter/absent",undefined,absentBody))).status,401);
    assert.equal((await absent.POST(req("/api/counter/absent","POS",absentBody))).status,403);
    assert.equal((await absent.POST(req("/api/counter/absent","WAITER",{...absentBody,orderId:notReady.id}))).status,409);
    await data(await calls.POST(req("/api/counter/call","WAITER",{orderId:ghost.id,confirm:true,action:"call",idempotencyKey:randomUUID()})));
    const cursor=(await data(await display.GET(req("/api/order-display","ORDER_DISPLAY")))).callCursor;
    const before=await data(await targets.GET(req("/api/counter/targets","WAITER")));
    console.log("Fixture readiness and initial call checked.");
    assert(before.orders.find((order:any)=>order.id===ghost.id));
    await data(await absent.POST(req("/api/counter/absent","WAITER",absentBody)));
    await data(await absent.POST(req("/api/counter/absent","WAITER",absentBody)));
    assert.equal(await prisma.auditLog.count({where:{orderId:ghost.id,actionType:"ORDER_GHOSTED"}}),1);
    let stored=await prisma.order.findUniqueOrThrow({where:{id:ghost.id},include:{items:true}});
    assert(stored.ghostedAt);assert.equal(stored.lastCalledAt,null);assert.equal(stored.paymentStatus,"PAID");assert.equal(stored.totalPriceJpy,300);
    assert.equal(stored.items.filter(item=>item.status==="GHOSTED").length,2);assert.equal(stored.items.filter(item=>item.status==="SERVED").length,1);
    let counter=await data(await targets.GET(req("/api/counter/targets","WAITER")));
    assert(!counter.orders.some((order:any)=>order.id===ghost.id));assert(counter.orders.some((order:any)=>order.id===active.id));
    assert(counter.ghostOrders.some((order:any)=>order.id===ghost.id));assert.equal(counter.stock.find((row:any)=>row.menuId===menuIds[0]).waitingCount,1);
    console.log("Absent transition, idempotency and counter counts checked.");
    const rejectedCall=await calls.POST(req("/api/counter/call","WAITER",{orderId:ghost.id,action:"call",confirm:true,idempotencyKey:randomUUID()}));
    assert.equal(rejectedCall.status,409);assert.equal((await rejectedCall.json()).error.code,"ORDER_GHOSTED");
    let shown=await data(await display.GET(req(`/api/order-display?afterCallId=${cursor-1}`,"ORDER_DISPLAY")));
    assert(shown.ghostOrders.some((order:any)=>order.id===ghost.id));assert(![...shown.readyOrders,...shown.unreadyOrders,...shown.calls].some((order:any)=>order.id===ghost.id));
    await prisma.menuStock.updateMany({where:{menuId:{in:menuIds}},data:{readyCount:0}});
    counter=await data(await targets.GET(req("/api/counter/targets","WAITER")));
    assert.equal(counter.ghostOrders.find((order:any)=>order.id===ghost.id).readyItems.length,0);
    let queued=await data(await kitchen.GET(req("/api/kitchen/queue","KITCHEN")));
    assert.equal(queued.menus.find((menu:any)=>menu.menuId===menuIds[0]).queuedCount,1);
    assert.equal(queued.menus.find((menu:any)=>menu.menuId===menuIds[1]).queuedCount,1);
    assert(!queued.menus.flatMap((menu:any)=>menu.queuedOrders).some((order:any)=>order.orderNo===ghost.orderNo));
    const ghostItem=stored.items.find(item=>item.status==="GHOSTED"&&item.menuId===menuIds[1])!;
    assert.equal((await serveItem.POST(req("/api/counter/serve-item","WAITER",{orderItemId:ghostItem.id,confirmUncalled:true}))).status,409);
    await prisma.menuStock.update({where:{menuId:menuIds[1]},data:{readyCount:1}});
    await data(await serveItem.POST(req("/api/counter/serve-item","WAITER",{orderItemId:ghostItem.id,confirmUncalled:true})));
    await data(await undo.POST(req("/api/undo","WAITER",{confirm:true})));
    assert.equal((await prisma.orderItem.findUniqueOrThrow({where:{id:ghostItem.id}})).status,"GHOSTED");
    await prisma.menuStock.update({where:{menuId:menuIds[0]},data:{readyCount:1}});
    counter=await data(await targets.GET(req("/api/counter/targets","WAITER")));
    const plan=counter.ghostOrders.find((order:any)=>order.id===ghost.id);
    await data(await serveOrder.POST(req("/api/counter/serve-order","WAITER",{orderId:ghost.id,idempotencyKey:randomUUID(),expectedItemIds:plan.readyItems.map((item:any)=>item.id),expectedPlan:plan.servingPlan.map(({menuId,waitingCount,servableCount}:any)=>({menuId,waitingCount,servableCount})),confirmUncalled:true})));
    assert.equal((await prisma.order.findUniqueOrThrow({where:{id:ghost.id}})).orderStatus,"COMPLETED");
    shown=await data(await display.GET(req("/api/order-display","ORDER_DISPLAY")));assert(!shown.ghostOrders.some((order:any)=>order.id===ghost.id));
    await data(await undo.POST(req("/api/undo","WAITER",{confirm:true})));
    stored=await prisma.order.findUniqueOrThrow({where:{id:ghost.id},include:{items:true}});
    assert.equal(stored.orderStatus,"PREPARING");assert.equal(stored.items.filter(item=>item.status==="GHOSTED").length,2);assert.equal(stored.items.filter(item=>item.status==="QUEUED").length,0);
    console.log("Absent order integration passed: auth, partial readiness, audited/idempotent marking, active/absent lists, kitchen demand after stock loss, customer display/call filtering, single/bulk serving and ghost-preserving undo. Production schema was not used.");
  } finally {
    await prisma.auditLog.deleteMany({where:{actorId:{in:actorIds}}});
    await prisma.order.deleteMany({where:{id:{in:orderIds}}});
    await prisma.menu.deleteMany({where:{id:{in:menuIds}}});
    if(categoryId)await prisma.menuCategory.delete({where:{id:categoryId}});
    await prisma.actor.deleteMany({where:{id:{in:actorIds}}});
    await prisma.$disconnect();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
