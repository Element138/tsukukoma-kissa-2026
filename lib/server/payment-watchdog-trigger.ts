import { prisma } from "@/lib/db";
import { runPaymentWatchdog } from "@/lib/domain/payment-watchdog";

const WATCHDOG_MIN_INTERVAL_MS = 15_000;
let watchdogInFlight: Promise<void> | null = null;
let lastWatchdogStartedAt = 0;

export function triggerPaymentWatchdogBestEffort() {
  const nowMs = Date.now();
  if (watchdogInFlight) {
    return;
  }
  if (nowMs - lastWatchdogStartedAt < WATCHDOG_MIN_INTERVAL_MS) {
    return;
  }

  lastWatchdogStartedAt = nowMs;
  watchdogInFlight = runPaymentWatchdog(prisma)
    .then(() => undefined)
    .catch((error) => {
      console.warn("payment watchdog best-effort run failed", error);
    })
    .finally(() => {
      watchdogInFlight = null;
    });
}
