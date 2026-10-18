import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import { cancelCashOrder } from "../lib/domain/cash-cancellation";
import { canCancelCashOrder } from "../lib/domain/cash-cancel-eligibility";
import { deriveOrderStatus } from "../lib/domain/order-status";
import { deriveOrderProcessingTrace } from "../lib/domain/order-processing-trace";
import { serveDineInItem } from "../lib/domain/counter";
import { executeUndo } from "../lib/domain/undo";

function fixture() {
  const state = {
    order: { id: "order", orderNo: 12, confirmedAt: new Date("2026-01-01"), canceledAt: null as Date | null,
      paymentMethod: "CASH", paymentStatus: "PAID", orderStatus: "PREPARING", fulfillmentType: "DINE_IN",
      totalPriceJpy: 900, lastCalledAt: new Date(), lastMutationVersion: 3, events: [] as any[] },
    items: ["one", "two"].map(id => ({ id, orderId: "order", menuId: "menu", itemNameSnapshot: "Coffee",
      status: "QUEUED", servedAt: null as Date | null, servedByActorId: null as string | null })),
    ready: 5, cooked: 8, dailyCount: 7, releasedAt: null as Date | null,
    audits: [] as any[], undos: [] as any[], locks: [] as string[], onOrderLock: null as (() => void) | null,
  };
  const snapshot = () => structuredClone({ ...state.order, items: state.items });
  const db = {
    $queryRaw: async (query: TemplateStringsArray | unknown) => {
      const sql = Array.isArray(query) ? query.join("") : "stock expiry";
      state.locks.push(sql);
      if (sql.includes('FROM "Order"')) state.onOrderLock?.();
      return [];
    },
    $executeRaw: async () => { state.dailyCount -= 2; return 1; },
    order: {
      findUnique: async () => snapshot(), findUniqueOrThrow: async () => snapshot(),
      update: async ({ data }: any) => {
        const { lastMutationVersion, ...rest } = data;
        Object.assign(state.order, rest);
        if (lastMutationVersion) state.order.lastMutationVersion += lastMutationVersion.increment;
        return snapshot();
      },
    },
    orderItem: {
      findUnique: async ({ where }: any) => structuredClone(state.items.find(item => item.id === where.id)),
      findUniqueOrThrow: async ({ where }: any) => ({ ...structuredClone(state.items.find(item => item.id === where.id)), order: snapshot() }),
      findFirst: async () => state.items.find(item => item.status === "SERVED") ?? null,
      update: async ({ where, data }: any) => Object.assign(state.items.find(item => item.id === where.id)!, data),
      updateMany: async ({ where, data }: any) => {
        const items = state.items.filter(item => (!where.id || item.id === where.id) &&
          (!where.status || item.status === where.status) &&
          (!where.servedAt || item.servedAt?.getTime() === where.servedAt.getTime()));
        items.forEach(item => Object.assign(item, data)); return { count: items.length };
      },
    },
    menuStock: {
      updateMany: async () => { if (!state.ready) return { count: 0 }; state.ready--; return { count: 1 }; },
      upsert: async () => { state.ready++; },
    },
    orderMenuCapReservation: {
      findMany: async () => state.releasedAt ? [] : [{ orderId: "order", menuId: "menu", jstDate: "2026-01-01", quantity: 2 }],
      updateMany: async ({ data }: any) => { if (state.releasedAt) return { count: 0 }; state.releasedAt = data.releasedAt; return { count: 1 }; },
    },
    auditLog: { findFirst: async () => null, create: async ({ data }: any) => { state.audits.push(data); } },
    undoOperation: {
      create: async ({ data }: any) => { state.undos.push({ id: "undo", ...data }); },
      findMany: async () => [], findFirst: async () => state.undos.at(-1),
      delete: async () => { state.undos.pop(); },
    },
  };
  return { db: db as unknown as Prisma.TransactionClient, state, snapshot };
}
const params = { actorId: "other-pos", actorType: "POS" as const, orderId: "order", reasonText: " 決済方法の選択誤り " };

