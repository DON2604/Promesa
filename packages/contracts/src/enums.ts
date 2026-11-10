import { z } from 'zod';

/** Canonical enums shared by Prisma, OpenAPI and the frontend. Values must match `schema.prisma`. */

export const ROLES = [
  'BUYER',
  'SPONSOR',
  'ORG_ADMIN',
  'ORG_OPERATOR',
  'MERCHANT_ADMIN',
  'MERCHANT_OPERATOR',
  'PLATFORM_SUPPORT',
  'PLATFORM_ADMIN',
] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

export const TENANT_KINDS = ['ORG', 'BUSINESS', 'MERCHANT', 'PLATFORM'] as const;
export type TenantKind = (typeof TENANT_KINDS)[number];

export const MISSION_STATES = [
  'DRAFT',
  'INTENT_CONFIRMED',
  'PLANNING',
  'PLAN_READY',
  'AWAITING_SPONSOR',
  'PARTIALLY_FUNDED',
  'FUNDED',
  'FULFILLING',
  'PARTIALLY_FULFILLED',
  'COMPLETED',
  'BLOCKED',
  'CANCELLED',
  'NEEDS_REPLAN',
  'EXPIRED',
] as const;
export type MissionState = (typeof MISSION_STATES)[number];

export const PURCHASE_STATES = [
  'PLANNED',
  'QUOTE_CONFIRMED',
  'ORDER_CREATED',
  'AWAITING_BUYER_APPROVAL',
  'APPROVED',
  'CAPTURE_PENDING',
  'CAPTURED',
  'ORDER_EXPIRED',
  'PAYMENT_FAILED',
  'UNKNOWN_RECONCILING',
  'CANCELLED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
] as const;
export type PurchaseState = (typeof PURCHASE_STATES)[number];

export const TWIN_HEALTH = [
  'UNDETERMINED',
  'ON_TRACK',
  'AT_RISK',
  'BREACHED',
  'UNDER_RECOVERY',
  'FULFILLED',
  'UNRESOLVED',
] as const;
export const TwinHealthSchema = z.enum(TWIN_HEALTH);
export type TwinHealth = z.infer<typeof TwinHealthSchema>;

export const RECOVERY_STATES = [
  'PROPOSED',
  'AWAITING_BUYER',
  'AWAITING_MERCHANT',
  'AUTHORIZED',
  'EXECUTING',
  'VERIFYING',
  'SUCCEEDED',
  'EXPIRED',
  'REJECTED',
  'FAILED',
  'UNKNOWN_RECONCILING',
  'CANCELLED',
  'ESCALATED',
] as const;
export type RecoveryState = (typeof RECOVERY_STATES)[number];

/** Who produced a fact. */
export const PROVENANCE_SOURCES = [
  'PAYPAL_API',
  'PAYPAL_WEBHOOK',
  'MERCHANT',
  'CARRIER',
  'RECIPIENT',
  'BUYER',
  'AI_DERIVED',
  'POLICY_DERIVED',
  'SIMULATED',
] as const;
export type ProvenanceSource = (typeof PROVENANCE_SOURCES)[number];

export const VERIFICATION_LEVELS = ['VERIFIED', 'ATTESTED', 'UNVERIFIED', 'SIMULATED'] as const;
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

/** What a piece of evidence is able to prove (backend spec §7, evidence reliability). */
export const EVIDENCE_KINDS = [
  'BUYER_CONFIRMED_INTENT',
  'PAYPAL_API_VERIFIED',
  'SELLER_ACCEPTED_TERMS',
  'MERCHANT_ASSERTION',
  'PAYPAL_TRACKING_METADATA',
  'CARRIER_TRACKING',
  'RECIPIENT_ATTESTED',
  'PHOTO_OR_DOCUMENT',
  'SIMULATED_DEMO',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_ASSERTIONS = [
  'INTENT_CONFIRMED',
  'TERMS_ACCEPTED',
  'ETA_REVISED',
  'SHIPPED',
  'DELIVERED',
  'RECEIPT_ACKNOWLEDGED',
  'PAYMENT_CAPTURED',
  'PAYMENT_REFUNDED',
  'STOCK_UNAVAILABLE',
] as const;
export type EvidenceAssertion = (typeof EVIDENCE_ASSERTIONS)[number];

export const CAUSE_CLASSIFICATIONS = [
  'AI_SELECTION_ERROR',
  'MERCHANT_COMMITMENT_BREACH',
  'MERCHANT_COMMITMENT_RISK',
  'CARRIER_DELAY',
  'BUYER_CHANGED_REQUIREMENT',
  'PAYMENT_ISSUE',
  'UNCERTAIN_CAUSE',
] as const;
export type CauseClassification = (typeof CAUSE_CLASSIFICATIONS)[number];
