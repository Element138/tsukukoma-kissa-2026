import { ActorType, Prisma, PrismaClient } from "@prisma/client";
import { AppError, assert } from "@/lib/errors";
import { deriveOrderStatus } from "@/lib/domain/order-status";
import { now } from "@/lib/time";
import { writeAuditLog } from "@/lib/domain/audit";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type UndoPayload = Record<string, unknown>;

export async function saveUndoOperation(
  db: DbClient,
  params: {
    actorId: string;
    operationType: "ITEM_READY" | "ITEM_SERVED" | "TAKEOUT_ORDER_SERVED";
    targetEntityType: string;
    targetEntityId: string;
    orderId: string;
    expectedOrderVersion: number;
    payload: UndoPayload;
  }
) {
  await db.undoOperation.upsert({
    where: { actorId: params.actorId },
    create: {
      actorId: params.actorId,
      operationType: params.operationType,
      targetEntityType: params.targetEntityType,
      targetEntityId: params.targetEntityId,
      orderId: params.orderId,
      expectedOrderVersion: params.expectedOrderVersion,
      payload: params.payload as Prisma.InputJsonValue
    },
    update: {
      operationType: params.operationType,
      targetEntityType: params.targetEntityType,
      targetEntityId: params.targetEntityId,
      orderId: params.orderId,
      expectedOrderVersion: params.expectedOrderVersion,
      payload: params.payload as Prisma.InputJsonValue,
      createdAt: now()
    }
  });
}

export async function executeUndo(db: DbClient, params: { actorId: string; actorType: ActorType }) {
  assert(
    params.actorType === "KITCHEN" || params.actorType === "WAITER",
    403,
    "FORBIDDEN",
    "Undo is allowed only for Kitchen and Waiter"
  );

  const undo = await db.undoOperation.findUnique({
    where: { actorId: params.actorId }
  });

  assert(undo, 404, "UNDO_NOT_FOUND", "No undo target available");

  const order = await db.order.findUnique({
    where: { id: undo.orderId },
    include: {
      items: {
        select: {
          id: true,
          status: true
        }
      }
    }
  });

  assert(order, 404, "ORDER_NOT_FOUND", "Order not found");
  assert(
    order.lastMutationVersion === undo.expectedOrderVersion,
    409,
    "UNDO_CONFLICT",
    "Undo failed because order was updated by another action"
  );

  if (undo.operationType === "ITEM_READY") {
    const changed = await db.orderItem.updateMany({
      where: { id: undo.targetEntityId, status: "READY" },
      data: {
        status: "QUEUED",
        readyAt: null
      }
    });
    if (changed.count !== 1) {
      throw new AppError(409, "UNDO_TARGET_CHANGED", "Undo target item was changed");
    }
  } else if (undo.operationType === "ITEM_SERVED") {
    const changed = await db.orderItem.updateMany({
      where: { id: undo.targetEntityId, status: "SERVED" },
      data: {
        status: "READY",
        servedAt: null,
        servedByActorId: null
      }
    });
    if (changed.count !== 1) {
      throw new AppError(409, "UNDO_TARGET_CHANGED", "Undo target item was changed");
    }
  } else if (undo.operationType === "TAKEOUT_ORDER_SERVED") {
    const itemIds = Array.isArray((undo.payload as Record<string, unknown>).itemIds)
      ? (((undo.payload as Record<string, unknown>).itemIds as string[]) ?? [])
      : [];

    if (itemIds.length > 0) {
      await db.orderItem.updateMany({
        where: {
          id: { in: itemIds },
          status: "SERVED"
        },
        data: {
          status: "READY",
          servedAt: null,
          servedByActorId: null
        }
      });
    }
  } else {
    throw new AppError(400, "UNDO_UNSUPPORTED", `Unsupported undo operation: ${undo.operationType}`);
  }

  const itemsAfter = await db.orderItem.findMany({
    where: { orderId: order.id },
    select: { status: true }
  });

  const nextStatus = deriveOrderStatus({
    paymentStatus: order.paymentStatus,
    fulfillmentType: order.fulfillmentType,
    items: itemsAfter,
    canceledAt: order.canceledAt,
    confirmedAt: order.confirmedAt
  });

  const updatedOrder = await db.order.update({
    where: { id: order.id },
    data: {
      orderStatus: nextStatus,
      lastMutationVersion: {
        increment: 1
      }
    },
    select: {
      id: true,
      orderNo: true,
      lastMutationVersion: true,
      orderStatus: true
    }
  });

  await db.undoOperation.delete({ where: { actorId: params.actorId } });

  await writeAuditLog(db, {
    actorId: params.actorId,
    actorType: params.actorType,
    actionType: "UNDO",
    entityType: "order",
    entityId: order.id,
    orderId: order.id,
    beforeJson: {
      operationType: undo.operationType,
      targetEntityType: undo.targetEntityType,
      targetEntityId: undo.targetEntityId
    },
    afterJson: {
      orderStatus: updatedOrder.orderStatus,
      orderVersion: updatedOrder.lastMutationVersion
    },
    result: "SUCCESS"
  });

  return updatedOrder;
}


