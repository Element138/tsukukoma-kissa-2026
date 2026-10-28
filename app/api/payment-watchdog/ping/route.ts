import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { triggerPaymentWatchdogBestEffort } from "@/lib/server/payment-watchdog-trigger";
import { findOpenSquareAwaitingOrderForPos } from "@/lib/domain/orders";

async function handle(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["POS"] });
    triggerPaymentWatchdogBestEffort();

    const trackOrderId = req.nextUrl.searchParams.get("trackOrderId");
    const recoveryKey = req.nextUrl.searchParams.get("idempotencyKey");
    const awaiting = await findOpenSquareAwaitingOrderForPos(
      prisma,
      actor.actorId,
    );
    const attempt = awaiting ? await prisma.squarePaymentAttempt.findUnique({ where: { orderId: awaiting.id } }) : null;

    const awaitingOrder = awaiting
      ? {
          id: awaiting.id,
          checkoutKey: awaiting.idempotencyKey,
          orderNo: awaiting.orderNo,
          createdAt: awaiting.createdAt,
          paymentAwaitDeadlineAt: awaiting.paymentAwaitDeadlineAt,
          launchAvailable: Boolean(attempt && !attempt.launchedAt && !attempt.resolvedAt),
          lastError: attempt?.lastError ?? null,
          verificationPending: Boolean(attempt?.transactionId && !attempt.resolvedAt && attempt.verifyAttempts < 3 &&
            (!attempt.verifyAfter || attempt.verifyAfter <= new Date())),
        }
      : null;

    const trackedOrder = trackOrderId || recoveryKey
      ? await prisma.order.findFirst({
          where: {
            ...(trackOrderId ? { id: trackOrderId } : { idempotencyKey: recoveryKey! }),
            createdByActorId: actor.actorId,
          },
          select: {
            id: true,
            orderNo: true,
            paymentStatus: true,
            orderStatus: true,
            paymentMethod: true,
          },
        })
      : null;

    const incidents = await prisma.paymentIncident.findMany({
      where: {
        dismissedAt: null,
      },
      select: {
        id: true,
        orderId: true,
        messageJa: true,
        createdAt: true,
        order: {
          select: {
            orderNo: true,
            createdByActorId: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 12,
    });

    return ok({
      accepted: true,
      awaitingOrder,
      trackedOrder,
      incidents: incidents.map((incident) => ({
        id: incident.id,
        orderId: incident.orderId,
        orderNo: incident.order.orderNo,
        responsiblePosActorId: incident.order.createdByActorId,
        messageJa: incident.messageJa,
        createdAt: incident.createdAt,
      })),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
