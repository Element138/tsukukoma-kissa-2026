import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { assert } from "@/lib/errors";
import { parseJson } from "@/lib/server/http";
import { fail, ok } from "@/lib/response";
import { refundOrderItems } from "@/lib/domain/item-refunds";
import { broadcastInvalidation, CHANNEL_GROUPS } from "@/lib/server/realtime-broadcast";

export async function GET(req: NextRequest, context: { params: Promise<{ orderId:string }> }) {
  try {
    await requireSession(req,{actorTypes:["POS","ADMIN"]});
    const {orderId}=await context.params;
    const order=await prisma.order.findUnique({where:{id:orderId},select:{id:true,orderNo:true,paymentMethod:true,paymentStatus:true,confirmedAt:true,
      items:{select:{id:true,itemNameSnapshot:true,unitPriceJpy:true,status:true}},refunds:{select:{id:true,amountJpy:true,confirmedAt:true},orderBy:{confirmedAt:"desc"}}}});
    assert(order,404,"ORDER_NOT_FOUND","注文が見つかりません");return ok({order},{headers:{"Cache-Control":"private, no-store"}});
  }catch(e){return fail(e);}
}
export async function POST(req: NextRequest, context: { params: Promise<{ orderId:string }> }) {
  try {
    const actor=await requireSession(req,{actorTypes:["POS","ADMIN"]});
    assert(req.headers.get("origin")===req.nextUrl.origin,403,"FORBIDDEN","同一サイトから操作してください");
    const {orderId}=await context.params;
    const body=await parseJson(req,z.object({itemIds:z.array(z.string().min(1)).min(1).max(1000),reasonText:z.string().trim().min(1).max(500),
      expectedAmountJpy:z.number().int().nonnegative(),idempotencyKey:z.string().uuid(),cashRefundConfirmed:z.literal(true)}).strict());
    const refund=await prisma.$transaction(async tx=>{const result=await refundOrderItems(tx,{...body,orderId,actorId:actor.actorId,actorType:actor.actorType});
      await broadcastInvalidation(tx,CHANNEL_GROUPS.ORDER_FLOW,"orders","order_items_refunded");return result;},{maxWait:10000,timeout:20000});
    return ok({refund});
  }catch(e){return fail(e);}
}
