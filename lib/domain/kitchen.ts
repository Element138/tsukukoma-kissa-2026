import { Prisma, PrismaClient } from "@prisma/client";
import { assert } from "@/lib/errors";
import { now } from "@/lib/time";
import { recalcAndPersistOrderStatus } from "@/lib/domain/orders";
import { saveUndoOperation } from "@/lib/domain/undo";
import { writeAuditLog } from "@/lib/domain/audit";
import { reassignQueuedItemsFromKitchen, updateMenusAvailabilityByKitchenCoverage } from "@/lib/domain/kitchen-assignment";

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function markKitchenItemReady(
  db: DbClient,
  params: {
    actorId: string;
    kitchenId: string;
    itemId: string;
  }
) {
  const item = await db.orderItem.findUnique({
    where: { id: params.itemId },
    include: {
      order: {
        select: {
          id: true,
          orderNo: true,
          orderStatus: true,
          lastMutationVersion: true
        }
      }
    }
  });

  assert(item, 404, "ITEM_NOT_FOUND", "Item not found");
  assert(item.status === "QUEUED", 409, "ITEM_NOT_QUEUED", "Only queued item can be marked ready");
  assert(item.kitchenId === params.kitchenId, 403, "KITCHEN_MISMATCH", "Kitchen can operate only own kitchen items");
  assert(item.order.orderStatus !== "CANCELED", 409, "ORDER_CANCELED", "Order canceled");

  await db.orderItem.update({
    where: { id: params.itemId },
    data: {
      status: "READY",
      readyAt: now()
    }
  });

  const updatedOrder = await recalcAndPersistOrderStatus(db, item.orderId, true);

  await saveUndoOperation(db, {
    actorId: params.actorId,
    operationType: "ITEM_READY",
    targetEntityType: "order_item",
    targetEntityId: params.itemId,
    orderId: item.orderId,
    expectedOrderVersion: updatedOrder.lastMutationVersion,
    payload: {
      orderItemId: params.itemId,
      from: "QUEUED",
      to: "READY"
    }
  });

  await writeAuditLog(db, {
    actorId: params.actorId,
    actorType: "KITCHEN",
    actionType: "ITEM_READY",
    entityType: "order_item",
    entityId: params.itemId,
    orderId: item.orderId,
    afterJson: {
      status: "READY",
      orderStatus: updatedOrder.orderStatus,
      orderVersion: updatedOrder.lastMutationVersion
    },
    result: "SUCCESS"
  });

  return {
    orderId: item.orderId,
    orderNo: item.order.orderNo,
    orderStatus: updatedOrder.orderStatus,
    orderVersion: updatedOrder.lastMutationVersion
  };
}

export async function toggleKitchenState(
  db: DbClient,
  params: {
    actorId: string;
    actorType: "KITCHEN" | "ADMIN" | "POS" | "WAITER" | "MENU_DISPLAY";
    kitchenId: string;
    isActive: boolean;
  }
) {
  const before = await db.kitchen.findUnique({ where: { id: params.kitchenId } });
  assert(before, 404, "KITCHEN_NOT_FOUND", "Kitchen not found");

  const kitchen = await db.kitchen.update({
    where: { id: params.kitchenId },
    data: {
      isActive: params.isActive
    }
  });

  await updateMenusAvailabilityByKitchenCoverage(db);

  await writeAuditLog(db, {
    actorId: params.actorId,
    actorType: params.actorType,
    actionType: "KITCHEN_TOGGLE",
    entityType: "kitchen",
    entityId: params.kitchenId,
    beforeJson: {
      isActive: before.isActive
    },
    afterJson: {
      isActive: kitchen.isActive
    },
    result: "SUCCESS"
  });

  return kitchen;
}

export async function reassignQueuedFromDisabledKitchen(
  db: DbClient,
  params: {
    actorId: string;
    actorType: "KITCHEN" | "ADMIN" | "POS" | "WAITER" | "MENU_DISPLAY";
    fromKitchenId: string;
    toKitchenId: string;
  }
) {
  const result = await reassignQueuedItemsFromKitchen(db, {
    fromKitchenId: params.fromKitchenId,
    toKitchenId: params.toKitchenId
  });

  await writeAuditLog(db, {
    actorId: params.actorId,
    actorType: params.actorType,
    actionType: "KITCHEN_FORCE_REASSIGN",
    entityType: "kitchen",
    entityId: params.fromKitchenId,
    afterJson: {
      fromKitchenId: params.fromKitchenId,
      toKitchenId: params.toKitchenId,
      moved: result.moved,
      skipped: result.skipped ?? 0
    },
    result: "SUCCESS"
  });

  return result;
}

export async function updateMenuAvailabilityByKitchen(
  db: DbClient,
  params: {
    actorId: string;
    kitchenId: string;
    menuId: string;
    availability: "AVAILABLE" | "PAUSED" | "SOLD_OUT";
  }
) {
  const assignment = await db.menuKitchenAssignment.findFirst({
    where: {
      menuId: params.menuId,
      kitchenId: params.kitchenId,
      enabled: true
    }
  });
  assert(assignment, 403, "FORBIDDEN", "Kitchen can update only own-kitchen menus");

  const before = await db.menu.findUnique({ where: { id: params.menuId } });
  assert(before, 404, "MENU_NOT_FOUND", "Menu not found");

  const updated = await db.menu.update({
    where: { id: params.menuId },
    data: {
      availability: params.availability
    }
  });

  await writeAuditLog(db, {
    actorId: params.actorId,
    actorType: "KITCHEN",
    actionType: "MENU_AVAILABILITY_UPDATED",
    entityType: "menu",
    entityId: params.menuId,
    beforeJson: {
      availability: before.availability
    },
    afterJson: {
      availability: updated.availability
    },
    result: "SUCCESS"
  });

  return updated;
}



