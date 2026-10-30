import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { orderCancelSchema } from "@/lib/validation";
import { parseJson } from "@/lib/server/http";
import { cancelPendingOrder } from "@/lib/domain/orders";
import { assert } from "@/lib/errors";
import { broadcastInvalidation, CHANNEL_GROUPS } from "@/lib/server/realtime-broadcast";

export async function POST(req: NextRequest, context: { params: Promise<{ orderId: string }> }) {
  try {
    const actor = await requireSession(req, { actorTypes: ["POS", "ADMIN"] });
    const body = await parseJson(req, orderCancelSchema);
    const { orderId } = await context.params;

    const order = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
      const existing = await tx.order.findUnique({ where: { id: orderId } });
      assert(!existing?.confirmedAt,409,"REFUND_CONFIRM_REQUIRED","会計済み注文は取消・返金画面で商品と現金返金を確認してください");
      assert(existing?.paymentMethod !== "SQUARE", 409, "SQUARE_RECONCILIATION_REQUIRED", "Square決済は専用の照合操作を利用してください");
      const updated = await cancelPendingOrder(tx, {
            actorId: actor.actorId,
            actorType: actor.actorType,
            orderId,
            reasonText: body.reasonText
          });

      await broadcastInvalidation(tx, CHANNEL_GROUPS.ORDER_FLOW, "orders", "order_canceled");
      return updated;
    });

    return ok({ order });
  } catch (error) {
    return fail(error);
  }
}
