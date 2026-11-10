import { Inject, Injectable } from '@nestjs/common';
import { type DemoScenarioView, type IntentSpec } from '@promesa/contracts';
import { type Prisma } from '@prisma/client';
import { AppError } from '../../common/errors';
import { hashObject } from '../../common/hash';
import { ENV, type Env } from '../../config/env';
import { PrismaService, type Tx } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../events/outbox.service';
import { type Principal } from '../identity/principal';
import { parseIntent, PARSER_VERSION } from '../intent/intent-parser';
import { validateIntent } from '../intent/intent-validation';
import { MissionsService } from '../missions/missions.service';
import { PurchasesService } from '../purchases/purchases.service';
import { type AcceptedTerms, type Actor, TwinEngine } from '../promisetwin/twin-engine';
import {
  BAKERY_REQUEST,
  BAKERY_TIMELINE,
  CATALOG,
  IDS,
  PERSONAS,
  SCENARIOS,
  SHELTER_HISTORY,
  SHELTER_PUBLIC_SUMMARY,
  SHELTER_REQUEST,
  SHELTER_TIMELINE,
  TENANT_PROFILES,
  TENANTS,
} from './fixtures';
import { computeQuoteHash } from '../needmesh/mission-state';

type Checkpoint = { key: string; label: string; at: string };

const BAKERY_CHECKPOINTS: Checkpoint[] = [
  {
    key: 'ETA_REVISED',
    label: 'Merchant revises the estimate to Monday',
    at: BAKERY_TIMELINE.seededClock,
  },
  {
    key: 'AFTER_DEADLINE',
    label: 'Friday 17:00 passes with no delivery',
    at: BAKERY_TIMELINE.afterDeadline,
  },
];

