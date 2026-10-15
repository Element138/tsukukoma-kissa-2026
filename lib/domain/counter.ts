import { Prisma, PrismaClient } from "@prisma/client";
import { assert, AppError } from "@/lib/errors";
import { recalcAndPersistOrderStatus } from "@/lib/domain/orders";
import { saveUndoOperation } from "@/lib/domain/undo";
import { writeAuditLog } from "@/lib/domain/audit";
type DbClient = PrismaClient | Prisma.TransactionClient;

export async function serveDineInItem(db: DbClient, params: { actorId: string; orderItemId: string; confirmUncalled?: boolean }) {
  const initial = await db.orderItem.findUnique({ where: { id: params.orderItemId } });
  assert(initial, 404, "ITEM_NOT_FOUND", "Item not found");
  await db.$queryRaw`SELECT id FROM "Menu" WHERE id = ${initial.menuId} FOR UPDATE`;
  await db.$queryRaw`SELECT id FROM "Order" WHERE id = ${initial.orderId} FOR UPDATE`;
  const item = await db.orderItem.findUniqueOrThrow({ where: { id: params.orderItemId }, include: { order: true } });
  assert(item.status === "QUEUED", 409, "ITEM_CONFLICT", "Item state changed");
  assert(item.order.confirmedAt && !["FAILED", "CANCELED", "COMPLETED"].includes(item.order.orderStatus), 409, "ORDER_FAILED", "Order unavailable");
  const lastServed = await db.orderItem.findFirst({ where: { orderId: item.orderId, status: "SERVED" }, orderBy: { servedAt: "desc" } });
  const lastCallAt = item.order.lastCalledAt ?? (await db.orderCall.findFirst({ where: { orderId: item.orderId }, orderBy: { id: "desc" } }))?.calledAt ?? null;
  const elapsedCall = lastCallAt ? Date.now() - lastCallAt.getTime() : Infinity;
  const elapsedServe = lastServed?.servedAt ? Date.now() - lastServed.servedAt.getTime() : Infinity;
  if (elapsedCall >= 180000 && elapsedServe >= 30000 && !params.confirmUncalled) {
    const reason = lastCallAt ? "最後に呼び出されてから" + Math.floor(elapsedCall / 60000) + "分が経過している" : "一度も呼び出しされていない";
    throw new AppError(409, "SERVE_CONFIRM_REQUIRED", reason + "ようですが、本当にお客様に「" + item.itemNameSnapshot + "」を提供しましたか？");
  }
  const consumed = await db.menuStock.updateMany({ where: { menuId: item.menuId, readyCount: { gt: 0 } }, data: { readyCount: { decrement: 1 } } });
  assert(consumed.count === 1, 409, "STOCK_EMPTY", "提供可能な在庫がなくなりました");
  const servedAt = new Date();
  await db.orderItem.update({ where: { id: item.id }, data: { status: "SERVED", servedAt, servedByActorId: params.actorId } });
  const updated = await recalcAndPersistOrderStatus(db, item.orderId, true);
  await saveUndoOperation(db, { actorId: params.actorId, operationType: "ITEM_SERVED", targetEntityType: "order_item", targetEntityId: item.id, orderId: item.orderId, expectedOrderVersion: updated.lastMutationVersion, payload: { menuId: item.menuId, sharedStock: true, servedAt: servedAt.toISOString() } });
  await writeAuditLog(db, { actorId: params.actorId, actorType: "WAITER", actionType: "ITEM_SERVED", entityType: "order_item", entityId: item.id, orderId: item.orderId, afterJson: { status: "SERVED", servedAt: servedAt.toISOString() }, result: "SUCCESS" });
  return updated;
}
