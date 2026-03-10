import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { serveItemSchema } from "@/lib/validation";
import { serveDineInItem } from "@/lib/domain/waiter";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["WAITER"] });
    const body = await parseJson(req, serveItemSchema);

    const order = await prisma.$transaction((tx) =>
      serveDineInItem(tx, {
        actorId: actor.actorId,
        orderItemId: body.orderItemId
      })
    );

    return ok({ order });
  } catch (error) {
    return fail(error);
  }
}


