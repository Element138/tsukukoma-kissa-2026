import test from "node:test";
import assert from "node:assert/strict";
import { createSquareAppSwitchRequest, parseSquareCallback, squareConfig } from "../lib/domain/square";
import { validateSquarePayment } from "../lib/domain/square-verification";
const state = "a".repeat(64);
const callback = (data: unknown) => new URL(`https://example.com/api/square/callback?data=${encodeURIComponent(JSON.stringify(data))}`);

test("iOS request pins production location, JPY, API version and cashless tender", () => {
  const { deepLink } = createSquareAppSwitchRequest({ orderId: "order1", orderNo: 3, amountJpy: 420,
    callbackUrl: "https://example.com/api/square/callback", appId: "sq0idp-test", locationId: "location", state });
  const data = JSON.parse(new URL(deepLink).searchParams.get("data")!);
  assert.equal(data.version, "1.3"); assert.equal(data.location_id, "location");
  assert.deepEqual(data.amount_money, { amount: 420, currency_code: "JPY" });
  assert.deepEqual(data.options.supported_tender_types, ["CREDIT_CARD"]);
  assert.equal(data.options.clear_default_fees, true); assert.match(data.notes, /\[KISSa:order1\]/);
});
test("zero/invalid amounts cannot start a charge", () => {
  for (const amountJpy of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => createSquareAppSwitchRequest({
    orderId: "o", orderNo: 1, amountJpy, callbackUrl: "", appId: "", locationId: "", state,
  }));
});
test("actual iOS JSON callback, cancellation and offline result are parsed", () => {
  assert.equal(parseSquareCallback(callback({ state, status: "ok", transaction_id: "transaction" })).transaction_id, "transaction");
  assert.equal(parseSquareCallback(callback({ state, status: "error", error_code: "payment_canceled" })).status, "error");
  assert.equal(parseSquareCallback(callback({ state, status: "ok", client_transaction_id: "offline" })).transaction_id, undefined);
});
test("legacy unsigned callbacks, malformed, duplicate and contradictory data rejected", () => {
  for (const data of [{ state: "order1", status: "ok", transaction_id: "t" }, { state, status: "ok" },
    { state, status: "ok", transaction_id: "t", error_code: "payment_canceled" }, { state, status: "error" }, {}]) {
    assert.throws(() => parseSquareCallback(callback(data)));
  }
  assert.throws(() => parseSquareCallback(new URL("https://example.com/?state=order1&status=ok")));
  assert.throws(() => parseSquareCallback(new URL("https://example.com/?data=%7B")));
  const duplicated = callback({ state, status: "ok", transaction_id: "t" }); duplicated.searchParams.append("data", "{}");
  assert.throws(() => parseSquareCallback(duplicated));
});
test("configuration fails closed for disabled, sandbox, preview and wrong callback origin", () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { SQUARE_ENABLED: "true", SQUARE_APP_ID: "sq0idp-test", SQUARE_LOCATION_ID: "location",
      SQUARE_WEBHOOK_SIGNING_KEY: "test-key", SQUARE_WEBHOOK_URL: "https://example.com/api/square/webhook",
      SQUARE_ACCESS_TOKEN: "private-test", SQUARE_CALLBACK_URL: "https://example.com/api/square/callback", VERCEL_ENV: "production" });
    assert.equal(squareConfig("https://example.com").locationId, "location");
    assert.throws(() => squareConfig("https://preview.example.com"));
    process.env.VERCEL_ENV = "preview"; assert.throws(() => squareConfig()); process.env.VERCEL_ENV = "production";
    process.env.SQUARE_APP_ID = "sandbox-sq0idb-test"; assert.throws(() => squareConfig());
    process.env.SQUARE_ENABLED = "false"; assert.throws(() => squareConfig());
  } finally { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); }
});
test("server payment validation rejects partial, wrong location/currency/amount, refund and cash", () => {
  const expected = { orderId: "o", amountJpy: 420, locationId: "location", launchedAt: new Date(Date.now() - 2000) };
  const valid = { id: "p", status: "COMPLETED", source_type: "CARD", location_id: "location", created_at: new Date().toISOString(),
    amount_money: { amount: 420, currency: "JPY" }, total_money: { amount: 420, currency: "JPY" } };
  validateSquarePayment(valid, expected);
  for (const patch of [{ is_offline_payment: true }, { offline_payment_details: {} }, { status: "APPROVED" }, { source_type: "CASH" }, { location_id: "other" },
    { amount_money: { amount: 420, currency: "USD" } }, { total_money: { amount: 419, currency: "JPY" } },
    { refunded_money: { amount: 1, currency: "JPY" } }, { created_at: "2020-01-01" }]) {
    assert.throws(() => validateSquarePayment({ ...valid, ...patch }, expected));
  }
});
