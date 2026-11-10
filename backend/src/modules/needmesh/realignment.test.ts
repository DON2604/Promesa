import type { IntentSpec } from '@promesa/contracts';
import { describe, expect, it } from 'vitest';
import { type CatalogItem } from '../commerce/offer-solver';
import { CATALOG } from '../demo/fixtures';
import { forecastShortages, matchSponsor } from './matching';
import { planMission } from './mission-planner';
import { type MissionPolicyContext, evaluateMissionPolicy } from './mission-policy';
import { applyAcceptedTerms, evaluateProposal } from './negotiation';
import { type ProtectedOrder, deriveProtection } from './protection';

const now = new Date('2026-11-09T14:00:00Z');
const catalog: CatalogItem[] = CATALOG.map((c) => ({
  ...c,
  currency: 'USD',
  source: 'DEMO_FIXTURE',
  isDemo: true,
  lastVerifiedAt: now,
  merchant: { tenantId: c.sellerTenantId, name: c.sku, paypalConnected: false },
}));
const sku = (s: string) => catalog.find((c) => c.sku === s)!;
const shelter: IntentSpec = {
  productKind: 'hygiene-kit',
  productLabel: 'hygiene kits',
  quantity: 30,
  unit: 'kits',
  requiredAttributes: ['fragrance-free'],
  prohibitedAttributes: ['fragranced'],
  budgetMinor: '17500',
  currency: 'USD',
  deadlineISO: '2026-11-13T18:00:00-05:00',
  timezone: 'America/New_York',
  hardConstraints: [],
  softPreferences: [],
  assumptions: [],
  unresolvedQuestions: [],
};

const offer = (s: string, unitPriceMinor: bigint, quantity = 30) =>
  evaluateProposal({
    intent: shelter,
    product: sku(s),
    terms: { quantity, unitPriceMinor, leadTimeHours: 40 },
    now,
    budgetRemainingMinor: 17_500n,
    unitsStillNeeded: 30,
  });

describe('Negotiation agent', () => {
  it('recommends accepting an offer at or below the target price', () => {
    const e = offer('KIT-FF-03', 520n);
    expect(e.compatible).toBe(true);
    expect(e.recommendation).toBe('ACCEPT');
    expect(e.targetUnitPriceMinor).toBe(550n);
  });

  it('counters a moderately high offer at the budget-safe target', () => {
    const e = offer('KIT-FF-03', 600n);
    expect(e.recommendation).toBe('COUNTER');
    expect(e.rationale).toMatch(/\$5\.50/);
  });

  it('declines an offer far above target and any offer breaking a hard constraint', () => {
    expect(offer('KIT-FF-03', 700n).recommendation).toBe('DECLINE');
    const scented = offer('KIT-SC-01', 100n);
    expect(scented.compatible).toBe(false);
    expect(scented.recommendation).toBe('DECLINE');
  });

  it('flags an offer for more units than the listing has in stock', () => {
    const e = offer('KIT-FF-03', 500n, 60);
    expect(e.compatible).toBe(false);
    expect(e.checks.some((c) => c.label === 'Stock' && !c.passed)).toBe(true);
  });

  it('applies only accepted terms, and the planner then prefers the negotiated price', () => {
    const { catalog: next, negotiated } = applyAcceptedTerms(catalog, [
      {
        catalogProductId: sku('KIT-FF-03').id,
        agreedUnitPriceMinor: 480n,
        quantity: 30,
        leadTimeHours: 40,
      },
    ]);
    expect(negotiated.get(sku('KIT-FF-03').id)?.listUnitPriceMinor).toBe(550n);
    const plan = planMission({
      intent: shelter,
      catalog: next,
      now,
      budgetAvailableMinor: 17_500n,
    });
    expect(plan.lines.map((l) => [l.product.sku, l.quantity])).toEqual([['KIT-FF-03', 30]]);
    expect(plan.totalMinor).toBe(30n * 480n);
  });
});

const base: ProtectedOrder = {
  state: 'AUTHORIZED',
  quantity: 20,
  estimatedDeliveryAt: new Date('2026-11-12T12:00:00Z'),
  stockConfirmedAt: null,
  stockoutAt: null,
  paypalAuthorizationId: 'AUTH-1',
  paypalCaptureId: null,
  paypalRefundId: null,
  trackingNumber: null,
  quantityReceived: null,
  refundApprovedAt: null,
};
const ctx = { deadline: new Date(shelter.deadlineISO), now, compatible: true };

