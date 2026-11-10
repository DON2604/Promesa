import type { Role } from '@promesa/contracts';

export const FINANCIAL_POLICY_VERSION = 'financial-policy@1.0.0';

export type FinancialOperation = 'CREATE_ORDER' | 'CAPTURE' | 'REFUND' | 'VOID' | 'CREATE_INVOICE';

export type FinancialDecisionInput = {
  operation: FinancialOperation;
  actorUserId: string;
  actorTenantId: string;
  actorRole: Role;
  merchantConnectionId: string;
  purchaseId: string;
  amountMinor: bigint;
  currency: string;
  requestId: string;
  immutableApprovedQuoteHash?: string;
  buyerApprovalId?: string;
  merchantApprovalId?: string;
  captureId?: string;
};

/** Server-resolved facts. Nothing here comes from the client. */
export type FinancialContext = {
  environment: 'sandbox' | 'live';
  liveWritesEnabled: boolean;
  actorMemberships: Array<{ tenantId: string; role: Role }>;
  merchantConnection: {
    id: string;
    tenantId: string;
    status: 'CONNECTED' | 'NOT_CONNECTED' | 'REVOKED';
    environment: 'sandbox' | 'live';
    permissions: string[];
  } | null;
  purchase: {
    id: string;
    buyerTenantId: string;
    sellerTenantId: string | null;
    state: string;
    amountMinor: bigint | null;
    currency: string;
    approvedQuoteHash: string | null;
    quoteExpiresAt: Date | null;
    budgetRemainingMinor: bigint | null;
  };
  capture?: {
    id: string;
    merchantConnectionId: string;
    status: string;
    amountMinor: bigint;
    refundedMinor: bigint;
  } | null;
  buyerApproval?: { id: string; purchaseId: string; snapshotHash: string } | null;
  merchantApproval?: { id: string; merchantTenantId: string; snapshotHash: string } | null;
  existingRequestIds: Set<string>;
  now: Date;
};

export type PolicyReason = { code: string; message: string };
export type PolicyDecision = {
  decision: 'ALLOW' | 'DENY' | 'REVIEW';
  reasons: PolicyReason[];
  policyVersion: string;
};

const BUYER_ROLES: Role[] = ['BUYER', 'SPONSOR', 'ORG_ADMIN'];
const MERCHANT_ROLES: Role[] = ['MERCHANT_ADMIN'];

/**
 * Deterministic financial policy (backend spec §8). Pure function: same input, same decision.
 * LLM output can never reach this function as an authority; it only receives server facts.
 */
