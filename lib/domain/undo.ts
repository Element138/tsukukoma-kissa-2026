import { ActorType, Prisma, PrismaClient } from "@prisma/client";
import { AppError, assert } from "@/lib/errors";
import { deriveOrderStatus } from "@/lib/domain/order-status";
import { now } from "@/lib/time";
import { writeAuditLog } from "@/lib/domain/audit";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type UndoPayload = Record<string, unknown>;

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((row): row is string => typeof row === "string" && row.length > 0);
}

export async function saveUndoOperation(
  db: DbClient,
  params: {
    actorId: string;
    operationType: "ITEM_READY" | "ITEM_READY_BATCH" | "ITEM_SERVED" | "TAKEOUT_ORDER_SERVED";
    targetEntityType: string;
    targetEntityId: string;
    orderId: string;
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
  assert(
    params.actorType === "KITCHEN" || params.actorType === "WAITER",
    403,
    "FORBIDDEN",
    "Undo is allowed only for Kitchen and Waiter"
  );

  const undo = await db.undoOperation.findFirst({
    where: { actorId: params.actorId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }]
  });

  assert(undo, 404, "UNDO_NOT_FOUND", "No undo target available");

  let targetItemIds: string[] = [];
  let expectedCurrentStatus: "READY" | "SERVED";
  let revertData: Prisma.OrderItemUpdateManyMutationInput;

  if (undo.operationType === "ITEM_READY") {
    targetItemIds = [undo.targetEntityId];
    expectedCurrentStatus = "READY";
    revertData = {
      status: "QUEUED",
      readyAt: null
    };
  } else if (undo.operationType === "ITEM_READY_BATCH") {
    targetItemIds = asStringArray((undo.payload as Record<string, unknown>).itemIds);
    expectedCurrentStatus = "READY";
    revertData = {
      status: "QUEUED",
      readyAt: null
    };
  } else if (undo.operationType === "ITEM_SERVED") {
    targetItemIds = [undo.targetEntityId];
    expectedCurrentStatus = "SERVED";
    revertData = {
      status: "READY",
      servedAt: null
    };
  } else if (undo.operationType === "TAKEOUT_ORDER_SERVED") {
    targetItemIds = asStringArray((undo.payload as Record<string, unknown>).itemIds);
    expectedCurrentStatus = "SERVED";
    revertData = {
      status: "READY",
      servedAt: null
    };
  } else {
    throw new AppError(400, "UNDO_UNSUPPORTED", `Unsupported undo operation: ${undo.operationType}`);
  }

  assert(targetItemIds.length > 0, 409, "UNDO_TARGET_MISSING", "Undo target item list is empty");

  const targetItems = await db.orderItem.findMany({
    where: {
      id: {
        in: targetItemIds
      }
    },
    select: {
      id: true,
      status: true,
      orderId: true
    }
  });

  if (targetItems.length !== targetItemIds.length) {
    throw new AppError(409, "UNDO_TARGET_CHANGED", "Undo target item was changed");
  }

  const orderIds = [...new Set(targetItems.map((item) => item.orderId))];

  for (const itemId of targetItemIds) {
    const changed = await db.orderItem.updateMany({
      where: {
        id: itemId,
        status: expectedCurrentStatus
      },
      data: revertData
    });

    if (changed.count !== 1) {
      throw new AppError(409, "UNDO_CONFLICT", "Undo failed because target item state changed");
    }
  }

  const updatedOrders: Array<{ id: string; orderNo: number; orderStatus: string; orderVersion: number }> = [];

  for (const orderId of orderIds) {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          select: {
            status: true
          }
        }
      }
    });

    assert(order, 404, "ORDER_NOT_FOUND", "Order not found");

    const nextStatus = deriveOrderStatus({
      paymentStatus: order.paymentStatus,
      fulfillmentType: order.fulfillmentType,
      items: order.items,
      canceledAt: order.canceledAt,
      confirmedAt: order.confirmedAt
    });

    const updated = await db.order.update({
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
        orderStatus: true,
        lastMutationVersion: true
      }
    });

    updatedOrders.push({
      id: updated.id,
      orderNo: updated.orderNo,
      orderStatus: updated.orderStatus,
      orderVersion: updated.lastMutationVersion
    });
  }

  await db.undoOperation.delete({ where: { id: undo.id } });

  await writeAuditLog(db, {
    actorId: params.actorId,
    actorType: params.actorType,
    actionType: "UNDO",
    entityType: "undo_operation",
    entityId: undo.id,
    orderId: updatedOrders[0]?.id ?? undo.orderId,
    beforeJson: {
      operationType: undo.operationType,
      targetEntityType: undo.targetEntityType,
      targetEntityId: undo.targetEntityId,
      targetItemCount: targetItemIds.length
    },
    afterJson: {
      revertedItemCount: targetItemIds.length,
      affectedOrderCount: updatedOrders.length,
      orders: updatedOrders
    },
    result: "SUCCESS"
  });

  return {
    operationType: undo.operationType,
    revertedItemCount: targetItemIds.length,
    affectedOrders: updatedOrders
  };
}