'use client';

import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type {
  MissionLifecycleView,
  MissionOrderView,
  MissionReceiptView,
  OrderProtectionView,
  ProposalView,
} from '@promesa/contracts';
import { errorMessage } from '@/lib/api';
import { humanize, money, shortWhen, type Tone } from '@/lib/format';
import { useAnimeScope } from '@/lib/motion';
import type { useMissionActions } from '@/lib/queries';
import { Button, Chip, SectionHeading, Sheet } from '@/components/ui';

type Actions = ReturnType<typeof useMissionActions>;

/* ---------- Mission Pulse: animates only when a real mission event arrives ---------- */

export function MissionPulse({ lc }: { lc: MissionLifecycleView }) {
  const root = useRef<HTMLDivElement>(null);
  const last = lc.events[lc.events.length - 1];
  useAnimeScope(
    root,
    ({ animate }) => {
      animate('[data-pulse-ring]', {
        scale: [1, 2.4],
        opacity: [0.55, 0],
        duration: 1100,
        ease: 'out(2)',
      });
    },
    last?.id ?? 'none',
  );
  return (
    <div
      ref={root}
      className="flex min-w-0 items-center gap-2.5 text-[13px]"
      aria-live="polite"
      title="Mission Pulse: the latest recorded mission event"
    >
      <span className="relative inline-flex size-2.5 shrink-0">
        <span data-pulse-ring className="absolute inset-0 rounded-full bg-signal" />
        <span className="relative size-2.5 rounded-full bg-signal" />
      </span>
      <span className="kicker shrink-0">Mission Pulse</span>
      <span className="truncate text-ink">{last ? last.title : 'Waiting for the first event'}</span>
    </div>
  );
}

/* ---------- Mission Atlas: requested → sourced → funded → paid → shipped → received ---------- */

const ATLAS_ROWS: Array<[keyof MissionLifecycleView['atlas'], string, string, string]> = [
  ['requested', 'Requested', 'bg-ink/70', 'Confirmed need'],
  ['planned', 'Sourced', 'bg-signal/50', 'Units in live merchant orders'],
  ['funded', 'Funded', 'bg-signal', 'A sponsor approved the order'],
  ['purchased', 'Paid', 'bg-signal-strong', 'PayPal capture exists'],
  ['shipped', 'Shipped', 'bg-good/60', 'Merchant added tracking'],
  ['received', 'Received', 'bg-good', 'Recipient confirmed — the only proof of delivery'],
];

