import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { serveOrderSchema } from "@/lib/validation";
import { serveReadyItemsForOrder } from "@/lib/domain/counter";
import { broadcastInvalidation, CHANNEL_GROUPS } from "@/lib/server/realtime-broadcast";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["WAITER"] });
    const body = await parseJson(req, serveOrderSchema);

    const order = await prisma.$transaction(async (tx) => {
      const updated = await serveReadyItemsForOrder(tx, {
        actorId: actor.actorId,
        orderId: body.orderId,
      });

      await broadcastInvalidation(tx, CHANNEL_GROUPS.ORDER_FLOW, "orders", "counter_order_served");
      return updated;
    });

    return ok({ order });
  } catch (error) {
    return fail(error);
  }
}
