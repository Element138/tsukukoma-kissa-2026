import { Prisma, PrismaClient } from "@prisma/client";
import { assert, AppError } from "@/lib/errors";
import { tokyoDateKey } from "@/lib/time";
import { saveUndoOperation } from "@/lib/domain/undo";
import { writeAuditLog } from "@/lib/domain/audit";
import { reassignQueuedItemsFromKitchen, updateMenusAvailabilityByKitchenCoverage } from "@/lib/domain/kitchen-assignment";
import { getMenuCapStates } from "@/lib/domain/menu-cap";

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function markKitchenMenuItemsReady(
  db: DbClient,
  params: { actorId: string; kitchenId: string; menuId: string; quantity: number; idempotencyKey: string; confirmOverCap?: boolean }
) {
  // A per-menu lock serializes production, serving, undo and duplicate requests.
  await db.$queryRaw`SELECT id FROM "Menu" WHERE id = ${params.menuId} FOR UPDATE`;
  const assignment = await db.menuKitchenAssignment.findUnique({ where: { menuId_kitchenId: { menuId: params.menuId, kitchenId: params.kitchenId } } });
  assert(assignment?.enabled, 403, "FORBIDDEN", "担当メニューのみ調理完了にできます");
  const duplicate = await db.auditLog.findFirst({ where: { actorId: params.actorId, actionType: "ITEM_READY_BATCH", correlationId: params.idempotencyKey, result: "SUCCESS" } });
  if (duplicate) return duplicate.afterJson as { markedReadyCount: number };
  const menu = await db.menu.findUniqueOrThrow({ where: { id: params.menuId } });
  const jstDate = tokyoDateKey();
  const daily = await db.menuDailyCount.findUnique({ where: { menuId_jstDate: { menuId: params.menuId, jstDate } } });
  const cooked = daily?.cookedCount ?? 0;
  if (menu.dailyOrderCap != null && cooked <= menu.dailyOrderCap && cooked + params.quantity > menu.dailyOrderCap && !params.confirmOverCap) {
    throw new AppError(409, "COOKED_CAP_CONFIRM_REQUIRED", "本日の調理完了数が上限を超えます。調理完了にしますか？");
  }
  await db.menuStock.upsert({ where: { menuId: params.menuId }, create: { menuId: params.menuId, readyCount: params.quantity }, update: { readyCount: { increment: params.quantity } } });
  await db.menuDailyCount.upsert({ where: { menuId_jstDate: { menuId: params.menuId, jstDate } }, create: { menuId: params.menuId, jstDate, cookedCount: params.quantity }, update: { cookedCount: { increment: params.quantity } } });
  await saveUndoOperation(db, { actorId: params.actorId, operationType: "ITEM_READY_BATCH", targetEntityType: "menu_stock", targetEntityId: params.menuId, orderId: null, expectedOrderVersion: 0, payload: { menuId: params.menuId, quantity: params.quantity, jstDate } });
  const result = { menuId: params.menuId, markedReadyCount: params.quantity, affectedOrderCount: 0 };
  await writeAuditLog(db, { actorId: params.actorId, actorType: "KITCHEN", actionType: "ITEM_READY_BATCH", entityType: "menu", entityId: params.menuId, correlationId: params.idempotencyKey, afterJson: result, result: "SUCCESS" });
  return result;
}

export async function toggleKitchenState(
  db: DbClient,
  params: {
    actorId: string;
    actorType: "KITCHEN" | "ADMIN" | "POS" | "WAITER" | "MENU_DISPLAY" | "ORDER_DISPLAY";
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
    actorType: "KITCHEN" | "ADMIN" | "POS" | "WAITER" | "MENU_DISPLAY" | "ORDER_DISPLAY";
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
    availability: "AVAILABLE" | "INCREASED_WAIT" | "PAUSED" | "SOLD_OUT";
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

  if (
    (params.availability === "AVAILABLE" ||
      params.availability === "INCREASED_WAIT" ||
      params.availability === "PAUSED") &&
    before.dailyOrderCap != null
  ) {
    const capStateMap = await getMenuCapStates(db, [
      { menuId: before.id, dailyOrderCap: before.dailyOrderCap },
    ]);
    const capState = capStateMap.get(before.id);
    if (capState?.isCapReached) {
      throw new AppError(
        409,
        "MENU_CAP_REACHED",
        "本日の上限に達しているため販売状態を変更できません",
      );
    }
  }

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

export async function updateMenuCapByKitchen(
  db: DbClient,
  params: {
    actorId: string;
    kitchenId: string;
    menuId: string;
    dailyOrderCap: number | null;
  },
) {
  const assignment = await db.menuKitchenAssignment.findFirst({
    where: {
      menuId: params.menuId,
      kitchenId: params.kitchenId,
      enabled: true,
    },
  });
  assert(assignment, 403, "FORBIDDEN", "Kitchen can update only own-kitchen menus");

  const before = await db.menu.findUnique({
    where: { id: params.menuId },
    select: {
      id: true,
      dailyOrderCap: true,
    },
  });
  assert(before, 404, "MENU_NOT_FOUND", "Menu not found");

  const updated = await db.menu.update({
    where: { id: params.menuId },
    data: {
      dailyOrderCap: params.dailyOrderCap,
    },
    select: {
      id: true,
      dailyOrderCap: true,
    },
  });

  await writeAuditLog(db, {
    actorId: params.actorId,
    actorType: "KITCHEN",
    actionType: "MENU_DAILY_CAP_UPDATED",
    entityType: "menu",
    entityId: params.menuId,
    beforeJson: {
      dailyOrderCap: before.dailyOrderCap,
    },
    afterJson: {
      dailyOrderCap: updated.dailyOrderCap,
    },
    result: "SUCCESS",
  });

  return updated;
}
