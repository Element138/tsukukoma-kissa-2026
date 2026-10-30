import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parse } from "dotenv";
import { NextRequest } from "next/server";

// This test refuses every schema except this disposable, isolated Preview.
async function main() {
  Object.assign(process.env, parse(readFileSync(".env.refunds.local")), { KISSA_TRACE_DB:"0" });
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.searchParams.get("schema"), "kissa_item_refunds_preview");
  url.searchParams.set("connection_limit","1");url.searchParams.set("connect_timeout","15");url.searchParams.set("socket_timeout","20");
  process.env.DATABASE_URL=url.href;
  const {prisma}=await import("../lib/db");
  const {createSession}=await import("../lib/server/auth");
  const {hashSecret}=await import("../lib/crypto");
  const refunds=await import("../app/api/orders/[orderId]/refunds/route");
  const recovery=await import("../app/api/admin/square-payments/route");
  const ping=await import("../app/api/payment-watchdog/ping/route");
  const book=await import("../app/api/order-book/route");
  const serving=await import("../app/api/counter/serve-item/route");
  const undo=await import("../app/api/undo/route");
  const {resetTodayMenuCount,releaseMenuDailyCountsForOrder}=await import("../lib/domain/menu-cap");
  const {recalcAndPersistOrderStatus}=await import("../lib/domain/orders");
  const prefix=`refund-${randomUUID().slice(0,8)}`;
  const actorIds: string[]=[],orderIds:string[]=[],menuIds:string[]=[];
  const tokens:Record<string,string>={};let categoryId:string|undefined;
  const savedFetch=global.fetch;let externalRequests=0;
  global.fetch=async()=>{externalRequests++;throw Error("External network disabled by refund integration test");};
  const req=(path:string,role?:string,body?:unknown)=>new NextRequest(`http://localhost:3118${path}`,{
    ...(body?{method:"POST",body:JSON.stringify(body)}:{}),headers:{Origin:"http://localhost:3118","Content-Type":"application/json",...(role?{Cookie:`kissa_session=${tokens[role]}`}:{})},
  });
  const ctx=(id:string)=>({params:Promise.resolve({orderId:id})});
  const data=async(res:Response)=>{const body=await res.json();assert.equal(res.status,200,JSON.stringify(body));return body.data;};
  try{
    for(const [label,actorType] of [["A","POS"],["B","POS"],["ADMIN","ADMIN"],["WAITER","WAITER"],["KITCHEN","KITCHEN"]] as const){
      const id=`${prefix}-${label}`;actorIds.push(id);
      await prisma.actor.create({data:{id,actorType,label:prefix,secretHash:await hashSecret(randomUUID())}});
      tokens[label]=(await createSession({id,actorType})).token;
    }
    categoryId=(await prisma.menuCategory.create({data:{name:prefix}})).id;
    for(const suffix of ["A","B"]){
      const menu=await prisma.menu.create({data:{name:`${prefix}-${suffix}`,priceJpy:100,workloadSeconds:10,categoryId}});menuIds.push(menu.id);
      await prisma.menuStock.create({data:{menuId:menu.id,readyCount:10}});
      await prisma.menuKitchenAssignment.create({data:{menuId:menu.id,kitchenId:actorIds[4]}});
    }
    const make=async(statuses:Array<"QUEUED"|"SERVED"|"GHOSTED">,paymentMethod:"CASH"|"SQUARE"="CASH",extra:Record<string,unknown>={})=>{
      const order=await prisma.order.create({data:{createdByActorId:actorIds[0],confirmedAt:new Date(),fulfillmentType:"DINE_IN",partySize:1,ageRangesJson:[],paymentMethod,paymentStatus:"PAID",events:[],orderStatus:"PREPARING",totalPriceJpy:statuses.length*100,...extra,
        items:{create:statuses.map((status,index)=>({menuId:menuIds[index%2],itemNameSnapshot:`${prefix}-item-${index}`,unitPriceJpy:100,workloadSecondsSnapshot:10,kitchenId:actorIds[4],status,...(status==="SERVED"?{servedAt:new Date(),servedByActorId:actorIds[3]}:{})}))}},include:{items:{orderBy:{id:"asc"}}}});
      orderIds.push(order.id);return order;
    };
    const body=(itemIds:string[])=>({itemIds,reasonText:"返金",expectedAmountJpy:itemIds.length*100,idempotencyKey:randomUUID(),cashRefundConfirmed:true});
    const send=(id:string,payload:unknown,role="A")=>refunds.POST(req(`/api/orders/${id}/refunds`,role,payload),ctx(id));
    const order=await make(["SERVED","QUEUED"]);
    const served=order.items.find(item=>item.status==="SERVED")!,queued=order.items.find(item=>item.status==="QUEUED")!;
    const day="2026-10-01";
    await prisma.menuDailyCount.createMany({data:menuIds.map(menuId=>({menuId,jstDate:day,count:1}))});
    await prisma.orderMenuCapReservation.createMany({data:menuIds.map(menuId=>({orderId:order.id,menuId,jstDate:day,quantity:1}))});
    const payload=body([served.id]);
    assert.equal((await refunds.POST(req("/api/orders/x/refunds",undefined,payload),ctx(order.id))).status,401);
    assert.equal((await send(order.id,payload,"WAITER")).status,403);
    assert.equal((await send(order.id,{...payload,cashRefundConfirmed:false})).status,400);
    assert.equal((await send(order.id,{...payload,itemIds:[served.id,served.id]})).status,400);
    assert.equal((await send(order.id,{...payload,expectedAmountJpy:101})).status,409);
    assert.equal((await send(order.id,{...payload,itemIds:[randomUUID()]})).status,409);
    assert.equal(await prisma.orderRefund.count({where:{orderId:order.id}}),0);
    const result=await data(await send(order.id,payload));
    await data(await send(order.id,payload));
    assert.equal((await send(order.id,{...payload,reasonText:"変更"})).status,409);
    assert.equal(await prisma.orderRefund.count({where:{orderId:order.id}}),1);
    assert.equal(await prisma.auditLog.count({where:{orderId:order.id,actionType:"ORDER_ITEMS_REFUNDED"}}),1);
    let stored=await prisma.order.findUniqueOrThrow({where:{id:order.id},include:{items:true}});
    assert.equal(stored.orderStatus,"PREPARING");assert.equal(stored.paymentStatus,"PAID");assert.equal(stored.totalPriceJpy,200);
    assert.equal(stored.items.find(item=>item.id===served.id)!.status,"CANCELED");assert(stored.items.find(item=>item.id===served.id)!.servedAt);
    assert.equal((await prisma.menuStock.findUniqueOrThrow({where:{menuId:served.menuId}})).readyCount,10);
    assert.equal((await prisma.menuDailyCount.findUniqueOrThrow({where:{menuId_jstDate:{menuId:served.menuId,jstDate:day}}})).count,0);
    assert.equal((await prisma.orderMenuCapReservation.findUniqueOrThrow({where:{orderId_menuId:{orderId:order.id,menuId:served.menuId}}})).releasedQuantity,1);
    const snapshot=await prisma.orderRefund.findUniqueOrThrow({where:{id:result.refund.id},include:{items:true}});
    assert.equal(snapshot.items.length,1);assert.equal(snapshot.items[0].previousStatus,"SERVED");assert(snapshot.confirmedAt);
    await data(await serving.POST(req("/api/counter/serve-item","WAITER",{orderItemId:queued.id,confirmUncalled:true})));
    assert.equal((await prisma.order.findUniqueOrThrow({where:{id:order.id}})).orderStatus,"PARTIALLY_CANCELED");
    await data(await send(order.id,body([queued.id])));
    assert.equal((await undo.POST(req("/api/undo","WAITER",{confirm:true}))).status,409);
    stored=await prisma.order.findUniqueOrThrow({where:{id:order.id},include:{items:true}});
    assert.equal(stored.orderStatus,"CANCELED");assert.equal(stored.paymentStatus,"CANCELED");assert(stored.canceledAt);
    assert.equal((await prisma.menuStock.findUniqueOrThrow({where:{menuId:queued.menuId}})).readyCount,9);
    await prisma.$transaction(tx=>releaseMenuDailyCountsForOrder(tx,order.id));
    assert.equal((await prisma.menuDailyCount.findUniqueOrThrow({where:{menuId_jstDate:{menuId:queued.menuId,jstDate:day}}})).count,0);
    console.log("Served-item refunds, partial/full status, cap release, stock, receipts snapshots and undo safety passed.");

    const square=await make(["SERVED","SERVED"],"SQUARE");
    const squarePayload=body([square.items[0].id]);
    const concurrent=await Promise.all([send(square.id,squarePayload),send(square.id,squarePayload)]);
    for(const response of concurrent)await data(response);
    assert.equal(await prisma.orderRefund.count({where:{orderId:square.id}}),1);
    assert.equal((await prisma.order.findUniqueOrThrow({where:{id:square.id}})).orderStatus,"PARTIALLY_CANCELED");
    assert.equal((await send(square.id,body([square.items[0].id]))).status,409);
    await data(await send(square.id,body([square.items[1].id]),"ADMIN"));
    assert.equal(externalRequests,0,"Cash refunds must never call Square");
    const overlap=await make(["QUEUED"]);
    const overlapResults=await Promise.all([send(overlap.id,body([overlap.items[0].id])),send(overlap.id,body([overlap.items[0].id]))]);
    assert.deepEqual(overlapResults.map(r=>r.status).sort(),[200,409]);
    const reset=await make(["GHOSTED"]);
    await prisma.orderMenuCapReservation.create({data:{orderId:reset.id,menuId:menuIds[0],jstDate:day,quantity:1}});
    await prisma.$transaction(tx=>resetTodayMenuCount(tx,menuIds[0],day));
    await prisma.menuDailyCount.update({where:{menuId_jstDate:{menuId:menuIds[0],jstDate:day}},data:{count:5}});
    await data(await send(reset.id,body([reset.items[0].id])));
    assert.equal((await prisma.menuDailyCount.findUniqueOrThrow({where:{menuId_jstDate:{menuId:menuIds[0],jstDate:day}}})).count,5);
    // Exercise several partial releases of the same menu/day reservation.
    const same=await make(["QUEUED","QUEUED","QUEUED"]);
    const sameItems=same.items.filter(item=>item.menuId===menuIds[0]);
    await prisma.orderMenuCapReservation.create({data:{orderId:same.id,menuId:menuIds[0],jstDate:day,quantity:2}});
    await Promise.all(sameItems.map(item=>send(same.id,body([item.id])))).then(async responses=>{for(const response of responses)await data(response);});
    assert.equal((await prisma.orderMenuCapReservation.findUniqueOrThrow({where:{orderId_menuId:{orderId:same.id,menuId:menuIds[0]}}})).releasedQuantity,2);
    assert.equal((await prisma.menuDailyCount.findUniqueOrThrow({where:{menuId_jstDate:{menuId:menuIds[0],jstDate:day}}})).count,3);
    await prisma.$transaction(tx=>recalcAndPersistOrderStatus(tx,same.id,false));
    console.log("Square cash refunds make no external calls; concurrent retries/overlaps, multi-stage reservations and explicit reset passed.");

    const older=await make(["SERVED"],"CASH",{createdAt:new Date("2026-01-01"),specialNote:`${prefix} MixedCase備考`});
    const found=await data(await book.GET(req(`/api/order-book?note=${encodeURIComponent(prefix+" mixedcase")}`,"A")));
    assert(found.orders.some((row:any)=>row.id===older.id));
    const net=await data(await book.GET(req(`/api/order-book?orderNo=${square.orderNo}`,"A")));
    assert.equal(net.orders[0].totalPriceJpy,0);assert.equal(net.orders[0].originalTotalPriceJpy,200);assert.equal(net.orders[0].refunds.length,2);
    const pending=await make(["QUEUED"],"SQUARE",{confirmedAt:null,paymentStatus:"AWAITING",orderStatus:"PENDING"});
    await prisma.squarePaymentAttempt.create({data:{orderId:pending.id,stateToken:randomUUID(),appId:"test",locationId:"test",callbackUrl:"http://localhost:3118/api/square/callback"}});
    await prisma.paymentIncident.create({data:{orderId:pending.id,incidentType:"SQUARE_RESULT_MISSING",messageJa:prefix}});
    const a=await data(await ping.GET(req("/api/payment-watchdog/ping","A")));
    const b=await data(await ping.GET(req(`/api/payment-watchdog/ping?trackOrderId=${pending.id}`,"B")));
    assert.equal(a.awaitingOrder.id,pending.id);assert(a.incidents.some((i:any)=>i.orderId===pending.id));
    assert.equal(b.awaitingOrder,null);assert.equal(b.trackedOrder,null);assert.equal(b.incidents.length,0);
    const bRecovery=await data(await recovery.GET(req("/api/admin/square-payments","B")));
    assert.equal(bRecovery.orders.length,0);assert.equal(bRecovery.incidentCount,0);
    const recoveryBody={orderId:pending.id,action:"NO_CHARGE",reason:"済",attested:true};
    assert.equal((await recovery.POST(req("/api/admin/square-payments","B",recoveryBody))).status,404);
    assert.equal(externalRequests,0);
    await data(await recovery.POST(req("/api/admin/square-payments","A",recoveryBody)));
    assert.equal((await prisma.order.findUniqueOrThrow({where:{id:pending.id}})).paymentStatus,"FAILED");
    assert.equal(await prisma.auditLog.count({where:{orderId:pending.id,actorId:actorIds[0],actorType:"POS",actionType:"SQUARE_POS_NO_CHARGE",reasonText:"済"}}),1);
    console.log("All-history case-insensitive notes, net totals, POS ownership/incident isolation and one-character recovery reason passed.");
  }finally{
    global.fetch=savedFetch;
    await prisma.auditLog.deleteMany({where:{actorId:{in:actorIds}}});
    await prisma.squarePaymentAttempt.deleteMany({where:{orderId:{in:orderIds}}});
    await prisma.order.deleteMany({where:{id:{in:orderIds}}});
    await prisma.menu.deleteMany({where:{id:{in:menuIds}}});
    if(categoryId)await prisma.menuCategory.delete({where:{id:categoryId}});
    await prisma.actor.deleteMany({where:{id:{in:actorIds}}});
    await prisma.$disconnect();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
