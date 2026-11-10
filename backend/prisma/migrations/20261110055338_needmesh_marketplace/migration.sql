-- AlterTable
ALTER TABLE "mission_orders" ADD COLUMN     "proposalId" UUID,
ADD COLUMN     "sponsorTenantId" UUID;

-- AlterTable
ALTER TABLE "missions" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'supplies',
ADD COLUMN     "publicSummary" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "repeatOfMissionId" UUID,
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'PRIVATE';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "preferencesJson" JSONB,
ADD COLUMN     "publicProfileJson" JSONB,
ADD COLUMN     "verificationMethod" TEXT,
ADD COLUMN     "verificationNote" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "merchant_proposals" (
    "id" UUID NOT NULL,
    "missionId" UUID NOT NULL,
    "merchantTenantId" UUID NOT NULL,
    "catalogProductId" UUID NOT NULL,
    "submittedBy" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL,
    "leadTimeHours" INTEGER NOT NULL,
    "deliveryTerms" TEXT NOT NULL,
    "note" TEXT,
    "state" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "counterUnitPriceMinor" BIGINT,
    "counterRationale" TEXT,
    "counteredBy" UUID,
    "counteredAt" TIMESTAMP(3),
    "agreedUnitPriceMinor" BIGINT,
    "merchantAcceptedAt" TIMESTAMP(3),
    "orgAcceptedBy" UUID,
    "orgAcceptedAt" TIMESTAMP(3),
    "evaluationJson" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merchant_proposals_missionId_state_idx" ON "merchant_proposals"("missionId", "state");

-- CreateIndex
CREATE INDEX "merchant_proposals_merchantTenantId_createdAt_idx" ON "merchant_proposals"("merchantTenantId", "createdAt");

-- CreateIndex
CREATE INDEX "missions_visibility_publishedAt_idx" ON "missions"("visibility", "publishedAt");

-- AddForeignKey
ALTER TABLE "merchant_proposals" ADD CONSTRAINT "merchant_proposals_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
