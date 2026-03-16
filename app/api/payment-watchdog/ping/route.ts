import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { triggerPaymentWatchdogBestEffort } from "@/lib/server/payment-watchdog-trigger";
import { findOpenSquareAwaitingOrderForPos } from "@/lib/domain/orders";
import { createSquareAppSwitchRequest } from "@/lib/domain/square";

async function handle(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["POS"] });
    triggerPaymentWatchdogBestEffort();

    const trackOrderId = req.nextUrl.searchParams.get("trackOrderId");
    const awaiting = await findOpenSquareAwaitingOrderForPos(
      prisma,
      actor.actorId,
    );
    const callbackUrl =
      process.env.SQUARE_CALLBACK_URL ||
      "https://example.com/api/square/callback";

    const awaitingOrder = awaiting
      ? {
          id: awaiting.id,
          orderNo: awaiting.orderNo,
          createdAt: awaiting.createdAt,
          paymentAwaitDeadlineAt: awaiting.paymentAwaitDeadlineAt,
          reopenDeepLink: createSquareAppSwitchRequest({
            orderId: awaiting.id,
            orderNo: awaiting.orderNo,
            amountJpy: awaiting.totalPriceJpy,
            callbackUrl,
            note: `筑駒文化祭喫茶 注文#${awaiting.orderNo}`,
          }).deepLink,
        }
      : null;

    const trackedOrder = trackOrderId
      ? await prisma.order.findFirst({
          where: {
            id: trackOrderId,
            createdByActorId: actor.actorId,
          },
          select: {
            id: true,
            orderNo: true,
            paymentStatus: true,
            orderStatus: true,
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
