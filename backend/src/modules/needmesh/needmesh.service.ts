import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AcknowledgeReceiptRequest,
  type AgentRunView,
  type IntentSpec,
  type MerchantActionRequest,
  type MissionAgent,
  type MissionEventSource,
  type MissionLifecycleView,
  type MissionOrderState,
  type MissionOrderView,
  type MissionPlanView,
  type MissionReceiptView,
  type MissionState,
  type SupplyNodeView,
  formatMoney,
} from '@promesa/contracts';
import { type MissionOrder, type Prisma } from '@prisma/client';
import { AppError } from '../../common/errors';
import { hashObject } from '../../common/hash';
import { ENV, type Env } from '../../config/env';
import { PrismaService, type Tx } from '../../infra/prisma.service';
import {
  LLM_PROVIDER,
  type LLMProvider,
  NARRATION_SYSTEM_POLICY,
  NarrationSchema,
  type Narration,
} from '../agents/llm-provider';
import { AuditService } from '../audit/audit.service';
import { CatalogService } from '../commerce/catalog.service';
import { type CatalogItem, solveOffers } from '../commerce/offer-solver';
import { resolveClock } from '../demo/clock';
import { OutboxService } from '../events/outbox.service';
import { type Principal } from '../identity/principal';
import { validateIntent } from '../intent/intent-validation';
import { type PolicyDecision } from '../policy/financial-policy';
import { PAYPAL_MCP, type PayPalMcpAdapter } from '../paypal/paypal-mcp.adapter';
import { figuresAreGrounded } from './narration-guard';
import { planMission, type MissionPlanResult } from './mission-planner';
import {
  type MissionAction,
  type MissionPolicyContext,
  evaluateMissionPolicy,
} from './mission-policy';
import {
  type OrderLike,
  committedMinor,
  computeQuoteHash,
  coverage,
  decideRemedy,
  deriveMissionState,
  isCovering,
  nextStepFor,
} from './mission-state';
import { applyAcceptedTerms } from './negotiation';
import { PAYPAL_RAIL, type PayPalRail } from './paypal-rail';
import { deriveProtection } from './protection';
import { toProposalView } from './proposal-view';

type MissionRow = Prisma.MissionGetPayload<{
  include: { intents: true; orders: true };
}>;

type EventInput = {
  agent: MissionAgent;
  kind: string;
  title: string;
  detail: string;
  source: MissionEventSource;
  engine?: string;
  orderId?: string | null;
  payload?: Record<string, unknown>;
};

type StoredPlan = {
  round: number;
  status: 'PROPOSED' | 'INFEASIBLE';
  narrative: MissionPlanView['narrative'];
  unmetQuantity: number;
  excluded: MissionPlanView['excluded'];
};

type Loaded = { mission: MissionRow; spec: IntentSpec };

/** Roles that may drive the labelled simulated merchant console for their own organization's mission. */
const MERCHANT_ROLES = ['SPONSOR', 'ORG_ADMIN', 'ORG_OPERATOR'] as const;
const isMerchantRole = (role: string) => role === 'MERCHANT_ADMIN' || role === 'MERCHANT_OPERATOR';

type RunNode = AgentRunView['nodes'][number];

/** Inventory older than this is shown as STALE rather than VERIFIED. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

const toLike = (o: MissionOrder): OrderLike => ({
  state: o.state as MissionOrderState,
  quantity: o.quantity,
  amountMinor: o.amountMinor,
  quantityReceived: o.quantityReceived,
});

/**
 * NeedMesh mission orchestration. Agents (planner, PayPal commerce, recovery, fulfilment,
 * reconciliation) are deterministic services with optional LLM narration. The only path to money
 * is: agent proposes → `evaluateMissionPolicy` decides → `PayPalRail` executes → state is
 * persisted with provenance. An LLM can describe a decision but never makes one.
 */
