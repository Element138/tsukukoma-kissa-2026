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

// Square retains failed tender attempts alongside the eventual successful one.
// Read authoritative Payment records instead of treating tender count as charges.
export async function readSquareOrderPayments(transactionId: string, tenders: unknown): Promise<SquarePayment[]> {
  assert(Array.isArray(tenders) && tenders.length > 0 && tenders.length <= 10,
    409, "SQUARE_UNVERIFIED", "Squareの決済記録を確認できません。管理者が取引履歴を確認してください");
  const ids = tenders.map((tender: { payment_id?: unknown } | null) => tender?.payment_id);
  assert(ids.every((id): id is string => typeof id === "string" && id.length > 0),
    409, "SQUARE_UNVERIFIED", "Squareの決済IDが未確定です");
  assert(new Set(ids).size === ids.length, 409, "SQUARE_CONFLICT", "Squareの決済IDが重複しています");
  return Promise.all(ids.map(async paymentId => {
    const { payment } = await squareGet(`payments/${encodeURIComponent(paymentId)}`);
    assert(payment?.id === paymentId && payment.order_id === transactionId,
      409, "SQUARE_MISMATCH", "Squareの決済IDが一致しません");
    return payment as SquarePayment;
  }));
}

export async function verifySquareTransaction(transactionId: string, expected: Expected) {
  const { order } = await squareGet(`orders/${encodeURIComponent(transactionId)}`);
  assert(order?.id === transactionId && order.location_id === expected.locationId && order.state === "COMPLETED" &&
    order.total_money?.amount === expected.amountJpy && order.total_money.currency === "JPY",
    409, "SQUARE_MISMATCH", "Squareの注文内容が一致しません。管理者に確認してください");
  const payments = await readSquareOrderPayments(transactionId, order.tenders);
  const completed = payments.filter(payment => payment.status === "COMPLETED");
  assert(completed.length <= 1, 409, "SQUARE_CONFLICT", "複数の入金が見つかりました。重複決済を確認してください");
  assert(payments.every(payment => ["COMPLETED", "FAILED", "CANCELED"].includes(payment.status ?? "")),
    409, "SQUARE_STILL_PENDING", "Squareで処理中の決済があります。管理者が取引履歴を確認してください");
  assert(completed.length === 1, 409, "SQUARE_UNVERIFIED", "Squareでの支払い完了をまだ確認できません");
  const payment = completed[0];
  const paymentId = payment.id;
  validateSquarePayment(payment, expected);
  // POS notes can appear in the payment note or the Square order's line item.
  const marker = `[KISSa:${expected.orderId}]`;
  const notes = [payment.note, ...(order.line_items ?? []).flatMap((item: { name?: string; note?: string }) => [item.name, item.note])];
  assert(expected.allowUnmarked || notes.some(note => typeof note === "string" && note.includes(marker)),
    409, "SQUARE_MISMATCH", "KISSa注文との対応を確認できません。管理者がSquareの取引メモを確認してください");
  return { paymentId };
}
