import { type MissionOrderState, type MissionState } from '@promesa/contracts';
import { hashObject } from '../../common/hash';

/** Order states that still count toward covering the requested quantity. */
const COVERING: ReadonlySet<MissionOrderState> = new Set([
  'AWAITING_APPROVAL',
  'PAYPAL_ORDER_CREATED',
  'AUTHORIZED',
  'CAPTURED',
  'SHIPPED',
  'DELIVERED',
]);

/** Money is still committed (authorized, captured, or captured and awaiting a merchant refund). */
const COMMITTING: ReadonlySet<MissionOrderState> = new Set([...COVERING, 'REFUND_PENDING']);

const FUNDED: ReadonlySet<MissionOrderState> = new Set([
  'AUTHORIZED',
  'CAPTURED',
  'SHIPPED',
  'DELIVERED',
]);

export type OrderLike = {
  state: MissionOrderState;
  quantity: number;
  amountMinor: bigint;
  quantityReceived?: number | null;
};

export const isCovering = (o: Pick<OrderLike, 'state'>) => COVERING.has(o.state);
export const isCommitting = (o: Pick<OrderLike, 'state'>) => COMMITTING.has(o.state);
export const isFunded = (o: Pick<OrderLike, 'state'>) => FUNDED.has(o.state);

export function committedMinor(orders: OrderLike[]): bigint {
  return orders.filter(isCommitting).reduce((acc, o) => acc + o.amountMinor, 0n);
}

export function coverage(orders: OrderLike[], requested: number) {
  const planned = orders.filter(isCovering).reduce((a, o) => a + o.quantity, 0);
  const funded = orders.filter(isFunded).reduce((a, o) => a + o.quantity, 0);
  const delivered = orders
    .filter((o) => o.state === 'DELIVERED')
    .reduce((a, o) => a + (o.quantityReceived ?? o.quantity), 0);
  return { requested, planned, funded, delivered };
}

/**
 * Mission state is derived from order facts, never set by an agent's say-so.
 * `replanBlocked` means recovery found no feasible replacement.
 */
export function deriveMissionState(
  orders: OrderLike[],
  requested: number,
  opts: { hasPlan: boolean; replanBlocked?: boolean; needsReplan?: boolean },
): MissionState {
  if (!opts.hasPlan) return 'INTENT_CONFIRMED';
  const live = orders.filter(isCovering);
  const c = coverage(orders, requested);

  if (opts.replanBlocked && c.planned < requested) return 'BLOCKED';
  if (opts.needsReplan) return 'NEEDS_REPLAN';
  if (live.length === 0) return 'BLOCKED';

  const allDelivered = live.every((o) => o.state === 'DELIVERED');
  if (allDelivered && c.delivered >= requested) return 'COMPLETED';
  if (live.some((o) => o.state === 'SHIPPED' || o.state === 'DELIVERED')) {
    return allDelivered ? 'PARTIALLY_FULFILLED' : 'FULFILLING';
  }
  const funded = live.filter(isFunded).length;
  if (funded === 0) return 'AWAITING_SPONSOR';
  if (funded < live.length) return 'PARTIALLY_FUNDED';
  return 'FUNDED';
}

export type NextStep = {
  actor: 'ORG' | 'SPONSOR' | 'MERCHANT' | 'AGENTS' | 'NONE';
  label: string;
};

