import {
  ActorType,
  OrderItemStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  PrismaClient
} from "@prisma/client";
import { AppError, assert } from "@/lib/errors";
import { aggregateOrderPrice, deriveOrderStatus } from "@/lib/domain/order-status";
import { assignUnassignedItemsForOrder } from "@/lib/domain/kitchen-assignment";
import { writeAuditLog } from "@/lib/domain/audit";
import { attachCashierPhoto, requirePhotoStorageAvailable } from "@/lib/domain/cashier-photos";
import { reserveMenuDailyCountsForOrder, releaseMenuDailyCountsForOrder } from "@/lib/domain/menu-cap";
import { now, secondsFromNow, tokyoDateKey } from "@/lib/time";

type DbClient = PrismaClient | Prisma.TransactionClient;
const SQUARE_AWAIT_TIMEOUT_SECONDS = 330;

type OrderEvent = {
  type: string;
  at: string;
  actorId?: string;
  detail?: Record<string, unknown>;
};

function asEvents(raw: Prisma.JsonValue | null): OrderEvent[] {
  if (!raw || !Array.isArray(raw)) {
    return [];
  }
  return raw as OrderEvent[];
}

export async function appendOrderEvent(db: DbClient, orderId: string, event: OrderEvent) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { events: true }
  });

  const events = asEvents(order?.events ?? null);
  await db.order.update({
    where: { id: orderId },
    data: {
      events: [...events, event] as Prisma.InputJsonValue
    }
  });
}

export async function findOpenSquareAwaitingOrderForPos(db: DbClient, actorId: string) {
  return db.order.findFirst({
    where: {
      createdByActorId: actorId,
      paymentMethod: "SQUARE",
      paymentStatus: "AWAITING",
      confirmedAt: null
    },
    select: {
      id: true,
      orderNo: true,
      createdAt: true,
      paymentAwaitDeadlineAt: true,
      totalPriceJpy: true,
      idempotencyKey: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });
}

export async function recalcAndPersistOrderStatus(db: DbClient, orderId: string, incrementVersion: boolean) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        select: { status: true }
      }
    }
  });
  assert(order, 404, "ORDER_NOT_FOUND", "Order not found");

  const nextStatus = deriveOrderStatus({
    paymentStatus: order.paymentStatus,
    fulfillmentType: order.fulfillmentType,
    items: order.items,
    canceledAt: order.canceledAt,
    confirmedAt: order.confirmedAt
  });

  return db.order.update({
    where: { id: orderId },
    data: {
      orderStatus: nextStatus,
      ...(nextStatus === "COMPLETED" ? { lastCalledAt: null } : {}),
      ...(incrementVersion
        ? {
            lastMutationVersion: {
              increment: 1
            }
          }
        : {})
    }
  });
}

function expandItems(menus: Map<string, { id: string; name: string; priceJpy: number; workloadSeconds: number }>,
  inputs: Array<{ menuId: string; quantity: number }>) {
  const expanded: Array<{
    menuId: string;
    itemNameSnapshot: string;
    unitPriceJpy: number;
    workloadSecondsSnapshot: number;
    status: OrderItemStatus;
  }> = [];

  for (const row of inputs) {
    const menu = menus.get(row.menuId);
    if (!menu) {
      throw new AppError(400, "MENU_NOT_FOUND", `menu not found: ${row.menuId}`);
    }

    for (let i = 0; i < row.quantity; i += 1) {
      expanded.push({
        menuId: menu.id,
        itemNameSnapshot: menu.name,
        unitPriceJpy: menu.priceJpy,
        workloadSecondsSnapshot: menu.workloadSeconds,
        status: "QUEUED"
      });
    }
  }

  return expanded;
}

