import { Prisma, PrismaClient } from "@prisma/client";
import { assert, AppError } from "@/lib/errors";
import { now } from "@/lib/time";
import { recalcAndPersistOrderStatus } from "@/lib/domain/orders";
import { saveUndoOperation } from "@/lib/domain/undo";
import { writeAuditLog } from "@/lib/domain/audit";
import { reassignQueuedItemsFromKitchen, updateMenusAvailabilityByKitchenCoverage } from "@/lib/domain/kitchen-assignment";

type DbClient = PrismaClient | Prisma.TransactionClient;

type ItemReadyBatchResult = {
  menuId: string;
  markedReadyCount: number;
  affectedOrderCount: number;
  itemIds: string[];
  orderIds: string[];
};

function asReadyBatchResult(value: unknown): ItemReadyBatchResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Record<string, unknown>;
  if (typeof row.menuId !== "string") {
    return null;
  }

  return {
    menuId: row.menuId,
    markedReadyCount: typeof row.markedReadyCount === "number" ? row.markedReadyCount : 0,
    affectedOrderCount: typeof row.affectedOrderCount === "number" ? row.affectedOrderCount : 0,
    itemIds: Array.isArray(row.itemIds) ? row.itemIds.filter((x): x is string => typeof x === "string") : [],
    orderIds: Array.isArray(row.orderIds) ? row.orderIds.filter((x): x is string => typeof x === "string") : []
  };
}

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

  const updatedCount = await db.orderItem.updateMany({
    where: {
      id: params.itemId,
      kitchenId: params.kitchenId,
      status: "QUEUED"
    },
    data: {
      status: "READY",
      readyAt: now()
    }
  });

  if (updatedCount.count !== 1) {
    throw new AppError(409, "ITEM_CONFLICT", "Item state changed before ready update");
  }

  const updatedOrder = await recalcAndPersistOrderStatus(db, item.orderId, true);

  await saveUndoOperation(db, {
    actorId: params.actorId,
    operationType: "ITEM_READY",
    targetEntityType: "order_item",
    targetEntityId: params.itemId,
    orderId: item.orderId,
    expectedOrderVersion: updatedOrder.lastMutationVersion,
    payload: {
      itemIds: [params.itemId],
      orderIds: [item.orderId],
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

export async function markKitchenMenuItemsReady(
  db: DbClient,
  params: {
    actorId: string;
    kitchenId: string;
    menuId: string;
    quantity: number;
    idempotencyKey: string;
  }
): Promise<ItemReadyBatchResult> {
  const duplicated = await db.auditLog.findFirst({
    where: {
      actorId: params.actorId,
      actionType: "ITEM_READY_BATCH",
      entityType: "menu",
      entityId: params.menuId,
      correlationId: params.idempotencyKey,
      result: "SUCCESS"
    },
    orderBy: { timestamp: "desc" },
    select: {
      afterJson: true
    }
  });

  const duplicatedResult = asReadyBatchResult(duplicated?.afterJson ?? null);
  if (duplicatedResult) {
    return duplicatedResult;
  }

  const queued = await db.orderItem.findMany({
    where: {
      menuId: params.menuId,
      kitchenId: params.kitchenId,
      status: "QUEUED",
      order: {
        confirmedAt: { not: null },
        orderStatus: { notIn: ["COMPLETED", "CANCELED"] }
      }
    },
    include: {
      order: {
        select: {
          id: true,
          orderNo: true
        }
      }
    },
    orderBy: [{ order: { confirmedAt: "asc" } }, { kitchenAssignedAt: "asc" }, { id: "asc" }]
  });

  if (queued.length === 0) {
    return {
      menuId: params.menuId,
      markedReadyCount: 0,
      affectedOrderCount: 0,
      itemIds: [],
      orderIds: []
    };
  }

  const targets = queued.slice(0, Math.min(params.quantity, queued.length));

  for (const target of targets) {
    const changed = await db.orderItem.updateMany({
      where: {
        id: target.id,
        kitchenId: params.kitchenId,
        menuId: params.menuId,
        status: "QUEUED"
      },
      data: {
        status: "READY",
        readyAt: now()
      }
    });

    if (changed.count !== 1) {
      throw new AppError(409, "ITEM_CONFLICT", "Some items changed before ready update");
    }
  }

  const orderIds = [...new Set(targets.map((item) => item.orderId))];

  const orderVersions = new Map<string, number>();
  for (const orderId of orderIds) {
    const updated = await recalcAndPersistOrderStatus(db, orderId, true);
    orderVersions.set(orderId, updated.lastMutationVersion);
  }

  const result: ItemReadyBatchResult = {
    menuId: params.menuId,
    markedReadyCount: targets.length,
    affectedOrderCount: orderIds.length,
    itemIds: targets.map((target) => target.id),
    orderIds
  };

  await saveUndoOperation(db, {
    actorId: params.actorId,
    operationType: "ITEM_READY_BATCH",
    targetEntityType: "order_item_batch",
    targetEntityId: `${params.menuId}:${params.idempotencyKey}`,
    orderId: orderIds[0] ?? targets[0]!.orderId,
    expectedOrderVersion: orderVersions.get(orderIds[0] ?? targets[0]!.orderId) ?? 0,
    payload: {
      itemIds: result.itemIds,
      orderIds: result.orderIds,
      menuId: params.menuId,
      quantity: targets.length,
      idempotencyKey: params.idempotencyKey,
      from: "QUEUED",
      to: "READY"
    }
  });

  await writeAuditLog(db, {
    actorId: params.actorId,
    actorType: "KITCHEN",
    actionType: "ITEM_READY_BATCH",
    entityType: "menu",
    entityId: params.menuId,
    orderId: orderIds[0] ?? null,
    correlationId: params.idempotencyKey,
    afterJson: result,
    result: "SUCCESS"
  });

  return result;
}

export async function toggleKitchenState(
  db: DbClient,
  params: {
    actorId: string;
    actorType: "KITCHEN" | "ADMIN" | "POS" | "WAITER" | "MENU_DISPLAY";
    kitchenId: string;
    kitchenEnabled: boolean;
  }
) {
  const before = await db.actor.findUnique({
    where: { id: params.kitchenId },
    select: { id: true, actorType: true, kitchenEnabled: true }
  });

  assert(before, 404, "KITCHEN_NOT_FOUND", "Kitchen actor not found");
  if (before.actorType !== "KITCHEN") {
    throw new AppError(400, "NOT_KITCHEN_ACTOR", "Target actor is not a KITCHEN actor");
  }

  const kitchenActor = await db.actor.update({
    where: { id: params.kitchenId },
    data: {
      kitchenEnabled: params.kitchenEnabled
    },
    select: {
      id: true,
      label: true,
      isActive: true,
      kitchenEnabled: true,
      kitchenDisplayOrder: true
    }
  });

  const impacted = await db.menuKitchenAssignment.findMany({
    where: { kitchenId: params.kitchenId, enabled: true },
    select: { menuId: true }
  });

  await updateMenusAvailabilityByKitchenCoverage(
    db,
    [...new Set(impacted.map((x) => x.menuId))]
  );

  await writeAuditLog(db, {
    actorId: params.actorId,
    actorType: params.actorType,
    actionType: "KITCHEN_TOGGLE",
    entityType: "actor",
    entityId: params.kitchenId,
    beforeJson: {
      kitchenEnabled: before.kitchenEnabled
    },
    afterJson: {
      kitchenEnabled: kitchenActor.kitchenEnabled
    },
    result: "SUCCESS"
  });

  return kitchenActor;
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
    entityType: "actor",
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