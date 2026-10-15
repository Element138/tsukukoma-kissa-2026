import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import { markKitchenMenuItemsReady } from "../lib/domain/kitchen";
import { serveDineInItem } from "../lib/domain/counter";
import { executeUndo } from "../lib/domain/undo";
import { deriveOrderStatus } from "../lib/domain/order-status";
import { projectCounterItems } from "../lib/domain/counter-availability";
import { updateOrderCall } from "../lib/domain/order-calls";

// A stateful database double exercises domain writes without touching service data.
function fixture() {
  const state = {
    ready: 0, cooked: 0, cap: null as number | null, assigned: true,
    lastServedAt: null as Date | null,
    order: { id: "order", orderNo: 10, confirmedAt: new Date(), canceledAt: null, paymentStatus: "PAID", fulfillmentType: "DINE_IN", orderStatus: "PREPARING", lastCalledAt: null as Date | null, lastMutationVersion: 0 },
    item: { id: "item", menuId: "menu", orderId: "order", itemNameSnapshot: "コーヒー", status: "QUEUED", servedAt: null as Date | null, servedByActorId: null as string | null },
    audits: [] as any[], undos: [] as any[], locks: [] as unknown[], calls: [] as Array<{ id: number; calledAt: Date }>,
  };
  const db = {
    $queryRaw: async (...args: unknown[]) => { state.locks.push(args); return []; },
    menuKitchenAssignment: { findUnique: async () => state.assigned ? { enabled: true } : null },
    menu: { findUniqueOrThrow: async () => ({ dailyOrderCap: state.cap }) },
    menuDailyCount: {
      findUnique: async () => ({ cookedCount: state.cooked }),
      upsert: async ({ update }: any) => { state.cooked += update.cookedCount.increment; },
      update: async ({ data }: any) => { state.cooked -= data.cookedCount.decrement; },
    },
    menuStock: {
      upsert: async ({ update }: any) => { state.ready += update.readyCount.increment; },
      updateMany: async ({ where, data }: any) => {
        if (state.ready < (where.readyCount.gte ?? where.readyCount.gt + 1)) return { count: 0 };
        state.ready -= data.readyCount.decrement;
        return { count: 1 };
      },
    },
    orderItem: {
      findUnique: async () => ({ ...state.item }),
      findUniqueOrThrow: async () => ({ ...state.item, order: { ...state.order } }),
      findFirst: async () => state.lastServedAt ? { servedAt: state.lastServedAt } : null,
      update: async ({ data }: any) => { Object.assign(state.item, data); return state.item; },
      updateMany: async ({ where, data }: any) => {
        if (state.item.status !== where.status || state.item.servedByActorId !== where.servedByActorId || (where.servedAt && state.item.servedAt?.getTime() !== where.servedAt.getTime())) return { count: 0 };
        Object.assign(state.item, data); return { count: 1 };
      },
    },
    order: {
      findUnique: async () => ({ ...state.order, items: [state.item] }),
      update: async ({ data }: any) => {
        if ("orderStatus" in data) state.order.orderStatus = data.orderStatus;
        if ("lastCalledAt" in data) state.order.lastCalledAt = data.lastCalledAt;
        if (data.lastMutationVersion) state.order.lastMutationVersion++;
        return { ...state.order };
      },
    },
    orderCall: {
      findFirst: async () => state.calls.at(-1) ?? null,
      create: async () => {
        const call = { id: state.calls.length + 1, calledAt: new Date() };
        state.calls.push(call); return call;
      },
    },
    auditLog: {
      findFirst: async ({ where }: any) => where ? state.audits.find(a => a.correlationId === where.correlationId) ?? null : null,
      create: async ({ data }: any) => { state.audits.push(data); },
    },
    undoOperation: {
      create: async ({ data }: any) => { state.undos.push({ id: String(state.undos.length), ...data }); },
      findMany: async () => [],
      findFirst: async () => state.undos.at(-1) ?? null,
      delete: async () => { state.undos.pop(); },
    },
  } as unknown as Prisma.TransactionClient;
  const cook = (quantity: number, confirmOverCap = false, key = "request-1") => markKitchenMenuItemsReady(db, { actorId: "kitchen", kitchenId: "kitchen", menuId: "menu", quantity, idempotencyKey: key, confirmOverCap });
  const serve = (confirmUncalled = false) => serveDineInItem(db, { actorId: "counter", orderItemId: "item", confirmUncalled });
  return { state, db, cook, serve };
}

