export const ORDER_DISPLAY_PAGE_REFRESH_MS = 5 * 60_000;
const CALL_QUIET_MS = 5_000;
const RESUME_MAX_AGE_MS = 2 * 60_000;

export function canRefreshOrderDisplay(state: {
  now: number;
  dueAt: number;
  lastCallEndedAt: number;
  callInFlight: boolean;
  queuedCalls: number;
  online: boolean;
}) {
  return state.now >= state.dueAt && state.online && !state.callInFlight &&
    state.queuedCalls === 0 && state.now - state.lastCallEndedAt >= CALL_QUIET_MS;
}

export function readOrderDisplayResume(raw: string | null, actorId: string, now: number): number | null {
  try {
    const value = JSON.parse(raw ?? "null");
    return value?.actorId === actorId && Number.isSafeInteger(value.cursor) && value.cursor >= 0 &&
      Number.isFinite(value.at) && now >= value.at && now - value.at <= RESUME_MAX_AGE_MS
      ? value.cursor : null;
  } catch {
    return null;
  }
}
