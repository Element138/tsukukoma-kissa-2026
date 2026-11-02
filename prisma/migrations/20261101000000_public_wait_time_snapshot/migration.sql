-- Independent singleton snapshot; no changes to operational orders or realtime.
CREATE TABLE "PublicWaitTimeSnapshot" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "payload" JSONB,
  "computedAt" TIMESTAMP(3),
  "leaseUntil" TIMESTAMP(3),
  "refreshToken" TEXT,
  CONSTRAINT "PublicWaitTimeSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PublicWaitTimeSnapshot_singleton" CHECK ("id" = 1)
);
-- Server database role only; do not expose a public Supabase table endpoint.
ALTER TABLE "PublicWaitTimeSnapshot" ENABLE ROW LEVEL SECURITY;
