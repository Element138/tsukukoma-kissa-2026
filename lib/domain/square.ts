import { z } from "zod";
import { AppError, assert } from "@/lib/errors";

export function squareConfig(origin?: string) {
  const appId = process.env.SQUARE_APP_ID ?? "";
  const locationId = process.env.SQUARE_LOCATION_ID ?? "";
  const callbackUrl = process.env.SQUARE_CALLBACK_URL ?? "";
  assert(process.env.SQUARE_ENABLED === "true", 503, "SQUARE_DISABLED", "Square決済は無効です");
  assert(appId.startsWith("sq0idp-") && locationId && process.env.SQUARE_ACCESS_TOKEN, 503,
    "SQUARE_CONFIG", "Square本番設定（Application ID・Location ID・Access token）を確認してください");
  let callback: URL;
  try { callback = new URL(callbackUrl); } catch { throw new AppError(503, "SQUARE_CONFIG", "SquareコールバックURLを確認してください"); }
  assert(callback.protocol === "https:" && callback.pathname === "/api/square/callback" && !callback.search && !callback.hash,
    503, "SQUARE_CONFIG", "SquareコールバックURLを確認してください");
  assert(!origin || callback.origin === origin, 409, "SQUARE_ORIGIN", "Square決済は登録済みの本番URLから利用してください");
  assert(!process.env.VERCEL_ENV || process.env.VERCEL_ENV === "production", 503, "SQUARE_DEPLOYMENT", "プレビュー・開発環境ではSquare本番決済を開始できません");
  assert(process.env.SQUARE_WEBHOOK_SIGNING_KEY && process.env.SQUARE_WEBHOOK_URL === `${callback.origin}/api/square/webhook`,
    503, "SQUARE_CONFIG", "Squareのサーバー通知設定（Webhook URL・署名キー）を確認してください");
  return { appId, locationId, callbackUrl };
}

export function createSquareAppSwitchRequest(params: {
  orderId: string; orderNo: number; amountJpy: number; callbackUrl: string;
  appId: string; locationId: string; state: string; note?: string;
}) {
  assert(Number.isSafeInteger(params.amountJpy) && params.amountJpy > 0, 400, "SQUARE_AMOUNT", "Square決済金額は1円以上が必要です");
  return {
    deepLink: `square-commerce-v1://payment/create?data=${encodeURIComponent(JSON.stringify({
      version: "1.3",
      amount_money: { amount: params.amountJpy, currency_code: "JPY" },
      options: { supported_tender_types: ["CREDIT_CARD"], auto_return: true, clear_default_fees: true },
      client_id: params.appId,
      location_id: params.locationId,
      state: params.state,
      notes: params.note ?? `筑駒文化祭喫茶 注文#${params.orderNo} [KISSa:${params.orderId}]`,
      callback_url: params.callbackUrl,
    }))}`,
  };
}

const callbackSchema = z.object({
  state: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["ok", "error"]),
  transaction_id: z.string().min(1).max(192).optional(),
  client_transaction_id: z.string().min(1).max(192).optional(),
  error_code: z.string().min(1).max(100).optional(),
});
export function parseSquareCallback(url: URL) {
  const all = url.searchParams.getAll("data");
  assert(all.length === 1 && all[0].length <= 4096, 400, "SQUARE_CALLBACK", "Square応答の形式が不正です");
  let parsed: unknown;
  try { parsed = JSON.parse(all[0]); } catch { throw new AppError(400, "SQUARE_CALLBACK", "Square応答の形式が不正です"); }
  const result = callbackSchema.safeParse(parsed);
  assert(result.success, 400, "SQUARE_CALLBACK", "Square応答の形式が不正です");
  const value = result.data;
  assert(value.status !== "ok" || (!value.error_code && (value.transaction_id || value.client_transaction_id)),
    400, "SQUARE_CALLBACK", "Square決済結果を確認できません");
  assert(value.status !== "error" || (Boolean(value.error_code) && !value.transaction_id && !value.client_transaction_id), 400, "SQUARE_CALLBACK", "Squareエラー情報が不正です");
  return value;
}
export type SquareCallback = ReturnType<typeof parseSquareCallback>;
