import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { parseJson } from "@/lib/server/http";
import { fail, ok } from "@/lib/response";
import { assert } from "@/lib/errors";
import { correctOrder } from "@/lib/domain/order-corrections";
import { broadcastInvalidation, CHANNEL_GROUPS } from "@/lib/server/realtime-broadcast";

export async function POST(req: NextRequest, context: {params:Promise<{orderId:string}>}) {
  try {
    const actor=await requireSession(req,{actorTypes:["POS","KITCHEN","WAITER","ADMIN"]});
    const body=await parseJson(req,z.object({expectedVersion:z.number().int().nonnegative(),confirm:z.literal(true)}).strict());
    const {orderId}=await context.params;
    const order=await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "Actor" WHERE id = ${actor.actorId} FOR UPDATE`;
      const current=await tx.order.findUnique({where:{id:orderId},select:{specialNote:true,excludeFromWaitStats:true}});
      assert(current,404,"ORDER_NOT_FOUND","注文が見つかりません");
      const updated=await correctOrder(tx,actor,{orderId,expectedVersion:body.expectedVersion,manualClose:true,specialNote:current.specialNote??"",excludeFromWaitStats:current.excludeFromWaitStats});
      await broadcastInvalidation(tx,CHANNEL_GROUPS.ORDER_FLOW,"orders","manual_closure");
      return updated;
    },{timeout:30000});
    return ok({order});
  } catch(error){return fail(error);}
}
