import { Prisma } from "@prisma/client";
import { assert } from "@/lib/errors";
import { writeAuditLog } from "./audit";
import { projectCounterItems } from "./counter-availability";
import { resetExpiredReadyStock } from "./daily-ready-stock";

export async function markOrderAbsent(db: Prisma.TransactionClient, params: {
  actorId: string; orderId: string; idempotencyKey: string;
}) {
  // Use the same call lock and Menu -> Order lock order as serving/undo.
  await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(61015001)`;
  const initial = await db.orderItem.findMany({ where: { orderId: params.orderId }, select: { menuId: true } });
  const menuIds = [...new Set(initial.map(item => item.menuId))].sort();
  for (const menuId of menuIds) await db.$queryRaw`SELECT id FROM "Menu" WHERE id = ${menuId} FOR UPDATE`;
  await db.$queryRaw`SELECT id FROM "Order" WHERE id = ${params.orderId} FOR UPDATE`;
  const duplicate = await db.auditLog.findFirst({ where: { actorId: params.actorId, actionType: "ORDER_GHOSTED", correlationId: params.idempotencyKey, result: "SUCCESS" } });
  if (duplicate) {
    assert(duplicate.orderId === params.orderId, 409, "IDEMPOTENCY_CONFLICT", "操作の内容が一致しません");
    return duplicate.afterJson;
  }
  const order = await db.order.findUnique({ where: { id: params.orderId }, include: { items: true } });
  assert(order?.confirmedAt && !["COMPLETED", "PARTIALLY_CANCELED", "FAILED", "CANCELED"].includes(order.orderStatus), 409, "ORDER_FAILED", "不在にできない注文です");
  if (order.ghostedAt) return { orderId: order.id, ghostedAt: order.ghostedAt, alreadyProcessed: true };
  assert(order.items.every(item => menuIds.includes(item.menuId)), 409, "STOCK_CHANGED", "注文内容が変わりました。更新してください");
  await resetExpiredReadyStock(db, menuIds);
  const stock = await db.menuStock.findMany({ where: { menuId: { in: menuIds } } });
  assert(projectCounterItems(order.items, new Map(stock.map(row => [row.menuId, row.readyCount]))).readyItems.length > 0,
    409, "ABSENT_ORDER_NOT_READY", "提供可能な商品がある注文のみ不在にできます");
  const ghostedAt = new Date();
  const changed = await db.orderItem.updateMany({ where: { orderId: order.id, status: { in: ["QUEUED", "READY"] } }, data: { status: "GHOSTED", readyAt: null } });
  await db.order.update({ where: { id: order.id }, data: { ghostedAt, lastCalledAt: null, lastMutationVersion: { increment: 1 } } });
  const result = { orderId: order.id, ghostedAt: ghostedAt.toISOString(), ghostedItemCount: changed.count };
  await writeAuditLog(db, { actorId: params.actorId, actorType: "WAITER", actionType: "ORDER_GHOSTED", entityType: "order", entityId: order.id, orderId: order.id,
    correlationId: params.idempotencyKey, beforeJson: { lastCalledAt: order.lastCalledAt?.toISOString() ?? null }, afterJson: result, result: "SUCCESS" });
  return result;
}
