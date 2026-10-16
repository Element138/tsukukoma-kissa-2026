import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseSquareCallback } from "@/lib/domain/square";
import { assert } from "@/lib/errors";
import { squareBrowserFailure } from "@/lib/server/square-browser";
import { reconcileSquarePayment, recordSquareTransaction } from "@/lib/domain/square-payments";
import { confirmOrderPayment } from "@/lib/domain/orders";
import { broadcastInvalidation, CHANNEL_GROUPS } from "@/lib/server/realtime-broadcast";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const payload = parseSquareCallback(req.nextUrl);
    const attempt = await prisma.squarePaymentAttempt.findUnique({ where: { stateToken: payload.state } });
    assert(attempt && attempt.launchedAt, 400, "SQUARE_CALLBACK", "対応するSquare決済が見つかりません");
    assert(new URL(attempt.callbackUrl).origin === req.nextUrl.origin, 400, "SQUARE_CALLBACK", "決済の戻り先が一致しません");
    const accepted = payload.transaction_id ? await recordSquareTransaction(prisma, attempt.orderId, payload.transaction_id) : true;
    if (accepted) {
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${attempt.orderId} FOR UPDATE`;
        const current = await tx.squarePaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
        if (current.resolvedAt && (current.transactionId || payload.status !== "ok")) return;
        // A callback can be replayed, but must never replace a recorded successful transaction.
        assert(!current.transactionId || !payload.transaction_id || current.transactionId === payload.transaction_id,
          409, "SQUARE_CONFLICT", "異なる決済結果を受信しました。管理者が取引履歴を確認してください");
        if (current.transactionId && payload.status === "error") return;
        if (payload.status === "error" && payload.error_code === "payment_canceled") {
          const order = await tx.order.findUniqueOrThrow({ where: { id: attempt.orderId } });
          if (order.paymentStatus === "AWAITING") {
            await confirmOrderPayment(tx, { actorId: null, actorType: null, orderId: order.id, result: "FAILED",
              reasonType: "SQUARE_PAYMENT_CANCELED", reasonText: "Squareアプリで決済がキャンセルされました" });
            await tx.squarePaymentAttempt.update({ where: { id: current.id }, data: { resolvedAt: new Date(), lastError: "Squareアプリで決済がキャンセルされました" } });
            await tx.paymentIncident.updateMany({ where: { orderId: order.id, incidentType: "SQUARE_RESULT_MISSING", dismissedAt: null }, data: { dismissedAt: new Date() } });
            await broadcastInvalidation(tx, CHANNEL_GROUPS.ORDER_FLOW, "orders", "square_canceled");
          }
          return;
        }
        const { state: _secret, ...result } = payload;
        await tx.squarePaymentAttempt.update({ where: { id: current.id }, data: {
          callbackJson: result,
          transactionId: payload.transaction_id ?? current.transactionId,
          ...(payload.status === "ok" && payload.transaction_id && !current.transactionId ? { resolvedAt: null } : {}),
          lastError: payload.status === "error" ? `Square: ${payload.error_code}。取引履歴との照合が必要です。`
            : payload.transaction_id ? "Squareサーバーとの照合待ちです。再決済しないでください。"
              : "Squareのサーバー取引IDが未確定です。オフライン取引・通信状態を確認してください。再決済しないでください。",
        } });
      });
      if (payload.status === "ok" && payload.transaction_id) {
        await reconcileSquarePayment(prisma, attempt.orderId);
      }
    }
    // This is a browser return, not a webhook. Restore checkout even after app reload.
    const target = new URL("/pos", req.nextUrl.origin);
    target.searchParams.set("squareOrder", attempt.orderId);
    const response = NextResponse.redirect(target, 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch { return squareBrowserFailure(); }
}
export async function POST() {
  return NextResponse.json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Square POSのブラウザー戻り先を利用してください" } }, { status: 405 });
}
