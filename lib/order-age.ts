export const ORDER_AGE_MINUTES = [10, 25, 40] as const;
export type OrderAgeMinutes = (typeof ORDER_AGE_MINUTES)[number];

export function orderAgeTone(seconds: number): "safe" | "warn" | "danger" | "critical" {
  if (seconds >= ORDER_AGE_MINUTES[2] * 60) return "critical";
  if (seconds >= ORDER_AGE_MINUTES[1] * 60) return "danger";
  if (seconds >= ORDER_AGE_MINUTES[0] * 60) return "warn";
  return "safe";
}
