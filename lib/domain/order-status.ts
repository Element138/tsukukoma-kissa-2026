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
  if (params.paymentStatus === "CANCELED" || params.canceledAt) return "CANCELED";
  if (params.paymentStatus === "FAILED") {
    return "FAILED";
  }

  if (!params.confirmedAt) {
    return "PENDING";
  }

  if (params.items.length === 0) {
    return "PENDING";
  }

  const canceled = params.items.filter(i => i.status === "CANCELED").length;
  if (canceled === params.items.length) return "CANCELED";
  if (canceled > 0 && params.items.every(i => i.status === "SERVED" || i.status === "CANCELED")) return "PARTIALLY_CANCELED";
  const allServed = params.items.every((i) => i.status === "SERVED");
  if (allServed) {
    return "COMPLETED";
  }


  return "PREPARING";
}

export function aggregateOrderPrice(items: Array<{ unitPriceJpy: number }>): number {
  return items.reduce((sum, item) => sum + item.unitPriceJpy, 0);
}


