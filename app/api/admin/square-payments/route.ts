import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { parseJson } from "@/lib/server/http";
import { assert } from "@/lib/errors";
import { fail, ok } from "@/lib/response";
import { confirmOrderPayment } from "@/lib/domain/orders";
import { reconcileSquarePayment, recordSquareTransaction } from "@/lib/domain/square-payments";
import { verifySquareTransaction } from "@/lib/domain/square-verification";
import { writeAuditLog } from "@/lib/domain/audit";
import { broadcastInvalidation, CHANNEL_GROUPS } from "@/lib/server/realtime-broadcast";
import { inspectSquareBeforeClosing } from "@/lib/domain/square-unpaid";

export const maxDuration = 60;
export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["ADMIN"] });
    if (req.nextUrl.searchParams.get("summary") === "1") {
      return ok({ incidentCount: await prisma.paymentIncident.count({ where: { dismissedAt: null } }) },
        { headers: { "Cache-Control": "no-store" } });
    }
    const orders = await prisma.order.findMany({ where: { paymentMethod: "SQUARE", paymentStatus: "AWAITING" },
      orderBy: { createdAt: "asc" }, take: 100, select: {
        id: true, orderNo: true, totalPriceJpy: true, createdAt: true, createdByActorId: true,
        squareAttempt: { select: { launchedAt: true, transactionId: true, verifyAttempts: true, verifyAfter: true, lastError: true } },
      } });
    const [incidentCount, incidents] = await Promise.all([
      prisma.paymentIncident.count({ where: { dismissedAt: null } }),
      prisma.paymentIncident.findMany({ where: { dismissedAt: null }, orderBy: { createdAt: "desc" }, take: 100,
        select: { id: true, orderId: true, messageJa: true, incidentType: true, createdAt: true,
          order: { select: { orderNo: true, paymentStatus: true } } } }),
    ]);
    return ok({ orders, incidentCount, incidents }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
const schema = z.object({ orderId: z.string().min(1).max(128), action: z.enum(["VERIFY", "NO_CHARGE"]),
  transactionId: z.string().min(1).max(192).optional(), reason: z.string().trim().min(1).max(500), attested: z.literal(true) });
export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["ADMIN"] });
    assert(req.headers.get("origin") === req.nextUrl.origin, 403, "FORBIDDEN", "同一サイトから操作してください");
    const body = await parseJson(req, schema);
    const order = await prisma.order.findUnique({ where: { id: body.orderId }, include: { squareAttempt: true } });
    assert(order?.paymentMethod === "SQUARE", 404, "ORDER_NOT_FOUND", "注文が見つかりません");
    const attempt = order.squareAttempt;
    const callbackUrl = attempt?.callbackUrl ?? process.env.SQUARE_CALLBACK_URL;
    assert(callbackUrl && new URL(callbackUrl).origin === req.nextUrl.origin, 403, "FORBIDDEN", "登録済みの本番URLから操作してください");
    if (order.paymentStatus === "PAID") return ok({ verified: true, alreadyProcessed: true, paymentFound: body.action === "NO_CHARGE" });
    assert(attempt, 409, "SQUARE_UNVERIFIED", "開始情報のない旧注文です。Squareの取引履歴を確認し、管理者による個別対応が必要です");
    assert(!attempt.transactionId || !body.transactionId || body.transactionId === attempt.transactionId,
      409, "SQUARE_CONFLICT", "記録済みのSquare注文IDと一致しません");
    let transactionId: string | null | undefined = body.transactionId ?? attempt.transactionId;
    if (attempt?.launchedAt && (body.action === "NO_CHARGE" || !transactionId)) {
      let inspection = await inspectSquareBeforeClosing({ orderId: order.id, locationId: attempt.locationId,
        amountJpy: order.totalPriceJpy, launchedAt: attempt.launchedAt, transactionId });
      if (inspection.kind === "unpaid" && transactionId && !attempt.transactionId) {
        inspection = await inspectSquareBeforeClosing({ orderId: order.id, locationId: attempt.locationId,
          amountJpy: order.totalPriceJpy, launchedAt: attempt.launchedAt });
      }
      if (inspection.kind === "completed") transactionId = inspection.transactionId;
      else {
        transactionId = undefined;
        if (body.action === "VERIFY") return ok({ verified: false, error: "Squareへの入金は見つかりませんでした。元の端末と取引履歴を確認してください。" });
      }
    }
    if (body.action === "VERIFY" || transactionId) {
      assert(attempt?.launchedAt && transactionId, 400, "SQUARE_TRANSACTION_REQUIRED", "Square注文ID（transaction_id）を入力してください");
      // Validate before binding a manually supplied ID, so a typo cannot poison the attempt.
      await verifySquareTransaction(transactionId, { orderId: order.id, amountJpy: order.totalPriceJpy,
        locationId: attempt.locationId, launchedAt: attempt.launchedAt, allowUnmarked: true });
      assert(await recordSquareTransaction(prisma, order.id, transactionId), 409, "SQUARE_CONFLICT", "異なるSquare取引が対応しています。決済異常を確認してください");
      const result = await reconcileSquarePayment(prisma, order.id, { manual: true, actorId: actor.actorId, reason: body.reason });
      return ok({ ...result, paymentFound: body.action === "NO_CHARGE" && result.verified });
    }
    const outcome = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
      const current = await tx.order.findUniqueOrThrow({ where: { id: order.id }, include: { squareAttempt: true } });
      if (current.paymentStatus === "PAID") return { verified: true, paymentFound: true };
      assert(current.paymentStatus === "AWAITING", 409, "SQUARE_CONFLICT", "注文の決済状態が変更されています");
      assert(current.squareAttempt?.transactionId === attempt?.transactionId && current.squareAttempt?.launchedAt?.getTime() === attempt?.launchedAt?.getTime(),
        409, "SQUARE_CONFLICT", "照合中に決済情報が変更されました。もう一度確認してください");
      await confirmOrderPayment(tx, { orderId: order.id, result: "FAILED", actorId: actor.actorId, actorType: actor.actorType,
        reasonType: "ADMIN_NO_CHARGE_VERIFIED", reasonText: body.reason });
      if (current.squareAttempt) await tx.squarePaymentAttempt.update({ where: { id: current.squareAttempt.id }, data: {
        resolvedAt: new Date(), lastError: "管理者が未決済を確認して終了しました。Square側の決済取消・返金を実行したものではありません。",
      } });
      await tx.paymentIncident.updateMany({ where: { orderId: order.id, incidentType: "SQUARE_RESULT_MISSING", dismissedAt: null }, data: { dismissedAt: new Date() } });
      await writeAuditLog(tx, { actorId: actor.actorId, actorType: actor.actorType, actionType: "SQUARE_ADMIN_NO_CHARGE",
        entityType: "order", entityId: order.id, orderId: order.id, reasonText: body.reason, result: "SUCCESS" });
      await broadcastInvalidation(tx, CHANNEL_GROUPS.ORDER_FLOW, "orders", "square_reconciled");
      return { closed: true };
    });
    return ok(outcome);
  } catch (error) { return fail(error); }
}
