import { Injectable } from '@nestjs/common';
import {
  type AnalyticsView,
  type IntentSpec,
  type MarketplaceMissionCard,
  type MarketplaceView,
  type MerchantWorkspaceView,
  type MissionEventSource,
  type MissionState,
  type NotificationView,
  type OrgProfileView,
  type Preferences,
  type ProposalDecisionRequest,
  type PublishMissionRequest,
  type RepeatMissionRequest,
  type ShortageForecastView,
  type SubmitProposalRequest,
  type VerificationRequest,
  PreferencesSchema,
  formatMoney,
} from '@promesa/contracts';
import { type MissionOrder, type Prisma, type Tenant } from '@prisma/client';
import { AppError } from '../../common/errors';
import { PrismaService, type Tx } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CatalogService } from '../commerce/catalog.service';
import { solveOffers } from '../commerce/offer-solver';
import { resolveClock } from '../demo/clock';
import { OutboxService } from '../events/outbox.service';
import { type Principal } from '../identity/principal';
import { validateIntent } from '../intent/intent-validation';
import { MissionsService } from '../missions/missions.service';
import { forecastShortages, matchSponsor } from './matching';
import { evaluateProposal } from './negotiation';
import { toProposalView } from './proposal-view';

type MissionWithAll = Prisma.MissionGetPayload<{
  include: { intents: true; orders: true; proposals: true };
}>;

const CATEGORY_LABELS: Record<string, string> = {
  hygiene: 'Hygiene & care',
  food: 'Food & bakery',
  packaging: 'Packaging',
  shelter: 'Shelter & bedding',
  education: 'Education',
  medical: 'Medical supplies',
  supplies: 'General supplies',
};

const RELEASED = ['CANCELLED', 'VOIDED', 'REFUNDED'];
const TERMINAL: MissionState[] = ['COMPLETED', 'CANCELLED', 'EXPIRED'];
const isLive = (o: MissionOrder) => !RELEASED.includes(o.state);
const isFunded = (o: MissionOrder) =>
  isLive(o) && (o.approvedAt !== null || o.paypalAuthorizationId !== null);
const isOrgRole = (p: Principal) => p.role === 'ORG_ADMIN' || p.role === 'ORG_OPERATOR';
const isMerchant = (p: Principal) => p.role === 'MERCHANT_ADMIN' || p.role === 'MERCHANT_OPERATOR';

const specOf = (m: { intents: Array<{ confirmedSnapshotJson: Prisma.JsonValue }> }) =>
  m.intents[0]!.confirmedSnapshotJson as unknown as IntentSpec;

function readPreferences(t: Tenant): Preferences {
  const parsed = PreferencesSchema.safeParse(t.preferencesJson ?? {});
  return parsed.success
    ? parsed.data
    : { requiredAttributes: [], prohibitedAttributes: [], categories: [] };
}

function readProfile(t: Tenant) {
  const p = (t.publicProfileJson ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : null);
  return { city: s('city'), missionStatement: s('missionStatement'), website: s('website') };
}

/**
 * Reverse marketplace, merchant proposals and negotiation, organization trust & preferences,
 * repeat missions, analytics, shortage forecast and notifications. All deterministic.
 * Public projections never include delivery addresses, beneficiary identities or raw request text.
 */
