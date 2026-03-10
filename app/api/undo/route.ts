import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { undoSchema } from "@/lib/validation";
import { executeUndo } from "@/lib/domain/undo";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["KITCHEN", "WAITER"] });
    await parseJson(req, undoSchema);

    const result = await prisma.$transaction((tx) =>
      executeUndo(tx, {
        actorId: actor.actorId,
        actorType: actor.actorType
      })
    );

    return ok({ result });
  } catch (error) {
    return fail(error);
  }
}


