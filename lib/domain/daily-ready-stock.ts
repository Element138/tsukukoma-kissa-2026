import { Prisma, PrismaClient } from "@prisma/client";
import { tokyoDayRangeUtc } from "@/lib/time";

// Expiry is enforced on every stock read/write, so correctness does not depend
// on an open browser or on a scheduler firing exactly at midnight.
export async function resetExpiredReadyStock(db: PrismaClient | Prisma.TransactionClient, menuIds?: string[], at = new Date()) {
  if (menuIds?.length === 0) return;
  const { start } = tokyoDayRangeUtc(at);
  const scope = menuIds ? Prisma.sql`AND "menuId" IN (${Prisma.join([...new Set(menuIds)].sort())})` : Prisma.empty;
  await db.$queryRaw(Prisma.sql`
    UPDATE "MenuStock" SET "readyCount" = 0, "stockResetAt" = ${at}
    WHERE "stockResetAt" < ${start} ${scope}
    RETURNING "menuId"
  `);
}
