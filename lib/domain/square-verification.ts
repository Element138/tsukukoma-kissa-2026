import { assert, AppError } from "@/lib/errors";

type Money = { amount?: number; currency?: string };
export type SquarePayment = {
  id: string; status?: string; source_type?: string; order_id?: string; location_id?: string;
  amount_money?: Money; total_money?: Money; refunded_money?: Money; tip_money?: Money;
  note?: string; created_at?: string;
  is_offline_payment?: boolean; offline_payment_details?: unknown;
};
type Expected = { orderId: string; amountJpy: number; locationId: string; launchedAt: Date; allowUnmarked?: boolean };

export function validateSquarePayment(payment: SquarePayment, expected: Expected) {
  assert(!payment.is_offline_payment && !payment.offline_payment_details, 409, "SQUARE_OFFLINE_DISABLED", "オフライン決済は利用できません。管理者がSquareの取引履歴を確認してください");
  assert(payment.status === "COMPLETED", 409, "SQUARE_UNVERIFIED", "Squareでの支払い完了をまだ確認できません");
  assert(payment.source_type === "CARD", 409, "SQUARE_MISMATCH", "カード・電子マネー以外の取引です");
  assert(payment.location_id === expected.locationId && payment.amount_money?.currency === "JPY" &&
    payment.amount_money.amount === expected.amountJpy && payment.total_money?.amount === expected.amountJpy &&
    payment.total_money.currency === "JPY" && !(payment.refunded_money?.amount) && !(payment.tip_money?.amount),
    409, "SQUARE_MISMATCH", "Squareの店舗・通貨・金額・返金状態が一致しません。管理者が取引履歴を確認してください");
  const createdAt = Date.parse(payment.created_at ?? "");
  assert(Number.isFinite(createdAt) && createdAt >= expected.launchedAt.getTime() - 60_000 && createdAt <= Date.now() + 60_000,
    409, "SQUARE_MISMATCH", "決済日時が一致しません");
}

export async function squareGet(path: string) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  assert(token, 503, "SQUARE_CONFIG", "Squareサーバー認証が未設定です");
  let response: Response;
  try {
    response = await fetch(`https://connect.squareup.com/v2/${path}`, {
      headers: { Authorization: `Bearer ${token}`, "Square-Version": "2026-09-16" },
      cache: "no-store", signal: AbortSignal.timeout(8000),
    });
  } catch { throw new AppError(503, "SQUARE_UNAVAILABLE", "Squareとの通信に失敗しました。決済をやり直さず確認を再試行してください"); }
  assert(response.ok, 503, "SQUARE_UNAVAILABLE", "Squareの取引を確認できません。決済をやり直さず設定・取引履歴を確認してください");
  return response.json();
}

export async function verifySquareTransaction(transactionId: string, expected: Expected) {
  const { order } = await squareGet(`orders/${encodeURIComponent(transactionId)}`);
  assert(order?.id === transactionId && order.location_id === expected.locationId && order.state === "COMPLETED" &&
    order.total_money?.amount === expected.amountJpy && order.total_money.currency === "JPY" && order.tenders?.length === 1,
    409, "SQUARE_MISMATCH", "Squareの注文内容が一致しません。管理者に確認してください");
  const paymentId = order.tenders[0].payment_id;
  assert(typeof paymentId === "string" && paymentId, 409, "SQUARE_UNVERIFIED", "Squareの決済IDが未確定です");
  const { payment } = await squareGet(`payments/${encodeURIComponent(paymentId)}`);
  assert(payment?.id === paymentId && payment.order_id === transactionId, 409, "SQUARE_MISMATCH", "Squareの決済IDが一致しません");
  validateSquarePayment(payment, expected);
  // POS notes can appear in the payment note or the Square order's line item.
  const marker = `[KISSa:${expected.orderId}]`;
  const notes = [payment.note, ...(order.line_items ?? []).flatMap((item: { name?: string; note?: string }) => [item.name, item.note])];
  assert(expected.allowUnmarked || notes.some(note => typeof note === "string" && note.includes(marker)),
    409, "SQUARE_MISMATCH", "KISSa注文との対応を確認できません。管理者がSquareの取引メモを確認してください");
  return { paymentId };
}
