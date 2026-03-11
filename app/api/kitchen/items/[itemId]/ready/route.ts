import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { itemReadySchema } from "@/lib/validation";
import { parseJson } from "@/lib/server/http";
import { markKitchenItemReady } from "@/lib/domain/kitchen";
import { broadcastInvalidation, CHANNEL_GROUPS, kitchenChannel } from "@/lib/server/realtime-broadcast";

export async function POST(req: NextRequest, context: { params: Promise<{ itemId: string }> }) {
  try {
    const actor = await requireSession(req, { actorTypes: ["KITCHEN"] });
    await parseJson(req, itemReadySchema);

    const { itemId } = await context.params;

    const result = await prisma.$transaction(async (tx) => {
      const updated = await markKitchenItemReady(tx, {
        actorId: actor.actorId,
        kitchenId: actor.actorId,
        itemId
      });

      await broadcastInvalidation(
        tx,
        [...CHANNEL_GROUPS.ORDER_FLOW, kitchenChannel(actor.actorId)],
        "orders",
        "kitchen_item_ready"
      );

      return updated;
    });

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
