import { z } from 'zod';
import type { MissionState, ProvenanceSource } from './enums';
import type { ReadModelMeta } from './views';

/**
 * NeedMesh mission lifecycle contracts. A mission is funded through one PayPal order per
 * merchant (`MissionOrder`). Agents plan and explain; a deterministic policy engine decides
 * which financial actions are allowed; PayPal (or the clearly labelled simulated rail) executes.
 */

export const MISSION_ORDER_STATES = [
  'AWAITING_APPROVAL',
  'PAYPAL_ORDER_CREATED',
  'AUTHORIZED',
  'CAPTURED',
  'SHIPPED',
  'DELIVERED',
  'VOIDED',
  'REFUND_PENDING',
  'REFUNDED',
  'CANCELLED',
] as const;
export type MissionOrderState = (typeof MISSION_ORDER_STATES)[number];

/** SANDBOX = real PayPal Sandbox REST calls. SIMULATED = labelled in-app rail, never a PayPal record. */
export type PayPalRailMode = 'SANDBOX' | 'SIMULATED';

export const MISSION_AGENTS = [
  'MISSION_PLANNER',
  'MERCHANT_MATCHING',
  'COMMERCE_PLANNER',
  'NEGOTIATION',
  'FUNDING',
  'PROMISETWIN',
  'POLICY_ENGINE',
  'PAYPAL_COMMERCE',
  'RECOVERY',
  'FULFILLMENT',
  'RECONCILIATION',
  'HUMAN',
] as const;
export type MissionAgent = (typeof MISSION_AGENTS)[number];

export type MissionEventSource = Extract<
  ProvenanceSource,
  | 'PAYPAL_API'
  | 'PAYPAL_WEBHOOK'
  | 'MERCHANT'
  | 'RECIPIENT'
  | 'BUYER'
  | 'AI_DERIVED'
  | 'POLICY_DERIVED'
  | 'SIMULATED'
>;

export type MissionOrderView = {
  id: string;
  /** 0 = original plan; increments for every recovery re-plan. */
  planRound: number;
  replacesOrderId: string | null;
  merchantName: string;
  merchantTenantId: string;
  sku: string;
  title: string;
  quantity: number;
  unitPriceMinor: string;
  amountMinor: string;
  currency: string;
  state: MissionOrderState;
  estimatedDeliveryAt: string | null;
  quoteHash: string;
  stockConfirmed: boolean;
  stockoutAt: string | null;
  paypal: {
    mode: PayPalRailMode;
    orderId: string | null;
    authorizationId: string | null;
    captureId: string | null;
    refundId: string | null;
    approveUrl: string | null;
    lastVerifiedAt: string | null;
  };
  tracking: { carrier: string; trackingNumber: string; shippedAt: string } | null;
  receipt: { quantityReceived: number; note: string | null; acknowledgedAt: string } | null;
  /** Which sponsor funded this order. Each order is a separate PayPal checkout; there is no pooled wallet. */
  fundedBy: { sponsorName: string; sponsorOrg: string; approvedAt: string | null } | null;
  /** Set when an accepted merchant proposal priced this order. */
  negotiated: { proposalId: string; listUnitPriceMinor: string } | null;
  /** PromiseTwin protection for this purchase: commitments vs evidence, derived on the server. */
  protection: OrderProtectionView;
  /** What the agents allow next, derived on the server. */
  allowedActions: Array<
    | 'APPROVE'
    | 'AUTHORIZE_RETURN'
    | 'MERCHANT_CONFIRM'
    | 'MERCHANT_STOCKOUT'
    | 'MERCHANT_SHIP'
    | 'MERCHANT_APPROVE_REFUND'
    | 'ACKNOWLEDGE'
  >;
};

export type MissionEventView = {
  id: string;
  seq: number;
  agent: MissionAgent;
  kind: string;
  title: string;
  detail: string;
  source: MissionEventSource;
  /** `deterministic` or `llm:<provider>/<model>` — never implied. */
  engine: string;
  orderId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
};

export type MissionPlanView = {
  round: number;
  status: 'NONE' | 'PROPOSED' | 'INFEASIBLE';
  narrative: { headline: string; rationale: string; tradeoffs: string[]; engine: string } | null;
  unmetQuantity: number;
  excluded: Array<{ sku: string; merchantName: string; reasons: string[] }>;
};

