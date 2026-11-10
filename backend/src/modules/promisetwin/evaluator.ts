import {
  type CauseHypothesis,
  type ConstraintResult,
  type EvidenceAssertion,
  type EvidenceKind,
  type IntentSpec,
  type ProvenanceSource,
  type TwinHealth,
  type VerificationLevel,
  formatInZone,
  formatMoney,
} from '@promesa/contracts';

export const EVALUATOR_VERSION = 'promise-evaluator@1.0.0';
export const POLICY_VERSION = 'promise-policy@2026-11-01';

export type CommitmentFacts = {
  id: string;
  version: number;
  attributes: string[];
  quantity: number;
  totalMinor: bigint;
  currency: string;
  deliverBy: Date;
};

export type EvidenceFact = {
  id: string;
  kind: EvidenceKind;
  assertion: EvidenceAssertion;
  source: ProvenanceSource;
  verification: VerificationLevel;
  occurredAt: Date;
  observedAt: Date;
  payload: Record<string, unknown>;
};

export type PaymentFacts = {
  capturedMinor: bigint | null;
  captureStatus: string | null;
  paypalCaptureId: string | null;
};

export type EvaluationInput = {
  intent: IntentSpec;
  commitment: CommitmentFacts | null;
  evidence: EvidenceFact[];
  payment: PaymentFacts;
  now: Date;
  simulatedClock: boolean;
};

export type EvaluationResult = {
  health: TwinHealth;
  constraints: ConstraintResult[];
  causes: CauseHypothesis[];
  evidenceGaps: string[];
  facts: Array<{ evidenceId: string; statement: string; source: ProvenanceSource }>;
  predictions: string[];
  interpretation: string;
  evidenceIds: string[];
};

/** Confidence ceilings by the strongest source supporting a late-delivery claim. */
const LATE_CONFIDENCE: Partial<Record<EvidenceKind, number>> = {
  CARRIER_TRACKING: 0.93,
  MERCHANT_ASSERTION: 0.86,
  PAYPAL_TRACKING_METADATA: 0.8,
  SIMULATED_DEMO: 0.86,
};

