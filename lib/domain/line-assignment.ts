import { Prisma, PrismaClient } from "@prisma/client";
import { now } from "@/lib/time";
import { AppError } from "@/lib/errors";

function chooseLineIdByWorkload(workloads: Map<string, number>, candidates: string[]): string {
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
      lineId: null,
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
  const assignments = await db.menuLineAssignment.findMany({
    where: {
      menuId: { in: menuIds },
      enabled: true,
      line: {
        isActive: true
      }
    },
    select: {
      menuId: true,
      lineId: true
    }
  });

  const assignmentMap = new Map<string, string[]>();
  for (const row of assignments) {
    const arr = assignmentMap.get(row.menuId) ?? [];
    arr.push(row.lineId);
    assignmentMap.set(row.menuId, arr);
  }

  const queuedLoadsRaw = await db.orderItem.groupBy({
    by: ["lineId"],
    where: {
      lineId: { not: null },
      status: "QUEUED"
    },
    _sum: {
      workloadSecondsSnapshot: true
    }
  });

  const workloads = new Map<string, number>();
  for (const row of queuedLoadsRaw) {
    if (row.lineId) {
      workloads.set(row.lineId, row._sum.workloadSecondsSnapshot ?? 0);
    }
  }

  for (const item of pendingItems) {
    const candidates = assignmentMap.get(item.menuId) ?? [];
    if (candidates.length === 0) {
      throw new AppError(
        409,
        "NO_ACTIVE_LINE",
        `No active line can process menu ${item.menuId}. Set menu to PAUSED or reactivate a line.`
      );
    }

    const chosen = chooseLineIdByWorkload(workloads, candidates);
    workloads.set(chosen, (workloads.get(chosen) ?? 0) + item.workloadSecondsSnapshot);

    await db.orderItem.update({
      where: { id: item.id },
      data: {
        lineId: chosen,
        lineAssignedAt: now()
      }
    });
  }
}

export async function reassignQueuedItemsFromLine(db: DbClient, params: { fromLineId: string; toLineId: string }) {
  const targetLine = await db.line.findUnique({
    where: { id: params.toLineId },
    select: { isActive: true }
  });
  if (!targetLine?.isActive) {
    throw new AppError(400, "LINE_INACTIVE", "Target line must be active");
  }

  const items = await db.orderItem.findMany({
    where: {
      lineId: params.fromLineId,
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

  const allowed = await db.menuLineAssignment.findMany({
    where: {
      lineId: params.toLineId,
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
        lineId: params.toLineId,
        lineAssignedAt: now()
      }
    });
  }

  return { moved: moveIds.length, skipped: items.length - moveIds.length };
}

export async function updateMenusAvailabilityByLineCoverage(db: DbClient) {
  const activeLines = await db.line.findMany({
    where: { isActive: true },
    select: { id: true }
  });
  const activeLineSet = new Set(activeLines.map((x) => x.id));

  const allAssignments = await db.menuLineAssignment.findMany({
    where: { enabled: true },
    select: { menuId: true, lineId: true }
  });

  const coveredMenus = new Set<string>();
  for (const row of allAssignments) {
    if (activeLineSet.has(row.lineId)) {
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


