-- Realtime outbox events for SSE fan-out
CREATE TABLE "RealtimeEvent" (
  "id" SERIAL NOT NULL,
  "channel" VARCHAR(80) NOT NULL,
  "eventType" VARCHAR(32) NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RealtimeEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RealtimeEvent_channel_id_idx" ON "RealtimeEvent"("channel", "id");
CREATE INDEX "RealtimeEvent_createdAt_idx" ON "RealtimeEvent"("createdAt");
