import { createHash } from 'node:crypto';
import { type PayPalRailMode } from '@promesa/contracts';
import { AppError } from '../../common/errors';
import { type PayPalGateway } from '../paypal/paypal-gateway';

export const PAYPAL_RAIL = Symbol('PAYPAL_RAIL');

export type RailCreateOrderArgs = {
  requestId: string;
  referenceId: string;
  customId: string;
  description: string;
  amountMinor: bigint;
  currency: string;
  returnUrl: string;
  cancelUrl: string;
};

export type RailInspection = {
  source: 'PAYPAL_API' | 'SIMULATED';
  orderStatus: string | null;
  authorizationStatus: string | null;
  captureStatus: string | null;
};

/**
 * The only way NeedMesh agents move money. Every method is reachable solely through the
 * orchestrator after `evaluateMissionPolicy` returned ALLOW. SANDBOX issues real PayPal Sandbox
 * REST calls; SIMULATED never contacts PayPal and every identifier it returns is `SIM-` prefixed.
 */
export interface PayPalRail {
  readonly mode: PayPalRailMode;
  /** True when the buyer approves on PayPal and returns later; false when approval is in-app. */
  readonly requiresRedirect: boolean;
  createAuthorizeOrder(
    args: RailCreateOrderArgs,
  ): Promise<{ orderId: string; approveUrl: string | null; status: string }>;
  authorize(args: {
    requestId: string;
    paypalOrderId: string;
  }): Promise<{ authorizationId: string; status: string }>;
  capture(args: {
    requestId: string;
    authorizationId: string;
  }): Promise<{ captureId: string; status: string }>;
  voidAuthorization(args: {
    requestId: string;
    authorizationId: string;
  }): Promise<{ status: string }>;
  refund(args: {
    requestId: string;
    captureId: string;
    amountMinor: bigint;
    currency: string;
  }): Promise<{ refundId: string; status: string }>;
  addTracking(args: {
    requestId: string;
    captureId: string;
    trackingNumber: string;
    carrierName: string;
  }): Promise<{ status: string }>;
  inspect(args: {
    orderId: string | null;
    authorizationId: string | null;
    captureId: string | null;
    /** Used only by the simulated rail, which has no remote system to ask. */
    known: { authorizationStatus: string | null; captureStatus: string | null };
  }): Promise<RailInspection>;
}

// ------------------------------------------------------------------ sandbox

type Json = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function firstOf(value: unknown): Json | null {
  return Array.isArray(value) && value[0] && typeof value[0] === 'object'
    ? (value[0] as Json)
    : null;
}

function paymentsOf(order: Json): Json | null {
  const unit = firstOf(order.purchase_units);
  const payments = unit?.payments;
  return payments && typeof payments === 'object' ? (payments as Json) : null;
}

export class SandboxPayPalRail implements PayPalRail {
  readonly mode = 'SANDBOX' as const;
  readonly requiresRedirect = true;

  constructor(
    private readonly gateway: PayPalGateway,
    private readonly brandName = 'NeedMesh (hackathon prototype)',
  ) {}

  async createAuthorizeOrder(args: RailCreateOrderArgs) {
    const order = await this.gateway.createOrder({
      requestId: args.requestId,
      referenceId: args.referenceId,
      customId: args.customId,
      description: args.description,
      amountMinor: args.amountMinor,
      currency: args.currency,
      intent: 'AUTHORIZE',
      experience: {
        returnUrl: args.returnUrl,
        cancelUrl: args.cancelUrl,
        brandName: this.brandName,
      },
    });
    const links = order.links ?? [];
    const approve =
      links.find((l) => l.rel === 'payer-action') ?? links.find((l) => l.rel === 'approve');
    return { orderId: order.id, approveUrl: approve?.href ?? null, status: order.status };
  }

