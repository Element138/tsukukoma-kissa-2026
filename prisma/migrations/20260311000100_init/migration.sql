-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('POS', 'KITCHEN', 'WAITER', 'MENU_DISPLAY', 'ADMIN');

-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('AVAILABLE', 'PAUSED', 'SOLD_OUT');

-- CreateEnum
CREATE TYPE "FulfillmentType" AS ENUM ('DINE_IN', 'TAKEOUT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'SQUARE', 'PAYMENT_SKIPPED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PAID', 'FAILED', 'AWAITING', 'CANCELED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PREPARING', 'AWAITING_SERVING', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "OrderItemStatus" AS ENUM ('QUEUED', 'READY', 'SERVED', 'CANCELED');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateEnum
CREATE TYPE "UndoOperationType" AS ENUM ('ITEM_READY', 'ITEM_SERVED', 'TAKEOUT_ORDER_SERVED');

-- CreateEnum
CREATE TYPE "PaymentSkipReasonType" AS ENUM ('TEST', 'DEVICE_ERROR', 'NETWORK_ERROR', 'OTHER');

-- CreateTable
CREATE TABLE "Kitchen" (
    "id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Kitchen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Actor" (
    "id" VARCHAR(64) NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "kitchenId" VARCHAR(64),
    "label" VARCHAR(120) NOT NULL,
    "secretHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "online" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Actor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "sessionId" TEXT NOT NULL,
    "actorId" VARCHAR(64) NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("sessionId")
);

-- CreateTable
CREATE TABLE "MenuCategory" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Menu" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "priceJpy" INTEGER NOT NULL,
    "availability" "Availability" NOT NULL DEFAULT 'AVAILABLE',
    "workloadSeconds" INTEGER NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "categoryId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "showLeadTime" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Menu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuKitchenAssignment" (
    "menuId" TEXT NOT NULL,
    "kitchenId" VARCHAR(64) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuKitchenAssignment_pkey" PRIMARY KEY ("menuId","kitchenId")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNo" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByActorId" VARCHAR(64) NOT NULL,
    "idempotencyKey" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "fulfillmentType" "FulfillmentType" NOT NULL,
    "tableNo" INTEGER,
    "partySize" INTEGER NOT NULL,
    "ageRangesJson" JSONB NOT NULL,
    "specialNote" TEXT,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "paymentStatus" "PaymentStatus" NOT NULL,
    "events" JSONB NOT NULL,
    "paymentSkipReasonType" "PaymentSkipReasonType",
    "paymentSkipReasonText" TEXT,
    "orderStatus" "OrderStatus" NOT NULL,
    "totalPriceJpy" INTEGER NOT NULL,
    "squareTransactionId" TEXT,
    "paymentAwaitDeadlineAt" TIMESTAMP(3),
    "autoCancelDeadlineAt" TIMESTAMP(3),
    "lastMutationVersion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "itemNameSnapshot" TEXT NOT NULL,
    "unitPriceJpy" INTEGER NOT NULL,
    "workloadSecondsSnapshot" INTEGER NOT NULL,
    "kitchenId" VARCHAR(64),
    "kitchenAssignedAt" TIMESTAMP(3),
    "status" "OrderItemStatus" NOT NULL,
    "readyAt" TIMESTAMP(3),
    "servedAt" TIMESTAMP(3),
    "servedByActorId" VARCHAR(64),

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UndoOperation" (
    "actorId" VARCHAR(64) NOT NULL,
    "operationType" "UndoOperationType" NOT NULL,
    "targetEntityType" VARCHAR(64) NOT NULL,
    "targetEntityId" VARCHAR(120) NOT NULL,
    "orderId" TEXT NOT NULL,
    "expectedOrderVersion" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UndoOperation_pkey" PRIMARY KEY ("actorId")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" VARCHAR(64),
    "actorType" "ActorType",
    "actionType" VARCHAR(64) NOT NULL,
    "entityType" VARCHAR(64) NOT NULL,
    "entityId" VARCHAR(120) NOT NULL,
    "orderId" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "reasonType" TEXT,
    "reasonText" TEXT,
    "result" "AuditResult" NOT NULL,
    "correlationId" TEXT,
    "prevHash" TEXT,
    "hash" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Actor_actorType_idx" ON "Actor"("actorType");

-- CreateIndex
CREATE INDEX "Actor_kitchenId_idx" ON "Actor"("kitchenId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_actorId_idx" ON "Session"("actorId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Menu_categoryId_idx" ON "Menu"("categoryId");

-- CreateIndex
CREATE INDEX "Menu_availability_isActive_idx" ON "Menu"("availability", "isActive");

-- CreateIndex
CREATE INDEX "MenuKitchenAssignment_kitchenId_enabled_idx" ON "MenuKitchenAssignment"("kitchenId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "Order_orderStatus_createdAt_idx" ON "Order"("orderStatus", "createdAt");

-- CreateIndex
CREATE INDEX "Order_paymentStatus_paymentAwaitDeadlineAt_idx" ON "Order"("paymentStatus", "paymentAwaitDeadlineAt");

-- CreateIndex
CREATE INDEX "Order_createdByActorId_idx" ON "Order"("createdByActorId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_status_idx" ON "OrderItem"("orderId", "status");

-- CreateIndex
CREATE INDEX "OrderItem_kitchenId_status_idx" ON "OrderItem"("kitchenId", "status");

-- CreateIndex
CREATE INDEX "OrderItem_readyAt_idx" ON "OrderItem"("readyAt");

-- CreateIndex
CREATE INDEX "UndoOperation_orderId_idx" ON "UndoOperation"("orderId");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_actionType_timestamp_idx" ON "AuditLog"("actionType", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_actorType_actorId_timestamp_idx" ON "AuditLog"("actorType", "actorId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_result_timestamp_idx" ON "AuditLog"("result", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_orderId_timestamp_idx" ON "AuditLog"("orderId", "timestamp");

-- AddForeignKey
ALTER TABLE "Actor" ADD CONSTRAINT "Actor_kitchenId_fkey" FOREIGN KEY ("kitchenId") REFERENCES "Kitchen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Menu" ADD CONSTRAINT "Menu_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MenuCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuKitchenAssignment" ADD CONSTRAINT "MenuKitchenAssignment_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuKitchenAssignment" ADD CONSTRAINT "MenuKitchenAssignment_kitchenId_fkey" FOREIGN KEY ("kitchenId") REFERENCES "Kitchen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdByActorId_fkey" FOREIGN KEY ("createdByActorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_kitchenId_fkey" FOREIGN KEY ("kitchenId") REFERENCES "Kitchen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_servedByActorId_fkey" FOREIGN KEY ("servedByActorId") REFERENCES "Actor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UndoOperation" ADD CONSTRAINT "UndoOperation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

