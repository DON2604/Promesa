import { describe, expect, it } from 'vitest';
import {
  type FinancialContext,
  type FinancialDecisionInput,
  evaluateFinancialPolicy,
} from './financial-policy';

const buyerTenant = 'tenant-bakery';
const merchantTenant = 'tenant-kraftfold';

const ctx = (over: Partial<FinancialContext> = {}): FinancialContext => ({
  environment: 'sandbox',
  liveWritesEnabled: true,
  actorMemberships: [
    { tenantId: buyerTenant, role: 'BUYER' },
    { tenantId: merchantTenant, role: 'MERCHANT_ADMIN' },
  ],
  merchantConnection: {
    id: 'mc-1',
    tenantId: merchantTenant,
    status: 'CONNECTED',
    environment: 'sandbox',
    permissions: ['PAYMENTS_REFUND'],
  },
  purchase: {
    id: 'p-1',
    buyerTenantId: buyerTenant,
    sellerTenantId: merchantTenant,
    state: 'QUOTE_CONFIRMED',
    amountMinor: 8500n,
    currency: 'USD',
    approvedQuoteHash: 'quote-hash',
    quoteExpiresAt: new Date('2026-11-10T00:00:00Z'),
    budgetRemainingMinor: 10000n,
  },
  capture: {
    id: 'cap-1',
    merchantConnectionId: 'mc-1',
    status: 'COMPLETED',
    amountMinor: 8500n,
    refundedMinor: 0n,
  },
  merchantApproval: { id: 'ma-1', merchantTenantId: merchantTenant, snapshotHash: 'h' },
  existingRequestIds: new Set(),
  now: new Date('2026-11-09T12:00:00Z'),
  ...over,
});

const order: FinancialDecisionInput = {
  operation: 'CREATE_ORDER',
  actorUserId: 'maya',
  actorTenantId: buyerTenant,
  actorRole: 'BUYER',
  merchantConnectionId: 'mc-1',
  purchaseId: 'p-1',
  amountMinor: 8500n,
  currency: 'USD',
  requestId: 'req-1',
  immutableApprovedQuoteHash: 'quote-hash',
};

const refund: FinancialDecisionInput = {
  operation: 'REFUND',
  actorUserId: 'sam',
  actorTenantId: merchantTenant,
  actorRole: 'MERCHANT_ADMIN',
  merchantConnectionId: 'mc-1',
  purchaseId: 'p-1',
  amountMinor: 8500n,
  currency: 'USD',
  requestId: 'req-refund-1',
  captureId: 'cap-1',
  merchantApprovalId: 'ma-1',
};

const codes = (input: FinancialDecisionInput, c: FinancialContext) =>
  evaluateFinancialPolicy(input, c).reasons.map((r) => r.code);

describe('evaluateFinancialPolicy — orders', () => {
  it('allows an order that matches the locked quote', () => {
    expect(evaluateFinancialPolicy(order, ctx()).decision).toBe('ALLOW');
  });
  it('denies a tampered amount', () => {
    expect(codes({ ...order, amountMinor: 1n }, ctx())).toContain('AMOUNT_MISMATCH');
  });
  it('denies an unapproved quote hash', () => {
    expect(codes({ ...order, immutableApprovedQuoteHash: 'other' }, ctx())).toContain(
      'QUOTE_NOT_APPROVED',
    );
  });
  it('denies an expired quote', () => {
    expect(codes(order, ctx({ now: new Date('2026-11-11T00:00:00Z') }))).toContain('QUOTE_EXPIRED');
  });
  it('denies over-budget spend', () => {
    const c = ctx();
    c.purchase.budgetRemainingMinor = 8000n;
    expect(codes(order, c)).toContain('OVER_BUDGET');
  });
  it('denies the wrong merchant', () => {
    const c = ctx();
    c.purchase.sellerTenantId = 'someone-else';
    expect(codes(order, c)).toContain('WRONG_MERCHANT');
  });
  it('denies cross-tenant requests', () => {
    expect(codes({ ...order, actorTenantId: 'tenant-other' }, ctx())).toContain('NOT_A_MEMBER');
  });
  it('denies capture without buyer approval', () => {
    expect(codes({ ...order, operation: 'CAPTURE' }, ctx())).toContain('BUYER_APPROVAL_REQUIRED');
  });
  it('denies a reused request id', () => {
    expect(codes(order, ctx({ existingRequestIds: new Set(['req-1']) }))).toContain(
      'DUPLICATE_REQUEST',
    );
  });
  it('denies all writes when live writes are disabled', () => {
    expect(codes(order, ctx({ liveWritesEnabled: false }))).toContain('LIVE_WRITES_DISABLED');
  });
});

describe('evaluateFinancialPolicy — refunds', () => {
  it('allows a merchant-approved refund within the captured amount', () => {
    expect(evaluateFinancialPolicy(refund, ctx()).decision).toBe('ALLOW');
  });
  it('denies a buyer-only refund: buyer consent is not merchant authority', () => {
    expect(codes({ ...refund, actorRole: 'BUYER', actorTenantId: buyerTenant }, ctx())).toContain(
      'MERCHANT_PERMISSION_REQUIRED',
    );
  });
  it('denies refunds above the remaining refundable amount', () => {
    const c = ctx();
    c.capture = { ...c.capture!, refundedMinor: 1000n };
    expect(codes(refund, c)).toContain('OVER_REFUND');
  });
  it('denies refunds without a bound merchant approval', () => {
    expect(codes({ ...refund, merchantApprovalId: undefined }, ctx())).toContain(
      'MERCHANT_APPROVAL_REQUIRED',
    );
  });
  it('denies refunds against another merchant’s capture', () => {
    const c = ctx();
    c.capture = { ...c.capture!, merchantConnectionId: 'mc-other' };
    expect(codes(refund, c)).toContain('WRONG_MERCHANT');
  });
  it('never allows voids of captured payments in the MVP', () => {
    expect(evaluateFinancialPolicy({ ...refund, operation: 'VOID' }, ctx()).decision).toBe('DENY');
  });
});
