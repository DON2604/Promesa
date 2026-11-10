import type { IntentSpec, MissionOrderState } from '@promesa/contracts';
import { describe, expect, it } from 'vitest';
import { type CatalogItem } from '../commerce/offer-solver';
import { CATALOG, IDS } from '../demo/fixtures';
import { figuresAreGrounded } from './narration-guard';
import { planMission } from './mission-planner';
import { type MissionPolicyContext, evaluateMissionPolicy } from './mission-policy';
import {
  computeQuoteHash,
  coverage,
  decideRemedy,
  deriveMissionState,
  nextStepFor,
} from './mission-state';

const now = new Date('2026-11-09T14:00:00Z');

const catalog: CatalogItem[] = CATALOG.map((c) => ({
  ...c,
  currency: 'USD',
  source: 'DEMO_FIXTURE',
  isDemo: true,
  lastVerifiedAt: now,
  merchant: { tenantId: c.sellerTenantId, name: c.sku, paypalConnected: false },
}));

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

const sku = (s: string) => catalog.find((c) => c.sku === s)!;

describe('planMission', () => {
  it('fills the cheapest eligible units first and splits across merchants', () => {
    const plan = planMission({ intent: shelter, catalog, now, budgetAvailableMinor: 17_500n });
    expect(plan.unmetQuantity).toBe(0);
    expect(plan.lines.map((l) => [l.product.sku, l.quantity])).toEqual([
      ['KIT-FF-01', 20],
      ['KIT-FF-03', 10],
    ]);
    expect(plan.totalMinor).toBe(20n * 500n + 10n * 550n);
  });

  it('never uses a fragranced kit even though it is the cheapest', () => {
    const plan = planMission({ intent: shelter, catalog, now, budgetAvailableMinor: 17_500n });
    expect(plan.lines.some((l) => l.product.sku === 'KIT-SC-01')).toBe(false);
    expect(plan.excluded.find((e) => e.sku === 'KIT-SC-01')?.reasons.join(' ')).toMatch(
      /prohibited/i,
    );
  });

  it('shortens the plan instead of exceeding the budget', () => {
    const plan = planMission({ intent: shelter, catalog, now, budgetAvailableMinor: 10_000n });
    expect(plan.totalMinor).toBeLessThanOrEqual(10_000n);
    expect(plan.unmetQuantity).toBeGreaterThan(0);
    expect(plan.shortfallReason).toMatch(/budget/i);
  });

  it('recovers from a stockout by excluding the failed merchant and keeping the budget', () => {
    // KIT-FF-01 (20 units) went down. 10 units from KIT-FF-03 are already live.
    const plan = planMission({
      intent: shelter,
      catalog,
      now,
      coveredQuantity: 10,
      budgetAvailableMinor: 17_500n - 10n * 550n,
      reservedByProduct: new Map([[sku('KIT-FF-03').id, 10]]),
      blockedProductIds: new Set([sku('KIT-FF-01').id]),
    });
    expect(plan.unmetQuantity).toBe(0);
    expect(plan.lines.every((l) => l.product.sku !== 'KIT-FF-01')).toBe(true);
    expect(plan.totalMinor + 10n * 550n).toBeLessThanOrEqual(17_500n);
    expect(plan.excluded.find((e) => e.sku === 'KIT-FF-01')?.reasons[0]).toMatch(/out of stock/i);
  });

  it('never allocates more than the merchant lists', () => {
    const plan = planMission({ intent: shelter, catalog, now, budgetAvailableMinor: 1_000_000n });
    for (const line of plan.lines)
      expect(line.quantity).toBeLessThanOrEqual(line.product.inventoryQty);
  });
});

function ctx(
  over: Partial<MissionPolicyContext['order']> = {},
  top: Partial<MissionPolicyContext> = {},
): MissionPolicyContext {
  const base = {
    missionId: 'm1',
    catalogProductId: sku('KIT-FF-01').id,
    merchantTenantId: IDS.tenants.cleanStart,
    quantity: 20,
    unitPriceMinor: 500n,
    amountMinor: 10_000n,
    currency: 'USD',
    planRound: 1,
  };
  const hash = computeQuoteHash(base);
  return {
    missionOrgTenantId: IDS.tenants.shelter,
    missionState: 'AWAITING_SPONSOR',
    missionCurrency: 'USD',
    budgetMinor: 17_500n,
    committedOtherMinor: 0n,
    railMode: 'SIMULATED',
    liveWritesEnabled: false,
    listedMerchantTenantIds: new Set([IDS.tenants.cleanStart]),
    order: {
      state: 'AWAITING_APPROVAL',
      amountMinor: 10_000n,
      currency: 'USD',
      quantity: 20,
      merchantTenantId: IDS.tenants.cleanStart,
      quoteHash: hash,
      expectedQuoteHash: hash,
      stockConfirmed: false,
      refundApproved: false,
      hasAuthorization: false,
      hasCapture: false,
      ...over,
    },
    ...top,
  };
}

