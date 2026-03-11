-- Repair migration for environments that still have the legacy Kitchen-level schema.
-- This migration is intentionally idempotent and safe on both old and new DB states.

-- 1) Ensure Actor has kitchen runtime fields required by the unified model.
ALTER TABLE "Actor" ADD COLUMN IF NOT EXISTS "kitchenEnabled" BOOLEAN;
ALTER TABLE "Actor" ALTER COLUMN "kitchenEnabled" SET DEFAULT true;
UPDATE "Actor" SET "kitchenEnabled" = true WHERE "kitchenEnabled" IS NULL;
ALTER TABLE "Actor" ALTER COLUMN "kitchenEnabled" SET NOT NULL;

ALTER TABLE "Actor" ADD COLUMN IF NOT EXISTS "kitchenDisplayOrder" INTEGER;
ALTER TABLE "Actor" ALTER COLUMN "kitchenDisplayOrder" SET DEFAULT 0;
UPDATE "Actor" SET "kitchenDisplayOrder" = 0 WHERE "kitchenDisplayOrder" IS NULL;
ALTER TABLE "Actor" ALTER COLUMN "kitchenDisplayOrder" SET NOT NULL;

-- 2) If legacy Kitchen table exists, make sure each kitchen unit has a matching KITCHEN actor with the same id.
DO $$
BEGIN
  IF to_regclass('public."Kitchen"') IS NOT NULL THEN
    INSERT INTO "Actor" (
      "id",
      "actorType",
      "label",
      "secretHash",
      "isActive",
      "kitchenEnabled",
      "kitchenDisplayOrder",
      "sessionVersion",
      "online",
      "createdAt",
      "updatedAt"
    )
    SELECT
      k."id",
      'KITCHEN'::"ActorType",
      k."name",
      repeat('0', 64),
      k."isActive",
      COALESCE(k."isActive", true),
      COALESCE(k."displayOrder", 0),
      0,
      false,
      COALESCE(k."createdAt", CURRENT_TIMESTAMP),
      CURRENT_TIMESTAMP
    FROM "Kitchen" k
    LEFT JOIN "Actor" a ON a."id" = k."id"
    WHERE a."id" IS NULL;
  END IF;
END;
$$;

-- 3) Ensure all kitchenId values referenced by assignment/item tables have backing Actor rows.
WITH referenced_kitchens AS (
  SELECT "kitchenId" AS id FROM "MenuKitchenAssignment"
  UNION
  SELECT "kitchenId" AS id FROM "OrderItem" WHERE "kitchenId" IS NOT NULL
)
INSERT INTO "Actor" (
  "id",
  "actorType",
  "label",
  "secretHash",
  "isActive",
  "kitchenEnabled",
  "kitchenDisplayOrder",
  "sessionVersion",
  "online",
  "createdAt",
  "updatedAt"
)
SELECT
  rk.id,
  'KITCHEN'::"ActorType",
  rk.id,
  repeat('0', 64),
  true,
  true,
  0,
  0,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM referenced_kitchens rk
LEFT JOIN "Actor" a ON a."id" = rk.id
WHERE rk.id IS NOT NULL
  AND a."id" IS NULL;

-- 4) Any referenced actor id must be KITCHEN in the unified model.
WITH referenced_kitchens AS (
  SELECT "kitchenId" AS id FROM "MenuKitchenAssignment"
  UNION
  SELECT "kitchenId" AS id FROM "OrderItem" WHERE "kitchenId" IS NOT NULL
)
UPDATE "Actor" a
SET
  "actorType" = 'KITCHEN'::"ActorType",
  "kitchenEnabled" = COALESCE(a."kitchenEnabled", true),
  "kitchenDisplayOrder" = COALESCE(a."kitchenDisplayOrder", 0),
  "updatedAt" = CURRENT_TIMESTAMP
FROM referenced_kitchens rk
WHERE a."id" = rk.id
  AND a."actorType" <> 'KITCHEN'::"ActorType";

-- 5) Re-point kitchenId foreign keys from legacy Kitchen table to Actor(id).
ALTER TABLE "Actor" DROP CONSTRAINT IF EXISTS "Actor_kitchenId_fkey";

ALTER TABLE "MenuKitchenAssignment" DROP CONSTRAINT IF EXISTS "MenuKitchenAssignment_kitchenId_fkey";
ALTER TABLE "MenuKitchenAssignment"
  ADD CONSTRAINT "MenuKitchenAssignment_kitchenId_fkey"
  FOREIGN KEY ("kitchenId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_kitchenId_fkey";
ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_kitchenId_fkey"
  FOREIGN KEY ("kitchenId") REFERENCES "Actor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Actor_actorType_isActive_kitchenEnabled_idx"
  ON "Actor"("actorType", "isActive", "kitchenEnabled");
CREATE INDEX IF NOT EXISTS "Actor_kitchenDisplayOrder_idx"
  ON "Actor"("kitchenDisplayOrder");

-- 6) DB-level guard: kitchenId can reference only KITCHEN actors.
CREATE OR REPLACE FUNCTION "public"."assert_kitchen_actor_ref"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."kitchenId" IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM "public"."Actor" a
  WHERE a."id" = NEW."kitchenId"
    AND a."actorType" = 'KITCHEN'::"ActorType";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'kitchenId % must reference Actor(actorType=KITCHEN)', NEW."kitchenId";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "MenuKitchenAssignment_kitchenId_kitchen_actor_check" ON "public"."MenuKitchenAssignment";
CREATE TRIGGER "MenuKitchenAssignment_kitchenId_kitchen_actor_check"
BEFORE INSERT OR UPDATE OF "kitchenId" ON "public"."MenuKitchenAssignment"
FOR EACH ROW
EXECUTE FUNCTION "public"."assert_kitchen_actor_ref"();

DROP TRIGGER IF EXISTS "OrderItem_kitchenId_kitchen_actor_check" ON "public"."OrderItem";
CREATE TRIGGER "OrderItem_kitchenId_kitchen_actor_check"
BEFORE INSERT OR UPDATE OF "kitchenId" ON "public"."OrderItem"
FOR EACH ROW
EXECUTE FUNCTION "public"."assert_kitchen_actor_ref"();

-- 7) Guard against changing referenced kitchen actors away from actorType=KITCHEN.
CREATE OR REPLACE FUNCTION "public"."assert_actor_remains_kitchen_if_referenced"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."actorType" = 'KITCHEN'::"ActorType" THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "public"."MenuKitchenAssignment" m
    WHERE m."kitchenId" = NEW."id"
  ) OR EXISTS (
    SELECT 1
    FROM "public"."OrderItem" oi
    WHERE oi."kitchenId" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'Actor % is referenced as kitchenId and must remain actorType=KITCHEN', NEW."id";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "Actor_actorType_kitchen_ref_guard" ON "public"."Actor";
CREATE TRIGGER "Actor_actorType_kitchen_ref_guard"
BEFORE UPDATE OF "actorType" ON "public"."Actor"
FOR EACH ROW
WHEN (OLD."actorType" = 'KITCHEN'::"ActorType")
EXECUTE FUNCTION "public"."assert_actor_remains_kitchen_if_referenced"();