test("production may exceed demand and never reserves an order item", async () => {
  const { state, cook } = fixture();
  await cook(20);
  assert.equal(state.ready, 20); assert.equal(state.cooked, 20);
  assert.equal(state.item.status, "QUEUED"); assert.equal(state.order.lastCalledAt, null);
});
test("production works with no outstanding orders", async () => {
  const { state, cook } = fixture(); state.item.status = "SERVED"; state.order.orderStatus = "COMPLETED";
  await cook(5); assert.equal(state.ready, 5);
});
test("crossing the cap requires approval, including from exactly the cap", async () => {
  const { state, cook } = fixture(); state.cap = 10; state.cooked = 10;
  await assert.rejects(cook(1), { code: "COOKED_CAP_CONFIRM_REQUIRED" });
  assert.equal(state.ready, 0);
  await cook(1, true); assert.equal(state.cooked, 11);
  await cook(2, false, "request-2"); assert.equal(state.cooked, 13);
});
test("replayed production requests do not create more inventory", async () => {
  const { state, cook } = fixture(); await cook(5); await cook(5); assert.equal(state.ready, 5);
});
test("kitchens cannot produce an unassigned menu", async () => {
  const { state, cook } = fixture(); state.assigned = false;
  await assert.rejects(cook(1), { code: "FORBIDDEN" }); assert.equal(state.ready, 0);
});
test("uncalled service needs approval, then consumes exactly one unit", async () => {
  const { state, serve } = fixture(); state.ready = 3;
  await assert.rejects(serve(), { code: "SERVE_CONFIRM_REQUIRED" }); assert.equal(state.ready, 3);
  await serve(true); assert.equal(state.ready, 2); assert.equal(state.item.status, "SERVED"); assert.equal(state.order.orderStatus, "COMPLETED");
  await assert.rejects(serve(true), { code: "ITEM_CONFLICT" }); assert.equal(state.ready, 2);
});
test("recent call allows service, old call uses floored elapsed minutes", async () => {
  const { state, serve } = fixture(); state.ready = 1;
  state.order.lastCalledAt = new Date(Date.now() - 239000);
  await assert.rejects(serve(), e => (e as Error).message.includes("3分"));
  state.order.lastCalledAt = new Date(Date.now() - 179000);
  await serve(); assert.equal(state.ready, 0);
});
test("a service within 30 seconds suppresses the uncalled warning", async () => {
  const { state, serve } = fixture(); state.ready = 1; state.lastServedAt = new Date(Date.now() - 29000);
  await serve(); assert.equal(state.ready, 0);
});
test("after 30 seconds an uncalled order requires confirmation again", async () => {
  const { state, serve } = fixture(); state.ready = 1; state.lastServedAt = new Date(Date.now() - 31000);
  await assert.rejects(serve(), { code: "SERVE_CONFIRM_REQUIRED" });
});
test("takeout items can be served individually; empty inventory is rejected", async () => {
  const { state, serve } = fixture(); state.order.fulfillmentType = "TAKEOUT"; state.order.lastCalledAt = new Date();
  await assert.rejects(serve(), { code: "STOCK_EMPTY" });
  state.ready = 1; await serve(); assert.equal(state.item.status, "SERVED");
});
test("undoing production restores daily totals and protects consumed inventory", async () => {
  const { state, db, cook } = fixture(); await cook(4);
  state.ready = 3;
  await assert.rejects(executeUndo(db, { actorId: "kitchen", actorType: "KITCHEN" }), { code: "UNDO_CONFLICT" });
  state.ready = 4;
  await executeUndo(db, { actorId: "kitchen", actorType: "KITCHEN" });
  assert.equal(state.ready, 0); assert.equal(state.cooked, 0);
});
test("undoing service returns stock and reopens a completed order", async () => {
  const { state, db, serve } = fixture(); state.ready = 1;
  await serve(true); await executeUndo(db, { actorId: "counter", actorType: "WAITER" });
  assert.equal(state.ready, 1); assert.equal(state.item.status, "QUEUED"); assert.equal(state.order.orderStatus, "PREPARING");
});
test("unserved orders do not derive a readiness state from item cooking", () => {
  assert.equal(deriveOrderStatus({ paymentStatus: "PAID", fulfillmentType: "TAKEOUT", confirmedAt: new Date(), canceledAt: null, items: [{ status: "QUEUED" }] }), "PREPARING");
});

