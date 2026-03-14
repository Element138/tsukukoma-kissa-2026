import { PrismaClient, Prisma } from "@prisma/client";
import { now } from "@/lib/time";

export const OFFLINE_ACTOR_THRESHOLD_MS = 35_000;

export async function findOfflineActors(db: PrismaClient | Prisma.TransactionClient) {
  const threshold = new Date(Date.now() - OFFLINE_ACTOR_THRESHOLD_MS);

  const actors = await db.actor.findMany({
    where: {
      isActive: true,
      actorType: {
        in: ["POS", "KITCHEN", "WAITER"]
      }
    },
    select: {
      id: true,
      actorType: true,
      label: true,
      online: true,
      lastSeenAt: true
    }
  });

  return actors
    .filter((a) => !a.lastSeenAt || a.lastSeenAt < threshold)
    .map((a) => ({
      actorId: a.id,
      actorType: a.actorType,
      label: a.label
    }));
}

export async function listQueuedItemsOnInactiveKitchens(db: PrismaClient | Prisma.TransactionClient) {
  const rows = await db.orderItem.findMany({
    where: {
      status: "QUEUED",
      kitchenId: {
        not: null
      },
      OR: [
        {
          kitchenActor: {
            actorType: {
              not: "KITCHEN"
            }
          }
        },
        {
          kitchenActor: {
            isActive: false
          }
        },
        {
          kitchenActor: {
            kitchenEnabled: false
          }
        }
      ],
      order: {
        orderStatus: {
          notIn: ["COMPLETED", "CANCELED"]
        }
      }
    },
    select: {
      id: true,
      orderId: true,
      kitchenId: true,
      kitchenActor: {
        select: {
          id: true,
          label: true
        }
      }
    }
  });

  return rows.map((r) => ({
    orderId: r.orderId,
    orderItemId: r.id,
    kitchenId: r.kitchenId,
    kitchenName: r.kitchenActor?.label ?? r.kitchenActor?.id ?? r.kitchenId ?? "unknown"
  }));
}

export async function touchActorHeartbeat(db: PrismaClient | Prisma.TransactionClient, actorId: string) {
  await db.actor.update({
    where: { id: actorId },
    data: {
      online: true,
      lastSeenAt: now()
    }
  });
}
