export function canCancelCashOrder(order: {
  paymentMethod: string;
  paymentStatus: string;
  orderStatus: string;
  confirmedAt: Date | string | null;
  items: Array<{ status: string }>;
}) {
  return (
    order.paymentMethod === "CASH" &&
    order.paymentStatus === "PAID" &&
    Boolean(order.confirmedAt) &&
    ["PREPARING", "AWAITING_SERVING"].includes(order.orderStatus) &&
    order.items.length > 0 &&
    order.items.every(item => item.status === "QUEUED" || item.status === "READY")
  );
}
