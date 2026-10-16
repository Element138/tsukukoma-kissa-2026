BEGIN;
LOCK TABLE "Order", "OrderItem", "MenuDailyCount", "AuditLog" IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE "OrderMenuCapReservation" (
  "orderId" TEXT NOT NULL,
  "menuId" TEXT NOT NULL,
  "jstDate" VARCHAR(10) NOT NULL,
  "quantity" INTEGER NOT NULL CHECK ("quantity" > 0),
  "releasedAt" TIMESTAMP(3),
  PRIMARY KEY ("orderId", "menuId"),
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "OrderMenuCapReservation_menuId_jstDate_releasedAt_idx" ON "OrderMenuCapReservation"("menuId", "jstDate", "releasedAt");
ALTER TABLE "OrderMenuCapReservation" ENABLE ROW LEVEL SECURITY;
-- Reconstruct live reservations from orders, respecting each menu's latest manual daily reset.
INSERT INTO "OrderMenuCapReservation" ("orderId", "menuId", "jstDate", "quantity")
SELECT o.id, i."menuId", TO_CHAR(o."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD'), COUNT(*)::integer
FROM "Order" o JOIN "OrderItem" i ON i."orderId" = o.id
WHERE o."paymentStatus" NOT IN ('FAILED', 'CANCELED') AND o."orderStatus" NOT IN ('FAILED', 'CANCELED') AND o."canceledAt" IS NULL
AND NOT EXISTS (
  SELECT 1 FROM "AuditLog" a WHERE a."actionType" = 'MENU_DAILY_COUNT_RESET' AND a."entityId" = i."menuId"
  AND TO_CHAR(a."timestamp" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') = TO_CHAR(o."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD')
  AND a."timestamp" >= o."createdAt"
)
GROUP BY o.id, i."menuId";
-- Correct counts already consumed by failed test orders; preserve cooked counts and stock.
UPDATE "MenuDailyCount" d SET "count" = 0, "updatedAt" = CURRENT_TIMESTAMP;
INSERT INTO "MenuDailyCount" ("menuId", "jstDate", "count", "cookedCount", "createdAt", "updatedAt")
SELECT "menuId", "jstDate", SUM("quantity")::integer, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "OrderMenuCapReservation" GROUP BY "menuId", "jstDate"
ON CONFLICT ("menuId", "jstDate") DO UPDATE SET "count" = EXCLUDED."count", "updatedAt" = CURRENT_TIMESTAMP;
COMMIT;
