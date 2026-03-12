import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
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
    const kitchenId = actor.actorType === "KITCHEN" ? actor.actorId : req.nextUrl.searchParams.get("kitchenId");
    if (!kitchenId) {
      return ok({ queues: [] });
    }

    const items = await prisma.orderItem.findMany({
      where: {
        kitchenId,
        status: "QUEUED",
        order: {
          confirmedAt: { not: null },
          orderStatus: { notIn: ["COMPLETED", "CANCELED"] }
        }
      },
      include: {
        order: {
          select: {
            confirmedAt: true
          }
        },
        kitchenActor: {
          select: {
            id: true,
            label: true,
            actorType: true,
            isActive: true,
            kitchenEnabled: true
          }
        }
      },
      orderBy: [{ order: { confirmedAt: "asc" } }, { kitchenAssignedAt: "asc" }, { id: "asc" }]
    });

    const queueByMenu = new Map<
      string,
      {
        menuId: string;
        menuName: string;
        queuedCount: number;
        oldestConfirmedAt: Date | null;
        kitchenName: string;
        kitchenInactiveWarning: boolean;
      }
    >();

    for (const item of items) {
      const key = item.menuId;
      const inactive =
        !item.kitchenActor ||
        item.kitchenActor.actorType !== "KITCHEN" ||
        !item.kitchenActor.isActive ||
        !item.kitchenActor.kitchenEnabled;

      const existing = queueByMenu.get(key);
      const confirmedAt = item.order.confirmedAt;
      if (!existing) {
        queueByMenu.set(key, {
          menuId: item.menuId,
          menuName: item.itemNameSnapshot,
          queuedCount: 1,
          oldestConfirmedAt: confirmedAt,
          kitchenName: item.kitchenActor?.label ?? item.kitchenActor?.id ?? "Unknown",
          kitchenInactiveWarning: inactive
        });
        continue;
      }

      existing.queuedCount += 1;
      if (confirmedAt && (!existing.oldestConfirmedAt || confirmedAt.getTime() < existing.oldestConfirmedAt.getTime())) {
        existing.oldestConfirmedAt = confirmedAt;
      }
      existing.kitchenInactiveWarning = existing.kitchenInactiveWarning || inactive;
    }

    const queues = [...queueByMenu.values()]
      .map((row) => {
        const oldestSeconds = row.oldestConfirmedAt
          ? Math.max(0, Math.floor((Date.now() - row.oldestConfirmedAt.getTime()) / 1000))
          : 0;

        return {
          menuId: row.menuId,
          menuName: row.menuName,
          queuedCount: row.queuedCount,
          oldestQueuedSeconds: oldestSeconds,
          oldestElapsed: row.oldestConfirmedAt ? elapsedMss(row.oldestConfirmedAt) : "0:00",
          kitchenName: row.kitchenName,
          kitchenInactiveWarning: row.kitchenInactiveWarning
        };
      })
      .sort((a, b) => {
        if (b.oldestQueuedSeconds !== a.oldestQueuedSeconds) {
          return b.oldestQueuedSeconds - a.oldestQueuedSeconds;
        }
        return a.menuName.localeCompare(b.menuName, "ja");
      });

    return ok({ queues });
  } catch (error) {
    return fail(error);
  }
}