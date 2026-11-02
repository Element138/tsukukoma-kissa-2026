import type { PublicWaitTime } from "./public-wait-time";

export const WAIT_TIME_REFRESH_MS = 60_000;
export const WAIT_TIME_MAX_AGE_MS = 5 * 60_000;

export function readWaitTimeSnapshot(
  snapshot: { computedAt: Date | string; payload: unknown } | null,
  now: Date,
  dayStart: Date,
): PublicWaitTime | null {
  if (!snapshot) return null;
  const computed = new Date(snapshot.computedAt).getTime();
  if (!Number.isFinite(computed) || computed < +dayStart || computed > +now || +now - computed > WAIT_TIME_MAX_AGE_MS) return null;
  const payload = snapshot.payload as Partial<PublicWaitTime> | null;
  const valid = (v: unknown) => v === null || (typeof v === "number" && Number.isInteger(v) && v >= 5 && v <= 120 && v % 5 === 0);
  if (!payload || !valid(payload.dineIn) || !valid(payload.takeout)) return null;
  return { dineIn: payload.dineIn!, takeout: payload.takeout! };
}
