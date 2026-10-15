import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { parseJson } from "@/lib/server/http";
import { fail, ok } from "@/lib/response";
import { updateOrderCall } from "@/lib/domain/order-calls";
import { broadcastInvalidation, CHANNEL_GROUPS } from "@/lib/server/realtime-broadcast";
export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["WAITER"] });
    const body = await parseJson(req, z.object({ orderId: z.string().min(1), action: z.enum(["call", "cancel"]).default("call"), confirm: z.literal(true), idempotencyKey: z.string().uuid() }));
    const result = await prisma.$transaction(async tx => {
      const updated = await updateOrderCall(tx, { actorId: actor.actorId, ...body });
      await broadcastInvalidation(tx, CHANNEL_GROUPS.ORDER_FLOW, "orders", body.action === "call" ? "order_called" : "order_call_canceled");
      return updated;
    });
    return ok(result);
  } catch (e) { return fail(e); }
}
