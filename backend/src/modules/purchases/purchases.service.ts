import { Inject, Injectable } from '@nestjs/common';
import {
  type IntentSpec,
  type OffersResponse,
  type PurchaseDetail,
  type PurchaseSummary,
  type TwinHealth,
} from '@promesa/contracts';
import { type Prisma } from '@prisma/client';
import { AppError } from '../../common/errors';
import { hashObject } from '../../common/hash';
import { ENV, type Env } from '../../config/env';
import { PrismaService, type Tx } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CatalogService } from '../commerce/catalog.service';
import { resolveClock } from '../demo/clock';
import { OutboxService } from '../events/outbox.service';
import { type Principal } from '../identity/principal';
import { validateIntent } from '../intent/intent-validation';
import { type Actor, TwinEngine } from '../promisetwin/twin-engine';
import { toCommitmentView, toIntentView, toPaymentView } from '../promisetwin/views';

export type CreatePurchaseInput = {
  buyerTenantId: string;
  payerUserId: string;
  rawText: string;
  spec: IntentSpec;
  compilerVersion: string;
  missionId?: string;
  ids?: { intent?: string; purchase?: string; twin?: string };
  scenarioKey?: string;
  isDemo?: boolean;
  confirmedAt?: Date;
};

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: TwinEngine,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Creates intent + purchase + PromiseTwin atomically. Every purchase gets exactly one twin. */
  async createWithTwin(tx: Tx, input: CreatePurchaseInput, actor: Actor) {
    const confirmedAt = input.confirmedAt ?? new Date();
    const isDemo = input.isDemo ?? false;
    const intent = await tx.intent.create({
      data: {
        id: input.ids?.intent,
        missionId: input.missionId,
        buyerTenantId: input.buyerTenantId,
        createdBy: input.payerUserId,
        rawText: input.rawText,
        compiledJson: input.spec as unknown as Prisma.InputJsonValue,
        confirmedSnapshotJson: input.spec as unknown as Prisma.InputJsonValue,
        snapshotHash: hashObject(input.spec),
        confirmedAt,
        compilerVersion: input.compilerVersion,
      },
    });
    const purchase = await tx.purchase.create({
      data: {
        id: input.ids?.purchase,
        buyerTenantId: input.buyerTenantId,
        intentId: intent.id,
        missionId: input.missionId,
        payerUserId: input.payerUserId,
        title: `${input.spec.quantity} ${input.spec.productLabel}`,
        currency: input.spec.currency,
        state: 'PLANNED',
        isDemo,
        scenarioKey: input.scenarioKey,
      },
    });
    await tx.fulfillment.create({ data: { purchaseId: purchase.id } });
    const twin = await tx.promiseTwin.create({
      data: {
        id: input.ids?.twin,
        tenantId: input.buyerTenantId,
        purchaseId: purchase.id,
        intentSnapshotJson: input.spec as unknown as Prisma.InputJsonValue,
      },
    });
    await this.engine.appendEvidence(
      tx,
      twin.id,
      {
        kind: 'BUYER_CONFIRMED_INTENT',
        assertion: 'INTENT_CONFIRMED',
        source: 'BUYER',
        sourceEventId: intent.id,
        summary: 'Buyer confirmed the compiled intent',
        occurredAt: confirmedAt,
        observedAt: confirmedAt,
        ingestedAt: confirmedAt,
        verification: isDemo ? 'SIMULATED' : 'ATTESTED',
        isSimulated: isDemo,
        payload: { intentSnapshotHash: intent.snapshotHash },
        attestedBy: input.payerUserId,
      },
      actor,
    );
    await this.outbox.append(tx, {
      tenantId: input.buyerTenantId,
      aggregateType: 'purchase',
      aggregateId: purchase.id,
      version: 1,
      eventType: 'purchase.created',
      payload: { purchaseId: purchase.id, twinId: twin.id },
      isSimulated: isDemo,
    });
    await this.audit.record(tx, {
      tenantId: input.buyerTenantId,
      actorType: actor.type,
      actorId: actor.id,
      action: 'purchase.create',
      resourceType: 'purchase',
      resourceId: purchase.id,
      after: { intentHash: intent.snapshotHash },
      correlationId: actor.correlationId,
    });
    return { intent, purchase, twin };
  }

  async create(
    principal: Principal,
    body: { rawText: string; intent: IntentSpec; compilerVersion: string },
    correlationId: string,
  ) {
    if (principal.tenantKind !== 'BUSINESS') {
      throw AppError.forbidden(
        'Purchases are created from a business workspace. Organizations create missions.',
      );
    }
    const validation = validateIntent(body.intent, new Date());
    if (!validation.ok)
      throw new AppError('INTENT_INVALID', 'The intent failed validation.', 422, validation.issues);
    const actor: Actor = { type: 'USER', id: principal.userId, correlationId };
    return this.prisma.$transaction(
      async (tx) => {
        const created = await this.createWithTwin(
          tx,
          {
            buyerTenantId: principal.tenantId,
            payerUserId: principal.userId,
            rawText: body.rawText,
            spec: validation.spec,
            compilerVersion: body.compilerVersion,
          },
          actor,
        );
        await this.engine.evaluate(tx, created.twin.id, {
          now: new Date(),
          simulatedClock: false,
          actor,
          label: 'Intent confirmed',
        });
        return { purchaseId: created.purchase.id, twinId: created.twin.id };
      },
      { timeout: 20_000 },
    );
  }

  async list(principal: Principal): Promise<PurchaseSummary[]> {
    const rows = await this.prisma.purchase.findMany({
      where: { buyerTenantId: principal.tenantId },
      include: { twin: true, intent: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((p) => this.summary(p));
  }

  async get(principal: Principal, id: string): Promise<PurchaseDetail> {
    const p = await this.prisma.purchase.findFirst({
      where: { id, buyerTenantId: principal.tenantId },
      include: {
        twin: { include: { evidence: true } },
        intent: true,
        commitment: true,
        captures: true,
        checkoutAttempts: true,
      },
    });
    if (!p || !p.twin) throw AppError.notFound('Purchase');
    const merchant = p.sellerTenantId
      ? await this.prisma.tenant.findUnique({ where: { id: p.sellerTenantId } })
      : null;
    const acceptor = p.commitment
      ? await this.prisma.user.findUnique({ where: { id: p.commitment.acceptedBy } })
      : null;
    const clock = await resolveClock(this.prisma, p.scenarioKey);
    return {
      schemaVersion: 1,
      aggregateVersion: p.version,
      asOf: clock.now.toISOString(),
      simulationMode: p.isDemo,
      ...this.summary(p),
      intent: toIntentView(p.intent),
      commitment: toCommitmentView(
        p.commitment,
        merchant?.name ?? 'Unknown merchant',
        acceptor?.displayName ?? 'Unknown',
        p.twin.evidence,
      ),
      payment: toPaymentView(
        p.captures,
        p.checkoutAttempts,
        p.currency,
        Boolean(this.env.PAYPAL_CLIENT_ID),
      ),
    };
  }

  async offers(principal: Principal, id: string): Promise<OffersResponse> {
    const p = await this.prisma.purchase.findFirst({
      where: { id, buyerTenantId: principal.tenantId },
      include: { intent: true },
    });
    if (!p) throw AppError.notFound('Purchase');
    const clock = await resolveClock(this.prisma, p.scenarioKey);
    return this.catalog.offersFor(
      p.intent.confirmedSnapshotJson as unknown as IntentSpec,
      clock.now,
      p.version,
      clock.simulated,
    );
  }

  private summary(p: {
    id: string;
    title: string;
    state: string;
    amountMinor: bigint | null;
    currency: string;
    isDemo: boolean;
    createdAt: Date;
    twin: { id: string; health: string } | null;
    intent: { confirmedSnapshotJson: unknown };
  }): PurchaseSummary {
    const spec = p.intent.confirmedSnapshotJson as IntentSpec;
    return {
      id: p.id,
      title: p.title,
      state: p.state as PurchaseSummary['state'],
      amountMinor: p.amountMinor?.toString() ?? null,
      currency: p.currency,
      twinId: p.twin?.id ?? '',
      twinHealth: (p.twin?.health ?? 'UNDETERMINED') as TwinHealth,
      deadline: spec.deadlineISO,
      isDemo: p.isDemo,
      createdAt: p.createdAt.toISOString(),
    };
  }
}
