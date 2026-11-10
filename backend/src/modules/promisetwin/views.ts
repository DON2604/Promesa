import {
  type CauseHypothesis,
  type CommitmentView,
  type ConstraintResult,
  type EvidenceAssertion,
  type EvidenceKind,
  type EvidenceView,
  type IntentSpec,
  type IntentView,
  type PaymentView,
  type Provenance,
  type ProvenanceSource,
  type ThreadEdge,
  type ThreadNode,
  type TwinEvaluationView,
  type TwinHealth,
  type VerificationLevel,
  formatInZone,
  formatMoney,
} from '@promesa/contracts';
import type {
  CheckoutAttempt,
  Evidence,
  Intent,
  PayPalCapture,
  SellerCommitment,
  TwinEvaluation,
} from '@prisma/client';
import { EVALUATOR_VERSION, POLICY_VERSION } from './evaluator';
import type { AcceptedTerms } from './twin-engine';

export function toIntentView(intent: Intent): IntentView {
  return {
    id: intent.id,
    rawText: intent.rawText,
    spec: intent.confirmedSnapshotJson as unknown as IntentSpec,
    confirmedAt: intent.confirmedAt.toISOString(),
    compilerVersion: intent.compilerVersion,
  };
}

export function evidenceProvenance(e: Evidence): Provenance {
  return {
    source: e.source as ProvenanceSource,
    sourceId: e.sourceEventId,
    observedAt: e.observedAt.toISOString(),
    ingestedAt: e.ingestedAt.toISOString(),
    verification: e.verificationLevel as VerificationLevel,
  };
}

export function toEvidenceView(e: Evidence): EvidenceView {
  return {
    id: e.id,
    kind: e.kind as EvidenceKind,
    assertion: e.assertionType as EvidenceAssertion,
    summary: e.summary,
    occurredAt: e.occurredAt.toISOString(),
    payload: e.payloadJson as Record<string, unknown>,
    isSimulated: e.isSimulated,
    provenance: evidenceProvenance(e),
  };
}

export function toCommitmentView(
  commitment: SellerCommitment | null,
  merchantName: string,
  acceptedByName: string,
  evidence: Evidence[],
): CommitmentView | null {
  if (!commitment || commitment.revokedAt) return null;
  const terms = commitment.acceptedTermsJson as unknown as AcceptedTerms;
  const acceptance = evidence.find((e) => e.kind === 'SELLER_ACCEPTED_TERMS');
  return {
    id: commitment.id,
    version: commitment.version,
    merchantName,
    acceptedByName,
    acceptedAt: commitment.acceptedAt.toISOString(),
    termsHash: commitment.termsHash,
    terms,
    provenance: acceptance
      ? evidenceProvenance(acceptance)
      : {
          source: 'MERCHANT',
          sourceId: commitment.id,
          observedAt: commitment.acceptedAt.toISOString(),
          ingestedAt: commitment.createdAt.toISOString(),
          verification: commitment.isSimulated ? 'SIMULATED' : 'ATTESTED',
        },
  };
}

export function toPaymentView(
  captures: PayPalCapture[],
  attempts: CheckoutAttempt[],
  currency: string,
  configured: boolean,
): PaymentView {
  const capture = captures.at(-1);
  if (capture) {
    return {
      status: capture.paypalStatus === 'COMPLETED' ? 'CAPTURED' : 'UNKNOWN',
      paypalOrderId: capture.paypalOrderId,
      paypalCaptureId: capture.paypalCaptureId,
      amountMinor: capture.amountMinor.toString(),
      currency: capture.currency,
      environment: capture.environment,
      lastVerifiedAt: capture.lastVerifiedAt.toISOString(),
      note: 'Verified against the PayPal API. Proves payment state only, not delivery.',
    };
  }
  const attempt = attempts.at(-1);
  if (attempt?.paypalOrderId) {
    return {
      status: attempt.approvalStatus === 'APPROVED' ? 'APPROVED' : 'ORDER_CREATED',
      paypalOrderId: attempt.paypalOrderId,
      paypalCaptureId: null,
      amountMinor: null,
      currency,
      environment: 'sandbox',
      lastVerifiedAt: attempt.updatedAt.toISOString(),
      note: 'PayPal order exists; payment is not captured.',
    };
  }
  return {
    status: 'NOT_STARTED',
    paypalOrderId: null,
    paypalCaptureId: null,
    amountMinor: null,
    currency,
    environment: null,
    lastVerifiedAt: null,
    note: configured
      ? 'No PayPal order has been created for this purchase yet.'
      : 'No PayPal record exists. Sandbox checkout needs merchant credentials (Phase 2); nothing here is a simulated payment.',
  };
}

