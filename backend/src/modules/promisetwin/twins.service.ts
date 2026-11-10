import { Inject, Injectable } from '@nestjs/common';
import {
  type ContrastView,
  type EvidenceView,
  type HealthBreakdownView,
  type IntentSpec,
  type ReadModelMeta,
  type SnapshotDetail,
  type SnapshotsPage,
  type ThreadsView,
  type TwinDetail,
  type TwinEvaluationView,
  type TwinHealth,
  type TwinSummary,
  type VerificationLevel,
} from '@promesa/contracts';
import { AppError } from '../../common/errors';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma.service';
import { resolveClock } from '../demo/clock';
import { type Principal } from '../identity/principal';
import { TwinEngine } from './twin-engine';
import {
  buildThreads,
  toCommitmentView,
  toEvaluationView,
  toEvidenceView,
  toIntentView,
  toPaymentView,
} from './views';

@Injectable()
export class TwinsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: TwinEngine,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async load(principal: Principal, twinId: string) {
    const twin = await this.prisma.promiseTwin.findFirst({
      where: { id: twinId, tenantId: principal.tenantId },
      include: {
        evidence: { orderBy: { occurredAt: 'asc' } },
        evaluations: { orderBy: { version: 'desc' }, take: 1 },
        purchase: {
          include: { intent: true, commitment: true, captures: true, checkoutAttempts: true },
        },
      },
    });
    if (!twin) throw AppError.notFound('PromiseTwin');
    const p = twin.purchase;
    const merchant = p.sellerTenantId
      ? await this.prisma.tenant.findUnique({ where: { id: p.sellerTenantId } })
      : null;
    const acceptor = p.commitment
      ? await this.prisma.user.findUnique({ where: { id: p.commitment.acceptedBy } })
      : null;
    const commitment = toCommitmentView(
      p.commitment,
      merchant?.name ?? 'Unknown merchant',
      acceptor?.displayName ?? 'Unknown',
      twin.evidence,
    );
    const payment = toPaymentView(
      p.captures,
      p.checkoutAttempts,
      p.currency,
      Boolean(this.env.PAYPAL_CLIENT_ID),
    );
    const evaluation = toEvaluationView(twin.evaluations[0] ?? null);
    const clock = await resolveClock(this.prisma, p.scenarioKey);
    const meta: ReadModelMeta = {
      schemaVersion: 1,
      aggregateVersion: twin.aggregateVersion,
      asOf: clock.now.toISOString(),
      simulationMode: p.isDemo || clock.simulated,
    };
    return {
      twin,
      purchase: p,
      commitment,
      payment,
      evaluation,
      meta,
      intent: p.intent.confirmedSnapshotJson as unknown as IntentSpec,
    };
  }

  async list(principal: Principal): Promise<TwinSummary[]> {
    const twins = await this.prisma.promiseTwin.findMany({
      where: { tenantId: principal.tenantId },
      include: { purchase: true },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    return twins.map((t) => ({
      id: t.id,
      purchaseId: t.purchaseId,
      title: t.purchase.title,
      health: t.health as TwinHealth,
      deadline: (t.intentSnapshotJson as unknown as IntentSpec).deadlineISO,
      isDemo: t.purchase.isDemo,
      lastEvaluatedAt: t.lastEvaluatedAt?.toISOString() ?? null,
    }));
  }

  async detail(principal: Principal, twinId: string): Promise<TwinDetail> {
    const ctx = await this.load(principal, twinId);
    const threads = buildThreads({
      twinId,
      intent: ctx.intent,
      commitment: ctx.commitment,
      payment: ctx.payment,
      evidence: ctx.twin.evidence,
      evaluation: ctx.evaluation,
    });
    return {
      ...ctx.meta,
      id: ctx.twin.id,
      purchaseId: ctx.purchase.id,
      title: ctx.purchase.title,
      health: ctx.twin.health as TwinHealth,
      isDemo: ctx.purchase.isDemo,
      scenarioKey: ctx.purchase.scenarioKey,
      intent: toIntentView(ctx.purchase.intent),
      commitment: ctx.commitment,
      payment: ctx.payment,
      evidence: ctx.twin.evidence.map(toEvidenceView),
      latestEvaluation: ctx.evaluation,
      firstPageThreads: threads,
    };
  }

  async evidence(
    principal: Principal,
    twinId: string,
  ): Promise<ReadModelMeta & { items: EvidenceView[] }> {
    const ctx = await this.load(principal, twinId);
    return { ...ctx.meta, items: ctx.twin.evidence.map(toEvidenceView) };
  }

  async threads(principal: Principal, twinId: string): Promise<ThreadsView> {
    const ctx = await this.load(principal, twinId);
    return {
      ...ctx.meta,
      twinId,
      ...buildThreads({
        twinId,
        intent: ctx.intent,
        commitment: ctx.commitment,
        payment: ctx.payment,
        evidence: ctx.twin.evidence,
        evaluation: ctx.evaluation,
      }),
    };
  }

  async contrast(principal: Principal, twinId: string): Promise<ContrastView> {
    const ctx = await this.load(principal, twinId);
    const ev = ctx.evaluation;
    const outcome: ContrastView['outcome'] =
      !ev ||
      ev.health === 'UNDETERMINED' ||
      ev.health === 'UNRESOLVED' ||
      ev.health === 'UNDER_RECOVERY'
        ? 'UNCERTAIN'
        : ev.health;
    return {
      ...ctx.meta,
      twinId,
      evaluationVersion: ev?.version ?? 0,
      contractVersion: ctx.commitment?.version ?? null,
      outcome,
      unmetConstraintIds:
        ev?.constraints
          .filter((c) => c.status === 'VIOLATED' || c.status === 'AT_RISK')
          .map((c) => c.constraintId) ?? [],
      evidenceIds: ev?.constraints.flatMap((c) => c.evidenceIds) ?? [],
      interpretation: ev?.interpretation ?? 'Not evaluated yet.',
      knownAt: ev?.clock.now ?? ctx.meta.asOf,
      constraints: ev?.constraints ?? [],
    };
  }

  async healthBreakdown(principal: Principal, twinId: string): Promise<HealthBreakdownView> {
    const ctx = await this.load(principal, twinId);
    const strongest = (kinds: string[]): VerificationLevel | 'ABSENT' => {
      const levels = ctx.twin.evidence
        .filter((e) => kinds.includes(e.kind))
        .map((e) => e.verificationLevel as VerificationLevel);
      for (const l of ['VERIFIED', 'ATTESTED', 'UNVERIFIED', 'SIMULATED'] as const)
        if (levels.includes(l)) return l;
      return 'ABSENT';
    };
    const fulfilment = strongest([
      'MERCHANT_ASSERTION',
      'CARRIER_TRACKING',
      'PAYPAL_TRACKING_METADATA',
      'RECIPIENT_ATTESTED',
    ]);
    return {
      ...ctx.meta,
      twinId,
      health: ctx.twin.health as TwinHealth,
      layers: [
        {
          layer: 'INTENT',
          present: true,
          verification: strongest(['BUYER_CONFIRMED_INTENT']),
          note: 'Immutable confirmed intent snapshot.',
        },
        {
          layer: 'COMMITMENT',
          present: Boolean(ctx.commitment),
          verification: ctx.commitment ? ctx.commitment.provenance.verification : 'ABSENT',
          note: ctx.commitment
            ? `Seller terms v${ctx.commitment.version}, hash ${ctx.commitment.termsHash.slice(0, 12)}…`
            : 'No seller acceptance.',
        },
        {
          layer: 'PAYMENT',
          present: ctx.payment.status !== 'NOT_STARTED',
          verification: ctx.payment.status === 'CAPTURED' ? 'VERIFIED' : 'ABSENT',
          note: ctx.payment.note,
        },
        {
          layer: 'FULFILLMENT',
          present: fulfilment !== 'ABSENT',
          verification: fulfilment,
          note:
            fulfilment === 'ABSENT'
              ? 'No shipment or delivery evidence.'
              : 'See evidence list for each source.',
        },
      ],
      rules: [
        'BREACHED requires a seller-accepted commitment and evidence that it was missed.',
        'A PayPal capture proves payment only, never delivery.',
        'Missing evidence yields UNDETERMINED, never BREACHED.',
        'FULFILLED requires recipient acknowledgment.',
        'Simulated evidence is labelled and never presented as real-world proof.',
      ],
    };
  }

  async snapshots(
    principal: Principal,
    twinId: string,
    cursor: number | null,
    limit: number,
  ): Promise<SnapshotsPage> {
    const ctx = await this.load(principal, twinId);
    const rows = await this.prisma.twinSnapshot.findMany({
      where: { twinId, ...(cursor !== null ? { eventSeq: { gt: cursor } } : {}) },
      orderBy: { eventSeq: 'asc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    return {
      ...ctx.meta,
      items: page.map((s) => ({
        id: s.id,
        eventSeq: s.eventSeq,
        aggregateVersion: s.aggregateVersion,
        health: (s.stateJson as { health: TwinHealth }).health,
        label: s.label,
        knownAt: s.knownAt.toISOString(),
        recordedAt: s.recordedAt.toISOString(),
        snapshotHash: s.snapshotHash,
        isSimulated: s.isSimulated,
      })),
      nextCursor: rows.length > limit ? String(page.at(-1)!.eventSeq) : null,
    };
  }

  async snapshot(
    principal: Principal,
    twinId: string,
    snapshotId: string,
  ): Promise<SnapshotDetail> {
    await this.load(principal, twinId);
    const s = await this.prisma.twinSnapshot.findFirst({ where: { id: snapshotId, twinId } });
    if (!s) throw AppError.notFound('Snapshot');
    const state = s.stateJson as unknown as SnapshotDetail['state'];
    const evidence = await this.prisma.evidence.findMany({
      where: { twinId, id: { in: state.evidenceIds } },
      orderBy: { occurredAt: 'asc' },
    });
    return {
      id: s.id,
      eventSeq: s.eventSeq,
      aggregateVersion: s.aggregateVersion,
      health: state.health,
      label: s.label,
      knownAt: s.knownAt.toISOString(),
      recordedAt: s.recordedAt.toISOString(),
      snapshotHash: s.snapshotHash,
      isSimulated: s.isSimulated,
      state,
      evidence: evidence.map(toEvidenceView),
    };
  }

  async evaluate(
    principal: Principal,
    twinId: string,
    correlationId: string,
  ): Promise<TwinEvaluationView> {
    const ctx = await this.load(principal, twinId);
    const result = await this.prisma.$transaction(
      async (tx) => {
        const clock = await resolveClock(tx, ctx.purchase.scenarioKey);
        return this.engine.evaluate(tx, twinId, {
          now: clock.now,
          simulatedClock: clock.simulated,
          actor: { type: 'USER', id: principal.userId, correlationId },
          label: 'Re-evaluated on request',
        });
      },
      { timeout: 20_000 },
    );
    return toEvaluationView(result.evaluation)!;
  }
}
