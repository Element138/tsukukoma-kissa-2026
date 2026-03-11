-- Unify legacy "Line" schema to "Kitchen" schema.
-- This migration is idempotent so it is safe on already-unified databases.

DO $$
BEGIN
  IF to_regclass('public."Line"') IS NOT NULL
     AND to_regclass('public."Kitchen"') IS NULL THEN
    EXECUTE 'ALTER TABLE "public"."Line" RENAME TO "Kitchen"';
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public."MenuLineAssignment"') IS NOT NULL
     AND to_regclass('public."MenuKitchenAssignment"') IS NULL THEN
    EXECUTE 'ALTER TABLE "public"."MenuLineAssignment" RENAME TO "MenuKitchenAssignment"';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Actor'
      AND column_name = 'lineId'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Actor'
      AND column_name = 'kitchenId'
  ) THEN
    EXECUTE 'ALTER TABLE "public"."Actor" RENAME COLUMN "lineId" TO "kitchenId"';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'OrderItem'
      AND column_name = 'lineId'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'OrderItem'
      AND column_name = 'kitchenId'
  ) THEN
    EXECUTE 'ALTER TABLE "public"."OrderItem" RENAME COLUMN "lineId" TO "kitchenId"';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'OrderItem'
      AND column_name = 'lineAssignedAt'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'OrderItem'
      AND column_name = 'kitchenAssignedAt'
  ) THEN
    EXECUTE 'ALTER TABLE "public"."OrderItem" RENAME COLUMN "lineAssignedAt" TO "kitchenAssignedAt"';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'MenuKitchenAssignment'
      AND column_name = 'lineId'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'MenuKitchenAssignment'
      AND column_name = 'kitchenId'
  ) THEN
    EXECUTE 'ALTER TABLE "public"."MenuKitchenAssignment" RENAME COLUMN "lineId" TO "kitchenId"';
  END IF;
END
$$;
