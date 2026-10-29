-- Keep production guards independent of pooled connection search_path.
BEGIN;
CREATE OR REPLACE FUNCTION "public"."assert_kitchen_actor_ref"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."kitchenId" IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM "public"."Actor" a
  WHERE a."id" = NEW."kitchenId"
    AND a."actorType" = 'KITCHEN'::"public"."ActorType";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'kitchenId % must reference Actor(actorType=KITCHEN)', NEW."kitchenId";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION "public"."assert_actor_remains_kitchen_if_referenced"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."actorType" = 'KITCHEN'::"public"."ActorType" THEN
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
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;
COMMIT;
