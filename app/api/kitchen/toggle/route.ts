import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { kitchenToggleSchema } from "@/lib/validation";
import { parseJson } from "@/lib/server/http";
import { toggleKitchenState } from "@/lib/domain/kitchen";
import { withRouteTrace, traceError } from "@/lib/server/trace";
import { AppError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  return withRouteTrace(req, "kitchen/toggle.POST", async (trace) => {
    try {
      trace("auth.start");
      const actor = await requireSession(req, { actorTypes: ["KITCHEN", "ADMIN"] });
      trace("auth.ok", { actorId: actor.actorId, actorType: actor.actorType });

      trace("parseJson.start");
      const body = await parseJson(req, kitchenToggleSchema);
      trace("parseJson.ok", { kitchenId: body.kitchenId, kitchenEnabled: body.kitchenEnabled });

      if (actor.actorType === "KITCHEN" && actor.actorId !== body.kitchenId) {
        throw new AppError(403, "FORBIDDEN", "Kitchen can only toggle own kitchen");
      }

      trace("tx.toggle.start");
      const kitchen = await prisma.$transaction((tx) =>
        toggleKitchenState(tx, {
          actorId: actor.actorId,
          actorType: actor.actorType,
          kitchenId: body.kitchenId,
          kitchenEnabled: body.kitchenEnabled
        })
      );
      trace("tx.toggle.ok");

      return ok({ kitchen });
    } catch (error) {
      traceError(trace, "error", error);
      return fail(error);
    }
  });
}