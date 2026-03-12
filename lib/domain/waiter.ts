import { Prisma, PrismaClient } from "@prisma/client";
import { assert, AppError } from "@/lib/errors";
import { now } from "@/lib/time";
import { recalcAndPersistOrderStatus } from "@/lib/domain/orders";
import { saveUndoOperation } from "@/lib/domain/undo";
import { writeAuditLog } from "@/lib/domain/audit";

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function serveDineInItem(
  db: DbClient,
  params: {
    actorId: string;
    orderItemId: string;
  }
) {
  const item = await db.orderItem.findUnique({
    where: { id: params.orderItemId },
    include: {
      order: {
        select: {
          id: true,
          orderNo: true,
          fulfillmentType: true,
          orderStatus: true,
          lastMutationVersion: true
        }
      }
    }
  });

  assert(item, 404, "ITEM_NOT_FOUND", "Item not found");
  assert(item.order.fulfillmentType === "DINE_IN", 400, "NOT_DINE_IN", "Item is not dine-in");
  assert(item.status === "READY", 409, "ITEM_NOT_READY", "Only ready item can be served");
  assert(item.order.orderStatus !== "CANCELED", 409, "ORDER_CANCELED", "Order canceled");

  const changed = await db.orderItem.updateMany({
    where: {
      id: params.orderItemId,
      status: "READY"
    },
    data: {
      status: "SERVED",
      servedAt: now(),
      servedByActorId: params.actorId
    }
  });

  if (changed.count !== 1) {
    throw new AppError(409, "ITEM_CONFLICT", "Item state changed before serving");
  }

  const updatedOrder = await recalcAndPersistOrderStatus(db, item.orderId, true);

  await saveUndoOperation(db, {
    actorId: params.actorId,
    operationType: "ITEM_SERVED",
    targetEntityType: "order_item",
    targetEntityId: params.orderItemId,
    orderId: item.orderId,
    expectedOrderVersion: updatedOrder.lastMutationVersion,
    payload: {
      itemIds: [params.orderItemId],
      orderIds: [item.orderId],
      from: "READY",
      to: "SERVED"
    }
  });

  await writeAuditLog(db, {
    actorId: params.actorId,
    actorType: "WAITER",
    actionType: "ITEM_SERVED",
    entityType: "order_item",
    entityId: params.orderItemId,
    orderId: item.orderId,
    afterJson: {
      status: "SERVED",
      orderStatus: updatedOrder.orderStatus,
      orderVersion: updatedOrder.lastMutationVersion
    },
    result: "SUCCESS"
  });

  return updatedOrder;
}

export async function serveTakeoutOrder(
  db: DbClient,
  params: {
    actorId: string;
    orderId: string;
  }
) {
  const order = await db.order.findUnique({
    where: { id: params.orderId },
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
  assert(order.fulfillmentType === "TAKEOUT", 400, "NOT_TAKEOUT", "Order is not takeout");
  assert(order.orderStatus !== "CANCELED", 409, "ORDER_CANCELED", "Order canceled");
  assert(order.items.length > 0, 409, "ORDER_EMPTY", "Order has no items");

  const allReadyOrServed = order.items.every((i) => i.status === "READY" || i.status === "SERVED");
  assert(allReadyOrServed, 409, "ORDER_NOT_READY", "All items must be ready before takeout serving");

  const readyItemIds = order.items.filter((i) => i.status === "READY").map((i) => i.id);

  for (const itemId of readyItemIds) {
    const changed = await db.orderItem.updateMany({
      where: {
        id: itemId,
        status: "READY"
      },
      data: {
        status: "SERVED",
        servedAt: now(),
        servedByActorId: params.actorId
      }
    });

    if (changed.count !== 1) {
      throw new AppError(409, "ITEM_CONFLICT", "Some takeout items changed before serving");
    }
  }

  const updatedOrder = await recalcAndPersistOrderStatus(db, order.id, true);

  await saveUndoOperation(db, {
    actorId: params.actorId,
    operationType: "TAKEOUT_ORDER_SERVED",
    targetEntityType: "order",
    targetEntityId: order.id,
    orderId: order.id,
    expectedOrderVersion: updatedOrder.lastMutationVersion,
    payload: {
      itemIds: readyItemIds,
      orderIds: [order.id],
      from: "READY",
      to: "SERVED"
    }
  });

  await writeAuditLog(db, {
    actorId: params.actorId,
    actorType: "WAITER",
    actionType: "TAKEOUT_SERVED",
    entityType: "order",
    entityId: order.id,
    orderId: order.id,
    afterJson: {
      servedItemCount: readyItemIds.length,
      orderStatus: updatedOrder.orderStatus,
      orderVersion: updatedOrder.lastMutationVersion
    },
    result: "SUCCESS"
  });

  return updatedOrder;
}