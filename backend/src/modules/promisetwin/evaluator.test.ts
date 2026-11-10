import type { IntentSpec } from '@promesa/contracts';
import { describe, expect, it } from 'vitest';
import { type EvaluationInput, type EvidenceFact, evaluateTwin } from './evaluator';

const intent: IntentSpec = {
  productKind: 'packaging-box',
  productLabel: 'food-safe paper packaging boxes',
  quantity: 100,
  unit: 'boxes',
  requiredAttributes: ['paper', 'food-safe'],
  prohibitedAttributes: ['plastic'],
  budgetMinor: '10000',
  currency: 'USD',
  deadlineISO: '2026-11-13T17:00:00-05:00',
  timezone: 'America/New_York',
  hardConstraints: [],
  softPreferences: [],
  assumptions: [],
  unresolvedQuestions: [],
};

const commitment = {
  id: 'commit-1',
  version: 1,
  attributes: ['paper', 'kraft', 'food-safe'],
  quantity: 100,
  totalMinor: 8500n,
  currency: 'USD',
  deliverBy: new Date('2026-11-13T17:00:00-05:00'),
};

const ev = (
  over: Partial<EvidenceFact> & Pick<EvidenceFact, 'id' | 'assertion' | 'kind'>,
): EvidenceFact => ({
  source: 'MERCHANT',
  verification: 'SIMULATED',
  occurredAt: new Date('2026-11-09T10:05:00-05:00'),
  observedAt: new Date('2026-11-09T10:05:00-05:00'),
  payload: {},
  ...over,
});

const accepted = ev({
  id: 'ev-accept',
  kind: 'SELLER_ACCEPTED_TERMS',
  assertion: 'TERMS_ACCEPTED',
});
const mondayEta = ev({
  id: 'ev-eta',
  kind: 'MERCHANT_ASSERTION',
  assertion: 'ETA_REVISED',
  occurredAt: new Date('2026-11-11T14:30:00-05:00'),
  observedAt: new Date('2026-11-11T14:30:00-05:00'),
  payload: { estimatedDeliveryAt: '2026-11-16T12:00:00-05:00' },
});

const base = (over: Partial<EvaluationInput>): EvaluationInput => ({
  intent,
  commitment,
  evidence: [accepted],
  payment: { capturedMinor: null, captureStatus: null, paypalCaptureId: null },
  now: new Date('2026-11-10T09:00:00-05:00'),
  simulatedClock: true,
  ...over,
});

const deadline = (r: ReturnType<typeof evaluateTwin>) =>
  r.constraints.find((c) => c.constraintId === 'deadline')!;