  async authorize(args: { requestId: string; paypalOrderId: string }) {
    const result = await this.gateway.authorizeOrder(args.paypalOrderId, args.requestId);
    const auth = firstOf(paymentsOf(result)?.authorizations);
    const id = str(auth?.id);
    const status = str(auth?.status) ?? str(result.status) ?? 'UNKNOWN';
    if (!id) {
      throw new AppError(
        'PAYPAL_AUTHORIZATION_MISSING',
        'PayPal did not return an authorization. The buyer may not have approved the order yet.',
        422,
        { orderStatus: str(result.status) },
      );
    }
    if (status !== 'CREATED' && status !== 'PENDING') {
      throw new AppError('PAYPAL_AUTHORIZATION_REFUSED', `PayPal authorization is ${status}.`, 422);
    }
    return { authorizationId: id, status };
  }

  async capture(args: { requestId: string; authorizationId: string }) {
    const result = await this.gateway.captureAuthorization(args.authorizationId, args.requestId);
    const id = str(result.id);
    const status = str(result.status) ?? 'UNKNOWN';
    if (!id || (status !== 'COMPLETED' && status !== 'PENDING')) {
      throw new AppError('PAYPAL_CAPTURE_FAILED', `PayPal capture ended as ${status}.`, 422);
    }
    return { captureId: id, status };
  }

  async voidAuthorization(args: { requestId: string; authorizationId: string }) {
    await this.gateway.voidAuthorization(args.authorizationId, args.requestId);
    return { status: 'VOIDED' };
  }

  async refund(args: {
    requestId: string;
    captureId: string;
    amountMinor: bigint;
    currency: string;
  }) {
    const result = await this.gateway.refundCapture(args.captureId, args.requestId, {
      minor: args.amountMinor,
      currency: args.currency,
    });
    const id = str(result.id);
    const status = str(result.status) ?? 'UNKNOWN';
    if (!id) throw new AppError('PAYPAL_REFUND_FAILED', 'PayPal did not return a refund id.', 422);
    return { refundId: id, status };
  }

  async addTracking(args: {
    requestId: string;
    captureId: string;
    trackingNumber: string;
    carrierName: string;
  }) {
    await this.gateway.addTracking(args);
    return { status: 'TRACKING_ADDED' };
  }

  async inspect(args: {
    orderId: string | null;
    authorizationId: string | null;
    captureId: string | null;
  }): Promise<RailInspection> {
    const [order, authorization, capture] = await Promise.all([
      args.orderId ? this.gateway.getOrder(args.orderId) : Promise.resolve(null),
      args.authorizationId ? this.gateway.getAuthorization(args.authorizationId) : null,
      args.captureId ? this.gateway.getCapture(args.captureId) : null,
    ]);
    return {
      source: 'PAYPAL_API',
      orderStatus: str(order?.status),
      authorizationStatus: str(authorization?.status),
      captureStatus: str(capture?.status),
    };
  }
}

// ---------------------------------------------------------------- simulated

const short = (kind: string, requestId: string) =>
  `SIM-${kind}-${createHash('sha256').update(requestId).digest('hex').slice(0, 12).toUpperCase()}`;

export class SimulatedPayPalRail implements PayPalRail {
  readonly mode = 'SIMULATED' as const;
  readonly requiresRedirect = false;

  async createAuthorizeOrder(args: RailCreateOrderArgs) {
    return { orderId: short('ORDER', args.requestId), approveUrl: null, status: 'APPROVED' };
  }
  async authorize(args: { requestId: string; paypalOrderId: string }) {
    return { authorizationId: short('AUTH', args.requestId), status: 'CREATED' };
  }
  async capture(args: { requestId: string }) {
    return { captureId: short('CAP', args.requestId), status: 'COMPLETED' };
  }
  async voidAuthorization() {
    return { status: 'VOIDED' };
  }
  async refund(args: { requestId: string }) {
    return { refundId: short('REF', args.requestId), status: 'COMPLETED' };
  }
  async addTracking() {
    return { status: 'TRACKING_RECORDED_LOCALLY' };
  }
  async inspect(args: {
    known: { authorizationStatus: string | null; captureStatus: string | null };
  }): Promise<RailInspection> {
    return {
      source: 'SIMULATED',
      orderStatus: null,
      authorizationStatus: args.known.authorizationStatus,
      captureStatus: args.known.captureStatus,
    };
  }
}