@Injectable()
export class MarketplaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly missions: MissionsService,
  ) {}

  // ------------------------------------------------------------------ marketplace

  async marketplace(
    viewer: Principal | null,
    query: { q?: string; category?: string },
  ): Promise<MarketplaceView> {
    const rows = await this.prisma.mission.findMany({
      where: { visibility: 'PUBLIC' },
      include: {
        intents: { orderBy: { createdAt: 'asc' }, take: 1 },
        orders: true,
        proposals: true,
      },
      orderBy: [{ publishedAt: 'desc' }],
      take: 100,
    });
    const orgs = await this.tenants(rows.map((r) => r.orgTenantId));
    const viewerTenant = viewer
      ? await this.prisma.tenant.findUnique({ where: { id: viewer.tenantId } })
      : null;
    const interests =
      viewer?.role === 'SPONSOR' && viewerTenant ? readPreferences(viewerTenant) : null;
    const clock = await resolveClock(this.prisma, null);

    const all = rows.map((m) => this.toCard(m, orgs.get(m.orgTenantId)!, interests, clock.now));
    const q = query.q?.trim().toLowerCase();
    const filtered = all.filter(
      (c) =>
        (!query.category || c.category === query.category) &&
        (!q ||
          [c.title, c.productLabel, c.orgName, c.publicSummary ?? '', c.category]
            .join(' ')
            .toLowerCase()
            .includes(q)),
    );
    if (interests) filtered.sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0));
    const counts = new Map<string, number>();
    for (const c of all) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
    return {
      asOf: clock.now.toISOString(),
      categories: [...counts].map(([key, count]) => ({
        key,
        label: CATEGORY_LABELS[key] ?? key,
        count,
      })),
      missions: filtered,
      viewer: { role: viewer?.role ?? null, tenantName: viewer?.tenantName ?? null },
    };
  }

  private toCard(
    m: MissionWithAll,
    org: Tenant,
    interests: Preferences | null,
    now: Date,
  ): MarketplaceMissionCard {
    const spec = specOf(m);
    const live = m.orders.filter(isLive);
    const open = live.filter((o) => o.state === 'AWAITING_APPROVAL');
    const unfunded = open.reduce((a, o) => a + o.amountMinor, 0n);
    const sum = (xs: MissionOrder[], f: (o: MissionOrder) => number) =>
      xs.reduce((a, o) => a + f(o), 0);
    return {
      id: m.id,
      title: m.title,
      category: m.category,
      state: m.state as MissionState,
      orgName: org.name,
      orgVerified: org.verifiedAt !== null,
      orgCity: readProfile(org).city,
      publicSummary: m.publicSummary,
      productLabel: spec.productLabel,
      quantity: spec.quantity,
      unit: spec.unit,
      requiredAttributes: spec.requiredAttributes,
      prohibitedAttributes: spec.prohibitedAttributes,
      budgetMinor: m.budgetMinor.toString(),
      currency: m.currency,
      deadline: m.deadline.toISOString(),
      timezone: m.timezone,
      publishedAt: m.publishedAt?.toISOString() ?? null,
      isDemo: m.isDemo,
      progress: {
        requested: spec.quantity,
        planned: sum(live, (o) => o.quantity),
        funded: sum(live.filter(isFunded), (o) => o.quantity),
        received: sum(m.orders, (o) => o.quantityReceived ?? 0),
      },
      unfundedMinor: unfunded.toString(),
      openOrders: open.length,
      proposals: m.proposals.filter((p) => p.state === 'SUBMITTED' || p.state === 'COUNTERED')
        .length,
      match: interests
        ? matchSponsor(
            {
              categories: interests.categories,
              maxOrderMinor: interests.maxOrderMinor ? BigInt(interests.maxOrderMinor) : null,
            },
            {
              category: m.category,
              deadline: m.deadline,
              orgVerified: org.verifiedAt !== null,
              openOrderAmounts: open.map((o) => o.amountMinor),
              unfundedMinor: unfunded,
              currency: m.currency,
            },
            now,
          )
        : null,
    };
  }

  async publish(
    principal: Principal,
    missionId: string,
    body: PublishMissionRequest,
    correlationId: string,
  ) {
    const mission = await this.ownMission(principal, missionId);
    if (principal.role !== 'ORG_ADMIN')
      throw AppError.forbidden('Only an organization admin can change mission visibility.');
    const org = await this.prisma.tenant.findUniqueOrThrow({ where: { id: mission.orgTenantId } });
    if (body.visibility === 'PUBLIC' && !org.verifiedAt)
      throw new AppError(
        'ORG_NOT_VERIFIED',
        'Verify your organization in Settings before publishing missions to sponsors.',
        422,
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.mission.update({
        where: { id: missionId },
        data: {
          visibility: body.visibility,
          category: body.category,
          publicSummary: body.publicSummary,
          publishedAt: body.visibility === 'PUBLIC' ? (mission.publishedAt ?? new Date()) : null,
        },
      });
      await this.event(tx, missionId, {
        agent: 'FUNDING',
        kind: body.visibility === 'PUBLIC' ? 'mission.published' : 'mission.unpublished',
        title:
          body.visibility === 'PUBLIC'
            ? 'Published to the NeedMesh marketplace'
            : 'Removed from the marketplace',
        detail:
          body.visibility === 'PUBLIC'
            ? 'Verified sponsors can now fund individual merchant orders, and connected merchants can submit offers. Only the public summary is shown — never addresses or beneficiaries.'
            : 'Only members of the organization can see this mission now.',
        source: 'BUYER',
      });
      await this.audit.record(tx, {
        tenantId: mission.orgTenantId,
        actorType: 'USER',
        actorId: principal.userId,
        action: 'mission.publish',
        resourceType: 'mission',
        resourceId: missionId,
        after: { visibility: body.visibility, category: body.category },
        correlationId,
      });
      await this.touch(tx, missionId, 'mission.published');
    });
    return { missionId, visibility: body.visibility };
  }

  // ------------------------------------------------------------------ proposals & negotiation

  async submitProposal(
    principal: Principal,
    missionId: string,
    body: SubmitProposalRequest,
    correlationId: string,
  ) {
    if (!isMerchant(principal))
      throw AppError.forbidden('Only connected merchants can submit offers.');
    const mission = await this.missionWithAll(missionId);
    const supplier = mission.orders.some((o) => o.merchantTenantId === principal.tenantId);
    if (mission.visibility !== 'PUBLIC' && !supplier) throw AppError.notFound('Mission');
    if (TERMINAL.includes(mission.state as MissionState))
      throw AppError.conflict('MISSION_CLOSED', 'This mission no longer accepts offers.');
    const spec = specOf(mission);
    const catalog = await this.catalog.loadCatalog(spec.productKind);
    const product = catalog.find((c) => c.id === body.catalogProductId);
    if (!product || product.merchant.tenantId !== principal.tenantId)
      throw new AppError(
        'NOT_YOUR_LISTING',
        'Offers must reference one of your own listings for this kind of product.',
        422,
      );
    const duplicate = mission.proposals.find(
      (p) =>
        p.merchantTenantId === principal.tenantId &&
        p.catalogProductId === product.id &&
        (p.state === 'SUBMITTED' || p.state === 'COUNTERED'),
    );
    if (duplicate)
      throw AppError.conflict('OPEN_PROPOSAL', 'You already have an open offer for this listing.');

    const clock = await resolveClock(this.prisma, mission.scenarioKey);
    const { budgetRemaining, unitsNeeded } = this.headroom(mission, spec);
    const evaluation = evaluateProposal({
      intent: spec,
      product,
      terms: {
        quantity: body.quantity,
        unitPriceMinor: BigInt(body.unitPriceMinor),
        leadTimeHours: body.leadTimeHours,
      },
      now: clock.now,
      budgetRemainingMinor: budgetRemaining,
      unitsStillNeeded: unitsNeeded,
    });
    const created = await this.prisma.$transaction(async (tx) => {
      const p = await tx.merchantProposal.create({
        data: {
          missionId,
          merchantTenantId: principal.tenantId,
          catalogProductId: product.id,
          submittedBy: principal.userId,
          quantity: body.quantity,
          unitPriceMinor: BigInt(body.unitPriceMinor),
          leadTimeHours: body.leadTimeHours,
          deliveryTerms: body.deliveryTerms,
          note: body.note ?? null,
          evaluationJson: {
            compatible: evaluation.compatible,
            recommendation: evaluation.recommendation,
            targetUnitPriceMinor: evaluation.targetUnitPriceMinor.toString(),
            rationale: evaluation.rationale,
            checks: evaluation.checks,
            listUnitPriceMinor: product.unitPriceMinor.toString(),
            sku: product.sku,
            title: product.title,
          },
        },
      });
      await this.event(tx, missionId, {
        agent: 'NEGOTIATION',
        kind: 'proposal.submitted',
        title: `${principal.tenantName} offered ${body.quantity} × ${product.sku} at ${formatMoney(BigInt(body.unitPriceMinor), mission.currency)}`,
        detail: `Negotiation agent recommends ${evaluation.recommendation.toLowerCase()}: ${evaluation.rationale}`,
        source: 'MERCHANT',
        payload: { proposalId: p.id, recommendation: evaluation.recommendation },
      });
      await this.audit.record(tx, {
        tenantId: principal.tenantId,
        actorType: 'USER',
        actorId: principal.userId,
        action: 'proposal.submit',
        resourceType: 'merchant_proposal',
        resourceId: p.id,
        after: { missionId, unitPriceMinor: body.unitPriceMinor, quantity: body.quantity },
        correlationId,
      });
      await this.touch(tx, missionId, 'proposal.submitted');
      return p;
    });
    return { proposalId: created.id, recommendation: evaluation.recommendation };
  }

  async decide(
    principal: Principal,
    proposalId: string,
    body: ProposalDecisionRequest,
    correlationId: string,
  ) {
    const p = await this.prisma.merchantProposal.findUnique({ where: { id: proposalId } });
    if (!p) throw AppError.notFound('Proposal');
    const mission = await this.missionWithAll(p.missionId);
    const isOrg = mission.orgTenantId === principal.tenantId && isOrgRole(principal);
    const isOwner = p.merchantTenantId === principal.tenantId && isMerchant(principal);
    const ev = (p.evaluationJson ?? {}) as { targetUnitPriceMinor?: string; sku?: string };
    const money = (m: bigint) => formatMoney(m, mission.currency);
    const sku = ev.sku ?? 'listing';

    type Change = {
      data: Prisma.MerchantProposalUpdateInput;
      title: string;
      detail: string;
      source: MissionEventSource;
    };
    let change: Change;
    switch (body.action) {
      case 'ORG_ACCEPT': {
        if (!isOrg) throw AppError.forbidden('Only the requesting organization can accept offers.');
        if (p.state !== 'SUBMITTED')
          throw AppError.conflict('INVALID_STATE', `Offer is ${p.state.toLowerCase()}.`);
        change = {
          data: {
            state: 'ACCEPTED',
            agreedUnitPriceMinor: p.unitPriceMinor,
            orgAcceptedBy: principal.userId,
            orgAcceptedAt: new Date(),
            merchantAcceptedAt: p.createdAt,
          },
          title: `Offer accepted: ${p.quantity} × ${sku} at ${money(p.unitPriceMinor)}`,
          detail:
            'The merchant proposed these terms and the organization accepted them. The planner will use them on the next plan or re-plan. No money moves until a sponsor approves an order.',
          source: 'BUYER',
        };
        break;
      }
      case 'ORG_COUNTER': {
        if (!isOrg) throw AppError.forbidden('Only the requesting organization can counter.');
        if (p.state !== 'SUBMITTED')
          throw AppError.conflict('INVALID_STATE', `Offer is ${p.state.toLowerCase()}.`);
        const counter = BigInt(body.counterUnitPriceMinor ?? ev.targetUnitPriceMinor ?? '0');
        if (counter <= 0n || counter >= p.unitPriceMinor)
          throw new AppError(
            'INVALID_COUNTER',
            'A counteroffer must be positive and below the offered price.',
            422,
          );
        change = {
          data: {
            state: 'COUNTERED',
            counterUnitPriceMinor: counter,
            counterRationale: `Counter at ${money(counter)}/unit keeps the remaining units inside the mission budget.`,
            counteredBy: principal.userId,
            counteredAt: new Date(),
          },
          title: `Counteroffer sent: ${money(counter)}/unit for ${sku}`,
          detail:
            'Waiting for the merchant to accept or withdraw. Nothing is agreed until the merchant explicitly accepts.',
          source: 'BUYER',
        };
        break;
      }
      case 'ORG_DECLINE': {
        if (!isOrg) throw AppError.forbidden('Only the requesting organization can decline.');
        if (p.state !== 'SUBMITTED' && p.state !== 'COUNTERED')
          throw AppError.conflict('INVALID_STATE', `Offer is ${p.state.toLowerCase()}.`);
        change = {
          data: { state: 'DECLINED' },
          title: `Offer for ${sku} declined`,
          detail: 'The organization declined this offer.',
          source: 'BUYER',
        };
        break;
      }
      case 'MERCHANT_ACCEPT': {
        if (!isOwner) throw AppError.forbidden('Only the offering merchant can accept a counter.');
        if (p.state !== 'COUNTERED' || !p.counterUnitPriceMinor)
          throw AppError.conflict('INVALID_STATE', 'There is no counteroffer to accept.');
        change = {
          data: {
            state: 'ACCEPTED',
            agreedUnitPriceMinor: p.counterUnitPriceMinor,
            merchantAcceptedAt: new Date(),
            orgAcceptedBy: p.counteredBy,
            orgAcceptedAt: p.counteredAt,
          },
          title: `${principal.tenantName} accepted the counter: ${money(p.counterUnitPriceMinor)}/unit`,
          detail:
            'Both sides explicitly agreed. The planner will use this price on the next plan or re-plan.',
          source: 'MERCHANT',
        };
        break;
      }
      case 'MERCHANT_WITHDRAW': {
        if (!isOwner) throw AppError.forbidden('Only the offering merchant can withdraw.');
        if (p.state !== 'SUBMITTED' && p.state !== 'COUNTERED')
          throw AppError.conflict('INVALID_STATE', `Offer is ${p.state.toLowerCase()}.`);
        change = {
          data: { state: 'WITHDRAWN' },
          title: `${principal.tenantName} withdrew the offer for ${sku}`,
          detail: 'No agreement was reached.',
          source: 'MERCHANT',
        };
        break;
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.merchantProposal.updateMany({
        where: { id: p.id, version: p.version },
        data: {
          ...(change.data as Prisma.MerchantProposalUpdateManyMutationInput),
          version: { increment: 1 },
        },
      });
      if (claimed.count !== 1)
        throw AppError.conflict('PROPOSAL_CHANGED', 'The offer changed. Refresh and try again.');
      await this.event(tx, p.missionId, {
        agent: 'NEGOTIATION',
        kind: `proposal.${body.action.toLowerCase()}`,
        title: change.title,
        detail: change.detail,
        source: change.source,
        payload: { proposalId: p.id },
      });
      await this.audit.record(tx, {
        tenantId: principal.tenantId,
        actorType: 'USER',
        actorId: principal.userId,
        action: `proposal.${body.action.toLowerCase()}`,
        resourceType: 'merchant_proposal',
        resourceId: p.id,
        correlationId,
      });
      await this.touch(tx, p.missionId, 'proposal.updated');
    });
    return { proposalId: p.id };
  }

  async merchantWorkspace(principal: Principal): Promise<MerchantWorkspaceView> {
    if (!isMerchant(principal))
      throw AppError.forbidden('The merchant workspace is for merchant accounts.');
    const [products, missions, proposals, orders] = await Promise.all([
      this.prisma.catalogProduct.findMany({
        where: { sellerTenantId: principal.tenantId },
        orderBy: { sku: 'asc' },
      }),
      this.prisma.mission.findMany({
        where: { visibility: 'PUBLIC', state: { notIn: TERMINAL } },
        include: {
          intents: { orderBy: { createdAt: 'asc' }, take: 1 },
          orders: true,
          proposals: true,
        },
        orderBy: { publishedAt: 'desc' },
      }),
      this.prisma.merchantProposal.findMany({
        where: { merchantTenantId: principal.tenantId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.missionOrder.findMany({
        where: { merchantTenantId: principal.tenantId },
        include: { mission: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    const orgs = await this.tenants(missions.map((m) => m.orgTenantId));
    const clock = await resolveClock(this.prisma, null);
    const names = await this.names([principal.tenantId]);
    const kinds = new Set(products.map((p) => p.productKind));
    const opportunities: MerchantWorkspaceView['opportunities'] = [];
    for (const m of missions) {
      const spec = specOf(m);
      if (!kinds.has(spec.productKind)) continue;
      const catalog = (await this.catalog.loadCatalog(spec.productKind)).filter(
        (c) => c.merchant.tenantId === principal.tenantId,
      );
      const offers = solveOffers(spec, catalog, clock.now).offers;
      opportunities.push({
        ...this.toCard(m, orgs.get(m.orgTenantId)!, null, clock.now),
        matchingProducts: catalog.map((c) => {
          const failed = (offers.find((o) => o.productId === c.id)?.checks ?? []).filter(
            (x) => !x.passed && x.constraintId !== 'budget' && x.constraintId !== 'stock',
          );
          return {
            productId: c.id,
            sku: c.sku,
            compatible: failed.length === 0,
            reasons: failed.length
              ? failed.map((x) => `${x.label}: ${x.detail}`)
              : ['Meets every hard constraint.'],
          };
        }),
      });
    }
    return {
      merchantName: principal.tenantName,
      catalog: products.map((p) => ({
        productId: p.id,
        sku: p.sku,
        title: p.title,
        productKind: p.productKind,
        unitPriceMinor: p.unitPriceMinor.toString(),
        inventoryQty: p.inventoryQty,
        leadTimeHours: p.leadTimeHours,
        deliveryTerms: p.deliveryTerms,
      })),
      opportunities,
      proposals: proposals.map((p) =>
        toProposalView(p, names, {
          tenantId: principal.tenantId,
          role: principal.role,
          isOrg: false,
        }),
      ),
      orders: orders.map((o) => ({
        missionId: o.missionId,
        missionTitle: o.mission.title,
        orderId: o.id,
        sku: o.sku,
        quantity: o.quantity,
        amountMinor: o.amountMinor.toString(),
        currency: o.currency,
        state: o.state,
      })),
    };
  }

  // ------------------------------------------------------------------ repeat missions

  async repeat(
    principal: Principal,
    missionId: string,
    body: RepeatMissionRequest,
    correlationId: string,
  ) {
    if (!isOrgRole(principal))
      throw AppError.forbidden('Only organization members can repeat missions.');
    const source = await this.ownMission(principal, missionId);
    const spec = specOf(source);
    const deadlineISO =
      body.deadlineISO ?? new Date(source.deadline.getTime() + 14 * 86_400_000).toISOString();
    const next: IntentSpec = { ...spec, deadlineISO };
    const validation = validateIntent(next, new Date());
    if (!validation.ok)
      throw new AppError(
        'INTENT_INVALID',
        'The repeated mission failed validation.',
        422,
        validation.issues,
      );
    const created = await this.prisma.$transaction(
      async (tx) => {
        const m = await this.missions.createInTx(
          tx,
          {
            orgTenantId: principal.tenantId,
            createdBy: principal.userId,
            title:
              source.title.replace(/\s+\(repeat.*\)$/, '') +
              ` (repeat ${deadlineISO.slice(0, 10)})`,
            rawText: source.intents[0]!.rawText,
            spec: validation.spec,
            compilerVersion: source.intents[0]!.compilerVersion,
            isDemo: source.isDemo,
          },
          { type: 'USER', id: principal.userId, correlationId },
        );
        await tx.mission.update({
          where: { id: m.id },
          data: { repeatOfMissionId: source.id, category: source.category },
        });
        await this.event(tx, m.id, {
          agent: 'MISSION_PLANNER',
          kind: 'mission.repeated',
          title: `Repeated from “${source.title}”`,
          detail: `Same confirmed need (${spec.quantity} ${spec.productLabel}, hard constraints unchanged) with a new deadline. Agents have not planned yet.`,
          source: 'BUYER',
          payload: { repeatOf: source.id },
        });
        return m;
      },
      { timeout: 20_000 },
    );
    return { missionId: created.id };
  }

  // ------------------------------------------------------------------ org trust & preferences

  async profile(principal: Principal): Promise<OrgProfileView> {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: principal.tenantId } });
    return this.toProfile(t);
  }

  async savePreferences(principal: Principal, body: Preferences, correlationId: string) {
    if (
      principal.role !== 'ORG_ADMIN' &&
      principal.role !== 'SPONSOR' &&
      principal.role !== 'BUYER'
    )
      throw AppError.forbidden('Only an admin, sponsor or buyer can change saved preferences.');
    const t = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.tenant.update({
        where: { id: principal.tenantId },
        data: { preferencesJson: body as unknown as Prisma.InputJsonValue },
      });
      await this.audit.record(tx, {
        tenantId: principal.tenantId,
        actorType: 'USER',
        actorId: principal.userId,
        action: 'tenant.preferences',
        resourceType: 'tenant',
        resourceId: principal.tenantId,
        after: body,
        correlationId,
      });
      return updated;
    });
    return this.toProfile(t);
  }

  /**
   * Demo verification: records the submitted registration details and marks the org verified with
   * method DEMO_REVIEW. A production deployment would route this to a human trust reviewer.
   */
  async requestVerification(
    principal: Principal,
    body: VerificationRequest,
    correlationId: string,
  ) {
    if (principal.role !== 'ORG_ADMIN')
      throw AppError.forbidden('Only an organization admin can request verification.');
    if (principal.tenantKind !== 'ORG')
      throw AppError.forbidden('Only organizations are verified for the marketplace.');
    const t = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.tenant.update({
        where: { id: principal.tenantId },
        data: {
          verifiedAt: new Date(),
          verificationMethod: 'DEMO_REVIEW',
          verificationNote: `Registration ${body.registrationId} (${body.legalName}) recorded. Demo review: no external registry was queried.`,
          publicProfileJson: {
            city: body.city,
            missionStatement: body.missionStatement,
            website: body.website ?? null,
          },
        },
      });
      await this.audit.record(tx, {
        tenantId: principal.tenantId,
        actorType: 'USER',
        actorId: principal.userId,
        action: 'tenant.verification',
        resourceType: 'tenant',
        resourceId: principal.tenantId,
        after: { method: 'DEMO_REVIEW', registrationId: body.registrationId },
        correlationId,
      });
      return updated;
    });
    return this.toProfile(t);
  }

  private toProfile(t: Tenant): OrgProfileView {
    return {
      tenantId: t.id,
      name: t.name,
      kind: t.kind,
      verification: {
        status: t.verifiedAt ? 'VERIFIED' : 'UNVERIFIED',
        verifiedAt: t.verifiedAt?.toISOString() ?? null,
        method: t.verificationMethod,
        note: t.verificationNote,
      },
      publicProfile: readProfile(t),
      preferences: readPreferences(t),
    };
  }

  // ------------------------------------------------------------------ analytics, forecast, notifications

  private async scopedMissions(principal: Principal) {
    const where: Prisma.MissionWhereInput = isMerchant(principal)
      ? { orders: { some: { merchantTenantId: principal.tenantId } } }
      : principal.role === 'SPONSOR'
        ? {
            OR: [
              { orgTenantId: principal.tenantId },
              { orders: { some: { sponsorTenantId: principal.tenantId } } },
            ],
          }
        : { orgTenantId: principal.tenantId };
    return this.prisma.mission.findMany({
      where,
      include: {
        intents: { orderBy: { createdAt: 'asc' }, take: 1 },
        orders: true,
        proposals: true,
      },
      orderBy: { deadline: 'asc' },
    });
  }

  async analytics(principal: Principal): Promise<AnalyticsView> {
    const missions = await this.scopedMissions(principal);
    const clock = await resolveClock(this.prisma, null);
    const scope: AnalyticsView['scope'] = isMerchant(principal)
      ? 'MERCHANT'
      : principal.role === 'SPONSOR'
        ? 'SPONSOR'
        : 'ORG';
    const relevant = (o: MissionOrder) =>
      scope === 'MERCHANT'
        ? o.merchantTenantId === principal.tenantId
        : scope === 'SPONSOR'
          ? o.sponsorTenantId === principal.tenantId ||
            (o.sponsorTenantId === null && o.approvedBy !== null)
          : true;
    const names = await this.names(
      missions.flatMap((m) => m.orders.map((o) => o.merchantTenantId)),
    );
    let requested = 0,
      funded = 0,
      delivered = 0,
      stockouts = 0,
      replacements = 0,
      recovered = 0;
    let budget = 0n,
      captured = 0n,
      neverCharged = 0n,
      refunded = 0n,
      deliveredSpend = 0n;
    const sponsors = new Set<string>();
    const merchants = new Map<string, AnalyticsView['merchants'][number]>();
    const byMission: AnalyticsView['byMission'] = [];
    for (const m of missions) {
      const spec = specOf(m);
      const orders = m.orders.filter(relevant);
      requested += spec.quantity;
      budget += m.budgetMinor;
      let spent = 0n;
      let got = 0;
      for (const o of orders) {
        if (isFunded(o)) funded += o.quantity;
        if (o.paypalCaptureId && o.state !== 'REFUNDED') {
          captured += o.amountMinor;
          spent += o.amountMinor;
        }
        if (o.state === 'VOIDED') neverCharged += o.amountMinor;
        if (o.state === 'REFUNDED') refunded += o.amountMinor;
        if (o.stockoutAt) stockouts += 1;
        if (o.replacesOrderId) {
          replacements += 1;
          recovered += o.quantityReceived ?? 0;
        }
        got += o.quantityReceived ?? 0;
        if (o.quantityReceived) deliveredSpend += o.amountMinor;
        if (o.approvedBy) sponsors.add(`${o.sponsorTenantId}:${o.approvedBy}`);
        const row = merchants.get(o.merchantTenantId) ?? {
          name: names.get(o.merchantTenantId) ?? 'Merchant',
          orders: 0,
          units: 0,
          amountMinor: '0',
          stockouts: 0,
        };
        row.orders += 1;
        row.units += o.quantityReceived ?? 0;
        if (o.paypalCaptureId && o.state !== 'REFUNDED')
          row.amountMinor = (BigInt(row.amountMinor) + o.amountMinor).toString();
        if (o.stockoutAt) row.stockouts += 1;
        merchants.set(o.merchantTenantId, row);
      }
      delivered += got;
      byMission.push({
        id: m.id,
        title: m.title,
        state: m.state as MissionState,
        requested: spec.quantity,
        delivered: got,
        spentMinor: spent.toString(),
        deadline: m.deadline.toISOString(),
      });
    }
    return {
      asOf: clock.now.toISOString(),
      scope,
      missions: {
        total: missions.length,
        completed: missions.filter((m) => m.state === 'COMPLETED').length,
        active: missions.filter((m) => !TERMINAL.includes(m.state as MissionState)).length,
        published: missions.filter((m) => m.visibility === 'PUBLIC').length,
      },
      units: {
        requested,
        funded,
        delivered,
        fulfillmentRate: requested ? Math.round((delivered / requested) * 1000) / 1000 : 0,
      },
      money: {
        currency: 'USD',
        budgetMinor: budget.toString(),
        capturedMinor: captured.toString(),
        neverChargedMinor: neverCharged.toString(),
        refundedMinor: refunded.toString(),
        avgUnitCostMinor: delivered ? (deliveredSpend / BigInt(delivered)).toString() : null,
        budgetUtilization: budget ? Number((captured * 1000n) / budget) / 1000 : 0,
      },
      recovery: { stockouts, replacementOrders: replacements, recoveredUnits: recovered },
      sponsors: sponsors.size,
      merchants: [...merchants.values()].sort((a, b) => b.orders - a.orders),
      byMission: byMission.reverse(),
    };
  }

  async forecast(principal: Principal): Promise<ShortageForecastView> {
    const missions = await this.prisma.mission.findMany({
      where: { orgTenantId: principal.tenantId, state: { not: 'CANCELLED' } },
      include: { intents: { orderBy: { createdAt: 'asc' }, take: 1 } },
    });
    const clock = await resolveClock(this.prisma, null);
    const items = forecastShortages(
      missions.map((m) => {
        const spec = specOf(m);
        return {
          missionId: m.id,
          productKind: spec.productKind,
          productLabel: spec.productLabel,
          quantity: spec.quantity,
          neededBy: m.deadline,
        };
      }),
      clock.now,
    );
    return {
      basis: `Deterministic projection from ${missions.length} of your organization's own missions (average interval between need dates). No external data is used.`,
      items,
    };
  }

  async notifications(principal: Principal): Promise<NotificationView> {
    const missions = await this.scopedMissions(principal);
    const pending: NotificationView['pending'] = [];
    const own = (m: MissionWithAll) => m.orgTenantId === principal.tenantId;
    for (const m of missions) {
      if (TERMINAL.includes(m.state as MissionState)) continue;
      const href = `/missions/${m.id}`;
      if (isOrgRole(principal) && own(m)) {
        if (m.planRound === 0)
          pending.push({
            id: `${m.id}:plan`,
            kind: 'PLAN',
            title: `Run the agents for “${m.title}”`,
            detail: 'The need is confirmed but no procurement plan exists yet.',
            href,
            severity: 'ACTION',
          });
        for (const p of m.proposals.filter((x) => x.state === 'SUBMITTED'))
          pending.push({
            id: `${p.id}:review`,
            kind: 'PROPOSAL',
            title: 'Merchant offer waiting for review',
            detail: `${p.quantity} units at ${formatMoney(p.unitPriceMinor, m.currency)}/unit on “${m.title}”.`,
            href,
            severity: 'ACTION',
          });
        for (const o of m.orders.filter((x) => x.state === 'SHIPPED'))
          pending.push({
            id: `${o.id}:ack`,
            kind: 'ACKNOWLEDGE',
            title: `Confirm what arrived: ${o.quantity} × ${o.sku}`,
            detail: 'Payment is not proof of delivery. Only your acknowledgment closes the order.',
            href,
            severity: 'ACTION',
          });
      }
      if (principal.role === 'SPONSOR') {
        const open = m.orders.filter((x) => x.state === 'AWAITING_APPROVAL');
        if (open.length)
          pending.push({
            id: `${m.id}:fund`,
            kind: 'FUND',
            title: `${open.length} order${open.length === 1 ? '' : 's'} need a sponsor on “${m.title}”`,
            detail: `${formatMoney(
              open.reduce((a, o) => a + o.amountMinor, 0n),
              m.currency,
            )} unfunded. Each order is a separate PayPal checkout.`,
            href,
            severity: 'ACTION',
          });
      }
      if (isMerchant(principal)) {
        for (const o of m.orders.filter((x) => x.merchantTenantId === principal.tenantId)) {
          if (o.state === 'AUTHORIZED')
            pending.push({
              id: `${o.id}:confirm`,
              kind: 'CONFIRM_STOCK',
              title: `Confirm stock for ${o.quantity} × ${o.sku}`,
              detail: 'The sponsor authorized payment. Funds are captured only after you confirm.',
              href,
              severity: 'ACTION',
            });
          if (o.state === 'CAPTURED')
            pending.push({
              id: `${o.id}:ship`,
              kind: 'SHIP',
              title: `Ship ${o.quantity} × ${o.sku}`,
              detail: 'Add tracking so the organization can follow delivery.',
              href,
              severity: 'ACTION',
            });
        }
        for (const p of m.proposals.filter(
          (x) => x.merchantTenantId === principal.tenantId && x.state === 'COUNTERED',
        ))
          pending.push({
            id: `${p.id}:counter`,
            kind: 'COUNTER',
            title: 'Counteroffer waiting for you',
            detail: `${formatMoney(p.counterUnitPriceMinor ?? 0n, m.currency)}/unit on “${m.title}”.`,
            href: '/merchant',
            severity: 'ACTION',
          });
      }
      for (const o of m.orders.filter((x) => x.stockoutAt && x.state === 'REFUND_PENDING'))
        pending.push({
          id: `${o.id}:refund`,
          kind: 'REFUND',
          title: `Refund pending for ${o.sku}`,
          detail: 'Captured payment: the merchant must authorize the refund.',
          href,
          severity: 'WARNING',
        });
    }
    const ids = missions.map((m) => m.id);
    const titles = new Map(missions.map((m) => [m.id, m.title]));
    const events = ids.length
      ? await this.prisma.missionEvent.findMany({
          where: { missionId: { in: ids } },
          orderBy: { seq: 'desc' },
          take: 40,
        })
      : [];
    return {
      pending,
      activity: events.map((e) => ({
        id: e.id,
        missionId: e.missionId,
        missionTitle: titles.get(e.missionId) ?? 'Mission',
        agent: e.agent,
        title: e.title,
        source: e.source,
        occurredAt: e.createdAt.toISOString(),
      })),
    };
  }

  // ------------------------------------------------------------------ helpers

  private headroom(mission: MissionWithAll, spec: IntentSpec) {
    const funded = mission.orders.filter(isFunded);
    const spent = funded.reduce((a, o) => a + o.amountMinor, 0n);
    const units = funded.reduce((a, o) => a + o.quantity, 0);
    return {
      budgetRemaining: mission.budgetMinor - spent,
      unitsNeeded: Math.max(1, spec.quantity - units),
    };
  }

  private async missionWithAll(id: string): Promise<MissionWithAll> {
    const m = await this.prisma.mission.findUnique({
      where: { id },
      include: {
        intents: { orderBy: { createdAt: 'asc' }, take: 1 },
        orders: true,
        proposals: true,
      },
    });
    if (!m || !m.intents[0]) throw AppError.notFound('Mission');
    return m;
  }

  private async ownMission(principal: Principal, id: string) {
    const m = await this.missionWithAll(id);
    if (m.orgTenantId !== principal.tenantId) throw AppError.notFound('Mission');
    return m;
  }

  private async tenants(ids: string[]) {
    const rows = await this.prisma.tenant.findMany({ where: { id: { in: [...new Set(ids)] } } });
    return new Map(rows.map((t) => [t.id, t]));
  }

  private async names(ids: string[]) {
    const t = await this.tenants(ids);
    return new Map([...t].map(([k, v]) => [k, v.name]));
  }

  private async event(
    tx: Tx,
    missionId: string,
    e: {
      agent: string;
      kind: string;
      title: string;
      detail: string;
      source: MissionEventSource;
      payload?: Record<string, unknown>;
    },
  ) {
    await tx.missionEvent.create({
      data: {
        missionId,
        agent: e.agent,
        kind: e.kind,
        title: e.title,
        detail: e.detail,
        source: e.source,
        payloadJson: (e.payload ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  /** Bumps the aggregate version and emits one SSE invalidation, without changing mission state. */
  private async touch(tx: Tx, missionId: string, eventType: string) {
    const m = await tx.mission.update({
      where: { id: missionId },
      data: { version: { increment: 1 } },
    });
    await this.outbox.appendMission(tx, {
      aggregateId: missionId,
      version: m.version,
      eventType,
      payload: { missionId, state: m.state },
      isSimulated: m.isDemo,
    });
  }
}
