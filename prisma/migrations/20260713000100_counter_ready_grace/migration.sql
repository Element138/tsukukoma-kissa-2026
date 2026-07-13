ALTER TABLE "AppSetting"
ADD COLUMN IF NOT EXISTS "counterReadyGraceMinutes" INTEGER NOT NULL DEFAULT 3;

UPDATE "AppSetting"
SET "counterReadyGraceMinutes" = 3
WHERE "counterReadyGraceMinutes" IS NULL;
