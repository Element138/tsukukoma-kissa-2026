import test from "node:test";
import assert from "node:assert/strict";
import { markKitchenMenuItemsReady, updateMenuCapByKitchen } from "../lib/domain/kitchen";
import { executeUndo } from "../lib/domain/undo";
import { assertMenuCapUnchanged } from "../lib/domain/menu-cap";

function fixture(cap: number | null = 100) {
  const state = { cap, ready: 10, cooked: 20, assigned: true, audits: [] as any[], undos: [] as any[], writes: [] as any[] };
  const changeCap = (data: any) => {
    state.writes.push(structuredClone(data));
    if (typeof data.dailyOrderCap === "object" && data.dailyOrderCap !== null) state.cap = state.cap! + (data.dailyOrderCap.increment ?? -data.dailyOrderCap.decrement);
    else state.cap = data.dailyOrderCap;
    return { id: "menu", dailyOrderCap: state.cap };
  };
  const tx: any = {
    $queryRaw: async () => [],
    menuKitchenAssignment: { findUnique: async () => ({ enabled: state.assigned }), findFirst: async () => state.assigned ? { enabled: true } : null },
    menu: {
      findUniqueOrThrow: async () => ({ id: "menu", dailyOrderCap: state.cap }), findUnique: async () => ({ id: "menu", dailyOrderCap: state.cap }),
      update: async ({ data }: any) => changeCap(data),
      updateMany: async ({ data }: any) => { if (state.cap === null) return { count: 0 }; changeCap(data); return { count: 1 }; },
    },
    menuStock: { updateMany: async ({ where, data }: any) => {
      if (state.ready < where.readyCount.gte) return { count: 0 };
      state.ready -= data.readyCount.decrement; return { count: 1 };
    } },
    menuDailyCount: { findUnique: async () => ({ cookedCount: state.cooked }), update: async ({ data }: any) => { state.cooked -= data.cookedCount.decrement; } },
    auditLog: { findFirst: async ({ where }: any) => where ? state.audits.find(row => row.actorId === where.actorId && row.actionType === where.actionType && row.correlationId === where.correlationId) ?? null : null,
      create: async ({ data }: any) => { state.audits.push(data); } },
    undoOperation: { create: async ({ data }: any) => { state.undos.push({ id: `undo-${state.undos.length}`, ...data }); }, findMany: async () => [],
      findFirst: async () => state.undos.at(-1), delete: async () => state.undos.pop() },
  };
  // Model the per-menu transaction lock; verify both serializations of racing requests.
  let queue = Promise.resolve();
  const transaction = async <T>(operation: () => Promise<T>) => {
    const previous = queue; let release!: () => void;
    queue = new Promise(resolve => { release = resolve; }); await previous;
    const saved = structuredClone(state);
    try { return await operation(); } catch (error) { Object.assign(state, saved); throw error; } finally { release(); }
  };
  const correct = (quantity: number, correctionType: "DISCARD" | "UNCOOK", key = "request1") => transaction(() => markKitchenMenuItemsReady(tx,
    { actorId: "kitchen", kitchenId: "kitchen", menuId: "menu", quantity, correctionType, idempotencyKey: key }));
  const capTo = (value: number | null, expected: number | null | undefined) => transaction(() => updateMenuCapByKitchen(tx,
    { actorId: "kitchen", kitchenId: "kitchen", menuId: "menu", dailyOrderCap: value, expectedDailyOrderCap: expected }));
  const undo = () => transaction(() => executeUndo(tx, { actorId: "kitchen", actorType: "KITCHEN" }));
  return { state, correct, capTo, undo };
}

test("discard subtracts three from stock, cooked count and cap; uncook preserves the cap", async () => {
  const discarded = fixture(); await discarded.correct(-3, "DISCARD");
  assert.deepEqual([discarded.state.ready, discarded.state.cooked, discarded.state.cap], [7, 17, 97]);
  assert.deepEqual(discarded.state.writes[0], { dailyOrderCap: { decrement: 3 } }, "discard sends a delta, never a replacement 97");
  const uncooked = fixture(); await uncooked.correct(-3, "UNCOOK");
  assert.deepEqual([uncooked.state.ready, uncooked.state.cooked, uncooked.state.cap], [7, 17, 100]);
});

test("cap=80 arriving first then discard=3 yields 77", async () => {
  const f = fixture(); await Promise.all([f.capTo(80, 100), f.correct(-3, "DISCARD")]);
  assert.equal(f.state.cap, 77);
});

test("discard arriving first rejects a stale cap=80 request instead of overwriting 97", async () => {
  const f = fixture();
  const results = await Promise.allSettled([f.correct(-3, "DISCARD"), f.capTo(80, 100)]);
  assert.equal(results[0].status, "fulfilled"); assert.equal(results[1].status, "rejected");
  assert.equal((results[1] as PromiseRejectedResult).reason.code, "MENU_CAP_CHANGED");
  assert.equal(f.state.cap, 97); assert.equal(f.state.ready, 7);
});

test("replayed discard cannot subtract cap twice or be changed into an uncook", async () => {
  const f = fixture(); await f.correct(-3, "DISCARD"); await f.correct(-3, "DISCARD");
  assert.equal(f.state.cap, 97); assert.equal(f.state.ready, 7); assert.equal(f.state.undos.length, 1);
  await assert.rejects(f.correct(-3, "UNCOOK"), { code: "IDEMPOTENCY_CONFLICT" });
});

test("undo adds back only the discard delta after a later manual cap edit", async () => {
  const f = fixture(); await f.correct(-3, "DISCARD"); await f.capTo(80, 97); await f.undo();
  assert.deepEqual([f.state.ready, f.state.cooked, f.state.cap], [10, 20, 83]);
});

test("unlimited caps stay unlimited; finite caps stop at zero and undo restores the actual reduction", async () => {
  const unlimited = fixture(null); await unlimited.correct(-3, "DISCARD"); await unlimited.undo(); assert.equal(unlimited.state.cap, null);
  const f = fixture(2); await f.correct(-3, "DISCARD"); assert.equal(f.state.cap, 0);
  await f.undo(); assert.equal(f.state.cap, 2);
  const changed = fixture(); await changed.correct(-3, "DISCARD"); await changed.capTo(null, 97); await changed.undo(); assert.equal(changed.state.cap, null);
});

test("stock, daily-count and authorization failures cannot change cap or save an undo", async () => {
  for (const mutation of [(f: ReturnType<typeof fixture>) => { f.state.ready = 2; }, (f: ReturnType<typeof fixture>) => { f.state.cooked = 2; }, (f: ReturnType<typeof fixture>) => { f.state.assigned = false; }]) {
    const f = fixture(); mutation(f); const before = structuredClone(f.state);
    await assert.rejects(f.correct(-3, "DISCARD")); assert.deepEqual(f.state, before);
  }
});

test("cap changes without a baseline and stale finite/unlimited baselines are rejected", async () => {
  for (const [current, expected] of [[97, 100], [null, 100], [100, null], [100, undefined]] as const) assert.throws(() => assertMenuCapUnchanged(current, expected), { code: "MENU_CAP_CHANGED" });
  const f = fixture(); await assert.rejects(f.capTo(80, undefined), { code: "MENU_CAP_CHANGED" }); assert.equal(f.state.cap, 100);
});
