import test from "node:test";
import assert from "node:assert/strict";
import { verifySquareTransaction } from "../lib/domain/square-verification";
import { inspectSquareBeforeClosing } from "../lib/domain/square-unpaid";

const expected = { orderId: "kiss-order", amountJpy: 700, locationId: "location", launchedAt: new Date(Date.now() - 60_000) };
function fixture() {
  const order: any = { id: "square-order", location_id: "location", state: "COMPLETED",
    total_money: { amount: 700, currency: "JPY" },
    line_items: [{ note: "注文#476 [KISSa:kiss-order]" }],
    tenders: [{ payment_id: "declined", card_details: { status: "FAILED" } }, { payment_id: "captured", card_details: { status: "CAPTURED" } }],
  };
  const captured: any = { id: "captured", order_id: "square-order", status: "COMPLETED", source_type: "CARD", location_id: "location",
    amount_money: { amount: 700, currency: "JPY" }, total_money: { amount: 700, currency: "JPY" },
    created_at: new Date().toISOString(), card_details: { card: { card_brand: "FELICA" } } };
  const payments: Record<string, any> = { declined: { ...captured, id: "declined", status: "FAILED" }, captured };
  return { order, payments };
}
async function withSquare(f: ReturnType<typeof fixture>, run: () => Promise<void>) {
  const original = global.fetch, token = process.env.SQUARE_ACCESS_TOKEN;
  process.env.SQUARE_ACCESS_TOKEN = "test-only";
  global.fetch = async input => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "connect.squareup.com");
    return Response.json(url.pathname.includes("/orders/") ? { order: f.order } : { payment: f.payments[url.pathname.split("/").at(-1)!] });
  };
  try { await run(); } finally { global.fetch = original; if (token === undefined) delete process.env.SQUARE_ACCESS_TOKEN; else process.env.SQUARE_ACCESS_TOKEN = token; }
}

test("order #476 shape: failed Suica attempt then captured ¥700 verifies in either tender order", async () => {
  for (const reverse of [false, true]) {
    const f = fixture(); if (reverse) f.order.tenders.reverse();
    await withSquare(f, async () => {
      assert.deepEqual(await verifySquareTransaction("square-order", expected), { paymentId: "captured" });
      assert.deepEqual(await inspectSquareBeforeClosing({ ...expected, transactionId: "square-order" }), { kind: "completed", transactionId: "square-order" });
    });
  }
});

test("multiple failed attempts followed by one completed payment are not split payments", async () => {
  const f = fixture(); f.payments.canceled = { ...f.payments.declined, id: "canceled", status: "CANCELED" };
  f.order.tenders.unshift({ payment_id: "canceled" });
  await withSquare(f, async () => {
    assert.deepEqual(await verifySquareTransaction("square-order", expected), { paymentId: "captured" });
    assert.equal((await inspectSquareBeforeClosing({ ...expected, transactionId: "square-order" })).kind, "completed");
  });
});

test("two completed payments, including split payments, cannot auto-confirm", async () => {
  const f = fixture(); f.payments.declined.status = "COMPLETED";
  await withSquare(f, async () => {
    await assert.rejects(verifySquareTransaction("square-order", expected), { code: "SQUARE_CONFLICT" });
    await assert.rejects(inspectSquareBeforeClosing({ ...expected, transactionId: "square-order" }), { code: "SQUARE_CONFLICT" });
  });
});

test("pending or unknown additional attempts prevent confirmation", async () => {
  for (const status of ["APPROVED", "PENDING", undefined]) {
    const f = fixture(); f.payments.declined.status = status;
    await withSquare(f, async () => { await assert.rejects(verifySquareTransaction("square-order", expected), { code: "SQUARE_STILL_PENDING" }); });
  }
});

test("failed-only attempts do not become paid", async () => {
  const f = fixture(); f.payments.captured.status = "FAILED";
  await withSquare(f, async () => {
    await assert.rejects(verifySquareTransaction("square-order", expected), { code: "SQUARE_UNVERIFIED" });
    assert.deepEqual(await inspectSquareBeforeClosing({ ...expected, transactionId: "square-order" }), { kind: "unpaid" });
  });
});

test("successful tender hints never override Payments API state or identity", async () => {
  for (const patch of [{ id: "another" }, { order_id: "another" }, { amount_money: { amount: 699, currency: "JPY" } },
    { refunded_money: { amount: 700, currency: "JPY" } }, { is_offline_payment: true }, { location_id: "another" }]) {
    const f = fixture(); Object.assign(f.payments.captured, patch);
    await withSquare(f, async () => { await assert.rejects(verifySquareTransaction("square-order", expected)); });
  }
});

test("missing, duplicate or excessive tender IDs fail closed", async () => {
  for (const tenders of [[], [{ payment_id: "captured" }, { payment_id: "captured" }], [{ id: "captured" }], Array.from({ length: 11 }, (_, i) => ({ payment_id: String(i) }))]) {
    const f = fixture(); f.order.tenders = tenders;
    await withSquare(f, async () => { await assert.rejects(verifySquareTransaction("square-order", expected)); });
  }
});
