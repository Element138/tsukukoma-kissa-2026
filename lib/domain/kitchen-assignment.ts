import { Prisma, PrismaClient } from "@prisma/client";
import { now } from "@/lib/time";
import { AppError } from "@/lib/errors";

function chooseKitchenIdByWorkload(workloads: Map<string, number>, candidates: string[]): string {
  let best = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const score = workloads.get(c) ?? 0;
    if (score < best) {
      best = score;
    }
  }

  const tied = candidates.filter((c) => (workloads.get(c) ?? 0) === best);
  const idx = Math.floor(Math.random() * tied.length);
  return tied[idx] as string;
}

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function assignUnassignedItemsForOrder(db: DbClient, orderId: string) {
  const pendingItems = await db.orderItem.findMany({
    where: {
      orderId,
      kitchenId: null,
      status: "QUEUED"
    },
    select: {
      id: true,
      menuId: true,
      workloadSecondsSnapshot: true
    }
  });

  if (pendingItems.length === 0) {
    return;
  }

  const menuIds = [...new Set(pendingItems.map((i) => i.menuId))];
  const assignments = await db.menuKitchenAssignment.findMany({
    where: {
      menuId: { in: menuIds },
      enabled: true,
      kitchen: {
        isActive: true
      }
    },
    select: {
      menuId: true,
      kitchenId: true
    }
  });

  const assignmentMap = new Map<string, string[]>();
  for (const row of assignments) {
    const arr = assignmentMap.get(row.menuId) ?? [];
    arr.push(row.kitchenId);
    assignmentMap.set(row.menuId, arr);
  }

  const queuedLoadsRaw = await db.orderItem.groupBy({
    by: ["kitchenId"],
    where: {
      kitchenId: { not: null },
      status: "QUEUED"
    },
    _sum: {
      workloadSecondsSnapshot: true
    }
  });

  const workloads = new Map<string, number>();
  for (const row of queuedLoadsRaw) {
    if (row.kitchenId) {
      workloads.set(row.kitchenId, row._sum.workloadSecondsSnapshot ?? 0);
    }
  }

  for (const item of pendingItems) {
    const candidates = assignmentMap.get(item.menuId) ?? [];
    if (candidates.length === 0) {
      throw new AppError(
        409,
        "NO_ACTIVE_KITCHEN",
        `No active kitchen can process menu ${item.menuId}. Set menu to PAUSED or reactivate a kitchen.`
      );
    }

    const chosen = chooseKitchenIdByWorkload(workloads, candidates);
    workloads.set(chosen, (workloads.get(chosen) ?? 0) + item.workloadSecondsSnapshot);

    await db.orderItem.update({
      where: { id: item.id },
      data: {
        kitchenId: chosen,
        kitchenAssignedAt: now()
      }
    });
  }
}

export async function reassignQueuedItemsFromKitchen(db: DbClient, params: { fromKitchenId: string; toKitchenId: string }) {
  const targetKitchen = await db.kitchen.findUnique({
    where: { id: params.toKitchenId },
    select: { isActive: true }
  });
  if (!targetKitchen?.isActive) {
    throw new AppError(400, "KITCHEN_INACTIVE", "Target kitchen must be active");
  }

  const items = await db.orderItem.findMany({
    where: {
      kitchenId: params.fromKitchenId,
      status: "QUEUED"
    },
    select: {
      id: true,
      menuId: true
    }
  });

  if (items.length === 0) {
    return { moved: 0 };
  }

  const allowed = await db.menuKitchenAssignment.findMany({
    where: {
      kitchenId: params.toKitchenId,
      enabled: true,
      menuId: { in: [...new Set(items.map((i) => i.menuId))] }
    },
    select: { menuId: true }
  });
  const allowedSet = new Set(allowed.map((x) => x.menuId));

  const moveIds = items.filter((i) => allowedSet.has(i.menuId)).map((i) => i.id);

  if (moveIds.length > 0) {
    await db.orderItem.updateMany({
      where: { id: { in: moveIds } },
      data: {
        kitchenId: params.toKitchenId,
        kitchenAssignedAt: now()
      }
    });
  }

  return { moved: moveIds.length, skipped: items.length - moveIds.length };
}

export async function updateMenusAvailabilityByKitchenCoverage(db: DbClient) {
  const activeKitchens = await db.kitchen.findMany({
    where: { isActive: true },
    select: { id: true }
  });
  const activeKitchenSet = new Set(activeKitchens.map((x) => x.id));

  const allAssignments = await db.menuKitchenAssignment.findMany({
    where: { enabled: true },
    select: { menuId: true, kitchenId: true }
  });

  const coveredMenus = new Set<string>();
  for (const row of allAssignments) {
    if (activeKitchenSet.has(row.kitchenId)) {
      coveredMenus.add(row.menuId);
    }
  }

  const menus = await db.menu.findMany({
    where: { isActive: true },
    select: { id: true, availability: true }
  });

  for (const menu of menus) {
    const hasCoverage = coveredMenus.has(menu.id);
    if (!hasCoverage && menu.availability === "AVAILABLE") {
      await db.menu.update({
        where: { id: menu.id },
        data: { availability: "PAUSED" }
      });
    }
    if (hasCoverage && menu.availability === "PAUSED") {
      await db.menu.update({
        where: { id: menu.id },
        data: { availability: "AVAILABLE" }
      });
    }
  }
}


