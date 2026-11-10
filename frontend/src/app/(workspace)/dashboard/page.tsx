'use client';

import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { humanize, money, relative, shortWhen } from '@/lib/format';
import { useDashboard, useForecast, useMe, useNotifications, useScenarios } from '@/lib/queries';
import {
  Button,
  ButtonLink,
  Chip,
  HealthStamp,
  Kicker,
  LoadingSheet,
  SectionHeading,
  Sheet,
  SimulatedTag,
  StateBlock,
} from '@/components/ui';

function eventLabel(type: string) {
  const [, action = type] = type.split('.');
  const words = action.replace(/_/g, ' ');
  const subject = type.split('.')[0] ?? '';
  return `${subject.charAt(0).toUpperCase()}${subject.slice(1)} ${words}`;
}

function greeting(date: Date, tz: string) {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(
      date,
    ),
  );
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export default function DashboardPage() {
  const me = useMe();
  const dash = useDashboard();
  const scenarios = useScenarios();
  const notes = useNotifications();
  const orgRole =
    me.data?.activeTenant.kind === 'ORG' &&
    ['ORG_ADMIN', 'ORG_OPERATOR'].includes(me.data.activeRole);
  const forecast = useForecast(orgRole);

  if (dash.isLoading || !me.data) return <LoadingSheet label="Loading overview" />;
  if (dash.isError || !dash.data)
    return (
      <StateBlock
        tone="breach"
        title="The overview could not be loaded."
        action={
          <Button variant="secondary" onClick={() => void dash.refetch()}>
            Try again
          </Button>
        }
      >
        {errorMessage(dash.error)}
      </StateBlock>
    );

  const d = dash.data;
  const tz = me.data.activeTenant.timezone;
  const isBuyer = me.data.activeTenant.kind === 'BUSINESS' && me.data.activeRole === 'BUYER';
  const isOrg =
    me.data.activeTenant.kind === 'ORG' &&
    ['ORG_ADMIN', 'ORG_OPERATOR'].includes(me.data.activeRole);
  const isMerchant = ['MERCHANT_ADMIN', 'MERCHANT_OPERATOR'].includes(me.data.activeRole);
  const pending = notes.data?.pending ?? [];
  const counts: Array<[string, number, string]> = [
    ['Active missions', d.counts.activeMissions, 'Missions not yet completed or cancelled'],
    ['Pending actions', pending.length, 'Approvals, offers, confirmations waiting on you'],
    ['Purchases at risk', d.counts.twinsAtRisk, 'PromiseTwins whose latest evaluation is At risk'],
    ['Promises breached', d.counts.twinsBreached, 'Committed terms violated, with evidence'],
  ];

  return (
    <div className="space-y-12">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <Kicker>
            {me.data.activeTenant.name} · {humanize(me.data.activeRole)}
          </Kicker>
          <h1 className="font-display mt-2 text-[clamp(2rem,4vw,3.2rem)] leading-[1.05]">
            {greeting(new Date(), tz)}, {me.data.user.displayName.split(' ')[0]}.
          </h1>
          <p className="mt-2 text-sm text-muted">
            As of {shortWhen(d.asOf, tz)} {d.simulationMode ? '· includes simulated demo data' : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isOrg ? <ButtonLink href="/missions/new">Create a Mission</ButtonLink> : null}
          {isMerchant ? <ButtonLink href="/merchant">Merchant offers</ButtonLink> : null}
          <ButtonLink href="/explore" variant={isOrg || isMerchant ? 'secondary' : 'primary'}>
            Explore Missions
          </ButtonLink>
          {isBuyer ? (
            <ButtonLink href="/purchases/new" variant="secondary">
              Protect a purchase
            </ButtonLink>
          ) : null}
        </div>
      </header>

      <section
        aria-label="Counts"
        className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-sheet)] border border-hairline bg-hairline lg:grid-cols-4"
      >
        {counts.map(([label, value, hint]) => (
          <div key={label} className="bg-paper p-5" title={hint}>
            <p className="font-display tabular text-[40px] leading-none">{value}</p>
            <p className="mt-2 text-sm text-ink">{label}</p>
            <p className="mt-1 text-xs text-muted">{hint}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Sheet className="p-5">
          <SectionHeading
            kicker="Pending actions"
            title={pending.length ? `${pending.length} waiting on you` : 'Nothing waiting on you'}
            aside={
              <Link href="/notifications" className="text-sm text-signal hover:underline">
                All notifications →
              </Link>
            }
          />
          {pending.length > 0 ? (
            <ul className="mt-3 divide-y divide-hairline">
              {pending.slice(0, 6).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div>
                    <p className="text-ink">{p.title}</p>
                    <p className="text-[12px] text-muted">{p.detail}</p>
                  </div>
                  <Link href={p.href} className="shrink-0 font-medium text-signal hover:underline">
                    Open →
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">
              {isOrg
                ? 'Create a mission or check the marketplace for merchant offers.'
                : 'Explore published missions to find needs that match your interests.'}
            </p>
          )}
        </Sheet>
        {isOrg ? (
          <Sheet className="p-5">
            <SectionHeading kicker="Shortage forecast" title="Avoid the next shortage" />
            {forecast.data?.items.length ? (
              <ul className="mt-3 space-y-3">
                {forecast.data.items.slice(0, 3).map((f) => (
                  <li key={f.productKind} className="text-sm">
                    <p className="text-ink">
                      {f.productLabel}
                      {f.predictedNextNeedBy ? (
                        <span className="text-muted">
                          {' '}
                          · next ≈ {shortWhen(f.predictedNextNeedBy, tz)}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted">{f.recommendation}</p>
                    <Link
                      href={`/missions/${f.sourceMissionId}#repeat`}
                      className="mt-1 inline-block text-[13px] text-signal hover:underline"
                    >
                      Start a repeat mission →
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted">Not enough mission history to forecast yet.</p>
            )}
            <p className="mt-3 text-[11px] text-muted">{forecast.data?.basis}</p>
          </Sheet>
        ) : null}
      </div>

      <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-12">
          <section aria-labelledby="missions" className="space-y-4">
            <SectionHeading id="missions" kicker="NeedMesh · missions" title="Your missions" />
            {d.missions.length === 0 ? (
              <StateBlock title="No NeedMesh missions in this workspace yet.">
                A mission is a community need with a budget and a deadline. Agents plan it, a
                sponsor funds it through PayPal, and every outcome is confirmed.
              </StateBlock>
            ) : (
              <ul className="space-y-3">
                {d.missions.map((m) => (
                  <li key={m.id}>
                    <Link
                      href={`/missions/${m.id}`}
                      className="sheet flex flex-wrap items-center justify-between gap-3 p-5 hover:border-signal"
                    >
                      <div>
                        <p className="font-display text-[19px]">{m.title}</p>
                        <p className="mt-1 text-sm text-muted">
                          Budget {money(m.budgetMinor, m.currency)} · by{' '}
                          {shortWhen(m.deadline, m.timezone)}
                        </p>
                      </div>
                      <span className="flex items-center gap-2">
                        {m.isDemo ? <SimulatedTag /> : null}
                        <Chip tone="signal">{humanize(m.state)}</Chip>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="twins" className="space-y-4">
            <SectionHeading
              id="twins"
              kicker="PromiseTwin · purchase protection"
              title="Standalone purchases being protected"
            />
            {d.twins.length === 0 ? (
              <StateBlock title="No PromiseTwins in this workspace yet.">
                {isBuyer
                  ? 'Create a purchase and Promesa opens a PromiseTwin for it automatically.'
                  : 'PromiseTwins belong to purchases made by a business workspace.'}
              </StateBlock>
            ) : (
              <ul className="space-y-3">
                {d.twins.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/twins/${t.id}`}
                      className="sheet group grid gap-3 p-5 transition-[border-color] hover:border-ink sm:grid-cols-[1fr_auto] sm:items-center"
                    >
                      <div>
                        <p className="font-display text-[19px] leading-snug group-hover:underline group-hover:underline-offset-4">
                          {t.title}
                        </p>
                        <p className="mt-1 text-sm text-muted">
                          Deadline {shortWhen(t.deadline, tz)}
                          {t.lastEvaluatedAt
                            ? ` · evaluated as of ${shortWhen(t.lastEvaluatedAt, tz)}`
                            : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {t.isDemo ? <SimulatedTag /> : null}
                        <HealthStamp health={t.health} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {d.purchases.length > 0 ? (
              <div className="pt-6">
                <SectionHeading kicker="Purchases" title="Orders and quotes" />
                <ul className="mt-4 divide-y divide-hairline border-y border-hairline">
                  {d.purchases.map((p) => (
                    <li
                      key={p.id}
                      className="grid grid-cols-[1fr_auto] items-center gap-3 py-3 text-sm"
                    >
                      <Link
                        href={`/purchases/${p.id}`}
                        className="text-ink hover:underline hover:underline-offset-4"
                      >
                        {p.title}
                      </Link>
                      <span className="flex items-center gap-2">
                        <span className="tabular text-muted">
                          {money(p.amountMinor, p.currency)}
                        </span>
                        <Chip>{humanize(p.state)}</Chip>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </div>

        <aside className="space-y-8">
          <Sheet className="p-5">
            <SectionHeading kicker="Demo scenarios" title="Seeded stories" />
            {scenarios.isLoading ? (
              <p className="mt-4 text-sm text-muted">Loading scenarios…</p>
            ) : scenarios.isError ? (
              <p className="mt-4 text-sm text-breach">{errorMessage(scenarios.error)}</p>
            ) : (
              <ul className="mt-4 space-y-4">
                {(scenarios.data ?? []).map((s) => (
                  <li
                    key={s.key}
                    className="border-t border-hairline pt-4 first:border-0 first:pt-0"
                  >
                    <p className="font-mono text-[11px] text-muted">{s.key}</p>
                    <p className="mt-1 font-medium text-ink">{s.title}</p>
                    <p className="mt-1 text-sm text-muted">{s.description}</p>
                    <p className="mt-1 text-xs text-muted">
                      Simulated clock: {shortWhen(s.simulatedNow, s.timezone)}
                    </p>
                    <div className="mt-3 flex gap-2">
                      {s.twinId ? (
                        <ButtonLink href={`/twins/${s.twinId}`} size="sm" variant="secondary">
                          Open PromiseTwin
                        </ButtonLink>
                      ) : null}
                      {s.missionId ? (
                        <ButtonLink href={`/missions/${s.missionId}`} size="sm" variant="secondary">
                          Open mission
                        </ButtonLink>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Sheet>

          <section aria-labelledby="activity">
            <SectionHeading id="activity" kicker="Activity" title="Recent events" />
            {d.recentActivity.length === 0 ? (
              <p className="mt-4 text-sm text-muted">Nothing has happened yet.</p>
            ) : (
              <ol className="mt-4 space-y-3 border-l border-hairline-strong pl-4">
                {d.recentActivity.map((a) => (
                  <li key={a.id} className="relative text-sm">
                    <span
                      aria-hidden
                      className="absolute -left-[21px] top-1.5 size-2 rounded-full border border-ink bg-paper"
                    />
                    <p className="text-ink">{eventLabel(a.label)}</p>
                    <p className="text-xs text-muted">
                      {relative(a.occurredAt)} · {a.aggregateType}
                      {a.simulated ? ' · simulated' : ''}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
