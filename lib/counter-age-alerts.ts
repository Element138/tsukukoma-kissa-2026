import { ORDER_AGE_MINUTES, type OrderAgeMinutes } from "@/lib/order-age";
export type AlertOrder = { id: string; orderNo: number; createdAt: string };
export type CounterAgeAlert = AlertOrder & { minutes: OrderAgeMinutes };
export type AlertHistory = Record<string, { minutes: number; at: number }>;

export function dueCounterAlerts(orders: readonly AlertOrder[], now: number, history: AlertHistory): CounterAgeAlert[] {
  return orders.flatMap(order => {
    const age = now - Date.parse(order.createdAt);
    const minutes = [...ORDER_AGE_MINUTES].reverse().find(value => age >= value * 60_000);
    // Catch up with the latest relevant threshold, not three obsolete alerts.
    return minutes && minutes > (history[order.id]?.minutes ?? 0) ? [{ ...order, minutes }] : [];
  }).sort((a, b) => Date.parse(a.createdAt) + a.minutes * 60_000 - Date.parse(b.createdAt) - b.minutes * 60_000 || a.orderNo - b.orderNo);
}

export function counterAlertSources(alert: CounterAgeAlert) {
  const stage = ORDER_AGE_MINUTES.indexOf(alert.minutes) + 1;
  return [`/audio/counter-alerts/tone-${stage}.mp3`, ...counterOrderNumberSources(alert.orderNo), `/audio/counter-alerts/elapsed-from-order-${alert.minutes}.mp3`];
}

export function counterOrderNumberSources(orderNo: number): string[] {
  if (!Number.isInteger(orderNo) || orderNo < 1 || orderNo > 999999) throw new Error("注文番号が音声対応範囲外です");
  return [orderNo <= 2000 ? `/audio/order-call/numbers/v2/number-${orderNo}.mp3` : `/api/order-display/audio/number/${orderNo}`];
}
