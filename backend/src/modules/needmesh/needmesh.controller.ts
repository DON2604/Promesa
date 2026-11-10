import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AcknowledgeReceiptSchema,
  AuthorizeReturnSchema,
  MerchantActionSchema,
  type AcknowledgeReceiptRequest,
  type AuthorizeReturnRequest,
  type MerchantActionRequest,
} from '@promesa/contracts';
import { z } from 'zod';
import { AppError } from '../../common/errors';
import { sha256, stableStringify } from '../../common/hash';
import { ZodPipe, openApiSchema } from '../../common/zod';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma.service';
import {
  CorrelationId,
  CurrentPrincipal,
  type Principal,
  Public,
  RequireRoles,
} from '../identity/principal';
import { PAYPAL_GATEWAY } from '../paypal/paypal.controller';
import { PayPalGateway } from '../paypal/paypal-gateway';
import { NeedMeshService } from './needmesh.service';

@ApiTags('needmesh')
@Controller('v1/missions/:id')
export class NeedMeshController {
  constructor(private readonly needmesh: NeedMeshService) {}

  @Get('lifecycle')
  @ApiOperation({
    summary:
      'NeedMesh mission control: plan, per-merchant PayPal orders, agent timeline, budget and receipt.',
  })
  lifecycle(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.needmesh.lifecycle(principal, id);
  }

  @Post('agents/plan')
  @HttpCode(200)
  @RequireRoles('ORG_ADMIN', 'ORG_OPERATOR')
  @ApiOperation({
    summary:
      'Run the Mission Planner and Commerce Planner agents. Creates merchant orders; moves no money.',
  })
  plan(
    @CurrentPrincipal() principal: Principal,
    @CorrelationId() correlationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.needmesh.runAgents(principal, id, correlationId);
  }

  @Post('orders/:orderId/approve')
  @HttpCode(200)
  @RequireRoles('SPONSOR')
  @ApiOperation({
    summary:
      'Sponsor approves one merchant order. Creates a PayPal order (intent=AUTHORIZE); returns the PayPal approval URL when the Sandbox rail is active.',
  })
  approve(
    @CurrentPrincipal() principal: Principal,
    @CorrelationId() correlationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.needmesh.approveOrder(principal, id, orderId, correlationId);
  }

  @Post('orders/:orderId/authorize')
  @HttpCode(200)
  @RequireRoles('SPONSOR')
  @ApiOperation({ summary: 'Complete authorization after the sponsor returns from PayPal.' })
  @ApiBody({ schema: openApiSchema(AuthorizeReturnSchema) })
  authorize(
    @CurrentPrincipal() principal: Principal,
    @CorrelationId() correlationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body(new ZodPipe(AuthorizeReturnSchema)) body: AuthorizeReturnRequest,
  ) {
    return this.needmesh.authorizeReturn(principal, id, orderId, body.paypalOrderId, correlationId);
  }

  @Post('orders/:orderId/merchant')
  @HttpCode(200)
  @RequireRoles('SPONSOR', 'ORG_ADMIN', 'ORG_OPERATOR', 'MERCHANT_ADMIN', 'MERCHANT_OPERATOR')
  @ApiOperation({
    summary:
      'Merchant fulfilment update: confirm stock (agent captures), ship, report a stockout (Recovery agent), approve refund. Merchant users act on their own orders; org roles only through the DEMO_MODE simulated console.',
  })
  @ApiBody({ schema: openApiSchema(MerchantActionSchema) })
  merchant(
    @CurrentPrincipal() principal: Principal,
    @CorrelationId() correlationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body(new ZodPipe(MerchantActionSchema)) body: MerchantActionRequest,
  ) {
    return this.needmesh.merchantAction(principal, id, orderId, body, correlationId);
  }

  @Post('orders/:orderId/acknowledge')
  @HttpCode(200)
  @RequireRoles('ORG_ADMIN', 'ORG_OPERATOR')
  @ApiOperation({
    summary: 'The organization confirms what actually arrived. This is the delivery evidence.',
  })
  @ApiBody({ schema: openApiSchema(AcknowledgeReceiptSchema) })
  acknowledge(
    @CurrentPrincipal() principal: Principal,
    @CorrelationId() correlationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body(new ZodPipe(AcknowledgeReceiptSchema)) body: AcknowledgeReceiptRequest,
  ) {
    return this.needmesh.acknowledge(principal, id, orderId, body, correlationId);
  }

  @Post('reconcile')
  @HttpCode(200)
  @RequireRoles('ORG_ADMIN', 'ORG_OPERATOR', 'SPONSOR')
  @ApiOperation({
    summary:
      'Reconciliation agent: re-read PayPal state for every order and correct local records.',
  })
  reconcile(
    @CurrentPrincipal() principal: Principal,
    @CorrelationId() correlationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.needmesh.reconcile(principal, id, correlationId);
  }
}

const WebhookEventSchema = z
  .object({
    id: z.string().min(3).max(128),
    event_type: z.string().min(3).max(128),
    resource: z.record(z.unknown()).optional(),
  })
  .passthrough();

/**
 * PayPal webhook receiver. Unauthenticated by design (PayPal calls it), so every event is
 * signature-verified through PayPal's verify-webhook-signature API before it can touch state.
 * Duplicate event ids are ignored; PayPal state wins over local state.
 */
@ApiTags('paypal')
@Controller('v1/paypal')
export class PayPalWebhookController {
  constructor(
    private readonly needmesh: NeedMeshService,
    private readonly prisma: PrismaService,
    @Inject(PAYPAL_GATEWAY) private readonly gateway: PayPalGateway,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Post('webhooks')
  @HttpCode(200)
  @ApiOperation({ summary: 'Signature-verified PayPal webhook receiver.' })
  async receive(@Body() body: unknown, @Headers() headers: Record<string, string | undefined>) {
    if (!this.env.PAYPAL_WEBHOOK_ID || !this.gateway.configured)
      throw new AppError('WEBHOOKS_NOT_CONFIGURED', 'PayPal webhooks are not configured.', 503);
    const event = WebhookEventSchema.parse(body);
    const verified = await this.gateway.verifyWebhookSignature({
      webhookId: this.env.PAYPAL_WEBHOOK_ID,
      headers,
      event: body,
    });
    if (!verified)
      throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Signature verification failed.', 400);

    const existing = await this.prisma.payPalWebhookInbox.findUnique({
      where: { paypalEventId: event.id },
    });
    if (existing) return { received: true, duplicate: true };
    await this.prisma.payPalWebhookInbox.create({
      data: {
        paypalEventId: event.id,
        eventType: event.event_type,
        rawChecksum: sha256(stableStringify(body)),
        environment: this.env.PAYPAL_ENVIRONMENT,
        verifiedAt: new Date(),
        status: 'VERIFIED',
      },
    });
    const result = await this.needmesh.applyPayPalWebhook({
      id: event.id,
      event_type: event.event_type,
      resource: event.resource,
    });
    await this.prisma.payPalWebhookInbox.update({
      where: { paypalEventId: event.id },
      data: { processedAt: new Date(), status: result.matched ? 'PROCESSED' : 'IGNORED' },
    });
    return { received: true, matched: result.matched };
  }
}
