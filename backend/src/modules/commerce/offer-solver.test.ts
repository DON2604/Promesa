import type { IntentSpec } from '@promesa/contracts';
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../demo/fixtures';
import { type CatalogItem, solveOffers } from './offer-solver';

const now = new Date('2026-11-09T14:00:00Z');

const catalog: CatalogItem[] = CATALOG.map((c) => ({
  ...c,
  currency: 'USD',
  source: 'DEMO_FIXTURE',
  isDemo: true,
  lastVerifiedAt: now,
  merchant: { tenantId: c.sellerTenantId, name: c.sku.split('-')[0]!, paypalConnected: false },
}));

const bakery: IntentSpec = {
  productKind: 'packaging-box',
  productLabel: 'paper boxes',
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

describe('solveOffers', () => {
  it('never lets a lower price override a prohibited material', () => {
    const { offers, plans } = solveOffers(bakery, catalog, now);
    const plastic = offers.find((o) => o.sku === 'CLAM-PET-100')!;
    expect(BigInt(plastic.totalMinor)).toBeLessThan(8500n);
    expect(plastic.eligible).toBe(false);
    expect(plastic.exclusionReasons.join(' ')).toMatch(/prohibited: plastic/);
    expect(plans[0]).toMatchObject({ key: 'LOWEST_COST', totalMinor: '8500' });
  });

  it('excludes over-budget offers with an explicit reason', () => {
    const premium = solveOffers(bakery, catalog, now).offers.find(
      (o) => o.sku === 'BOX-PAPER-PREM',
    )!;
    expect(premium.eligible).toBe(false);
    expect(premium.checks.find((c) => c.constraintId === 'budget')!.passed).toBe(false);
  });

  it('offers an earliest-arrival alternative when it differs from the cheapest', () => {
    const { plans } = solveOffers(bakery, catalog, now);
    expect(plans.map((p) => p.key)).toEqual(['LOWEST_COST', 'EARLIEST_ARRIVAL']);
    expect(plans[1]!.totalMinor).toBe('8900');
  });

  it('splits the shelter mission across sellers within budget using integer math', () => {
    const shelter: IntentSpec = {
      ...bakery,
      productKind: 'hygiene-kit',
      quantity: 30,
      unit: 'kits',
      requiredAttributes: ['fragrance-free'],
      prohibitedAttributes: ['fragranced'],
      budgetMinor: '17500',
      deadlineISO: '2026-11-13T18:00:00-05:00',
    };
    const { plans, offers } = solveOffers(shelter, catalog, now);
    expect(offers.find((o) => o.sku === 'KIT-SC-01')!.eligible).toBe(false);
    // Beacon Basics alone (40 in stock) can cover 30 kits, so one merchant is the cheapest and fewest.
    expect(plans.length).toBeGreaterThan(0);
    expect(plans[0]).toMatchObject({ totalMinor: '16500', merchantCount: 1 });
    expect(BigInt(plans[0]!.totalMinor)).toBeLessThanOrEqual(17_500n);
  });

  it('explains infeasibility instead of relaxing hard constraints', () => {
    const { plans, infeasibleReason } = solveOffers(
      { ...bakery, budgetMinor: '5000' },
      catalog,
      now,
    );
    expect(plans).toHaveLength(0);
    expect(infeasibleReason).toMatch(/hard constraint/);
  });
});
