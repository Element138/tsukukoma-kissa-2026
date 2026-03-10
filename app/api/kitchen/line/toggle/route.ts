import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { lineToggleSchema } from "@/lib/validation";
import { parseJson } from "@/lib/server/http";
import { toggleLineState } from "@/lib/domain/kitchen";
import { AppError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["KITCHEN", "ADMIN"] });
    const body = await parseJson(req, lineToggleSchema);

    if (actor.actorType === "KITCHEN" && actor.lineId !== body.lineId) {
      throw new AppError(403, "FORBIDDEN", "Kitchen can only toggle own line");
    }

    const line = await prisma.$transaction((tx) =>
      toggleLineState(tx, {
        actorId: actor.actorId,
        actorType: actor.actorType,
        lineId: body.lineId,
        isActive: body.isActive
      })
    );

    return ok({ line });
  } catch (error) {
    return fail(error);
  }
}


