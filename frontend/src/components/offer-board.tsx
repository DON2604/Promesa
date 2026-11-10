'use client';

import clsx from 'clsx';
import type { OffersResponse } from '@promesa/contracts';
import { money, shortWhen } from '@/lib/format';
import { Chip, Kicker, SectionHeading, Sheet, SimulatedTag, StateBlock } from './ui';

export function OfferBoard({ data, timezone }: { data: OffersResponse; timezone: string }) {
  const eligible = data.offers.filter((o) => o.eligible);
  const excluded = data.offers.filter((o) => !o.eligible);

  return (
    <div className="space-y-10">
      <section aria-labelledby="plans" className="space-y-4">
        <SectionHeading
          id="plans"
          kicker={`Deterministic solver · ${data.solverVersion}`}
          title="Plans that satisfy every hard constraint"
        />
        {data.plans.length === 0 ? (
          <StateBlock title="No plan satisfies every hard constraint.">
            {data.infeasibleReason}
          </StateBlock>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.plans.map((p) => (
              <li key={p.key}>
                <Sheet className="flex h-full flex-col p-5">
                  <Kicker>{p.label}</Kicker>
                  <p className="font-display tabular mt-2 text-[32px] leading-none">
                    {money(p.totalMinor, p.currency)}
                  </p>
                  <p className="mt-2 text-sm text-muted">
                    Arrives by {shortWhen(p.latestDeliveryAt, timezone)} · {p.merchantCount}{' '}
                    merchant
                    {p.merchantCount === 1 ? '' : 's'}
                  </p>
                  <ul className="mt-4 space-y-1.5 border-t border-hairline pt-3 text-sm">
                    {p.lines.map((l) => (
                      <li key={l.productId} className="flex justify-between gap-3">
                        <span className="text-ink">
                          {l.quantity} × {l.merchantName}
                        </span>
                        <span className="tabular text-muted">
                          {money(l.totalMinor, p.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 flex-1 text-[13px] leading-relaxed text-muted">
                    {p.explanation}
                  </p>
                </Sheet>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="offers" className="space-y-4">
        <SectionHeading
          id="offers"
          kicker="Catalog"
          title={`${eligible.length} eligible · ${excluded.length} excluded`}
          aside={data.simulationMode ? <SimulatedTag /> : undefined}
        />
        <ul className="grid gap-4 lg:grid-cols-2">
          {[...eligible, ...excluded].map((o) => (
            <li key={o.productId}>
              <article className={clsx('sheet h-full p-5', !o.eligible && 'bg-paper-2')}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="kicker">
                      {o.merchant.name} · {o.sku}
                    </p>
                    <h3
                      className={clsx(
                        'mt-1 text-[17px] font-medium',
                        o.eligible ? 'text-ink' : 'text-muted',
                      )}
                    >
                      {o.title}
                    </h3>
                  </div>
                  {o.eligible ? (
                    <Chip tone="good">✓ Eligible</Chip>
                  ) : (
                    <Chip tone="breach">✕ Excluded</Chip>
                  )}
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted">Total</dt>
                    <dd className="tabular text-ink">{money(o.totalMinor, o.currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Unit</dt>
                    <dd className="tabular text-ink">{money(o.unitPriceMinor, o.currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Est. arrival</dt>
                    <dd className="text-ink">{shortWhen(o.estimatedDeliveryAt, timezone)}</dd>
                  </div>
                </dl>
                <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Attributes">
                  {o.attributes.map((a) => (
                    <Chip key={a}>{a}</Chip>
                  ))}
                </ul>
                {o.exclusionReasons.length > 0 ? (
                  <ul className="mt-4 space-y-1 border-t border-hairline pt-3 text-sm">
                    {o.exclusionReasons.map((r) => (
                      <li key={r} className="flex gap-2 text-breach">
                        <span aria-hidden>✕</span>
                        <span className="text-ink">{r}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="mt-4 text-xs text-muted">
                  {o.deliveryTerms} ·{' '}
                  {o.merchant.paypalConnected ? 'PayPal connected' : 'PayPal not connected yet'} ·{' '}
                  {o.isDemo ? 'fictional catalog' : o.source}
                </p>
              </article>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
