import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { parseJson } from "@/lib/server/http";
import { fail, ok } from "@/lib/response";
import { markOrderAbsent } from "@/lib/domain/absent-orders";
import { broadcastInvalidation, CHANNEL_GROUPS } from "@/lib/server/realtime-broadcast";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["WAITER"] });
    const body = await parseJson(req, z.object({ orderId: z.string().min(1), confirm: z.literal(true), idempotencyKey: z.string().uuid() }));
    const result = await prisma.$transaction(async tx => {
      const updated = await markOrderAbsent(tx, { actorId: actor.actorId, ...body });
      await broadcastInvalidation(tx, CHANNEL_GROUPS.ORDER_FLOW, "orders", "order_ghosted");
      return updated;
    });
    return ok(result);
  } catch (error) { return fail(error); }
}
