import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { specialNoteSchema } from "@/lib/validation";
import { parseJson } from "@/lib/server/http";
import { markOrderSpecialNote } from "@/lib/domain/orders";
import { broadcastInvalidation, CHANNEL_GROUPS } from "@/lib/server/realtime-broadcast";

export async function PATCH(req: NextRequest, context: { params: Promise<{ orderId: string }> }) {
  try {
    const actor = await requireSession(req, { actorTypes: ["POS", "ADMIN"] });
    const body = await parseJson(req, specialNoteSchema);
    const { orderId } = await context.params;

    const order = await prisma.$transaction(async (tx) => {
      const updated = await markOrderSpecialNote(tx, {
        actorId: actor.actorId,
        actorType: actor.actorType,
        orderId,
        specialNote: body.specialNote
      });

      await broadcastInvalidation(tx, CHANNEL_GROUPS.ORDER_FLOW, "orders", "order_note_updated");
      return updated;
    });

    return ok({ order });
  } catch (error) {
    return fail(error);
  }
}
