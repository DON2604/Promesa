import { connect } from 'node:net';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type DashboardView, type StreamEvent, type TwinHealth } from '@promesa/contracts';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../common/zod';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../infra/prisma.service';
import { DemoService } from './demo/demo.service';
import {
  type AuthedRequest,
  CorrelationId,
  CurrentPrincipal,
  type Principal,
  Public,
} from './identity/principal';
import { MissionsService } from './missions/missions.service';
import { PurchasesService } from './purchases/purchases.service';
import { TwinsService } from './promisetwin/twins.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply) {
    let database: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch {
      database = 'down';
    }
    const redis = this.env.REDIS_URL ? await probeTcp(this.env.REDIS_URL) : 'not_configured';
    const ready = database === 'up';
    void reply.status(ready ? 200 : 503);
    return { status: ready ? 'ready' : 'not_ready', database, redis, demoMode: this.env.DEMO_MODE };
  }
}

function probeTcp(url: string): Promise<'up' | 'down'> {
  return new Promise((resolve) => {
    const { hostname, port } = new URL(url);
    const socket = connect({ host: hostname, port: Number(port || 6379), timeout: 500 });
    socket.once('connect', () => (socket.destroy(), resolve('up')));
    socket.once('error', () => resolve('down'));
    socket.once('timeout', () => (socket.destroy(), resolve('down')));
  });
}

@ApiTags('operations')
@Controller('v1/operations')
export class OperationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly purchases: PurchasesService,
    private readonly missions: MissionsService,
    private readonly twins: TwinsService,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: 'Tenant-scoped dashboard aggregates with recent outbox activity.' })
  async summary(@CurrentPrincipal() principal: Principal): Promise<DashboardView> {
    const [purchases, missions, twins, events] = await Promise.all([
      this.purchases.list(principal),
      this.missions.list(principal),
      this.twins.list(principal),
      this.prisma.outboxEvent.findMany({
        where: { tenantId: principal.tenantId },
        orderBy: { seq: 'desc' },
        take: 12,
      }),
    ]);
    const count = (h: TwinHealth) => twins.filter((t) => t.health === h).length;
    return {
      schemaVersion: 1,
      aggregateVersion: events[0]?.seq ?? 0,
      asOf: new Date().toISOString(),
      simulationMode: [...purchases, ...missions].some((x) => x.isDemo),
      purchases,
      missions,
      twins,
      counts: {
        activeMissions: missions.filter(
          (m) => !['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(m.state),
        ).length,
        twinsAtRisk: count('AT_RISK'),
        twinsBreached: count('BREACHED'),
        awaitingPayment: purchases.filter((p) =>
          ['PLANNED', 'QUOTE_CONFIRMED', 'ORDER_CREATED', 'AWAITING_BUYER_APPROVAL'].includes(
            p.state,
          ),
        ).length,
      },
      recentActivity: events.map((e) => ({
        id: e.id,
        label: e.eventType,
        occurredAt: e.createdAt.toISOString(),
        aggregateType: e.aggregateType,
        aggregateId: e.aggregateId,
        simulated: e.isSimulated,
      })),
    };
  }
}

/**
 * Tenant-filtered SSE backed by the persisted outbox. Reconnects resume from Last-Event-ID,
 * so a dropped stream never loses or duplicates business events. Financial state never depends on it.
 */
@ApiTags('events')
@Controller('v1')
export class StreamController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('stream')
  @ApiExcludeEndpoint()
  async stream(@Req() req: AuthedRequest, @Res() reply: FastifyReply) {
    const principal = req.principal!;
    const header = req.headers['last-event-id'];
    const queryCursor = (req.query as Record<string, string | undefined>).lastEventId;
    let cursor = Number(header ?? queryCursor ?? NaN);
    if (!Number.isFinite(cursor)) {
      const latest = await this.prisma.outboxEvent.findFirst({
        where: { tenantId: principal.tenantId },
        orderBy: { seq: 'desc' },
      });
      cursor = latest?.seq ?? 0;
    }
    const origin = req.headers.origin;
    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    };
    if (origin && this.env.ALLOWED_ORIGINS.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Credentials'] = 'true';
      headers.Vary = 'Origin';
    }
    reply.hijack();
    reply.raw.writeHead(200, headers);
    reply.raw.write('retry: 3000\n\n');

    let closed = false;
    const tick = async () => {
      if (closed) return;
      try {
        const events = await this.prisma.outboxEvent.findMany({
          where: { tenantId: principal.tenantId, seq: { gt: cursor } },
          orderBy: { seq: 'asc' },
          take: 100,
        });
        for (const e of events) {
          const payload: StreamEvent = {
            seq: e.seq,
            type: e.eventType,
            aggregateType: e.aggregateType,
            aggregateId: e.aggregateId,
            version: e.version,
            occurredAt: e.createdAt.toISOString(),
            simulated: e.isSimulated,
          };
          reply.raw.write(`id: ${e.seq}\ndata: ${JSON.stringify(payload)}\n\n`);
          cursor = e.seq;
        }
        if (events.length === 0) reply.raw.write(': keep-alive\n\n');
      } catch {
        reply.raw.write(': backend-degraded\n\n');
      }
    };
    const timer = setInterval(() => void tick(), 1500);
    void tick();
    req.raw.on('close', () => {
      closed = true;
      clearInterval(timer);
    });
  }
}

const AdvanceSchema = z.object({ checkpoint: z.string().min(1).max(64) });

@ApiTags('demo')
@Controller('v1/demo/scenarios')
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Get()
  @ApiOperation({ summary: 'Demo scenarios visible to the active tenant (DEMO_MODE only).' })
  list(@CurrentPrincipal() principal: Principal) {
    return this.demo.list(principal);
  }

  @Post(':key/clock')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Advance the scenario-scoped simulated clock to a checkpoint, then re-evaluate.',
  })
  advance(
    @CurrentPrincipal() principal: Principal,
    @CorrelationId() correlationId: string,
    @Param('key') key: string,
    @Body(new ZodPipe(AdvanceSchema)) body: z.infer<typeof AdvanceSchema>,
  ) {
    return this.demo.advance(principal, key, body.checkpoint, correlationId);
  }

  @Post(':key/reset')
  @HttpCode(200)
  reset(
    @CurrentPrincipal() principal: Principal,
    @CorrelationId() correlationId: string,
    @Param('key') key: string,
  ) {
    return this.demo.reset(principal, key, correlationId);
  }
}
