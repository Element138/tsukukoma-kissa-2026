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
import { squareConfig } from "@/lib/domain/square";
import { randomBytes } from "node:crypto";
import { assert } from "@/lib/errors";
import {
  broadcastInvalidation,
  CHANNEL_GROUPS,
  kitchenChannel,
} from "@/lib/server/realtime-broadcast";
import { triggerPaymentWatchdogBestEffort } from "@/lib/server/payment-watchdog-trigger";

const querySchema = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
  paymentStatus: z.string().optional(),
  fulfillmentType: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  take: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requireSession(req);
    triggerPaymentWatchdogBestEffort();

    const query = querySchema.parse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    );
    const take = Math.min(Number(query.take ?? "100"), 300);

    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { orderStatus: query.status as any } : {}),
      ...(query.paymentStatus
        ? { paymentStatus: query.paymentStatus as any }
        : {}),
      ...(query.fulfillmentType
        ? { fulfillmentType: query.fulfillmentType as any }
        : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
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
            kitchenId: true,
            status: true,
            readyAt: true,
            servedAt: true,
          },
        },
      },
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
    const squareSettings = body.paymentMethod === "SQUARE" ? squareConfig(req.nextUrl.origin) : null;

    const result = await prisma.$transaction(async (tx) => {
      await runPaymentWatchdog(tx);

      const created = await createOrderAtPaymentStart(tx, {
        actorId: actor.actorId,
        actorType: actor.actorType,
        payload: body,
      });
      if (squareSettings && !created.duplicated) {
        assert(created.order.totalPriceJpy > 0, 400, "SQUARE_AMOUNT", "Square決済金額は1円以上が必要です");
        await tx.squarePaymentAttempt.create({ data: {
          orderId: created.order.id, stateToken: randomBytes(32).toString("hex"), ...squareSettings,
        } });
      }

      if (!created.duplicated) {
        const kitchenChannels = created.order.items
          .map((item) => item.kitchenId)
          .filter((kitchenId): kitchenId is string => Boolean(kitchenId))
          .map((kitchenId) => kitchenChannel(kitchenId));

        await broadcastInvalidation(
          tx,
          [...CHANNEL_GROUPS.ORDER_FLOW, ...kitchenChannels],
          "orders",
          "order_created",
        );
      }

      return created;
    });

    const square = squareSettings ? { launchAvailable: !result.duplicated } : null;

    return ok({
      duplicated: result.duplicated,
      order: result.order,
      square,
    });
  } catch (error) {
    return fail(error);
  }
}
