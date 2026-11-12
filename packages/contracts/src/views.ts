import type {
  CauseClassification,
  EvidenceAssertion,
  EvidenceKind,
  MissionState,
  ProvenanceSource,
  PurchaseState,
  Role,
  TenantKind,
  TwinHealth,
  VerificationLevel,
} from './enums';
import type { IntentSpec } from './intent';

/** Every read model carries these so the UI can be honest about freshness and simulation. */
export type ReadModelMeta = {
  schemaVersion: 1;
  aggregateVersion: number;
  asOf: string;
  simulationMode: boolean;
};

export type Provenance = {
  source: ProvenanceSource;
  sourceId: string;
  observedAt: string;
  ingestedAt: string;
  verification: VerificationLevel;
};

export type ApiErrorBody = {
  error: { code: string; message: string; details?: unknown; correlationId: string };
};

// ---------- identity ----------

export type Persona = {
  key: string;
  email: string;
  displayName: string;
  title: string;
  tenantName: string;
  tenantKind: TenantKind;
  roles: Role[];
  summary: string;
};

/** Who has the app open right now (heartbeat-based, informational only). */
export type PresenceView = {
  onlineTotal: number;
  users: Array<{
    userId: string;
    displayName: string;
    tenantName: string;
    tenantKind: TenantKind;
    role: Role;
    isYou: boolean;
    since: string;
  }>;
};

export type Me = {
  user: { id: string; displayName: string; email: string };
  activeTenant: { id: string; name: string; kind: TenantKind; timezone: string };
  activeRole: Role;
  memberships: Array<{ tenantId: string; tenantName: string; tenantKind: TenantKind; role: Role }>;
  identityProvider: 'DEMO' | 'PASSWORD';
};

// ---------- commerce ----------

