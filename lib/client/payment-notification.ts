import { PAYMENT_METHOD_LABEL, labelOf } from "../labels";

export function paymentResultNotification(orderNo: number, paymentMethod: string, result: "PAID" | "FAILED") {
  const outcome = result === "PAID" ? "完了" : "失敗";
  return `注文 #${orderNo} の${labelOf(PAYMENT_METHOD_LABEL, paymentMethod)}決済${outcome}を確認しました`;
}
