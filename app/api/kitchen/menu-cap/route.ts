import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { updateMenuCapByKitchen } from "@/lib/domain/kitchen";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { broadcastInvalidation, CHANNEL_GROUPS, kitchenChannel } from "@/lib/server/realtime-broadcast";
import { kitchenMenuCapUpdateSchema } from "@/lib/validation";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["KITCHEN"] });
    const body = await parseJson(req, kitchenMenuCapUpdateSchema);

    const menu = await prisma.$transaction(async (tx) => {
      const updated = await updateMenuCapByKitchen(tx, {
        actorId: actor.actorId,
        kitchenId: actor.actorId,
        menuId: body.menuId,
        dailyOrderCap: body.dailyOrderCap,
      });

      await broadcastInvalidation(
        tx,
        [...CHANNEL_GROUPS.MENUS, ...CHANNEL_GROUPS.ORDER_FLOW, kitchenChannel(actor.actorId)],
        "menus",
        "menu_daily_cap_updated",
      );

      return updated;
    });

    return ok({ menu });
  } catch (error) {
    return fail(error);
  }
}
