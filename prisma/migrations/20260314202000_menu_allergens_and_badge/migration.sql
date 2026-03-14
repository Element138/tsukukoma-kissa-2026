ALTER TABLE "Menu"
ADD COLUMN "allergensJson" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "Menu"
ADD COLUMN "customBadgeText" VARCHAR(32);

ALTER TABLE "Menu"
ADD COLUMN "customBadgeColor" VARCHAR(16);