test("one shared unit makes every matching order a candidate without reservation", () => {
  const pool = new Map([["coffee", 1]]);
  for (const order of ["a", "b", "c"]) {
    const result = projectCounterItems([
      { id: order + "1", menuId: "coffee", itemNameSnapshot: "コーヒー", status: "QUEUED" },
      { id: order + "2", menuId: "coffee", itemNameSnapshot: "コーヒー", status: "QUEUED" },
      { id: order + "3", menuId: "tea", itemNameSnapshot: "紅茶", status: "SERVED" },
    ], pool);
    assert.equal(result.readyItems.length, 1);
    assert.deepEqual(result.unreadyItemGroups, [{ name: "コーヒー", count: 1 }]);
    assert.deepEqual(result.servedItemGroups, [{ name: "紅茶", count: 1 }]);
  }
  assert.equal(pool.get("coffee"), 1);
});

test("call cancellation clears the active display without losing history or stock", async () => {
  const { state, db } = fixture(); state.ready = 3;
  await updateOrderCall(db, { actorId: "counter", orderId: "order", action: "call", idempotencyKey: "call-1" });
  assert.ok(state.order.lastCalledAt);
  await updateOrderCall(db, { actorId: "counter", orderId: "order", action: "cancel", idempotencyKey: "cancel-1" });
  assert.equal(state.order.lastCalledAt, null);
  assert.equal(state.calls.length, 1); assert.equal(state.ready, 3);
  assert.equal(state.item.status, "QUEUED");
  await updateOrderCall(db, { actorId: "counter", orderId: "order", action: "call", idempotencyKey: "call-2" });
  assert.ok(state.order.lastCalledAt); assert.equal(state.calls.length, 2);
});

test("replayed calls and cancellations do not duplicate or reverse later actions", async () => {
  const { state, db } = fixture();
  const action = (verb: "call" | "cancel", key: string) => updateOrderCall(db, { actorId: "counter", orderId: "order", action: verb, idempotencyKey: key });
  await action("call", "first"); await action("call", "first");
  assert.equal(state.calls.length, 1);
  await action("cancel", "clear"); await action("call", "next");
  await action("cancel", "clear");
  assert.ok(state.order.lastCalledAt); assert.equal(state.calls.length, 2);
});

test("canceling a call preserves the actual last-call time for serving checks", async () => {
  const { state, db, serve } = fixture(); state.ready = 1;
  await updateOrderCall(db, { actorId: "counter", orderId: "order", action: "call", idempotencyKey: "first" });
  await updateOrderCall(db, { actorId: "counter", orderId: "order", action: "cancel", idempotencyKey: "clear" });
  state.calls[0].calledAt = new Date(Date.now() - 239000);
  await assert.rejects(serve(), e => (e as Error).message.includes("3分"));
  state.calls[0].calledAt = new Date();
  await serve(); assert.equal(state.ready, 0);
});
