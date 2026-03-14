ALTER TABLE "MenuCategory"
ALTER COLUMN "displayOrder" DROP NOT NULL;

ALTER TABLE "Menu"
ALTER COLUMN "displayOrder" DROP NOT NULL;

ALTER TABLE "Menu"
ALTER COLUMN "workloadSeconds" TYPE DOUBLE PRECISION
USING "workloadSeconds"::double precision;

ALTER TABLE "OrderItem"
ALTER COLUMN "workloadSecondsSnapshot" TYPE DOUBLE PRECISION
USING "workloadSecondsSnapshot"::double precision;