export function toEvaluationView(e: TwinEvaluation | null): TwinEvaluationView | null {
  if (!e) return null;
  const extra = e.resultJson as {
    evidenceGaps: string[];
    facts: TwinEvaluationView['facts'];
    predictions: string[];
  };
  return {
    id: e.id,
    version: e.version,
    health: e.health as TwinHealth,
    constraints: e.constraintResultsJson as unknown as ConstraintResult[],
    causes: e.causeHypothesesJson as unknown as CauseHypothesis[],
    evidenceGaps: extra.evidenceGaps,
    facts: extra.facts,
    predictions: extra.predictions,
    interpretation: e.rationale,
    evaluator: {
      kind: 'DETERMINISTIC',
      version: e.modelVersion || EVALUATOR_VERSION,
      policyVersion: e.policyVersion || POLICY_VERSION,
    },
    evaluatedAt: e.createdAt.toISOString(),
    clock: { now: e.clockNow.toISOString(), simulated: e.clockSimulated },
  };
}

/**
 * Promise Threads read model: source-attributed nodes linking intent → commitment → PayPal →
 * fulfillment → assessment. Planned nodes carry no provenance, so the UI never implies they happened.
 */
export function buildThreads(args: {
  twinId: string;
  intent: IntentSpec;
  commitment: CommitmentView | null;
  payment: PaymentView;
  evidence: Evidence[];
  evaluation: TwinEvaluationView | null;
}): { nodes: ThreadNode[]; edges: ThreadEdge[] } {
  const { twinId, intent, commitment, payment, evaluation } = args;
  const tz = intent.timezone;
  const evidence = [...args.evidence].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
  const nodes: ThreadNode[] = [];
  const edges: ThreadEdge[] = [];
  let seq = 0;

  const intentEv = evidence.find((e) => e.kind === 'BUYER_CONFIRMED_INTENT');
  nodes.push({
    id: 'intent',
    twinId,
    kind: 'INTENT',
    label: 'Intent confirmed',
    detail: `${intent.quantity} ${intent.unit} · ≤ ${formatMoney(intent.budgetMinor, intent.currency)} · by ${formatInZone(intent.deadlineISO, tz)}`,
    eventSequence: ++seq,
    provenance: intentEv ? evidenceProvenance(intentEv) : null,
    status: 'CONFIRMED',
    track: 'INTENT',
  });

  nodes.push({
    id: 'commitment',
    twinId,
    kind: 'COMMITMENT',
    label: commitment
      ? `Seller accepted terms v${commitment.version}`
      : 'Awaiting seller acceptance',
    detail: commitment
      ? `${commitment.merchantName} · ${commitment.terms.quantity} × ${commitment.terms.sku} · ${formatMoney(commitment.terms.totalMinor, commitment.terms.currency)} · deliver by ${formatInZone(commitment.terms.deliverBy, tz)}`
      : 'The buyer deadline is not a merchant promise until a seller explicitly accepts it.',
    eventSequence: ++seq,
    provenance: commitment?.provenance ?? null,
    status: commitment ? 'CONFIRMED' : 'PLANNED',
    track: 'MERCHANT',
  });
  edges.push({ from: 'intent', to: 'commitment', relation: commitment ? 'COMMITS_TO' : 'AWAITS' });

  const hasOrder = Boolean(payment.paypalOrderId);
  nodes.push({
    id: 'paypal-order',
    twinId,
    kind: 'PAYPAL_ORDER',
    label: hasOrder ? `PayPal order ${payment.paypalOrderId}` : 'PayPal order not created',
    detail: payment.note,
    eventSequence: ++seq,
    provenance: hasOrder
      ? {
          source: 'PAYPAL_API',
          sourceId: payment.paypalOrderId!,
          observedAt: payment.lastVerifiedAt!,
          ingestedAt: payment.lastVerifiedAt!,
          verification: 'VERIFIED',
        }
      : null,
    status: hasOrder ? 'CONFIRMED' : 'PLANNED',
    track: 'PAYPAL',
  });
  edges.push({
    from: 'commitment',
    to: 'paypal-order',
    relation: hasOrder ? 'PAYS_FOR' : 'AWAITS',
  });

  const captured = payment.status === 'CAPTURED';
  nodes.push({
    id: 'capture',
    twinId,
    kind: 'CAPTURE',
    label: captured ? `Captured ${payment.paypalCaptureId}` : 'Payment not captured',
    detail: captured ? 'PayPal COMPLETED — proves payment only.' : 'No verified capture.',
    eventSequence: ++seq,
    provenance: captured
      ? {
          source: 'PAYPAL_API',
          sourceId: payment.paypalCaptureId!,
          observedAt: payment.lastVerifiedAt!,
          ingestedAt: payment.lastVerifiedAt!,
          verification: 'VERIFIED',
        }
      : null,
    status: captured ? 'CONFIRMED' : 'PLANNED',
    track: 'PAYPAL',
  });
  edges.push({ from: 'paypal-order', to: 'capture', relation: captured ? 'PAYS_FOR' : 'AWAITS' });

  const deliverBy = commitment ? new Date(commitment.terms.deliverBy).getTime() : null;
  let lastFulfilment = 'commitment';
  for (const e of evidence.filter((x) =>
    ['ETA_REVISED', 'SHIPPED', 'DELIVERED', 'STOCK_UNAVAILABLE'].includes(x.assertionType),
  )) {
    const payload = e.payloadJson as Record<string, unknown>;
    const eta =
      typeof payload.estimatedDeliveryAt === 'string'
        ? new Date(payload.estimatedDeliveryAt)
        : null;
    const contradicts =
      e.assertionType === 'STOCK_UNAVAILABLE' ||
      (deliverBy !== null && eta !== null && eta.getTime() > deliverBy) ||
      (deliverBy !== null && e.assertionType === 'DELIVERED' && e.occurredAt.getTime() > deliverBy);
    const nodeId = `ev-${e.id}`;
    nodes.push({
      id: nodeId,
      twinId,
      kind: 'SHIPMENT',
      label: e.summary,
      detail: eta ? `Estimate ${formatInZone(eta, tz)}` : formatInZone(e.occurredAt, tz),
      eventSequence: ++seq,
      provenance: evidenceProvenance(e),
      status: contradicts ? 'FAILED' : 'CONFIRMED',
      track: 'DELIVERY',
    });
    edges.push({
      from: 'commitment',
      to: nodeId,
      relation: contradicts ? 'CONTRADICTS' : 'FULFILS',
    });
    lastFulfilment = nodeId;
  }

  const ack = evidence.find((e) => e.assertionType === 'RECEIPT_ACKNOWLEDGED');
  nodes.push({
    id: 'receipt-ack',
    twinId,
    kind: 'RECEIPT_ACK',
    label: ack ? 'Recipient confirmed arrival' : 'Arrival not confirmed',
    detail: ack
      ? formatInZone(ack.occurredAt, tz)
      : 'Fulfilment needs the recipient’s acknowledgment.',
    eventSequence: ++seq,
    provenance: ack ? evidenceProvenance(ack) : null,
    status: ack ? 'CONFIRMED' : 'PLANNED',
    track: 'DELIVERY',
  });
  edges.push({ from: lastFulfilment, to: 'receipt-ack', relation: ack ? 'FULFILS' : 'AWAITS' });

  if (evaluation) {
    nodes.push({
      id: 'assessment',
      twinId,
      kind: 'ASSESSMENT',
      label: `Assessment v${evaluation.version}: ${evaluation.health.replace('_', ' ')}`,
      detail: evaluation.interpretation,
      eventSequence: ++seq,
      provenance: {
        source: 'POLICY_DERIVED',
        sourceId: evaluation.id,
        observedAt: evaluation.clock.now,
        ingestedAt: evaluation.evaluatedAt,
        verification: evaluation.clock.simulated ? 'SIMULATED' : 'VERIFIED',
      },
      status:
        evaluation.health === 'BREACHED'
          ? 'FAILED'
          : evaluation.health === 'UNDETERMINED'
            ? 'UNKNOWN'
            : 'CONFIRMED',
      track: 'INTENT',
    });
    edges.push({ from: lastFulfilment, to: 'assessment', relation: 'EVALUATES' });
  }

  return { nodes, edges };
}
