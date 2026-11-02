import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { tokyoDayRangeUtc } from "@/lib/time";
import { readWaitTimeSnapshot } from "@/lib/domain/wait-time-snapshot";
import type { PublicWaitTime } from "@/lib/domain/public-wait-time";

type Snapshot = { computedAt: Date; payload: unknown };
let local: { day: string; expires: number; snapshot: Snapshot | null } | undefined;
let inFlight: Promise<Snapshot | null> | undefined;

async function readSnapshot(day: string): Promise<Snapshot | null> {
  if (local?.day === day && local.expires > Date.now()) return local.snapshot;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      // One indexed row only; no dependency on the model calculation module.
      const [snapshot] = await prisma.$queryRaw<Snapshot[]>`
        SELECT "computedAt", payload FROM "PublicWaitTimeSnapshot" WHERE id = 1
      `;
      return snapshot ?? null;
    } catch { return null; }
  })();
  try {
    const snapshot = await inFlight;
    local = { day, expires: Date.now() + 60_000, snapshot };
    return snapshot;
  } finally { inFlight = undefined; }
}
const cached = unstable_cache(readSnapshot, ["public-wait-time-snapshot-v2"], { revalidate: 60 });

export async function getPublicWaitTime(): Promise<PublicWaitTime | null> {
  const { start } = tokyoDayRangeUtc();
  const snapshot = await cached(start.toISOString());
  // Freshness is checked even on cache hits.
  return readWaitTimeSnapshot(snapshot, new Date(), start);
}