export type MissionReceiptView = {
  id: string;
  revision: number;
  artifactHash: string;
  generatedAt: string;
  missionTitle: string;
  requestedUnits: number;
  deliveredUnits: number;
  totalPaidMinor: string;
  currency: string;
  refundedMinor: string;
  voidedMinor: string;
  recoveries: number;
  lines: Array<{
    orderId: string;
    merchantName: string;
    sku: string;
    quantity: number;
    quantityReceived: number;
    amountMinor: string;
    paypalCaptureId: string | null;
    paypalMode: PayPalRailMode;
    tracking: string | null;
  }>;
  evidenceNote: string;
};

export type ProtectionHealth =
  'UNDETERMINED' | 'ON_TRACK' | 'AT_RISK' | 'BREACHED' | 'UNDER_RECOVERY' | 'FULFILLED';

export type OrderProtectionView = {
  health: ProtectionHealth;
  /** Four tracks that PromiseTwin keeps separate: intent, merchant commitment, PayPal, delivery. */
  tracks: Array<{
    track: 'INTENT' | 'MERCHANT' | 'PAYPAL' | 'DELIVERY';
    status: 'MET' | 'PENDING' | 'AT_RISK' | 'FAILED';
    detail: string;
  }>;
  gaps: string[];
  /** Remedies the policy engine would allow next. Proposals only; nothing runs without approval. */
  remedies: string[];
};

export type DiscoverySourceStatus = 'ACTIVE' | 'NOT_CONFIGURED' | 'UNAVAILABLE';

/**
 * One merchant offer from Channel3. The URL is an affiliate buy link fetched for this response.
 * Price and availability are merchant-reported; they are not a NeedMesh stock or checkout guarantee.
 */
export type Channel3OfferView = {
  domain: string;
  url: string;
  price: number;
  currency: string;
  compareAtPrice: number | null;
  availability: 'InStock' | 'OutOfStock';
};

/** A Channel3 catalog product. It is not a connected-merchant listing and cannot be checked out here. */
export type Channel3ProductView = {
  id: string;
  title: string;
  brand: string | null;
  imageUrl: string | null;
  category: string | null;
  offers: Channel3OfferView[];
};

export type Channel3DiscoveryView = {
  status: DiscoverySourceStatus;
  detail: string;
  /** Text query sent to Channel3. Null when no search ran. */
  query: string | null;
  /** When these products were fetched. Null when there are no products. */
  observedAt: string | null;
  products: Channel3ProductView[];
};

export type SupplyNodeView = {
  productId: string;
  sku: string;
  title: string;
  merchantTenantId: string;
  merchantName: string;
  unitPriceMinor: string;
  negotiatedUnitPriceMinor: string | null;
  inventoryQty: number;
  leadTimeHours: number;
  /** VERIFIED (fresh, connected), STALE (older than 24h), SIMULATED (demo fixture). */
  availability: 'VERIFIED' | 'STALE' | 'SIMULATED';
  compatible: boolean;
  reasons: string[];
  /** Units currently allocated to this listing by live orders. */
  allocated: number;
};

export type AgentRunView = {
  id: string;
  workflow: string;
  state: string;
  engine: string;
  startedAt: string;
  endedAt: string | null;
  nodes: Array<{
    node: string;
    label: string;
    status: 'DONE' | 'SKIPPED' | 'FAILED';
    output: string;
  }>;
};

export type ProposalView = {
  id: string;
  missionId: string;
  merchantTenantId: string;
  merchantName: string;
  productId: string;
  sku: string;
  title: string;
  quantity: number;
  unitPriceMinor: string;
  listUnitPriceMinor: string;
  leadTimeHours: number;
  deliveryTerms: string;
  note: string | null;
  state: 'SUBMITTED' | 'COUNTERED' | 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN';
  counterUnitPriceMinor: string | null;
  counterRationale: string | null;
  agreedUnitPriceMinor: string | null;
  evaluation: {
    compatible: boolean;
    recommendation: 'ACCEPT' | 'COUNTER' | 'DECLINE';
    targetUnitPriceMinor: string;
    rationale: string;
    checks: Array<{ label: string; passed: boolean; detail: string }>;
  };
  createdAt: string;
  updatedAt: string;
  /** Actions the viewer may take, computed on the server. */
  allowedActions: Array<
    'ORG_ACCEPT' | 'ORG_COUNTER' | 'ORG_DECLINE' | 'MERCHANT_ACCEPT' | 'MERCHANT_WITHDRAW'
  >;
};

