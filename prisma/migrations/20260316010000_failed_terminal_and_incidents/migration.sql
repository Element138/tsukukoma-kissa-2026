ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'FAILED';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentIncidentType') THEN
    CREATE TYPE "PaymentIncidentType" AS ENUM ('LATE_SUCCESS_AFTER_FAILED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "PaymentIncident" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "incidentType" "PaymentIncidentType" NOT NULL,
  "messageJa" VARCHAR(400) NOT NULL,
  "detailsJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dismissedAt" TIMESTAMP(3),
  "dismissedByActorId" VARCHAR(64),
  CONSTRAINT "PaymentIncident_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PaymentIncident_orderId_createdAt_idx"
  ON "PaymentIncident"("orderId", "createdAt");
CREATE INDEX IF NOT EXISTS "PaymentIncident_dismissedAt_createdAt_idx"
  ON "PaymentIncident"("dismissedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "PaymentIncident_open_createdAt_idx"
  ON "PaymentIncident"("createdAt")
  WHERE "dismissedAt" IS NULL;

ALTER TABLE "PaymentIncident"
  ADD CONSTRAINT "PaymentIncident_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentIncident"
  ADD CONSTRAINT "PaymentIncident_dismissedByActorId_fkey"
  FOREIGN KEY ("dismissedByActorId") REFERENCES "Actor"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "Order_one_awaiting_square_per_pos_actor"
  ON "Order"("createdByActorId")
  WHERE "paymentMethod" = 'SQUARE'
    AND "paymentStatus" = 'AWAITING'
    AND "confirmedAt" IS NULL;

UPDATE "Order"
SET "paymentStatus" = 'FAILED'
WHERE "paymentStatus" = 'CANCELED';

UPDATE "Order"
SET "orderStatus" = 'FAILED'
WHERE "orderStatus" = 'CANCELED';

UPDATE "Order"
SET "canceledAt" = NULL
WHERE "orderStatus" = 'FAILED';
