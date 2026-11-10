import { afterEach, describe, expect, it, vi } from 'vitest';
import { PayPalGateway } from '../paypal/paypal-gateway';
import { extractOrderStatus } from '../paypal/paypal-mcp.adapter';
import { SandboxPayPalRail, SimulatedPayPalRail } from './paypal-rail';

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function mockPayPal(routes: Record<string, { status?: number; json?: unknown }>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      const method = init.method ?? 'GET';
      if (path === '/v1/oauth2/token')
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), {
          status: 200,
        });
      calls.push({
        url: path,
        method,
        headers: init.headers as Record<string, string>,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      const hit = routes[`${method} ${path}`] ?? routes[path];
      if (!hit) return new Response('{}', { status: 404 });
      return new Response(hit.json === undefined ? null : JSON.stringify(hit.json), {
        status: hit.status ?? 200,
      });
    }),
  );
  return calls;
}

const gateway = () =>
  new PayPalGateway({
    environment: 'sandbox',
    clientId: 'id',
    clientSecret: 'secret',
    liveWritesEnabled: true,
  });

afterEach(() => vi.unstubAllGlobals());

describe('SandboxPayPalRail', () => {
  it('creates an AUTHORIZE order with a stable PayPal-Request-Id and returns the payer-action URL', async () => {
    const calls = mockPayPal({
      'POST /v2/checkout/orders': {
        json: {
          id: 'ORDER123',
          status: 'PAYER_ACTION_REQUIRED',
          links: [
            { rel: 'payer-action', href: 'https://sandbox.paypal.com/checkoutnow?token=ORDER123' },
          ],
        },
      },
    });
    const rail = new SandboxPayPalRail(gateway());
    const result = await rail.createAuthorizeOrder({
      requestId: 'nm-1-create',
      referenceId: 'nm-1',
      customId: 'row-1',
      description: 'NeedMesh test',
      amountMinor: 10_000n,
      currency: 'USD',
      returnUrl: 'http://localhost:3000/ok',
      cancelUrl: 'http://localhost:3000/cancel',
    });
    expect(result).toMatchObject({ orderId: 'ORDER123' });
    expect(result.approveUrl).toContain('token=ORDER123');
    const create = calls.find((c) => c.url === '/v2/checkout/orders')!;
    expect(create.headers['PayPal-Request-Id']).toBe('nm-1-create');
    const body = create.body as {
      intent: string;
      purchase_units: Array<{ amount: { value: string }; custom_id: string }>;
    };
    expect(body.intent).toBe('AUTHORIZE');
    expect(body.purchase_units[0]!.amount.value).toBe('100.00');
    expect(body.purchase_units[0]!.custom_id).toBe('row-1');
  });

  it('authorizes, captures the authorization and voids through the documented endpoints', async () => {
    const calls = mockPayPal({
      'POST /v2/checkout/orders/ORDER123/authorize': {
        json: {
          status: 'COMPLETED',
          purchase_units: [{ payments: { authorizations: [{ id: 'AUTH1', status: 'CREATED' }] } }],
        },
      },
      'POST /v2/payments/authorizations/AUTH1/capture': {
        json: { id: 'CAP1', status: 'COMPLETED' },
      },
      'POST /v2/payments/authorizations/AUTH1/void': { status: 204 },
    });
    const rail = new SandboxPayPalRail(gateway());
    expect(await rail.authorize({ requestId: 'r1', paypalOrderId: 'ORDER123' })).toEqual({
      authorizationId: 'AUTH1',
      status: 'CREATED',
    });
    expect(await rail.capture({ requestId: 'r2', authorizationId: 'AUTH1' })).toEqual({
      captureId: 'CAP1',
      status: 'COMPLETED',
    });
    expect(await rail.voidAuthorization({ requestId: 'r3', authorizationId: 'AUTH1' })).toEqual({
      status: 'VOIDED',
    });
    expect(calls.map((c) => c.url)).toEqual(
      expect.arrayContaining([
        '/v2/checkout/orders/ORDER123/authorize',
        '/v2/payments/authorizations/AUTH1/capture',
        '/v2/payments/authorizations/AUTH1/void',
      ]),
    );
  });

  it('refuses to treat an order without an authorization as authorized', async () => {
    mockPayPal({
      'POST /v2/checkout/orders/ORDER9/authorize': {
        json: { status: 'CREATED', purchase_units: [] },
      },
    });
    await expect(
      new SandboxPayPalRail(gateway()).authorize({ requestId: 'r', paypalOrderId: 'ORDER9' }),
    ).rejects.toMatchObject({ code: 'PAYPAL_AUTHORIZATION_MISSING' });
  });

  it('reads actual authorization and capture status when inspecting', async () => {
    mockPayPal({
      'GET /v2/checkout/orders/ORDER123': { json: { status: 'COMPLETED' } },
      'GET /v2/payments/authorizations/AUTH1': { json: { status: 'VOIDED' } },
    });
    const view = await new SandboxPayPalRail(gateway()).inspect({
      orderId: 'ORDER123',
      authorizationId: 'AUTH1',
      captureId: null,
    });
    expect(view).toEqual({
      source: 'PAYPAL_API',
      orderStatus: 'COMPLETED',
      authorizationStatus: 'VOIDED',
      captureStatus: null,
    });
  });

  it('blocks writes when ENABLE_LIVE_PAYPAL_WRITES is off', async () => {
    mockPayPal({});
    const off = new PayPalGateway({
      environment: 'sandbox',
      clientId: 'id',
      clientSecret: 's',
      liveWritesEnabled: false,
    });
    await expect(
      new SandboxPayPalRail(off).capture({ requestId: 'r', authorizationId: 'A' }),
    ).rejects.toMatchObject({ code: 'LIVE_WRITES_DISABLED' });
  });
});

describe('SimulatedPayPalRail', () => {
  it('never returns an identifier that could be mistaken for a PayPal id', async () => {
    const rail = new SimulatedPayPalRail();
    const order = await rail.createAuthorizeOrder({
      requestId: 'a',
      referenceId: 'a',
      customId: 'a',
      description: 'x',
      amountMinor: 100n,
      currency: 'USD',
      returnUrl: '',
      cancelUrl: '',
    });
    const auth = await rail.authorize({ requestId: 'b', paypalOrderId: order.orderId });
    const cap = await rail.capture({ requestId: 'c' });
    expect(
      [order.orderId, auth.authorizationId, cap.captureId].every((id) => id.startsWith('SIM-')),
    ).toBe(true);
    expect(rail.requiresRedirect).toBe(false);
  });

  it('is deterministic per request id so retries cannot double-execute', async () => {
    const rail = new SimulatedPayPalRail();
    expect((await rail.capture({ requestId: 'same' })).captureId).toBe(
      (await rail.capture({ requestId: 'same' })).captureId,
    );
  });
});

describe('extractOrderStatus', () => {
  it('reads the status from MCP JSON text, with a tolerant fallback', () => {
    expect(extractOrderStatus('{"id":"X","status":"APPROVED"}')).toBe('APPROVED');
    expect(extractOrderStatus('Order: {"status": "COMPLETED", broken')).toBe('COMPLETED');
    expect(extractOrderStatus('nothing')).toBeNull();
  });
});