export function MissionAtlas({ lc }: { lc: MissionLifecycleView }) {
  const root = useRef<HTMLDivElement>(null);
  const a = lc.atlas;
  useAnimeScope(
    root,
    ({ animate, stagger }) => {
      animate('[data-bar]', { scaleX: [0, 1], duration: 700, delay: stagger(70), ease: 'out(3)' });
    },
    JSON.stringify(a),
  );
  return (
    <Sheet className="p-5">
      <SectionHeading kicker="Mission Atlas" title="Every unit, by stage" />
      <div ref={root} className="mt-4 space-y-2.5">
        {ATLAS_ROWS.map(([key, label, cls, hint]) => (
          <div
            key={key}
            className="grid grid-cols-[5.5rem_1fr_3rem] items-center gap-3 text-sm"
            title={hint}
          >
            <span className="kicker">{label}</span>
            <span className="h-2.5 overflow-hidden rounded-full bg-cutout">
              <span
                data-bar
                className={clsx('block h-full origin-left rounded-full', cls)}
                style={{ width: `${Math.min(100, (a[key] / Math.max(1, a.requested)) * 100)}%` }}
              />
            </span>
            <span className="tabular text-right text-ink">
              {a[key]}
              <span className="text-muted">/{a.requested}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-muted">
        Paid and received are separate rows on purpose: a PayPal capture is never treated as proof
        of delivery.
      </p>
    </Sheet>
  );
}

/* ---------- Allocation Ribbon: budget split by merchant order ---------- */

const RIBBON_TONE: Record<string, string> = {
  AWAITING_APPROVAL: 'bg-hairline-strong',
  PAYPAL_ORDER_CREATED: 'bg-signal/50',
  AUTHORIZED: 'bg-signal',
  CAPTURED: 'bg-signal-strong',
  SHIPPED: 'bg-good/70',
  DELIVERED: 'bg-good',
};

export function AllocationRibbon({ lc }: { lc: MissionLifecycleView }) {
  const limit = Number(lc.budget.limitMinor);
  const live = lc.orders.filter((o) => !['VOIDED', 'REFUNDED', 'CANCELLED'].includes(o.state));
  const released = lc.orders.filter((o) => ['VOIDED', 'REFUNDED', 'CANCELLED'].includes(o.state));
  const used = live.reduce((s, o) => s + Number(o.amountMinor), 0);
  return (
    <Sheet className="p-5">
      <SectionHeading
        kicker="Allocation Ribbon"
        title="Where the budget goes"
        aside={
          <span className="tabular text-sm text-muted">
            {money(String(used), lc.budget.currency)} of{' '}
            {money(lc.budget.limitMinor, lc.budget.currency)}
          </span>
        }
      />
      <div
        className="mt-4 flex h-9 overflow-hidden rounded-md border border-hairline bg-cutout"
        role="img"
        aria-label="Budget allocation by merchant order"
      >
        {live.map((o) => (
          <div
            key={o.id}
            className={clsx(
              'flex items-center justify-center border-r border-paper text-[11px] text-paper',
              RIBBON_TONE[o.state] ?? 'bg-hairline-strong',
            )}
            style={{ width: `${(Number(o.amountMinor) / Math.max(1, limit)) * 100}%` }}
            title={`${o.merchantName} · ${o.quantity} × ${o.sku} · ${money(o.amountMinor, o.currency)} · ${humanize(o.state)}`}
          >
            <span className="truncate px-1 text-ink mix-blend-normal">{o.quantity}×</span>
          </div>
        ))}
      </div>
      <ul className="mt-3 grid gap-1.5 text-[13px] sm:grid-cols-2">
        {live.map((o) => (
          <li key={o.id} className="flex items-center gap-2">
            <span
              aria-hidden
              className={clsx('size-2.5 rounded-sm', RIBBON_TONE[o.state] ?? 'bg-hairline-strong')}
            />
            <span className="text-ink">{o.merchantName}</span>
            <span className="tabular text-muted">{money(o.amountMinor, o.currency)}</span>
            {o.fundedBy ? (
              <span className="truncate text-muted">· {o.fundedBy.sponsorOrg}</span>
            ) : (
              <span className="text-muted">· unfunded</span>
            )}
          </li>
        ))}
        {released.length ? (
          <li className="text-muted sm:col-span-2">
            Released, never charged:{' '}
            {released
              .map(
                (o) =>
                  `${o.merchantName} ${money(o.amountMinor, o.currency)} (${humanize(o.state).toLowerCase()})`,
              )
              .join(' · ')}
          </li>
        ) : null}
      </ul>
    </Sheet>
  );
}

function discoveryTone(status: MissionLifecycleView['discoverySources'][number]['status']): Tone {
  if (status === 'ACTIVE') return 'good';
  if (status === 'UNAVAILABLE') return 'caution';
  return 'neutral';
}

function discoveryLabel(
  status: MissionLifecycleView['discoverySources'][number]['status'],
): string {
  if (status === 'ACTIVE') return 'active';
  if (status === 'UNAVAILABLE') return 'unavailable';
  return 'not configured';
}

function formatMajor(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Channel3 catalog hits. Shown beside the orderable constellation, never as a PayPal order. */
export function Channel3Panel({ lc, timezone }: { lc: MissionLifecycleView; timezone: string }) {
  const discovery = lc.channel3;
  if (discovery.status === 'NOT_CONFIGURED') return null;
  return (
    <Sheet className="p-5">
      <SectionHeading
        kicker="Channel3"
        title="External product discovery"
        aside={
          <Chip tone={discovery.status === 'ACTIVE' ? 'good' : 'caution'}>
            {discovery.status === 'ACTIVE' ? 'Catalog metadata' : 'Unavailable'}
          </Chip>
        }
      />
      <p className="mt-2 max-w-3xl text-sm text-muted">{discovery.detail}</p>
      {discovery.observedAt ? (
        <p className="mt-1 text-xs text-muted">
          Fetched {shortWhen(discovery.observedAt, timezone)}.
        </p>
      ) : null}
      {discovery.products.length > 0 ? (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {discovery.products.map((product) => (
            <li key={product.id} className="flex gap-3 rounded-md border border-hairline p-3">
              {product.imageUrl ? (
                // Hosts come from Channel3 and merchants, so this cannot be a configured next/image source.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={product.imageUrl}
                  alt=""
                  className="size-16 shrink-0 rounded-sm border border-hairline object-contain"
                />
              ) : null}
              <div className="min-w-0">
                <p className="font-medium text-ink">{product.title}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {[product.brand, product.category].filter(Boolean).join(' · ') ||
                    'Channel3 catalog'}
                </p>
                {product.offers.length === 0 ? (
                  <p className="mt-2 text-xs text-muted">No buy link in this response.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {product.offers.map((offer) => (
                      <li key={offer.url} className="text-sm">
                        <a
                          href={offer.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-signal hover:underline"
                        >
                          Buy at {offer.domain}
                        </a>
                        <span className="text-muted">
                          {' '}
                          · {formatMajor(offer.price, offer.currency)}
                          {offer.compareAtPrice !== null && offer.compareAtPrice > offer.price ? (
                            <s className="ml-1">
                              {formatMajor(offer.compareAtPrice, offer.currency)}
                            </s>
                          ) : null}
                          {' · '}
                          {offer.availability === 'InStock'
                            ? 'merchant reports in stock'
                            : 'merchant reports out of stock'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </Sheet>
  );
}

/* ---------- Supply Constellation: mission at the centre, listings around it ---------- */

export function SupplyConstellation({ lc }: { lc: MissionLifecycleView }) {
  const root = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const nodes = lc.supply;
  const W = 560;
  const H = 300;
  const cx = W / 2;
  const cy = H / 2;
  const placed = nodes.map((n, i) => {
    const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2 - Math.PI / 2;
    const r = n.compatible ? 105 : 135;
    return { ...n, x: cx + Math.cos(angle) * r * 1.55, y: cy + Math.sin(angle) * r * 0.85 };
  });
  useAnimeScope(
    root,
    ({ animate, stagger }) => {
      animate('[data-star]', {
        opacity: [0, 1],
        scale: [0.5, 1],
        duration: 520,
        delay: stagger(60),
        ease: 'out(3)',
      });
    },
    nodes.length,
  );
  const selected = placed.find((p) => p.productId === focus) ?? null;
  return (
    <Sheet className="p-5">
      <SectionHeading
        kicker="Supply Constellation"
        title="Every listing the agents considered"
        aside={
          <div className="flex flex-wrap gap-1.5">
            {lc.discoverySources.map((s) => (
              <Chip key={s.name} tone={discoveryTone(s.status)} title={s.detail}>
                {s.name} · {discoveryLabel(s.status)}
              </Chip>
            ))}
          </div>
        }
      />
      <div
        ref={root}
        className="ledger-grid mt-4 overflow-hidden rounded-md border border-hairline"
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label="Supply constellation"
        >
          {placed.map((p) => (
            <line
              key={`l-${p.productId}`}
              x1={cx}
              y1={cy}
              x2={p.x}
              y2={p.y}
              className={
                p.allocated > 0
                  ? 'stroke-signal'
                  : p.compatible
                    ? 'stroke-hairline-strong'
                    : 'stroke-breach/40'
              }
              strokeWidth={p.allocated > 0 ? 2 : 1}
              strokeDasharray={p.compatible ? undefined : '4 4'}
            />
          ))}
          <g>
            <circle cx={cx} cy={cy} r={30} className="fill-ink" />
            <text
              x={cx}
              y={cy + 4}
              textAnchor="middle"
              className="fill-paper text-[11px] font-medium"
            >
              {lc.atlas.requested} needed
            </text>
          </g>
          {placed.map((p) => (
            <g
              key={p.productId}
              data-star
              tabIndex={0}
              role="button"
              aria-label={`${p.merchantName} ${p.sku}`}
              onClick={() => setFocus(p.productId)}
              onFocus={() => setFocus(p.productId)}
              className="cursor-pointer outline-none"
              style={{ transformOrigin: `${p.x}px ${p.y}px` }}
            >
              <circle
                cx={p.x}
                cy={p.y}
                r={p.allocated > 0 ? 15 : 11}
                className={clsx(
                  p.allocated > 0
                    ? 'fill-signal'
                    : p.compatible
                      ? 'fill-paper stroke-signal'
                      : 'fill-breach-soft stroke-breach',
                  focus === p.productId && 'stroke-ink',
                )}
                strokeWidth={1.5}
              />
              <text x={p.x} y={p.y + 27} textAnchor="middle" className="fill-ink text-[10px]">
                {p.merchantName.split(' ')[0]}
              </text>
              <text
                x={p.x}
                y={p.y + 39}
                textAnchor="middle"
                className="fill-muted font-mono text-[9px]"
              >
                {money(p.negotiatedUnitPriceMinor ?? p.unitPriceMinor)}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <div className="mt-3 min-h-[3.5rem] text-sm" aria-live="polite">
        {selected ? (
          <div>
            <p className="text-ink">
              <strong>{selected.merchantName}</strong> · {selected.title}{' '}
              <Chip
                tone={
                  selected.availability === 'VERIFIED'
                    ? 'good'
                    : selected.availability === 'STALE'
                      ? 'caution'
                      : 'caution'
                }
              >
                {selected.availability.toLowerCase()} inventory
              </Chip>
            </p>
            <p className="tabular text-[13px] text-muted">
              {selected.negotiatedUnitPriceMinor
                ? `Negotiated ${money(selected.negotiatedUnitPriceMinor)} (list ${money(selected.unitPriceMinor)})`
                : `List ${money(selected.unitPriceMinor)}`}{' '}
              · {selected.inventoryQty} in stock · {selected.leadTimeHours}h lead ·{' '}
              {selected.allocated} allocated
            </p>
            <ul
              className={clsx(
                'mt-1 list-disc pl-4 text-[13px]',
                selected.compatible ? 'text-good' : 'text-breach',
              )}
            >
              {selected.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-[13px] text-muted">
            Filled = allocated to an order · outlined = eligible · red dashed = excluded by a hard
            constraint. Select a node to see why.
          </p>
        )}
      </div>
    </Sheet>
  );
}

/* ---------- Negotiation ---------- */

export function ProposalsPanel({ lc, actions }: { lc: MissionLifecycleView; actions: Actions }) {
  const [counter, setCounter] = useState<Record<string, string>>({});
  if (lc.proposals.length === 0)
    return (
      <Sheet className="p-5">
        <SectionHeading kicker="Negotiation" title="Merchant offers" />
        <p className="mt-3 text-sm text-muted">
          {lc.marketplace.visibility === 'PUBLIC'
            ? 'No offers yet. Connected merchants who see this mission in the marketplace can submit terms.'
            : 'Publish the mission so connected merchants can submit offers.'}{' '}
          Agents never negotiate with sellers who are not connected to NeedMesh.
        </p>
      </Sheet>
    );
  const err = actions.decide.error;
  return (
    <Sheet className="p-5">
      <SectionHeading kicker="Negotiation agent" title="Merchant offers" />
      <ul className="mt-3 divide-y divide-hairline">
        {lc.proposals.map((p: ProposalView) => (
          <li key={p.id} className="py-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-ink">
                <strong>{p.merchantName}</strong> · {p.quantity} × {p.sku} at{' '}
                <span className="tabular">{money(p.unitPriceMinor)}</span>
                <span className="text-muted"> (list {money(p.listUnitPriceMinor)})</span>
              </p>
              <Chip
                tone={
                  p.state === 'ACCEPTED'
                    ? 'good'
                    : p.state === 'COUNTERED'
                      ? 'signal'
                      : p.state === 'SUBMITTED'
                        ? 'caution'
                        : 'neutral'
                }
              >
                {humanize(p.state)}
                {p.agreedUnitPriceMinor ? ` · ${money(p.agreedUnitPriceMinor)}` : ''}
              </Chip>
            </div>
            <p className="mt-1 text-[13px] text-muted">
              Agent recommends{' '}
              <strong className="text-ink">{humanize(p.evaluation.recommendation)}</strong>:{' '}
              {p.evaluation.rationale}
            </p>
            {p.counterUnitPriceMinor ? (
              <p className="mt-1 text-[13px] text-signal">
                Counter {money(p.counterUnitPriceMinor)}/unit —{' '}
                {p.state === 'COUNTERED'
                  ? 'waiting for the merchant to accept'
                  : 'merchant responded'}
                .
              </p>
            ) : null}
            {p.allowedActions.length ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {p.allowedActions.includes('ORG_ACCEPT') ? (
                  <Button
                    size="sm"
                    busy={actions.decide.isPending}
                    onClick={() =>
                      actions.decide.mutate({ proposalId: p.id, action: 'ORG_ACCEPT' })
                    }
                  >
                    Accept {money(p.unitPriceMinor)}
                  </Button>
                ) : null}
                {p.allowedActions.includes('ORG_COUNTER') ? (
                  <>
                    <label className="sr-only" htmlFor={`c-${p.id}`}>
                      Counter price
                    </label>
                    <input
                      id={`c-${p.id}`}
                      inputMode="decimal"
                      placeholder={(Number(p.evaluation.targetUnitPriceMinor) / 100).toFixed(2)}
                      value={counter[p.id] ?? ''}
                      onChange={(e) => setCounter({ ...counter, [p.id]: e.target.value })}
                      className="tabular h-8 w-20 rounded-md border border-hairline-strong bg-paper px-2 text-[13px]"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      busy={actions.decide.isPending}
                      onClick={() =>
                        actions.decide.mutate({
                          proposalId: p.id,
                          action: 'ORG_COUNTER',
                          counterUnitPriceMinor: counter[p.id]
                            ? String(Math.round(Number(counter[p.id]) * 100))
                            : p.evaluation.targetUnitPriceMinor,
                        })
                      }
                    >
                      Counter
                    </Button>
                  </>
                ) : null}
                {p.allowedActions.includes('ORG_DECLINE') ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    busy={actions.decide.isPending}
                    onClick={() =>
                      actions.decide.mutate({ proposalId: p.id, action: 'ORG_DECLINE' })
                    }
                  >
                    Decline
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {err ? (
        <p role="alert" className="mt-2 text-sm text-breach">
          {errorMessage(err)}
        </p>
      ) : null}
      <p className="mt-2 text-[12px] text-muted">
        A deal exists only after both sides explicitly accept. Accepted terms are used on the next
        plan or re-plan.
      </p>
    </Sheet>
  );
}

/* ---------- Sponsors ---------- */

export function SponsorsPanel({ lc }: { lc: MissionLifecycleView }) {
  return (
    <Sheet className="p-5">
      <SectionHeading kicker="Funding" title="Sponsors" />
      {lc.sponsors.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No sponsor has funded an order yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-hairline text-sm">
          {lc.sponsors.map((s) => (
            <li
              key={`${s.sponsorOrg}-${s.sponsorName}`}
              className="flex items-center justify-between py-2"
            >
              <span>
                <span className="text-ink">{s.sponsorName}</span>
                <span className="text-muted"> · {s.sponsorOrg}</span>
              </span>
              <span className="tabular text-ink">
                {money(s.amountMinor, lc.budget.currency)}{' '}
                <span className="text-muted">
                  · {s.orders} order{s.orders === 1 ? '' : 's'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[13px] text-muted">
        Still unfunded:{' '}
        <span className="tabular text-ink">{money(lc.unfundedMinor, lc.budget.currency)}</span>.
        Each sponsor pays a specific merchant order through PayPal — no pooled wallet, no escrow,
        not a charitable donation.
      </p>
    </Sheet>
  );
}

/* ---------- Agent run graph ---------- */

export function AgentRunGraph({ lc }: { lc: MissionLifecycleView }) {
  const [idx, setIdx] = useState(0);
  if (lc.agentRuns.length === 0) return null;
  const run = lc.agentRuns[Math.min(idx, lc.agentRuns.length - 1)]!;
  return (
    <Sheet className="p-5">
      <SectionHeading
        kicker="Procurement Canvas · agent graph"
        title={run.workflow === 'needmesh.recovery' ? 'Recovery run' : 'Planning run'}
        aside={
          lc.agentRuns.length > 1 ? (
            <div className="flex gap-1">
              {lc.agentRuns.map((r, i) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setIdx(i)}
                  aria-pressed={i === idx}
                  className={clsx(
                    'rounded-full border px-2.5 py-0.5 text-[12px]',
                    i === idx
                      ? 'border-signal bg-signal-soft text-signal-strong'
                      : 'border-hairline-strong text-muted',
                  )}
                >
                  {r.workflow.replace('needmesh.', '')}
                </button>
              ))}
            </div>
          ) : null
        }
      />
      <ol className="mt-4 flex flex-col gap-2 lg:flex-row lg:items-stretch">
        {run.nodes.map((n, i) => (
          <li key={n.node} className="flex flex-1 items-stretch gap-2">
            <div
              className={clsx(
                'flex-1 rounded-md border p-2.5 text-[12px]',
                n.status === 'DONE' && 'border-good/40 bg-good-soft',
                n.status === 'FAILED' && 'border-breach/40 bg-breach-soft',
                n.status === 'SKIPPED' && 'border-hairline bg-paper-2 text-muted',
              )}
              title={n.output}
            >
              <p className="font-medium text-ink">
                {n.status === 'DONE' ? '✓' : n.status === 'FAILED' ? '✕' : '–'} {n.label}
              </p>
              <p className="mt-1 line-clamp-3 text-muted">{n.output}</p>
            </div>
            {i < run.nodes.length - 1 ? (
              <span aria-hidden className="hidden self-center text-muted lg:block">
                →
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[12px] text-muted">
        Engine: <span className="font-mono">{run.engine}</span> · durable trace stored per run.
        Nodes are deterministic services; an LLM may only narrate.
      </p>
    </Sheet>
  );
}

/* ---------- PromiseTwin per order ---------- */

const HEALTH_TONE: Record<
  OrderProtectionView['health'],
  'neutral' | 'good' | 'caution' | 'breach' | 'signal'
> = {
  UNDETERMINED: 'neutral',
  ON_TRACK: 'good',
  AT_RISK: 'caution',
  BREACHED: 'breach',
  UNDER_RECOVERY: 'signal',
  FULFILLED: 'good',
};
const TRACK_SYMBOL = { MET: '●', PENDING: '◌', AT_RISK: '▲', FAILED: '✕' } as const;

export function OrderProtection({ order }: { order: MissionOrderView }) {
  const p = order.protection;
  return (
    <details className="mt-3 rounded-md border border-hairline bg-paper-2 p-3 text-[13px]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
        <span className="kicker">PromiseTwin</span>
        <Chip tone={HEALTH_TONE[p.health]}>{humanize(p.health)}</Chip>
      </summary>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
        {p.tracks.map((t) => (
          <li key={t.track} className="flex gap-1.5">
            <span
              aria-hidden
              className={clsx(
                t.status === 'MET' && 'text-good',
                t.status === 'FAILED' && 'text-breach',
                t.status === 'AT_RISK' && 'text-caution',
                t.status === 'PENDING' && 'text-muted',
              )}
            >
              {TRACK_SYMBOL[t.status]}
            </span>
            <span>
              <span className="text-ink">{humanize(t.track)}</span>{' '}
              <span className="text-muted">— {t.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      {p.gaps.length ? <p className="mt-2 text-breach">Gaps: {p.gaps.join(' ')}</p> : null}
      {p.remedies.length ? (
        <p className="mt-1 text-signal">Remedies: {p.remedies.join(' ')}</p>
      ) : null}
    </details>
  );
}

/* ---------- Receipt export ---------- */

export function ReceiptExport({
  receipt,
  lc,
}: {
  receipt: MissionReceiptView;
  lc: MissionLifecycleView;
}) {
  const download = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            receipt,
            atlas: lc.atlas,
            sponsors: lc.sponsors,
            rail: lc.rail.mode,
            exportedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mission-receipt-${receipt.id.slice(0, 8)}-r${receipt.revision}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <Button size="sm" variant="secondary" onClick={download}>
        Download receipt (JSON)
      </Button>
      <Button size="sm" variant="ghost" onClick={() => window.print()}>
        Print / save as PDF
      </Button>
    </div>
  );
}

/* ---------- Publish & repeat (organization) ---------- */

export function OrgControls({ lc, actions }: { lc: MissionLifecycleView; actions: Actions }) {
  const router = useRouter();
  const m = lc.marketplace;
  const [summary, setSummary] = useState(m.publicSummary ?? '');
  const [category, setCategory] = useState(m.category);
  const published = m.visibility === 'PUBLIC';
  const err = actions.publish.error ?? actions.repeat.error;
  return (
    <Sheet className="p-5" id="repeat">
      <SectionHeading
        kicker="Marketplace & repeat"
        title={published ? 'Published to the marketplace' : 'Private mission'}
        aside={
          m.orgVerified ? (
            <Chip tone="good">✓ Verified org</Chip>
          ) : (
            <Chip tone="caution">Org not verified</Chip>
          )
        }
      />
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_10rem]">
        <label className="text-[12px] text-muted">
          Public summary (no addresses, no names of people helped)
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={2}
            maxLength={400}
            className="mt-1 w-full rounded-md border border-hairline-strong bg-paper p-2 text-sm text-ink"
          />
        </label>
        <label className="text-[12px] text-muted">
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-hairline-strong bg-paper px-2 text-sm text-ink"
          >
            {['hygiene', 'food', 'shelter', 'education', 'medical', 'packaging', 'supplies'].map(
              (c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ),
            )}
          </select>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          busy={actions.publish.isPending}
          disabled={summary.trim().length < 10}
          onClick={() =>
            actions.publish.mutate({
              visibility: published ? 'PRIVATE' : 'PUBLIC',
              category,
              publicSummary: summary,
            })
          }
        >
          {published ? 'Unpublish' : 'Publish to marketplace'}
        </Button>
        {published ? (
          <Button
            size="sm"
            variant="ghost"
            busy={actions.publish.isPending}
            onClick={() =>
              actions.publish.mutate({ visibility: 'PUBLIC', category, publicSummary: summary })
            }
          >
            Update summary
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          busy={actions.repeat.isPending}
          onClick={() =>
            actions.repeat.mutate({}, { onSuccess: (r) => router.push(`/missions/${r.missionId}`) })
          }
        >
          Repeat this mission (+14 days)
        </Button>
      </div>
      {err ? (
        <p role="alert" className="mt-2 text-sm text-breach">
          {errorMessage(err)}
        </p>
      ) : null}
    </Sheet>
  );
}