export type ConstraintCheck = {
  constraintId: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type OfferView = {
  productId: string;
  sku: string;
  title: string;
  merchant: { tenantId: string; name: string; paypalConnected: boolean };
  attributes: string[];
  unitPriceMinor: string;
  currency: string;
  quantityOffered: number;
  totalMinor: string;
  inventoryQty: number;
  estimatedDeliveryAt: string;
  deliveryTerms: string;
  source: string;
  isDemo: boolean;
  lastVerifiedAt: string;
  eligible: boolean;
  checks: ConstraintCheck[];
  exclusionReasons: string[];
};

export type PlanAlternative = {
  key: 'LOWEST_COST' | 'EARLIEST_ARRIVAL' | 'FEWEST_MERCHANTS';
  label: string;
  lines: Array<{ productId: string; merchantName: string; quantity: number; totalMinor: string }>;
  totalMinor: string;
  currency: string;
  latestDeliveryAt: string;
  merchantCount: number;
  explanation: string;
};

export type OffersResponse = ReadModelMeta & {
  offers: OfferView[];
  plans: PlanAlternative[];
  infeasibleReason: string | null;
  solverVersion: string;
};

// ---------- intent / mission / purchase ----------

export type IntentView = {
  id: string;
  rawText: string;
  spec: IntentSpec;
  confirmedAt: string;
  compilerVersion: string;
};

export type MissionSummary = {
  id: string;
  title: string;
  state: MissionState;
  budgetMinor: string;
  currency: string;
  deadline: string;
  timezone: string;
  isDemo: boolean;
  createdAt: string;
};

export type MissionDetail = ReadModelMeta & MissionSummary & { intent: IntentView };

export type PurchaseSummary = {
  id: string;
  title: string;
  state: PurchaseState;
  amountMinor: string | null;
  currency: string;
  twinId: string;
  twinHealth: TwinHealth;
  deadline: string;
  isDemo: boolean;
  createdAt: string;
};

export type CommitmentView = {
  id: string;
  version: number;
  merchantName: string;
  acceptedByName: string;
  acceptedAt: string;
  termsHash: string;
  terms: {
    sku: string;
    title: string;
    material: string[];
    quantity: number;
    totalMinor: string;
    currency: string;
    deliverBy: string;
    deliveryTimezone: string;
    refundPolicy: string;
    cancellationPolicy: string;
  };
  provenance: Provenance;
};

export type PaymentView = {
  status: 'NOT_STARTED' | 'ORDER_CREATED' | 'APPROVED' | 'CAPTURED' | 'REFUNDED' | 'UNKNOWN';
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
  amountMinor: string | null;
  currency: string;
  environment: 'sandbox' | 'live' | null;
  lastVerifiedAt: string | null;
  note: string;
};

export type PurchaseDetail = ReadModelMeta &
  PurchaseSummary & {
    intent: IntentView;
    commitment: CommitmentView | null;
    payment: PaymentView;
  };

// ---------- PromiseTwin ----------

export type EvidenceView = {
  id: string;
  kind: EvidenceKind;
  assertion: EvidenceAssertion;
  summary: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  isSimulated: boolean;
  provenance: Provenance;
};

export type ConstraintStatus =
  'SATISFIED' | 'AT_RISK' | 'VIOLATED' | 'PENDING' | 'NOT_COMMITTED' | 'UNKNOWN';

export type ConstraintResult = {
  constraintId:
    'material' | 'prohibited' | 'quantity' | 'budget' | 'deadline' | 'payment' | 'receipt';
  label: string;
  requested: string;
  committed: string | null;
  observed: string | null;
  status: ConstraintStatus;
  sellerCommitted: boolean;
  evidenceIds: string[];
  explanation: string;
};

export type CauseHypothesis = {
  classification: CauseClassification;
  confidence: number;
  evidenceIds: string[];
  unknowns: string[];
  recommendedNextAction: string;
  paymentSideEffect: 'NONE';
};

export type TwinEvaluationView = {
  id: string;
  version: number;
  health: TwinHealth;
  constraints: ConstraintResult[];
  causes: CauseHypothesis[];
  evidenceGaps: string[];
  facts: Array<{ evidenceId: string; statement: string; source: ProvenanceSource }>;
  predictions: string[];
  interpretation: string;
  evaluator: { kind: 'DETERMINISTIC'; version: string; policyVersion: string };
  evaluatedAt: string;
  clock: { now: string; simulated: boolean };
};

export type ContrastView = ReadModelMeta & {
  twinId: string;
  evaluationVersion: number;
  contractVersion: number | null;
  outcome: 'ON_TRACK' | 'AT_RISK' | 'BREACHED' | 'FULFILLED' | 'UNCERTAIN';
  unmetConstraintIds: string[];
  evidenceIds: string[];
  interpretation: string;
  knownAt: string;
  constraints: ConstraintResult[];
};

export type ThreadNodeKind =
  | 'INTENT'
  | 'COMMITMENT'
  | 'PAYPAL_ORDER'
  | 'CAPTURE'
  | 'REFUND'
  | 'SHIPMENT'
  | 'RECEIPT_ACK'
  | 'ASSESSMENT';

export type ThreadNode = {
  id: string;
  twinId: string;
  kind: ThreadNodeKind;
  label: string;
  detail: string;
  eventSequence: number;
  provenance: Provenance | null;
  status: 'PLANNED' | 'PENDING' | 'CONFIRMED' | 'FAILED' | 'UNKNOWN';
  track: 'INTENT' | 'MERCHANT' | 'PAYPAL' | 'DELIVERY';
};

export type ThreadEdge = {
  from: string;
  to: string;
  relation: 'COMMITS_TO' | 'PAYS_FOR' | 'FULFILS' | 'CONTRADICTS' | 'EVALUATES' | 'AWAITS';
};

export type ThreadsView = ReadModelMeta & {
  twinId: string;
  nodes: ThreadNode[];
  edges: ThreadEdge[];
};

export type SnapshotSummary = {
  id: string;
  eventSeq: number;
  aggregateVersion: number;
  health: TwinHealth;
  label: string;
  knownAt: string;
  recordedAt: string;
  snapshotHash: string;
  isSimulated: boolean;
};

export type SnapshotDetail = SnapshotSummary & {
  state: {
    health: TwinHealth;
    commitmentVersion: number | null;
    evidenceIds: string[];
    evaluationVersion: number | null;
    constraints: ConstraintResult[];
    interpretation: string;
  };
  evidence: EvidenceView[];
};

export type SnapshotsPage = ReadModelMeta & {
  items: SnapshotSummary[];
  nextCursor: string | null;
};

export type HealthBreakdownView = ReadModelMeta & {
  twinId: string;
  health: TwinHealth;
  layers: Array<{
    layer: 'INTENT' | 'COMMITMENT' | 'PAYMENT' | 'FULFILLMENT';
    present: boolean;
    verification: VerificationLevel | 'ABSENT';
    note: string;
  }>;
  rules: string[];
};

export type TwinDetail = ReadModelMeta & {
  id: string;
  purchaseId: string;
  title: string;
  health: TwinHealth;
  isDemo: boolean;
  scenarioKey: string | null;
  intent: IntentView;
  commitment: CommitmentView | null;
  payment: PaymentView;
  evidence: EvidenceView[];
  latestEvaluation: TwinEvaluationView | null;
  firstPageThreads: Pick<ThreadsView, 'nodes' | 'edges'>;
};

export type TwinSummary = {
  id: string;
  purchaseId: string;
  title: string;
  health: TwinHealth;
  deadline: string;
  isDemo: boolean;
  lastEvaluatedAt: string | null;
};

// ---------- integrations / demo / events ----------

export type PayPalHealth = {
  environment: 'sandbox' | 'live';
  restApi: { status: 'OK' | 'NOT_CONFIGURED' | 'ERROR'; checkedAt: string; detail: string };
  mcp: {
    status: 'NOT_CONFIGURED' | 'DISABLED' | 'IDLE' | 'OK' | 'ERROR';
    detail: string;
    tools: string[];
  };
  webhooks: { status: 'NOT_CONFIGURED' | 'CONFIGURED'; detail: string };
  liveWritesEnabled: boolean;
};

export type DemoScenarioView = {
  key: string;
  title: string;
  description: string;
  simulatedNow: string;
  timezone: string;
  twinId: string | null;
  missionId: string | null;
  checkpoints: Array<{ key: string; label: string; at: string }>;
};

export type StreamEvent = {
  seq: number;
  type: string;
  aggregateType: string;
  aggregateId: string;
  version: number;
  occurredAt: string;
  simulated: boolean;
};

export type DashboardView = ReadModelMeta & {
  purchases: PurchaseSummary[];
  missions: MissionSummary[];
  twins: TwinSummary[];
  counts: {
    activeMissions: number;
    twinsAtRisk: number;
    twinsBreached: number;
    awaitingPayment: number;
  };
  recentActivity: Array<{
    id: string;
    label: string;
    occurredAt: string;
    aggregateType: string;
    aggregateId: string;
    simulated: boolean;
  }>;
};
