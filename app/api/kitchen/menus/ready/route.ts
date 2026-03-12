import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { parseJson } from "@/lib/server/http";
import { kitchenMenuReadySchema } from "@/lib/validation";
import { markKitchenMenuItemsReady } from "@/lib/domain/kitchen";
import { broadcastInvalidation, CHANNEL_GROUPS, kitchenChannel } from "@/lib/server/realtime-broadcast";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["KITCHEN"] });
    const body = await parseJson(req, kitchenMenuReadySchema);

    const result = await prisma.$transaction(async (tx) => {
      const updated = await markKitchenMenuItemsReady(tx, {
        actorId: actor.actorId,
        kitchenId: actor.actorId,
        menuId: body.menuId,
        quantity: body.quantity,
        idempotencyKey: body.idempotencyKey
      });

      await broadcastInvalidation(
        tx,
        [...CHANNEL_GROUPS.ORDER_FLOW, kitchenChannel(actor.actorId)],
        "orders",
        "kitchen_menu_ready"
      );

      return updated;
    });

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}