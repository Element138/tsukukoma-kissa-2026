ALTER TABLE "AppSetting"
ADD COLUMN "orderDisplayMarqueeText" VARCHAR(240) NOT NULL DEFAULT '',
ADD COLUMN "orderDisplayMarqueeSpeedSeconds" INTEGER NOT NULL DEFAULT 24;