test("cash void preserves history and stock, releases original-day limits once, and is retry-safe", async () => {
  const { db, state } = fixture();
  const result = await cancelCashOrder(db, params);
  assert.equal(result.orderStatus, "CANCELED");
  assert.equal(result.paymentStatus, "CANCELED");
  assert.ok(result.canceledAt);
  assert.equal(result.totalPriceJpy, 900);
  assert.equal(result.confirmedAt?.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(result.lastCalledAt, null);
  assert.equal(result.lastMutationVersion, 4);
  assert.ok(result.items.every(item => item.status === "CANCELED"));
  assert.equal(state.dailyCount, 5);
  assert.equal(state.ready, 5);
  assert.equal(state.cooked, 8);
  assert.equal(state.audits[0].actorId, "other-pos");
  assert.equal(state.audits[0].reasonText, "決済方法の選択誤り");
  assert.equal(state.order.events[0].type, "ORDER_CANCELED");
  await cancelCashOrder(db, params);
  assert.equal(state.dailyCount, 5);
  assert.equal(state.audits.length, 1);
  assert.equal(state.order.events.length, 1);
  assert.equal(state.order.lastMutationVersion, 4);
  const trace = deriveOrderProcessingTrace({ createdAt: new Date(), events: state.order.events });
  assert.equal(trace.failureReasonText, "決済方法の選択誤り");
});

test("cash cancellation rejects other payment methods, unpaid and terminal orders, partial serving, empty orders and missing confirmation", async () => {
  for (const change of [
    { paymentMethod: "SQUARE" }, { paymentMethod: "PAYMENT_SKIPPED" },
    { paymentStatus: "AWAITING" }, { paymentStatus: "FAILED" },
    { orderStatus: "COMPLETED" }, { orderStatus: "FAILED" }, { orderStatus: "PENDING" }, { confirmedAt: null },
  ]) {
    const { db, state } = fixture(); Object.assign(state.order, change);
    await assert.rejects(cancelCashOrder(db, params), { code: "CASH_CANCEL_NOT_ALLOWED" });
    assert.equal(state.audits.length, 0); assert.equal(state.releasedAt, null);
  }
  for (const status of ["SERVED", "CANCELED"]) {
    const { db, state } = fixture(); state.items[0].status = status;
    await assert.rejects(cancelCashOrder(db, params), { code: "CASH_CANCEL_NOT_ALLOWED" });
  }
  const { snapshot } = fixture();
  assert.equal(canCancelCashOrder({ ...snapshot(), items: [] }), false);
});

test("requires an authorized actor and a nonblank bounded reason", async () => {
  for (const actorType of ["WAITER", "KITCHEN", "MENU_DISPLAY", "ORDER_DISPLAY"] as const) {
    const { db, state } = fixture();
    await assert.rejects(cancelCashOrder(db, { ...params, actorType }), { code: "FORBIDDEN" });
    assert.equal(state.locks.length, 0);
  }
  for (const reasonText of ["", "   ", "a".repeat(501)]) {
    const { db, state } = fixture();
    await assert.rejects(cancelCashOrder(db, { ...params, reasonText }), { code: "CANCEL_REASON_REQUIRED" });
    assert.equal(state.releasedAt, null);
  }
  const { db } = fixture();
  assert.equal((await cancelCashOrder(db, { ...params, actorType: "ADMIN" })).orderStatus, "CANCELED");
});

test("rechecks serving state after acquiring the order lock", async () => {
  const { db, state } = fixture();
  state.onOrderLock = () => { state.items[0].status = "SERVED"; };
  await assert.rejects(cancelCashOrder(db, params), { code: "CASH_CANCEL_NOT_ALLOWED" });
  assert.equal(state.audits.length, 0);
  assert.equal(state.releasedAt, null);
});

test("cancellation prevents later serving; serving must be fully undone before cancellation", async () => {
  const { db, state } = fixture();
  await serveDineInItem(db, { actorId: "counter", orderItemId: "one", confirmUncalled: true });
  await assert.rejects(cancelCashOrder(db, params), { code: "CASH_CANCEL_NOT_ALLOWED" });
  await executeUndo(db, { actorId: "counter", actorType: "WAITER" });
  assert.equal(state.ready, 5);
  await cancelCashOrder(db, params);
  await assert.rejects(serveDineInItem(db, { actorId: "counter", orderItemId: "two", confirmUncalled: true }));
  assert.equal(state.ready, 5);
});

test("takeout and already prepared items can be canceled without undoing production", async () => {
  const { db, state } = fixture(); state.order.fulfillmentType = "TAKEOUT"; state.items[0].status = "READY";
  const result = await cancelCashOrder(db, params);
  assert.equal(deriveOrderStatus(result), "CANCELED");
  assert.equal(state.ready, 5); assert.equal(state.cooked, 8);
});