export async function createOrderAtPaymentStart(
  db: Prisma.TransactionClient,
  params: {
    actorId: string;
    actorType: ActorType;
    payload: {
      fulfillmentType: "DINE_IN" | "TAKEOUT";
      tableNo?: number | null;
      partySize: number;
      ageRanges: string[];
      specialNote?: string;
      paymentMethod: PaymentMethod;
      paymentSkipReasonType?: "TEST" | "DEVICE_ERROR" | "NETWORK_ERROR" | "OTHER" | null;
      paymentSkipReasonText?: string | null;
      items: Array<{ menuId: string; quantity: number }>;
      idempotencyKey: string;
    };
  }
) {
  assert(params.actorType === "POS", 403, "FORBIDDEN", "Only POS can create orders");

  const duplicate = await db.order.findFirst({
    where: {
      createdByActorId: params.actorId,
      idempotencyKey: params.payload.idempotencyKey
    },
    include: {
      items: true
    }
  });

  if (duplicate) {
    return { order: duplicate, duplicated: true };
  }

  await requirePhotoStorageAvailable(db);

  const awaiting = await findOpenSquareAwaitingOrderForPos(db, params.actorId);
  if (awaiting) {
    throw new AppError(
      409,
      "POS_AWAITING_ORDER",
      `注文 #${awaiting.orderNo} のSquare決済結果を待機中です。先に決済を完了または失敗させてください。`
    );
  }

  const menuIds = [...new Set(params.payload.items.map((x) => x.menuId))];
  const menus = await db.menu.findMany({
    where: {
      id: { in: menuIds },
      isActive: true,
      availability: { in: ["AVAILABLE", "INCREASED_WAIT"] }
    },
    select: {
      id: true,
      name: true,
      priceJpy: true,
      workloadSeconds: true,
      dailyOrderCap: true
    }
  });

  if (menus.length !== menuIds.length) {
    throw new AppError(409, "MENU_UNAVAILABLE", "One or more menu items are unavailable");
  }

  const menuMap = new Map(menus.map((m) => [m.id, m]));
  const menuNameById = new Map(menus.map((menu) => [menu.id, menu.name]));
  const dailyOrderCapById = new Map(
    menus.map((menu) => [menu.id, menu.dailyOrderCap ?? null]),
  );
  const quantitiesByMenuId = new Map<string, number>();
  for (const item of params.payload.items) {
    quantitiesByMenuId.set(item.menuId, (quantitiesByMenuId.get(item.menuId) ?? 0) + item.quantity);
  }

  const createdAt = now();
  const capReservations = await reserveMenuDailyCountsForOrder(db, {
    menuNameById,
    dailyOrderCapById,
    quantitiesByMenuId,
    jstDate: tokyoDateKey(createdAt),
  });

  const expanded = expandItems(menuMap, params.payload.items);
  assert(expanded.length > 0, 400, "EMPTY_ITEMS", "Order must contain at least one item");

  const totalPriceJpy = aggregateOrderPrice(expanded);

  const initialEvents: OrderEvent[] = [
    {
      type: "PAYMENT_STARTED",
      at: createdAt.toISOString(),
      actorId: params.actorId,
      detail: {
        paymentMethod: params.payload.paymentMethod
      }
    }
  ];

  const shouldAutoConfirm =
    params.payload.paymentMethod === "CASH" || params.payload.paymentMethod === "PAYMENT_SKIPPED";

  const initialPaymentStatus: PaymentStatus =
    params.payload.paymentMethod === "CASH"
      ? "PAID"
      : params.payload.paymentMethod === "PAYMENT_SKIPPED"
        ? "SKIPPED"
        : "AWAITING";

  const order = await db.order.create({
    data: {
      createdByActorId: params.actorId,
      idempotencyKey: params.payload.idempotencyKey,
      createdAt,
      fulfillmentType: params.payload.fulfillmentType,
      tableNo: null,
      partySize: params.payload.partySize,
      ageRangesJson: params.payload.ageRanges as Prisma.InputJsonValue,
      specialNote: params.payload.specialNote ?? null,
      paymentMethod: params.payload.paymentMethod,
      paymentStatus: initialPaymentStatus,
      orderStatus: "PENDING",
      events: initialEvents as Prisma.InputJsonValue,
      paymentSkipReasonType: params.payload.paymentSkipReasonType ?? null,
      paymentSkipReasonText: params.payload.paymentSkipReasonText ?? null,
      totalPriceJpy,
      capReservations: { create: capReservations },
      paymentAwaitDeadlineAt:
        params.payload.paymentMethod === "SQUARE"
          ? secondsFromNow(SQUARE_AWAIT_TIMEOUT_SECONDS)
          : null,
      autoCancelDeadlineAt: null,
      items: {
        createMany: {
          data: expanded.map((item) => ({
            menuId: item.menuId,
            itemNameSnapshot: item.itemNameSnapshot,
            unitPriceJpy: item.unitPriceJpy,
            workloadSecondsSnapshot: item.workloadSecondsSnapshot,
            status: item.status,
            kitchenId: null,
            kitchenAssignedAt: null
          }))
        }
      }
    },
    include: {
      items: true
    }
  });

  if (shouldAutoConfirm) await attachCashierPhoto(db, {
    checkoutKey: params.payload.idempotencyKey, actorId: params.actorId, orderId: order.id,
  });

  await writeAuditLog(db, {
    actorId: params.actorId,
    actorType: params.actorType,
    actionType: "PAYMENT_START",
    entityType: "order",
    entityId: order.id,
    orderId: order.id,
    afterJson: {
      orderNo: order.orderNo,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      itemCount: order.items.length,
      totalPriceJpy: order.totalPriceJpy
    },
    result: "SUCCESS"
  });

  if (shouldAutoConfirm) {
    return {
      order: await confirmOrderPayment(db, {
        actorId: params.actorId,
        actorType: params.actorType,
        orderId: order.id,
        result: "SUCCESS"
      }),
      duplicated: false
    };
  }

  return { order, duplicated: false };
}

