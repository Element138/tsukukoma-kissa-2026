import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { orderCancelSchema } from "@/lib/validation";
import { parseJson } from "@/lib/server/http";
import { cancelPendingOrder } from "@/lib/domain/orders";

export async function POST(req: NextRequest, context: { params: Promise<{ orderId: string }> }) {
  try {
    const actor = await requireSession(req, { actorTypes: ["POS", "ADMIN"] });
    const body = await parseJson(req, orderCancelSchema);
    const { orderId } = await context.params;

    const order = await prisma.$transaction((tx) =>
      cancelPendingOrder(tx, {
        actorId: actor.actorId,
        actorType: actor.actorType,
        orderId,
        reasonText: body.reasonText
      })
    );

    return ok({ order });
  } catch (error) {
    return fail(error);
  }
}


