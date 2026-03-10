import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { orderConfirmSchema } from "@/lib/validation";
import { parseJson } from "@/lib/server/http";
import { confirmOrderPayment } from "@/lib/domain/orders";

export async function POST(req: NextRequest, context: { params: Promise<{ orderId: string }> }) {
  try {
    const actor = await requireSession(req, { actorTypes: ["POS", "ADMIN"] });
    const body = await parseJson(req, orderConfirmSchema);
    const { orderId } = await context.params;

    const order = await prisma.$transaction((tx) =>
      confirmOrderPayment(tx, {
        actorId: actor.actorId,
        actorType: actor.actorType,
        orderId,
        result: body.result,
        squareTransactionId: body.squareTransactionId,
        reasonText: body.reasonText
      })
    );

    return ok({ order });
  } catch (error) {
    return fail(error);
  }
}


