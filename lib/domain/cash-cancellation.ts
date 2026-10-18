import type { ActorType, Prisma } from "@prisma/client";
import { assert } from "@/lib/errors";
import { appendOrderEvent } from "@/lib/domain/orders";
import { releaseMenuDailyCountsForOrder } from "@/lib/domain/menu-cap";
import { writeAuditLog } from "@/lib/domain/audit";
import { canCancelCashOrder } from "@/lib/domain/cash-cancel-eligibility";

export async function cancelCashOrder(db: Prisma.TransactionClient, params: {
  actorId: string;
  actorType: ActorType;
  orderId: string;
  reasonText: string;
}) {
  assert(["POS", "ADMIN"].includes(params.actorType), 403, "FORBIDDEN", "注文取消はPOSまたは管理者のみ操作できます");
  // Serving and serving undo lock this same row before changing any item.
  await db.$queryRaw`SELECT id FROM "Order" WHERE id = ${params.orderId} FOR UPDATE`;
  const order = await db.order.findUnique({ where: { id: params.orderId }, include: { items: true } });
  assert(order, 404, "ORDER_NOT_FOUND", "Order not found");
  if (order.paymentMethod === "CASH" && order.orderStatus === "CANCELED" && order.canceledAt) {
    return order;
  }
  assert(canCancelCashOrder(order), 409, "CASH_CANCEL_NOT_ALLOWED", "現金会計済みで、現在提供済みの商品がない注文のみ取り消せます");
  const reasonText = params.reasonText.trim();
  assert(reasonText.length > 0 && reasonText.length <= 500, 400, "CANCEL_REASON_REQUIRED", "取消理由を入力してください");
  const canceledAt = new Date();
  await db.orderItem.updateMany({ where: { orderId: order.id }, data: { status: "CANCELED" } });
  await db.order.update({
    where: { id: order.id },
    data: {
      orderStatus: "CANCELED",
      paymentStatus: "CANCELED",
      canceledAt,
      lastCalledAt: null,
      paymentAwaitDeadlineAt: null,
      autoCancelDeadlineAt: null,
      lastMutationVersion: { increment: 1 },
    },
  });
  await releaseMenuDailyCountsForOrder(db, order.id);
  await appendOrderEvent(db, order.id, {
    type: "ORDER_CANCELED",
    at: canceledAt.toISOString(),
    actorId: params.actorId,
    detail: { reasonType: "CASH_ORDER_VOID", reasonText },
  });
  await writeAuditLog(db, {
    actorId: params.actorId,
    actorType: params.actorType,
    actionType: "ORDER_CANCELED",
    entityType: "order",
    entityId: order.id,
    orderId: order.id,
    beforeJson: { paymentStatus: order.paymentStatus, orderStatus: order.orderStatus, totalPriceJpy: order.totalPriceJpy },
    afterJson: { paymentStatus: "CANCELED", orderStatus: "CANCELED", canceledAt: canceledAt.toISOString() },
    reasonType: "CASH_ORDER_VOID",
    reasonText,
    result: "SUCCESS",
  });
  return db.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
}
