import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { orderConfirmSchema } from "@/lib/validation";
import { parseJson } from "@/lib/server/http";
import { confirmOrderPayment } from "@/lib/domain/orders";
import { assert } from "@/lib/errors";
import { broadcastInvalidation, CHANNEL_GROUPS, kitchenChannel } from "@/lib/server/realtime-broadcast";

export async function POST(req: NextRequest, context: { params: Promise<{ orderId: string }> }) {
  try {
    const actor = await requireSession(req, { actorTypes: ["POS", "ADMIN"] });
    const body = await parseJson(req, orderConfirmSchema);
    const { orderId } = await context.params;

    const order = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
      const existing = await tx.order.findUnique({ where: { id: orderId } });
      assert(existing?.paymentMethod !== "SQUARE", 409, "SQUARE_RECONCILIATION_REQUIRED", "Square決済は専用の照合操作を利用してください");
      const updated = await confirmOrderPayment(tx, {
        actorId: actor.actorId,
        actorType: actor.actorType,
        orderId,
        result: body.result,
        squareTransactionId: body.squareTransactionId,
        reasonText: body.reasonText
      });

      const kitchenChannels = updated.items
        .map((item) => item.kitchenId)
        .filter((kitchenId): kitchenId is string => Boolean(kitchenId))
        .map((kitchenId) => kitchenChannel(kitchenId));

      await broadcastInvalidation(
        tx,
        [...CHANNEL_GROUPS.ORDER_FLOW, ...kitchenChannels],
        "orders",
        "order_confirmed"
      );

      return updated;
    });

    return ok({ order });
  } catch (error) {
    return fail(error);
  }
}
