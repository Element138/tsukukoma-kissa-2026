import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../lib/client";
import { isDefinitiveOrderRejection } from "../lib/client/order-recovery";
import { createOrderAtPaymentStart } from "../lib/domain/orders";

test("menu-cap rejection releases the saved submission for both submit and recovery", () => {
  assert.equal(isDefinitiveOrderRejection(new ApiError(409, "本日の上限に達しています", "MENU_CAP_REACHED")), true);
});

test("unavailable-menu rejection releases the frozen request instead of repeating it", () => {
  assert.equal(isDefinitiveOrderRejection(new ApiError(409, "unavailable", "MENU_UNAVAILABLE")), true);
  // Matching text without a definitive server response must not discard an uncertain order.
  assert.equal(isDefinitiveOrderRejection(new Error("MENU_UNAVAILABLE")), false);
  assert.equal(isDefinitiveOrderRejection(new ApiError(503, "unavailable", "MENU_UNAVAILABLE")), false);
});

test("unavailable menu is rejected before order creation; an existing idempotent order still returns", async () => {
  let writes = 0;
  let existing: any = null;
  const tx: any = {
    order: { findFirst: async () => existing, create: async () => { writes++; throw new Error("must not create"); } },
    menu: { findMany: async () => [] },
  };
  const input: any = { actorId: "pos1", actorType: "POS", payload: {
    cashierPhotoBestEffort: true, idempotencyKey: "rejected-order", paymentMethod: "CASH",
    items: [{ menuId: "unavailable", quantity: 1 }],
  } };
  await assert.rejects(createOrderAtPaymentStart(tx, input), { status: 409, code: "MENU_UNAVAILABLE" });
  assert.equal(writes, 0);
  existing = { id: "already-created", items: [] };
  const recovered = await createOrderAtPaymentStart(tx, input);
  assert.equal(recovered.duplicated, true);
  assert.equal(recovered.order.id, existing.id);
  assert.equal(writes, 0);
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
