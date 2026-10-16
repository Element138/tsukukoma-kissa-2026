ALTER TYPE "PaymentIncidentType" ADD VALUE 'SQUARE_RESULT_MISSING';
CREATE TABLE "SquarePaymentAttempt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "stateToken" TEXT NOT NULL,
  "appId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "callbackUrl" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "launchedAt" TIMESTAMP(3),
  "callbackJson" JSONB,
  "transactionId" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "verifyAttempts" INTEGER NOT NULL DEFAULT 0,
  "verifyAfter" TIMESTAMP(3),
  CONSTRAINT "SquarePaymentAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SquarePaymentAttempt_orderId_key" ON "SquarePaymentAttempt"("orderId");
CREATE UNIQUE INDEX "SquarePaymentAttempt_stateToken_key" ON "SquarePaymentAttempt"("stateToken");
CREATE UNIQUE INDEX "SquarePaymentAttempt_transactionId_key" ON "SquarePaymentAttempt"("transactionId");
