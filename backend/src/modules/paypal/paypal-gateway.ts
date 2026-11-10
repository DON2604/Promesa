import { minorToMajorString } from '@promesa/contracts';
import { AppError } from '../../common/errors';

/**
 * Server-side PayPal REST gateway (Orders v2, Payments v2, Webhooks, OAuth client credentials).
 * Endpoints follow https://developer.paypal.com/api/rest/ — no undocumented calls.
 * Financial writes require ENABLE_LIVE_PAYPAL_WRITES and are only reachable through the
 * policy-gated FinancialActionService (Phase 2+). Tokens never leave this class.
 */
export type PayPalGatewayConfig = {
  environment: 'sandbox' | 'live';
  clientId?: string;
  clientSecret?: string;
  liveWritesEnabled: boolean;
  timeoutMs?: number;
};

export type PayPalOrderResult = {
  id: string;
  status: string;
  links?: Array<{ href: string; rel: string }>;
};

const BASE_URLS = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
} as const;

export class PayPalGateway {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: PayPalGatewayConfig) {}

  get configured(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret);
  }

  get baseUrl(): string {
    return BASE_URLS[this.config.environment];
  }

  async getAccessToken(): Promise<string> {
    if (!this.configured)
      throw new AppError('PAYPAL_NOT_CONFIGURED', 'PayPal credentials are not configured.', 503);
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      'base64',
    );
    const response = await this.fetchWithTimeout(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!response.ok) {
      throw new AppError(
        'PAYPAL_AUTH_FAILED',
        `PayPal OAuth returned HTTP ${response.status}.`,
        502,
      );
    }
    const json = (await response.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  async createOrder(args: {
    requestId: string;
    referenceId: string;
    amountMinor: bigint;
    currency: string;
    description: string;
    /** CAPTURE (default) charges on approval. AUTHORIZE reserves funds until the merchant captures or voids. */
    intent?: 'CAPTURE' | 'AUTHORIZE';
    customId?: string;
    /** When set, the buyer approves via PayPal's redirect flow and returns to these URLs. */
    experience?: { returnUrl: string; cancelUrl: string; brandName: string };
  }): Promise<PayPalOrderResult> {
    this.assertWritesEnabled();
    const body: Record<string, unknown> = {
      intent: args.intent ?? 'CAPTURE',
      purchase_units: [
        {
          reference_id: args.referenceId.slice(0, 127),
          ...(args.customId ? { custom_id: args.customId.slice(0, 127) } : {}),
          description: args.description.slice(0, 127),
          amount: {
            currency_code: args.currency,
            value: minorToMajorString(args.amountMinor, args.currency),
          },
        },
      ],
    };
    if (args.experience) {
      body.payment_source = {
        paypal: {
          experience_context: {
            return_url: args.experience.returnUrl,
            cancel_url: args.experience.cancelUrl,
            brand_name: args.experience.brandName.slice(0, 127),
            shipping_preference: 'NO_SHIPPING',
            user_action: 'PAY_NOW',
            landing_page: 'LOGIN',
          },
        },
      };
    }
    return this.request<PayPalOrderResult>('POST', '/v2/checkout/orders', args.requestId, body);
  }

  async captureOrder(orderId: string, requestId: string) {
    this.assertWritesEnabled();
    return this.request<Record<string, unknown>>(
      'POST',
      `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      requestId,
      {},
    );
  }

  /** Authorizes an APPROVED order (intent=AUTHORIZE). Funds are reserved, not yet captured. */
  async authorizeOrder(orderId: string, requestId: string) {
    this.assertWritesEnabled();
    return this.request<Record<string, unknown>>(
      'POST',
      `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`,
      requestId,
      {},
    );
  }

  async captureAuthorization(authorizationId: string, requestId: string, note?: string) {
    this.assertWritesEnabled();
    return this.request<Record<string, unknown>>(
      'POST',
      `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,
      requestId,
      { final_capture: true, ...(note ? { note_to_payer: note.slice(0, 255) } : {}) },
    );
  }

  /** Releases an uncaptured authorization. PayPal answers 204 with no body. */
  async voidAuthorization(authorizationId: string, requestId: string) {
    this.assertWritesEnabled();
    return this.request<Record<string, unknown>>(
      'POST',
      `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`,
      requestId,
      undefined,
    );
  }

  async getAuthorization(authorizationId: string) {
    return this.request<Record<string, unknown>>(
      'GET',
      `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`,
    );
  }

  async getCapture(captureId: string) {
    return this.request<Record<string, unknown>>(
      'GET',
      `/v2/payments/captures/${encodeURIComponent(captureId)}`,
    );
  }

  /** Attaches shipment tracking to a captured transaction (Add Tracking API). */
  async addTracking(args: {
    captureId: string;
    trackingNumber: string;
    carrierName: string;
    requestId: string;
  }) {
    this.assertWritesEnabled();
    return this.request<Record<string, unknown>>(
      'POST',
      '/v1/shipping/trackers-batch',
      args.requestId,
      {
        trackers: [
          {
            transaction_id: args.captureId,
            tracking_number: args.trackingNumber,
            status: 'SHIPPED',
            carrier: 'OTHER',
            carrier_name_other: args.carrierName.slice(0, 64),
          },
        ],
      },
    );
  }

  async getOrder(orderId: string) {
    return this.request<Record<string, unknown>>(
      'GET',
      `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
    );
  }

  async refundCapture(
    captureId: string,
    requestId: string,
    amount?: { minor: bigint; currency: string },
  ) {
    this.assertWritesEnabled();
    return this.request<Record<string, unknown>>(
      'POST',
      `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
      requestId,
      amount
        ? {
            amount: {
              value: minorToMajorString(amount.minor, amount.currency),
              currency_code: amount.currency,
            },
          }
        : {},
    );
  }

  async verifyWebhookSignature(args: {
    webhookId: string;
    headers: Record<string, string | undefined>;
    event: unknown;
  }) {
    const body = {
      auth_algo: args.headers['paypal-auth-algo'],
      cert_url: args.headers['paypal-cert-url'],
      transmission_id: args.headers['paypal-transmission-id'],
      transmission_sig: args.headers['paypal-transmission-sig'],
      transmission_time: args.headers['paypal-transmission-time'],
      webhook_id: args.webhookId,
      webhook_event: args.event,
    };
    const result = await this.request<{ verification_status: string }>(
      'POST',
      '/v1/notifications/verify-webhook-signature',
      undefined,
      body,
    );
    return result.verification_status === 'SUCCESS';
  }

  private assertWritesEnabled() {
    if (!this.config.liveWritesEnabled) {
      throw new AppError(
        'LIVE_WRITES_DISABLED',
        'PayPal writes are disabled (ENABLE_LIVE_PAYPAL_WRITES=false).',
        503,
      );
    }
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    requestId?: string,
    body?: unknown,
  ): Promise<T> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    if (requestId) headers['PayPal-Request-Id'] = requestId;
    const response = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new AppError(
        'PAYPAL_API_ERROR',
        `PayPal returned HTTP ${response.status}.`,
        response.status >= 500 ? 502 : 422,
        {
          name: json.name,
          debugId: json.debug_id,
        },
      );
    }
    return json as T;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
      });
    } catch (error) {
      // A timeout on a write is UNKNOWN, never a failure to retry blindly; callers reconcile by request ID.
      throw new AppError(
        'PAYPAL_UNREACHABLE',
        'PayPal could not be reached; state must be reconciled.',
        504,
        {
          cause: error instanceof Error ? error.name : 'unknown',
        },
      );
    }
  }
}
