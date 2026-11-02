// Portable versions of the selected hidden-context heads (random-context / v4).
export const MIN_COMPLETED_ORDERS = 10;

export type WaitTimeAggregates = {
  dineInCompleted: number;
  takeoutCompleted: number;
  queueItems: number;
  queueAgeP90: number;
  servedItems20: number;
  servedItems60: number;
  takeoutMean: number | null;
  dispatchMargin: number | null;
};

export type PublicWaitTime = { dineIn: number | null; takeout: number | null };

function displayedMinutes(minutes: number): number | null {
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  return Math.max(5, Math.round(Math.min(120, minutes) / 5) * 5);
}

export function predictPublicWaitTime(f: WaitTimeAggregates): PublicWaitTime {
  const capacity = Math.max(0.5, f.servedItems20 / 20, f.servedItems60 / 60);
  return {
    dineIn: f.dineInCompleted >= MIN_COMPLETED_ORDERS
      ? displayedMinutes(4 + 0.5 * f.queueItems / capacity + 0.5 * f.queueAgeP90)
      : null,
    // This margin is the selected precaution against underestimation; the
    // full-serving mean already includes handoff time. It is not a decomposition.
    takeout: f.takeoutCompleted >= MIN_COMPLETED_ORDERS && f.takeoutMean !== null
      ? displayedMinutes(f.takeoutMean + (f.dispatchMargin ?? 2))
      : null,
  };
}
