import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifySquareWebhook } from "@/lib/domain/square-webhook";
import { reconcileSquarePayment, recordSquareTransaction } from "@/lib/domain/square-payments";
import { squareGet } from "@/lib/domain/square-verification";
import { assert } from "@/lib/errors";
import { fail } from "@/lib/response";

export const maxDuration = 30;
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    assert(raw.length <= 100_000, 413, "SQUARE_WEBHOOK", "通知が大きすぎます");
    const notificationUrl = process.env.SQUARE_WEBHOOK_URL;
    assert(notificationUrl && new URL(notificationUrl).origin === req.nextUrl.origin &&
      verifySquareWebhook(raw, req.headers.get("x-square-hmacsha256-signature"), process.env.SQUARE_WEBHOOK_SIGNING_KEY, notificationUrl),
      403, "INVALID_SIGNATURE", "Square通知の署名が不正です");
    const event = JSON.parse(raw);
    if (!["payment.created", "payment.updated"].includes(event.type)) return NextResponse.json({ ok: true });
    const payment = event.data?.object?.payment;
    if (payment?.status !== "COMPLETED" || payment.source_type !== "CARD" || payment.location_id !== process.env.SQUARE_LOCATION_ID ||
      typeof payment.order_id !== "string") return NextResponse.json({ ok: true });
    const transactionId = payment.order_id;
    let attempt = await prisma.squarePaymentAttempt.findUnique({ where: { transactionId } });
    if (!attempt) {
      let note = typeof payment.note === "string" ? payment.note : "";
      if (!note.includes("[KISSa:")) {
        const { order } = await squareGet(`orders/${encodeURIComponent(transactionId)}`);
        note = (order?.line_items ?? []).map((item: { name?: string; note?: string }) => `${item.name ?? ""} ${item.note ?? ""}`).join(" ");
      }
      const orderId = note.match(/\[KISSa:([a-zA-Z0-9_-]{1,128})\]/)?.[1];
      if (!orderId) return NextResponse.json({ ok: true });
      attempt = await prisma.squarePaymentAttempt.findUnique({ where: { orderId } });
      if (!attempt) return NextResponse.json({ ok: true });
    }
    assert(attempt.locationId === payment.location_id && new URL(attempt.callbackUrl).origin === req.nextUrl.origin,
      409, "SQUARE_CONFLICT", "決済通知の店舗または戻り先が一致しません");
    if (!await recordSquareTransaction(prisma, attempt.orderId, transactionId)) return NextResponse.json({ ok: true, conflict: true });
    const result = await reconcileSquarePayment(prisma, attempt.orderId);
    // Square retries transient failures. DB-backed verification limits avoid request storms.
    if ("error" in result) return NextResponse.json({ ok: false }, { status: 503 });
    return NextResponse.json({ ok: true });
  } catch (error) { return fail(error); }
}
