import type { MissionOrderState, OrderProtectionView } from '@promesa/contracts';

export type ProtectedOrder = {
  state: MissionOrderState;
  quantity: number;
  estimatedDeliveryAt: Date | null;
  stockConfirmedAt: Date | null;
  stockoutAt: Date | null;
  paypalAuthorizationId: string | null;
  paypalCaptureId: string | null;
  paypalRefundId: string | null;
  trackingNumber: string | null;
  quantityReceived: number | null;
  refundApprovedAt: Date | null;
};

/**
 * PromiseTwin protection for one NeedMesh purchase. Keeps intent, merchant commitment, PayPal and
 * delivery as separate tracks: a completed capture is never treated as proof of delivery.
 */
export function deriveProtection(
  o: ProtectedOrder,
  ctx: { deadline: Date; now: Date; compatible: boolean },
): OrderProtectionView {
  const tracks: OrderProtectionView['tracks'] = [];
  const gaps: string[] = [];
  const remedies: string[] = [];

  tracks.push({
    track: 'INTENT',
    status: ctx.compatible ? 'MET' : 'FAILED',
    detail: ctx.compatible
      ? 'Listing satisfies every hard constraint of the confirmed need.'
      : 'Listing no longer satisfies the confirmed need.',
  });

  const lateEta = o.estimatedDeliveryAt !== null && o.estimatedDeliveryAt > ctx.deadline;
  if (o.stockoutAt) {
    tracks.push({ track: 'MERCHANT', status: 'FAILED', detail: 'Merchant reported a stockout.' });
    gaps.push('Merchant cannot supply the committed quantity.');
  } else if (o.stockConfirmedAt) {
    tracks.push({
      track: 'MERCHANT',
      status: lateEta ? 'AT_RISK' : 'MET',
      detail: lateEta
        ? 'Stock confirmed, but the estimated delivery is after the deadline.'
        : 'Merchant confirmed stock for this order.',
    });
  } else {
    tracks.push({
      track: 'MERCHANT',
      status: lateEta ? 'AT_RISK' : 'PENDING',
      detail: lateEta
        ? 'Estimated delivery is after the deadline.'
        : 'Awaiting merchant stock confirmation.',
    });
  }
  if (lateEta) gaps.push('Estimated delivery lands after the mission deadline.');

  const paypal: OrderProtectionView['tracks'][number] = (() => {
    switch (o.state) {
      case 'AWAITING_APPROVAL':
        return { track: 'PAYPAL', status: 'PENDING', detail: 'Waiting for a sponsor to approve.' };
      case 'PAYPAL_ORDER_CREATED':
        return { track: 'PAYPAL', status: 'PENDING', detail: 'Sponsor is approving in PayPal.' };
      case 'AUTHORIZED':
        return { track: 'PAYPAL', status: 'MET', detail: 'Funds authorized, not captured.' };
      case 'VOIDED':
        return {
          track: 'PAYPAL',
          status: 'MET',
          detail: 'Authorization voided — sponsor not charged.',
        };
      case 'REFUND_PENDING':
        return {
          track: 'PAYPAL',
          status: 'AT_RISK',
          detail: o.refundApprovedAt
            ? 'Merchant approved the refund.'
            : 'Captured; refund needs merchant approval.',
        };
      case 'REFUNDED':
        return {
          track: 'PAYPAL',
          status: 'MET',
          detail: `Refunded (${o.paypalRefundId ?? 'refund'}).`,
        };
      case 'CANCELLED':
        return { track: 'PAYPAL', status: 'MET', detail: 'Cancelled before any payment.' };
      default:
        return {
          track: 'PAYPAL',
          status: 'MET',
          detail: `Captured (${o.paypalCaptureId ?? 'capture'}).`,
        };
    }
  })();
  tracks.push(paypal);

  const pastDeadline = ctx.now > ctx.deadline;
  if (o.state === 'DELIVERED' && o.quantityReceived !== null) {
    const short = o.quantityReceived < o.quantity;
    tracks.push({
      track: 'DELIVERY',
      status: short ? 'FAILED' : 'MET',
      detail: `Recipient confirmed ${o.quantityReceived} of ${o.quantity}.`,
    });
    if (short) gaps.push(`${o.quantity - o.quantityReceived} units were not received.`);
  } else if (o.state === 'SHIPPED') {
    tracks.push({
      track: 'DELIVERY',
      status: pastDeadline ? 'AT_RISK' : 'PENDING',
      detail: `Shipped (${o.trackingNumber ?? 'tracking pending'}); awaiting recipient confirmation.`,
    });
  } else if (['VOIDED', 'REFUNDED', 'CANCELLED', 'REFUND_PENDING'].includes(o.state)) {
    tracks.push({
      track: 'DELIVERY',
      status: 'FAILED',
      detail: 'Will not be delivered; replaced by re-planning.',
    });
  } else {
    tracks.push({
      track: 'DELIVERY',
      status: pastDeadline ? 'AT_RISK' : 'PENDING',
      detail: pastDeadline ? 'Deadline passed with no delivery evidence.' : 'Not shipped yet.',
    });
    if (pastDeadline) gaps.push('Deadline passed with no delivery evidence.');
  }

  // Permitted remedies (proposals only; the policy engine and humans decide).
  if (o.stockoutAt || gaps.length > 0) {
    if (o.paypalAuthorizationId && !o.paypalCaptureId && o.state === 'AUTHORIZED')
      remedies.push('Void the uncaptured authorization (no charge).');
    if (o.paypalCaptureId && !o.paypalRefundId)
      remedies.push('Request a merchant-authorized refund of the capture.');
    remedies.push(
      'Re-plan the missing units with another verified merchant (new sponsor approval).',
    );
  }

  let health: OrderProtectionView['health'];
  if (o.state === 'AWAITING_APPROVAL' || o.state === 'PAYPAL_ORDER_CREATED')
    health = gaps.length ? 'AT_RISK' : 'UNDETERMINED';
  else if (o.stockoutAt || ['VOIDED', 'REFUND_PENDING', 'REFUNDED', 'CANCELLED'].includes(o.state))
    health = 'UNDER_RECOVERY';
  else if (o.state === 'DELIVERED') health = gaps.length ? 'BREACHED' : 'FULFILLED';
  else health = gaps.length ? 'AT_RISK' : 'ON_TRACK';
  if (health === 'UNDER_RECOVERY' && ['VOIDED', 'REFUNDED', 'CANCELLED'].includes(o.state))
    remedies.splice(
      0,
      remedies.length,
      'Recovered: money released; missing units were re-planned.',
    );

  return { health, tracks, gaps, remedies };
}