describe('evaluateTwin', () => {
  it('is UNDETERMINED without a seller commitment, and never blames a seller', () => {
    const r = evaluateTwin(
      base({ commitment: null, evidence: [], now: new Date('2026-11-20T00:00:00Z') }),
    );
    expect(r.health).toBe('UNDETERMINED');
    expect(deadline(r).status).toBe('NOT_COMMITTED');
    expect(r.causes.some((c) => c.classification === 'MERCHANT_COMMITMENT_BREACH')).toBe(false);
  });

  it('is ON_TRACK when accepted terms satisfy the intent and nothing contradicts them', () => {
    expect(evaluateTwin(base({})).health).toBe('ON_TRACK');
  });

  it('marks a late ETA before the committed time as AT_RISK, not BREACHED', () => {
    const r = evaluateTwin(
      base({ evidence: [accepted, mondayEta], now: new Date('2026-11-11T15:00:00-05:00') }),
    );
    expect(r.health).toBe('AT_RISK');
    expect(deadline(r).status).toBe('AT_RISK');
    expect(r.causes[0]?.classification).toBe('MERCHANT_COMMITMENT_RISK');
    expect(r.predictions[0]).toMatch(/hours after/);
  });

  it('marks BREACHED after the committed time with contradicting merchant evidence', () => {
    const r = evaluateTwin(
      base({ evidence: [accepted, mondayEta], now: new Date('2026-11-14T09:00:00-05:00') }),
    );
    expect(r.health).toBe('BREACHED');
    expect(r.causes[0]).toMatchObject({
      classification: 'MERCHANT_COMMITMENT_BREACH',
      paymentSideEffect: 'NONE',
    });
    expect(r.causes[0]!.confidence).toBeLessThan(1);
    expect(r.causes[0]!.unknowns.length).toBeGreaterThan(0);
  });

  it('yields UNDETERMINED (not BREACHED) after the deadline when there is no evidence either way', () => {
    const r = evaluateTwin(base({ now: new Date('2026-11-14T09:00:00-05:00') }));
    expect(r.health).toBe('UNDETERMINED');
    expect(deadline(r).status).toBe('UNKNOWN');
  });

  it('ignores evidence the platform did not know yet (Timefold correctness)', () => {
    const r = evaluateTwin(
      base({ evidence: [accepted, mondayEta], now: new Date('2026-11-10T09:00:00-05:00') }),
    );
    expect(r.health).toBe('ON_TRACK');
    expect(r.evidenceIds).not.toContain('ev-eta');
  });

  it('classifies a forbidden material as AI_SELECTION_ERROR, not a seller breach', () => {
    const r = evaluateTwin(
      base({ commitment: { ...commitment, attributes: ['plastic', 'food-safe'] } }),
    );
    expect(r.health).toBe('AT_RISK');
    expect(r.causes.map((c) => c.classification)).toContain('AI_SELECTION_ERROR');
    expect(r.causes.map((c) => c.classification)).not.toContain('MERCHANT_COMMITMENT_BREACH');
  });

  it('never treats a buyer-only deadline as a seller promise', () => {
    const later = { ...commitment, deliverBy: new Date('2026-11-16T17:00:00-05:00') };
    const r = evaluateTwin(base({ commitment: later, now: new Date('2026-11-17T00:00:00Z') }));
    expect(deadline(r).sellerCommitted).toBe(false);
    expect(r.health).not.toBe('BREACHED');
    expect(r.causes[0]?.classification).toBe('AI_SELECTION_ERROR');
  });

  it('a PayPal capture proves payment, never delivery', () => {
    const r = evaluateTwin(
      base({
        payment: { capturedMinor: 8500n, captureStatus: 'COMPLETED', paypalCaptureId: 'CAP-1' },
        now: new Date('2026-11-14T09:00:00-05:00'),
      }),
    );
    expect(r.constraints.find((c) => c.constraintId === 'payment')!.status).toBe('SATISFIED');
    expect(r.constraints.find((c) => c.constraintId === 'receipt')!.status).toBe('PENDING');
    expect(r.health).not.toBe('FULFILLED');
  });

  it('FULFILLED requires on-time delivery and recipient acknowledgment', () => {
    const ack = ev({
      id: 'ev-ack',
      kind: 'RECIPIENT_ATTESTED',
      assertion: 'RECEIPT_ACKNOWLEDGED',
      source: 'RECIPIENT',
      verification: 'ATTESTED',
      occurredAt: new Date('2026-11-13T11:00:00-05:00'),
      observedAt: new Date('2026-11-13T11:05:00-05:00'),
    });
    const r = evaluateTwin(
      base({ evidence: [accepted, ack], now: new Date('2026-11-13T12:00:00-05:00') }),
    );
    expect(r.health).toBe('FULFILLED');
  });

  it('flags a capture that differs from the accepted total', () => {
    const r = evaluateTwin(
      base({
        payment: { capturedMinor: 9900n, captureStatus: 'COMPLETED', paypalCaptureId: 'CAP-2' },
      }),
    );
    expect(r.causes.map((c) => c.classification)).toContain('PAYMENT_ISSUE');
  });
});
