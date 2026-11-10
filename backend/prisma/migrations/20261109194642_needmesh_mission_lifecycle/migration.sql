-- AlterTable
ALTER TABLE "missions" ADD COLUMN     "planJson" JSONB,
ADD COLUMN     "planRound" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "mission_orders" (
    "id" UUID NOT NULL,
    "missionId" UUID NOT NULL,
    "planRound" INTEGER NOT NULL,
    "replacesOrderId" UUID,
    "merchantTenantId" UUID NOT NULL,
    "catalogProductId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "estimatedDeliveryAt" TIMESTAMP(3),
    "quoteHash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'AWAITING_APPROVAL',
    "version" INTEGER NOT NULL DEFAULT 1,
    "railMode" TEXT NOT NULL DEFAULT 'SIMULATED',
    "stockConfirmedAt" TIMESTAMP(3),
    "stockoutAt" TIMESTAMP(3),
    "paypalOrderId" TEXT,
    "paypalAuthorizationId" TEXT,
    "paypalCaptureId" TEXT,
    "paypalRefundId" TEXT,
    "approveUrl" TEXT,
    "paypalLastVerifiedAt" TIMESTAMP(3),
    "approvedBy" UUID,
    "approvedAt" TIMESTAMP(3),
    "refundApprovedAt" TIMESTAMP(3),
    "carrier" TEXT,
    "trackingNumber" TEXT,
    "shippedAt" TIMESTAMP(3),
    "quantityReceived" INTEGER,
    "receiptNote" TEXT,
    "acknowledgedBy" UUID,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mission_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_events" (
    "id" UUID NOT NULL,
    "seq" SERIAL NOT NULL,
    "missionId" UUID NOT NULL,
    "orderId" UUID,
    "agent" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "engine" TEXT NOT NULL DEFAULT 'deterministic',
    "payloadJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mission_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mission_orders_paypalOrderId_key" ON "mission_orders"("paypalOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "mission_orders_paypalAuthorizationId_key" ON "mission_orders"("paypalAuthorizationId");

-- CreateIndex
CREATE UNIQUE INDEX "mission_orders_paypalCaptureId_key" ON "mission_orders"("paypalCaptureId");

-- CreateIndex
CREATE UNIQUE INDEX "mission_orders_paypalRefundId_key" ON "mission_orders"("paypalRefundId");

-- CreateIndex
CREATE INDEX "mission_orders_missionId_planRound_idx" ON "mission_orders"("missionId", "planRound");

-- CreateIndex
CREATE UNIQUE INDEX "mission_events_seq_key" ON "mission_events"("seq");

-- CreateIndex
CREATE INDEX "mission_events_missionId_seq_idx" ON "mission_events"("missionId", "seq");

-- AddForeignKey
ALTER TABLE "mission_orders" ADD CONSTRAINT "mission_orders_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_events" ADD CONSTRAINT "mission_events_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
