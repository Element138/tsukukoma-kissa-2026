import test from "node:test";
import assert from "node:assert/strict";
import { canRefreshOrderDisplay, ORDER_DISPLAY_PAGE_REFRESH_MS, readOrderDisplayResume } from "../lib/client/order-display-refresh";

const idle = { now: ORDER_DISPLAY_PAGE_REFRESH_MS, dueAt: ORDER_DISPLAY_PAGE_REFRESH_MS,
  lastCallEndedAt: 0, callInFlight: false, queuedCalls: 0, online: true };

test("refresh becomes eligible at five minutes", () => {
  assert.equal(canRefreshOrderDisplay({ ...idle, now: idle.now - 1 }), false);
  assert.equal(canRefreshOrderDisplay(idle), true);
});

test("overdue refresh waits for audio, queued calls, quiet time and connectivity", () => {
  assert.equal(canRefreshOrderDisplay({ ...idle, callInFlight: true }), false);
  assert.equal(canRefreshOrderDisplay({ ...idle, queuedCalls: 1 }), false);
  assert.equal(canRefreshOrderDisplay({ ...idle, lastCallEndedAt: idle.now - 4_999 }), false);
  assert.equal(canRefreshOrderDisplay({ ...idle, lastCallEndedAt: idle.now - 5_000 }), true);
  assert.equal(canRefreshOrderDisplay({ ...idle, online: false }), false);
});

test("resume cursor survives automatic navigation only for the same actor and a short time", () => {
  const raw = JSON.stringify({ actorId: "display", cursor: 42, at: 1_000 });
  assert.equal(readOrderDisplayResume(raw, "display", 2_000), 42);
  assert.equal(readOrderDisplayResume(raw, "other", 2_000), null);
  assert.equal(readOrderDisplayResume(raw, "display", 121_001), null);
  assert.equal(readOrderDisplayResume(raw, "display", 999), null);
  for (const invalid of [null, "bad", "{}", '{"actorId":"display","cursor":-1,"at":1000}']) {
    assert.equal(readOrderDisplayResume(invalid, "display", 2_000), null);
  }
});
