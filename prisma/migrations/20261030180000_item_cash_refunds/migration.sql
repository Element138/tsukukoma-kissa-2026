-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'PARTIALLY_CANCELED';

-- AlterTable
ALTER TABLE "OrderMenuCapReservation" ADD COLUMN     "releasedQuantity" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "OrderRefund" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "actorId" VARCHAR(64) NOT NULL,
    "idempotencyKey" VARCHAR(64) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "reasonText" VARCHAR(500) NOT NULL,
    "amountJpy" INTEGER NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderRefundItem" (
    "id" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitPriceJpy" INTEGER NOT NULL,
    "previousStatus" "OrderItemStatus" NOT NULL,

    CONSTRAINT "OrderRefundItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderRefund_idempotencyKey_key" ON "OrderRefund"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OrderRefund_orderId_confirmedAt_idx" ON "OrderRefund"("orderId", "confirmedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderRefundItem_orderItemId_key" ON "OrderRefundItem"("orderItemId");

-- CreateIndex
CREATE INDEX "OrderRefundItem_refundId_idx" ON "OrderRefundItem"("refundId");

-- AddForeignKey
ALTER TABLE "OrderRefund" ADD CONSTRAINT "OrderRefund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRefundItem" ADD CONSTRAINT "OrderRefundItem_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "OrderRefund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRefundItem" ADD CONSTRAINT "OrderRefundItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderRefund" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderRefundItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderRefund" ADD CONSTRAINT "OrderRefund_amount_nonnegative" CHECK ("amountJpy" >= 0);
ALTER TABLE "OrderMenuCapReservation" ADD CONSTRAINT "OrderMenuCapReservation_released_quantity" CHECK ("releasedQuantity" >= 0 AND "releasedQuantity" <= "quantity");
