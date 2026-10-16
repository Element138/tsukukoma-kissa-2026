import test from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { reconcileSquarePayment, recordSquareTransaction } from "../lib/domain/square-payments";
import { runPaymentWatchdog } from "../lib/domain/payment-watchdog";

function fixture() {
  const order: any = { id: "order1", orderNo: 7, createdByActorId: "pos1", createdAt: new Date(Date.now()-60_000),
    paymentMethod: "SQUARE", paymentStatus: "AWAITING", orderStatus: "PENDING", totalPriceJpy: 420,
    confirmedAt: null, canceledAt: null, fulfillmentType: "DINE_IN", events: [], lastMutationVersion: 0,
    paymentAwaitDeadlineAt: new Date(Date.now()-1), items: [{ id: "item1", status: "QUEUED", kitchenId: "kitchen1" }] };
  const attempt: any = { id: "attempt1", orderId: order.id, transactionId: "transaction1", locationId: "location1",
    launchedAt: new Date(Date.now()-10_000), verifyAttempts: 0, verifyAfter: null, resolvedAt: null, lastError: null };
  const incidents: any[] = [], audits: any[] = [], broadcasts: any[] = [];
  let reads=0, mismatch=false, fail=false;
  const apiFetch = async (input: string | URL | Request) => {
    reads++;
    if (fail) throw new Error("network");
    const url=String(input);
    return Response.json(url.includes("/orders/") ? { order: {
      id: "transaction1", location_id: "location1", state: "COMPLETED", total_money: { amount: 420, currency: "JPY" },
      tenders: [{ payment_id: "payment1" }],
    } } : { payment: { id: "payment1", order_id: "transaction1", location_id: "location1", status: "COMPLETED", source_type: "CARD",
      amount_money: { amount: mismatch ? 421 : 420, currency: "JPY" }, total_money: { amount: 420, currency: "JPY" },
      created_at: new Date().toISOString(), note: "[KISSa:order1]" } });
  };
  const apply = (target: any, data: any) => { for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && "increment" in value) target[key] += (value as any).increment;
    else target[key]=value;
  } };
  let tail = Promise.resolve();
  const db: any = {
    $queryRaw: async () => [{ acquired: true }],
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      let release!: () => void; const previous=tail; tail=new Promise(resolve => {release=resolve;});
      await previous; try {return await fn(db);} finally {release();}
    },
    squarePaymentAttempt: {
      findUnique: async () => ({ ...attempt, order: { ...order } }),
      findUniqueOrThrow: async () => ({ ...attempt, order: { ...order } }),
      update: async ({ data }: any) => { apply(attempt,data); return attempt; },
      updateMany: async ({ where, data }: any) => { if (where.resolvedAt === null && attempt.resolvedAt) return {count:0}; apply(attempt,data); return {count:1}; },
    },
    order: {
      findUnique: async () => ({ ...order }), findUniqueOrThrow: async () => ({ ...order }), findFirst: async () => null,
      findMany: async () => order.paymentStatus === "AWAITING" && order.paymentAwaitDeadlineAt ? [order] : [],
      update: async ({ data }: any) => {apply(order,data);return {...order};},
      updateMany: async ({ where, data }: any) => {if(order.paymentStatus !== where.paymentStatus) return {count:0};apply(order,data);return {count:1};},
    },
    orderItem: {findMany: async () => []},
    auditLog: { findFirst: async () => null, create: async ({ data }: any) => {audits.push(data);return data;} },
    paymentIncident: {
      findFirst: async ({where}: any) => incidents.find(i=>i.orderId===where.orderId && i.incidentType===where.incidentType && !i.dismissedAt) ?? null,
      create: async ({data}: any) => { const i={id:String(incidents.length),...data};incidents.push(i);return i; },
      updateMany: async () => ({count:0}),
    },
    realtimeEvent: {createMany: async ({data}: any) => {broadcasts.push(...data);return {count:data.length};}},
  };
  return {db: db as PrismaClient,order,attempt,incidents,audits,broadcasts,apiFetch,
    get reads(){return reads;},set mismatch(v:boolean){mismatch=v;},set fail(v:boolean){fail=v;}};
}
async function usingApi<T>(f: ReturnType<typeof fixture>, fn: () => Promise<T>) {
  const saved=global.fetch, token=process.env.SQUARE_ACCESS_TOKEN;
  global.fetch=f.apiFetch as typeof fetch;process.env.SQUARE_ACCESS_TOKEN="private-test";
  try{return await fn();}finally{global.fetch=saved;if(token===undefined)delete process.env.SQUARE_ACCESS_TOKEN;else process.env.SQUARE_ACCESS_TOKEN=token;}
}
test("a matching server payment confirms once; replay makes no more Square reads", async () => {
  const f=fixture();await usingApi(f,async()=>{
    assert.equal((await reconcileSquarePayment(f.db,"order1")).verified,true);
    assert.equal(f.order.paymentStatus,"PAID");assert.ok(f.order.confirmedAt);assert.equal(f.reads,2);
    await reconcileSquarePayment(f.db,"order1");assert.equal(f.reads,2);
    assert.equal(f.audits.filter(a=>a.actionType==="SQUARE_SERVER_VERIFIED").length,1);
  });
});
test("simultaneous callback and notification share a verification lease", async () => {
  const f=fixture();await usingApi(f,async()=>{
    await Promise.all([reconcileSquarePayment(f.db,"order1"),reconcileSquarePayment(f.db,"order1")]);
    assert.equal(f.reads,2);assert.equal(f.attempt.verifyAttempts,1);assert.equal(f.order.paymentStatus,"PAID");
  });
});
test("mismatched amount never confirms or notifies the kitchen", async () => {
  const f=fixture();f.mismatch=true;await usingApi(f,async()=>{
    assert.equal((await reconcileSquarePayment(f.db,"order1")).verified,false);
    assert.equal(f.order.paymentStatus,"AWAITING");assert.equal(f.order.confirmedAt,null);assert.equal(f.broadcasts.length,0);
  });
});
test("network failure holds the order; automatic attempts are bounded and cooled down", async () => {
  const f=fixture();f.fail=true;await usingApi(f,async()=>{
    await reconcileSquarePayment(f.db,"order1");await reconcileSquarePayment(f.db,"order1");assert.equal(f.reads,1);
    for(let i=0;i<5;i++){f.attempt.verifyAfter=new Date(0);await reconcileSquarePayment(f.db,"order1");}
    assert.equal(f.reads,3);assert.equal(f.order.paymentStatus,"AWAITING");assert.equal(f.order.confirmedAt,null);
  });
});
test("late verified success after manual failure raises an incident without preparing the order", async () => {
  const f=fixture();f.order.paymentStatus="FAILED";f.order.orderStatus="FAILED";
  await usingApi(f,async()=>{
    const result=await reconcileSquarePayment(f.db,"order1");assert.equal("lateSuccess" in result && result.lateSuccess,true);
    assert.equal(f.order.paymentStatus,"FAILED");assert.equal(f.order.confirmedAt,null);
    assert.equal(f.incidents[0].incidentType,"LATE_SUCCESS_AFTER_FAILED");
  });
});
test("timeout creates one alert and retains the unresolved payment", async()=>{
  const f=fixture();await runPaymentWatchdog(f.db);await runPaymentWatchdog(f.db);
  assert.equal(f.order.paymentStatus,"AWAITING");assert.equal(f.order.orderStatus,"PENDING");
  assert.equal(f.order.paymentAwaitDeadlineAt,null);assert.equal(f.incidents.length,1);
});
test("conflicting transaction IDs are retained as an alert and cannot overwrite the first",async()=>{
  const f=fixture();assert.equal(await recordSquareTransaction(f.db,"order1","other-transaction"),false);
  assert.equal(f.attempt.transactionId,"transaction1");assert.equal(f.incidents.length,1);
});
