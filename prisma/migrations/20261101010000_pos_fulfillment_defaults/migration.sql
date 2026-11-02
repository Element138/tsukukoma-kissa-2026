ALTER TABLE "Actor" ADD COLUMN "defaultFulfillmentType" "FulfillmentType" NOT NULL DEFAULT 'DINE_IN';
-- Existing POS2 account, verified by ID before deployment. Admin may change it later.
UPDATE "Actor" SET "defaultFulfillmentType" = 'TAKEOUT' WHERE id = 'pos-b8c0c1b036' AND "actorType" = 'POS';
