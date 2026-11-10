import type { MissionOrderState, MissionState, PayPalRailMode, Role } from '@promesa/contracts';
import type { PolicyDecision, PolicyReason } from '../policy/financial-policy';

export const MISSION_POLICY_VERSION = 'mission-policy@1.0.0';

export type MissionAction =
  'APPROVE_ORDER' | 'AUTHORIZE_ORDER' | 'CAPTURE' | 'VOID' | 'REFUND' | 'SHIP' | 'ACKNOWLEDGE';

export type MissionPolicyInput = {
  action: MissionAction;
  actorRole: Role;
  actorTenantId: string;
  /** Required for ACKNOWLEDGE: units the recipient says arrived. */
  quantityReceived?: number;
};

/** Server-resolved facts only. Nothing in here may originate from an LLM or the browser. */
export type MissionPolicyContext = {
  missionOrgTenantId: string;
  /** Published to the marketplace by a verified organization: sponsors from other tenants may fund orders. */
  missionPublic?: boolean;
  missionState: MissionState;
  missionCurrency: string;
  budgetMinor: bigint;
  /** Money committed by every other live order of the mission. */
  committedOtherMinor: bigint;
  railMode: PayPalRailMode;
  liveWritesEnabled: boolean;
  /** Merchants that appear in the verified catalog. The AI can never introduce a payee. */
  listedMerchantTenantIds: ReadonlySet<string>;
  order: {
    state: MissionOrderState;
    amountMinor: bigint;
    currency: string;
    quantity: number;
    merchantTenantId: string;
    quoteHash: string;
    expectedQuoteHash: string;
    stockConfirmed: boolean;
    refundApproved: boolean;
    hasAuthorization: boolean;
    hasCapture: boolean;
  };
};

const FUNDER_ROLES: Role[] = ['SPONSOR'];
const ORG_ROLES: Role[] = ['ORG_ADMIN', 'ORG_OPERATOR'];
const TERMINAL: MissionState[] = ['COMPLETED', 'CANCELLED', 'EXPIRED'];

/**
 * Deterministic policy for NeedMesh financial and fulfilment actions. Pure: same facts, same
 * decision. The LLM may recommend an action; only an ALLOW from here lets the PayPal rail run.
 */
export function evaluateMissionPolicy(
  input: MissionPolicyInput,
  ctx: MissionPolicyContext,
): PolicyDecision {
  const deny: PolicyReason[] = [];
  const d = (code: string, message: string) => deny.push({ code, message });
  const o = ctx.order;

  if (TERMINAL.includes(ctx.missionState))
    d('MISSION_CLOSED', `The mission is ${ctx.missionState.toLowerCase()}.`);
  if (o.currency !== 'USD' || o.currency !== ctx.missionCurrency)
    d('CURRENCY_MISMATCH', 'Only USD is supported and the order must match the mission currency.');
  if (o.amountMinor <= 0n) d('INVALID_AMOUNT', 'Order amount must be positive.');
  if (o.quoteHash !== o.expectedQuoteHash)
    d('QUOTE_TAMPERED', 'The order no longer matches the quote the agents produced.');
  if (!ctx.listedMerchantTenantIds.has(o.merchantTenantId))
    d(
      'UNLISTED_MERCHANT',
      'The payee is not a merchant in the verified catalog. Agents cannot add payees.',
    );

  const needState = (...states: MissionOrderState[]) => {
    if (!states.includes(o.state))
      d('INVALID_STATE', `Order is ${o.state}; this action needs ${states.join(' or ')}.`);
  };

  switch (input.action) {
    case 'APPROVE_ORDER': {
      if (!FUNDER_ROLES.includes(input.actorRole))
        d('ROLE_NOT_PERMITTED', 'Only a sponsor can approve and fund a merchant order.');
      if (input.actorTenantId !== ctx.missionOrgTenantId && !ctx.missionPublic)
        d(
          'CROSS_TENANT',
          'This mission is private to its organization. External sponsors can fund only published missions.',
        );
      needState('AWAITING_APPROVAL', 'PAYPAL_ORDER_CREATED');
      if (ctx.committedOtherMinor + o.amountMinor > ctx.budgetMinor)
        d('OVER_BUDGET', 'Approving this order would exceed the mission budget.');
      if (ctx.railMode === 'SANDBOX' && !ctx.liveWritesEnabled)
        d('LIVE_WRITES_DISABLED', 'PayPal writes are disabled (ENABLE_LIVE_PAYPAL_WRITES=false).');
      break;
    }
    case 'AUTHORIZE_ORDER': {
      if (!FUNDER_ROLES.includes(input.actorRole))
        d('ROLE_NOT_PERMITTED', 'Only a sponsor can complete a PayPal approval.');
      if (input.actorTenantId !== ctx.missionOrgTenantId && !ctx.missionPublic)
        d('CROSS_TENANT', 'This mission is private to its organization.');
      needState('PAYPAL_ORDER_CREATED');
      if (ctx.committedOtherMinor + o.amountMinor > ctx.budgetMinor)
        d('OVER_BUDGET', 'Authorizing this order would exceed the mission budget.');
      break;
    }
    case 'CAPTURE': {
      needState('AUTHORIZED');
      if (!o.hasAuthorization)
        d('NO_AUTHORIZATION', 'There is no PayPal authorization to capture.');
      if (!o.stockConfirmed)
        d(
          'STOCK_NOT_CONFIRMED',
          'Funds are captured only after the merchant confirms it can supply the goods.',
        );
      break;
    }
    case 'VOID': {
      needState('AUTHORIZED');
      if (!o.hasAuthorization) d('NO_AUTHORIZATION', 'There is no PayPal authorization to void.');
      if (o.hasCapture)
        d('ALREADY_CAPTURED', 'A captured payment cannot be voided; use the refund process.');
      break;
    }
    case 'REFUND': {
      needState('REFUND_PENDING');
      if (!o.hasCapture) d('NO_CAPTURE', 'There is no captured payment to refund.');
      if (!o.refundApproved)
        d(
          'MERCHANT_APPROVAL_REQUIRED',
          'Refunds of captured payments require explicit merchant authorization.',
        );
      break;
    }
    case 'SHIP': {
      needState('CAPTURED');
      if (!o.hasCapture) d('NO_CAPTURE', 'Shipment tracking attaches to a captured payment.');
      break;
    }
    case 'ACKNOWLEDGE': {
      if (!ORG_ROLES.includes(input.actorRole))
        d('ROLE_NOT_PERMITTED', 'Only the requesting organization can acknowledge receipt.');
      if (input.actorTenantId !== ctx.missionOrgTenantId)
        d('CROSS_TENANT', 'This mission belongs to a different organization.');
      needState('SHIPPED');
      if (
        input.quantityReceived === undefined ||
        input.quantityReceived < 0 ||
        input.quantityReceived > o.quantity
      )
        d('INVALID_QUANTITY', `Quantity received must be between 0 and ${o.quantity}.`);
      break;
    }
  }

  const seen = new Set<string>();
  const reasons = deny.filter((r) => (seen.has(r.code) ? false : (seen.add(r.code), true)));
  return reasons.length > 0
    ? { decision: 'DENY', reasons, policyVersion: MISSION_POLICY_VERSION }
    : { decision: 'ALLOW', reasons: [], policyVersion: MISSION_POLICY_VERSION };
}
