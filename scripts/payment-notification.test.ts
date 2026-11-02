import test from "node:test";
import assert from "node:assert/strict";
import { paymentResultNotification } from "../lib/client/payment-notification";

test("cash result notifications never claim a Square payment", () => {
  assert.equal(paymentResultNotification(700, "CASH", "PAID"), "注文 #700 の現金決済完了を確認しました");
  assert.equal(paymentResultNotification(700, "CASH", "FAILED"), "注文 #700 の現金決済失敗を確認しました");
});

test("Square result notifications keep the correct payment method", () => {
  assert.equal(paymentResultNotification(700, "SQUARE", "PAID"), "注文 #700 のSquare決済完了を確認しました");
  assert.equal(paymentResultNotification(700, "SQUARE", "FAILED"), "注文 #700 のSquare決済失敗を確認しました");
});
