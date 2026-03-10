import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { parseJson } from "@/lib/server/http";
import { lineReassignSchema } from "@/lib/validation";
import { reassignQueuedFromDisabledLine } from "@/lib/domain/kitchen";
import { AppError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["KITCHEN", "ADMIN"] });
    const body = await parseJson(req, lineReassignSchema);

    if (actor.actorType === "KITCHEN" && actor.lineId !== body.fromLineId) {
      throw new AppError(403, "FORBIDDEN", "Kitchen can only reassign from own line");
    }

    const result = await prisma.$transaction((tx) =>
      reassignQueuedFromDisabledLine(tx, {
        actorId: actor.actorId,
        actorType: actor.actorType,
        fromLineId: body.fromLineId,
        toLineId: body.toLineId
      })
    );

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}


