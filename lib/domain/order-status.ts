import { FulfillmentType, OrderItemStatus, OrderStatus, PaymentStatus } from "@prisma/client";

export type ItemState = {
  status: OrderItemStatus;
};

export function deriveOrderStatus(params: {
  paymentStatus: PaymentStatus;
  fulfillmentType: FulfillmentType;
  items: ItemState[];
  canceledAt: Date | null;
  confirmedAt: Date | null;
}): OrderStatus {
  if (params.canceledAt || params.paymentStatus === "CANCELED") {
    return "CANCELED";
  }

  if (!params.confirmedAt) {
    return "PENDING";
  }

  if (params.items.length === 0) {
    return "PENDING";
  }

  const allServed = params.items.every((i) => i.status === "SERVED");
  if (allServed) {
    return "COMPLETED";
  }

  if (params.fulfillmentType === "TAKEOUT") {
    const allReadyOrServed = params.items.every((i) => i.status === "READY" || i.status === "SERVED");
    return allReadyOrServed ? "AWAITING_SERVING" : "PREPARING";
  }

  const hasReady = params.items.some((i) => i.status === "READY");
  return hasReady ? "AWAITING_SERVING" : "PREPARING";
}

export function aggregateOrderPrice(items: Array<{ unitPriceJpy: number }>): number {
  return items.reduce((sum, item) => sum + item.unitPriceJpy, 0);
}


