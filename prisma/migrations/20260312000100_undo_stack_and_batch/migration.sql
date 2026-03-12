ALTER TYPE "UndoOperationType" ADD VALUE IF NOT EXISTS 'ITEM_READY_BATCH';

DROP TABLE IF EXISTS "UndoOperation";

CREATE TABLE "UndoOperation" (
  "id" TEXT NOT NULL,
  "actorId" VARCHAR(64) NOT NULL,
  "operationType" "UndoOperationType" NOT NULL,
  "targetEntityType" VARCHAR(64) NOT NULL,
  "targetEntityId" VARCHAR(120) NOT NULL,
  "orderId" TEXT NOT NULL,
  "expectedOrderVersion" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UndoOperation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "UndoOperation"
  ADD CONSTRAINT "UndoOperation_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "UndoOperation_actorId_createdAt_idx" ON "UndoOperation"("actorId", "createdAt");
CREATE INDEX "UndoOperation_orderId_idx" ON "UndoOperation"("orderId");