'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  MissionAgent,
  MissionEventView,
  MissionLifecycleView,
  MissionOrderView,
  MissionReceiptView,
  Role,
} from '@promesa/contracts';
import { errorMessage } from '@/lib/api';
import { humanize, money, shortWhen, type Tone } from '@/lib/format';
import { useMe, useMissionActions } from '@/lib/queries';
import { Button, Chip, Kicker, SectionHeading, Sheet, SimulatedTag } from '@/components/ui';
import {
  AgentRunGraph,
  AllocationRibbon,
  MissionAtlas,
  MissionPulse,
  OrderProtection,
  OrgControls,
  ProposalsPanel,
  ReceiptExport,
  SponsorsPanel,
  SupplyConstellation,
} from './mission-panels';

type Actions = ReturnType<typeof useMissionActions>;

const AGENT_LABEL: Record<MissionAgent, string> = {
  MISSION_PLANNER: 'Mission Planner',
  MERCHANT_MATCHING: 'Merchant Matching',
  COMMERCE_PLANNER: 'Commerce Planner',
  NEGOTIATION: 'Negotiation Agent',
  FUNDING: 'Funding Coordinator',
  PROMISETWIN: 'PromiseTwin',
  POLICY_ENGINE: 'Policy Engine',
  PAYPAL_COMMERCE: 'PayPal Commerce',
  RECOVERY: 'Recovery Agent',
  FULFILLMENT: 'Fulfillment Agent',
  RECONCILIATION: 'Reconciliation Agent',
  HUMAN: 'Human',
};

const ORDER_TONE: Record<string, Tone> = {
  AWAITING_APPROVAL: 'neutral',
  PAYPAL_ORDER_CREATED: 'signal',
  AUTHORIZED: 'signal',
  CAPTURED: 'good',
  SHIPPED: 'good',
  DELIVERED: 'good',
  VOIDED: 'caution',
  REFUND_PENDING: 'caution',
  REFUNDED: 'caution',
  CANCELLED: 'neutral',
};

const SOURCE_TONE: Record<string, Tone> = {
  PAYPAL_API: 'good',
  PAYPAL_WEBHOOK: 'good',
  MERCHANT: 'signal',
  RECIPIENT: 'signal',
  BUYER: 'signal',
  AI_DERIVED: 'neutral',
  POLICY_DERIVED: 'neutral',
  SIMULATED: 'caution',
};

const STAGES = [
  { key: 'plan', label: 'Plan', hint: 'Agents plan' },
  { key: 'fund', label: 'Fund', hint: 'Sponsor approves in PayPal' },
  { key: 'fulfil', label: 'Fulfil', hint: 'Merchants ship' },
  { key: 'receipt', label: 'Receipt', hint: 'Recipient confirms' },
] as const;

function stageIndex(lc: MissionLifecycleView): number {
  const { coverage, orders } = lc;
  if (lc.receipt || lc.state === 'COMPLETED') return 4;
  if (orders.some((o) => ['SHIPPED', 'DELIVERED'].includes(o.state))) return 2;
  if (coverage.funded > 0 || orders.some((o) => ['AUTHORIZED', 'CAPTURED'].includes(o.state)))
    return 1;
  if (orders.length > 0) return 1;
  return 0;
}

export function MissionControl({
  lc,
  missionId,
  timezone,
}: {
  lc: MissionLifecycleView;
  missionId: string;
  timezone: string;
}) {
  const me = useMe();
  const role: Role | undefined = me.data?.activeRole;
  const actions = useMissionActions(missionId);
  usePayPalReturn(missionId, lc, actions);

  const isOrg = lc.viewerIsOrg && (role === 'ORG_ADMIN' || role === 'ORG_OPERATOR');
  const isSponsor = role === 'SPONSOR';

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <MissionPulse lc={lc} />
        <Stepper lc={lc} />
      </div>
      <NextStepBanner
        lc={lc}
        isOrg={isOrg}
        isSponsor={isSponsor}
        missionId={missionId}
        actions={actions}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <MissionAtlas lc={lc} />
        <AllocationRibbon lc={lc} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <PlanCard lc={lc} className="lg:col-span-2" />
        <div className="space-y-6">
          <BudgetCard lc={lc} />
          <RailCard lc={lc} actions={actions} canReconcile={Boolean(role)} />
        </div>
      </div>
      <AgentRunGraph lc={lc} />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <SupplyConstellation lc={lc} />
        </div>
        <div className="space-y-6 lg:col-span-2">
          <ProposalsPanel lc={lc} actions={actions} />
          <SponsorsPanel lc={lc} />
        </div>
      </div>
      <section className="space-y-4" aria-labelledby="orders">
        <SectionHeading
          id="orders"
          kicker="One PayPal order per merchant"
          title="Merchant orders"
          aside={<Chip>{lc.orders.length} orders</Chip>}
        />
        {lc.orders.length === 0 ? (
          <Sheet className="p-5 text-sm text-muted">
            No orders yet. The Mission Planner and Commerce Planner create them when you run the
            agents.
          </Sheet>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {lc.orders.map((o) => (
              <OrderCard
                key={o.id}
                order={o}
                lc={lc}
                role={role}
                missionId={missionId}
                actions={actions}
                timezone={timezone}
              />
            ))}
          </div>
        )}
      </section>
      {lc.receipt ? <ReceiptCard receipt={lc.receipt} lc={lc} /> : null}
      {isOrg && role === 'ORG_ADMIN' ? <OrgControls lc={lc} actions={actions} /> : null}
      <Timeline events={lc.events} timezone={timezone} />
    </div>
  );
}