@Injectable()
export class DemoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly purchases: PurchasesService,
    private readonly missions: MissionsService,
    private readonly engine: TwinEngine,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private actor(correlationId: string): Actor {
    return { type: 'DEMO_SIMULATOR', id: 'demo-fixtures', correlationId };
  }

  /** Idempotent: tenants, personas, memberships, merchant placeholders and the fictional catalog. */
  async ensureBaseData() {
    for (const t of TENANTS) {
      const profile = TENANT_PROFILES[t.id];
      const trust = profile
        ? {
            verifiedAt: profile.verified ? new Date('2026-11-01T10:00:00-04:00') : null,
            verificationMethod: profile.verified ? 'DEMO_REVIEW' : null,
            verificationNote: profile.verified?.note ?? null,
            publicProfileJson: (profile.publicProfile ?? undefined) as
              Prisma.InputJsonValue | undefined,
            preferencesJson: (profile.preferences ?? undefined) as
              Prisma.InputJsonValue | undefined,
          }
        : {};
      await this.prisma.tenant.upsert({
        where: { id: t.id },
        create: { ...t, isDemo: true, ...trust },
        update: { name: t.name, kind: t.kind, timezone: t.timezone, isDemo: true, ...trust },
      });
    }
    for (const p of PERSONAS) {
      await this.prisma.user.upsert({
        where: { id: p.userId },
        create: {
          id: p.userId,
          authSubject: `demo|${p.key}`,
          email: p.email,
          displayName: p.displayName,
          verifiedAt: new Date(),
        },
        update: { displayName: p.displayName, email: p.email },
      });
      for (const m of p.memberships) {
        await this.prisma.membership.upsert({
          where: { userId_tenantId_role: { userId: p.userId, tenantId: m.tenantId, role: m.role } },
          create: { userId: p.userId, tenantId: m.tenantId, role: m.role },
          update: {},
        });
      }
    }
    // Merchant connection placeholders: NOT_CONNECTED until real Sandbox credentials are linked (Phase 2).
    for (const tenantId of [
      IDS.tenants.kraftfold,
      IDS.tenants.cleanStart,
      IDS.tenants.beaconBasics,
    ]) {
      const existing = await this.prisma.merchantConnection.findFirst({ where: { tenantId } });
      if (!existing) {
        await this.prisma.merchantConnection.create({
          data: { tenantId, environment: 'sandbox', status: 'NOT_CONNECTED', permissions: [] },
        });
      }
    }
    const verifiedAt = new Date('2026-11-09T08:00:00-05:00');
    for (const c of CATALOG) {
      const data = {
        sellerTenantId: c.sellerTenantId,
        source: 'DEMO_FIXTURE',
        sourceExternalId: c.sku,
        sku: c.sku,
        title: c.title,
        productKind: c.productKind,
        attributes: c.attributes,
        unitPriceMinor: c.unitPriceMinor,
        currency: 'USD',
        inventoryQty: c.inventoryQty,
        leadTimeHours: c.leadTimeHours,
        deliveryTerms: c.deliveryTerms,
        lastVerifiedAt: verifiedAt,
        isDemo: true,
      };
      await this.prisma.catalogProduct.upsert({
        where: { id: c.id },
        create: { id: c.id, ...data },
        update: data,
      });
    }
  }

  private async deleteBakery(tx: Tx) {
    const twinId = IDS.bakery.twin;
    await tx.constraintEvaluation.deleteMany({ where: { evaluation: { twinId } } });
    await tx.twinEvaluation.deleteMany({ where: { twinId } });
    await tx.twinSnapshot.deleteMany({ where: { twinId } });
    await tx.evidence.deleteMany({ where: { twinId } });
    await tx.incident.deleteMany({ where: { twinId } });
    await tx.promiseTwin.deleteMany({ where: { id: twinId } });
    await tx.fulfillment.deleteMany({ where: { purchaseId: IDS.bakery.purchase } });
    await tx.purchase.deleteMany({ where: { id: IDS.bakery.purchase } });
    await tx.sellerCommitment.deleteMany({ where: { id: IDS.bakery.commitment } });
    await tx.offer.deleteMany({ where: { id: IDS.bakery.offer } });
    await tx.intent.deleteMany({ where: { id: IDS.bakery.intent } });
  }

  private compileFixture(raw: string, at: string, timezone: string): IntentSpec {
    const parsed = parseIntent(raw, { now: new Date(at), timezone });
    const v = validateIntent(parsed.draft, new Date(at));
    if (!v.ok) throw new Error(`Fixture intent invalid: ${v.issues.join('; ')}`);
    return v.spec;
  }

  async buildBakery(correlationId = 'seed') {
    const actor = this.actor(correlationId);
    const t = BAKERY_TIMELINE;
    const spec = this.compileFixture(BAKERY_REQUEST, t.intentConfirmedAt, 'America/New_York');
    await this.prisma.$transaction(
      async (tx) => {
        await this.deleteBakery(tx);
        await tx.demoClock.upsert({
          where: { scenarioKey: SCENARIOS.bakery },
          create: {
            scenarioKey: SCENARIOS.bakery,
            tenantId: IDS.tenants.bakery,
            simulatedNow: new Date(t.intentConfirmedAt),
          },
          update: { simulatedNow: new Date(t.intentConfirmedAt) },
        });

        // 1. Buyer confirms intent → PromiseTwin exists, nothing promised yet.
        await this.purchases.createWithTwin(
          tx,
          {
            buyerTenantId: IDS.tenants.bakery,
            payerUserId: IDS.users.maya,
            rawText: BAKERY_REQUEST,
            spec,
            compilerVersion: PARSER_VERSION,
            ids: {
              intent: IDS.bakery.intent,
              purchase: IDS.bakery.purchase,
              twin: IDS.bakery.twin,
            },
            scenarioKey: SCENARIOS.bakery,
            isDemo: true,
            confirmedAt: new Date(t.intentConfirmedAt),
          },
          actor,
        );
        await this.engine.evaluate(tx, IDS.bakery.twin, {
          now: new Date(t.intentConfirmedAt),
          simulatedClock: true,
          actor,
          label: 'Intent confirmed — nothing promised yet',
        });

        // 2. Fictional merchant explicitly accepts versioned terms (simulated acceptance).
        const product = CATALOG.find((c) => c.sku === 'BOX-PAPER-100')!;
        const terms: AcceptedTerms = {
          sku: product.sku,
          title: product.title,
          material: product.attributes,
          quantity: 100,
          totalMinor: (product.unitPriceMinor * 100n).toString(),
          currency: 'USD',
          deliverBy: t.committedDeliverBy,
          deliveryTimezone: 'America/New_York',
          refundPolicy:
            'Merchant reviews refund requests if the committed delivery time is missed. Refunds require merchant authorization.',
          cancellationPolicy: 'Cancellable without fee before dispatch.',
        };
        await tx.offer.create({
          data: {
            id: IDS.bakery.offer,
            sellerTenantId: product.sellerTenantId,
            intentId: IDS.bakery.intent,
            catalogProductId: product.id,
            sku: product.sku,
            qty: 100,
            totalMinor: BigInt(terms.totalMinor),
            currency: 'USD',
            deliveryEstimateAt: new Date(t.committedDeliverBy),
            source: 'DEMO_FIXTURE',
            termsJson: terms as unknown as Prisma.InputJsonValue,
            expiresAt: new Date('2026-11-10T17:00:00-05:00'),
          },
        });
        const termsHash = hashObject(terms);
        await tx.sellerCommitment.create({
          data: {
            id: IDS.bakery.commitment,
            offerId: IDS.bakery.offer,
            sellerTenantId: product.sellerTenantId,
            acceptedBy: IDS.users.sam,
            acceptedAt: new Date(t.termsAcceptedAt),
            acceptedTermsJson: terms as unknown as Prisma.InputJsonValue,
            termsHash,
            version: 1,
            isSimulated: true,
          },
        });
        await tx.purchase.update({
          where: { id: IDS.bakery.purchase },
          data: {
            sellerTenantId: product.sellerTenantId,
            commitmentId: IDS.bakery.commitment,
            amountMinor: BigInt(terms.totalMinor),
            state: 'QUOTE_CONFIRMED',
            version: { increment: 1 },
          },
        });
        await this.engine.appendEvidence(
          tx,
          IDS.bakery.twin,
          {
            kind: 'SELLER_ACCEPTED_TERMS',
            assertion: 'TERMS_ACCEPTED',
            source: 'MERCHANT',
            sourceEventId: IDS.bakery.commitment,
            summary:
              'Kraftfold accepted terms v1: 100 × BOX-PAPER-100, $85.00, deliver by Fri 17:00 ET',
            occurredAt: new Date(t.termsAcceptedAt),
            observedAt: new Date(t.termsAcceptedAt),
            ingestedAt: new Date(t.termsAcceptedAt),
            verification: 'SIMULATED',
            isSimulated: true,
            payload: { termsHash, version: 1 },
            attestedBy: IDS.users.sam,
          },
          actor,
        );
        await this.engine.evaluate(tx, IDS.bakery.twin, {
          now: new Date(t.termsAcceptedAt),
          simulatedClock: true,
          actor,
          label: 'Seller accepted terms v1',
        });

        // 3. Simulated merchant update: revised estimate lands after the commitment.
        await this.engine.appendEvidence(
          tx,
          IDS.bakery.twin,
          {
            kind: 'MERCHANT_ASSERTION',
            assertion: 'ETA_REVISED',
            source: 'MERCHANT',
            sourceEventId: 'sim-kraftfold-eta-revision-1',
            summary: 'Merchant revised the delivery estimate to Monday',
            occurredAt: new Date(t.etaRevisedAt),
            observedAt: new Date(t.etaRevisedAt),
            ingestedAt: new Date(t.etaRevisedAt),
            verification: 'SIMULATED',
            isSimulated: true,
            payload: {
              estimatedDeliveryAt: t.revisedEta,
              reason: 'Carrier capacity shortfall (simulated)',
            },
          },
          actor,
        );
        await tx.demoClock.update({
          where: { scenarioKey: SCENARIOS.bakery },
          data: { simulatedNow: new Date(t.seededClock) },
        });
        await this.engine.evaluate(tx, IDS.bakery.twin, {
          now: new Date(t.seededClock),
          simulatedClock: true,
          actor,
          label: 'Merchant revised the estimate to Monday',
        });
      },
      { timeout: 60_000 },
    );
  }

  async buildShelter(correlationId = 'seed') {
    const actor = this.actor(correlationId);
    const t = SHELTER_TIMELINE;
    const spec = this.compileFixture(SHELTER_REQUEST, t.intentConfirmedAt, 'America/New_York');
    await this.prisma.$transaction(
      async (tx) => {
        await tx.missionReceipt.deleteMany({ where: { missionId: IDS.shelter.mission } });
        await tx.agentRun.deleteMany({ where: { entityId: IDS.shelter.mission } });
        await tx.intent.deleteMany({ where: { id: IDS.shelter.intent } });
        // Mission orders and the agent timeline cascade with the mission.
        await tx.mission.deleteMany({ where: { id: IDS.shelter.mission } });
        await tx.demoClock.upsert({
          where: { scenarioKey: SCENARIOS.shelter },
          create: {
            scenarioKey: SCENARIOS.shelter,
            tenantId: IDS.tenants.shelter,
            simulatedNow: new Date(t.seededClock),
          },
          update: { simulatedNow: new Date(t.seededClock) },
        });
        await this.missions.createInTx(
          tx,
          {
            orgTenantId: IDS.tenants.shelter,
            createdBy: IDS.users.jordan,
            title: '30 fragrance-free hygiene kits for Harbor Light',
            rawText: SHELTER_REQUEST,
            spec,
            compilerVersion: PARSER_VERSION,
            ids: { mission: IDS.shelter.mission, intent: IDS.shelter.intent },
            scenarioKey: SCENARIOS.shelter,
            isDemo: true,
            confirmedAt: new Date(t.intentConfirmedAt),
          },
          actor,
        );
        await tx.mission.update({
          where: { id: IDS.shelter.mission },
          data: {
            visibility: 'PUBLIC',
            category: 'hygiene',
            publicSummary: SHELTER_PUBLIC_SUMMARY,
            publishedAt: new Date(t.intentConfirmedAt),
          },
        });
        await this.buildHistory(tx, spec, actor);
      },
      { timeout: 60_000 },
    );
  }

  /** Completed, fully simulated past missions (SIM- identifiers, never PayPal records). */
  private async buildHistory(tx: Tx, base: IntentSpec, actor: Actor) {
    const product = CATALOG.find((c) => c.sku === 'KIT-FF-03')!;
    for (const [i, h] of SHELTER_HISTORY.entries()) {
      const ids = IDS.history[i]!;
      await tx.missionReceipt.deleteMany({ where: { missionId: ids.mission } });
      await tx.intent.deleteMany({ where: { id: ids.intent } });
      await tx.mission.deleteMany({ where: { id: ids.mission } });
      const spec: IntentSpec = {
        ...base,
        quantity: h.quantity,
        budgetMinor: h.budgetMinor,
        deadlineISO: h.deadline,
      };
      await this.missions.createInTx(
        tx,
        {
          orgTenantId: IDS.tenants.shelter,
          createdBy: IDS.users.jordan,
          title: h.title,
          rawText: h.request,
          spec,
          compilerVersion: PARSER_VERSION,
          ids: { mission: ids.mission, intent: ids.intent },
          isDemo: true,
          confirmedAt: new Date(h.at),
        },
        actor,
      );
      const amountMinor = product.unitPriceMinor * BigInt(h.quantity);
      const at = new Date(h.at);
      const later = (hours: number) => new Date(at.getTime() + hours * 3_600_000);
      await tx.missionOrder.create({
        data: {
          id: ids.order,
          missionId: ids.mission,
          planRound: 1,
          merchantTenantId: product.sellerTenantId,
          catalogProductId: product.id,
          sku: product.sku,
          title: product.title,
          quantity: h.quantity,
          unitPriceMinor: product.unitPriceMinor,
          amountMinor,
          currency: 'USD',
          state: 'DELIVERED',
          estimatedDeliveryAt: new Date(h.deliveredAt),
          quoteHash: computeQuoteHash({
            missionId: ids.mission,
            catalogProductId: product.id,
            merchantTenantId: product.sellerTenantId,
            quantity: h.quantity,
            unitPriceMinor: product.unitPriceMinor,
            amountMinor,
            currency: 'USD',
            planRound: 1,
          }),
          railMode: 'SIMULATED',
          paypalOrderId: `SIM-HIST-${i + 1}-ORDER`,
          paypalAuthorizationId: `SIM-HIST-${i + 1}-AUTH`,
          paypalCaptureId: `SIM-HIST-${i + 1}-CAPTURE`,
          approvedBy: i === 0 ? IDS.users.priya : IDS.users.leo,
          sponsorTenantId: i === 0 ? IDS.tenants.shelter : IDS.tenants.northside,
          approvedAt: later(2),
          stockConfirmedAt: later(4),
          carrier: 'Local courier (simulated)',
          trackingNumber: `SIM-TRK-HIST-${i + 1}`,
          shippedAt: later(30),
          acknowledgedAt: new Date(h.deliveredAt),
          quantityReceived: h.received,
          receiptNote:
            h.received < h.quantity ? `${h.quantity - h.received} kit arrived damaged.` : null,
        },
      });
      await tx.mission.update({
        where: { id: ids.mission },
        data: { state: 'COMPLETED', planRound: 1, category: 'hygiene' },
      });
      await tx.missionEvent.create({
        data: {
          missionId: ids.mission,
          agent: 'RECONCILIATION',
          kind: 'mission.completed',
          title: `Historical mission: ${h.received}/${h.quantity} kits received`,
          detail:
            'Seeded history for analytics and the shortage forecast. All payment identifiers are simulated (SIM-).',
          source: 'SIMULATED',
          createdAt: new Date(h.deliveredAt),
        },
      });
    }
  }

  private assertDemo() {
    if (!this.env.DEMO_MODE)
      throw AppError.forbidden('Demo controls are disabled (DEMO_MODE=false).');
  }

  async list(principal: Principal): Promise<DemoScenarioView[]> {
    this.assertDemo();
    const clocks = await this.prisma.demoClock.findMany({
      where: { tenantId: principal.tenantId },
    });
    return clocks.map((clock) =>
      clock.scenarioKey === SCENARIOS.bakery
        ? {
            key: clock.scenarioKey,
            title: 'Bakery packaging — late delivery',
            description:
              'Kraftfold (fictional) accepted Friday 17:00 ET, then revised its estimate to Monday. All seller and fulfillment events are simulated; no PayPal records exist.',
            simulatedNow: clock.simulatedNow.toISOString(),
            timezone: 'America/New_York',
            twinId: IDS.bakery.twin,
            missionId: null,
            checkpoints: BAKERY_CHECKPOINTS,
          }
        : {
            key: clock.scenarioKey,
            title: 'NeedMesh · 30 hygiene kits for a shelter',
            description:
              'Harbor Light needs 30 fragrance-free kits under $175. Run the agents, fund as the sponsor, then trigger a supplier stockout and watch the Recovery agent. Merchants and stock are fictional; payment steps use PayPal Sandbox when credentials exist, otherwise a labelled simulated rail.',
            simulatedNow: clock.simulatedNow.toISOString(),
            timezone: 'America/New_York',
            twinId: null,
            missionId: IDS.shelter.mission,
            checkpoints: [],
          },
    );
  }

  async advance(principal: Principal, key: string, checkpointKey: string, correlationId: string) {
    this.assertDemo();
    if (key !== SCENARIOS.bakery)
      throw new AppError('UNKNOWN_CHECKPOINT', 'This scenario has no clock checkpoints yet.', 422);
    const clock = await this.prisma.demoClock.findFirst({
      where: { scenarioKey: key, tenantId: principal.tenantId },
    });
    if (!clock) throw AppError.notFound('Scenario');
    const checkpoint = BAKERY_CHECKPOINTS.find((c) => c.key === checkpointKey);
    if (!checkpoint)
      throw new AppError('UNKNOWN_CHECKPOINT', `Unknown checkpoint ${checkpointKey}.`, 422);
    const target = new Date(checkpoint.at);
    if (target.getTime() <= clock.simulatedNow.getTime()) {
      throw AppError.conflict(
        'CLOCK_ONLY_MOVES_FORWARD',
        'History is append-only. Reset the scenario to replay it.',
      );
    }
    const actor: Actor = { type: 'DEMO_SIMULATOR', id: principal.userId, correlationId };
    return this.prisma.$transaction(
      async (tx) => {
        await tx.demoClock.update({ where: { scenarioKey: key }, data: { simulatedNow: target } });
        await this.outbox.append(tx, {
          tenantId: principal.tenantId,
          aggregateType: 'demo',
          aggregateId: IDS.bakery.twin,
          version: 1,
          eventType: 'demo.clock_advanced',
          payload: {
            scenarioKey: key,
            checkpoint: checkpoint.key,
            simulatedNow: target.toISOString(),
          },
          isSimulated: true,
        });
        await this.audit.record(tx, {
          tenantId: principal.tenantId,
          actorType: 'DEMO_SIMULATOR',
          actorId: principal.userId,
          action: 'demo.clock.advance',
          resourceType: 'demo_clock',
          resourceId: key,
          before: { simulatedNow: clock.simulatedNow },
          after: { simulatedNow: target },
          correlationId,
        });
        const { result } = await this.engine.evaluate(tx, IDS.bakery.twin, {
          now: target,
          simulatedClock: true,
          actor,
          label: checkpoint.label,
        });
        return { simulatedNow: target.toISOString(), health: result.health };
      },
      { timeout: 20_000 },
    );
  }

  async reset(principal: Principal, key: string, correlationId: string) {
    this.assertDemo();
    const clock = await this.prisma.demoClock.findFirst({
      where: { scenarioKey: key, tenantId: principal.tenantId },
    });
    if (!clock) throw AppError.notFound('Scenario');
    if (key === SCENARIOS.bakery) await this.buildBakery(correlationId);
    else if (key === SCENARIOS.shelter) await this.buildShelter(correlationId);
    await this.prisma.$transaction(async (tx) => {
      await this.audit.record(tx, {
        tenantId: principal.tenantId,
        actorType: 'DEMO_SIMULATOR',
        actorId: principal.userId,
        action: 'demo.scenario.reset',
        resourceType: 'demo_scenario',
        resourceId: key,
        correlationId,
      });
      await this.outbox.append(tx, {
        tenantId: principal.tenantId,
        aggregateType: 'demo',
        aggregateId: key === SCENARIOS.bakery ? IDS.bakery.twin : IDS.shelter.mission,
        version: 1,
        eventType: 'demo.scenario_reset',
        payload: { scenarioKey: key },
        isSimulated: true,
      });
    });
    return { ok: true };
  }
}
