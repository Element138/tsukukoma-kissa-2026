import { Prisma, PrismaClient } from "@prisma/client";
import { now } from "@/lib/time";
import { writeAuditLog } from "@/lib/domain/audit";
import { broadcastInvalidation, CHANNEL_GROUPS } from "@/lib/server/realtime-broadcast";

type DbClient = PrismaClient | Prisma.TransactionClient;
const PAYMENT_WATCHDOG_LOCK_KEY = 809_941_253;

export async function runPaymentWatchdog(db: DbClient) {
  const lock = await db.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT pg_try_advisory_xact_lock(${PAYMENT_WATCHDOG_LOCK_KEY}) AS acquired
  `;
  if (!lock[0]?.acquired) {
    return {
      paymentFailed: 0,
      cleanedAwaiting: 0
    };
  }

  const current = now();

  const awaitingTimeouts = await db.order.findMany({
    where: {
      paymentMethod: "SQUARE",
      paymentStatus: "AWAITING",
      confirmedAt: null,
      canceledAt: null,
      paymentAwaitDeadlineAt: {
        lte: current
      }
    },
    select: {
      id: true
    }
  });

  for (const order of awaitingTimeouts) {
    const changed = await db.order.updateMany({
      where: {
        id: order.id,
        paymentStatus: "AWAITING",
        confirmedAt: null
      },
      data: {
        paymentStatus: "FAILED",
        orderStatus: "FAILED",
        paymentAwaitDeadlineAt: null,
        autoCancelDeadlineAt: null,
        lastMutationVersion: {
          increment: 1
        }
      }
    });
    if (changed.count !== 1) {
      continue;
    }

    await writeAuditLog(db, {
      actorId: null,
      actorType: null,
      actionType: "PAYMENT_TIMEOUT_FAILED",
      entityType: "order",
      entityId: order.id,
      orderId: order.id,
      result: "SUCCESS"
    });
  }

  if (awaitingTimeouts.length > 0) {
    await broadcastInvalidation(db, CHANNEL_GROUPS.ORDER_FLOW, "orders", "payment_watchdog");
  }

  return {
    paymentFailed: awaitingTimeouts.length,
    cleanedAwaiting: awaitingTimeouts.length
  };
}