const sponsor = { actorRole: 'SPONSOR', actorTenantId: IDS.tenants.shelter } as const;

describe('evaluateMissionPolicy', () => {
  it('allows a sponsor to approve a listed, in-budget order', () => {
    expect(evaluateMissionPolicy({ action: 'APPROVE_ORDER', ...sponsor }, ctx()).decision).toBe(
      'ALLOW',
    );
  });

  it('denies approval by anyone but a sponsor', () => {
    const d = evaluateMissionPolicy(
      { action: 'APPROVE_ORDER', actorRole: 'ORG_ADMIN', actorTenantId: IDS.tenants.shelter },
      ctx(),
    );
    expect(d.reasons.map((r) => r.code)).toContain('ROLE_NOT_PERMITTED');
  });

  it('denies a sponsor from another organization', () => {
    const d = evaluateMissionPolicy(
      { action: 'APPROVE_ORDER', actorRole: 'SPONSOR', actorTenantId: IDS.tenants.bakery },
      ctx(),
    );
    expect(d.reasons.map((r) => r.code)).toContain('CROSS_TENANT');
  });

  it('denies a payee that is not in the verified catalog (an agent cannot invent a supplier)', () => {
    const d = evaluateMissionPolicy(
      { action: 'APPROVE_ORDER', ...sponsor },
      ctx({}, { listedMerchantTenantIds: new Set() }),
    );
    expect(d.reasons.map((r) => r.code)).toContain('UNLISTED_MERCHANT');
  });

  it('denies an order whose amount no longer matches its quote hash', () => {
    const d = evaluateMissionPolicy(
      { action: 'APPROVE_ORDER', ...sponsor },
      ctx({ expectedQuoteHash: 'different' }),
    );
    expect(d.reasons.map((r) => r.code)).toContain('QUOTE_TAMPERED');
  });

  it('denies approval that would exceed the mission budget', () => {
    const d = evaluateMissionPolicy(
      { action: 'APPROVE_ORDER', ...sponsor },
      ctx({}, { committedOtherMinor: 8_000n }),
    );
    expect(d.reasons.map((r) => r.code)).toContain('OVER_BUDGET');
  });

  it('denies a duplicate approval of an order that is already authorized', () => {
    const d = evaluateMissionPolicy(
      { action: 'APPROVE_ORDER', ...sponsor },
      ctx({ state: 'AUTHORIZED' }),
    );
    expect(d.reasons.map((r) => r.code)).toContain('INVALID_STATE');
  });

  it('blocks capture until the merchant confirms stock', () => {
    const base = ctx({ state: 'AUTHORIZED', hasAuthorization: true });
    expect(
      evaluateMissionPolicy({ action: 'CAPTURE', ...sponsor }, base).reasons.map((r) => r.code),
    ).toContain('STOCK_NOT_CONFIRMED');
    const ok = ctx({ state: 'AUTHORIZED', hasAuthorization: true, stockConfirmed: true });
    expect(evaluateMissionPolicy({ action: 'CAPTURE', ...sponsor }, ok).decision).toBe('ALLOW');
  });

  it('voids only uncaptured authorizations', () => {
    const voidable = ctx({ state: 'AUTHORIZED', hasAuthorization: true });
    expect(evaluateMissionPolicy({ action: 'VOID', ...sponsor }, voidable).decision).toBe('ALLOW');
    const captured = ctx({ state: 'AUTHORIZED', hasAuthorization: true, hasCapture: true });
    expect(
      evaluateMissionPolicy({ action: 'VOID', ...sponsor }, captured).reasons.map((r) => r.code),
    ).toContain('ALREADY_CAPTURED');
  });

  it('requires explicit merchant approval for any refund of a captured payment', () => {
    const pending = ctx({ state: 'REFUND_PENDING', hasCapture: true });
    expect(
      evaluateMissionPolicy({ action: 'REFUND', ...sponsor }, pending).reasons.map((r) => r.code),
    ).toContain('MERCHANT_APPROVAL_REQUIRED');
    const approved = ctx({ state: 'REFUND_PENDING', hasCapture: true, refundApproved: true });
    expect(evaluateMissionPolicy({ action: 'REFUND', ...sponsor }, approved).decision).toBe(
      'ALLOW',
    );
  });

  it('lets only the organization acknowledge receipt, within the ordered quantity', () => {
    const shipped = ctx({ state: 'SHIPPED' });
    const org = { actorRole: 'ORG_ADMIN', actorTenantId: IDS.tenants.shelter } as const;
    expect(
      evaluateMissionPolicy({ action: 'ACKNOWLEDGE', ...org, quantityReceived: 20 }, shipped)
        .decision,
    ).toBe('ALLOW');
    expect(
      evaluateMissionPolicy(
        { action: 'ACKNOWLEDGE', ...org, quantityReceived: 21 },
        shipped,
      ).reasons.map((r) => r.code),
    ).toContain('INVALID_QUANTITY');
    expect(
      evaluateMissionPolicy(
        { action: 'ACKNOWLEDGE', ...sponsor, quantityReceived: 20 },
        shipped,
      ).reasons.map((r) => r.code),
    ).toContain('ROLE_NOT_PERMITTED');
  });

  it('is closed once the mission is complete', () => {
    const d = evaluateMissionPolicy(
      { action: 'APPROVE_ORDER', ...sponsor },
      ctx({}, { missionState: 'COMPLETED' }),
    );
    expect(d.reasons.map((r) => r.code)).toContain('MISSION_CLOSED');
  });
});

