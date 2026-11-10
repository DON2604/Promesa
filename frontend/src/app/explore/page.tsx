'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import type { MarketplaceMissionCard } from '@promesa/contracts';
import { PublicFooter, PublicHeader } from '@/components/public-chrome';
import { Chip, Kicker, LoadingSheet, Sheet, StateBlock } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { humanize, money, shortWhen } from '@/lib/format';
import { useMarketplace } from '@/lib/queries';

function Progress({ card }: { card: MarketplaceMissionCard }) {
  const { requested, planned, funded, received } = card.progress;
  const pct = (n: number) => `${Math.min(100, (n / Math.max(1, requested)) * 100)}%`;
  return (
    <div className="space-y-1.5" aria-label="Mission progress">
      <div className="relative h-2 overflow-hidden rounded-full bg-cutout">
        <span className="absolute inset-y-0 left-0 bg-signal/25" style={{ width: pct(planned) }} />
        <span className="absolute inset-y-0 left-0 bg-signal" style={{ width: pct(funded) }} />
        <span className="absolute inset-y-0 left-0 bg-good" style={{ width: pct(received) }} />
      </div>
      <p className="tabular text-[12px] text-muted">
        {planned}/{requested} sourced · {funded} funded · {received} received
      </p>
    </div>
  );
}

function MissionCard({ card }: { card: MarketplaceMissionCard }) {
  return (
    <Sheet as="article" className="flex h-full flex-col p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="signal">{card.category}</Chip>
        {card.orgVerified ? <Chip tone="good">✓ Verified org</Chip> : <Chip>Unverified</Chip>}
        {card.isDemo ? <Chip tone="caution">Demo</Chip> : null}
        <span className="ml-auto text-[12px] text-muted">{humanize(card.state)}</span>
      </div>
      <h2 className="font-display mt-3 text-xl leading-snug text-ink">{card.title}</h2>
      <p className="mt-1 text-[13px] text-muted">
        {card.orgName}
        {card.orgCity ? ` · ${card.orgCity}` : ''}
      </p>
      {card.publicSummary ? (
        <p className="mt-3 text-[14px] leading-relaxed text-muted">{card.publicSummary}</p>
      ) : null}
      <dl className="mt-4 grid grid-cols-3 gap-2 text-[13px]">
        <div>
          <dt className="text-muted">Need</dt>
          <dd className="tabular text-ink">
            {card.quantity} {card.unit}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Budget</dt>
          <dd className="tabular text-ink">{money(card.budgetMinor, card.currency)}</dd>
        </div>
        <div>
          <dt className="text-muted">By</dt>
          <dd className="text-ink">{shortWhen(card.deadline, card.timezone)}</dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {card.requiredAttributes.map((a) => (
          <Chip key={a} tone="good">
            + {a}
          </Chip>
        ))}
        {card.prohibitedAttributes.map((a) => (
          <Chip key={a} tone="breach">
            − {a}
          </Chip>
        ))}
      </div>
      <div className="mt-4">
        <Progress card={card} />
      </div>
      {card.match ? (
        <div className="mt-4 rounded-md border border-signal/30 bg-signal-soft p-3 text-[13px]">
          <p className="font-medium text-signal-strong">Match score {card.match.score}/100</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink">
            {card.match.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-auto flex items-center justify-between gap-2 pt-5 text-[13px]">
        <span className="text-muted">
          {card.openOrders > 0
            ? `${card.openOrders} order${card.openOrders === 1 ? '' : 's'} · ${money(card.unfundedMinor, card.currency)} awaiting a sponsor`
            : card.progress.planned === 0
              ? 'Agents have not planned yet'
              : 'No open orders'}
        </span>
        <Link href={`/missions/${card.id}`} className="font-medium text-signal hover:underline">
          View mission →
        </Link>
      </div>
    </Sheet>
  );
}

export default function ExplorePage() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string>('');
  const deferred = useDeferredValue(q);
  const market = useMarketplace({ q: deferred, category: category || undefined });
  const all = useMarketplace({});

  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto max-w-[1200px] px-5 pb-10 pt-10 sm:px-8">
        <Kicker>NeedMesh marketplace · needs come first</Kicker>
        <h1 className="font-display mt-3 text-[clamp(2rem,4vw,3.2rem)] leading-[1.05]">
          Explore missions
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] text-muted">
          Verified organizations publish what they need. Sponsors fund individual merchant orders
          through PayPal; connected merchants submit offers. Only a public summary is shown — never
          delivery addresses or the people being helped.
        </p>
        {market.data?.viewer.role ? (
          <p className="mt-2 text-[13px] text-muted">
            Signed in as {humanize(market.data.viewer.role)} · {market.data.viewer.tenantName}
            {market.data.viewer.role === 'SPONSOR' ? ' — sorted by your saved interests.' : ''}
          </p>
        ) : (
          <p className="mt-2 text-[13px] text-muted">
            <Link href="/sign-in?persona=leo&next=/explore" className="text-signal hover:underline">
              Sign in as a sponsor
            </Link>{' '}
            to see match scores and fund orders.
          </p>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="search">
            Search missions
          </label>
          <input
            id="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by need, organization or city"
            className="h-10 w-full max-w-sm rounded-[var(--radius-control)] border border-hairline-strong bg-paper px-3 text-sm text-ink placeholder:text-muted focus:border-signal"
          />
          <div role="group" aria-label="Category" className="flex flex-wrap gap-1.5">
            {[
              { key: '', label: 'All', count: all.data?.missions.length ?? 0 },
              ...(all.data?.categories ?? []),
            ].map((c) => (
              <button
                key={c.key || 'all'}
                type="button"
                aria-pressed={category === c.key}
                onClick={() => setCategory(c.key)}
                className={clsx(
                  'h-8 rounded-full border px-3 text-[13px]',
                  category === c.key
                    ? 'border-signal bg-signal-soft text-signal-strong'
                    : 'border-hairline-strong bg-paper text-muted hover:text-ink',
                )}
              >
                {c.label} <span className="tabular text-muted">{c.count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-8">
          {market.isLoading ? (
            <LoadingSheet label="Loading missions" />
          ) : market.isError ? (
            <StateBlock tone="breach" title="The marketplace could not be loaded.">
              {errorMessage(market.error)}
            </StateBlock>
          ) : market.data && market.data.missions.length > 0 ? (
            <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {market.data.missions.map((m) => (
                <li key={m.id}>
                  <MissionCard card={m} />
                </li>
              ))}
            </ul>
          ) : (
            <StateBlock title="No published missions match.">
              Try another category or clear the search.
            </StateBlock>
          )}
        </div>
      </main>
      <PublicFooter />
    </>
  );
}
