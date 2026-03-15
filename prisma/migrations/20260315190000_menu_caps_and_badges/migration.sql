-- Menu cap / low-stock badge fields
ALTER TABLE "Menu"
ADD COLUMN "dailyOrderCap" INTEGER,
ADD COLUMN "lowStockBadgeEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lowStockBadgeThreshold" INTEGER NOT NULL DEFAULT 0;

-- JST day-scoped order counts per menu
CREATE TABLE "MenuDailyCount" (
  "menuId" TEXT NOT NULL,
  "jstDate" VARCHAR(10) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MenuDailyCount_pkey" PRIMARY KEY ("menuId", "jstDate"),
  CONSTRAINT "MenuDailyCount_menuId_fkey"
    FOREIGN KEY ("menuId")
    REFERENCES "Menu"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX "MenuDailyCount_jstDate_idx" ON "MenuDailyCount"("jstDate");
