-- CreateEnum
CREATE TYPE "TenantKind" AS ENUM ('ORG', 'BUSINESS', 'MERCHANT', 'PLATFORM');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('BUYER', 'SPONSOR', 'ORG_ADMIN', 'ORG_OPERATOR', 'MERCHANT_ADMIN', 'MERCHANT_OPERATOR', 'PLATFORM_SUPPORT', 'PLATFORM_ADMIN');

-- CreateEnum
CREATE TYPE "MissionState" AS ENUM ('DRAFT', 'INTENT_CONFIRMED', 'PLANNING', 'PLAN_READY', 'AWAITING_SPONSOR', 'PARTIALLY_FUNDED', 'FUNDED', 'FULFILLING', 'PARTIALLY_FULFILLED', 'COMPLETED', 'BLOCKED', 'CANCELLED', 'NEEDS_REPLAN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PurchaseState" AS ENUM ('PLANNED', 'QUOTE_CONFIRMED', 'ORDER_CREATED', 'AWAITING_BUYER_APPROVAL', 'APPROVED', 'CAPTURE_PENDING', 'CAPTURED', 'ORDER_EXPIRED', 'PAYMENT_FAILED', 'UNKNOWN_RECONCILING', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "TwinHealth" AS ENUM ('UNDETERMINED', 'ON_TRACK', 'AT_RISK', 'BREACHED', 'UNDER_RECOVERY', 'FULFILLED', 'UNRESOLVED');

-- CreateEnum
CREATE TYPE "RecoveryState" AS ENUM ('PROPOSED', 'AWAITING_BUYER', 'AWAITING_MERCHANT', 'AUTHORIZED', 'EXECUTING', 'VERIFYING', 'SUCCEEDED', 'EXPIRED', 'REJECTED', 'FAILED', 'UNKNOWN_RECONCILING', 'CANCELLED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "ProvenanceSource" AS ENUM ('PAYPAL_API', 'PAYPAL_WEBHOOK', 'MERCHANT', 'CARRIER', 'RECIPIENT', 'BUYER', 'AI_DERIVED', 'POLICY_DERIVED', 'SIMULATED');

-- CreateEnum
CREATE TYPE "VerificationLevel" AS ENUM ('VERIFIED', 'ATTESTED', 'UNVERIFIED', 'SIMULATED');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('BUYER_CONFIRMED_INTENT', 'PAYPAL_API_VERIFIED', 'SELLER_ACCEPTED_TERMS', 'MERCHANT_ASSERTION', 'PAYPAL_TRACKING_METADATA', 'CARRIER_TRACKING', 'RECIPIENT_ATTESTED', 'PHOTO_OR_DOCUMENT', 'SIMULATED_DEMO');

-- CreateEnum
CREATE TYPE "PayPalEnvironment" AS ENUM ('sandbox', 'live');

-- CreateEnum
CREATE TYPE "FinancialCommandType" AS ENUM ('CREATE_ORDER', 'CAPTURE', 'REFUND', 'VOID', 'CREATE_INVOICE');

-- CreateEnum
CREATE TYPE "FinancialCommandState" AS ENUM ('PENDING', 'SENT', 'SUCCEEDED', 'FAILED', 'UNKNOWN_RECONCILING');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "authSubject" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TenantKind" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "timezone" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_connections" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "paypalMerchantId" TEXT,
    "environment" "PayPalEnvironment" NOT NULL,
    "encryptedSecretRef" TEXT,
    "permissions" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "missions" (
    "id" UUID NOT NULL,
    "orgTenantId" UUID NOT NULL,
    "createdBy" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'SUPPLY',
    "currency" CHAR(3) NOT NULL,
    "budgetMinor" BIGINT NOT NULL,
    "state" "MissionState" NOT NULL DEFAULT 'DRAFT',
    "deadline" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "scenarioKey" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "missions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intents" (
    "id" UUID NOT NULL,
    "missionId" UUID,
    "buyerTenantId" UUID NOT NULL,
    "createdBy" UUID NOT NULL,
    "rawText" TEXT NOT NULL,
    "compiledJson" JSONB NOT NULL,
    "compiledSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "confirmedSnapshotJson" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "compilerVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_products" (
    "id" UUID NOT NULL,
    "sellerTenantId" UUID,
    "source" TEXT NOT NULL,
    "sourceExternalId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "productKind" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "packSize" INTEGER NOT NULL DEFAULT 1,
    "inventoryQty" INTEGER NOT NULL,
    "leadTimeHours" INTEGER NOT NULL,
    "deliveryTerms" TEXT NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "catalog_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL,
    "sellerTenantId" UUID NOT NULL,
    "intentId" UUID NOT NULL,
    "catalogProductId" UUID,
    "sku" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "deliveryEstimateAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "termsJson" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_commitments" (
    "id" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "sellerTenantId" UUID NOT NULL,
    "acceptedBy" UUID NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "acceptedTermsJson" JSONB NOT NULL,
    "termsHash" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_commitments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL,
    "buyerTenantId" UUID NOT NULL,
    "intentId" UUID NOT NULL,
    "missionId" UUID,
    "payerUserId" UUID NOT NULL,
    "sellerTenantId" UUID,
    "commitmentId" UUID,
    "title" TEXT NOT NULL,
    "amountMinor" BIGINT,
    "currency" CHAR(3) NOT NULL,
    "state" "PurchaseState" NOT NULL DEFAULT 'PLANNED',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "scenarioKey" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_attempts" (
    "id" UUID NOT NULL,
    "purchaseId" UUID NOT NULL,
    "merchantConnectionId" UUID NOT NULL,
    "requestId" TEXT NOT NULL,
    "paypalOrderId" TEXT,
    "paypalOrderStatus" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "captureStatus" TEXT NOT NULL DEFAULT 'NOT_CAPTURED',
    "immutableQuoteHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkout_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paypal_captures" (
    "id" UUID NOT NULL,
    "purchaseId" UUID NOT NULL,
    "environment" "PayPalEnvironment" NOT NULL,
    "merchantConnectionId" UUID NOT NULL,
    "paypalOrderId" TEXT NOT NULL,
    "paypalCaptureId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "paypalStatus" TEXT NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paypal_captures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paypal_refunds" (
    "id" UUID NOT NULL,
    "captureId" UUID NOT NULL,
    "recoveryId" UUID,
    "requestId" TEXT NOT NULL,
    "paypalRefundId" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" TEXT NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paypal_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_commands" (
    "id" UUID NOT NULL,
    "purchaseId" UUID NOT NULL,
    "merchantConnectionId" UUID,
    "type" "FinancialCommandType" NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "state" "FinancialCommandState" NOT NULL DEFAULT 'PENDING',
    "paypalResourceId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paypal_webhook_inbox" (
    "id" UUID NOT NULL,
    "paypalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "rawChecksum" TEXT NOT NULL,
    "environment" "PayPalEnvironment" NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paypal_webhook_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promise_twins" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "purchaseId" UUID NOT NULL,
    "intentSnapshotJson" JSONB NOT NULL,
    "commitmentSnapshotJson" JSONB,
    "health" "TwinHealth" NOT NULL DEFAULT 'UNDETERMINED',
    "evaluationVersion" INTEGER NOT NULL DEFAULT 0,
    "aggregateVersion" INTEGER NOT NULL DEFAULT 1,
    "lastEvaluatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promise_twins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "twin_evaluations" (
    "id" UUID NOT NULL,
    "twinId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "evidenceIdsJson" JSONB NOT NULL,
    "constraintResultsJson" JSONB NOT NULL,
    "causeHypothesesJson" JSONB NOT NULL,
    "resultJson" JSONB NOT NULL,
    "health" "TwinHealth" NOT NULL,
    "rationale" TEXT NOT NULL,
    "clockNow" TIMESTAMP(3) NOT NULL,
    "clockSimulated" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "twin_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "constraint_evaluations" (
    "id" UUID NOT NULL,
    "twinEvaluationId" UUID NOT NULL,
    "constraintId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "sellerCommitmentId" UUID,
    "policyRuleId" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,

    CONSTRAINT "constraint_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "twin_snapshots" (
    "id" UUID NOT NULL,
    "twinId" UUID NOT NULL,
    "aggregateVersion" INTEGER NOT NULL,
    "eventSeq" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "stateJson" JSONB NOT NULL,
    "knownAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshotHash" TEXT NOT NULL,
    "isSimulated" BOOLEAN NOT NULL,

    CONSTRAINT "twin_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "twinId" UUID NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "assertionType" TEXT NOT NULL,
    "source" "ProvenanceSource" NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payloadJson" JSONB NOT NULL,
    "storageObjectKey" TEXT,
    "attestedBy" UUID,
    "verificationLevel" "VerificationLevel" NOT NULL,
    "isSimulated" BOOLEAN NOT NULL,
    "checksum" TEXT NOT NULL,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillments" (
    "id" UUID NOT NULL,
    "purchaseId" UUID NOT NULL,
    "merchantStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "carrierStatus" TEXT,
    "recipientStatus" TEXT NOT NULL DEFAULT 'NOT_RECEIVED',
    "deliveryEventAt" TIMESTAMP(3),
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fulfillments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "twinId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "breachConstraintIds" JSONB NOT NULL,
    "evidenceIdsJson" JSONB NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_proposals" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "sellerTenantId" UUID,
    "amountMinor" BIGINT,
    "currency" CHAR(3) NOT NULL,
    "proposedPlanJson" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "state" "RecoveryState" NOT NULL DEFAULT 'PROPOSED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_approvals" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "proposalVersion" INTEGER NOT NULL,
    "actorUserId" UUID NOT NULL,
    "actorTenantId" UUID NOT NULL,
    "permission" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "signedSnapshotHash" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "seq" SERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "seq" SERIAL NOT NULL,
    "tenantId" UUID,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "policyDecision" TEXT,
    "beforeHash" TEXT,
    "afterHash" TEXT,
    "correlationId" TEXT NOT NULL,
    "prevHash" TEXT NOT NULL,
    "entryHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "workflow" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "llmProvider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "summarizedToolTraceJson" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_receipts" (
    "id" UUID NOT NULL,
    "missionId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "artifactHash" TEXT NOT NULL,
    "summaryJson" JSONB NOT NULL,
    "publicTokenHash" TEXT,
    "revokedAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mission_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demo_clocks" (
    "scenarioKey" TEXT NOT NULL,
    "tenantId" UUID NOT NULL,
    "simulatedNow" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demo_clocks_pkey" PRIMARY KEY ("scenarioKey")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_authSubject_key" ON "users"("authSubject");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "memberships_tenantId_idx" ON "memberships"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_userId_tenantId_role_key" ON "memberships"("userId", "tenantId", "role");

-- CreateIndex
CREATE INDEX "merchant_connections_tenantId_idx" ON "merchant_connections"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_connections_environment_paypalMerchantId_key" ON "merchant_connections"("environment", "paypalMerchantId");

-- CreateIndex
CREATE UNIQUE INDEX "missions_scenarioKey_key" ON "missions"("scenarioKey");

-- CreateIndex
CREATE INDEX "missions_orgTenantId_createdAt_idx" ON "missions"("orgTenantId", "createdAt");

-- CreateIndex
CREATE INDEX "intents_buyerTenantId_createdAt_idx" ON "intents"("buyerTenantId", "createdAt");

-- CreateIndex
CREATE INDEX "catalog_products_productKind_idx" ON "catalog_products"("productKind");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_products_source_sourceExternalId_key" ON "catalog_products"("source", "sourceExternalId");

-- CreateIndex
CREATE INDEX "offers_intentId_idx" ON "offers"("intentId");

-- CreateIndex
CREATE UNIQUE INDEX "seller_commitments_offerId_version_key" ON "seller_commitments"("offerId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_scenarioKey_key" ON "purchases"("scenarioKey");

-- CreateIndex
CREATE INDEX "purchases_buyerTenantId_createdAt_idx" ON "purchases"("buyerTenantId", "createdAt");

-- CreateIndex
CREATE INDEX "purchases_sellerTenantId_idx" ON "purchases"("sellerTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_attempts_requestId_key" ON "checkout_attempts"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_attempts_paypalOrderId_key" ON "checkout_attempts"("paypalOrderId");

-- CreateIndex
CREATE INDEX "checkout_attempts_purchaseId_idx" ON "checkout_attempts"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "paypal_captures_paypalCaptureId_key" ON "paypal_captures"("paypalCaptureId");

-- CreateIndex
CREATE INDEX "paypal_captures_purchaseId_idx" ON "paypal_captures"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "paypal_refunds_requestId_key" ON "paypal_refunds"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "paypal_refunds_paypalRefundId_key" ON "paypal_refunds"("paypalRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_commands_requestId_key" ON "financial_commands"("requestId");

-- CreateIndex
CREATE INDEX "financial_commands_purchaseId_idx" ON "financial_commands"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "paypal_webhook_inbox_paypalEventId_key" ON "paypal_webhook_inbox"("paypalEventId");

-- CreateIndex
CREATE UNIQUE INDEX "promise_twins_purchaseId_key" ON "promise_twins"("purchaseId");

-- CreateIndex
CREATE INDEX "promise_twins_tenantId_updatedAt_idx" ON "promise_twins"("tenantId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "twin_evaluations_twinId_version_key" ON "twin_evaluations"("twinId", "version");

-- CreateIndex
CREATE INDEX "constraint_evaluations_twinEvaluationId_idx" ON "constraint_evaluations"("twinEvaluationId");

-- CreateIndex
CREATE INDEX "twin_snapshots_twinId_eventSeq_idx" ON "twin_snapshots"("twinId", "eventSeq" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "twin_snapshots_twinId_eventSeq_key" ON "twin_snapshots"("twinId", "eventSeq");

-- CreateIndex
CREATE INDEX "evidence_twinId_ingestedAt_idx" ON "evidence"("twinId", "ingestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_twinId_source_sourceEventId_key" ON "evidence"("twinId", "source", "sourceEventId");

-- CreateIndex
CREATE UNIQUE INDEX "fulfillments_purchaseId_key" ON "fulfillments"("purchaseId");

-- CreateIndex
CREATE INDEX "incidents_twinId_idx" ON "incidents"("twinId");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_proposals_idempotencyKey_key" ON "recovery_proposals"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_approvals_proposalId_proposalVersion_permission_key" ON "recovery_approvals"("proposalId", "proposalVersion", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_seq_key" ON "outbox_events"("seq");

-- CreateIndex
CREATE INDEX "outbox_events_tenantId_seq_idx" ON "outbox_events"("tenantId", "seq");

-- CreateIndex
CREATE INDEX "outbox_events_tenantId_aggregateId_version_idx" ON "outbox_events"("tenantId", "aggregateId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_seq_key" ON "audit_log"("seq");

-- CreateIndex
CREATE INDEX "audit_log_tenantId_createdAt_idx" ON "audit_log"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_runs_tenantId_entityId_idx" ON "agent_runs"("tenantId", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "mission_receipts_missionId_revision_key" ON "mission_receipts"("missionId", "revision");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_connections" ADD CONSTRAINT "merchant_connections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intents" ADD CONSTRAINT "intents_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_sellerTenantId_fkey" FOREIGN KEY ("sellerTenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_commitments" ADD CONSTRAINT "seller_commitments_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "seller_commitments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_attempts" ADD CONSTRAINT "checkout_attempts_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paypal_captures" ADD CONSTRAINT "paypal_captures_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paypal_refunds" ADD CONSTRAINT "paypal_refunds_captureId_fkey" FOREIGN KEY ("captureId") REFERENCES "paypal_captures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_commands" ADD CONSTRAINT "financial_commands_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promise_twins" ADD CONSTRAINT "promise_twins_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "twin_evaluations" ADD CONSTRAINT "twin_evaluations_twinId_fkey" FOREIGN KEY ("twinId") REFERENCES "promise_twins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "constraint_evaluations" ADD CONSTRAINT "constraint_evaluations_twinEvaluationId_fkey" FOREIGN KEY ("twinEvaluationId") REFERENCES "twin_evaluations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "twin_snapshots" ADD CONSTRAINT "twin_snapshots_twinId_fkey" FOREIGN KEY ("twinId") REFERENCES "promise_twins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_twinId_fkey" FOREIGN KEY ("twinId") REFERENCES "promise_twins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_twinId_fkey" FOREIGN KEY ("twinId") REFERENCES "promise_twins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_proposals" ADD CONSTRAINT "recovery_proposals_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_approvals" ADD CONSTRAINT "recovery_approvals_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "recovery_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
