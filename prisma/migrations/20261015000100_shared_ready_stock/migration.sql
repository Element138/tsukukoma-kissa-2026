BEGIN;
ALTER TABLE "MenuDailyCount" ADD COLUMN "cookedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UndoOperation" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "Order" ADD COLUMN "lastCalledAt" TIMESTAMP(3);
CREATE TABLE "MenuStock" ("menuId" TEXT PRIMARY KEY REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE, "readyCount" INTEGER NOT NULL DEFAULT 0 CHECK ("readyCount" >= 0));
CREATE TABLE "OrderCall" ("id" SERIAL PRIMARY KEY, "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE, "calledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "OrderCall_orderId_calledAt_idx" ON "OrderCall"("orderId", "calledAt");
INSERT INTO "MenuStock" ("menuId", "readyCount") SELECT i."menuId", COUNT(*) FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId" WHERE i.status = 'READY' AND o."orderStatus" NOT IN ('FAILED','CANCELED','COMPLETED') GROUP BY i."menuId";
INSERT INTO "MenuDailyCount" ("menuId", "jstDate", "count", "cookedCount", "createdAt", "updatedAt")
SELECT "menuId", TO_CHAR("readyAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD'), 0, COUNT(*), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "OrderItem" WHERE status IN ('READY','SERVED') AND "readyAt" IS NOT NULL GROUP BY "menuId", TO_CHAR("readyAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD')
ON CONFLICT ("menuId", "jstDate") DO UPDATE SET "cookedCount" = EXCLUDED."cookedCount";
UPDATE "OrderItem" SET status = 'QUEUED', "readyAt" = NULL WHERE status = 'READY';
UPDATE "Order" SET "orderStatus" = 'PREPARING' WHERE "orderStatus" = 'AWAITING_SERVING';
DELETE FROM "UndoOperation";

ALTER TABLE "AppSetting" DROP COLUMN "counterReadyGraceMinutes";
ALTER TABLE "MenuStock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderCall" ENABLE ROW LEVEL SECURITY;
COMMIT;