/** Server-side hint for what has to happen next. Presentation only; policy still gates every action. */
export function nextStepFor(orders: OrderLike[], state: MissionState): NextStep {
  if (state === 'INTENT_CONFIRMED')
    return { actor: 'ORG', label: 'Run the NeedMesh agents to build a funded purchasing plan.' };
  if (state === 'COMPLETED')
    return {
      actor: 'NONE',
      label: 'Mission complete. The Mission Receipt links payments to outcomes.',
    };
  if (state === 'BLOCKED')
    return {
      actor: 'ORG',
      label: 'No feasible plan inside the constraints. Adjust the budget, quantity or deadline.',
    };
  const count = (s: MissionOrderState) => orders.filter((o) => o.state === s).length;
  const awaiting = count('AWAITING_APPROVAL') + count('PAYPAL_ORDER_CREATED');
  if (awaiting > 0)
    return {
      actor: 'SPONSOR',
      label: `Review and fund ${awaiting} merchant order${awaiting === 1 ? '' : 's'} through PayPal.`,
    };
  if (count('REFUND_PENDING') > 0)
    return {
      actor: 'MERCHANT',
      label: 'A merchant must authorize the refund of a captured payment.',
    };
  if (count('AUTHORIZED') > 0)
    return {
      actor: 'MERCHANT',
      label: 'Merchants confirm stock, then the PayPal agent captures payment.',
    };
  if (count('CAPTURED') > 0)
    return {
      actor: 'MERCHANT',
      label: 'Merchants ship and attach tracking to the PayPal transaction.',
    };
  if (count('SHIPPED') > 0)
    return { actor: 'ORG', label: 'The organization acknowledges what actually arrived.' };
  return { actor: 'AGENTS', label: 'The agents are reconciling the mission.' };
}

export type Remedy =
  | { kind: 'VOID_AUTHORIZATION'; why: string }
  | { kind: 'REQUEST_REFUND'; why: string }
  | { kind: 'CANCEL_UNFUNDED'; why: string }
  | { kind: 'ALREADY_RELEASED'; why: string }
  | { kind: 'NOT_APPLICABLE'; why: string };

/**
 * Which financial remedy fits a failed supplier, decided from the *observed* PayPal state when it
 * could be read, otherwise from the last verified local state. An uncaptured authorization is
 * voided; a captured payment can only be refunded by the merchant; unfunded orders are cancelled.
 */
export function decideRemedy(
  localState: MissionOrderState,
  observed: { authorizationStatus: string | null; captureStatus: string | null } | null,
): Remedy {
  if (localState === 'SHIPPED' || localState === 'DELIVERED')
    return {
      kind: 'NOT_APPLICABLE',
      why: 'Goods have already shipped; a stockout no longer applies.',
    };
  if (
    localState === 'VOIDED' ||
    localState === 'REFUNDED' ||
    localState === 'CANCELLED' ||
    localState === 'REFUND_PENDING'
  )
    return { kind: 'ALREADY_RELEASED', why: `The order is already ${localState.toLowerCase()}.` };
  if (localState === 'AWAITING_APPROVAL' || localState === 'PAYPAL_ORDER_CREATED')
    return {
      kind: 'CANCEL_UNFUNDED',
      why: 'No funds were reserved, so nothing needs to be released.',
    };

  const captured = observed?.captureStatus
    ? ['COMPLETED', 'PENDING', 'PARTIALLY_REFUNDED'].includes(observed.captureStatus)
    : localState === 'CAPTURED';
  if (captured)
    return {
      kind: 'REQUEST_REFUND',
      why: 'Payment was captured. Only the merchant can authorize a refund through PayPal.',
    };
  const auth = observed?.authorizationStatus;
  if (auth && ['VOIDED', 'EXPIRED', 'DENIED'].includes(auth))
    return { kind: 'ALREADY_RELEASED', why: `PayPal reports the authorization as ${auth}.` };
  return {
    kind: 'VOID_AUTHORIZATION',
    why: 'Funds were only authorized, not captured, so the authorization can be voided with no charge.',
  };
}

export type QuoteInput = {
  missionId: string;
  catalogProductId: string;
  merchantTenantId: string;
  quantity: number;
  unitPriceMinor: bigint;
  amountMinor: bigint;
  currency: string;
  planRound: number;
};

/** Immutable quote fingerprint. Re-computed before every financial action to detect drift or tampering. */
export function computeQuoteHash(q: QuoteInput): string {
  return hashObject({ v: 1, ...q });
}
