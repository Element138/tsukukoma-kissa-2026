import { PrismaClient, Prisma } from "@prisma/client";
import { AppError, assert } from "@/lib/errors";
import { verifySquareTransaction } from "@/lib/domain/square-verification";
import { appendOrderEvent, confirmOrderPayment } from "@/lib/domain/orders";
import { writeAuditLog } from "@/lib/domain/audit";
import { broadcastInvalidation, CHANNEL_GROUPS, kitchenChannel } from "@/lib/server/realtime-broadcast";
import { openLateSuccessIncident } from "@/lib/domain/payment-incidents";
import { deriveOrderProcessingTrace } from "@/lib/domain/order-processing-trace";

// Claim briefly in a transaction; never hold a DB connection open during Square I/O.
export async function reconcileSquarePayment(db: PrismaClient, orderId: string, options: {
  manual?: boolean; actorId?: string; reason?: string;
} = {}) {
  const claim = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const attempt = await tx.squarePaymentAttempt.findUnique({ where: { orderId }, include: { order: true } });
    if (!attempt?.transactionId || !attempt.launchedAt || attempt.resolvedAt) return null;
    if (attempt.verifyAfter && attempt.verifyAfter > new Date()) return null;
    if (!options.manual && attempt.verifyAttempts >= 3) return null;
    await tx.squarePaymentAttempt.update({ where: { id: attempt.id }, data: {
      verifyAttempts: { increment: 1 }, verifyAfter: new Date(Date.now() + 30_000),
    } });
    return attempt;
  });
  if (!claim) return { verified: false, deferred: true };
  try {
    const verified = await verifySquareTransaction(claim.transactionId!, {
      orderId, amountJpy: claim.order.totalPriceJpy, locationId: claim.locationId, launchedAt: claim.launchedAt!,
      allowUnmarked: Boolean(options.manual && options.reason && options.reason.trim().length >= 10),
    });
    return await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
      const attempt = await tx.squarePaymentAttempt.findUniqueOrThrow({ where: { orderId }, include: { order: true } });
      if (attempt.resolvedAt) return { verified: attempt.order.paymentStatus === "PAID", alreadyProcessed: true };
      assert(attempt.transactionId === claim.transactionId, 409, "SQUARE_CONFLICT", "決済照合中に取引IDが変更されました");
      const order = attempt.order;
      if (order.paymentStatus === "FAILED" || order.canceledAt) {
        const trace = deriveOrderProcessingTrace({ createdAt: order.createdAt, events: order.events });
        await openLateSuccessIncident(tx, { orderId, orderNo: order.orderNo, responsiblePosActorId: order.createdByActorId,
          squareTransactionId: attempt.transactionId, orderCreatedAt: order.createdAt, failedAt: trace.failedAt,
          failureReasonType: trace.failureReasonType, failureReasonText: trace.failureReasonText, successCallbackAt: new Date() });
        await tx.squarePaymentAttempt.update({ where: { id: attempt.id }, data: { resolvedAt: new Date(),
          lastError: "未決済として終了した注文に入金が見つかりました。管理者が重複注文・返金の必要性を確認してください。" } });
        await broadcastInvalidation(tx, CHANNEL_GROUPS.ORDER_FLOW, "orders", "payment_incident");
        return { verified: true, lateSuccess: true };
      }
      assert(order.paymentMethod === "SQUARE" && order.paymentStatus === "AWAITING" && !order.confirmedAt,
        409, "SQUARE_CONFLICT", "注文の決済状態が一致しません");
      const confirmed = await confirmOrderPayment(tx, { actorId: null, actorType: null,
        orderId, result: "SUCCESS", squareTransactionId: attempt.transactionId! });
      await tx.squarePaymentAttempt.update({ where: { id: attempt.id }, data: { resolvedAt: new Date(), lastError: null } });
      await tx.paymentIncident.updateMany({ where: { orderId, incidentType: "SQUARE_RESULT_MISSING", dismissedAt: null },
        data: { dismissedAt: new Date() } });
      await writeAuditLog(tx, { actorId: options.actorId ?? null, actorType: options.actorId ? "ADMIN" : null,
        actionType: "SQUARE_SERVER_VERIFIED", entityType: "order", entityId: orderId, orderId,
        afterJson: { paymentId: verified.paymentId, transactionId: attempt.transactionId }, reasonText: options.reason, result: "SUCCESS" });
      const channels = confirmed.items.map(item => item.kitchenId).filter((id): id is string => Boolean(id)).map(kitchenChannel);
      await broadcastInvalidation(tx, [...CHANNEL_GROUPS.ORDER_FLOW, ...channels], "orders", "square_verified");
      return { verified: true };
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "決済照合に失敗しました。再決済せず、管理者に確認してください。";
    await db.squarePaymentAttempt.updateMany({ where: { id: claim.id, resolvedAt: null }, data: { lastError: message } });
    if (!(error instanceof AppError)) console.error("Square reconciliation failed", { orderId, error: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "internal" });
    return { verified: false, error: message };
  }
}

export async function recordSquareTransaction(db: PrismaClient, orderId: string, transactionId: string) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const attempt = await tx.squarePaymentAttempt.findUnique({ where: { orderId } });
    assert(attempt?.launchedAt, 409, "SQUARE_CONFLICT", "Square決済の開始記録がありません");
    const reused = await tx.order.findFirst({ where: { squareTransactionId: transactionId, id: { not: orderId } }, select: { id: true } });
    if (reused || (attempt.transactionId && attempt.transactionId !== transactionId)) {
      const existing = await tx.paymentIncident.findFirst({ where: { orderId, incidentType: "SQUARE_RESULT_MISSING", dismissedAt: null } });
      if (!existing) await tx.paymentIncident.create({ data: { orderId, incidentType: "SQUARE_RESULT_MISSING",
        messageJa: "同じ注文に異なるSquare取引、または別の注文に使用済みの取引が届きました。重複請求・取引の対応を管理者が確認してください。",
        detailsJson: { transactionId, previousTransactionId: attempt.transactionId, reusedOrderId: reused?.id ?? null },
      } });
      await broadcastInvalidation(tx, CHANNEL_GROUPS.ORDER_FLOW, "orders", "square_transaction_conflict");
      return false;
    }
    await tx.squarePaymentAttempt.update({ where: { id: attempt.id }, data: {
      transactionId, ...(!attempt.transactionId ? { resolvedAt: null } : {}),
    } });
    return true;
  });
}