export type MissionLifecycleView = ReadModelMeta & {
  missionId: string;
  state: MissionState;
  /** Requested → planned → funded → purchased (captured) → shipped → received. Separate states, never merged. */
  atlas: {
    requested: number;
    planned: number;
    funded: number;
    purchased: number;
    shipped: number;
    received: number;
  };
  marketplace: {
    visibility: 'PRIVATE' | 'PUBLIC';
    category: string;
    publicSummary: string | null;
    publishedAt: string | null;
    orgName: string;
    orgVerified: boolean;
  };
  /** True when the viewer belongs to the requesting organization (can plan, publish, negotiate). */
  viewerIsOrg: boolean;
  sponsors: Array<{ sponsorName: string; sponsorOrg: string; orders: number; amountMinor: string }>;
  unfundedMinor: string;
  supply: SupplyNodeView[];
  discoverySources: Array<{ name: string; status: DiscoverySourceStatus; detail: string }>;
  /** External catalog metadata. Never mixed into the orderable merchant catalog. */
  channel3: Channel3DiscoveryView;
  proposals: ProposalView[];
  agentRuns: AgentRunView[];
  rail: { mode: PayPalRailMode; label: string; detail: string };
  mcp: {
    status: 'OK' | 'IDLE' | 'NOT_CONFIGURED' | 'ERROR' | 'DISABLED';
    detail: string;
    tools: string[];
  };
  /** Language model that narrates agent decisions, or `deterministic` when none is configured. */
  ai: { provider: string; model: string | null };
  budget: {
    limitMinor: string;
    committedMinor: string;
    remainingMinor: string;
    currency: string;
  };
  coverage: { requested: number; planned: number; funded: number; delivered: number };
  plan: MissionPlanView;
  orders: MissionOrderView[];
  events: MissionEventView[];
  receipt: MissionReceiptView | null;
  /** Server-computed hint for the UI; the UI never decides what is allowed. */
  nextStep: { actor: 'ORG' | 'SPONSOR' | 'MERCHANT' | 'AGENTS' | 'NONE'; label: string };
  demoControlsEnabled: boolean;
};

export const MerchantActionSchema = z.object({
  action: z.enum(['CONFIRM_STOCK', 'STOCKOUT', 'SHIP', 'APPROVE_REFUND']),
});
export type MerchantActionRequest = z.infer<typeof MerchantActionSchema>;

export const AcknowledgeReceiptSchema = z.object({
  quantityReceived: z.number().int().min(0).max(100_000),
  note: z.string().trim().max(500).optional(),
});
export type AcknowledgeReceiptRequest = z.infer<typeof AcknowledgeReceiptSchema>;

export const AuthorizeReturnSchema = z.object({
  /** PayPal's `token` query parameter on the return URL (= PayPal order id). Verified server-side. */
  paypalOrderId: z.string().min(5).max(64),
});
export type AuthorizeReturnRequest = z.infer<typeof AuthorizeReturnSchema>;

export const SubmitProposalSchema = z.object({
  catalogProductId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100_000),
  unitPriceMinor: z.string().regex(/^\d{1,9}$/),
  leadTimeHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
  deliveryTerms: z.string().trim().min(3).max(200),
  note: z.string().trim().max(500).optional(),
});
export type SubmitProposalRequest = z.infer<typeof SubmitProposalSchema>;

export const ProposalDecisionSchema = z.object({
  action: z.enum([
    'ORG_ACCEPT',
    'ORG_COUNTER',
    'ORG_DECLINE',
    'MERCHANT_ACCEPT',
    'MERCHANT_WITHDRAW',
  ]),
  /** Optional override of the Negotiation agent's counter price (ORG_COUNTER only). */
  counterUnitPriceMinor: z
    .string()
    .regex(/^\d{1,9}$/)
    .optional(),
});
export type ProposalDecisionRequest = z.infer<typeof ProposalDecisionSchema>;

export const PublishMissionSchema = z.object({
  visibility: z.enum(['PRIVATE', 'PUBLIC']),
  category: z.string().trim().min(2).max(40),
  publicSummary: z.string().trim().min(10).max(400),
});
export type PublishMissionRequest = z.infer<typeof PublishMissionSchema>;

export const RepeatMissionSchema = z.object({
  /** New deadline; defaults to the original deadline plus 14 days. */
  deadlineISO: z.string().datetime({ offset: true }).optional(),
});
export type RepeatMissionRequest = z.infer<typeof RepeatMissionSchema>;
