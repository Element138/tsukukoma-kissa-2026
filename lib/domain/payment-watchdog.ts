import { Prisma, PrismaClient } from "@prisma/client";
import { now } from "@/lib/time";
import { writeAuditLog } from "@/lib/domain/audit";
import { appendOrderEvent } from "@/lib/domain/orders";
import { broadcastInvalidation, CHANNEL_GROUPS } from "@/lib/server/realtime-broadcast";

type DbClient = PrismaClient | Prisma.TransactionClient;
const PAYMENT_WATCHDOG_LOCK_KEY = 809_941_253;

export async function runPaymentWatchdog(db: DbClient) {
  const lock = await db.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT pg_try_advisory_xact_lock(${PAYMENT_WATCHDOG_LOCK_KEY}) AS acquired
  `;
  if (!lock[0]?.acquired) return { paymentFailed: 0, cleanedAwaiting: 0 };
  const overdue = await db.order.findMany({ where: {
    paymentMethod: "SQUARE", paymentStatus: "AWAITING", confirmedAt: null,
    paymentAwaitDeadlineAt: { lte: now() },
  }, select: { id: true, orderNo: true, createdByActorId: true } });
  for (const order of overdue) {
    // Time passing says nothing about whether a customer's card was charged.
    await db.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
    const changed = await db.order.updateMany({ where: {
      id: order.id, paymentStatus: "AWAITING", paymentAwaitDeadlineAt: { lte: now() },
    }, data: { paymentAwaitDeadlineAt: null } });
    if (!changed.count) continue;
    await appendOrderEvent(db, order.id, { type: "PAYMENT_RECONCILIATION_REQUIRED", at: now().toISOString() });
    await db.paymentIncident.create({ data: {
      orderId: order.id, incidentType: "SQUARE_RESULT_MISSING",
      messageJa: `注文 #${order.orderNo} の決済結果が未確認です。Squareの取引履歴と照合してください。再決済・現金での取り直しは行わないでください。`,
      detailsJson: { responsiblePosActorId: order.createdByActorId },
    } });
    await writeAuditLog(db, { actionType: "PAYMENT_RECONCILIATION_REQUIRED", entityType: "order",
      entityId: order.id, orderId: order.id, result: "SUCCESS" });
  }
  if (overdue.length) await broadcastInvalidation(db, CHANNEL_GROUPS.ORDER_FLOW, "orders", "payment_watchdog");
  return { paymentFailed: 0, cleanedAwaiting: 0 };
}
