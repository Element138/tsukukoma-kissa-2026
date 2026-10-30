import { Prisma } from "@prisma/client";
import { assert } from "@/lib/errors";
import { writeAuditLog } from "@/lib/domain/audit";

export async function updateOrderCall(db: Prisma.TransactionClient, params: {
  actorId: string;
  orderId: string;
  action: "call" | "cancel";
  idempotencyKey: string;
}) {
  // Serialize calls and cancellations with the display cursor and item service.
  await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(61015001)`;
  await db.$queryRaw`SELECT id FROM "Order" WHERE id = ${params.orderId} FOR UPDATE`;
  const order = await db.order.findUnique({ where: { id: params.orderId } });
  assert(order?.confirmedAt && !["FAILED", "CANCELED"].includes(order.orderStatus), 409, "ORDER_FAILED", "呼び出しできないオーダーです");
  assert(!order.ghostedAt, 409, "ORDER_GHOSTED", "不在注文は呼び出せません");
  const duplicate = await db.auditLog.findFirst({ where: {
    actorId: params.actorId,
    actionType: { in: ["ORDER_CALLED", "ORDER_CALL_CANCELED"] },
    correlationId: params.idempotencyKey,
    result: "SUCCESS",
  } });
  if (duplicate) return duplicate.afterJson;
  assert(params.action === "cancel" || order.orderStatus !== "COMPLETED", 409, "ORDER_ALREADY_SERVED", "全て提供済みのオーダーは呼び出せません");

  // Keep the actual call history when clearing the active customer display.
  const call = params.action === "call"
    ? await db.orderCall.create({ data: { orderId: order.id } })
    : null;
  const lastCalledAt = call?.calledAt ?? null;
  await db.order.update({ where: { id: order.id }, data: { lastCalledAt } });
  const result = { callId: call?.id ?? null, called: call !== null };
  await writeAuditLog(db, {
    actorId: params.actorId, actorType: "WAITER",
    actionType: params.action === "call" ? "ORDER_CALLED" : "ORDER_CALL_CANCELED",
    entityType: "order", entityId: order.id, orderId: order.id,
    correlationId: params.idempotencyKey, afterJson: result, result: "SUCCESS",
  });
  return result;
}
