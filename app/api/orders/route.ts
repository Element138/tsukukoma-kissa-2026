import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { orderCreateSchema } from "@/lib/validation";
import { parseJson } from "@/lib/server/http";
import { createOrderAtPaymentStart } from "@/lib/domain/orders";
import { runPaymentWatchdog } from "@/lib/domain/payment-watchdog";
import { createSquareAppSwitchRequest } from "@/lib/domain/square";

const querySchema = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
  paymentStatus: z.string().optional(),
  fulfillmentType: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  take: z.string().optional()
});

export async function GET(req: NextRequest) {
  try {
    await requireSession(req);
    await runPaymentWatchdog(prisma);

    const query = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
    const take = Math.min(Number(query.take ?? "100"), 300);

    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { orderStatus: query.status as any } : {}),
      ...(query.paymentStatus ? { paymentStatus: query.paymentStatus as any } : {}),
      ...(query.fulfillmentType ? { fulfillmentType: query.fulfillmentType as any } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {})
            }
          }
        : {})
    };

    if (query.q) {
      const asNo = Number(query.q);
      if (Number.isFinite(asNo)) {
        where.orderNo = asNo;
      } else {
        where.specialNote = { contains: query.q, mode: "insensitive" };
      }
    }

    const orders = await prisma.order.findMany({
      where,
      take,
      orderBy: [{ orderStatus: "asc" }, { createdAt: "desc" }],
      include: {
        items: {
          select: {
            id: true,
            menuId: true,
            itemNameSnapshot: true,
            unitPriceJpy: true,
            lineId: true,
            status: true,
            readyAt: true,
            servedAt: true
          }
        }
      }
    });

    return ok({ orders });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["POS"] });
    const body = await parseJson(req, orderCreateSchema);

    const result = await prisma.$transaction(async (tx) => {
      return createOrderAtPaymentStart(tx, {
        actorId: actor.actorId,
        actorType: actor.actorType,
        payload: body
      });
    });

    let square = null;
    if (result.order.paymentMethod === "SQUARE" && result.order.paymentStatus === "AWAITING") {
      const callbackUrl = process.env.SQUARE_CALLBACK_URL || "https://example.com/api/square/callback";
      square = createSquareAppSwitchRequest({
        orderId: result.order.id,
        orderNo: result.order.orderNo,
        amountJpy: result.order.totalPriceJpy,
        callbackUrl,
        note: `KISSa order #${result.order.orderNo}`
      });
    }

    return ok({
      duplicated: result.duplicated,
      order: result.order,
      square
    });
  } catch (error) {
    return fail(error);
  }
}


