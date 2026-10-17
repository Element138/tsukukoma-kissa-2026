import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { parseJson } from "@/lib/server/http";
import { fail, ok } from "@/lib/response";
import { correctOrder, orderCorrectionSchema } from "@/lib/domain/order-corrections";
import { broadcastInvalidation, CHANNEL_GROUPS } from "@/lib/server/realtime-broadcast";

export async function GET(req: NextRequest) {
  try {
    await requireSession(req,{actorTypes:["ADMIN"]});
    const orderNo = z.coerce.number().int().positive().optional().parse(req.nextUrl.searchParams.get("orderNo")??undefined);
    const orders = await prisma.order.findMany({where:orderNo?{orderNo}:{orderStatus:{in:["PENDING","PREPARING","AWAITING_SERVING"]}},orderBy:{orderNo:"asc"},take:100,select:{id:true,orderNo:true,orderStatus:true,paymentStatus:true,confirmedAt:true,specialNote:true,excludeFromWaitStats:true,lastMutationVersion:true,items:{select:{status:true}}}});
    return ok({orders});
  } catch(error) {return fail(error);}
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireSession(req,{actorTypes:["ADMIN"]});
    const body = await parseJson(req,z.object({changes:z.array(orderCorrectionSchema).min(1).max(100)}).strict());
    const orders = await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "Actor" WHERE id = ${actor.actorId} FOR UPDATE`;
      const menuIds=[...new Set((await tx.orderItem.findMany({where:{orderId:{in:body.changes.map(change=>change.orderId)}},select:{menuId:true}})).map(item=>item.menuId))].sort();
      for (const id of menuIds) await tx.$queryRaw`SELECT id FROM "Menu" WHERE id = ${id} FOR UPDATE`;
      const results=[];
      for (const change of [...body.changes].sort((a,b)=>a.orderId.localeCompare(b.orderId))) results.push(await correctOrder(tx,actor,change));
      await broadcastInvalidation(tx,CHANNEL_GROUPS.ORDER_FLOW,"orders","admin_order_correction");
      return results;
    },{timeout:30000});
    return ok({orders});
  } catch(error) {return fail(error);}
}
