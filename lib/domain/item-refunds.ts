import { createHash } from "node:crypto";
import type { ActorType, Prisma } from "@prisma/client";
import { assert } from "@/lib/errors";
import { appendOrderEvent, recalcAndPersistOrderStatus } from "./orders";
import { writeAuditLog } from "./audit";

export async function refundOrderItems(db: Prisma.TransactionClient, input: {
  actorId: string; actorType: ActorType; orderId: string; itemIds: string[];
  reasonText: string; expectedAmountJpy: number; idempotencyKey: string; cashRefundConfirmed: boolean;
}) {
  assert(["POS", "ADMIN"].includes(input.actorType), 403, "FORBIDDEN", "POSまたは管理者のみ取消・返金できます");
  const reason = input.reasonText.trim();
  assert(reason.length > 0 && reason.length <= 500 && input.cashRefundConfirmed === true, 400, "REFUND_CONFIRM_REQUIRED", "理由と現金返金の確認が必要です");
  assert(input.itemIds.length > 0 && new Set(input.itemIds).size === input.itemIds.length, 400, "INVALID_REFUND_ITEMS", "取消商品を選択してください");
  const hash = createHash("sha256").update(JSON.stringify([input.actorId,input.orderId,[...input.itemIds].sort(),reason,input.expectedAmountJpy])).digest("hex");
  const initial = await db.orderItem.findMany({ where: { orderId: input.orderId }, select: { menuId: true } });
  const menuIds = [...new Set(initial.map(item=>item.menuId))].sort();
  // Match serving and undo lock order; never lock Order before Menu.
  for (const id of menuIds) await db.$queryRaw`SELECT id FROM "Menu" WHERE id = ${id} FOR UPDATE`;
  await db.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
  const existing = await db.orderRefund.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    assert(existing.requestHash === hash, 409, "IDEMPOTENCY_CONFLICT", "再送内容が一致しません");
    return existing;
  }
  const order = await db.order.findUnique({ where: { id: input.orderId }, include: { items: true } });
  assert(order?.confirmedAt && order.paymentStatus === "PAID" && ["CASH","SQUARE"].includes(order.paymentMethod), 409, "REFUND_NOT_ALLOWED", "会計済みの現金・Square注文のみ返金できます");
  assert(order.items.every(item=>menuIds.includes(item.menuId)),409,"ORDER_CHANGED","注文内容が変わりました。更新してください");
  const selected = order.items.filter(item=>input.itemIds.includes(item.id));
  assert(selected.length === input.itemIds.length && selected.every(item=>item.status !== "CANCELED"),409,"REFUND_ITEMS_CHANGED","対象商品が変更または取消済みです。更新してください");
  const amountJpy = selected.reduce((sum,item)=>sum+item.unitPriceJpy,0);
  assert(Number.isSafeInteger(amountJpy) && amountJpy >= 0 && amountJpy === input.expectedAmountJpy,409,"REFUND_AMOUNT_CHANGED","返金額が変更されています。再確認してください");
  const refund = await db.orderRefund.create({ data: { orderId: order.id, actorId: input.actorId, idempotencyKey: input.idempotencyKey,
    requestHash: hash, reasonText: reason, amountJpy, items: { create: selected.map(item=>({ orderItemId:item.id,name:item.itemNameSnapshot,unitPriceJpy:item.unitPriceJpy,previousStatus:item.status })) } } });
  await db.orderItem.updateMany({ where: { id: { in: input.itemIds }, orderId: order.id }, data: { status: "CANCELED" } });
  const quantities = new Map<string,number>();
  for(const item of selected) quantities.set(item.menuId,(quantities.get(item.menuId)??0)+1);
  const reservations = await db.orderMenuCapReservation.findMany({ where: { orderId: order.id, releasedAt: null }, orderBy: { menuId:"asc" } });
  for(const reservation of reservations) {
    const quantity = Math.min(quantities.get(reservation.menuId)??0,reservation.quantity-reservation.releasedQuantity);
    if(quantity<=0)continue;
    await db.$queryRaw`SELECT "menuId" FROM "MenuDailyCount" WHERE "menuId"=${reservation.menuId} AND "jstDate"=${reservation.jstDate} FOR UPDATE`;
    // A cap reset can retire a reservation while we wait; do not subtract from the new counter.
    const changed = await db.orderMenuCapReservation.updateMany({ where: { orderId:order.id,menuId:reservation.menuId,releasedAt:null,releasedQuantity:reservation.releasedQuantity },
      data: { releasedQuantity:{increment:quantity}, ...(reservation.releasedQuantity+quantity===reservation.quantity?{releasedAt:refund.confirmedAt}:{}) } });
    if(changed.count) await db.$executeRaw`UPDATE "MenuDailyCount" SET "count"=GREATEST(0,"count"-${quantity}),"updatedAt"=CURRENT_TIMESTAMP WHERE "menuId"=${reservation.menuId} AND "jstDate"=${reservation.jstDate}`;
  }
  const allCanceled = order.items.every(item=>item.status === "CANCELED" || input.itemIds.includes(item.id));
  await db.order.update({ where:{id:order.id},data:{lastCalledAt:null,...(allCanceled?{paymentStatus:"CANCELED",canceledAt:refund.confirmedAt}:{}),lastMutationVersion:{increment:1}} });
  await recalcAndPersistOrderStatus(db,order.id,false);
  await appendOrderEvent(db,order.id,{type:allCanceled?"ORDER_CANCELED":"ORDER_ITEMS_REFUNDED",at:refund.confirmedAt.toISOString(),actorId:input.actorId,
    detail:{reasonType:"CASH_REFUND_CONFIRMED",reasonText:reason,refundId:refund.id,amountJpy,itemIds:input.itemIds,originalPaymentMethod:order.paymentMethod}});
  await writeAuditLog(db,{actorId:input.actorId,actorType:input.actorType,actionType:"ORDER_ITEMS_REFUNDED",entityType:"order_refund",entityId:refund.id,orderId:order.id,
    correlationId:input.idempotencyKey,reasonText:reason,beforeJson:{paymentMethod:order.paymentMethod,orderStatus:order.orderStatus},
    afterJson:{refundId:refund.id,amountJpy,itemIds:input.itemIds,confirmedAt:refund.confirmedAt.toISOString(),refundMethod:"CASH"},result:"SUCCESS"});
  return refund;
}