export async function confirmOrderPayment(
  db: DbClient,
  params: {
    actorId: string | null;
    actorType: ActorType | null;
    orderId: string;
    result: "SUCCESS" | "FAILED";
    squareTransactionId?: string;
    reasonType?: string;
    reasonText?: string;
  }
) {
  await db.$queryRaw`SELECT id FROM "Order" WHERE id = ${params.orderId} FOR UPDATE`;
  const orderBefore = await db.order.findUnique({
    where: { id: params.orderId },
    include: {
      items: true
    }
  });

  assert(orderBefore, 404, "ORDER_NOT_FOUND", "Order not found");
  assert(orderBefore.orderStatus === "PENDING", 409, "ORDER_NOT_PENDING", "Order is not pending");

  if (params.result === "FAILED") {
    const failedAt = now();
    const reasonType =
      params.reasonType ?? (params.actorId ? "MANUAL_FAILURE" : "UNKNOWN");

    const failedOrder = await db.order.update({
      where: { id: params.orderId },
      data: {
        paymentStatus: "FAILED",
        orderStatus: "FAILED",
        paymentAwaitDeadlineAt: null,
        autoCancelDeadlineAt: null,
        lastMutationVersion: {
          increment: 1
        }
      },
      include: {
        items: true
      }
    });

    await releaseMenuDailyCountsForOrder(db, params.orderId);
    await appendOrderEvent(db, params.orderId, {
      type: "PAYMENT_FAILED",
      at: failedAt.toISOString(),
      actorId: params.actorId ?? undefined,
      detail: {
        reasonType,
        reasonText: params.reasonText ?? null
      }
    });

    await writeAuditLog(db, {
      actorId: params.actorId,
      actorType: params.actorType,
      actionType: "PAYMENT_FAILED",
      entityType: "order",
      entityId: params.orderId,
      orderId: params.orderId,
      afterJson: {
        paymentStatus: "FAILED"
      },
      reasonType,
      reasonText: params.reasonText ?? null,
      result: "SUCCESS"
    });

    return failedOrder;
  }

  await assignUnassignedItemsForOrder(db, params.orderId);

  const confirmedAt = now();
  const paymentStatus = orderBefore.paymentMethod === "PAYMENT_SKIPPED" ? "SKIPPED" : "PAID";

  const confirmed = await db.order.update({
    where: { id: params.orderId },
    data: {
      paymentStatus,
      confirmedAt,
      squareTransactionId: params.squareTransactionId ?? null,
      paymentAwaitDeadlineAt: null,
      autoCancelDeadlineAt: null,
      lastMutationVersion: {
        increment: 1
      }
    },
    include: {
      items: {
        select: {
          status: true,
          kitchenId: true,
          id: true
        }
      }
    }
  });

  await appendOrderEvent(db, params.orderId, {
    type: "PAYMENT_SUCCESS",
    at: confirmedAt.toISOString(),
    actorId: params.actorId ?? undefined,
    detail: {
      squareTransactionId: params.squareTransactionId ?? null
    }
  });
  await appendOrderEvent(db, params.orderId, {
    type: "ORDER_CONFIRMED",
    at: confirmedAt.toISOString(),
    actorId: params.actorId ?? undefined
  });

  const nextStatus = deriveOrderStatus({
    paymentStatus: confirmed.paymentStatus,
    fulfillmentType: confirmed.fulfillmentType,
    items: confirmed.items,
    canceledAt: confirmed.canceledAt,
    confirmedAt: confirmed.confirmedAt
  });

  const finalOrder = await db.order.update({
    where: { id: params.orderId },
    data: {
      orderStatus: nextStatus
    },
    include: {
      items: true
    }
  });

  await writeAuditLog(db, {
    actorId: params.actorId,
    actorType: params.actorType,
    actionType: "ORDER_CONFIRMED",
    entityType: "order",
    entityId: params.orderId,
    orderId: params.orderId,
    afterJson: {
      paymentStatus: finalOrder.paymentStatus,
      orderStatus: finalOrder.orderStatus,
      confirmedAt: finalOrder.confirmedAt?.toISOString() ?? null
    },
    result: "SUCCESS"
  });

  return finalOrder;
}

