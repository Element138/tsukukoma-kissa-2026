import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { parseJson } from "@/lib/server/http";
import { kitchenReassignSchema } from "@/lib/validation";
import { reassignQueuedFromDisabledKitchen } from "@/lib/domain/kitchen";
import { AppError } from "@/lib/errors";
import { broadcastInvalidation, CHANNEL_GROUPS, kitchenChannel } from "@/lib/server/realtime-broadcast";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["KITCHEN", "ADMIN"] });
    const body = await parseJson(req, kitchenReassignSchema);

    if (actor.actorType === "KITCHEN" && actor.actorId !== body.fromKitchenId) {
      throw new AppError(403, "FORBIDDEN", "Kitchen can only reassign from own kitchen");
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await reassignQueuedFromDisabledKitchen(tx, {
        actorId: actor.actorId,
        actorType: actor.actorType,
        fromKitchenId: body.fromKitchenId,
        toKitchenId: body.toKitchenId
      });

      await broadcastInvalidation(
        tx,
        [
          ...CHANNEL_GROUPS.ORDER_FLOW,
          kitchenChannel(body.fromKitchenId),
          kitchenChannel(body.toKitchenId)
        ],
        "orders",
        "kitchen_reassign"
      );

      return updated;
    });

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
