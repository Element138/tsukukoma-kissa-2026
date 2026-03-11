import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { parseJson } from "@/lib/server/http";
import { kitchenReassignSchema } from "@/lib/validation";
import { reassignQueuedFromDisabledKitchen } from "@/lib/domain/kitchen";
import { AppError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["KITCHEN", "ADMIN"] });
    const body = await parseJson(req, kitchenReassignSchema);

    if (actor.actorType === "KITCHEN" && actor.actorId !== body.fromKitchenId) {
      throw new AppError(403, "FORBIDDEN", "Kitchen can only reassign from own kitchen");
    }

    const result = await prisma.$transaction((tx) =>
      reassignQueuedFromDisabledKitchen(tx, {
        actorId: actor.actorId,
        actorType: actor.actorType,
        fromKitchenId: body.fromKitchenId,
        toKitchenId: body.toKitchenId
      })
    );

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
