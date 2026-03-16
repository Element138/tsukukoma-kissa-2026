import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { parseJson } from "@/lib/server/http";
import { appendOrderEvent, confirmOrderPayment } from "@/lib/domain/orders";
import { openLateSuccessIncident } from "@/lib/domain/payment-incidents";
import { deriveOrderProcessingTrace } from "@/lib/domain/order-processing-trace";
import { writeAuditLog } from "@/lib/domain/audit";
import { broadcastInvalidation, CHANNEL_GROUPS, kitchenChannel } from "@/lib/server/realtime-broadcast";
import { now } from "@/lib/time";

const debugSchema = z.object({
  orderId: z.string().min(1),
  result: z.enum(["SUCCESS", "FAILED"]),
  squareTransactionId: z.string().max(120).optional()
});

export async function POST(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["POS", "ADMIN"] });
    // TODO(debug): Remove this endpoint and related keyboard shortcut after payment-flow QA.

    const body = await parseJson(req, debugSchema);

    const existing = await prisma.order.findUnique({
      where: { id: body.orderId },
      select: {
        id: true,
        orderNo: true,
        createdByActorId: true,
        createdAt: true,
        confirmedAt: true,
        paymentStatus: true,
        events: true,
      }
    });
    if (!existing) {
      return ok({ simulated: false, reason: "ORDER_NOT_FOUND" }, { status: 404 });
    }

    if (existing.confirmedAt) {
      return ok({ simulated: true, alreadyProcessed: true });
    }

    if (body.result === "SUCCESS" && existing.paymentStatus === "FAILED") {
      const successCallbackAt = now();
      const trace = deriveOrderProcessingTrace({
        createdAt: existing.createdAt,
        events: existing.events,
      });

      const incident = await prisma.$transaction(async (tx) => {
        await appendOrderEvent(tx, existing.id, {
          type: "PAYMENT_SUCCESS_CALLBACK_AFTER_FAILED",
          at: successCallbackAt.toISOString(),
          detail: {
            squareTransactionId: body.squareTransactionId ?? null,
          },
        });

        const created = await openLateSuccessIncident(tx, {
          orderId: existing.id,
          orderNo: existing.orderNo,
          responsiblePosActorId: existing.createdByActorId,
          squareTransactionId: body.squareTransactionId ?? null,
          orderCreatedAt: trace.createdAt,
          failedAt: trace.failedAt,
          failureReasonType: trace.failureReasonType,
          failureReasonText: trace.failureReasonText,
          successCallbackAt,
        });

        await writeAuditLog(tx, {
          actorId: null,
          actorType: null,
          actionType: "DEBUG_LATE_SUCCESS_CALLBACK_IGNORED",
          entityType: "payment_incident",
          entityId: created.id,
          orderId: existing.id,
          result: "SUCCESS"
        });

        await broadcastInvalidation(tx, CHANNEL_GROUPS.ORDER_FLOW, "orders", "payment_incident");
        return created;
      });

      return ok({
        simulated: true,
        ignoredLateSuccess: true,
        incidentId: incident.id
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const order = await confirmOrderPayment(tx, {
        actorId: null,
        actorType: null,
        orderId: body.orderId,
        result: body.result,
        squareTransactionId: body.squareTransactionId,
        reasonType: body.result === "FAILED" ? "FAILURE_CALLBACK" : undefined,
        reasonText:
          body.result === "FAILED"
            ? "デバッグコールバックでFAILEDが返却されました"
            : undefined,
      });

      const kitchenChannels = order.items
        .map((item) => item.kitchenId)
        .filter((kitchenId): kitchenId is string => Boolean(kitchenId))
        .map((kitchenId) => kitchenChannel(kitchenId));

      await writeAuditLog(tx, {
        actorId: null,
        actorType: null,
        actionType: "DEBUG_SQUARE_CALLBACK_SIMULATED",
        entityType: "order",
        entityId: order.id,
        orderId: order.id,
        afterJson: {
          result: body.result,
          squareTransactionId: body.squareTransactionId ?? null
        },
        result: "SUCCESS"
      });

      await broadcastInvalidation(
        tx,
        [...CHANNEL_GROUPS.ORDER_FLOW, ...kitchenChannels],
        "orders",
        "debug_square_callback"
      );

      return order;
    });

    return ok({
      simulated: true,
      order: {
        id: result.id,
        orderNo: result.orderNo,
        paymentStatus: result.paymentStatus,
        orderStatus: result.orderStatus
      }
    });
  } catch (error) {
    return fail(error);
  }
}
