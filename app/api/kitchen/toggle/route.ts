import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { kitchenToggleSchema } from "@/lib/validation";
import { parseJson } from "@/lib/server/http";
import { toggleKitchenState } from "@/lib/domain/kitchen";
import { AppError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["KITCHEN", "ADMIN"] });
    const body = await parseJson(req, kitchenToggleSchema);

    if (actor.actorType === "KITCHEN" && actor.actorId !== body.kitchenId) {
      throw new AppError(403, "FORBIDDEN", "Kitchen can only toggle own kitchen");
    }

    const kitchen = await prisma.$transaction((tx) =>
      toggleKitchenState(tx, {
        actorId: actor.actorId,
        actorType: actor.actorType,
        kitchenId: body.kitchenId,
        kitchenEnabled: body.kitchenEnabled
      })
    );

    return ok({ kitchen });
  } catch (error) {
    return fail(error);
  }
}
