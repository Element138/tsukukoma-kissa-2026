import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import { serveCounterOrder } from "../lib/domain/counter";
import { counterServingPlan, partialServingMessage, projectCounterItems } from "../lib/domain/counter-availability";
import { executeUndo } from "../lib/domain/undo";

function fixture(coffee=2,tea=1) {
  const state:any={
    order:{id:"order",orderNo:7,paymentStatus:"PAID",orderStatus:"PREPARING",confirmedAt:new Date(),canceledAt:null,fulfillmentType:"DINE_IN",lastCalledAt:new Date(),lastMutationVersion:0},
    items:[{id:"a1",menuId:"coffee",itemNameSnapshot:"クロックムッシュ"},{id:"a2",menuId:"coffee",itemNameSnapshot:"クロックムッシュ"},{id:"b1",menuId:"tea",itemNameSnapshot:"紅茶"}].map(item=>({...item,orderId:"order",status:"QUEUED",servedAt:null,servedByActorId:null})),
    stock:{coffee,tea},audits:[],undos:[],locks:[],
  };
  const apply=(target:any,data:any)=>{for(const[key,value]of Object.entries(data)){if(value&&typeof value==="object"&&"increment"in value)target[key]+=(value as any).increment;else Object.assign(target,{[key]:value});}};
  const matches=(item:any,where:any)=>Object.entries(where).every(([key,value])=>value instanceof Date ? item[key]?.getTime()===value.getTime() : value===undefined || item[key]===value);
  const db:any={
    $queryRaw:async(...args:any[])=>{state.locks.push(args);return[];},
    order:{findUnique:async()=>({...state.order,items:state.items.map((i:any)=>({...i}))}),update:async({data}:any)=>{apply(state.order,data);return{...state.order};}},
    orderItem:{
      findMany:async({where}:any)=>state.items.filter((i:any)=>matches(i,where)).map((i:any)=>({...i})),
      findUnique:async({where}:any)=>({...state.items.find((i:any)=>i.id===where.id)}),
      findUniqueOrThrow:async({where}:any)=>({...state.items.find((i:any)=>i.id===where.id),order:{...state.order}}),
      findFirst:async()=>state.items.filter((i:any)=>i.status==="SERVED").at(-1)??null,
      update:async({where,data}:any)=>{const item=state.items.find((i:any)=>i.id===where.id);apply(item,data);return item;},
      updateMany:async({where,data}:any)=>{const rows=state.items.filter((i:any)=>matches(i,where));rows.forEach((i:any)=>apply(i,data));return{count:rows.length};},
    },
    menuStock:{
      findMany:async()=>Object.entries(state.stock).map(([menuId,readyCount])=>({menuId,readyCount})),
      updateMany:async({where,data}:any)=>{if(state.stock[where.menuId]<(where.readyCount.gte??where.readyCount.gt+1))return{count:0};state.stock[where.menuId]-=data.readyCount.decrement;return{count:1};},
      upsert:async({where,create,update}:any)=>{state.stock[where.menuId]=(state.stock[where.menuId]??0)+update.readyCount.increment;return create;},
    },
    orderCall:{findFirst:async()=>({calledAt:state.order.lastCalledAt})},
    auditLog:{findFirst:async({where}:any)=>where?state.audits.find((a:any)=>a.actionType===where.actionType&&a.correlationId===where.correlationId)??null:state.audits.at(-1)??null,create:async({data}:any)=>{state.audits.push(data);return data;}},
    undoOperation:{create:async({data}:any)=>{state.undos.push({id:`undo-${state.undos.length}`,...data});},findMany:async()=>[],findFirst:async()=>state.undos.at(-1),delete:async()=>state.undos.pop()},
  };
  const snapshot=()=>{
    const pool=new Map<string,number>(Object.entries(state.stock) as Array<[string,number]>);
    return{actorId:"counter",orderId:"order",idempotencyKey:"same-request",expectedItemIds:projectCounterItems(state.items,pool).readyItems.map(i=>i.id),expectedPlan:counterServingPlan(state.items,pool).map(({menuId,waitingCount,servableCount})=>({menuId,waitingCount,servableCount}))};
  };
  let chain=Promise.resolve();
  const transaction=async<T>(fn:()=>Promise<T>)=>{let release!:()=>void;const previous=chain;chain=new Promise(resolve=>release=resolve);await previous;const saved=structuredClone(state);try{return await fn();}catch(e){Object.assign(state,saved);throw e;}finally{release();}};
  return{state,db:db as Prisma.TransactionClient,snapshot,transaction};
}

