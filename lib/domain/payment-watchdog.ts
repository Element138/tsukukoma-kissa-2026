import { Prisma, PrismaClient } from "@prisma/client";
import { now, secondsFromNow } from "@/lib/time";
import { writeAuditLog } from "@/lib/domain/audit";
import { broadcastInvalidation, CHANNEL_GROUPS } from "@/lib/server/realtime-broadcast";

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function runPaymentWatchdog(db: DbClient) {
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
    await db.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: "FAILED",
        autoCancelDeadlineAt: secondsFromNow(60),
        paymentAwaitDeadlineAt: null,
        lastMutationVersion: {
          increment: 1
        }
      }
    });

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

  const failedTimeouts = await db.order.findMany({
    where: {
      paymentStatus: "FAILED",
      confirmedAt: null,
      canceledAt: null,
      autoCancelDeadlineAt: {
        lte: current
      }
    },
    select: {
      id: true
    }
  });

  for (const order of failedTimeouts) {
    await db.order.update({
      where: { id: order.id },
      data: {
        canceledAt: now(),
        paymentStatus: "CANCELED",
        orderStatus: "CANCELED",
        autoCancelDeadlineAt: null,
        lastMutationVersion: {
          increment: 1
        }
      }
    });

    await db.orderItem.updateMany({
      where: {
        orderId: order.id,
        status: "QUEUED"
      },
      data: {
        status: "CANCELED"
      }
    });

    await writeAuditLog(db, {
      actorId: null,
      actorType: null,
      actionType: "PAYMENT_TIMEOUT_CANCELED",
      entityType: "order",
      entityId: order.id,
      orderId: order.id,
      result: "SUCCESS"
    });
  }

  if (awaitingTimeouts.length > 0 || failedTimeouts.length > 0) {
    await broadcastInvalidation(db, CHANNEL_GROUPS.ORDER_FLOW, "orders", "payment_watchdog");
  }

  return {
    paymentFailed: awaitingTimeouts.length,
    autoCanceled: failedTimeouts.length
  };
}
