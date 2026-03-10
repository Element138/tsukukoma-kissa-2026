import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { availabilityUpdateSchema } from "@/lib/validation";
import { updateMenuAvailabilityByKitchen } from "@/lib/domain/kitchen";
import { AppError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["KITCHEN"] });
    if (!actor.lineId) {
      throw new AppError(400, "LINE_REQUIRED", "Kitchen line is missing");
    }

    const body = await parseJson(req, availabilityUpdateSchema);

    const menu = await prisma.$transaction((tx) =>
      updateMenuAvailabilityByKitchen(tx, {
        actorId: actor.actorId,
        lineId: actor.lineId!,
        menuId: body.menuId,
        availability: body.availability
      })
    );

    return ok({ menu });
  } catch (error) {
    return fail(error);
  }
}


