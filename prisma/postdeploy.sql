-- KISSa post-deploy SQL (idempotent)
-- Ensures DB-level guards that Prisma schema cannot express directly.

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