export function evaluateFinancialPolicy(
  input: FinancialDecisionInput,
  ctx: FinancialContext,
): PolicyDecision {
  const deny: PolicyReason[] = [];
  const review: PolicyReason[] = [];
  const d = (code: string, message: string) => deny.push({ code, message });

  const isMember = ctx.actorMemberships.some(
    (m) => m.tenantId === input.actorTenantId && m.role === input.actorRole,
  );
  if (!isMember) d('NOT_A_MEMBER', 'Actor does not hold the claimed role in the claimed tenant.');

  if (ctx.existingRequestIds.has(input.requestId)) {
    d(
      'DUPLICATE_REQUEST',
      'This logical request ID was already used; reconcile the existing command instead.',
    );
  }

  if (input.currency !== 'USD' || input.currency !== ctx.purchase.currency) {
    d('CURRENCY_MISMATCH', 'Only USD is supported and currency must match the purchase.');
  }

  if (input.amountMinor <= 0n) d('INVALID_AMOUNT', 'Amount must be positive.');

  const mc = ctx.merchantConnection;
  if (!mc || mc.id !== input.merchantConnectionId) {
    d(
      'MERCHANT_NOT_CONNECTED',
      'The target merchant has no connected PayPal account for this operation.',
    );
  } else {
    if (mc.status !== 'CONNECTED')
      d('MERCHANT_NOT_CONNECTED', 'Merchant connection is not active.');
    if (mc.environment !== ctx.environment)
      d('ENVIRONMENT_MISMATCH', 'Merchant connection environment differs from runtime.');
    if (ctx.purchase.sellerTenantId !== mc.tenantId) {
      d(
        'WRONG_MERCHANT',
        'The merchant connection does not belong to the seller of this purchase.',
      );
    }
  }

  if (!ctx.liveWritesEnabled && input.operation !== 'CREATE_INVOICE') {
    d('LIVE_WRITES_DISABLED', 'PayPal writes are disabled (ENABLE_LIVE_PAYPAL_WRITES=false).');
  }

  switch (input.operation) {
    case 'CREATE_ORDER':
    case 'CAPTURE': {
      if (!BUYER_ROLES.includes(input.actorRole))
        d('ROLE_NOT_PERMITTED', 'Only a buyer or sponsor can pay.');
      if (ctx.purchase.buyerTenantId !== input.actorTenantId && input.actorRole !== 'SPONSOR') {
        d('CROSS_TENANT', 'Actor tenant does not own this purchase.');
      }
      if (
        !ctx.purchase.approvedQuoteHash ||
        ctx.purchase.approvedQuoteHash !== input.immutableApprovedQuoteHash
      ) {
        d('QUOTE_NOT_APPROVED', 'Amount must come from the locked, approved quote.');
      }
      if (ctx.purchase.amountMinor === null || ctx.purchase.amountMinor !== input.amountMinor) {
        d('AMOUNT_MISMATCH', 'Amount differs from the approved quote.');
      }
      if (
        ctx.purchase.quoteExpiresAt &&
        ctx.purchase.quoteExpiresAt.getTime() < ctx.now.getTime()
      ) {
        d('QUOTE_EXPIRED', 'The approved quote has expired.');
      }
      if (
        ctx.purchase.budgetRemainingMinor !== null &&
        input.amountMinor > ctx.purchase.budgetRemainingMinor
      ) {
        d('OVER_BUDGET', 'Amount exceeds the remaining budget.');
      }
      if (input.operation === 'CREATE_ORDER' && ctx.purchase.state !== 'QUOTE_CONFIRMED') {
        d('INVALID_STATE', `Cannot create an order from state ${ctx.purchase.state}.`);
      }
      if (input.operation === 'CAPTURE' && ctx.purchase.state !== 'APPROVED') {
        d('BUYER_APPROVAL_REQUIRED', 'Capture requires a PayPal-approved order.');
      }
      break;
    }
    case 'REFUND': {
      if (!MERCHANT_ROLES.includes(input.actorRole)) {
        d(
          'MERCHANT_PERMISSION_REQUIRED',
          'Refunds require an authorized merchant administrator. Buyer consent is not sufficient.',
        );
      }
      if (mc && input.actorTenantId !== mc.tenantId) {
        d(
          'MERCHANT_PERMISSION_REQUIRED',
          'Only the merchant that owns the capture can authorize a refund.',
        );
      }
      if (mc && !mc.permissions.includes('PAYMENTS_REFUND')) {
        d('MISSING_PERMISSION', 'Merchant connection lacks refund permission.');
      }
      const cap = ctx.capture;
      if (!cap || cap.id !== input.captureId)
        d('CAPTURE_NOT_FOUND', 'Capture is not associated with this purchase.');
      else {
        if (mc && cap.merchantConnectionId !== mc.id)
          d('WRONG_MERCHANT', 'Capture belongs to a different merchant.');
        if (cap.status !== 'COMPLETED' && cap.status !== 'PARTIALLY_REFUNDED') {
          d('CAPTURE_NOT_REFUNDABLE', `Capture status ${cap.status} is not refundable.`);
        }
        if (input.amountMinor > cap.amountMinor - cap.refundedMinor) {
          d('OVER_REFUND', 'Refund exceeds the remaining refundable amount.');
        }
      }
      if (!ctx.merchantApproval || ctx.merchantApproval.id !== input.merchantApprovalId) {
        d(
          'MERCHANT_APPROVAL_REQUIRED',
          'An explicit merchant approval bound to this proposal is required.',
        );
      } else if (mc && ctx.merchantApproval.merchantTenantId !== mc.tenantId) {
        d('MERCHANT_APPROVAL_REQUIRED', 'Approval was not given by the capture’s merchant.');
      }
      break;
    }
    case 'VOID':
      d(
        'NOT_SUPPORTED',
        'Voids apply only to uncaptured authorizations; the MVP captures immediately.',
      );
      break;
    case 'CREATE_INVOICE':
      if (!MERCHANT_ROLES.includes(input.actorRole))
        d('ROLE_NOT_PERMITTED', 'Only a merchant can issue invoices.');
      review.push({ code: 'INVOICE_REVIEW', message: 'Invoices are reviewed before sending.' });
      break;
  }

  if (deny.length > 0)
    return { decision: 'DENY', reasons: dedupe(deny), policyVersion: FINANCIAL_POLICY_VERSION };
  if (review.length > 0)
    return { decision: 'REVIEW', reasons: review, policyVersion: FINANCIAL_POLICY_VERSION };
  return { decision: 'ALLOW', reasons: [], policyVersion: FINANCIAL_POLICY_VERSION };
}

function dedupe(reasons: PolicyReason[]): PolicyReason[] {
  const seen = new Set<string>();
  return reasons.filter((r) =>
    seen.has(r.code + r.message) ? false : (seen.add(r.code + r.message), true),
  );
}
