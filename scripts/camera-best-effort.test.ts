import test from "node:test";
import assert from "node:assert/strict";
import { withCameraTimeout, checkCameraAbort } from "../lib/client/camera-timeout";
import { attachCashierPhotoBestEffort, attachCashierPhoto } from "../lib/domain/cashier-photos";
import { createOrderAtPaymentStart } from "../lib/domain/orders";

test("hung camera work times out, aborts, and cannot perform a late upload", async () => {
  let signal!: AbortSignal;
  let release!: () => void;
  let uploaded = false;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await assert.rejects(withCameraTimeout(async current => {
    signal = current; await blocked; checkCameraAbort(current); uploaded = true;
  }, 10), /タイムアウト/);
  assert.equal(signal.aborted, true);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(uploaded, false);
  assert.equal(await withCameraTimeout(async () => "captured", 100), "captured");
});

function photoFixture(photo: any) {
  const audits: any[] = [];
  let binds = 0;
  const tx: any = {
    cashierPhoto: { findUnique: async () => photo, updateMany: async ({ data }: any) => { binds++; Object.assign(photo, data); return { count: 1 }; } },
    auditLog: { findFirst: async () => null, create: async ({ data }: any) => { audits.push(data); return data; } },
    photoStorageState: { upsert: async () => ({ failedAt: new Date(), ignoreUntil: null }) },
  };
  return { tx, audits, get binds() { return binds; } };
}
const input = { checkoutKey: "checkout-key", actorId: "pos", orderId: "order" };
const stored = () => ({ id: "photo", actorId: "pos", capturedAt: new Date(), storedAt: new Date(), sha256: "hash", orderId: null });

test("missing, incomplete, failed and foreign photos do not stop best-effort checkout", async () => {
  for (const photo of [null, { ...stored(), capturedAt: null }, { ...stored(), storedAt: null, failureCode: "PHOTO_STORAGE_UNAVAILABLE" },
    { ...stored(), actorId: "other-pos" }, { ...stored(), orderId: "other-order" }]) {
    const f = photoFixture(photo);
    assert.equal(await attachCashierPhotoBestEffort(f.tx, input), null);
    assert.equal(f.binds, 0);
    assert.equal(f.audits[0].actionType, "CASHIER_PHOTO_SKIPPED");
    assert.equal(f.audits[0].orderId, "order");
  }
});

test("stored owned photos are attached exactly once and legacy strict requests still require capture", async () => {
  const photo = stored(), f = photoFixture(photo);
  await attachCashierPhotoBestEffort(f.tx, input);
  await attachCashierPhotoBestEffort(f.tx, input);
  assert.equal(f.binds, 1);
  assert.equal(photo.orderId, "order");
  const missing = photoFixture(null);
  await assert.rejects(attachCashierPhoto(missing.tx, input), { code: "CASHIER_PHOTO_REQUIRED" });
});

test("only explicit POS best-effort requests pass the failed-storage gate", async () => {
  const reachedMenu = new Error("Reached menu validation");
  for (const bestEffort of [undefined, false, true]) {
    let storageChecks = 0;
    const db: any = {
      order: { findFirst: async () => null },
      photoStorageState: { upsert: async () => { storageChecks++; return { failedAt: new Date(), ignoreUntil: null }; } },
      menu: { findMany: async () => { throw reachedMenu; } },
    };
    const params: any = { actorId: "pos", actorType: "POS", payload: { items: [{ menuId: "coffee", quantity: 1 }],
      idempotencyKey: "checkout-key", paymentMethod: "CASH", cashierPhotoBestEffort: bestEffort } };
    const result = createOrderAtPaymentStart(db, params);
    if (bestEffort) await assert.rejects(result, error => error === reachedMenu);
    else await assert.rejects(result, { code: "PHOTO_STORAGE_BLOCKED" });
    assert.equal(storageChecks, bestEffort ? 0 : 1);
    await assert.rejects(createOrderAtPaymentStart(db, { ...params, actorType: "WAITER" }), { code: "FORBIDDEN" });
  }
});
