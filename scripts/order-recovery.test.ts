import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../lib/client";
import { isDefinitiveOrderRejection } from "../lib/client/order-recovery";

test("menu-cap rejection releases the saved submission for both submit and recovery", () => {
  assert.equal(isDefinitiveOrderRejection(new ApiError(409, "本日の上限に達しています", "MENU_CAP_REACHED")), true);
});

test("uncertain submissions and other conflicts retain their idempotent recovery", () => {
  for (const error of [
    new ApiError(0, "offline", "NETWORK_ERROR"),
    new ApiError(408, "timeout", "REQUEST_TIMEOUT"),
    new ApiError(500, "database error", "P2010"),
    new ApiError(503, "database unavailable", "DB_UNAVAILABLE"),
    new ApiError(409, "payment unresolved", "POS_AWAITING_ORDER"),
    new ApiError(409, "conflict", "TX_CONFLICT"),
    new ApiError(409, "unknown conflict"),
    new Error("MENU_CAP_REACHED"),
  ]) assert.equal(isDefinitiveOrderRejection(error), false);
});

test("existing definitive request rejection handling is preserved", () => {
  for (const status of [400, 403, 404]) {
    assert.equal(isDefinitiveOrderRejection(new ApiError(status, "rejected")), true);
  }
});
