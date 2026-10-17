import { NextRequest } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { parseJson } from "@/lib/server/http";
import { serveCounterOrder } from "@/lib/domain/counter";
import { broadcastInvalidation, CHANNEL_GROUPS } from "@/lib/server/realtime-broadcast";
const schema = z.object({
  orderId: z.string().min(1).max(128), idempotencyKey: z.string().uuid(),
  expectedItemIds: z.array(z.string().min(1).max(128)).min(2).max(1000),
  expectedPlan: z.array(z.object({ menuId: z.string().min(1).max(128), waitingCount: z.number().int().min(1), servableCount: z.number().int().min(0) })).min(1).max(1000),
  confirmPartial: z.boolean().optional(), confirmUncalled: z.boolean().optional(),
});
export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["WAITER"] });
    const body = await parseJson(req,schema);
    const result = await prisma.$transaction(async tx=>{
      const result = await serveCounterOrder(tx,{ ...body, actorId: actor.actorId });
      await broadcastInvalidation(tx,CHANNEL_GROUPS.ORDER_FLOW,"orders","counter_order_served");
      return result;
    },{ maxWait:10000,timeout:20000 });
    return ok(result);
  } catch (e) { return fail(e); }
}
