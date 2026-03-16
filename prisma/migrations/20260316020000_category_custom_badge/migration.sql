ALTER TABLE "MenuCategory"
  ADD COLUMN IF NOT EXISTS "customBadgeText" VARCHAR(32);

ALTER TABLE "MenuCategory"
  ADD COLUMN IF NOT EXISTS "customBadgeColor" VARCHAR(16);