export async function cancelPendingOrder(
  db: DbClient,
  params: {
    actorId: string;
    actorType: ActorType;
    orderId: string;
    reasonText?: string;
  }
) {
  await db.$queryRaw`SELECT id FROM "Order" WHERE id = ${params.orderId} FOR UPDATE`;
  const order = await db.order.findUnique({ where: { id: params.orderId } });
  assert(order, 404, "ORDER_NOT_FOUND", "Order not found");
  assert(order.confirmedAt === null, 409, "ALREADY_CONFIRMED", "Confirmed order cannot be canceled");
  assert(order.orderStatus === "PENDING", 409, "INVALID_STATUS", "Only pending order can be canceled");

  const failedAt = now();

  const failed = await db.order.update({
    where: { id: params.orderId },
    data: {
      paymentStatus: "FAILED",
      orderStatus: "FAILED",
      paymentAwaitDeadlineAt: null,
      autoCancelDeadlineAt: null,
      lastMutationVersion: {
        increment: 1
      }
    },
    include: {
      items: true
    }
  });
  await releaseMenuDailyCountsForOrder(db, params.orderId);

  await db.orderItem.updateMany({
    where: {
      orderId: params.orderId,
      status: "QUEUED"
    },
    data: {
      status: "CANCELED"
    }
  });

  await appendOrderEvent(db, params.orderId, {
    type: "ORDER_FAILED",
    at: failedAt.toISOString(),
    actorId: params.actorId,
    detail: {
      reasonType: "MANUAL_CANCEL",
      reasonText: params.reasonText ?? null
    }
  });

  await writeAuditLog(db, {
    actorId: params.actorId,
    actorType: params.actorType,
    actionType: "ORDER_FAILED",
    entityType: "order",
    entityId: params.orderId,
    orderId: params.orderId,
    reasonType: "MANUAL_CANCEL",
    reasonText: params.reasonText ?? null,
    result: "SUCCESS"
  });

  return failed;
}

export async function markOrderSpecialNote(
  db: DbClient,
  params: {
    actorId: string;
    actorType: ActorType;
    orderId: string;
    specialNote: string;
  }
) {
  await db.$queryRaw`SELECT id FROM "Order" WHERE id = ${params.orderId} FOR UPDATE`;
  const order = await db.order.findUnique({ where: { id: params.orderId } });
  assert(order, 404, "ORDER_NOT_FOUND", "Order not found");

  const updated = await db.order.update({
    where: { id: params.orderId },
    data: {
      specialNote: params.specialNote,
      lastMutationVersion: {
        increment: 1
      }
    }
  });

  await appendOrderEvent(db, params.orderId, {
    type: "SPECIAL_NOTE_UPDATED",
    at: now().toISOString(),
    actorId: params.actorId
  });

  await writeAuditLog(db, {
    actorId: params.actorId,
    actorType: params.actorType,
    actionType: "SPECIAL_NOTE_UPDATED",
    entityType: "order",
    entityId: params.orderId,
    orderId: params.orderId,
    beforeJson: { specialNote: order.specialNote ?? null },
    afterJson: { specialNote: updated.specialNote ?? null },
    result: "SUCCESS"
  });

  return updated;
}


