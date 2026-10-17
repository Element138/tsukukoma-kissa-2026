import test from "node:test";
import assert from "node:assert/strict";
import { correctOrder } from "../lib/domain/order-corrections";
import { markOrderSpecialNote } from "../lib/domain/orders";
import { NextRequest } from "next/server";
import { prisma } from "../lib/db";
import { GET as salesGET } from "../app/api/sales/route";
import { PATCH as inspectionPATCH } from "../app/api/sales/orders/[orderId]/route";
import { PATCH as adminPATCH } from "../app/api/admin/order-corrections/route";

const admin={actorId:"admin",actorType:"ADMIN" as const};
const input={orderId:"o",expectedVersion:4,specialNote:"existing note",excludeFromWaitStats:false,manualClose:true};
function fixture() {
  const originalServedAt=new Date("2026-10-17T01:00:00Z");
  const order:any={id:"o",orderNo:1,orderStatus:"PREPARING",paymentStatus:"PAID",confirmedAt:new Date(),canceledAt:null,lastCalledAt:new Date(),lastMutationVersion:4,specialNote:"existing note",excludeFromWaitStats:false,events:[],items:[{id:"old",menuId:"m",status:"SERVED",servedAt:originalServedAt},{id:"new1",menuId:"m",status:"QUEUED",servedAt:null},{id:"new2",menuId:"m",status:"QUEUED",servedAt:null}]};
  const stock={menuId:"m",readyCount:1};const audits:any[]=[];let writes=0;
  const db:any={
    $queryRaw:async()=>[],
    orderItem:{findMany:async()=>order.items,updateMany:async({where,data}:any)=>{writes++;for(const item of order.items)if(where.id.in.includes(item.id))Object.assign(item,data);return{count:2};}},
    order:{findUnique:async()=>structuredClone(order),update:async({data}:any)=>{writes++;const {lastMutationVersion,...rest}=data;Object.assign(order,rest);if(lastMutationVersion)order.lastMutationVersion+=lastMutationVersion.increment;return structuredClone(order);}},
    menuStock:{findUnique:async()=>({...stock}),update:async({data}:any)=>{writes++;Object.assign(stock,data);return stock;}},
    auditLog:{findFirst:async()=>null,create:async({data}:any)=>{audits.push(data);return data;}},
  };
  return {db,order,stock,audits,originalServedAt,get writes(){return writes;}};
}
test("manual closure serves only remaining items, clears call, preserves payments, consumes available stock without negatives, and audits",async()=>{
  const f=fixture();await correctOrder(f.db,admin,input);
  assert.equal(f.order.orderStatus,"COMPLETED");assert.equal(f.order.paymentStatus,"PAID");assert.equal(f.order.lastCalledAt,null);
  assert.ok(f.order.items.every((i:any)=>i.status==="SERVED"));assert.equal(f.order.items[0].servedAt.getTime(),f.originalServedAt.getTime());
  assert.equal(f.stock.readyCount,0);assert.equal(f.order.specialNote,"existing note\nmanual closure");assert.equal(f.audits[0].actionType,"MANUAL_CLOSURE");
  assert.equal(f.order.lastMutationVersion,5);assert.equal(f.order.events[0].type,"MANUAL_CLOSURE");
});
test("manual closure cannot be invoked by POS or waiter; waiter cannot alter statistics",async()=>{
  for(const actorType of ["POS","WAITER"] as const){const f=fixture();await assert.rejects(correctOrder(f.db,{actorId:"a",actorType},input),{code:"FORBIDDEN"});assert.equal(f.writes,0);}
  const f=fixture();await assert.rejects(correctOrder(f.db,{actorId:"a",actorType:"WAITER"},{...input,manualClose:false}),{code:"FORBIDDEN"});
});
test("stale versions and unresolved/failed/completed orders cannot be manually closed",async()=>{
  const stale=fixture();await assert.rejects(correctOrder(stale.db,admin,{...input,expectedVersion:3}),{code:"ORDER_CHANGED"});assert.equal(stale.writes,0);
  for(const patch of [{paymentStatus:"AWAITING",confirmedAt:null},{paymentStatus:"FAILED"},{orderStatus:"COMPLETED"},{canceledAt:new Date()}]){
    const f=fixture();Object.assign(f.order,patch);await assert.rejects(correctOrder(f.db,admin,input),{code:"ORDER_LOCKED"});assert.equal(f.writes,0);
  }
});
test("completed order note/exclusion remain editable; existing manual closure note isn't duplicated",async()=>{
  const f=fixture();f.order.orderStatus="COMPLETED";
  await correctOrder(f.db,admin,{...input,manualClose:false,specialNote:"amended",excludeFromWaitStats:true});
  assert.equal(f.order.specialNote,"amended");assert.equal(f.order.excludeFromWaitStats,true);assert.equal(f.stock.readyCount,1);
  const g=fixture();await correctOrder(g.db,admin,{...input,specialNote:"manual closure"});assert.equal(g.order.specialNote,"manual closure");
});
test("order-book note editing accepts completed and failed orders",async()=>{
  for(const status of ["COMPLETED","FAILED"]){const f=fixture();f.order.orderStatus=status;await markOrderSpecialNote(f.db,{...admin,orderId:"o",specialNote:"later note"});assert.equal(f.order.specialNote,"later note");assert.equal(f.order.orderStatus,status);}
});
test("sales exclusion removes all order/menu wait samples while retaining revenue; hours checkbox controls range",async()=>{
  const db=prisma as any;
  const originals={session:db.session.findUnique,orders:db.order.findMany,incidents:db.paymentIncident.findMany};
  const at=new Date("2026-10-16T23:00:00Z"); // 08:00 JST, outside business hours.
  let excluded=false;
  db.session.findUnique=async()=>({sessionId:"s",expiresAt:new Date(Date.now()+60000),lastActivityAt:new Date(),actor:{id:"a",actorType:"ADMIN",isActive:true,lastSeenAt:new Date(),label:"Admin"}});
  db.order.findMany=async()=>[{id:"o",orderNo:1,createdAt:at,confirmedAt:at,paymentStatus:"PAID",paymentMethod:"CASH",orderStatus:"COMPLETED",totalPriceJpy:500,events:[],excludeFromWaitStats:excluded,items:[{id:"i",menuId:"m",itemNameSnapshot:"Coffee",unitPriceJpy:500,status:"SERVED",servedAt:new Date(at.getTime()+600000),readyAt:null}]}];
  db.paymentIncident.findMany=async()=>[];
  const req=(tail="")=>new NextRequest(`http://localhost/api/sales?date=2026-10-17${tail}`,{headers:{cookie:"kissa_session=test"}});
  try {
    const included=await(await salesGET(req())).json();assert.equal(included.ok,true);assert.equal(included.data.wait.points.length,3);
    assert.ok(new Date(included.data.chartRange.chartStart)<new Date(included.data.chartRange.chartEnd));assert.equal(new Date(included.data.chartRange.chartStart).getUTCHours(),0);
    excluded=true;const filtered=await(await salesGET(req("&businessHoursOnly=false"))).json();
    assert.equal(filtered.data.wait.points.length,0);assert.equal(filtered.data.totals.salesJpy,500);assert.equal(filtered.data.totals.orderCount,1);assert.equal(filtered.data.menus[0].count,1);
    assert.equal(filtered.data.chartRange.chartStart,"2026-10-16T15:00:00.000Z");assert.equal(filtered.data.chartRange.chartEnd,"2026-10-17T15:00:00.000Z");
    assert.ok(filtered.data.wait.summaries.every((row:any)=>row.sampleSize===0));
    // The inspection API rejects attempts to smuggle in manualClose.
    const bad=new NextRequest("http://localhost/api/sales/orders/o",{method:"PATCH",headers:{cookie:"kissa_session=test","content-type":"application/json"},body:JSON.stringify(input)});
    assert.equal((await inspectionPATCH(bad,{params:Promise.resolve({orderId:"o"})})).status,400);
    db.session.findUnique=async()=>({sessionId:"s",expiresAt:new Date(Date.now()+60000),lastActivityAt:new Date(),actor:{id:"a",actorType:"POS",isActive:true,lastSeenAt:new Date(),label:"POS"}});
    assert.equal((await adminPATCH(bad)).status,403);
  }finally{db.session.findUnique=originals.session;db.order.findMany=originals.orders;db.paymentIncident.findMany=originals.incidents;}
});
