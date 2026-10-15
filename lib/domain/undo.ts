import { ActorType, Prisma, PrismaClient } from "@prisma/client";
import { AppError, assert } from "@/lib/errors";
import { recalcAndPersistOrderStatus } from "@/lib/domain/orders";
import { now } from "@/lib/time";
import { writeAuditLog } from "@/lib/domain/audit";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type UndoPayload = Record<string, unknown>;

export async function saveUndoOperation(
  db: DbClient,
  params: {
    actorId: string;
    operationType: "ITEM_READY" | "ITEM_READY_BATCH" | "ITEM_SERVED" | "TAKEOUT_ORDER_SERVED";
    targetEntityType: string;
    targetEntityId: string;
    orderId: string | null;
    expectedOrderVersion: number;
    payload: UndoPayload;
  }
) {
  await db.undoOperation.create({
    data: {
      actorId: params.actorId,
      operationType: params.operationType,
      targetEntityType: params.targetEntityType,
      targetEntityId: params.targetEntityId,
      orderId: params.orderId,
      expectedOrderVersion: params.expectedOrderVersion,
      payload: params.payload as Prisma.InputJsonValue,
      createdAt: now()
    }
  });

  const stale = await db.undoOperation.findMany({
    where: { actorId: params.actorId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: 3,
    select: { id: true }
  });

  if (stale.length > 0) {
    await db.undoOperation.deleteMany({
      where: {
        id: {
          in: stale.map((row) => row.id)
        }
      }
    });
  }
}

export async function executeUndo(db: DbClient, params: { actorId: string; actorType: ActorType }) {
  assert(params.actorType === "KITCHEN" || params.actorType === "WAITER", 403, "FORBIDDEN", "Undo forbidden");
  await db.$queryRaw`SELECT id FROM "Actor" WHERE id = ${params.actorId} FOR NO KEY UPDATE`;
  const undo = await db.undoOperation.findFirst({ where: { actorId: params.actorId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  assert(undo, 404, "UNDO_NOT_FOUND", "Undo not found");
  const payload = undo.payload as Record<string, unknown>;
  const menuId = payload.menuId;
  assert(typeof menuId === "string", 409, "UNDO_TARGET_CHANGED", "取り消し対象が旧仕様です");
  await db.$queryRaw`SELECT id FROM "Menu" WHERE id = ${menuId} FOR UPDATE`;
  let count = 1;
  let orderId: string | null = null;
  if (undo.operationType === "ITEM_READY_BATCH" && undo.targetEntityType === "menu_stock") {
    assert(params.actorType === "KITCHEN", 403, "FORBIDDEN", "Undo forbidden");
    count = Number(payload.quantity);
    assert(Number.isSafeInteger(count) && count > 0 && typeof payload.jstDate === "string", 409, "UNDO_TARGET_CHANGED", "Undo invalid");
    const stock = await db.menuStock.updateMany({ where: { menuId, readyCount: { gte: count } }, data: { readyCount: { decrement: count } } });
    assert(stock.count === 1, 409, "UNDO_CONFLICT", "調理済み在庫が提供されたため取り消せません");
    await db.menuDailyCount.update({ where: { menuId_jstDate: { menuId, jstDate: payload.jstDate } }, data: { cookedCount: { decrement: count } } });
  } else if (undo.operationType === "ITEM_SERVED" && payload.sharedStock) {
    assert(params.actorType === "WAITER", 403, "FORBIDDEN", "Undo forbidden");
    assert(undo.orderId, 409, "UNDO_TARGET_CHANGED", "Undo order missing");
    await db.$queryRaw`SELECT id FROM "Order" WHERE id = ${undo.orderId} FOR UPDATE`;
    const order = await db.order.findUnique({ where: { id: undo.orderId } });
    assert(order && !["FAILED", "CANCELED"].includes(order.orderStatus), 409, "UNDO_CONFLICT", "Undo conflict");
    const changed = await db.orderItem.updateMany({ where: { id: undo.targetEntityId, status: "SERVED", servedByActorId: params.actorId, servedAt: typeof payload.servedAt === "string" ? new Date(payload.servedAt) : undefined }, data: { status: "QUEUED", readyAt: null, servedAt: null, servedByActorId: null } });
    assert(changed.count === 1, 409, "UNDO_CONFLICT", "Undo conflict");
    await db.menuStock.upsert({ where: { menuId }, create: { menuId, readyCount: 1 }, update: { readyCount: { increment: 1 } } });
    await recalcAndPersistOrderStatus(db, undo.orderId, true);
    orderId = undo.orderId;
  } else { throw new AppError(409, "UNDO_UNSUPPORTED", "旧仕様の操作は取り消せません"); }
  await db.undoOperation.delete({ where: { id: undo.id } });
  await writeAuditLog(db, { actorId: params.actorId, actorType: params.actorType, actionType: "UNDO", entityType: "undo_operation", entityId: undo.id, orderId, afterJson: { revertedItemCount: count, menuId }, result: "SUCCESS" });
  return { operationType: undo.operationType, revertedItemCount: count, affectedOrders: [] };
}
