import { after } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { tokyoDayRangeUtc } from "@/lib/time";
import { calculatePublicWaitTime } from "@/lib/server/public-wait-time-calculation";
import { WAIT_TIME_REFRESH_MS } from "@/lib/domain/wait-time-snapshot";

let nextAttempt = 0;

export async function refreshPublicWaitTimeSnapshot(): Promise<void> {
  const token = randomUUID();
  // Atomic cross-instance lease. Losers skip aggregation. Never lock order rows
  // or hold a transaction open while computing. Failed attempts back off 90s.
  const claimed = await prisma.$queryRaw<{ id: number }[]>`
    INSERT INTO "PublicWaitTimeSnapshot" (id, "leaseUntil", "refreshToken")
    VALUES (1, statement_timestamp() + INTERVAL '90 seconds', ${token})
    ON CONFLICT (id) DO UPDATE SET
      "leaseUntil" = statement_timestamp() + INTERVAL '90 seconds',
      "refreshToken" = EXCLUDED."refreshToken"
    WHERE ("PublicWaitTimeSnapshot"."leaseUntil" IS NULL
      OR "PublicWaitTimeSnapshot"."leaseUntil" <= statement_timestamp())
      AND ("PublicWaitTimeSnapshot"."computedAt" IS NULL
        OR "PublicWaitTimeSnapshot"."computedAt" <= statement_timestamp() - INTERVAL '60 seconds')
    RETURNING id
  `;
  if (!claimed.length) return;
  const { start } = tokyoDayRangeUtc();
  const estimate = await calculatePublicWaitTime(start.toISOString());
  if (!estimate) return;
  if (+tokyoDayRangeUtc().start !== +start) return;
  // Ownership check prevents an expired, slow worker overwriting a newer one.
  await prisma.$executeRaw`
    UPDATE "PublicWaitTimeSnapshot" SET payload = ${JSON.stringify(estimate)}::jsonb,
      "computedAt" = statement_timestamp(), "leaseUntil" = NULL, "refreshToken" = NULL
    WHERE id = 1 AND "refreshToken" = ${token}
  `;
}

export function schedulePublicWaitTimeRefresh(): void {
  if (Date.now() < nextAttempt) return;
  nextAttempt = Date.now() + WAIT_TIME_REFRESH_MS;
  // Next keeps the task alive after the staff response; no new browser request.
  try {
    after(async () => {
      try { await refreshPublicWaitTimeSnapshot(); }
      catch (error) { console.warn("Wait-time snapshot refresh failed", error instanceof Error ? error.name : "UnknownError"); }
    });
  } catch (error) {
    console.warn("Wait-time snapshot scheduling failed", error instanceof Error ? error.name : "UnknownError");
  }
}
