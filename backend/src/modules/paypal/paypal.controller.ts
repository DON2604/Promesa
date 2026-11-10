import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type PayPalHealth } from '@promesa/contracts';
import { ENV, type Env } from '../../config/env';
import { Public } from '../identity/principal';
import { PayPalGateway } from './paypal-gateway';
import { PAYPAL_MCP, type PayPalMcpAdapter } from './paypal-mcp.adapter';

export const PAYPAL_GATEWAY = Symbol('PAYPAL_GATEWAY');

@ApiTags('integrations')
@Controller('v1/integrations/paypal')
export class PayPalController {
  private cache: { at: number; value: PayPalHealth } | null = null;

  constructor(
    @Inject(PAYPAL_GATEWAY) private readonly gateway: PayPalGateway,
    @Inject(ENV) private readonly env: Env,
    @Inject(PAYPAL_MCP) private readonly mcp: PayPalMcpAdapter,
  ) {}

  @Public()
  @Get('health')
  @ApiOperation({
    summary:
      'Truthful PayPal capability status. Performs a real OAuth check when credentials exist.',
  })
  async health(): Promise<PayPalHealth> {
    if (this.cache && Date.now() - this.cache.at < 60_000) return this.cache.value;
    const checkedAt = new Date().toISOString();
    let restApi: PayPalHealth['restApi'];
    if (!this.gateway.configured) {
      restApi = {
        status: 'NOT_CONFIGURED',
        checkedAt,
        detail: 'PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set. No PayPal calls are made.',
      };
    } else {
      try {
        await this.gateway.getAccessToken();
        restApi = {
          status: 'OK',
          checkedAt,
          detail: `OAuth client-credentials succeeded against ${this.gateway.baseUrl}.`,
        };
      } catch (error) {
        restApi = {
          status: 'ERROR',
          checkedAt,
          detail: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
    // Only probe MCP once REST OAuth works; this starts the official @paypal/mcp stdio server.
    const mcp = restApi.status === 'OK' ? await this.mcp.status() : this.mcp.peek();
    const value: PayPalHealth = {
      environment: this.env.PAYPAL_ENVIRONMENT,
      restApi,
      mcp,
      webhooks: this.env.PAYPAL_WEBHOOK_ID
        ? {
            status: 'CONFIGURED',
            detail:
              'Webhook ID configured. POST /v1/paypal/webhooks verifies every event signature with PayPal before it can change state.',
          }
        : { status: 'NOT_CONFIGURED', detail: 'PAYPAL_WEBHOOK_ID is not set.' },
      liveWritesEnabled: this.env.ENABLE_LIVE_PAYPAL_WRITES,
    };
    this.cache = { at: Date.now(), value };
    return value;
  }
}
