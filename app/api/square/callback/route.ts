import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fail } from "@/lib/response";
import { verifySquareCallbackSignature } from "@/lib/domain/square";
import { confirmOrderPayment } from "@/lib/domain/orders";

function parseSquarePayload(text: string, url: URL) {
  try {
    const parsed = JSON.parse(text);
    return {
      orderId: parsed.state || parsed.orderId,
      result: parsed.success === true || parsed.result === "SUCCESS" ? "SUCCESS" : "FAILED",
      squareTransactionId: parsed.transaction_id || parsed.squareTransactionId
    } as const;
  } catch {
    const orderId = url.searchParams.get("state") || url.searchParams.get("orderId");
    const result = url.searchParams.get("result") === "SUCCESS" ? "SUCCESS" : "FAILED";
    const squareTransactionId = url.searchParams.get("transaction_id") || undefined;
    return {
      orderId,
      result,
      squareTransactionId
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
          message: "order id is required"
        }
      },
      { status: 400 }
    );
  }

  const existing = await prisma.order.findUnique({
    where: { id: payload.orderId },
    select: {
      id: true,
      confirmedAt: true
    }
  });

  if (existing?.confirmedAt) {
    return NextResponse.json({ ok: true, data: { alreadyProcessed: true } }, { status: 200 });
  }

  await prisma.$transaction((tx) =>
    confirmOrderPayment(tx, {
      actorId: null,
      actorType: null,
      orderId: payload.orderId!,
      result: payload.result,
      squareTransactionId: payload.squareTransactionId
    })
  );

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
            message: "Invalid callback signature"
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
    const payload = parseSquarePayload("{}", req.nextUrl);
    return applySquareCallback(payload);
  } catch (error) {
    return fail(error);
  }
}


