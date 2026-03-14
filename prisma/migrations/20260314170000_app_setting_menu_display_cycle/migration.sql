CREATE TABLE IF NOT EXISTS "AppSetting" (
  "id" INTEGER NOT NULL,
  "menuDisplayPageSeconds" INTEGER NOT NULL DEFAULT 18,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AppSetting" ("id", "menuDisplayPageSeconds", "updatedAt")
VALUES (1, 18, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
