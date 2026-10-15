import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { serveItemSchema } from "@/lib/validation";
import { serveDineInItem } from "@/lib/domain/counter";
import { broadcastInvalidation, CHANNEL_GROUPS } from "@/lib/server/realtime-broadcast";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["WAITER"] });
    const body = await parseJson(req, serveItemSchema);

    const order = await prisma.$transaction(async (tx) => {
      const updated = await serveDineInItem(tx, {
        actorId: actor.actorId,
        orderItemId: body.orderItemId,
        confirmUncalled: body.confirmUncalled,
      });

      await broadcastInvalidation(tx, CHANNEL_GROUPS.ORDER_FLOW, "orders", "counter_item_served");
      return updated;
    });

    return ok({ order });
  } catch (error) {
    return fail(error);
  }
}
