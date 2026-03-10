import { PrismaClient, Prisma } from "@prisma/client";
import { now } from "@/lib/time";

export async function findOfflineActors(db: PrismaClient | Prisma.TransactionClient) {
  const threshold = new Date(Date.now() - 45_000);

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
      online: true,
      lastSeenAt: true
    }
  });

  return actors
    .filter((a) => !a.lastSeenAt || a.lastSeenAt < threshold)
    .map((a) => ({
      actorId: a.id,
      actorType: a.actorType
    }));
}

export async function listQueuedItemsOnInactiveLines(db: PrismaClient | Prisma.TransactionClient) {
  const rows = await db.orderItem.findMany({
    where: {
      status: "QUEUED",
      lineId: {
        not: null
      },
      line: {
        isActive: false
      },
      order: {
        orderStatus: {
          notIn: ["COMPLETED", "CANCELED"]
        }
      }
    },
    select: {
      id: true,
      orderId: true,
      lineId: true,
      line: {
        select: {
          name: true
        }
      }
    }
  });

  return rows.map((r) => ({
    orderId: r.orderId,
    orderItemId: r.id,
    lineId: r.lineId,
    lineName: r.line?.name ?? r.lineId ?? "unknown"
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