describe('PromiseTwin protection per order', () => {
  it('keeps payment and delivery as separate tracks', () => {
    const p = deriveProtection({ ...base, state: 'CAPTURED', paypalCaptureId: 'CAP-1' }, ctx);
    expect(p.tracks.find((t) => t.track === 'PAYPAL')?.status).toBe('MET');
    expect(p.tracks.find((t) => t.track === 'DELIVERY')?.status).toBe('PENDING');
    expect(p.health).toBe('ON_TRACK');
  });

  it('proposes a void for an uncaptured stockout, and a refund once captured', () => {
    const stockout = deriveProtection({ ...base, stockoutAt: now }, ctx);
    expect(stockout.health).toBe('UNDER_RECOVERY');
    expect(stockout.remedies.join(' ')).toMatch(/Void/);
    const captured = deriveProtection(
      { ...base, state: 'CAPTURED', paypalCaptureId: 'CAP-1', stockoutAt: now },
      ctx,
    );
    expect(captured.remedies.join(' ')).toMatch(/refund/i);
  });

  it('reports a breach when fewer units arrive than were paid for', () => {
    const p = deriveProtection({ ...base, state: 'DELIVERED', quantityReceived: 18 }, ctx);
    expect(p.health).toBe('BREACHED');
    expect(p.gaps.join(' ')).toMatch(/2 units/);
  });

  it('marks a late estimate as at risk before anything ships', () => {
    const p = deriveProtection(
      { ...base, estimatedDeliveryAt: new Date('2026-11-20T00:00:00Z') },
      ctx,
    );
    expect(p.health).toBe('AT_RISK');
  });
});

describe('Sponsor matching and shortage forecast', () => {
  const mission = {
    category: 'hygiene',
    deadline: new Date('2026-11-13T23:00:00Z'),
    orgVerified: true,
    openOrderAmounts: [10_000n, 5_500n],
    unfundedMinor: 15_500n,
    currency: 'USD',
  };

  it('scores a verified, urgent mission in the sponsor’s category with an affordable order highly', () => {
    const m = matchSponsor({ categories: ['hygiene'], maxOrderMinor: 12_000n }, mission, now);
    expect(m.score).toBe(100);
    expect(m.reasons.join(' ')).toMatch(/hygiene/);
  });

  it('explains a mismatch instead of hiding the mission', () => {
    const m = matchSponsor({ categories: ['education'], maxOrderMinor: 1_000n }, mission, now);
    expect(m.score).toBeLessThan(40);
    expect(m.reasons.join(' ')).toMatch(/Outside your saved categories/);
  });

  it('projects the next need from the average interval of past missions', () => {
    const items = forecastShortages(
      [
        {
          missionId: 'a',
          productKind: 'hygiene-kit',
          productLabel: 'Hygiene kits',
          quantity: 28,
          neededBy: new Date('2026-10-16T22:00:00Z'),
        },
        {
          missionId: 'b',
          productKind: 'hygiene-kit',
          productLabel: 'Hygiene kits',
          quantity: 30,
          neededBy: new Date('2026-10-30T22:00:00Z'),
        },
        {
          missionId: 'c',
          productKind: 'hygiene-kit',
          productLabel: 'Hygiene kits',
          quantity: 30,
          neededBy: new Date('2026-11-13T23:00:00Z'),
        },
      ],
      now,
    );
    expect(items[0]?.averageIntervalDays).toBe(14);
    expect(items[0]?.predictedNextNeedBy?.slice(0, 10)).toBe('2026-11-27');
    expect(items[0]?.averageQuantity).toBe(29);
  });
});

describe('Cross-tenant sponsor funding policy', () => {
  const ctxFor = (missionPublic: boolean): MissionPolicyContext => ({
    missionOrgTenantId: 'org',
    missionPublic,
    missionState: 'AWAITING_SPONSOR',
    missionCurrency: 'USD',
    budgetMinor: 17_500n,
    committedOtherMinor: 0n,
    railMode: 'SIMULATED',
    liveWritesEnabled: false,
    listedMerchantTenantIds: new Set(['m']),
    order: {
      state: 'AWAITING_APPROVAL',
      amountMinor: 10_000n,
      currency: 'USD',
      quantity: 20,
      merchantTenantId: 'm',
      quoteHash: 'h',
      expectedQuoteHash: 'h',
      stockConfirmed: false,
      refundApproved: false,
      hasAuthorization: false,
      hasCapture: false,
    },
  });
  const approve = (missionPublic: boolean) =>
    evaluateMissionPolicy(
      { action: 'APPROVE_ORDER', actorRole: 'SPONSOR', actorTenantId: 'external-fund' },
      ctxFor(missionPublic),
    );

  it('denies an external sponsor on a private mission', () => {
    const d = approve(false);
    expect(d.decision).toBe('DENY');
    expect(d.reasons[0]?.code).toBe('CROSS_TENANT');
  });

  it('allows an external sponsor on a published mission, still inside every other rule', () => {
    expect(approve(true).decision).toBe('ALLOW');
  });
});