test("bulk serving consumes every servable item, clears the call, and creates one batch undo",async()=>{
  const f=fixture();const result=await f.transaction(()=>serveCounterOrder(f.db,f.snapshot()));
  assert.equal(result.servedItemCount,3);assert.deepEqual(f.state.stock,{coffee:0,tea:0});
  assert.equal(f.state.order.orderStatus,"COMPLETED");assert.equal(f.state.order.lastCalledAt,null);
  assert.equal(f.state.undos.length,1);assert.equal(f.state.undos[0].payload.items.length,3);
  const undone=await f.transaction(()=>executeUndo(f.db,{actorId:"counter",actorType:"WAITER"}));
  assert.equal(undone.revertedItemCount,3);assert.deepEqual(f.state.stock,{coffee:2,tea:1});
  assert.equal(f.state.order.orderStatus,"PREPARING");assert.equal(f.state.order.lastCalledAt,null);
});
test("partial stock requires an accurate per-menu confirmation and preserves remaining waiting items",async()=>{
  const f=fixture(1,1);const input=f.snapshot();
  assert.equal(partialServingMessage(counterServingPlan(f.state.items,new Map([["coffee",1],["tea",1]]))),"クロックムッシュは調理済の数が足りないため、2個のうち1個のみ提供済にします。");
  await assert.rejects(f.transaction(()=>serveCounterOrder(f.db,input)),{code:"PARTIAL_SERVE_CONFIRM_REQUIRED"});
  assert.deepEqual(f.state.stock,{coffee:1,tea:1});
  const result=await f.transaction(()=>serveCounterOrder(f.db,{...input,confirmPartial:true}));
  assert.equal(result.servedItemCount,2);assert.equal(result.partial,true);
  assert.equal(f.state.items.filter((i:any)=>i.status==="QUEUED").length,1);assert.ok(f.state.order.lastCalledAt);
});
test("a stock change after confirmation cannot silently serve a different quantity",async()=>{
  const f=fixture();const input=f.snapshot();f.state.stock.coffee=1;
  await assert.rejects(f.transaction(()=>serveCounterOrder(f.db,input)),{code:"STOCK_CHANGED"});
  assert.equal(f.state.items.every((i:any)=>i.status==="QUEUED"),true);assert.equal(f.state.stock.coffee,1);
});
test("a retried or concurrent successful request never consumes stock twice",async()=>{
  const f=fixture();const input=f.snapshot();
  const results=await Promise.all([f.transaction(()=>serveCounterOrder(f.db,input)),f.transaction(()=>serveCounterOrder(f.db,input))]);
  assert.equal("alreadyProcessed"in results[1]&&results[1].alreadyProcessed,true);assert.equal(f.state.undos.length,1);
  assert.deepEqual(f.state.stock,{coffee:0,tea:0});
});
test("batch undo refuses an intervening order change and rolls back item restores",async()=>{
  const f=fixture();await f.transaction(()=>serveCounterOrder(f.db,f.snapshot()));f.state.order.lastMutationVersion++;
  await assert.rejects(f.transaction(()=>executeUndo(f.db,{actorId:"counter",actorType:"WAITER"})),{code:"UNDO_CONFLICT"});
  assert.equal(f.state.items.every((i:any)=>i.status==="SERVED"),true);assert.deepEqual(f.state.stock,{coffee:0,tea:0});
});
test("an uncalled bulk operation needs confirmation and cannot partially mutate before rejection",async()=>{
  const f=fixture();f.state.order.lastCalledAt=null;
  await assert.rejects(f.transaction(()=>serveCounterOrder(f.db,f.snapshot())),{code:"SERVE_CONFIRM_REQUIRED"});
  assert.deepEqual(f.state.stock,{coffee:2,tea:1});
  assert.equal(f.state.items.every((i:any)=>i.status==="QUEUED"),true);
});
