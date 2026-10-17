import { Prisma, PrismaClient } from "@prisma/client";
import { assert, AppError } from "@/lib/errors";
import { recalcAndPersistOrderStatus } from "@/lib/domain/orders";
import { saveUndoOperation } from "@/lib/domain/undo";
import { writeAuditLog } from "@/lib/domain/audit";
import { counterServingPlan, partialServingMessage, projectCounterItems } from "@/lib/domain/counter-availability";
import { resetExpiredReadyStock } from "@/lib/domain/daily-ready-stock";
type DbClient = PrismaClient | Prisma.TransactionClient;

export async function serveDineInItem(db: DbClient, params: { actorId: string; orderItemId: string; confirmUncalled?: boolean }, options: { saveUndo?: boolean; servedAt?: Date } = {}) {
  const initial = await db.orderItem.findUnique({ where: { id: params.orderItemId } });
  assert(initial, 404, "ITEM_NOT_FOUND", "Item not found");
  await db.$queryRaw`SELECT id FROM "Menu" WHERE id = ${initial.menuId} FOR UPDATE`;
  await db.$queryRaw`SELECT id FROM "Order" WHERE id = ${initial.orderId} FOR UPDATE`;
  await resetExpiredReadyStock(db, [initial.menuId]);
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
  const servedAt = options.servedAt ?? new Date();
  await db.orderItem.update({ where: { id: item.id }, data: { status: "SERVED", servedAt, servedByActorId: params.actorId } });
  const updated = await recalcAndPersistOrderStatus(db, item.orderId, true);
  if (options.saveUndo !== false) await saveUndoOperation(db, { actorId: params.actorId, operationType: "ITEM_SERVED", targetEntityType: "order_item", targetEntityId: item.id, orderId: item.orderId, expectedOrderVersion: updated.lastMutationVersion, payload: { menuId: item.menuId, sharedStock: true, servedAt: servedAt.toISOString() } });
  await writeAuditLog(db, { actorId: params.actorId, actorType: "WAITER", actionType: "ITEM_SERVED", entityType: "order_item", entityId: item.id, orderId: item.orderId, afterJson: { status: "SERVED", servedAt: servedAt.toISOString() }, result: "SUCCESS" });
  return updated;
}

type BulkServeInput = {
  actorId: string; orderId: string; idempotencyKey: string; expectedItemIds: string[];
  expectedPlan: Array<{ menuId: string; waitingCount: number; servableCount: number }>;
  confirmPartial?: boolean; confirmUncalled?: boolean;
};
export async function serveCounterOrder(db: DbClient, params: BulkServeInput) {
  await db.$queryRaw`SELECT id FROM "Actor" WHERE id = ${params.actorId} FOR NO KEY UPDATE`;
  const signature = { items: [...params.expectedItemIds].sort(), plan: [...params.expectedPlan].sort((a,b)=>a.menuId.localeCompare(b.menuId)) };
  const requestSignature = JSON.stringify([signature.items, signature.plan.map(group=>[group.menuId,group.waitingCount,group.servableCount])]);
  const duplicate = await db.auditLog.findFirst({ where: { actorId: params.actorId, actionType: "COUNTER_ORDER_SERVED", correlationId: params.idempotencyKey, result: "SUCCESS" } });
  if (duplicate) {
    assert(duplicate.orderId === params.orderId && (duplicate.beforeJson as {requestSignature?: string})?.requestSignature === requestSignature, 409, "IDEMPOTENCY_CONFLICT", "再送された提供操作の内容が一致しません");
    return { ...(duplicate.afterJson as { orderId: string; servedItemCount: number; partial: boolean }), alreadyProcessed: true };
  }
  const initial = await db.orderItem.findMany({ where: { orderId: params.orderId, status: "QUEUED" }, orderBy: { id: "asc" } });
  const menuIds = [...new Set(initial.map(item=>item.menuId))].sort();
  for (const menuId of menuIds) await db.$queryRaw`SELECT id FROM "Menu" WHERE id = ${menuId} FOR UPDATE`;
  await db.$queryRaw`SELECT id FROM "Order" WHERE id = ${params.orderId} FOR UPDATE`;
  await resetExpiredReadyStock(db, menuIds);
  const order = await db.order.findUnique({ where: { id: params.orderId }, include: { items: { orderBy: { id: "asc" } } } });
  assert(order?.confirmedAt && !["FAILED", "CANCELED", "COMPLETED"].includes(order.orderStatus), 409, "ORDER_FAILED", "提供できないオーダーです");
  assert(order.items.filter(item=>item.status === "QUEUED").every(item=>menuIds.includes(item.menuId)), 409, "STOCK_CHANGED", "注文内容が変わりました。更新後にもう一度確認してください");
  const stock = await db.menuStock.findMany({ where: { menuId: { in: menuIds } } });
  const pool = new Map(stock.map(s=>[s.menuId,s.readyCount]));
  const plan = counterServingPlan(order.items,pool);
  const { readyItems } = projectCounterItems(order.items,pool);
  const current = { items: readyItems.map(item=>item.id).sort(), plan: plan.map(({menuId,waitingCount,servableCount})=>({menuId,waitingCount,servableCount})) };
  assert(requestSignature === JSON.stringify([current.items,current.plan.map(group=>[group.menuId,group.waitingCount,group.servableCount])]), 409, "STOCK_CHANGED", "提供可能な数または注文内容が変わりました。更新後にもう一度確認してください");
  assert(readyItems.length > 1, 409, "STOCK_CHANGED", "まとめて提供できる商品がありません。更新してください");
  const shortage = partialServingMessage(plan);
  assert(!shortage || params.confirmPartial, 409, "PARTIAL_SERVE_CONFIRM_REQUIRED", shortage + "\nよろしいですか？");
  const servedAt = new Date();
  let version = order.lastMutationVersion;
  for (const item of readyItems) {
    const updated = await serveDineInItem(db, { actorId: params.actorId, orderItemId: item.id, confirmUncalled: params.confirmUncalled }, { saveUndo: false, servedAt });
    version = updated.lastMutationVersion;
  }
  const itemMenus = new Map(order.items.map(item=>[item.id,item.menuId]));
  await saveUndoOperation(db, { actorId: params.actorId, operationType: "ITEM_SERVED", targetEntityType: "order_items", targetEntityId: order.id, orderId: order.id, expectedOrderVersion: version,
    payload: { sharedStock: true, batch: true, menuId: menuIds[0], servedAt: servedAt.toISOString(), items: readyItems.map(item=>({ id: item.id, menuId: itemMenus.get(item.id)! })) } });
  const result = { orderId: order.id, servedItemCount: readyItems.length, partial: Boolean(shortage) };
  await writeAuditLog(db, { actorId: params.actorId, actorType: "WAITER", actionType: "COUNTER_ORDER_SERVED", entityType: "order", entityId: order.id, orderId: order.id, correlationId: params.idempotencyKey, beforeJson: {requestSignature}, afterJson: result, result: "SUCCESS" });
  return result;
}