describe('decideRemedy', () => {
  const none = { authorizationStatus: null, captureStatus: null };
  it('voids an uncaptured authorization', () => {
    expect(
      decideRemedy('AUTHORIZED', { authorizationStatus: 'CREATED', captureStatus: null }).kind,
    ).toBe('VOID_AUTHORIZATION');
  });
  it('requests a merchant refund for a captured payment, based on observed PayPal state', () => {
    expect(
      decideRemedy('AUTHORIZED', { authorizationStatus: 'CAPTURED', captureStatus: 'COMPLETED' })
        .kind,
    ).toBe('REQUEST_REFUND');
    expect(decideRemedy('CAPTURED', none).kind).toBe('REQUEST_REFUND');
  });
  it('trusts PayPal when the authorization is already released', () => {
    expect(
      decideRemedy('AUTHORIZED', { authorizationStatus: 'VOIDED', captureStatus: null }).kind,
    ).toBe('ALREADY_RELEASED');
  });
  it('cancels unfunded orders without touching PayPal', () => {
    expect(decideRemedy('AWAITING_APPROVAL', null).kind).toBe('CANCEL_UNFUNDED');
  });
  it('does not apply once goods shipped', () => {
    expect(decideRemedy('SHIPPED', null).kind).toBe('NOT_APPLICABLE');
  });
});

describe('deriveMissionState', () => {
  const o = (
    state: MissionOrderState,
    quantity = 10,
    extra: { quantityReceived?: number } = {},
  ) => ({
    state,
    quantity,
    amountMinor: BigInt(quantity) * 500n,
    ...extra,
  });
  it('walks the lifecycle from facts', () => {
    expect(deriveMissionState([], 30, { hasPlan: false })).toBe('INTENT_CONFIRMED');
    expect(deriveMissionState([o('AWAITING_APPROVAL', 30)], 30, { hasPlan: true })).toBe(
      'AWAITING_SPONSOR',
    );
    expect(
      deriveMissionState([o('AUTHORIZED', 20), o('AWAITING_APPROVAL', 10)], 30, { hasPlan: true }),
    ).toBe('PARTIALLY_FUNDED');
    expect(
      deriveMissionState([o('AUTHORIZED', 20), o('CAPTURED', 10)], 30, { hasPlan: true }),
    ).toBe('FUNDED');
    expect(deriveMissionState([o('SHIPPED', 20), o('CAPTURED', 10)], 30, { hasPlan: true })).toBe(
      'FULFILLING',
    );
  });
  it('completes only when the received quantity covers the need', () => {
    const full = [
      o('DELIVERED', 20, { quantityReceived: 20 }),
      o('DELIVERED', 10, { quantityReceived: 10 }),
    ];
    expect(deriveMissionState(full, 30, { hasPlan: true })).toBe('COMPLETED');
    const short = [
      o('DELIVERED', 20, { quantityReceived: 20 }),
      o('DELIVERED', 10, { quantityReceived: 4 }),
    ];
    expect(deriveMissionState(short, 30, { hasPlan: true })).toBe('PARTIALLY_FULFILLED');
  });
  it('ignores voided and refunded orders for coverage and reports a block when nothing is live', () => {
    const orders = [o('VOIDED', 20), o('AWAITING_APPROVAL', 20)];
    expect(coverage(orders, 30).planned).toBe(20);
    expect(deriveMissionState([o('VOIDED', 30)], 30, { hasPlan: true })).toBe('BLOCKED');
  });
  it('gives a next step for each stage', () => {
    expect(nextStepFor([o('AWAITING_APPROVAL')], 'AWAITING_SPONSOR').actor).toBe('SPONSOR');
    expect(nextStepFor([o('AUTHORIZED')], 'FUNDED').actor).toBe('MERCHANT');
    expect(nextStepFor([o('SHIPPED')], 'FULFILLING').actor).toBe('ORG');
  });
});

describe('figuresAreGrounded', () => {
  const facts = { lines: ['A: 20 × $5.00 = $100.00'], total: '$155.00' };
  it('accepts narration that only repeats known figures', () => {
    expect(figuresAreGrounded('Total is $155.00, with $100 from A.', facts)).toBe(true);
  });
  it('rejects a figure the planner never produced', () => {
    expect(figuresAreGrounded('A cheaper total of $120.00 is possible.', facts)).toBe(false);
  });
});
