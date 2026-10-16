import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifySquareWebhook } from "../lib/domain/square-webhook";

test("Square webhook signature binds the exact configured URL and raw body", () => {
  const raw = '{"event_id":"event1","type":"payment.updated"}';
  const url = "https://example.com/api/square/webhook", key = "secret-test-key";
  const signature = createHmac("sha256", key).update(url + raw).digest("base64");
  assert.equal(verifySquareWebhook(raw, signature, key, url), true);
  assert.equal(verifySquareWebhook(raw + " ", signature, key, url), false);
  assert.equal(verifySquareWebhook(raw, signature, key, url + "/"), false);
  assert.equal(verifySquareWebhook(raw, signature, "wrong-key", url), false);
  for (const bad of [null, "", "short", "a".repeat(300)]) assert.equal(verifySquareWebhook(raw, bad, key, url), false);
  assert.equal(verifySquareWebhook(raw, signature, undefined, url), false);
});
