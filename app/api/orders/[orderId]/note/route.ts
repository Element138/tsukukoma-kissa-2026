import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { specialNoteSchema } from "@/lib/validation";
import { parseJson } from "@/lib/server/http";
import { markOrderSpecialNote } from "@/lib/domain/orders";

export async function PATCH(req: NextRequest, context: { params: Promise<{ orderId: string }> }) {
  try {
    const actor = await requireSession(req, { actorTypes: ["POS", "ADMIN"] });
    const body = await parseJson(req, specialNoteSchema);
    const { orderId } = await context.params;

    const order = await prisma.$transaction((tx) =>
      markOrderSpecialNote(tx, {
        actorId: actor.actorId,
        actorType: actor.actorType,
        orderId,
        specialNote: body.specialNote
      })
    );

    return ok({ order });
  } catch (error) {
    return fail(error);
  }
}


