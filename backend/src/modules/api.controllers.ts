import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CompileIntentRequestSchema,
  CreateMissionRequestSchema,
  CreatePurchaseRequestSchema,
  type CompileIntentRequest,
  type CreateMissionRequest,
  type CreatePurchaseRequest,
} from '@promesa/contracts';
import { z } from 'zod';
import { ZodPipe, openApiSchema } from '../common/zod';
import {
  CorrelationId,
  CurrentPrincipal,
  type Principal,
  RequireRoles,
} from './identity/principal';
import { IntentService } from './intent/intent.service';
import { MissionsService } from './missions/missions.service';
import { PurchasesService } from './purchases/purchases.service';
import { TwinsService } from './promisetwin/twins.service';

@ApiTags('intent')
@Controller('v1/intent')
export class IntentController {
  constructor(private readonly intent: IntentService) {}

  @Post('compile')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Compile natural language into a draft intent. No financial side effects.',
  })
  @ApiBody({ schema: openApiSchema(CompileIntentRequestSchema) })
  compile(@Body(new ZodPipe(CompileIntentRequestSchema)) body: CompileIntentRequest) {
    return this.intent.compile(body);
  }
}

@ApiTags('purchases')
@Controller('v1/purchases')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Post()
  @RequireRoles('BUYER')
  @ApiOperation({ summary: 'Create a purchase from a confirmed intent; creates its PromiseTwin.' })
  @ApiBody({ schema: openApiSchema(CreatePurchaseRequestSchema) })
  create(
    @CurrentPrincipal() principal: Principal,
    @CorrelationId() correlationId: string,
    @Body(new ZodPipe(CreatePurchaseRequestSchema)) body: CreatePurchaseRequest,
  ) {
    return this.purchases.create(principal, body, correlationId);
  }

  @Get()
  list(@CurrentPrincipal() principal: Principal) {
    return this.purchases.list(principal);
  }

  @Get(':id')
  get(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchases.get(principal, id);
  }

  @Get(':id/offers')
  @ApiOperation({ summary: 'Source-attributed offers ranked by the deterministic solver.' })
  offers(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchases.offers(principal, id);
  }
}

@ApiTags('missions')
@Controller('v1/missions')
export class MissionsController {
  constructor(private readonly missions: MissionsService) {}

  @Post()
  @RequireRoles('ORG_ADMIN', 'ORG_OPERATOR')
  @ApiOperation({ summary: 'Create a NeedMesh mission with a confirmed, immutable intent.' })
  @ApiBody({ schema: openApiSchema(CreateMissionRequestSchema) })
  create(
    @CurrentPrincipal() principal: Principal,
    @CorrelationId() correlationId: string,
    @Body(new ZodPipe(CreateMissionRequestSchema)) body: CreateMissionRequest,
  ) {
    return this.missions.create(principal, body, correlationId);
  }

  @Get()
  list(@CurrentPrincipal() principal: Principal) {
    return this.missions.list(principal);
  }

  @Get(':id')
  get(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.missions.get(principal, id);
  }

  @Get(':id/offers')
  offers(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.missions.offers(principal, id);
  }
}

const SnapshotQuerySchema = z.object({
  cursor: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

@ApiTags('promisetwin')
@Controller('v1/twins')
export class TwinsController {
  constructor(private readonly twins: TwinsService) {}

  @Get()
  list(@CurrentPrincipal() principal: Principal) {
    return this.twins.list(principal);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'PromiseTwin with latest evaluation and first page of Promise Threads.',
  })
  detail(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.twins.detail(principal, id);
  }

  @Get(':id/evidence')
  evidence(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.twins.evidence(principal, id);
  }

  @Get(':id/threads')
  threads(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.twins.threads(principal, id);
  }

  @Get(':id/contrast')
  @ApiOperation({
    summary: 'Faultline: requested vs seller-committed vs observed, per hard constraint.',
  })
  contrast(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.twins.contrast(principal, id);
  }

  @Get(':id/health-breakdown')
  healthBreakdown(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.twins.healthBreakdown(principal, id);
  }

  @Get(':id/snapshots')
  @ApiOperation({ summary: 'Timefold: immutable snapshots in event order, cursor paginated.' })
  snapshots(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(SnapshotQuerySchema)) query: z.infer<typeof SnapshotQuerySchema>,
  ) {
    return this.twins.snapshots(principal, id, query.cursor ?? null, query.limit);
  }

  @Get(':id/snapshots/:snapshotId')
  snapshot(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('snapshotId', ParseUUIDPipe) snapshotId: string,
  ) {
    return this.twins.snapshot(principal, id, snapshotId);
  }

  @Post(':id/evaluate')
  @HttpCode(200)
  @RequireRoles('BUYER', 'ORG_ADMIN', 'ORG_OPERATOR', 'PLATFORM_SUPPORT')
  @ApiOperation({ summary: 'Re-evaluate the twin deterministically. No financial side effects.' })
  evaluate(
    @CurrentPrincipal() principal: Principal,
    @CorrelationId() correlationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.twins.evaluate(principal, id, correlationId);
  }
}
