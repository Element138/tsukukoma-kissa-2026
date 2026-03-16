import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fail } from "@/lib/response";
import { verifySquareCallbackSignature } from "@/lib/domain/square";
import { appendOrderEvent, confirmOrderPayment } from "@/lib/domain/orders";
import { broadcastInvalidation, CHANNEL_GROUPS, kitchenChannel } from "@/lib/server/realtime-broadcast";
import { openLateSuccessIncident } from "@/lib/domain/payment-incidents";
import { deriveOrderProcessingTrace } from "@/lib/domain/order-processing-trace";
import { writeAuditLog } from "@/lib/domain/audit";
import { now } from "@/lib/time";

function normalizeSquareResult(value: unknown): "SUCCESS" | "FAILED" {
  if (value === true) {
    return "SUCCESS";
  }
  const text = String(value ?? "").trim().toUpperCase();
  if (text === "SUCCESS" || text === "OK") {
    return "SUCCESS";
  }
  return "FAILED";
}

function parseSquarePayload(text: string, url: URL) {
  const queryOrderId = url.searchParams.get("state") || url.searchParams.get("orderId");
  const queryResult = normalizeSquareResult(
    url.searchParams.get("result") ||
      url.searchParams.get("status") ||
      url.searchParams.get("success")
  );
  const querySquareTransactionId = url.searchParams.get("transaction_id") || undefined;

  try {
    const parsed = JSON.parse(text || "{}");
    const parsedResultSource = parsed.result ?? parsed.status ?? parsed.success;
    return {
      orderId: parsed.state || parsed.orderId || queryOrderId,
      result:
        parsedResultSource === undefined
          ? queryResult
          : normalizeSquareResult(parsedResultSource),
      squareTransactionId: parsed.transaction_id || parsed.squareTransactionId || querySquareTransactionId
    } as const;
  } catch {
    return {
      orderId: queryOrderId,
      result: queryResult,
      squareTransactionId: querySquareTransactionId
    } as const;
  }
}

async function applySquareCallback(payload: { orderId: string | null; result: "SUCCESS" | "FAILED"; squareTransactionId?: string }) {
  if (!payload.orderId) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "ORDER_ID_REQUIRED",
          message: "注文 ID が必要です"
        }
      },
      { status: 400 }
    );
  }

  const existing = await prisma.order.findUnique({
    where: { id: payload.orderId },
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
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "ORDER_NOT_FOUND",
          message: "対象の注文が見つかりません"
        }
      },
      { status: 404 }
    );
  }

  if (existing.confirmedAt) {
    return NextResponse.json({ ok: true, data: { alreadyProcessed: true } }, { status: 200 });
  }
  if (payload.result === "FAILED" && existing.paymentStatus === "FAILED") {
    return NextResponse.json({ ok: true, data: { alreadyProcessed: true } }, { status: 200 });
  }

  if (payload.result === "SUCCESS" && existing.paymentStatus === "FAILED") {
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
          squareTransactionId: payload.squareTransactionId ?? null,
        },
      });

      const created = await openLateSuccessIncident(tx, {
        orderId: existing.id,
        orderNo: existing.orderNo,
        responsiblePosActorId: existing.createdByActorId,
        squareTransactionId: payload.squareTransactionId ?? null,
        orderCreatedAt: trace.createdAt,
        failedAt: trace.failedAt,
        failureReasonType: trace.failureReasonType,
        failureReasonText: trace.failureReasonText,
        successCallbackAt,
      });

      await writeAuditLog(tx, {
        actorId: null,
        actorType: null,
        actionType: "LATE_SUCCESS_CALLBACK_IGNORED",
        entityType: "payment_incident",
        entityId: created.id,
        orderId: existing.id,
        afterJson: {
          orderNo: existing.orderNo,
          responsiblePosActorId: existing.createdByActorId,
          squareTransactionId: payload.squareTransactionId ?? null,
          successCallbackAt: successCallbackAt.toISOString(),
        },
        result: "SUCCESS"
      });

      await broadcastInvalidation(tx, CHANNEL_GROUPS.ORDER_FLOW, "orders", "payment_incident");
      return created;
    });

    return NextResponse.json(
      { ok: true, data: { ignoredLateSuccess: true, incidentId: incident.id } },
      { status: 200 }
    );
  }

  await prisma.$transaction(async (tx) => {
    const order = await confirmOrderPayment(tx, {
      actorId: null,
      actorType: null,
      orderId: payload.orderId!,
      result: payload.result,
      squareTransactionId: payload.squareTransactionId,
      reasonType: payload.result === "FAILED" ? "FAILURE_CALLBACK" : undefined,
      reasonText:
        payload.result === "FAILED"
          ? "Square callback returned FAILED"
          : undefined,
    });

    const kitchenChannels = order.items
      .map((item) => item.kitchenId)
      .filter((kitchenId): kitchenId is string => Boolean(kitchenId))
      .map((kitchenId) => kitchenChannel(kitchenId));

    await broadcastInvalidation(
      tx,
      [...CHANNEL_GROUPS.ORDER_FLOW, ...kitchenChannels],
      "orders",
      "square_callback"
    );
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const signature = req.headers.get("x-square-signature");
    if (!verifySquareCallbackSignature(raw, signature)) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "INVALID_SIGNATURE",
            message: "コールバック署名が不正です"
          }
        },
        { status: 401 }
      );
    }

    const payload = parseSquarePayload(raw, req.nextUrl);
    return applySquareCallback(payload);
  } catch (error) {
    return fail(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    const payload = parseSquarePayload("", req.nextUrl);
    return applySquareCallback(payload);
  } catch (error) {
    return fail(error);
  }
}
