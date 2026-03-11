import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { parseJson } from "@/lib/server/http";
import { availabilityUpdateSchema } from "@/lib/validation";
import { updateMenuAvailabilityByKitchen } from "@/lib/domain/kitchen";
import { broadcastInvalidation, CHANNEL_GROUPS, kitchenChannel } from "@/lib/server/realtime-broadcast";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["KITCHEN"] });
    const body = await parseJson(req, availabilityUpdateSchema);

    const menu = await prisma.$transaction(async (tx) => {
      const updated = await updateMenuAvailabilityByKitchen(tx, {
        actorId: actor.actorId,
        kitchenId: actor.actorId,
        menuId: body.menuId,
        availability: body.availability
      });

      await broadcastInvalidation(
        tx,
        [...CHANNEL_GROUPS.MENUS, kitchenChannel(actor.actorId)],
        "menus",
        "menu_availability_updated"
      );

      return updated;
    });

    return ok({ menu });
  } catch (error) {
    return fail(error);
  }
}