/* ---------- PayPal return handling ---------- */

/**
 * PayPal redirects the sponsor back with ?paypal=return&order=<ourId>&token=<paypalOrderId>.
 * We only forward the token to the API, which re-reads the order from PayPal before trusting it.
 */
function usePayPalReturn(missionId: string, lc: MissionLifecycleView, actions: Actions) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const handled = useRef(false);
  const paypal = params.get('paypal');
  const orderId = params.get('order');
  const token = params.get('token');
  const { mutate } = actions.authorize;

  useEffect(() => {
    if (handled.current || !paypal || !orderId) return;
    handled.current = true;
    const clear = () => router.replace(pathname);
    if (paypal === 'return' && token) {
      mutate({ orderId, paypalOrderId: token }, { onSettled: clear });
    } else {
      clear();
    }
  }, [paypal, orderId, token, mutate, router, pathname, missionId, lc.state]);
}

/* ---------- Stepper ---------- */

function Stepper({ lc }: { lc: MissionLifecycleView }) {
  const current = stageIndex(lc);
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Mission progress">
      {STAGES.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={s.key}
            aria-current={active ? 'step' : undefined}
            className={clsx(
              'rounded-[var(--radius-control)] border px-3 py-2.5',
              done && 'border-good/40 bg-good-soft',
              active && 'border-ink bg-paper',
              !done && !active && 'border-hairline text-muted',
            )}
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.1em]">
              {done ? '✓' : String(i + 1).padStart(2, '0')} · {s.label}
            </p>
            <p className="mt-0.5 text-[12px] text-muted">{s.hint}</p>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- Next step ---------- */

function NextStepBanner({
  lc,
  isOrg,
  isSponsor,
  missionId,
  actions,
}: {
  lc: MissionLifecycleView;
  isOrg: boolean;
  isSponsor: boolean;
  missionId: string;
  actions: Actions;
}) {
  const { nextStep } = lc;
  const canRun = lc.plan.status === 'NONE' && lc.orders.length === 0;
  const canReplan =
    !canRun &&
    lc.orders.length > 0 &&
    lc.orders.every((o) =>
      ['AWAITING_APPROVAL', 'CANCELLED', 'VOIDED', 'REFUNDED'].includes(o.state),
    ) &&
    lc.proposals.some((p) => p.state === 'ACCEPTED');
  const wrongRole = nextStep.actor === 'SPONSOR' && !isSponsor;
  return (
    <Sheet stacked className="flex flex-wrap items-center justify-between gap-4 p-5">
      <div>
        <Kicker>Next step · {nextStep.actor === 'NONE' ? 'done' : humanize(nextStep.actor)}</Kicker>
        <p className="font-display mt-1 text-xl text-ink">{nextStep.label}</p>
        {actions.plan.isError ? (
          <p role="alert" className="mt-2 text-sm text-breach">
            {errorMessage(actions.plan.error)}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {canRun ? (
          <Button
            size="lg"
            busy={actions.plan.isPending}
            disabled={!isOrg}
            title={isOrg ? undefined : 'Sign in as shelter staff to run the agents'}
            onClick={() => actions.plan.mutate()}
          >
            Run NeedMesh agents
          </Button>
        ) : null}
        {canReplan && isOrg ? (
          <Button
            size="lg"
            variant="secondary"
            busy={actions.plan.isPending}
            onClick={() => actions.plan.mutate()}
          >
            Re-plan with accepted offers
          </Button>
        ) : null}
        {wrongRole ? (
          <>
            <Link
              href={`/sign-in?persona=priya&next=/missions/${missionId}`}
              className="inline-flex h-10 items-center rounded-[var(--radius-control)] border border-hairline-strong px-4 text-sm hover:border-signal"
            >
              Continue as Priya (sponsor) →
            </Link>
            {lc.marketplace.visibility === 'PUBLIC' ? (
              <Link
                href={`/sign-in?persona=leo&next=/missions/${missionId}`}
                className="inline-flex h-10 items-center rounded-[var(--radius-control)] border border-hairline-strong px-4 text-sm hover:border-signal"
              >
                Or Leo (Northside Fund) →
              </Link>
            ) : null}
          </>
        ) : null}
        {nextStep.actor === 'ORG' && !isOrg ? (
          <Link
            href={`/sign-in?persona=jordan&next=/missions/${missionId}`}
            className="inline-flex h-10 items-center rounded-[var(--radius-control)] border border-hairline-strong px-4 text-sm hover:border-ink"
          >
            Continue as Jordan (shelter) →
          </Link>
        ) : null}
      </div>
    </Sheet>
  );
}

/* ---------- Plan ---------- */

function PlanCard({ lc, className }: { lc: MissionLifecycleView; className?: string }) {
  const { plan } = lc;
  return (
    <Sheet className={clsx('p-5', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Kicker>Agent plan · round {plan.round}</Kicker>
        {plan.narrative ? (
          <Chip title="Who wrote this explanation. Figures are checked against the planner.">
            {plan.narrative.engine}
          </Chip>
        ) : null}
      </div>
      {plan.narrative ? (
        <>
          <h2 className="font-display mt-2 text-2xl leading-snug">{plan.narrative.headline}</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">{plan.narrative.rationale}</p>
          {plan.narrative.tradeoffs.length ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
              {plan.narrative.tradeoffs.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">
          No plan yet. Agents propose a plan — they never move money.
        </p>
      )}
      {plan.unmetQuantity > 0 ? (
        <p role="status" className="mt-3 text-sm text-caution">
          {plan.unmetQuantity} units are not covered by the current plan.
        </p>
      ) : null}
      {plan.excluded.length ? (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-signal">
            {plan.excluded.length} excluded listing{plan.excluded.length > 1 ? 's' : ''}
          </summary>
          <ul className="mt-2 space-y-2">
            {plan.excluded.map((e) => (
              <li key={`${e.sku}-${e.reasons.join()}`} className="border-l-2 border-hairline pl-3">
                <span className="font-mono text-[12px]">{e.sku}</span> · {e.merchantName}
                <br />
                <span className="text-muted">{e.reasons.join('; ')}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Sheet>
  );
}

/* ---------- Budget / coverage ---------- */

function BudgetCard({ lc }: { lc: MissionLifecycleView }) {
  const { budget, coverage } = lc;
  const limit = Number(budget.limitMinor) || 1;
  const pct = Math.min(100, Math.round((Number(budget.committedMinor) / limit) * 100));
  const cov = (n: number) => Math.min(100, Math.round((n / Math.max(1, coverage.requested)) * 100));
  return (
    <Sheet className="p-5">
      <Kicker>Budget guardrail</Kicker>
      <p className="font-display mt-1 text-2xl">
        {money(budget.committedMinor, budget.currency)}{' '}
        <span className="text-base text-muted">of {money(budget.limitMinor, budget.currency)}</span>
      </p>
      <div
        role="progressbar"
        aria-label="Budget committed"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-2 h-2 overflow-hidden rounded-full bg-cutout"
      >
        <div className="h-full bg-ink" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[12px] text-muted">
        {money(budget.remainingMinor, budget.currency)} remaining. The policy engine blocks any
        order that would exceed it.
      </p>
      <dl className="mt-4 space-y-2 text-sm">
        {(
          [
            ['Planned', coverage.planned],
            ['Funded', coverage.funded],
            ['Delivered', coverage.delivered],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <div className="flex justify-between">
              <dt className="text-muted">{k}</dt>
              <dd>
                {v} / {coverage.requested}
              </dd>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-cutout">
              <div className="h-full bg-signal" style={{ width: `${cov(v)}%` }} />
            </div>
          </div>
        ))}
      </dl>
    </Sheet>
  );
}

/* ---------- Rail / MCP ---------- */

function RailCard({
  lc,
  actions,
  canReconcile,
}: {
  lc: MissionLifecycleView;
  actions: Actions;
  canReconcile: boolean;
}) {
  const sandbox = lc.rail.mode === 'SANDBOX';
  return (
    <Sheet className="p-5">
      <Kicker>PayPal rail</Kicker>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Chip tone={sandbox ? 'good' : 'caution'}>
          {sandbox ? 'PayPal Sandbox · real API' : 'Simulated rail'}
        </Chip>
        <Chip
          tone={lc.mcp.status === 'OK' ? 'good' : 'neutral'}
          title={lc.mcp.tools.length ? `Tools: ${lc.mcp.tools.join(', ')}` : undefined}
        >
          MCP · {humanize(lc.mcp.status)}
        </Chip>
      </div>
      <p className="mt-2 text-[13px] text-muted">{lc.rail.detail}</p>
      <p className="mt-1 text-[13px] text-muted">{lc.mcp.detail}</p>
      <Button
        className="mt-3"
        size="sm"
        variant="secondary"
        busy={actions.reconcile.isPending}
        disabled={!canReconcile || lc.orders.length === 0}
        onClick={() => actions.reconcile.mutate()}
      >
        Reconcile with PayPal
      </Button>
      {actions.reconcile.isError ? (
        <p role="alert" className="mt-2 text-sm text-breach">
          {errorMessage(actions.reconcile.error)}
        </p>
      ) : null}
    </Sheet>
  );
}

/* ---------- Orders ---------- */

function IdLine({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-3 text-[12px]">
      <span className="text-muted">{label}</span>
      <span className="truncate font-mono text-ink" title={value ?? undefined}>
        {value ?? '—'}
      </span>
    </div>
  );
}

function OrderCard({
  order,
  lc,
  role,
  missionId,
  actions,
  timezone,
}: {
  order: MissionOrderView;
  lc: MissionLifecycleView;
  role: Role | undefined;
  missionId: string;
  actions: Actions;
  timezone: string;
}) {
  const [qty, setQty] = useState(order.quantity);
  const allowed = new Set(order.allowedActions);
  const sim = order.paypal.mode === 'SIMULATED';
  const errors = [
    actions.approve.variables === order.id ? actions.approve.error : null,
    actions.merchant.variables?.orderId === order.id ? actions.merchant.error : null,
    actions.acknowledge.variables?.orderId === order.id ? actions.acknowledge.error : null,
    actions.authorize.variables?.orderId === order.id ? actions.authorize.error : null,
  ].filter(Boolean);
  const dead = ['VOIDED', 'REFUNDED', 'CANCELLED'].includes(order.state);
  const canApprove = allowed.has('APPROVE');

  return (
    <Sheet as="article" className={clsx('p-5', dead && 'opacity-80')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Kicker>
            {order.merchantName}
            {order.planRound > 0 ? ` · recovery round ${order.planRound}` : ''}
          </Kicker>
          <h3 className="font-display mt-1 text-lg leading-snug">{order.title}</h3>
        </div>
        <Chip tone={ORDER_TONE[order.state] ?? 'neutral'}>{humanize(order.state)}</Chip>
      </div>
      <p className="mt-2 text-sm">
        {order.quantity} × {money(order.unitPriceMinor, order.currency)} ={' '}
        <strong>{money(order.amountMinor, order.currency)}</strong>
        {order.estimatedDeliveryAt ? (
          <span className="text-muted">
            {' '}
            · est. {shortWhen(order.estimatedDeliveryAt, timezone)}
          </span>
        ) : null}
      </p>
      {order.replacesOrderId ? (
        <p className="mt-1 text-[12px] text-signal">
          Replacement for a failed order — needs a fresh sponsor approval.
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {order.negotiated ? (
          <Chip tone="signal" title="Priced by an accepted merchant proposal">
            Negotiated · list {money(order.negotiated.listUnitPriceMinor, order.currency)}
          </Chip>
        ) : null}
        {order.fundedBy ? (
          <Chip tone="good">
            Funded by {order.fundedBy.sponsorName} · {order.fundedBy.sponsorOrg}
          </Chip>
        ) : order.state === 'AWAITING_APPROVAL' ? (
          <Chip>Awaiting a sponsor</Chip>
        ) : null}
      </div>

      <div className="mt-3 space-y-1 border-t border-hairline pt-3">
        <div className="mb-1 flex items-center gap-2">
          <Chip tone={sim ? 'caution' : 'good'}>{sim ? 'Simulated rail' : 'PayPal Sandbox'}</Chip>
          {sim ? <SimulatedTag /> : null}
        </div>
        <IdLine label="PayPal order" value={order.paypal.orderId} />
        <IdLine label="Authorization" value={order.paypal.authorizationId} />
        <IdLine label="Capture" value={order.paypal.captureId} />
        {order.paypal.refundId ? <IdLine label="Refund" value={order.paypal.refundId} /> : null}
        {order.tracking ? (
          <IdLine
            label={`Tracking · ${order.tracking.carrier}`}
            value={order.tracking.trackingNumber}
          />
        ) : null}
        {order.receipt ? (
          <IdLine
            label="Recipient confirmed"
            value={`${order.receipt.quantityReceived} of ${order.quantity}`}
          />
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {canApprove ? (
          <Button
            size="sm"
            busy={actions.approve.isPending && actions.approve.variables === order.id}
            disabled={role !== 'SPONSOR'}
            title={role === 'SPONSOR' ? undefined : 'Only the sponsor can approve payment'}
            onClick={() =>
              actions.approve.mutate(order.id, {
                onSuccess: (res) => {
                  if (res.approveUrl) window.location.assign(res.approveUrl);
                },
              })
            }
          >
            Approve &amp; authorize in PayPal
          </Button>
        ) : null}
        {order.state === 'PAYPAL_ORDER_CREATED' && order.paypal.approveUrl ? (
          <a
            href={order.paypal.approveUrl}
            className="inline-flex h-8 items-center rounded-[var(--radius-control)] border border-ink bg-ink px-3 text-[13px] text-paper"
          >
            Continue to PayPal →
          </a>
        ) : null}
        {allowed.has('ACKNOWLEDGE') ? (
          <>
            <label className="sr-only" htmlFor={`qty-${order.id}`}>
              Quantity received
            </label>
            <input
              id={`qty-${order.id}`}
              type="number"
              min={0}
              max={order.quantity}
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              className="h-8 w-20 rounded-[var(--radius-control)] border border-hairline-strong bg-paper px-2 text-[13px]"
            />
            <Button
              size="sm"
              busy={actions.acknowledge.isPending}
              disabled={role !== 'ORG_ADMIN' && role !== 'ORG_OPERATOR'}
              onClick={() =>
                actions.acknowledge.mutate({ orderId: order.id, quantityReceived: qty })
              }
            >
              Confirm received
            </Button>
          </>
        ) : null}
      </div>

      <OrderProtection order={order} />

      {lc.demoControlsEnabled &&
      (allowed.has('MERCHANT_CONFIRM') ||
        allowed.has('MERCHANT_STOCKOUT') ||
        allowed.has('MERCHANT_SHIP') ||
        allowed.has('MERCHANT_APPROVE_REFUND')) ? (
        <div className="mt-4 rounded-[var(--radius-control)] border border-dashed border-caution/60 bg-caution-soft p-3">
          <p className="kicker text-caution">Simulated merchant console · demo only</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {allowed.has('MERCHANT_CONFIRM') ? (
              <MerchantButton order={order} action="CONFIRM_STOCK" actions={actions}>
                Confirm stock
              </MerchantButton>
            ) : null}
            {allowed.has('MERCHANT_STOCKOUT') ? (
              <MerchantButton order={order} action="STOCKOUT" actions={actions} variant="danger">
                Report stockout
              </MerchantButton>
            ) : null}
            {allowed.has('MERCHANT_SHIP') ? (
              <MerchantButton order={order} action="SHIP" actions={actions}>
                Mark shipped
              </MerchantButton>
            ) : null}
            {allowed.has('MERCHANT_APPROVE_REFUND') ? (
              <MerchantButton order={order} action="APPROVE_REFUND" actions={actions}>
                Approve refund
              </MerchantButton>
            ) : null}
          </div>
        </div>
      ) : null}

      {errors.length ? (
        <p role="alert" className="mt-3 text-sm text-breach">
          {errorMessage(errors[0])}
        </p>
      ) : null}
      <span className="sr-only">{missionId}</span>
    </Sheet>
  );
}

function MerchantButton({
  order,
  action,
  actions,
  variant = 'secondary',
  children,
}: {
  order: MissionOrderView;
  action: 'CONFIRM_STOCK' | 'STOCKOUT' | 'SHIP' | 'APPROVE_REFUND';
  actions: Actions;
  variant?: 'secondary' | 'danger';
  children: ReactNode;
}) {
  const busy =
    actions.merchant.isPending &&
    actions.merchant.variables?.orderId === order.id &&
    actions.merchant.variables.action === action;
  return (
    <Button
      size="sm"
      variant={variant}
      busy={busy}
      onClick={() => actions.merchant.mutate({ orderId: order.id, action })}
    >
      {children}
    </Button>
  );
}

/* ---------- Receipt ---------- */

function ReceiptCard({ receipt, lc }: { receipt: MissionReceiptView; lc: MissionLifecycleView }) {
  return (
    <Sheet stacked folded className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Kicker>Mission Receipt · revision {receipt.revision}</Kicker>
          <h2 className="font-display mt-1 text-2xl">{receipt.missionTitle}</h2>
        </div>
        <Chip tone="good">
          ✓ {receipt.deliveredUnits} of {receipt.requestedUnits} delivered
        </Chip>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
        <Stat k="Paid" v={money(receipt.totalPaidMinor, receipt.currency)} />
        <Stat k="Voided (never charged)" v={money(receipt.voidedMinor, receipt.currency)} />
        <Stat k="Refunded" v={money(receipt.refundedMinor, receipt.currency)} />
        <Stat k="Recoveries" v={String(receipt.recoveries)} />
      </dl>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="kicker">
            <tr>
              <th className="py-2 pr-4 font-normal">Merchant</th>
              <th className="py-2 pr-4 font-normal">Received</th>
              <th className="py-2 pr-4 font-normal">Amount</th>
              <th className="py-2 pr-4 font-normal">PayPal capture</th>
              <th className="py-2 font-normal">Tracking</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {receipt.lines.map((l) => (
              <tr key={l.orderId}>
                <td className="py-2 pr-4">{l.merchantName}</td>
                <td className="py-2 pr-4">
                  {l.quantityReceived} / {l.quantity}
                </td>
                <td className="py-2 pr-4">{money(l.amountMinor, receipt.currency)}</td>
                <td className="py-2 pr-4 font-mono text-[12px]">
                  {l.paypalCaptureId ?? '—'}{' '}
                  {l.paypalMode === 'SIMULATED' ? <SimulatedTag /> : null}
                </td>
                <td className="py-2 font-mono text-[12px]">{l.tracking ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-[13px] text-muted">{receipt.evidenceNote}</p>
      <p className="mt-1 font-mono text-[11px] text-muted" title="Hash of this receipt's contents">
        sha256 {receipt.artifactHash.slice(0, 24)}…
      </p>
      <div className="mt-4">
        <ReceiptExport receipt={receipt} lc={lc} />
      </div>
    </Sheet>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-muted">{k}</dt>
      <dd className="font-display text-xl">{v}</dd>
    </div>
  );
}

/* ---------- Timeline ---------- */

function Timeline({ events, timezone }: { events: MissionEventView[]; timezone: string }) {
  return (
    <section aria-labelledby="timeline" className="space-y-4">
      <SectionHeading
        id="timeline"
        kicker="Every claim carries its source"
        title="Agent timeline"
      />
      <Sheet className="p-2 sm:p-4">
        {events.length === 0 ? (
          <p className="p-3 text-sm text-muted">Nothing has happened yet.</p>
        ) : (
          <ol className="divide-y divide-hairline">
            {[...events].reverse().map((e) => {
              const denied = e.kind === 'policy.denied';
              return (
                <li
                  key={e.id}
                  className={clsx(
                    'grid gap-1 p-3 sm:grid-cols-[10rem_1fr]',
                    denied && 'bg-breach-soft',
                  )}
                >
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink">
                      {AGENT_LABEL[e.agent] ?? e.agent}
                    </p>
                    <p className="text-[11px] text-muted">{shortWhen(e.occurredAt, timezone)}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {denied ? '⛔ ' : ''}
                      {e.title}
                    </p>
                    {e.detail ? <p className="mt-0.5 text-sm text-muted">{e.detail}</p> : null}
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <Chip tone={SOURCE_TONE[e.source] ?? 'neutral'}>
                        {e.source.replace(/_/g, ' ').toLowerCase()}
                      </Chip>
                      <Chip title="Which engine produced this record">{e.engine}</Chip>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Sheet>
    </section>
  );
}