function dateFromPayload(payload: Record<string, unknown>, key: string): Date | null {
  const raw = payload[key];
  if (typeof raw !== 'string') return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Deterministic PromiseTwin evaluation (backend spec §7).
 * - A buyer deadline is never treated as a seller promise.
 * - A PayPal capture proves payment only, never delivery.
 * - Missing evidence yields UNDETERMINED, not BREACHED.
 * - Only facts known at `now` are considered (Timefold correctness).
 */
export function evaluateTwin(input: EvaluationInput): EvaluationResult {
  const { intent, commitment, payment, now } = input;
  const tz = intent.timezone;
  const known = input.evidence
    .filter(
      (e) => e.observedAt.getTime() <= now.getTime() && e.occurredAt.getTime() <= now.getTime(),
    )
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  const constraints: ConstraintResult[] = [];
  const causes: CauseHypothesis[] = [];
  const gaps: string[] = [];
  const predictions: string[] = [];
  const commitEvidence = known.filter((e) => e.kind === 'SELLER_ACCEPTED_TERMS').map((e) => e.id);
  const intentEvidence = known.filter((e) => e.kind === 'BUYER_CONFIRMED_INTENT').map((e) => e.id);

  // --- material / attributes
  if (!commitment) {
    for (const [constraintId, label, requested] of [
      ['material', 'Required attributes', intent.requiredAttributes.join(', ') || '—'],
      ['prohibited', 'Prohibited attributes', intent.prohibitedAttributes.join(', ') || '—'],
      ['quantity', 'Quantity', `${intent.quantity} ${intent.unit}`],
      ['budget', 'Total spend', `≤ ${formatMoney(intent.budgetMinor, intent.currency)}`],
    ] as const) {
      constraints.push({
        constraintId,
        label,
        requested,
        committed: null,
        observed: null,
        status: 'NOT_COMMITTED',
        sellerCommitted: false,
        evidenceIds: intentEvidence,
        explanation: 'No seller has accepted terms yet, so nothing can be promised or broken.',
      });
    }
  } else {
    const missing = intent.requiredAttributes.filter((a) => !commitment.attributes.includes(a));
    constraints.push({
      constraintId: 'material',
      label: 'Required attributes',
      requested: intent.requiredAttributes.join(', ') || '—',
      committed: commitment.attributes.join(', '),
      observed: null,
      status: missing.length ? 'VIOLATED' : 'SATISFIED',
      sellerCommitted: true,
      evidenceIds: [...intentEvidence, ...commitEvidence],
      explanation: missing.length
        ? `Accepted terms omit required attribute(s): ${missing.join(', ')}. The selected offer never met the requirement.`
        : 'Seller-accepted terms include every required attribute.',
    });
    const forbidden = intent.prohibitedAttributes.filter((a) => commitment.attributes.includes(a));
    constraints.push({
      constraintId: 'prohibited',
      label: 'Prohibited attributes',
      requested: intent.prohibitedAttributes.length
        ? `not ${intent.prohibitedAttributes.join(', ')}`
        : '—',
      committed: commitment.attributes.join(', '),
      observed: null,
      status: forbidden.length ? 'VIOLATED' : 'SATISFIED',
      sellerCommitted: true,
      evidenceIds: [...intentEvidence, ...commitEvidence],
      explanation: forbidden.length
        ? `Accepted terms include prohibited attribute(s): ${forbidden.join(', ')}.`
        : 'Accepted terms contain no prohibited attributes.',
    });
    if (missing.length || forbidden.length) {
      causes.push({
        classification: 'AI_SELECTION_ERROR',
        confidence: 0.95,
        evidenceIds: [...intentEvidence, ...commitEvidence],
        unknowns: [],
        recommendedNextAction:
          'Review the offer selection. The seller delivered what it agreed to; ask the seller about an eligible exchange rather than claiming a breach.',
        paymentSideEffect: 'NONE',
      });
    }
    constraints.push({
      constraintId: 'quantity',
      label: 'Quantity',
      requested: `${intent.quantity} ${intent.unit}`,
      committed: `${commitment.quantity} ${intent.unit}`,
      observed: null,
      status: commitment.quantity >= intent.quantity ? 'SATISFIED' : 'VIOLATED',
      sellerCommitted: true,
      evidenceIds: commitEvidence,
      explanation:
        commitment.quantity >= intent.quantity
          ? 'Accepted quantity covers the requirement.'
          : 'Accepted quantity is below the requirement.',
    });
    const overBudget = commitment.totalMinor > BigInt(intent.budgetMinor);
    const captureMismatch =
      payment.capturedMinor !== null && payment.capturedMinor !== commitment.totalMinor;
    constraints.push({
      constraintId: 'budget',
      label: 'Total spend',
      requested: `≤ ${formatMoney(intent.budgetMinor, intent.currency)}`,
      committed: formatMoney(commitment.totalMinor, commitment.currency),
      observed:
        payment.capturedMinor !== null
          ? formatMoney(payment.capturedMinor, commitment.currency)
          : null,
      status: overBudget || captureMismatch ? 'VIOLATED' : 'SATISFIED',
      sellerCommitted: true,
      evidenceIds: commitEvidence,
      explanation: captureMismatch
        ? 'Captured amount differs from the accepted total.'
        : overBudget
          ? 'Accepted total exceeds the budget.'
          : 'Accepted total is within budget.',
    });
    if (captureMismatch) {
      causes.push({
        classification: 'PAYMENT_ISSUE',
        confidence: 0.9,
        evidenceIds: commitEvidence,
        unknowns: ['Whether a partial capture or adjustment was agreed'],
        recommendedNextAction:
          'Reconcile the PayPal capture against the accepted quote before any further action.',
        paymentSideEffect: 'NONE',
      });
    }
  }

  // --- deadline (the most important distinction: requested vs committed vs observed)
  const deadline = new Date(intent.deadlineISO);
  const delivered = known.find(
    (e) => e.assertion === 'DELIVERED' || e.assertion === 'RECEIPT_ACKNOWLEDGED',
  );
  const etaFacts = known.filter((e) => e.assertion === 'ETA_REVISED' || e.assertion === 'SHIPPED');
  const latestEta = etaFacts.at(-1);
  const latestEtaAt = latestEta ? dateFromPayload(latestEta.payload, 'estimatedDeliveryAt') : null;

  if (!commitment) {
    constraints.push({
      constraintId: 'deadline',
      label: 'Arrival deadline',
      requested: formatInZone(deadline, tz),
      committed: null,
      observed: null,
      status: 'NOT_COMMITTED',
      sellerCommitted: false,
      evidenceIds: intentEvidence,
      explanation: 'This is the buyer’s requirement only. No merchant has agreed to it.',
    });
  } else if (commitment.deliverBy.getTime() > deadline.getTime()) {
    constraints.push({
      constraintId: 'deadline',
      label: 'Arrival deadline',
      requested: formatInZone(deadline, tz),
      committed: formatInZone(commitment.deliverBy, tz),
      observed: null,
      status: 'VIOLATED',
      sellerCommitted: false,
      evidenceIds: [...intentEvidence, ...commitEvidence],
      explanation:
        'The seller only committed to a date after the buyer’s deadline. This is a selection mismatch, not a seller breach.',
    });
    causes.push({
      classification: 'AI_SELECTION_ERROR',
      confidence: 0.9,
      evidenceIds: [...intentEvidence, ...commitEvidence],
      unknowns: [],
      recommendedNextAction: 'Find an offer whose accepted delivery date meets the deadline.',
      paymentSideEffect: 'NONE',
    });
  } else {
    const committedLabel = formatInZone(commitment.deliverBy, tz);
    const pastCommitment = now.getTime() > commitment.deliverBy.getTime();
    if (delivered) {
      const onTime = delivered.occurredAt.getTime() <= commitment.deliverBy.getTime();
      constraints.push({
        constraintId: 'deadline',
        label: 'Arrival deadline',
        requested: formatInZone(deadline, tz),
        committed: committedLabel,
        observed: `Delivered ${formatInZone(delivered.occurredAt, tz)}`,
        status: onTime ? 'SATISFIED' : 'VIOLATED',
        sellerCommitted: true,
        evidenceIds: [...commitEvidence, delivered.id],
        explanation: onTime
          ? 'Delivered within the accepted commitment.'
          : 'Delivered after the accepted commitment.',
      });
      if (!onTime) {
        causes.push(lateCause(delivered, commitEvidence));
      }
    } else if (pastCommitment) {
      const lateSignal =
        latestEta && latestEtaAt && latestEtaAt.getTime() > commitment.deliverBy.getTime();
      if (lateSignal) {
        constraints.push({
          constraintId: 'deadline',
          label: 'Arrival deadline',
          requested: formatInZone(deadline, tz),
          committed: committedLabel,
          observed: `Not delivered. Latest estimate ${formatInZone(latestEtaAt!, tz)}`,
          status: 'VIOLATED',
          sellerCommitted: true,
          evidenceIds: [...commitEvidence, latestEta.id],
          explanation: `The accepted delivery time has passed with no delivery evidence, and the latest ${sourceLabel(latestEta)} places arrival after the commitment.`,
        });
        causes.push(lateCause(latestEta, commitEvidence));
      } else {
        constraints.push({
          constraintId: 'deadline',
          label: 'Arrival deadline',
          requested: formatInZone(deadline, tz),
          committed: committedLabel,
          observed: 'No delivery or shipment evidence',
          status: 'UNKNOWN',
          sellerCommitted: true,
          evidenceIds: commitEvidence,
          explanation:
            'The commitment time has passed but there is no shipment or delivery evidence either way. Breach is not assumed.',
        });
        causes.push({
          classification: 'UNCERTAIN_CAUSE',
          confidence: 0.4,
          evidenceIds: commitEvidence,
          unknowns: ['Whether the order shipped', 'Carrier status', 'Recipient receipt'],
          recommendedNextAction:
            'Ask the merchant for shipment evidence and the buyer to confirm whether anything arrived.',
          paymentSideEffect: 'NONE',
        });
      }
    } else if (latestEta && latestEtaAt && latestEtaAt.getTime() > commitment.deliverBy.getTime()) {
      constraints.push({
        constraintId: 'deadline',
        label: 'Arrival deadline',
        requested: formatInZone(deadline, tz),
        committed: committedLabel,
        observed: `Revised estimate ${formatInZone(latestEtaAt, tz)}`,
        status: 'AT_RISK',
        sellerCommitted: true,
        evidenceIds: [...commitEvidence, latestEta.id],
        explanation: `The ${sourceLabel(latestEta)} now places arrival after the accepted commitment. The commitment time has not passed yet.`,
      });
      const hoursLate = Math.round(
        (latestEtaAt.getTime() - commitment.deliverBy.getTime()) / 3600_000,
      );
      predictions.push(
        `If the revised estimate holds, delivery will be about ${hoursLate} hours after the committed time.`,
      );
      causes.push({
        classification: 'MERCHANT_COMMITMENT_RISK',
        confidence: 0.7,
        evidenceIds: [...commitEvidence, latestEta.id],
        unknowns: ['Whether the merchant can expedite', 'Independent carrier status'],
        recommendedNextAction:
          'Ask the merchant whether the committed time can still be met, and line up a compliant alternative before the deadline.',
        paymentSideEffect: 'NONE',
      });
    } else {
      constraints.push({
        constraintId: 'deadline',
        label: 'Arrival deadline',
        requested: formatInZone(deadline, tz),
        committed: committedLabel,
        observed: latestEtaAt ? `Estimate ${formatInZone(latestEtaAt, tz)}` : null,
        status: 'PENDING',
        sellerCommitted: true,
        evidenceIds: latestEta ? [...commitEvidence, latestEta.id] : commitEvidence,
        explanation: 'Commitment is in the future and no evidence contradicts it.',
      });
    }
  }

  // --- payment: proves payment state only
  const captured = payment.captureStatus === 'COMPLETED';
  constraints.push({
    constraintId: 'payment',
    label: 'PayPal payment',
    requested: commitment
      ? formatMoney(commitment.totalMinor, commitment.currency)
      : 'After seller acceptance',
    committed: null,
    observed: captured
      ? `Captured ${payment.paypalCaptureId}`
      : (payment.captureStatus ?? 'No PayPal payment yet'),
    status: captured ? 'SATISFIED' : 'PENDING',
    sellerCommitted: false,
    evidenceIds: known.filter((e) => e.kind === 'PAYPAL_API_VERIFIED').map((e) => e.id),
    explanation: captured
      ? 'PayPal reports the capture as COMPLETED. This proves payment, not delivery.'
      : 'No verified PayPal capture exists for this purchase.',
  });
  if (!captured) gaps.push('No verified PayPal capture');

  // --- receipt acknowledgment
  const ack = known.find((e) => e.assertion === 'RECEIPT_ACKNOWLEDGED');
  constraints.push({
    constraintId: 'receipt',
    label: 'Recipient confirmation',
    requested: `${intent.quantity} ${intent.unit} received`,
    committed: null,
    observed: ack ? `Acknowledged ${formatInZone(ack.occurredAt, tz)}` : null,
    status: ack ? 'SATISFIED' : 'PENDING',
    sellerCommitted: false,
    evidenceIds: ack ? [ack.id] : [],
    explanation: ack
      ? 'Recipient attested receipt.'
      : 'Fulfilment requires the recipient to confirm arrival.',
  });
  if (!ack) gaps.push('No recipient acknowledgment');
  if (!known.some((e) => e.kind === 'CARRIER_TRACKING')) gaps.push('No carrier-verified tracking');
  if (!commitment) gaps.push('No seller-accepted terms');

  // --- health
  const sellerViolations = constraints.filter(
    (c) => c.status === 'VIOLATED' && c.sellerCommitted && c.constraintId === 'deadline',
  );
  const selectionViolations = constraints.filter(
    (c) => c.status === 'VIOLATED' && (c.constraintId !== 'deadline' || !c.sellerCommitted),
  );
  let health: TwinHealth;
  if (sellerViolations.length > 0) health = 'BREACHED';
  else if (selectionViolations.length > 0) health = 'AT_RISK';
  else if (ack && constraints.find((c) => c.constraintId === 'deadline')?.status === 'SATISFIED')
    health = 'FULFILLED';
  else if (constraints.some((c) => c.status === 'AT_RISK')) health = 'AT_RISK';
  else if (!commitment || constraints.some((c) => c.status === 'UNKNOWN')) health = 'UNDETERMINED';
  else health = 'ON_TRACK';

  const facts = known.map((e) => ({
    evidenceId: e.id,
    statement: describe(e, tz),
    source: e.source,
  }));

  return {
    health,
    constraints,
    causes,
    evidenceGaps: gaps,
    facts,
    predictions,
    interpretation: interpret(health, constraints, causes),
    evidenceIds: known.map((e) => e.id),
  };
}

function lateCause(evidence: EvidenceFact, commitEvidence: string[]): CauseHypothesis {
  return {
    classification: 'MERCHANT_COMMITMENT_BREACH',
    confidence: LATE_CONFIDENCE[evidence.kind] ?? 0.6,
    evidenceIds: [...commitEvidence, evidence.id],
    unknowns:
      evidence.kind === 'CARRIER_TRACKING'
        ? ['Whether the delay originated with the merchant or the carrier']
        : ['Carrier-verified delivery time', 'Whether a carrier delay caused the miss'],
    recommendedNextAction:
      'Ask the merchant to confirm eligible refund or expedited replacement terms. Any refund needs the merchant’s authorization; a replacement needs a new buyer-approved checkout.',
    paymentSideEffect: 'NONE',
  };
}

function sourceLabel(e: EvidenceFact): string {
  const base =
    e.kind === 'CARRIER_TRACKING'
      ? 'carrier tracking'
      : e.kind === 'PAYPAL_TRACKING_METADATA'
        ? 'merchant tracking metadata'
        : 'merchant-reported estimate';
  return e.verification === 'SIMULATED' ? `${base} (simulated)` : base;
}

function describe(e: EvidenceFact, tz: string): string {
  const when = formatInZone(e.occurredAt, tz);
  const eta = dateFromPayload(e.payload, 'estimatedDeliveryAt');
  switch (e.assertion) {
    case 'INTENT_CONFIRMED':
      return `Buyer confirmed the intent (${when}).`;
    case 'TERMS_ACCEPTED':
      return `Seller accepted versioned terms (${when}).`;
    case 'ETA_REVISED':
      return `Merchant revised the estimated delivery to ${eta ? formatInZone(eta, tz) : 'an unknown time'} (${when}).`;
    case 'SHIPPED':
      return `Shipment reported (${when}).`;
    case 'DELIVERED':
      return `Delivery reported (${when}).`;
    case 'RECEIPT_ACKNOWLEDGED':
      return `Recipient acknowledged receipt (${when}).`;
    case 'PAYMENT_CAPTURED':
      return `PayPal capture verified (${when}).`;
    case 'PAYMENT_REFUNDED':
      return `PayPal refund verified (${when}).`;
    case 'STOCK_UNAVAILABLE':
      return `Merchant reported a stockout (${when}).`;
  }
}

function interpret(
  health: TwinHealth,
  constraints: ConstraintResult[],
  causes: CauseHypothesis[],
): string {
  const deadline = constraints.find((c) => c.constraintId === 'deadline');
  switch (health) {
    case 'BREACHED':
      return `The seller-accepted delivery commitment (${deadline?.committed}) was missed: ${deadline?.observed}. Classification is a hypothesis with ${Math.round((causes[0]?.confidence ?? 0) * 100)}% confidence, not established fault.`;
    case 'AT_RISK':
      return deadline?.status === 'AT_RISK'
        ? `Promise at risk: ${deadline.observed}, after the accepted commitment of ${deadline.committed}. Nothing is broken yet.`
        : 'The accepted terms do not satisfy every buyer requirement. This is a selection issue, not a seller breach.';
    case 'FULFILLED':
      return 'Every hard constraint is satisfied and the recipient confirmed arrival.';
    case 'ON_TRACK':
      return 'Seller-accepted terms satisfy the intent and no evidence contradicts the commitment.';
    case 'UNDETERMINED':
      return constraints.some((c) => c.status === 'NOT_COMMITTED')
        ? 'No seller has accepted terms yet. The deadline and budget are buyer requirements, not promises.'
        : 'Evidence is insufficient to judge the commitment. No breach is assumed.';
    default:
      return 'State is managed by an active recovery process.';
  }
}
