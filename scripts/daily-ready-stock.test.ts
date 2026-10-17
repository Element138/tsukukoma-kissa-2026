import test from "node:test";
import assert from "node:assert/strict";
import { resetExpiredReadyStock } from "../lib/domain/daily-ready-stock";
import { executeUndo } from "../lib/domain/undo";
import { prisma } from "../lib/db";
import { NextRequest } from "next/server";
import { GET as kitchenGET } from "../app/api/kitchen/queue/route";

function fixture(){
  const rows=[{menuId:"a",readyCount:8,stockResetAt:new Date("2026-10-17T14:00:00Z")},{menuId:"b",readyCount:2,stockResetAt:new Date("2026-10-17T15:01:00Z")}];
  const db:any={$queryRaw:async(query:any)=>{
    const [at,start,...ids]=query.values as [Date,Date,...string[]];
    for(const row of rows)if(row.stockResetAt<start && (!ids.length||ids.includes(row.menuId))){row.readyCount=0;row.stockResetAt=at;}
    return [];
  }};
  return {db,rows};
}
test("JST midnight expires previous stock, preserves new-day cooking, and is repeat-safe",async()=>{
  const f=fixture();
  await resetExpiredReadyStock(f.db,undefined,new Date("2026-10-17T14:59:59.999Z"));assert.equal(f.rows[0].readyCount,8);
  await resetExpiredReadyStock(f.db,undefined,new Date("2026-10-17T15:00:00Z"));assert.equal(f.rows[0].readyCount,0);assert.equal(f.rows[1].readyCount,2);
  f.rows[0].readyCount=3;await resetExpiredReadyStock(f.db,undefined,new Date("2026-10-17T15:05:00Z"));assert.equal(f.rows[0].readyCount,3);
  await resetExpiredReadyStock(f.db,undefined,new Date("2026-10-19T15:00:00Z"));assert.ok(f.rows.every(row=>row.readyCount===0));
});
test("scoped reset does not erase other menus or outstanding order demand",async()=>{
  const f=fixture();await resetExpiredReadyStock(f.db,["a"],new Date("2026-10-17T15:00:00Z"));assert.equal(f.rows[1].readyCount,2);
  // Kitchen's existing demand-minus-ready calculation after expiry.
  for(const awaited of [0,5]){assert.equal(Math.max(0,awaited-f.rows[0].readyCount),awaited);assert.equal(Math.max(0,f.rows[0].readyCount-awaited),0);}
  await resetExpiredReadyStock(f.db,[],new Date("2026-10-18T15:00:00Z"));assert.equal(f.rows[1].readyCount,2);
});
test("previous-day undo cannot restore expired prepared stock",async()=>{
  let stockWrites=0;
  const db:any={$queryRaw:async()=>[],undoOperation:{findFirst:async()=>({createdAt:new Date(Date.now()-2*86400000),payload:{menuId:"a"},operationType:"ITEM_SERVED"})},menuStock:{upsert:async()=>{stockWrites++;}}};
  await assert.rejects(executeUndo(db,{actorId:"w",actorType:"WAITER"}),{code:"UNDO_EXPIRED"});assert.equal(stockWrites,0);
});
test("an undo saved after midnight cannot resurrect an item served before midnight",async()=>{
  const db:any={$queryRaw:async()=>[],undoOperation:{findFirst:async()=>({createdAt:new Date(),payload:{menuId:"a",servedAt:new Date(Date.now()-86400000).toISOString()},operationType:"ITEM_SERVED"})}};
  await assert.rejects(executeUndo(db,{actorId:"w",actorType:"WAITER"}),{code:"UNDO_EXPIRED"});
});
test("kitchen endpoint clears yesterday's surplus and shows zero or actual remaining demand",async()=>{
  const db=prisma as any,restore:Array<()=>void>=[];
  const replace=(object:any,key:string,value:any)=>{const original=object[key];restore.push(()=>object[key]=original);object[key]=value;};
  const rows=[{menuId:"a",readyCount:8,stockResetAt:new Date(Date.now()-86400000)},{menuId:"b",readyCount:9,stockResetAt:new Date(Date.now()-86400000)}];
  const items=Array.from({length:3},(_,i)=>({id:`item-${i}`,menuId:"b",order:{orderNo:258,confirmedAt:new Date()}}));
  replace(db.session,"findUnique",async()=>({sessionId:"s",expiresAt:new Date(Date.now()+60000),lastActivityAt:new Date(),actor:{id:"k",actorType:"KITCHEN",isActive:true,lastSeenAt:new Date(),label:"Kitchen"}}));
  replace(db.menuKitchenAssignment,"findMany",async({where}:any)=>where.kitchenId?rows.map(row=>({menuId:row.menuId,menu:{id:row.menuId,name:row.menuId,availability:"AVAILABLE",dailyOrderCap:null}})):rows.map(row=>({menuId:row.menuId})));
  replace(db.orderItem,"findMany",async()=>items);
  replace(db.menuDailyCount,"findMany",async()=>[]);
  replace(db.menuStock,"findMany",async()=>rows);
  replace(db,"$queryRaw",async(query:any)=>{const [at,start,...ids]=query.values;for(const row of rows)if(row.stockResetAt<start&&ids.includes(row.menuId)){row.readyCount=0;row.stockResetAt=at;}return[];});
  try{
    const response=await kitchenGET(new NextRequest("http://localhost/api/kitchen/queue",{headers:{cookie:"kissa_session=test"}}));
    assert.equal(response.status,200);const {data}=await response.json();
    const a=data.menus.find((menu:any)=>menu.menuId==="a"),b=data.menus.find((menu:any)=>menu.menuId==="b");
    assert.equal(a.queuedCount,0);assert.equal(a.surplusCount,0);assert.equal(b.queuedCount,3);assert.equal(b.surplusCount,0);assert.equal(items.length,3);
  }finally{for(const fn of restore.reverse())fn();}
});
