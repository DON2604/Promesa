'use client';

import Link from 'next/link';
import { Chip, Kicker, LoadingSheet, SectionHeading, Sheet, StateBlock } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { humanize, money, shortWhen } from '@/lib/format';
import { useAnalytics } from '@/lib/queries';

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="metric">
      <p className="kicker">{label}</p>
      <p className="tabular font-display mt-1 text-[28px] leading-none text-ink">{value}</p>
      {hint ? <p className="mt-1.5 text-[12px] text-muted">{hint}</p> : null}
    </div>
  );
}

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

export default function AnalyticsPage() {
  const a = useAnalytics();
  if (a.isLoading) return <LoadingSheet label="Loading analytics" />;
  if (a.isError || !a.data)
    return (
      <StateBlock tone="breach" title="Analytics unavailable.">
        {errorMessage(a.error)}
      </StateBlock>
    );
  const d = a.data;
  const c = d.money.currency;
  return (
    <div className="space-y-8">
      <header>
        <Kicker>NeedMesh · Mission analytics · {humanize(d.scope)} view</Kicker>
        <h1 className="font-display mt-2 text-[clamp(1.8rem,3.4vw,2.6rem)] leading-tight">
          Measurable outcomes
        </h1>
        <p className="mt-2 max-w-2xl text-[14px] text-muted">
          Computed from mission records. “Delivered” counts only units the recipient confirmed — a
          PayPal capture is never counted as delivery. Demo history is simulated.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Missions"
          value={String(d.missions.total)}
          hint={`${d.missions.completed} completed · ${d.missions.active} active · ${d.missions.published} published`}
        />
        <Metric
          label="Units delivered"
          value={`${d.units.delivered}/${d.units.requested}`}
          hint={`Fulfillment rate ${pct(d.units.fulfillmentRate)} · ${d.units.funded} funded`}
        />
        <Metric
          label="Paid to merchants"
          value={money(d.money.capturedMinor, c)}
          hint={`${pct(d.money.budgetUtilization)} of ${money(d.money.budgetMinor, c)} budget`}
        />
        <Metric
          label="Never charged"
          value={money(d.money.neverChargedMinor, c)}
          hint={`Voided authorizations · refunded ${money(d.money.refundedMinor, c)}`}
        />
        <Metric
          label="Avg cost per delivered unit"
          value={d.money.avgUnitCostMinor ? money(d.money.avgUnitCostMinor, c) : '—'}
        />
        <Metric
          label="Stockouts handled"
          value={String(d.recovery.stockouts)}
          hint={`${d.recovery.replacementOrders} replacement orders · ${d.recovery.recoveredUnits} units recovered`}
        />
        <Metric label="Sponsors" value={String(d.sponsors)} hint="Distinct sponsor approvals" />
        <Metric label="Merchants" value={String(d.merchants.length)} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Sheet className="p-5">
          <SectionHeading kicker="By mission" title="Requested vs. delivered" />
          <ul className="mt-4 space-y-4">
            {d.byMission.map((m) => (
              <li key={m.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <Link href={`/missions/${m.id}`} className="text-ink hover:text-signal">
                    {m.title}
                  </Link>
                  <span className="text-[12px] text-muted">
                    {humanize(m.state)} · {shortWhen(m.deadline, 'America/New_York')}
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-cutout">
                  <span
                    className="block h-full rounded-full bg-good"
                    style={{
                      width: `${Math.min(100, (m.delivered / Math.max(1, m.requested)) * 100)}%`,
                    }}
                  />
                </div>
                <p className="tabular mt-1 text-[12px] text-muted">
                  {m.delivered}/{m.requested} delivered · {money(m.spentMinor, c)} paid
                </p>
              </li>
            ))}
          </ul>
        </Sheet>
        <Sheet className="p-5">
          <SectionHeading kicker="Supply" title="Merchant reliability" />
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-[12px] text-muted">
              <tr>
                <th className="py-2 font-normal">Merchant</th>
                <th className="py-2 text-right font-normal">Orders</th>
                <th className="py-2 text-right font-normal">Units recv.</th>
                <th className="py-2 text-right font-normal">Stockouts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {d.merchants.map((m) => (
                <tr key={m.name}>
                  <td className="py-2">{m.name}</td>
                  <td className="tabular py-2 text-right">{m.orders}</td>
                  <td className="tabular py-2 text-right">{m.units}</td>
                  <td className="py-2 text-right">
                    {m.stockouts ? (
                      <Chip tone="caution">{m.stockouts}</Chip>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Sheet>
      </div>
    </div>
  );
}
