CREATE TABLE "MenuCoverImage" (
  "id" VARCHAR(64) NOT NULL,
  "bytes" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MenuCoverImage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MenuCoverImage_size_check" CHECK (octet_length("bytes") BETWEEN 1 AND 200000),
  CONSTRAINT "MenuCoverImage_id_check" CHECK ("id" ~ '^[a-f0-9]{64}$')
);
ALTER TABLE "MenuCoverImage" ENABLE ROW LEVEL SECURITY;
