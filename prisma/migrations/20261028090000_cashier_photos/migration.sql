CREATE TABLE "CashierPhoto" (
  "id" TEXT NOT NULL,
  "checkoutKey" VARCHAR(128) NOT NULL,
  "actorId" VARCHAR(64) NOT NULL,
  "sessionId" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "capturedAt" TIMESTAMP(3),
  "storedAt" TIMESTAMP(3),
  "objectPath" TEXT,
  "sha256" VARCHAR(64),
  "byteSize" INTEGER,
  "failureCode" VARCHAR(64),
  "waivedAt" TIMESTAMP(3),
  "orderId" TEXT,
  CONSTRAINT "CashierPhoto_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashierPhoto_byteSize_check" CHECK ("byteSize" IS NULL OR "byteSize" BETWEEN 1 AND 100000)
);
CREATE UNIQUE INDEX "CashierPhoto_checkoutKey_key" ON "CashierPhoto"("checkoutKey");
CREATE UNIQUE INDEX "CashierPhoto_objectPath_key" ON "CashierPhoto"("objectPath");
CREATE UNIQUE INDEX "CashierPhoto_orderId_key" ON "CashierPhoto"("orderId");
CREATE INDEX "CashierPhoto_actorId_requestedAt_idx" ON "CashierPhoto"("actorId", "requestedAt");
ALTER TABLE "CashierPhoto" ADD CONSTRAINT "CashierPhoto_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TABLE "PhotoStorageState" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "failedAt" TIMESTAMP(3),
  "failureCode" VARCHAR(64),
  "ignoreUntil" TIMESTAMP(3),
  CONSTRAINT "PhotoStorageState_pkey" PRIMARY KEY ("id")
);
INSERT INTO "PhotoStorageState" ("id") VALUES (1);
-- These tables are server-only, even if public is exposed through PostgREST.
ALTER TABLE "CashierPhoto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PhotoStorageState" ENABLE ROW LEVEL SECURITY;
