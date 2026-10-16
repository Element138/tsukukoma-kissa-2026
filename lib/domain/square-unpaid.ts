import { assert } from "@/lib/errors";
import { squareGet, type SquarePayment } from "@/lib/domain/square-verification";

type SearchInput = { orderId: string; locationId: string; amountJpy: number; launchedAt: Date; transactionId?: string | null };
export type PaymentInspection = { kind: "completed"; transactionId: string } | { kind: "unpaid" };

// Absence from an eventually consistent list is not proof by itself: the admin's
// attestation that the original Square checkout is stopped remains mandatory.
export async function inspectSquareBeforeClosing(input: SearchInput): Promise<PaymentInspection> {
  const marker = `[KISSa:${input.orderId}]`;
  const matches: SquarePayment[] = [];
  if (input.transactionId) {
    const { order } = await squareGet(`orders/${encodeURIComponent(input.transactionId)}`);
    assert(order?.id === input.transactionId && order.location_id === input.locationId, 409, "SQUARE_MISMATCH", "Square取引の店舗が一致しません");
    assert(Array.isArray(order.tenders) && order.tenders.length > 0 && order.tenders.length <= 2,
      409, "SQUARE_UNVERIFIED", "Squareの決済記録を確認できません。未決済として終了できません");
    for (const tender of order.tenders) {
      assert(typeof tender.payment_id === "string", 409, "SQUARE_UNVERIFIED", "Squareの決済IDが未確定です");
      const { payment } = await squareGet(`payments/${encodeURIComponent(tender.payment_id)}`);
      assert(payment?.id === tender.payment_id && payment.order_id === input.transactionId, 409, "SQUARE_MISMATCH", "Squareの決済IDが一致しません");
      matches.push(payment);
    }
  } else {
    const parameters = new URLSearchParams({ location_id: input.locationId, begin_time: new Date(input.launchedAt.getTime() - 60_000).toISOString(),
      end_time: new Date().toISOString(), limit: "100", sort_order: "DESC" });
    let pages = 0;
    let candidates = 0;
    let cursor: string | undefined;
    do {
      assert(++pages <= 5, 409, "SQUARE_SEARCH_INCOMPLETE", "確認対象が多いため照合を完了できません。Square注文IDを指定してください");
      if (cursor) parameters.set("cursor", cursor);
      const page = await squareGet(`payments?${parameters}`);
      assert(!page.errors && (page.payments === undefined || Array.isArray(page.payments)), 503, "SQUARE_UNAVAILABLE", "Squareの照合結果を確認できません");
      for (const payment of (page.payments ?? []) as SquarePayment[]) {
        if (payment.location_id !== input.locationId) continue;
        let notes = payment.note ?? "";
        const amount = payment.total_money?.amount ?? payment.amount_money?.amount;
        if (!notes.includes("[KISSa:") && (amount === undefined || amount === input.amountJpy) && !["FAILED", "CANCELED"].includes(payment.status ?? "")) {
          assert(payment.order_id && ++candidates <= 10, 409, "SQUARE_SEARCH_AMBIGUOUS", "対応する取引を特定できません。Square注文IDを指定してください");
          const { order } = await squareGet(`orders/${encodeURIComponent(payment.order_id)}`);
          notes = (order?.line_items ?? []).map((item: { name?: string; note?: string }) => `${item.name ?? ""} ${item.note ?? ""}`).join(" ");
          assert(notes.includes("[KISSa:"), 409, "SQUARE_SEARCH_AMBIGUOUS", "同額の未照合取引があります。Square注文IDを指定して確認してください");
        }
        if (notes.includes(marker)) matches.push(payment);
      }
      cursor = page.cursor;
    } while (cursor);
  }
  const completed = matches.filter(payment => payment.status === "COMPLETED");
  assert(completed.length <= 1, 409, "SQUARE_CONFLICT", "複数の入金が見つかりました。重複決済を確認してください");
  if (completed.length) {
    const transactionId = completed[0].order_id;
    assert(transactionId, 409, "SQUARE_UNVERIFIED", "Square注文IDが未確定です");
    return { kind: "completed", transactionId };
  }
  assert(matches.every(payment => ["FAILED", "CANCELED"].includes(payment.status ?? "")),
    409, "SQUARE_STILL_PENDING", "Squareで処理中の決済があります。未決済として終了できません");
  assert(matches.length || Date.now() - input.launchedAt.getTime() >= 30_000,
    409, "SQUARE_SEARCH_PENDING", "Squareの反映待ちです。30秒以上あけて再確認してください");
  return { kind: "unpaid" };
}
