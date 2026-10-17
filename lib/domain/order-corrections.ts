import { ActorType, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { assert } from "@/lib/errors";
import { appendOrderEvent } from "@/lib/domain/orders";
import { writeAuditLog } from "@/lib/domain/audit";
import { resetExpiredReadyStock } from "@/lib/domain/daily-ready-stock";

export const orderCorrectionSchema = z.object({
  orderId: z.string().min(1),
  expectedVersion: z.number().int().nonnegative(),
  specialNote: z.string().max(500),
  excludeFromWaitStats: z.boolean(),
  manualClose: z.boolean().default(false),
}).strict();
type Db = PrismaClient | Prisma.TransactionClient;

export async function correctOrder(db: Db, actor: { actorId: string; actorType: ActorType }, input: z.infer<typeof orderCorrectionSchema>) {
  const allowed = input.manualClose ? ["POS", "KITCHEN", "WAITER", "ADMIN"] : ["POS", "ADMIN"];
  assert(allowed.includes(actor.actorType), 403, "FORBIDDEN", "注文の変更権限がありません");
  const initial = await db.orderItem.findMany({where:{orderId:input.orderId},select:{menuId:true}});
  const menuIds = [...new Set(initial.map(item=>item.menuId))].sort();
  if (input.manualClose) for (const menuId of menuIds) await db.$queryRaw`SELECT id FROM "Menu" WHERE id = ${menuId} FOR UPDATE`;
  await db.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
  if (input.manualClose) await resetExpiredReadyStock(db, menuIds);
  const order = await db.order.findUnique({where:{id:input.orderId},include:{items:true}});
  assert(order,404,"ORDER_NOT_FOUND","注文が見つかりません");
  assert(order.lastMutationVersion === input.expectedVersion,409,"ORDER_CHANGED","注文が更新されています。再読み込みして変更内容を確認してください");
  assert(!input.manualClose || order.items.every(item=>menuIds.includes(item.menuId)),409,"ORDER_CHANGED","商品が変更されています。再読み込みしてください");
  const at = new Date();
  let specialNote = input.specialNote;
  if (input.manualClose && !specialNote.split(/\r?\n/).includes("手動完了")) specialNote = [specialNote,"手動完了"].filter(Boolean).join("\n");
  assert(specialNote.length<=500,400,"NOTE_TOO_LONG","備考と 手動完了 を合わせて500文字以内にしてください");
  const stockChanges: Array<{menuId:string;before:number;after:number}> = [];
  const remaining = order.items.filter(item=>item.status!=="SERVED" && item.status!=="CANCELED");
  if (input.manualClose) {
    assert(order.confirmedAt && ["PAID","SKIPPED"].includes(order.paymentStatus) && !order.canceledAt && !["COMPLETED","FAILED","CANCELED"].includes(order.orderStatus),409,"ORDER_LOCKED","確定済み・決済済みの未完了注文のみ手動完了できます");
    assert(order.items.length > 0 && order.items.every(item=>item.status!=="CANCELED"),409,"ORDER_LOCKED","取消商品を含む注文は手動完了できません");
    for (const menuId of menuIds) {
      const quantity = remaining.filter(item=>item.menuId===menuId).length;
      const stock = await db.menuStock.findUnique({where:{menuId}});
      const before = stock?.readyCount ?? 0;
      const after = Math.max(0,before-quantity);
      if (stock && after!==before) await db.menuStock.update({where:{menuId},data:{readyCount:after}});
      if (quantity) stockChanges.push({menuId,before,after});
    }
    await db.orderItem.updateMany({where:{orderId:order.id,id:{in:remaining.map(item=>item.id)}},data:{status:"SERVED",servedAt:at,servedByActorId:actor.actorId}});
  }
  const updated = await db.order.update({where:{id:order.id},data:{specialNote,excludeFromWaitStats:input.excludeFromWaitStats,lastMutationVersion:{increment:1},...(input.manualClose?{orderStatus:"COMPLETED",lastCalledAt:null}:{})}});
  const actionType = input.manualClose ? "MANUAL_CLOSURE" : "ORDER_STATISTICS_UPDATED";
  await appendOrderEvent(db,order.id,{type:actionType,at:at.toISOString(),actorId:actor.actorId,detail:{excludeFromWaitStats:input.excludeFromWaitStats,servedItemIds:input.manualClose?remaining.map(item=>item.id):[]}});
  await writeAuditLog(db,{...actor,actionType,entityType:"order",entityId:order.id,orderId:order.id,beforeJson:{specialNote:order.specialNote,excludeFromWaitStats:order.excludeFromWaitStats,orderStatus:order.orderStatus,lastCalledAt:order.lastCalledAt?.toISOString()??null,items:order.items.map(item=>({id:item.id,status:item.status,servedAt:item.servedAt?.toISOString()??null}))},afterJson:{specialNote:updated.specialNote,excludeFromWaitStats:updated.excludeFromWaitStats,orderStatus:updated.orderStatus,servedAt:input.manualClose?at.toISOString():null,servedItemIds:input.manualClose?remaining.map(item=>item.id):[],stockChanges},reasonText:input.manualClose?"manual closure":null,result:"SUCCESS"});
  return updated;
}