@Injectable()
export class NeedMeshService {
  private readonly logger = new Logger('NeedMesh');

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    @Inject(ENV) private readonly env: Env,
    @Inject(PAYPAL_RAIL) private readonly rail: PayPalRail,
    @Inject(PAYPAL_MCP) private readonly mcp: PayPalMcpAdapter,
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
  ) {}

  private get railSource(): MissionEventSource {
    return this.rail.mode === 'SANDBOX' ? 'PAYPAL_API' : 'SIMULATED';
  }

  private get demoControlsEnabled() {
    return this.env.DEMO_MODE;
  }

  // ---------------------------------------------------------------- reads

  async lifecycle(principal: Principal, missionId: string): Promise<MissionLifecycleView> {
    const { mission, spec } = await this.load(principal, missionId, 'read');
    const [events, receipt, proposals, runs, org, approvers, supplyCatalog] = await Promise.all([
      this.prisma.missionEvent.findMany({
        where: { missionId },
        orderBy: { seq: 'asc' },
        take: 300,
      }),
      this.prisma.missionReceipt.findFirst({
        where: { missionId, revokedAt: null },
        orderBy: { revision: 'desc' },
      }),
      this.prisma.merchantProposal.findMany({
        where: { missionId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.agentRun.findMany({
        where: { entityId: missionId, workflow: { startsWith: 'needmesh.' } },
        orderBy: { startedAt: 'desc' },
        take: 6,
      }),
      this.prisma.tenant.findUniqueOrThrow({ where: { id: mission.orgTenantId } }),
      this.prisma.user.findMany({
        where: {
          id: { in: mission.orders.map((o) => o.approvedBy).filter((x): x is string => !!x) },
        },
      }),
      this.catalogFor(missionId, spec.productKind),
    ]);
    const listed = new Set(supplyCatalog.catalog.map((c) => c.merchant.tenantId));
    const names = await this.tenantNames([
      ...mission.orders.map((o) => o.merchantTenantId),
      ...mission.orders.map((o) => o.sponsorTenantId).filter((x): x is string => !!x),
      ...proposals.map((p) => p.merchantTenantId),
      ...supplyCatalog.catalog.map((c) => c.merchant.tenantId),
    ]);
    const userNames = new Map(approvers.map((u) => [u.id, u.displayName]));
    const viewerIsOrg = mission.orgTenantId === principal.tenantId;
    const likes = mission.orders.map(toLike);
    const committed = committedMinor(likes);
    const clock = await resolveClock(this.prisma, mission.scenarioKey);
    const live = mission.orders.filter(
      (o) => !['CANCELLED', 'VOIDED', 'REFUNDED'].includes(o.state),
    );
    const funded = live.filter((o) => o.approvedAt !== null || o.paypalAuthorizationId !== null);
    const sponsorMap = new Map<
      string,
      { sponsorName: string; sponsorOrg: string; orders: number; amount: bigint }
    >();
    for (const o of funded) {
      const key = `${o.sponsorTenantId ?? '-'}:${o.approvedBy ?? '-'}`;
      const row = sponsorMap.get(key) ?? {
        sponsorName: (o.approvedBy && userNames.get(o.approvedBy)) || 'Sponsor',
        sponsorOrg: (o.sponsorTenantId && names.get(o.sponsorTenantId)) || 'Organization sponsor',
        orders: 0,
        amount: 0n,
      };
      row.orders += 1;
      row.amount += o.amountMinor;
      sponsorMap.set(key, row);
    }
    const unfunded = live
      .filter((o) => o.state === 'AWAITING_APPROVAL' || o.state === 'PAYPAL_ORDER_CREATED')
      .reduce((a, o) => a + o.amountMinor, 0n);
    const allocated = new Map<string, number>();
    for (const o of live)
      allocated.set(o.catalogProductId, (allocated.get(o.catalogProductId) ?? 0) + o.quantity);
    const supply = this.supplyNodes(spec, supplyCatalog, names, allocated, clock.now);
    const sum = (rows: MissionOrder[], f: (o: MissionOrder) => number) =>
      rows.reduce((a, o) => a + f(o), 0);
    const atlas = {
      requested: spec.quantity,
      planned: sum(live, (o) => o.quantity),
      funded: sum(funded, (o) => o.quantity),
      purchased: sum(
        live.filter((o) => o.paypalCaptureId !== null),
        (o) => o.quantity,
      ),
      shipped: sum(
        live.filter((o) => o.shippedAt !== null),
        (o) => o.quantity,
      ),
      received: sum(mission.orders, (o) => o.quantityReceived ?? 0),
    };
    const state = mission.state as MissionState;
    const stored = (mission.planJson ?? null) as StoredPlan | null;
    const plan: MissionPlanView = stored
      ? {
          round: stored.round,
          status: stored.status,
          narrative: stored.narrative,
          unmetQuantity: stored.unmetQuantity,
          excluded: stored.excluded,
        }
      : { round: 0, status: 'NONE', narrative: null, unmetQuantity: spec.quantity, excluded: [] };

    return {
      schemaVersion: 1,
      aggregateVersion: mission.version,
      asOf: clock.now.toISOString(),
      simulationMode: mission.isDemo || this.rail.mode === 'SIMULATED',
      missionId,
      state,
      atlas,
      marketplace: {
        visibility: mission.visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE',
        category: mission.category,
        publicSummary: mission.publicSummary,
        publishedAt: mission.publishedAt?.toISOString() ?? null,
        orgName: org.name,
        orgVerified: org.verifiedAt !== null,
      },
      viewerIsOrg,
      sponsors: [...sponsorMap.values()].map((s) => ({
        sponsorName: s.sponsorName,
        sponsorOrg: s.sponsorOrg,
        orders: s.orders,
        amountMinor: s.amount.toString(),
      })),
      unfundedMinor: unfunded.toString(),
      supply,
      discoverySources: [
        {
          name: 'NeedMesh merchant catalog',
          status: 'ACTIVE',
          detail: `${supplyCatalog.catalog.length} listings from merchants connected to this platform (demo fixtures are labelled).`,
        },
        {
          name: 'Channel3 product discovery',
          status: 'NOT_CONFIGURED',
          detail: this.env.CHANNEL3_API_KEY
            ? 'A CHANNEL3_API_KEY is present, but the Channel3 adapter is not integrated yet. No Channel3 results are shown.'
            : 'No CHANNEL3_API_KEY configured. Channel3 discovery is a planned adapter; nothing here comes from Channel3.',
        },
      ],
      proposals: proposals.map((p) =>
        toProposalView(p, names, {
          tenantId: principal.tenantId,
          role: principal.role,
          isOrg: viewerIsOrg,
        }),
      ),
      agentRuns: runs.map((r) => ({
        id: r.id,
        workflow: r.workflow,
        state: r.state,
        engine: r.model,
        startedAt: r.startedAt.toISOString(),
        endedAt: r.endedAt?.toISOString() ?? null,
        nodes: (r.summarizedToolTraceJson ?? []) as RunNode[],
      })),
      rail:
        this.rail.mode === 'SANDBOX'
          ? {
              mode: 'SANDBOX',
              label: 'PayPal Sandbox',
              detail:
                'Orders are authorized, captured and voided with real PayPal Sandbox API calls. Merchants, stock and delivery remain fictional.',
            }
          : {
              mode: 'SIMULATED',
              label: 'Simulated PayPal rail',
              detail:
                'No PayPal credentials are configured, so payment steps use a clearly labelled simulated rail. Identifiers start with SIM- and are never PayPal records.',
            },
      mcp: this.mcp.peek(),
      budget: {
        limitMinor: mission.budgetMinor.toString(),
        committedMinor: committed.toString(),
        remainingMinor: (mission.budgetMinor - committed).toString(),
        currency: mission.currency,
      },
      coverage: coverage(likes, spec.quantity),
      plan,
      orders: mission.orders.map((o) =>
        this.toOrderView(o, mission, mission.orders, names, listed, principal, {
          spec,
          now: clock.now,
          userNames,
          negotiated: supplyCatalog.negotiated,
        }),
      ),
      events: events.map((e) => ({
        id: e.id,
        seq: e.seq,
        agent: e.agent as MissionAgent,
        kind: e.kind,
        title: e.title,
        detail: e.detail,
        source: e.source as MissionEventSource,
        engine: e.engine,
        orderId: e.orderId,
        payload: (e.payloadJson ?? {}) as Record<string, unknown>,
        occurredAt: e.createdAt.toISOString(),
      })),
      receipt: receipt ? this.toReceiptView(receipt) : null,
      nextStep: nextStepFor(likes, state),
      demoControlsEnabled: this.demoControlsEnabled,
    };
  }

  // ---------------------------------------------------------------- 1. agents build the plan

  async runAgents(principal: Principal, missionId: string, correlationId: string) {
    const { mission, spec } = await this.load(principal, missionId);
    // Re-planning is allowed only while nothing has been sent to PayPal; afterwards changes go
    // through recovery so no live payment is silently redirected.
    const touched = mission.orders.filter(
      (o) => !['AWAITING_APPROVAL', 'CANCELLED', 'VOIDED', 'REFUNDED'].includes(o.state),
    );
    if (mission.planRound > 0 && touched.length > 0)
      throw AppError.conflict(
        'ALREADY_FUNDED',
        'Orders of this plan are already with PayPal. Further changes happen through recovery re-planning.',
      );
    const fromRound = mission.planRound;
    const round = fromRound + 1;
    const clock = await resolveClock(this.prisma, mission.scenarioKey);
    const validation = validateIntent(spec, clock.now);
    if (!validation.ok)
      throw new AppError(
        'INTENT_INVALID',
        'The confirmed need no longer validates.',
        422,
        validation.issues,
      );

    const started = new Date();
    const { catalog, negotiated, accepted } = await this.catalogFor(missionId, spec.productKind);
    const plan = planMission({
      intent: spec,
      catalog,
      now: clock.now,
      budgetAvailableMinor: mission.budgetMinor,
    });
    const names = await this.tenantNames(plan.lines.map((l) => l.product.merchant.tenantId));
    const det = deterministicPlanNarration(spec, mission.budgetMinor, plan);
    const narration = await this.narrate(det.narration, det.facts);
    const infeasible = plan.lines.length === 0;
    const merchantsSeen = new Set(catalog.map((c) => c.merchant.tenantId));
    const trace: RunNode[] = [
      {
        node: 'mission_understanding',
        label: 'Mission understanding',
        status: 'DONE',
        output: `${spec.quantity} ${spec.productLabel} · +${spec.requiredAttributes.join(', ') || '—'} · −${spec.prohibitedAttributes.join(', ') || '—'} · ${formatMoney(mission.budgetMinor, mission.currency)} by ${spec.deadlineISO}`,
      },
      {
        node: 'product_discovery',
        label: 'Product discovery',
        status: 'DONE',
        output: `${catalog.length} listings for "${spec.productKind}" in the connected merchant catalog. Channel3: ${this.env.CHANNEL3_API_KEY ? 'key present, adapter not integrated' : 'not configured'}.`,
      },
      {
        node: 'merchant_matching',
        label: 'Merchant matching',
        status: 'DONE',
        output: `${merchantsSeen.size} merchants considered; ${plan.excluded.length} listings excluded on hard constraints.`,
      },
      {
        node: 'offer_evaluation',
        label: 'Offer evaluation',
        status: 'DONE',
        output: `${accepted.length} negotiated term${accepted.length === 1 ? '' : 's'} applied (merchant-accepted only).`,
      },
      {
        node: 'procurement_optimization',
        label: 'Procurement optimization',
        status: infeasible ? 'FAILED' : 'DONE',
        output: infeasible
          ? (plan.shortfallReason ?? 'No feasible plan.')
          : `${plan.lines.length} orders, ${plan.plannedQuantity}/${spec.quantity} units, ${formatMoney(plan.totalMinor, mission.currency)}.`,
      },
      {
        node: 'policy_validation',
        label: 'Deterministic policy validation',
        status: infeasible ? 'SKIPPED' : 'DONE',
        output: 'Budget ceiling, stock bounds, verified payees and quote hashes checked.',
      },
      {
        node: 'funding_coordination',
        label: 'Funding coordination',
        status: infeasible ? 'SKIPPED' : 'DONE',
        output:
          mission.visibility === 'PUBLIC'
            ? 'Mission is published: any verified sponsor can fund individual orders.'
            : 'Mission is private: the organization’s own sponsors fund the orders.',
      },
    ];
    const stored: StoredPlan = {
      round,
      status: infeasible ? 'INFEASIBLE' : 'PROPOSED',
      narrative: { ...narration.value, engine: narration.engine },
      unmetQuantity: plan.unmetQuantity,
      excluded: plan.excluded,
    };
    const aiSource: MissionEventSource =
      narration.engine === 'deterministic' ? 'POLICY_DERIVED' : 'AI_DERIVED';

    await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.mission.updateMany({
          where: { id: missionId, planRound: fromRound },
          data: { planRound: round, planJson: stored as unknown as Prisma.InputJsonValue },
        });
        if (claimed.count !== 1)
          throw AppError.conflict(
            'ALREADY_PLANNED',
            'Another request already planned this mission.',
          );
        if (fromRound > 0) {
          const superseded = await tx.missionOrder.updateMany({
            where: { missionId, state: 'AWAITING_APPROVAL' },
            data: { state: 'CANCELLED', version: { increment: 1 } },
          });
          await this.event(tx, missionId, {
            agent: 'COMMERCE_PLANNER',
            kind: 'plan.superseded',
            title: `Plan round ${fromRound} superseded`,
            detail: `${superseded.count} unfunded order${superseded.count === 1 ? '' : 's'} cancelled before re-planning. No money had moved.`,
            source: 'POLICY_DERIVED',
            payload: { fromRound, cancelled: superseded.count },
          });
        }
        if (accepted.length > 0)
          await this.event(tx, missionId, {
            agent: 'NEGOTIATION',
            kind: 'negotiation.applied',
            title: `${accepted.length} merchant-accepted offer${accepted.length === 1 ? '' : 's'} used by the planner`,
            detail: accepted
              .map(
                (a) =>
                  `${a.sku}: ${formatMoney(a.agreedUnitPriceMinor, mission.currency)}/unit (list ${formatMoney(BigInt(negotiated.get(a.catalogProductId)?.listUnitPriceMinor ?? '0'), mission.currency)})`,
              )
              .join(' · '),
            source: 'POLICY_DERIVED',
            payload: { proposals: accepted.map((a) => a.proposalId) },
          });

        await this.event(tx, missionId, {
          agent: 'MISSION_PLANNER',
          kind: 'need.understood',
          title: 'Need understood and validated',
          detail: `${spec.quantity} ${spec.productLabel.toLowerCase()} · must be ${spec.requiredAttributes.join(', ') || 'unspecified'} · must not be ${spec.prohibitedAttributes.join(', ') || 'unspecified'} · budget ${formatMoney(mission.budgetMinor, mission.currency)} · by ${spec.deadlineISO}`,
          source: 'POLICY_DERIVED',
          payload: { quantity: spec.quantity, productKind: spec.productKind },
        });

        for (const line of plan.lines) {
          const merchantTenantId = line.product.merchant.tenantId;
          await tx.missionOrder.create({
            data: {
              missionId,
              planRound: round,
              merchantTenantId,
              catalogProductId: line.product.id,
              proposalId:
                accepted.find((a) => a.catalogProductId === line.product.id)?.proposalId ?? null,
              sku: line.product.sku,
              title: line.product.title,
              quantity: line.quantity,
              unitPriceMinor: line.unitPriceMinor,
              amountMinor: line.amountMinor,
              currency: mission.currency,
              estimatedDeliveryAt: line.estimatedDeliveryAt,
              quoteHash: computeQuoteHash({
                missionId,
                catalogProductId: line.product.id,
                merchantTenantId,
                quantity: line.quantity,
                unitPriceMinor: line.unitPriceMinor,
                amountMinor: line.amountMinor,
                currency: mission.currency,
                planRound: round,
              }),
              railMode: this.rail.mode,
            },
          });
        }
        await this.recordRun(
          tx,
          mission.orgTenantId,
          missionId,
          'needmesh.plan',
          trace,
          started,
          narration.engine,
        );

        if (infeasible) {
          await this.event(tx, missionId, {
            agent: 'COMMERCE_PLANNER',
            kind: 'plan.infeasible',
            title: 'No feasible plan',
            detail: plan.shortfallReason ?? 'No eligible supply.',
            source: 'POLICY_DERIVED',
            payload: { excluded: plan.excluded },
          });
        } else {
          await this.event(tx, missionId, {
            agent: 'COMMERCE_PLANNER',
            kind: 'plan.proposed',
            title: `${plan.lines.length} merchant order${plan.lines.length === 1 ? '' : 's'} planned for ${formatMoney(plan.totalMinor, mission.currency)}`,
            detail: `${narration.value.headline} ${narration.value.rationale}`,
            source: aiSource,
            engine: narration.engine,
            payload: {
              lines: plan.lines.map((l) => ({
                merchant: names.get(l.product.merchant.tenantId),
                sku: l.product.sku,
                quantity: l.quantity,
                amountMinor: l.amountMinor.toString(),
              })),
              unmetQuantity: plan.unmetQuantity,
              tradeoffs: narration.value.tradeoffs,
            },
          });
          await this.event(tx, missionId, {
            agent: 'POLICY_ENGINE',
            kind: 'plan.checked',
            title: 'Plan checked against financial policy',
            detail: `Every payee is a verified catalog merchant, the total ${formatMoney(plan.totalMinor, mission.currency)} is within the ${formatMoney(mission.budgetMinor, mission.currency)} limit, and each order is locked to an immutable quote hash. Nothing is paid until a sponsor approves each order in PayPal.`,
            source: 'POLICY_DERIVED',
            payload: { policyVersion: 'mission-policy@1.0.0' },
          });
        }

        await this.audit.record(tx, {
          tenantId: mission.orgTenantId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'mission.plan',
          resourceType: 'mission',
          resourceId: missionId,
          after: { orders: plan.lines.length, totalMinor: plan.totalMinor.toString() },
          correlationId,
        });
        await this.syncMission(tx, missionId, 'mission.planned', infeasible);
      },
      { timeout: 20_000 },
    );
    return this.lifecycle(principal, missionId);
  }

  // ---------------------------------------------------------------- 2. sponsor funds via PayPal

  async approveOrder(
    principal: Principal,
    missionId: string,
    orderId: string,
    correlationId: string,
  ) {
    const loaded = await this.load(principal, missionId, 'fund');
    const order = this.findOrder(loaded.mission, orderId);
    await this.enforce(principal, loaded, order, 'APPROVE_ORDER', {});

    // 1. PayPal order (idempotent by PayPal-Request-Id; reused if it already exists).
    let paypalOrderId = order.paypalOrderId;
    let approveUrl = order.approveUrl;
    let created = false;
    if (!paypalOrderId) {
      const merchant = (await this.tenantNames([order.merchantTenantId])).get(
        order.merchantTenantId,
      );
      const base = this.env.PUBLIC_BASE_URL.replace(/\/$/, '');
      const result = await this.rail.createAuthorizeOrder({
        requestId: `nm-${order.id}-create`,
        referenceId: `nm-${order.id.slice(0, 8)}`,
        customId: order.id,
        description: `NeedMesh · ${order.quantity} × ${order.title} · ${merchant ?? 'merchant'} (fictional)`,
        amountMinor: order.amountMinor,
        currency: order.currency,
        returnUrl: `${base}/missions/${missionId}?paypal=return&order=${order.id}`,
        cancelUrl: `${base}/missions/${missionId}?paypal=cancel&order=${order.id}`,
      });
      paypalOrderId = result.orderId;
      approveUrl = result.approveUrl;
      created = true;
    }

    // 2. In-app approval (simulated rail) completes authorization immediately.
    let authorizationId: string | null = order.paypalAuthorizationId;
    let nextState: MissionOrderState = 'PAYPAL_ORDER_CREATED';
    let authStatus: string | null = null;
    if (!this.rail.requiresRedirect) {
      const auth = await this.rail.authorize({
        requestId: `nm-${order.id}-authorize`,
        paypalOrderId,
      });
      authorizationId = auth.authorizationId;
      authStatus = auth.status;
      nextState = 'AUTHORIZED';
    }

    await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.missionOrder.updateMany({
          where: { id: order.id, state: order.state, version: order.version },
          data: {
            state: nextState,
            paypalOrderId,
            approveUrl,
            paypalAuthorizationId: authorizationId,
            railMode: this.rail.mode,
            approvedBy: principal.userId,
            sponsorTenantId: principal.tenantId,
            approvedAt: nextState === 'AUTHORIZED' ? new Date() : null,
            paypalLastVerifiedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1)
          throw AppError.conflict(
            'ORDER_CHANGED',
            'The order changed while it was being approved.',
          );
        if (created) {
          await this.event(tx, missionId, {
            agent: 'PAYPAL_COMMERCE',
            kind: 'paypal.order_created',
            title: 'PayPal order created (intent=AUTHORIZE)',
            detail: `${formatMoney(order.amountMinor, order.currency)} for ${order.quantity} × ${order.sku}. PayPal reference ${paypalOrderId}.`,
            source: this.railSource,
            orderId: order.id,
            payload: { paypalOrderId, intent: 'AUTHORIZE', requestId: `nm-${order.id}-create` },
          });
        }
        if (nextState === 'AUTHORIZED') {
          await this.event(tx, missionId, {
            agent: 'HUMAN',
            kind: 'sponsor.approved',
            title: `${principal.displayName} (${principal.tenantName}) approved this payment`,
            detail: `Sponsor approved ${formatMoney(order.amountMinor, order.currency)} to this merchant only. Each sponsor funds separate merchant orders; there is no pooled wallet.`,
            source: 'BUYER',
            orderId: order.id,
          });
          await this.event(tx, missionId, {
            agent: 'PAYPAL_COMMERCE',
            kind: 'paypal.authorized',
            title: 'Funds authorized, not yet captured',
            detail: `Authorization ${authorizationId} (${authStatus}). Capture waits for the merchant to confirm stock.`,
            source: this.railSource,
            orderId: order.id,
            payload: { authorizationId },
          });
        } else {
          await this.event(tx, missionId, {
            agent: 'HUMAN',
            kind: 'sponsor.redirected',
            title: `${principal.displayName} is approving on PayPal`,
            detail:
              'The sponsor is sent to PayPal to approve this exact amount. NeedMesh never sees payment credentials.',
            source: 'BUYER',
            orderId: order.id,
          });
        }
        await this.audit.record(tx, {
          tenantId: loaded.mission.orgTenantId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'mission.order.approve',
          resourceType: 'mission_order',
          resourceId: order.id,
          policyDecision: 'ALLOW',
          after: { state: nextState, paypalOrderId },
          correlationId,
        });
        await this.syncMission(tx, missionId, 'mission.order_approved');
      },
      { timeout: 20_000 },
    );

    if (nextState === 'AUTHORIZED') await this.verifyThroughMcp(missionId, order.id, paypalOrderId);
    return { approveUrl: nextState === 'AUTHORIZED' ? null : approveUrl, state: nextState };
  }

  /** Called after PayPal redirects the sponsor back. The id from the browser is only compared, never trusted. */
  async authorizeReturn(
    principal: Principal,
    missionId: string,
    orderId: string,
    paypalOrderId: string,
    correlationId: string,
  ) {
    const loaded = await this.load(principal, missionId, 'fund');
    const order = this.findOrder(loaded.mission, orderId);
    if (order.paypalOrderId !== paypalOrderId)
      throw new AppError(
        'ORDER_MISMATCH',
        'The PayPal order does not match this mission order.',
        422,
      );
    await this.enforce(principal, loaded, order, 'AUTHORIZE_ORDER', {});

    const auth = await this.rail.authorize({
      requestId: `nm-${order.id}-authorize`,
      paypalOrderId,
    });
    await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.missionOrder.updateMany({
          where: { id: order.id, state: 'PAYPAL_ORDER_CREATED' },
          data: {
            state: 'AUTHORIZED',
            paypalAuthorizationId: auth.authorizationId,
            approvedBy: principal.userId,
            sponsorTenantId: principal.tenantId,
            approvedAt: new Date(),
            paypalLastVerifiedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1) return;
        await this.event(tx, missionId, {
          agent: 'PAYPAL_COMMERCE',
          kind: 'paypal.authorized',
          title: 'Sponsor approved on PayPal; funds authorized',
          detail: `Authorization ${auth.authorizationId} (${auth.status}) for ${formatMoney(order.amountMinor, order.currency)}. Capture waits for the merchant to confirm stock.`,
          source: this.railSource,
          orderId: order.id,
          payload: { authorizationId: auth.authorizationId, paypalOrderId },
        });
        await this.audit.record(tx, {
          tenantId: loaded.mission.orgTenantId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'mission.order.authorize',
          resourceType: 'mission_order',
          resourceId: order.id,
          policyDecision: 'ALLOW',
          correlationId,
        });
        await this.syncMission(tx, missionId, 'mission.order_authorized');
      },
      { timeout: 20_000 },
    );
    await this.verifyThroughMcp(missionId, order.id, paypalOrderId);
    return this.lifecycle(principal, missionId);
  }

  // ---------------------------------------------------------------- 3. merchants (simulated) + recovery

  async merchantAction(
    principal: Principal,
    missionId: string,
    orderId: string,
    body: MerchantActionRequest,
    correlationId: string,
  ) {
    const merchantUser = isMerchantRole(principal.role);
    if (!merchantUser) {
      if (!this.demoControlsEnabled)
        throw AppError.forbidden('Simulated merchant actions are disabled (DEMO_MODE=false).');
      if (!MERCHANT_ROLES.includes(principal.role as (typeof MERCHANT_ROLES)[number]))
        throw AppError.forbidden('Your role cannot drive the simulated merchant console.');
    }
    const loaded = await this.load(principal, missionId, merchantUser ? 'read' : 'org');
    const order = this.findOrder(loaded.mission, orderId);
    if (merchantUser && order.merchantTenantId !== principal.tenantId)
      throw AppError.forbidden('Merchants can act only on their own orders.');
    const merchant =
      (await this.tenantNames([order.merchantTenantId])).get(order.merchantTenantId) ?? 'Merchant';

    switch (body.action) {
      case 'CONFIRM_STOCK':
        await this.confirmAndCapture(principal, loaded, order, merchant, correlationId);
        break;
      case 'SHIP':
        await this.ship(principal, loaded, order, merchant, correlationId);
        break;
      case 'STOCKOUT':
        await this.recoverFromStockout(principal, loaded, order, merchant, correlationId);
        break;
      case 'APPROVE_REFUND':
        await this.approveRefund(principal, loaded, order, merchant, correlationId);
        break;
    }
    return this.lifecycle(principal, missionId);
  }

  private async confirmAndCapture(
    principal: Principal,
    loaded: Loaded,
    order: MissionOrder,
    merchant: string,
    correlationId: string,
  ) {
    const missionId = loaded.mission.id;
    if (order.state !== 'AUTHORIZED')
      throw AppError.conflict(
        'INVALID_STATE',
        `Order is ${order.state}; stock confirmation needs AUTHORIZED.`,
      );
    const confirmedAt = order.stockConfirmedAt ?? new Date();
    if (!order.stockConfirmedAt) {
      await this.prisma.$transaction(async (tx) => {
        await tx.missionOrder.update({
          where: { id: order.id },
          data: { stockConfirmedAt: confirmedAt, version: { increment: 1 } },
        });
        await this.event(tx, missionId, {
          agent: 'FULFILLMENT',
          kind: 'merchant.stock_confirmed',
          title: `${merchant} confirmed stock`,
          detail: `${order.quantity} × ${order.sku} reserved for this mission.`,
          source: 'SIMULATED',
          orderId: order.id,
        });
      });
    }
    const fresh = this.findOrder(await this.reload(principal, missionId), order.id);
    await this.enforce(principal, loaded, fresh, 'CAPTURE', {});
    const capture = await this.rail.capture({
      requestId: `nm-${order.id}-capture`,
      authorizationId: fresh.paypalAuthorizationId!,
    });
    await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.missionOrder.updateMany({
          where: { id: order.id, state: 'AUTHORIZED' },
          data: {
            state: 'CAPTURED',
            paypalCaptureId: capture.captureId,
            paypalLastVerifiedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1) return;
        await this.event(tx, missionId, {
          agent: 'PAYPAL_COMMERCE',
          kind: 'paypal.captured',
          title: 'Payment captured after stock confirmation',
          detail: `Capture ${capture.captureId} (${capture.status}) for ${formatMoney(order.amountMinor, order.currency)}. A capture proves payment, not delivery.`,
          source: this.railSource,
          orderId: order.id,
          payload: { captureId: capture.captureId, authorizationId: fresh.paypalAuthorizationId },
        });
        await this.audit.record(tx, {
          tenantId: loaded.mission.orgTenantId,
          actorType: 'DEMO_SIMULATOR',
          actorId: principal.userId,
          action: 'mission.order.capture',
          resourceType: 'mission_order',
          resourceId: order.id,
          policyDecision: 'ALLOW',
          correlationId,
        });
        await this.syncMission(tx, missionId, 'mission.order_captured');
      },
      { timeout: 20_000 },
    );
  }

  private async ship(
    principal: Principal,
    loaded: Loaded,
    order: MissionOrder,
    merchant: string,
    correlationId: string,
  ) {
    const missionId = loaded.mission.id;
    await this.enforce(principal, loaded, order, 'SHIP', {});
    const trackingNumber = `NM${hashObject({ id: order.id, k: 'trk' }).slice(0, 10).toUpperCase()}`;
    const carrier = 'Local courier (simulated)';
    let trackingNote = 'Tracking recorded locally.';
    let trackingSource: MissionEventSource = this.railSource;
    try {
      await this.rail.addTracking({
        requestId: `nm-${order.id}-track`,
        captureId: order.paypalCaptureId!,
        trackingNumber,
        carrierName: carrier,
      });
      trackingNote =
        this.rail.mode === 'SANDBOX'
          ? 'Tracking attached to the PayPal transaction.'
          : 'Tracking recorded on the simulated rail.';
    } catch (error) {
      trackingSource = 'SIMULATED';
      trackingNote = `PayPal did not accept the tracking record (${error instanceof Error ? error.message : 'error'}); shipment is still recorded as a merchant assertion.`;
    }
    await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.missionOrder.updateMany({
          where: { id: order.id, state: 'CAPTURED' },
          data: {
            state: 'SHIPPED',
            carrier,
            trackingNumber,
            shippedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1) return;
        await this.event(tx, missionId, {
          agent: 'FULFILLMENT',
          kind: 'merchant.shipped',
          title: `${merchant} shipped the goods`,
          detail: `${carrier} · ${trackingNumber}. ${trackingNote} Shipment is a merchant claim until the organization confirms receipt.`,
          source: trackingSource,
          orderId: order.id,
          payload: { trackingNumber, carrier },
        });
        await this.audit.record(tx, {
          tenantId: loaded.mission.orgTenantId,
          actorType: 'DEMO_SIMULATOR',
          actorId: principal.userId,
          action: 'mission.order.ship',
          resourceType: 'mission_order',
          resourceId: order.id,
          policyDecision: 'ALLOW',
          correlationId,
        });
        await this.syncMission(tx, missionId, 'mission.order_shipped');
      },
      { timeout: 20_000 },
    );
  }

  private async approveRefund(
    principal: Principal,
    loaded: Loaded,
    order: MissionOrder,
    merchant: string,
    correlationId: string,
  ) {
    const missionId = loaded.mission.id;
    if (order.state !== 'REFUND_PENDING')
      throw AppError.conflict(
        'INVALID_STATE',
        `Order is ${order.state}; refunds need REFUND_PENDING.`,
      );
    const approvedAt = order.refundApprovedAt ?? new Date();
    if (!order.refundApprovedAt) {
      await this.prisma.$transaction(async (tx) => {
        await tx.missionOrder.update({
          where: { id: order.id },
          data: { refundApprovedAt: approvedAt, version: { increment: 1 } },
        });
        await this.event(tx, missionId, {
          agent: 'RECOVERY',
          kind: 'merchant.refund_authorized',
          title: `${merchant} authorized the refund`,
          detail:
            'Refunds of captured payments are the merchant’s decision. This approval is bound to this capture.',
          source: 'SIMULATED',
          orderId: order.id,
        });
      });
    }
    const fresh = this.findOrder(await this.reload(principal, missionId), order.id);
    await this.enforce(principal, loaded, fresh, 'REFUND', {});
    const refund = await this.rail.refund({
      requestId: `nm-${order.id}-refund`,
      captureId: fresh.paypalCaptureId!,
      amountMinor: fresh.amountMinor,
      currency: fresh.currency,
    });
    await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.missionOrder.updateMany({
          where: { id: order.id, state: 'REFUND_PENDING' },
          data: {
            state: 'REFUNDED',
            paypalRefundId: refund.refundId,
            paypalLastVerifiedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1) return;
        await this.event(tx, missionId, {
          agent: 'PAYPAL_COMMERCE',
          kind: 'paypal.refunded',
          title: 'Refund issued through PayPal',
          detail: `Refund ${refund.refundId} (${refund.status}) for ${formatMoney(order.amountMinor, order.currency)}.`,
          source: this.railSource,
          orderId: order.id,
          payload: { refundId: refund.refundId, captureId: fresh.paypalCaptureId },
        });
        await this.audit.record(tx, {
          tenantId: loaded.mission.orgTenantId,
          actorType: 'DEMO_SIMULATOR',
          actorId: principal.userId,
          action: 'mission.order.refund',
          resourceType: 'mission_order',
          resourceId: order.id,
          policyDecision: 'ALLOW',
          correlationId,
        });
        await this.syncMission(tx, missionId, 'mission.order_refunded');
      },
      { timeout: 20_000 },
    );
  }

  /**
   * The Recovery agent. A supplier reports a stockout → read the *actual* PayPal state → choose the
   * remedy PayPal supports (void / refund request / cancel) → policy-gated execution → re-plan the
   * unfulfilled quantity across the remaining suppliers. Replacement orders need fresh sponsor approval.
   */
  private async recoverFromStockout(
    principal: Principal,
    loaded: Loaded,
    order: MissionOrder,
    merchant: string,
    correlationId: string,
  ) {
    const { mission, spec } = loaded;
    const missionId = mission.id;
    if (order.stockoutAt)
      throw AppError.conflict('ALREADY_REPORTED', 'This stockout was already handled.');

    // a) What does PayPal say right now?
    let observed: { authorizationStatus: string | null; captureStatus: string | null } | null =
      null;
    let inspectionNote: string;
    let inspectionSource: MissionEventSource = this.railSource;
    try {
      const inspection = await this.rail.inspect({
        orderId: order.paypalOrderId,
        authorizationId: order.paypalAuthorizationId,
        captureId: order.paypalCaptureId,
        known: {
          authorizationStatus: order.paypalAuthorizationId
            ? order.paypalCaptureId
              ? 'CAPTURED'
              : 'CREATED'
            : null,
          captureStatus: order.paypalCaptureId ? 'COMPLETED' : null,
        },
      });
      observed = {
        authorizationStatus: inspection.authorizationStatus,
        captureStatus: inspection.captureStatus,
      };
      inspectionSource = inspection.source === 'PAYPAL_API' ? 'PAYPAL_API' : 'SIMULATED';
      inspectionNote = `${inspection.source === 'PAYPAL_API' ? 'PayPal REST' : 'Simulated rail'} reports authorization=${inspection.authorizationStatus ?? 'none'}, capture=${inspection.captureStatus ?? 'none'}.`;
    } catch (error) {
      inspectionNote = `PayPal state could not be read (${error instanceof Error ? error.message : 'error'}); using the last verified local state.`;
    }
    const remedy = decideRemedy(order.state as MissionOrderState, observed);
    if (remedy.kind === 'NOT_APPLICABLE') throw AppError.conflict('NOT_APPLICABLE', remedy.why);

    // b) Execute the remedy through policy.
    let nextState: MissionOrderState = order.state as MissionOrderState;
    let remedyEvent: EventInput | null = null;
    if (remedy.kind === 'VOID_AUTHORIZATION') {
      await this.enforce(principal, loaded, order, 'VOID', {});
      const voided = await this.rail.voidAuthorization({
        requestId: `nm-${order.id}-void`,
        authorizationId: order.paypalAuthorizationId!,
      });
      nextState = 'VOIDED';
      remedyEvent = {
        agent: 'PAYPAL_COMMERCE',
        kind: 'paypal.voided',
        title: 'Authorization voided — the sponsor is not charged',
        detail: `${remedy.why} Authorization ${order.paypalAuthorizationId} is ${voided.status}.`,
        source: this.railSource,
        orderId: order.id,
        payload: { authorizationId: order.paypalAuthorizationId },
      };
    } else if (remedy.kind === 'REQUEST_REFUND') {
      nextState = 'REFUND_PENDING';
      remedyEvent = {
        agent: 'RECOVERY',
        kind: 'recovery.refund_requested',
        title: 'Refund requested — merchant authorization required',
        detail: `${remedy.why} The refund is not executed until ${merchant} authorizes it.`,
        source: 'POLICY_DERIVED',
        orderId: order.id,
      };
    } else if (remedy.kind === 'CANCEL_UNFUNDED') {
      nextState = 'CANCELLED';
      remedyEvent = {
        agent: 'RECOVERY',
        kind: 'recovery.cancelled',
        title: 'Unfunded order cancelled',
        detail: remedy.why,
        source: 'POLICY_DERIVED',
        orderId: order.id,
      };
    } else {
      nextState = (
        ['VOIDED', 'REFUNDED', 'CANCELLED', 'REFUND_PENDING'] as MissionOrderState[]
      ).includes(order.state as MissionOrderState)
        ? (order.state as MissionOrderState)
        : 'VOIDED';
      remedyEvent = {
        agent: 'RECOVERY',
        kind: 'recovery.already_released',
        title: 'Funds were already released',
        detail: remedy.why,
        source: inspectionSource,
        orderId: order.id,
      };
    }

    // c) Re-plan the unfulfilled quantity.
    const clock = await resolveClock(this.prisma, mission.scenarioKey);
    const afterOrders: OrderLike[] = mission.orders.map((o) =>
      o.id === order.id ? { ...toLike(o), state: nextState } : toLike(o),
    );
    const blocked = new Set(
      mission.orders
        .filter((o) => o.stockoutAt || o.id === order.id)
        .map((o) => o.catalogProductId),
    );
    const reserved = new Map<string, number>();
    for (const o of mission.orders) {
      if (o.id !== order.id && isCovering(toLike(o)))
        reserved.set(o.catalogProductId, (reserved.get(o.catalogProductId) ?? 0) + o.quantity);
    }
    const started = new Date();
    const { catalog, accepted } = await this.catalogFor(missionId, spec.productKind);
    const covered = afterOrders.filter(isCovering).reduce((a, o) => a + o.quantity, 0);
    const plan = planMission({
      intent: spec,
      catalog,
      now: clock.now,
      coveredQuantity: covered,
      budgetAvailableMinor: mission.budgetMinor - committedMinor(afterOrders),
      reservedByProduct: reserved,
      blockedProductIds: blocked,
    });
    const round = mission.planRound + 1;
    const names = await this.tenantNames(plan.lines.map((l) => l.product.merchant.tenantId));
    const det = deterministicRecoveryNarration({
      merchant,
      remedy: remedy.kind,
      lostQuantity: order.quantity,
      spec,
      plan,
      currency: mission.currency,
      names,
    });
    const narration = await this.narrate(det.narration, det.facts);
    const infeasible = plan.lines.length === 0;
    const stored: StoredPlan = {
      round,
      status: infeasible ? 'INFEASIBLE' : 'PROPOSED',
      narrative: { ...narration.value, engine: narration.engine },
      unmetQuantity: plan.unmetQuantity,
      excluded: plan.excluded,
    };
    const aiSource: MissionEventSource =
      narration.engine === 'deterministic' ? 'POLICY_DERIVED' : 'AI_DERIVED';

    await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.missionOrder.updateMany({
          where: { id: order.id, stockoutAt: null, version: order.version },
          data: {
            state: nextState,
            stockoutAt: new Date(),
            paypalLastVerifiedAt: observed ? new Date() : undefined,
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1)
          throw AppError.conflict('ORDER_CHANGED', 'The order changed while recovery was running.');

        await this.event(tx, missionId, {
          agent: 'FULFILLMENT',
          kind: 'merchant.stockout',
          title: `${merchant} reported a stockout`,
          detail: `${order.quantity} × ${order.sku} can no longer be supplied. This is a simulated merchant event.`,
          source: 'SIMULATED',
          orderId: order.id,
        });
        await this.event(tx, missionId, {
          agent: 'RECOVERY',
          kind: 'recovery.diagnosed',
          title: 'Recovery agent read the actual PayPal state',
          detail: `${inspectionNote} Remedy chosen: ${remedy.kind.replace(/_/g, ' ').toLowerCase()}.`,
          source: inspectionSource,
          orderId: order.id,
          payload: { observed, remedy: remedy.kind },
        });
        await this.event(tx, missionId, {
          agent: 'PROMISETWIN',
          kind: 'promisetwin.breach',
          title: 'PromiseTwin: merchant commitment broken',
          detail: `Intent snapshot required ${order.quantity} × ${order.sku} by ${spec.deadlineISO}. Root cause: merchant stockout (not a carrier or agent error). PayPal state verified before remedy. Remedy: ${remedy.kind.replace(/_/g, ' ').toLowerCase()}. Replacement payments need fresh human approval.`,
          source: 'POLICY_DERIVED',
          orderId: order.id,
          payload: {
            rootCause: 'MERCHANT_STOCKOUT',
            tracks: { intent: 'MET', merchant: 'FAILED', paypal: observed ? 'MET' : 'PENDING' },
            remedy: remedy.kind,
          },
        });
        if (remedyEvent) await this.event(tx, missionId, remedyEvent);

        await tx.mission.update({
          where: { id: missionId },
          data: { planRound: round, planJson: stored as unknown as Prisma.InputJsonValue },
        });
        await this.recordRun(
          tx,
          mission.orgTenantId,
          missionId,
          'needmesh.recovery',
          [
            {
              node: 'fulfillment_monitoring',
              label: 'Fulfillment monitoring',
              status: 'DONE',
              output: `${merchant} reported a stockout for ${order.quantity} × ${order.sku}.`,
            },
            {
              node: 'promisetwin_breach',
              label: 'PromiseTwin breach analysis',
              status: 'DONE',
              output: 'Root cause: merchant stockout. Intent unchanged.',
            },
            {
              node: 'paypal_inspection',
              label: 'PayPal state inspection',
              status: observed ? 'DONE' : 'FAILED',
              output: inspectionNote,
            },
            {
              node: 'remedy',
              label: 'Remedy (policy-gated)',
              status: 'DONE',
              output: remedy.kind,
            },
            {
              node: 'procurement_replan',
              label: 'Procurement re-plan',
              status: infeasible ? 'FAILED' : 'DONE',
              output: infeasible
                ? (plan.shortfallReason ?? 'No feasible replacement.')
                : `${plan.lines.length} replacement order(s), ${formatMoney(plan.totalMinor, mission.currency)}.`,
            },
            {
              node: 'human_approval',
              label: 'Human approval gate',
              status: infeasible ? 'SKIPPED' : 'DONE',
              output: 'Replacement orders wait for a sponsor to approve them in PayPal.',
            },
          ],
          started,
          narration.engine,
        );
        for (const line of plan.lines) {
          const merchantTenantId = line.product.merchant.tenantId;
          await tx.missionOrder.create({
            data: {
              missionId,
              planRound: round,
              replacesOrderId: order.id,
              merchantTenantId,
              catalogProductId: line.product.id,
              proposalId:
                accepted.find((a) => a.catalogProductId === line.product.id)?.proposalId ?? null,
              sku: line.product.sku,
              title: line.product.title,
              quantity: line.quantity,
              unitPriceMinor: line.unitPriceMinor,
              amountMinor: line.amountMinor,
              currency: mission.currency,
              estimatedDeliveryAt: line.estimatedDeliveryAt,
              quoteHash: computeQuoteHash({
                missionId,
                catalogProductId: line.product.id,
                merchantTenantId,
                quantity: line.quantity,
                unitPriceMinor: line.unitPriceMinor,
                amountMinor: line.amountMinor,
                currency: mission.currency,
                planRound: round,
              }),
              railMode: this.rail.mode,
            },
          });
        }
        await this.event(tx, missionId, {
          agent: 'COMMERCE_PLANNER',
          kind: infeasible ? 'plan.infeasible' : 'plan.replanned',
          title: infeasible
            ? 'No feasible replacement within the constraints'
            : `Replacement plan: ${plan.lines.length} new order${plan.lines.length === 1 ? '' : 's'} for ${formatMoney(plan.totalMinor, mission.currency)}`,
          detail: `${narration.value.headline} ${narration.value.rationale}`,
          source: aiSource,
          engine: narration.engine,
          orderId: order.id,
          payload: {
            round,
            unmetQuantity: plan.unmetQuantity,
            tradeoffs: narration.value.tradeoffs,
            lines: plan.lines.map((l) => ({
              merchant: names.get(l.product.merchant.tenantId),
              sku: l.product.sku,
              quantity: l.quantity,
              amountMinor: l.amountMinor.toString(),
            })),
          },
        });
        if (!infeasible) {
          await this.event(tx, missionId, {
            agent: 'POLICY_ENGINE',
            kind: 'recovery.needs_approval',
            title: 'Replacement requires fresh sponsor approval',
            detail:
              'The original payment was not silently redirected. Each replacement order is a new PayPal checkout that a sponsor must approve.',
            source: 'POLICY_DERIVED',
          });
        }
        await this.audit.record(tx, {
          tenantId: mission.orgTenantId,
          actorType: 'DEMO_SIMULATOR',
          actorId: principal.userId,
          action: 'mission.order.stockout_recovery',
          resourceType: 'mission_order',
          resourceId: order.id,
          policyDecision: remedy.kind,
          after: { state: nextState, replacementOrders: plan.lines.length, round },
          correlationId,
        });
        await this.syncMission(tx, missionId, 'mission.recovered', infeasible);
      },
      { timeout: 30_000 },
    );
  }

  // ---------------------------------------------------------------- 4. organization confirms receipt

  async acknowledge(
    principal: Principal,
    missionId: string,
    orderId: string,
    body: AcknowledgeReceiptRequest,
    correlationId: string,
  ) {
    const loaded = await this.load(principal, missionId);
    const order = this.findOrder(loaded.mission, orderId);
    await this.enforce(principal, loaded, order, 'ACKNOWLEDGE', {
      quantityReceived: body.quantityReceived,
    });
    const merchant =
      (await this.tenantNames([order.merchantTenantId])).get(order.merchantTenantId) ?? 'Merchant';
    await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.missionOrder.updateMany({
          where: { id: order.id, state: 'SHIPPED' },
          data: {
            state: 'DELIVERED',
            quantityReceived: body.quantityReceived,
            receiptNote: body.note ?? null,
            acknowledgedBy: principal.userId,
            acknowledgedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1)
          throw AppError.conflict('ORDER_CHANGED', 'Receipt was already acknowledged.');
        const short = body.quantityReceived < order.quantity;
        await this.event(tx, missionId, {
          agent: 'FULFILLMENT',
          kind: 'recipient.acknowledged',
          title: `${principal.displayName} confirmed receipt: ${body.quantityReceived} of ${order.quantity}`,
          detail: `${merchant} · ${order.sku}.${short ? ' Short delivery — the mission stays open.' : ' Recipient confirmation is the only evidence that goods arrived.'}${body.note ? ` Note: ${body.note}` : ''}`,
          source: 'RECIPIENT',
          orderId: order.id,
          payload: { quantityReceived: body.quantityReceived, ordered: order.quantity },
        });
        await this.audit.record(tx, {
          tenantId: loaded.mission.orgTenantId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'mission.order.acknowledge',
          resourceType: 'mission_order',
          resourceId: order.id,
          policyDecision: 'ALLOW',
          correlationId,
        });
        const state = await this.syncMission(tx, missionId, 'mission.order_delivered');
        if (state === 'COMPLETED') await this.issueReceipt(tx, missionId);
      },
      { timeout: 20_000 },
    );
    return this.lifecycle(principal, missionId);
  }

  // ---------------------------------------------------------------- 5. reconcile against PayPal

  async reconcile(principal: Principal, missionId: string, correlationId: string) {
    const { mission } = await this.load(principal, missionId, 'fund');
    const findings: string[] = [];
    let verified = 0;
    const updates: Array<{ order: MissionOrder; nextState: MissionOrderState; why: string }> = [];

    for (const order of mission.orders) {
      if (!order.paypalOrderId && !order.paypalAuthorizationId && !order.paypalCaptureId) continue;
      try {
        const inspection = await this.rail.inspect({
          orderId: order.railMode === 'SANDBOX' ? order.paypalOrderId : null,
          authorizationId: order.railMode === 'SANDBOX' ? order.paypalAuthorizationId : null,
          captureId: order.railMode === 'SANDBOX' ? order.paypalCaptureId : null,
          known: {
            authorizationStatus:
              order.state === 'VOIDED' ? 'VOIDED' : order.paypalAuthorizationId ? 'CREATED' : null,
            captureStatus: order.paypalCaptureId ? 'COMPLETED' : null,
          },
        });
        verified += 1;
        const authStatus = inspection.authorizationStatus;
        if (
          order.state === 'AUTHORIZED' &&
          authStatus &&
          ['VOIDED', 'EXPIRED', 'DENIED'].includes(authStatus)
        ) {
          updates.push({
            order,
            nextState: 'VOIDED',
            why: `PayPal reports authorization ${order.paypalAuthorizationId} as ${authStatus}; local state was AUTHORIZED.`,
          });
        } else if (
          (order.state === 'CAPTURED' || order.state === 'SHIPPED') &&
          inspection.captureStatus &&
          ['REFUNDED', 'DECLINED', 'FAILED'].includes(inspection.captureStatus)
        ) {
          updates.push({
            order,
            nextState: 'REFUNDED',
            why: `PayPal reports capture ${order.paypalCaptureId} as ${inspection.captureStatus}; local state was ${order.state}.`,
          });
        }
      } catch (error) {
        findings.push(
          `Could not read PayPal state for ${order.sku}: ${error instanceof Error ? error.message : 'error'}`,
        );
      }
    }

    await this.prisma.$transaction(
      async (tx) => {
        for (const u of updates) {
          await tx.missionOrder.update({
            where: { id: u.order.id },
            data: {
              state: u.nextState,
              paypalLastVerifiedAt: new Date(),
              version: { increment: 1 },
            },
          });
          await this.event(tx, missionId, {
            agent: 'RECONCILIATION',
            kind: 'reconcile.discrepancy',
            title: 'PayPal state differs from NeedMesh records — PayPal wins',
            detail: u.why,
            source: this.railSource,
            orderId: u.order.id,
          });
        }
        await tx.missionOrder.updateMany({
          where: {
            missionId,
            id: { in: mission.orders.filter((o) => o.paypalOrderId).map((o) => o.id) },
          },
          data: { paypalLastVerifiedAt: new Date() },
        });
        const live = mission.orders.filter((o) => isCovering(toLike(o)));
        await this.event(tx, missionId, {
          agent: 'RECONCILIATION',
          kind: 'reconcile.completed',
          title:
            updates.length === 0 && findings.length === 0
              ? `Reconciled ${verified} payment record${verified === 1 ? '' : 's'}: no discrepancies`
              : `Reconciled with ${updates.length} correction${updates.length === 1 ? '' : 's'}`,
          detail: `${this.rail.mode === 'SANDBOX' ? 'Compared local state with PayPal Sandbox API responses.' : 'Simulated rail: compared internal records only; no PayPal system was consulted.'} ${live.length} live order${live.length === 1 ? '' : 's'} checked.${findings.length ? ` ${findings.join(' ')}` : ''}`,
          source: this.railSource,
          payload: { verified, corrections: updates.length },
        });
        await this.audit.record(tx, {
          tenantId: mission.orgTenantId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'mission.reconcile',
          resourceType: 'mission',
          resourceId: missionId,
          correlationId,
        });
        await this.syncMission(tx, missionId, 'mission.reconciled');
      },
      { timeout: 20_000 },
    );
    return this.lifecycle(principal, missionId);
  }

  /** Webhook-driven correction: PayPal state beats local state. Verified upstream by signature. */
  async applyPayPalWebhook(event: {
    id: string;
    event_type: string;
    resource?: Record<string, unknown>;
  }): Promise<{ matched: boolean }> {
    const resource = event.resource ?? {};
    const resourceId = typeof resource.id === 'string' ? resource.id : null;
    const customId = typeof resource.custom_id === 'string' ? resource.custom_id : null;
    const order = await this.prisma.missionOrder.findFirst({
      where: {
        OR: [
          ...(customId ? [{ id: customId }] : []),
          ...(resourceId
            ? [
                { paypalOrderId: resourceId },
                { paypalAuthorizationId: resourceId },
                { paypalCaptureId: resourceId },
              ]
            : []),
        ],
      },
    });
    if (!order) return { matched: false };
    let nextState: MissionOrderState | null = null;
    if (event.event_type === 'PAYMENT.AUTHORIZATION.VOIDED' && order.state === 'AUTHORIZED')
      nextState = 'VOIDED';
    if (
      event.event_type === 'PAYMENT.CAPTURE.REFUNDED' &&
      ['CAPTURED', 'SHIPPED', 'REFUND_PENDING'].includes(order.state)
    )
      nextState = 'REFUNDED';
    await this.prisma.$transaction(async (tx) => {
      if (nextState) {
        await tx.missionOrder.update({
          where: { id: order.id },
          data: { state: nextState, paypalLastVerifiedAt: new Date(), version: { increment: 1 } },
        });
      }
      await this.event(tx, order.missionId, {
        agent: 'RECONCILIATION',
        kind: 'paypal.webhook',
        title: `PayPal webhook: ${event.event_type}`,
        detail: nextState
          ? `Signature-verified event ${event.id}. Order moved to ${nextState}.`
          : `Signature-verified event ${event.id}. No state change needed.`,
        source: 'PAYPAL_WEBHOOK',
        orderId: order.id,
        payload: { eventId: event.id, eventType: event.event_type },
      });
      await this.syncMission(tx, order.missionId, 'mission.webhook');
    });
    return { matched: true };
  }

  // ---------------------------------------------------------------- internals

  /** PayPal Commerce agent cross-checks its REST result through the official MCP get_order tool. */
  private async verifyThroughMcp(missionId: string, orderId: string, paypalOrderId: string | null) {
    if (!paypalOrderId || this.rail.mode !== 'SANDBOX') return;
    try {
      const result = await this.mcp.getOrder(paypalOrderId);
      if (!result) return;
      await this.prisma.missionEvent.create({
        data: {
          missionId,
          orderId,
          agent: 'PAYPAL_COMMERCE',
          kind: 'paypal.mcp_verified',
          title: `PayPal MCP ${result.tool}: order is ${result.status ?? 'unreadable'}`,
          detail:
            'The agent asked the official PayPal MCP server for the order instead of trusting its own record.',
          source: 'PAYPAL_API',
          engine: `mcp:${result.tool}`,
          payloadJson: { paypalOrderId, status: result.status },
        },
      });
    } catch (error) {
      this.logger.warn(
        `MCP verification skipped: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private async narrate(
    deterministic: Narration,
    facts: Record<string, unknown>,
  ): Promise<{ value: Narration; engine: string }> {
    if (!this.llm.modelTasks.includes('mission.narrate'))
      return { value: deterministic, engine: 'deterministic' };
    try {
      const out = await this.llm.generateStructured({
        task: 'mission.narrate',
        schema: NarrationSchema,
        systemPolicy: NARRATION_SYSTEM_POLICY,
        trustedContext: { facts, deterministic },
        untrustedInput: '',
      });
      const text = `${out.headline} ${out.rationale} ${out.tradeoffs.join(' ')}`;
      if (!figuresAreGrounded(text, facts))
        throw new Error('narration introduced an ungrounded figure');
      return { value: out, engine: `llm:${this.llm.name}/${this.llm.model}` };
    } catch (error) {
      this.logger.warn(
        `LLM narration fell back to deterministic text: ${error instanceof Error ? error.message : error}`,
      );
      return { value: deterministic, engine: 'deterministic (llm fallback)' };
    }
  }

  private async event(tx: Tx, missionId: string, e: EventInput) {
    await tx.missionEvent.create({
      data: {
        missionId,
        orderId: e.orderId ?? null,
        agent: e.agent,
        kind: e.kind,
        title: e.title,
        detail: e.detail,
        source: e.source,
        engine: e.engine ?? 'deterministic',
        payloadJson: (e.payload ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  /** Derives mission state from order facts, bumps the aggregate version and emits one SSE event. */
  private async syncMission(
    tx: Tx,
    missionId: string,
    eventType: string,
    replanBlocked = false,
  ): Promise<MissionState> {
    const mission = await tx.mission.findUniqueOrThrow({
      where: { id: missionId },
      include: { orders: true, intents: { orderBy: { createdAt: 'asc' }, take: 1 } },
    });
    const spec = mission.intents[0]!.confirmedSnapshotJson as unknown as IntentSpec;
    const stored = (mission.planJson ?? null) as StoredPlan | null;
    const state = deriveMissionState(mission.orders.map(toLike), spec.quantity, {
      hasPlan: mission.planRound > 0,
      replanBlocked: replanBlocked || stored?.status === 'INFEASIBLE',
    });
    const updated = await tx.mission.update({
      where: { id: missionId },
      data: { state, version: { increment: 1 } },
    });
    await this.outbox.append(tx, {
      tenantId: mission.orgTenantId,
      aggregateType: 'mission',
      aggregateId: missionId,
      version: updated.version,
      eventType,
      payload: { missionId, state },
      isSimulated: this.rail.mode === 'SIMULATED' || mission.isDemo,
    });
    return state as MissionState;
  }

  private async issueReceipt(tx: Tx, missionId: string) {
    const mission = await tx.mission.findUniqueOrThrow({
      where: { id: missionId },
      include: { orders: true, intents: { orderBy: { createdAt: 'asc' }, take: 1 } },
    });
    const spec = mission.intents[0]!.confirmedSnapshotJson as unknown as IntentSpec;
    const names = await this.tenantNames(mission.orders.map((o) => o.merchantTenantId));
    const sum = (states: string[]) =>
      mission.orders
        .filter((o) => states.includes(o.state))
        .reduce((a, o) => a + o.amountMinor, 0n);
    const delivered = mission.orders
      .filter((o) => o.state === 'DELIVERED')
      .reduce((a, o) => a + (o.quantityReceived ?? 0), 0);
    const summary = {
      missionTitle: mission.title,
      requestedUnits: spec.quantity,
      deliveredUnits: delivered,
      totalPaidMinor: sum(['DELIVERED']).toString(),
      currency: mission.currency,
      refundedMinor: sum(['REFUNDED']).toString(),
      voidedMinor: sum(['VOIDED']).toString(),
      recoveries: mission.orders.filter((o) => o.stockoutAt).length,
      lines: mission.orders
        .filter((o) => o.state === 'DELIVERED')
        .map((o) => ({
          orderId: o.id,
          merchantName: names.get(o.merchantTenantId) ?? 'Merchant',
          sku: o.sku,
          quantity: o.quantity,
          quantityReceived: o.quantityReceived ?? 0,
          amountMinor: o.amountMinor.toString(),
          paypalCaptureId: o.paypalCaptureId,
          paypalMode: o.railMode,
          tracking: o.trackingNumber,
        })),
      evidenceNote:
        'PayPal (or the labelled simulated rail) establishes payment state. Delivery is recorded only from the organization’s own acknowledgment. This receipt is a NeedMesh record, not a PayPal-issued document or an independent audit.',
    };
    const last = await tx.missionReceipt.findFirst({
      where: { missionId },
      orderBy: { revision: 'desc' },
    });
    await tx.missionReceipt.create({
      data: {
        missionId,
        revision: (last?.revision ?? 0) + 1,
        artifactHash: hashObject(summary),
        summaryJson: summary as unknown as Prisma.InputJsonValue,
      },
    });
    await this.event(tx, missionId, {
      agent: 'RECONCILIATION',
      kind: 'receipt.issued',
      title: 'Mission Receipt issued',
      detail: `${delivered} of ${spec.quantity} units confirmed received. Payment references are linked to recipient-confirmed delivery.`,
      source: 'POLICY_DERIVED',
      payload: { artifactHash: hashObject(summary) },
    });
  }

  private toReceiptView(row: {
    id: string;
    revision: number;
    artifactHash: string;
    generatedAt: Date;
    summaryJson: Prisma.JsonValue;
  }): MissionReceiptView {
    const s = row.summaryJson as unknown as Omit<
      MissionReceiptView,
      'id' | 'revision' | 'artifactHash' | 'generatedAt'
    >;
    return {
      id: row.id,
      revision: row.revision,
      artifactHash: row.artifactHash,
      generatedAt: row.generatedAt.toISOString(),
      ...s,
    };
  }

  /**
   * 'org': only the requesting organization. 'read': also anyone signed in when the mission is
   * published. 'fund': also sponsors of other tenants when the mission is published.
   */
  private async load(
    principal: Principal,
    id: string,
    access: 'org' | 'read' | 'fund' = 'org',
  ): Promise<Loaded> {
    const mission = await this.prisma.mission.findFirst({
      where: { id },
      include: {
        intents: { orderBy: { createdAt: 'asc' }, take: 1 },
        orders: { orderBy: [{ planRound: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    const intent = mission?.intents[0];
    if (!mission || !intent) throw AppError.notFound('Mission');
    const own = mission.orgTenantId === principal.tenantId;
    const published = mission.visibility === 'PUBLIC';
    const supplier = mission.orders.some((o) => o.merchantTenantId === principal.tenantId);
    const allowed =
      own ||
      (access === 'read' && (published || supplier)) ||
      (published && access === 'fund' && principal.role === 'SPONSOR');
    if (!allowed) throw AppError.notFound('Mission');
    return { mission, spec: intent.confirmedSnapshotJson as unknown as IntentSpec };
  }

  private async reload(principal: Principal, id: string): Promise<MissionRow> {
    return (await this.load(principal, id, 'read')).mission;
  }

  private findOrder(mission: MissionRow, orderId: string): MissionOrder {
    const order = mission.orders.find((o) => o.id === orderId);
    if (!order) throw AppError.notFound('Order');
    return order;
  }

  private async tenantNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.tenant.findMany({ where: { id: { in: unique } } });
    return new Map(rows.map((t) => [t.id, t.name]));
  }

  private async listedMerchants(productKind: string): Promise<Set<string>> {
    const catalog = await this.catalog.loadCatalog(productKind);
    return new Set(catalog.map((c) => c.merchant.tenantId));
  }

  private policyContext(
    mission: MissionRow,
    order: MissionOrder,
    listed: Set<string>,
  ): MissionPolicyContext {
    const others = mission.orders.filter((o) => o.id !== order.id).map(toLike);
    return {
      missionOrgTenantId: mission.orgTenantId,
      missionPublic: mission.visibility === 'PUBLIC',
      missionState: mission.state as MissionState,
      missionCurrency: mission.currency,
      budgetMinor: mission.budgetMinor,
      committedOtherMinor: committedMinor(others),
      railMode: this.rail.mode,
      liveWritesEnabled: this.env.ENABLE_LIVE_PAYPAL_WRITES,
      listedMerchantTenantIds: listed,
      order: {
        state: order.state as MissionOrderState,
        amountMinor: order.amountMinor,
        currency: order.currency,
        quantity: order.quantity,
        merchantTenantId: order.merchantTenantId,
        quoteHash: order.quoteHash,
        expectedQuoteHash: computeQuoteHash({
          missionId: order.missionId,
          catalogProductId: order.catalogProductId,
          merchantTenantId: order.merchantTenantId,
          quantity: order.quantity,
          unitPriceMinor: order.unitPriceMinor,
          amountMinor: order.amountMinor,
          currency: order.currency,
          planRound: order.planRound,
        }),
        stockConfirmed: order.stockConfirmedAt !== null,
        refundApproved: order.refundApprovedAt !== null,
        hasAuthorization: order.paypalAuthorizationId !== null,
        hasCapture: order.paypalCaptureId !== null,
      },
    };
  }

  /** Policy gate. A DENY is persisted to the timeline (so judges can see the guardrail work) and raised. */
  private async enforce(
    principal: Principal,
    loaded: Loaded,
    order: MissionOrder,
    action: MissionAction,
    extra: { quantityReceived?: number },
  ): Promise<PolicyDecision> {
    const listed = await this.listedMerchants(loaded.spec.productKind);
    const decision = evaluateMissionPolicy(
      {
        action,
        actorRole: principal.role,
        actorTenantId: principal.tenantId,
        quantityReceived: extra.quantityReceived,
      },
      this.policyContext(loaded.mission, order, listed),
    );
    if (decision.decision !== 'ALLOW') {
      await this.prisma.missionEvent.create({
        data: {
          missionId: loaded.mission.id,
          orderId: order.id,
          agent: 'POLICY_ENGINE',
          kind: 'policy.denied',
          title: `Policy blocked ${action.replace(/_/g, ' ').toLowerCase()}`,
          detail: decision.reasons.map((r) => r.message).join(' '),
          source: 'POLICY_DERIVED',
          payloadJson: { reasons: decision.reasons, policyVersion: decision.policyVersion },
        },
      });
      throw new AppError(
        'POLICY_DENIED',
        decision.reasons[0]?.message ?? 'The financial policy denied this action.',
        422,
        { reasons: decision.reasons, policyVersion: decision.policyVersion },
      );
    }
    return decision;
  }

  private toOrderView(
    o: MissionOrder,
    mission: MissionRow,
    all: MissionOrder[],
    names: Map<string, string>,
    listed: Set<string>,
    principal: Principal,
    extra: {
      spec: IntentSpec;
      now: Date;
      userNames: Map<string, string>;
      negotiated: Map<string, { listUnitPriceMinor: bigint }>;
    },
  ): MissionOrderView {
    const state = o.state as MissionOrderState;
    const viewerIsOrg = mission.orgTenantId === principal.tenantId;
    const ctx = this.policyContext({ ...mission, orders: all }, o, listed);
    const allows = (action: MissionAction, quantityReceived?: number) =>
      evaluateMissionPolicy(
        {
          action,
          actorRole: principal.role,
          actorTenantId: principal.tenantId,
          quantityReceived,
        },
        ctx,
      ).decision === 'ALLOW';
    const allowedActions: MissionOrderView['allowedActions'] = [];
    if (allows('APPROVE_ORDER')) allowedActions.push('APPROVE');
    if (state === 'PAYPAL_ORDER_CREATED' && principal.role === 'SPONSOR')
      allowedActions.push('AUTHORIZE_RETURN');
    const demoConsole =
      this.demoControlsEnabled &&
      viewerIsOrg &&
      MERCHANT_ROLES.includes(principal.role as (typeof MERCHANT_ROLES)[number]);
    const ownMerchant = isMerchantRole(principal.role) && principal.tenantId === o.merchantTenantId;
    if (demoConsole || ownMerchant) {
      if (state === 'AUTHORIZED') allowedActions.push('MERCHANT_CONFIRM', 'MERCHANT_STOCKOUT');
      if (state === 'CAPTURED') allowedActions.push('MERCHANT_SHIP', 'MERCHANT_STOCKOUT');
      if (state === 'AWAITING_APPROVAL' || state === 'PAYPAL_ORDER_CREATED')
        allowedActions.push('MERCHANT_STOCKOUT');
      if (state === 'REFUND_PENDING') allowedActions.push('MERCHANT_APPROVE_REFUND');
    }
    if (allows('ACKNOWLEDGE', o.quantity)) allowedActions.push('ACKNOWLEDGE');

    return {
      id: o.id,
      planRound: o.planRound,
      replacesOrderId: o.replacesOrderId,
      merchantName: names.get(o.merchantTenantId) ?? 'Merchant',
      merchantTenantId: o.merchantTenantId,
      sku: o.sku,
      title: o.title,
      quantity: o.quantity,
      unitPriceMinor: o.unitPriceMinor.toString(),
      amountMinor: o.amountMinor.toString(),
      currency: o.currency,
      state,
      estimatedDeliveryAt: o.estimatedDeliveryAt?.toISOString() ?? null,
      quoteHash: o.quoteHash,
      stockConfirmed: o.stockConfirmedAt !== null,
      stockoutAt: o.stockoutAt?.toISOString() ?? null,
      paypal: {
        mode: o.railMode === 'SANDBOX' ? 'SANDBOX' : 'SIMULATED',
        orderId: o.paypalOrderId,
        authorizationId: o.paypalAuthorizationId,
        captureId: o.paypalCaptureId,
        refundId: o.paypalRefundId,
        approveUrl: state === 'PAYPAL_ORDER_CREATED' ? o.approveUrl : null,
        lastVerifiedAt: o.paypalLastVerifiedAt?.toISOString() ?? null,
      },
      tracking:
        o.trackingNumber && o.shippedAt
          ? {
              carrier: o.carrier ?? 'Carrier',
              trackingNumber: o.trackingNumber,
              shippedAt: o.shippedAt.toISOString(),
            }
          : null,
      receipt:
        o.acknowledgedAt && o.quantityReceived !== null
          ? {
              quantityReceived: o.quantityReceived,
              note: o.receiptNote,
              acknowledgedAt: o.acknowledgedAt.toISOString(),
            }
          : null,
      fundedBy:
        o.approvedBy !== null
          ? {
              sponsorName: extra.userNames.get(o.approvedBy) ?? 'Sponsor',
              sponsorOrg:
                (o.sponsorTenantId && names.get(o.sponsorTenantId)) || 'Organization sponsor',
              approvedAt: o.approvedAt?.toISOString() ?? null,
            }
          : null,
      negotiated: o.proposalId
        ? {
            proposalId: o.proposalId,
            listUnitPriceMinor: (
              extra.negotiated.get(o.catalogProductId)?.listUnitPriceMinor ?? o.unitPriceMinor
            ).toString(),
          }
        : null,
      protection: deriveProtection(
        { ...o, state },
        {
          deadline: new Date(extra.spec.deadlineISO),
          now: extra.now,
          compatible: true,
        },
      ),
      allowedActions,
    };
  }

  /** Connected catalog with merchant-accepted proposal terms applied. */
  private async catalogFor(missionId: string, productKind: string) {
    const [raw, rows] = await Promise.all([
      this.catalog.loadCatalog(productKind),
      this.prisma.merchantProposal.findMany({
        where: { missionId, state: 'ACCEPTED', agreedUnitPriceMinor: { not: null } },
        orderBy: { orgAcceptedAt: 'asc' },
      }),
    ]);
    const accepted = rows
      .filter((p) =>
        raw.some((c) => c.id === p.catalogProductId && c.merchant.tenantId === p.merchantTenantId),
      )
      .map((p) => ({
        proposalId: p.id,
        catalogProductId: p.catalogProductId,
        sku: raw.find((c) => c.id === p.catalogProductId)?.sku ?? '',
        agreedUnitPriceMinor: p.agreedUnitPriceMinor!,
        quantity: p.quantity,
        leadTimeHours: p.leadTimeHours,
      }));
    const applied = applyAcceptedTerms(raw, accepted);
    return { catalog: applied.catalog, negotiated: applied.negotiated, accepted, raw };
  }

  private supplyNodes(
    spec: IntentSpec,
    supply: { catalog: CatalogItem[]; negotiated: Map<string, { listUnitPriceMinor: bigint }> },
    names: Map<string, string>,
    allocated: Map<string, number>,
    now: Date,
  ): SupplyNodeView[] {
    const offers = solveOffers(spec, supply.catalog, now).offers;
    return supply.catalog.map((item) => {
      const offer = offers.find((x) => x.productId === item.id);
      const failed = (offer?.checks ?? []).filter(
        (c) => !c.passed && c.constraintId !== 'budget' && c.constraintId !== 'stock',
      );
      const list = supply.negotiated.get(item.id)?.listUnitPriceMinor;
      return {
        productId: item.id,
        sku: item.sku,
        title: item.title,
        merchantTenantId: item.merchant.tenantId,
        merchantName: names.get(item.merchant.tenantId) ?? item.merchant.name,
        unitPriceMinor: (list ?? item.unitPriceMinor).toString(),
        negotiatedUnitPriceMinor: list !== undefined ? item.unitPriceMinor.toString() : null,
        inventoryQty: item.inventoryQty,
        leadTimeHours: item.leadTimeHours,
        availability: item.isDemo
          ? 'SIMULATED'
          : now.getTime() - item.lastVerifiedAt.getTime() > STALE_AFTER_MS
            ? 'STALE'
            : 'VERIFIED',
        compatible: failed.length === 0,
        reasons:
          failed.length > 0
            ? failed.map((c) => `${c.label}: ${c.detail}`)
            : [
                `Meets every hard constraint; ${item.inventoryQty} in stock, ${item.leadTimeHours}h lead time.`,
              ],
        allocated: allocated.get(item.id) ?? 0,
      };
    });
  }

  private async recordRun(
    tx: Tx,
    tenantId: string,
    missionId: string,
    workflow: string,
    nodes: RunNode[],
    startedAt: Date,
    engine: string,
  ) {
    await tx.agentRun.create({
      data: {
        tenantId,
        workflow,
        entityId: missionId,
        llmProvider:
          engine === 'deterministic' ? 'none' : (engine.split(':')[1]?.split('/')[0] ?? 'llm'),
        model: engine,
        promptVersion: 'needmesh-graph@1.0.0',
        state: nodes.some((n) => n.status === 'FAILED') ? 'COMPLETED_WITH_GAPS' : 'COMPLETED',
        startedAt,
        endedAt: new Date(),
        summarizedToolTraceJson: nodes as unknown as Prisma.InputJsonValue,
      },
    });
  }
}

// ------------------------------------------------------------------ deterministic narration

function deterministicPlanNarration(
  spec: IntentSpec,
  budgetMinor: bigint,
  plan: MissionPlanResult,
) {
  const money = (m: bigint) => formatMoney(m, spec.currency);
  const lines = plan.lines.map(
    (l) =>
      `${l.product.merchant.name}: ${l.quantity} × ${money(l.unitPriceMinor)} = ${money(l.amountMinor)}`,
  );
  const empty = plan.lines.length === 0;
  const headline = empty
    ? 'No merchant can satisfy this need inside the constraints.'
    : `${plan.lines.length} merchant order${plan.lines.length === 1 ? '' : 's'} cover ${plan.plannedQuantity} of ${plan.requestedQuantity} ${spec.unit} for ${money(plan.totalMinor)}, ${money(budgetMinor - plan.totalMinor)} under the ${money(budgetMinor)} limit.`;
  const rationale = empty
    ? (plan.shortfallReason ?? 'No eligible supply.')
    : `${lines.join('; ')}. Cheapest eligible units were filled first; items that break a hard constraint were excluded.${plan.excluded.length ? ` Excluded: ${plan.excluded.map((e) => `${e.merchantName} ${e.sku}`).join(', ')}.` : ''}`;
  const tradeoffs = [
    'Each merchant is a separate PayPal order, so each needs its own sponsor approval.',
    'Delivery times are seller estimates until a merchant confirms stock.',
    ...(plan.unmetQuantity > 0
      ? [`${plan.unmetQuantity} units remain uncovered. ${plan.shortfallReason ?? ''}`.trim()]
      : []),
  ];
  const narration: Narration = { headline, rationale, tradeoffs };
  return {
    narration,
    facts: { kind: 'plan', lines, excluded: plan.excluded, headline, rationale, tradeoffs },
  };
}

function deterministicRecoveryNarration(args: {
  merchant: string;
  remedy: string;
  lostQuantity: number;
  spec: IntentSpec;
  plan: MissionPlanResult;
  currency: string;
  names: Map<string, string>;
}) {
  const { merchant, remedy, lostQuantity, spec, plan, currency, names } = args;
  const money = (m: bigint) => formatMoney(m, currency);
  const remedyText =
    remedy === 'VOID_AUTHORIZATION'
      ? 'its uncaptured PayPal authorization was voided, so the sponsor is not charged'
      : remedy === 'REQUEST_REFUND'
        ? 'its captured payment needs a merchant-authorized refund'
        : remedy === 'CANCEL_UNFUNDED'
          ? 'the unfunded order was cancelled'
          : 'its funds were already released';
  const lines = plan.lines.map(
    (l) =>
      `${names.get(l.product.merchant.tenantId) ?? l.product.merchant.name}: ${l.quantity} × ${money(l.unitPriceMinor)} = ${money(l.amountMinor)}`,
  );
  const empty = plan.lines.length === 0;
  const headline = empty
    ? `${merchant} cannot supply ${lostQuantity} ${spec.unit} and no replacement fits the constraints.`
    : `${merchant} cannot supply ${lostQuantity} ${spec.unit}; ${remedyText}. ${plan.lines.length} replacement order${plan.lines.length === 1 ? '' : 's'} cover ${plan.plannedQuantity} units for ${money(plan.totalMinor)}.`;
  const rationale = empty
    ? (plan.shortfallReason ?? 'No eligible supply remains.')
    : `${lines.join('; ')}. The failed merchant was excluded and the remaining budget respected. The original payment is never redirected; replacements require new sponsor approval.`;
  const tradeoffs = [
    'Replacement orders are new PayPal checkouts and need fresh sponsor approval.',
    ...(plan.unmetQuantity > 0
      ? [`${plan.unmetQuantity} units are still uncovered. ${plan.shortfallReason ?? ''}`.trim()]
      : []),
  ];
  const narration: Narration = { headline, rationale, tradeoffs };
  return {
    narration,
    facts: { kind: 'recovery', merchant, remedy, lines, headline, rationale, tradeoffs },
  };
}
