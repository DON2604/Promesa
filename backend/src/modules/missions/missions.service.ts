import { Injectable } from '@nestjs/common';
import {
  type IntentSpec,
  type MissionDetail,
  type MissionState,
  type MissionSummary,
  type OffersResponse,
} from '@promesa/contracts';
import { type Mission, type Prisma } from '@prisma/client';
import { AppError } from '../../common/errors';
import { hashObject } from '../../common/hash';
import { PrismaService, type Tx } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CatalogService } from '../commerce/catalog.service';
import { resolveClock } from '../demo/clock';
import { OutboxService } from '../events/outbox.service';
import { type Principal } from '../identity/principal';
import { validateIntent } from '../intent/intent-validation';
import { type Actor } from '../promisetwin/twin-engine';
import { toIntentView } from '../promisetwin/views';

export type CreateMissionInput = {
  orgTenantId: string;
  createdBy: string;
  title: string;
  rawText: string;
  spec: IntentSpec;
  compilerVersion: string;
  ids?: { mission?: string; intent?: string };
  scenarioKey?: string;
  isDemo?: boolean;
  confirmedAt?: Date;
};

@Injectable()
export class MissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
  ) {}

  async createInTx(tx: Tx, input: CreateMissionInput, actor: Actor) {
    const confirmedAt = input.confirmedAt ?? new Date();
    const mission = await tx.mission.create({
      data: {
        id: input.ids?.mission,
        orgTenantId: input.orgTenantId,
        createdBy: input.createdBy,
        title: input.title,
        currency: input.spec.currency,
        budgetMinor: BigInt(input.spec.budgetMinor),
        state: 'INTENT_CONFIRMED',
        deadline: new Date(input.spec.deadlineISO),
        timezone: input.spec.timezone,
        isDemo: input.isDemo ?? false,
        scenarioKey: input.scenarioKey,
      },
    });
    await tx.intent.create({
      data: {
        id: input.ids?.intent,
        missionId: mission.id,
        buyerTenantId: input.orgTenantId,
        createdBy: input.createdBy,
        rawText: input.rawText,
        compiledJson: input.spec as unknown as Prisma.InputJsonValue,
        confirmedSnapshotJson: input.spec as unknown as Prisma.InputJsonValue,
        snapshotHash: hashObject(input.spec),
        confirmedAt,
        compilerVersion: input.compilerVersion,
      },
    });
    await this.outbox.append(tx, {
      tenantId: input.orgTenantId,
      aggregateType: 'mission',
      aggregateId: mission.id,
      version: mission.version,
      eventType: 'mission.created',
      payload: { missionId: mission.id, state: mission.state },
      isSimulated: input.isDemo,
    });
    await this.audit.record(tx, {
      tenantId: input.orgTenantId,
      actorType: actor.type,
      actorId: actor.id,
      action: 'mission.create',
      resourceType: 'mission',
      resourceId: mission.id,
      after: { state: mission.state, intentHash: hashObject(input.spec) },
      correlationId: actor.correlationId,
    });
    return mission;
  }

  async create(
    principal: Principal,
    body: { title: string; rawText: string; intent: IntentSpec; compilerVersion: string },
    correlationId: string,
  ) {
    if (principal.tenantKind !== 'ORG')
      throw AppError.forbidden('Missions are created by organizations.');
    const validation = validateIntent(body.intent, new Date());
    if (!validation.ok)
      throw new AppError('INTENT_INVALID', 'The intent failed validation.', 422, validation.issues);
    const mission = await this.prisma.$transaction(
      (tx) =>
        this.createInTx(
          tx,
          {
            orgTenantId: principal.tenantId,
            createdBy: principal.userId,
            title: body.title,
            rawText: body.rawText,
            spec: validation.spec,
            compilerVersion: body.compilerVersion,
          },
          { type: 'USER', id: principal.userId, correlationId },
        ),
      { timeout: 20_000 },
    );
    return { missionId: mission.id };
  }

  async list(principal: Principal): Promise<MissionSummary[]> {
    const rows = await this.prisma.mission.findMany({
      where: {
        OR: [
          { orgTenantId: principal.tenantId },
          { orders: { some: { sponsorTenantId: principal.tenantId } } },
          { orders: { some: { merchantTenantId: principal.tenantId } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map(toSummary);
  }

  async get(principal: Principal, id: string): Promise<MissionDetail> {
    const mission = await this.prisma.mission.findFirst({
      where: {
        id,
        OR: [
          { orgTenantId: principal.tenantId },
          { visibility: 'PUBLIC' },
          { orders: { some: { sponsorTenantId: principal.tenantId } } },
          { orders: { some: { merchantTenantId: principal.tenantId } } },
        ],
      },
      include: { intents: { orderBy: { createdAt: 'asc' }, take: 1 } },
    });
    const intent = mission?.intents[0];
    if (!mission || !intent) throw AppError.notFound('Mission');
    const clock = await resolveClock(this.prisma, mission.scenarioKey);
    const view = toIntentView(intent);
    const own = mission.orgTenantId === principal.tenantId;
    return {
      schemaVersion: 1,
      aggregateVersion: mission.version,
      asOf: clock.now.toISOString(),
      simulationMode: mission.isDemo,
      ...toSummary(mission),
      // The organization's own wording may name beneficiaries or places; outsiders see the public summary.
      intent: own
        ? view
        : { ...view, rawText: mission.publicSummary ?? 'Shared by the requesting organization.' },
    };
  }

  async offers(principal: Principal, id: string): Promise<OffersResponse> {
    const detail = await this.get(principal, id);
    const mission = await this.prisma.mission.findUniqueOrThrow({ where: { id } });
    const clock = await resolveClock(this.prisma, mission.scenarioKey);
    return this.catalog.offersFor(detail.intent.spec, clock.now, mission.version, clock.simulated);
  }
}

function toSummary(m: Mission): MissionSummary {
  return {
    id: m.id,
    title: m.title,
    state: m.state as MissionState,
    budgetMinor: m.budgetMinor.toString(),
    currency: m.currency,
    deadline: m.deadline.toISOString(),
    timezone: m.timezone,
    isDemo: m.isDemo,
    createdAt: m.createdAt.toISOString(),
  };
}
