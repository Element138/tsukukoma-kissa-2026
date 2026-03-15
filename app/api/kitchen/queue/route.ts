import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getMenuCapStates } from "@/lib/domain/menu-cap";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";

function elapsedMss(from: Date) {
  const diffSec = Math.max(0, Math.floor((Date.now() - from.getTime()) / 1000));
  const mm = Math.floor(diffSec / 60);
  const ss = diffSec % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["KITCHEN", "ADMIN"] });
    const kitchenId =
      actor.actorType === "KITCHEN" ? actor.actorId : req.nextUrl.searchParams.get("kitchenId");
    if (!kitchenId) {
      return ok({ menus: [] });
    }

    const assignments = await prisma.menuKitchenAssignment.findMany({
      where: {
        kitchenId,
        enabled: true,
        menu: {
          isActive: true,
        },
      },
      select: {
        menuId: true,
        menu: {
          select: {
            id: true,
            name: true,
            availability: true,
            dailyOrderCap: true,
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }],
    });

    const menuIds = [...new Set(assignments.map((row) => row.menuId))];
    if (menuIds.length === 0) {
      return ok({ menus: [] });
    }

    const [queuedItems, activeCoverageAssignments, capStateMap] = await Promise.all([
      prisma.orderItem.findMany({
        where: {
          kitchenId,
          menuId: { in: menuIds },
          status: "QUEUED",
          order: {
            confirmedAt: { not: null },
            orderStatus: { notIn: ["COMPLETED", "FAILED", "CANCELED"] },
          },
        },
        select: {
          menuId: true,
          order: {
            select: {
              confirmedAt: true,
            },
          },
        },
        orderBy: [{ order: { confirmedAt: "asc" } }, { kitchenAssignedAt: "asc" }, { id: "asc" }],
      }),
      prisma.menuKitchenAssignment.findMany({
        where: {
          menuId: { in: menuIds },
          enabled: true,
          kitchenActor: {
            actorType: "KITCHEN",
            isActive: true,
            kitchenEnabled: true,
          },
        },
        select: {
          menuId: true,
        },
      }),
      getMenuCapStates(
        prisma,
        assignments.map((assignment) => ({
          menuId: assignment.menu.id,
          dailyOrderCap: assignment.menu.dailyOrderCap ?? null,
        })),
      ),
    ]);

    const queueMap = new Map<string, { queuedCount: number; oldestConfirmedAt: Date | null }>();
    for (const item of queuedItems) {
      const existing = queueMap.get(item.menuId);
      const confirmedAt = item.order.confirmedAt;
      if (!existing) {
        queueMap.set(item.menuId, {
          queuedCount: 1,
          oldestConfirmedAt: confirmedAt,
        });
        continue;
      }
      existing.queuedCount += 1;
      if (
        confirmedAt &&
        (!existing.oldestConfirmedAt ||
          confirmedAt.getTime() < existing.oldestConfirmedAt.getTime())
      ) {
        existing.oldestConfirmedAt = confirmedAt;
      }
    }

    const coveredMenuSet = new Set(activeCoverageAssignments.map((row) => row.menuId));

    const menus = assignments
      .map((assignment) => {
        const queue = queueMap.get(assignment.menuId) ?? {
          queuedCount: 0,
          oldestConfirmedAt: null as Date | null,
        };
        const capState = capStateMap.get(assignment.menuId);
        const oldestQueuedSeconds = queue.oldestConfirmedAt
          ? Math.max(0, Math.floor((Date.now() - queue.oldestConfirmedAt.getTime()) / 1000))
          : 0;
        const isCapReached = capState?.isCapReached ?? false;

        return {
          menuId: assignment.menuId,
          menuName: assignment.menu.name,
          availability: isCapReached ? "SOLD_OUT" : assignment.menu.availability,
          hasActiveKitchenCoverage: coveredMenuSet.has(assignment.menuId),
          queuedCount: queue.queuedCount,
          oldestQueuedSeconds,
          oldestElapsed: queue.oldestConfirmedAt ? elapsedMss(queue.oldestConfirmedAt) : "0:00",
          todayOrderCount: capState?.todayCount ?? 0,
          remainingUntilCap: capState?.remainingUntilCap ?? null,
          dailyOrderCap: assignment.menu.dailyOrderCap ?? null,
          isCapReached,
        };
      })
      .sort((a, b) => {
        if (b.oldestQueuedSeconds !== a.oldestQueuedSeconds) {
          return b.oldestQueuedSeconds - a.oldestQueuedSeconds;
        }
        return a.menuName.localeCompare(b.menuName, "ja");
      });

    return ok({ menus });
  } catch (error) {
    return fail(error);
  }
}
