'use client';

import Link from 'next/link';
import {
  ButtonLink,
  Chip,
  HealthStamp,
  Kicker,
  LoadingSheet,
  SectionHeading,
  Sheet,
  StateBlock,
} from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { humanize, shortWhen } from '@/lib/format';
import { useDashboard, useMe } from '@/lib/queries';

const CAPABILITIES = [
  [
    'Intent snapshot',
    'The confirmed need (quantity, rules, budget, deadline) is frozen and hashed before any money moves.',
  ],
  [
    'Merchant commitment',
    'Stock confirmation, accepted proposal terms and delivery estimate are checked against the snapshot.',
  ],
  [
    'PayPal state',
    'Order, authorization, capture, void and refund are read from PayPal — never inferred.',
  ],
  [
    'Delivery evidence',
    'Tracking and the recipient’s acknowledgment are separate tracks. A capture is not a delivery.',
  ],
  [
    'Breach & root cause',
    'Stockouts, late estimates and short deliveries are detected and attributed (merchant, carrier or agent).',
  ],
  [
    'Recovery',
    'Void if uncaptured, merchant-authorized refund if captured, re-plan with fresh human approval.',
  ],
] as const;

export default function ProtectionPage() {
  const me = useMe();
  const dash = useDashboard();
  if (dash.isLoading || !me.data) return <LoadingSheet label="Loading protection" />;
  if (dash.isError || !dash.data)
    return (
      <StateBlock tone="breach" title="Protection overview unavailable.">
        {errorMessage(dash.error)}
      </StateBlock>
    );
  const tz = me.data.activeTenant.timezone;
  const isBuyer = me.data.activeRole === 'BUYER';
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Kicker>PromiseTwin · protection built into NeedMesh</Kicker>
          <h1 className="font-display mt-2 text-[clamp(1.8rem,3.4vw,2.6rem)] leading-tight">
            Every purchase has a twin
          </h1>
          <p className="mt-2 max-w-2xl text-[14px] text-muted">
            Each NeedMesh merchant order gets a PromiseTwin automatically (see the PromiseTwin panel
            on every order in Mission Control). Businesses can also protect a single purchase on its
            own, with the full Promise Fold, Threads, Faultline and Timefold tools.
          </p>
        </div>
        {isBuyer ? <ButtonLink href="/purchases/new">Protect a purchase</ButtonLink> : null}
      </header>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CAPABILITIES.map(([t, d]) => (
          <li key={t} className="metric">
            <p className="font-display text-lg text-ink">{t}</p>
            <p className="mt-1 text-[13px] text-muted">{d}</p>
          </li>
        ))}
      </ul>

      <Sheet className="p-5">
        <SectionHeading kicker="Inside missions" title="Mission orders under protection" />
        {dash.data.missions.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No missions in this workspace.</p>
        ) : (
          <ul className="mt-3 divide-y divide-hairline">
            {dash.data.missions.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <Link href={`/missions/${m.id}#orders`} className="text-ink hover:text-signal">
                  {m.title}
                </Link>
                <Chip tone="signal">{humanize(m.state)}</Chip>
              </li>
            ))}
          </ul>
        )}
      </Sheet>

      <Sheet className="p-5">
        <SectionHeading kicker="Standalone" title="Protected business purchases" />
        {dash.data.twins.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            {isBuyer
              ? 'Create a purchase and a PromiseTwin opens for it automatically.'
              : 'Standalone PromiseTwins belong to business buyer workspaces (try Maya, Crumb & Co.).'}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-hairline">
            {dash.data.twins.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <div>
                  <Link href={`/twins/${t.id}`} className="text-ink hover:text-signal">
                    {t.title}
                  </Link>
                  <p className="text-[12px] text-muted">Deadline {shortWhen(t.deadline, tz)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <HealthStamp health={t.health} />
                  <Link
                    href={`/twins/${t.id}/history`}
                    className="text-[13px] text-signal hover:underline"
                  >
                    Timefold
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </div>
  );
}
