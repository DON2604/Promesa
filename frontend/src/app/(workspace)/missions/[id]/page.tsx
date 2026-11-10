'use client';

import { useParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { humanize, money, when } from '@/lib/format';
import { useMission, useMissionLifecycle, useMissionOffers } from '@/lib/queries';
import { MissionControl } from '@/components/needmesh/mission-control';
import { OfferBoard } from '@/components/offer-board';
import {
  Button,
  ButtonLink,
  Chip,
  Dl,
  Kicker,
  LoadingSheet,
  Sheet,
  SimulatedTag,
  StateBlock,
} from '@/components/ui';

export default function MissionPage() {
  const { id } = useParams<{ id: string }>();
  const mission = useMission(id);
  const lifecycle = useMissionLifecycle(id);

  if (mission.isLoading) return <LoadingSheet label="Loading mission" />;
  if (mission.isError || !mission.data)
    return (
      <StateBlock
        tone="breach"
        title="This mission could not be loaded."
        action={
          <ButtonLink href="/dashboard" variant="secondary">
            Back to overview
          </ButtonLink>
        }
      >
        {errorMessage(mission.error)}
      </StateBlock>
    );

  const m = mission.data;
  const spec = m.intent.spec;
  const lc = lifecycle.data;
  return (
    <div className="space-y-8">
      <header>
        <Kicker>NeedMesh · Mission Control</Kicker>
        <h1 className="font-display mt-2 text-[clamp(1.8rem,3.6vw,2.8rem)] leading-[1.06]">
          {m.title}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Chip tone="signal">{humanize(lc?.state ?? m.state)}</Chip>
          {lc ? (
            <Chip tone={lc.rail.mode === 'SANDBOX' ? 'good' : 'caution'}>
              {lc.rail.mode === 'SANDBOX' ? 'PayPal Sandbox' : 'Simulated PayPal rail'}
            </Chip>
          ) : null}
          {m.isDemo ? <SimulatedTag /> : null}
        </div>
      </header>

      <Sheet className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Kicker>{lc && !lc.viewerIsOrg ? 'Public mission summary' : 'Confirmed need'}</Kicker>
          {lc ? (
            <div className="flex flex-wrap gap-1.5">
              <Chip tone={lc.marketplace.orgVerified ? 'good' : 'caution'}>
                {lc.marketplace.orgName}
                {lc.marketplace.orgVerified ? ' · ✓ verified' : ' · unverified'}
              </Chip>
              <Chip>
                {lc.marketplace.visibility === 'PUBLIC'
                  ? `Public · ${lc.marketplace.category}`
                  : 'Private'}
              </Chip>
            </div>
          ) : null}
        </div>
        <blockquote className="font-display mt-3 border-l-2 border-ink pl-4 text-[19px] leading-snug text-ink">
          “{m.intent.rawText}”
        </blockquote>
        <Dl
          className="mt-5"
          items={[
            ['Quantity', `${spec.quantity} ${spec.productLabel.toLowerCase()}`],
            ['Must be', spec.requiredAttributes.join(', ') || '—'],
            ['Must not be', spec.prohibitedAttributes.join(', ') || '—'],
            ['Budget', `≤ ${money(m.budgetMinor, m.currency)}`],
            ['Needed by', when(m.deadline, m.timezone)],
          ]}
        />
      </Sheet>

      {lifecycle.isLoading ? (
        <LoadingSheet label="Loading mission control" />
      ) : lifecycle.isError || !lc ? (
        <StateBlock
          tone="breach"
          title="Mission Control could not be loaded."
          action={
            <Button variant="secondary" onClick={() => void lifecycle.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(lifecycle.error)}
        </StateBlock>
      ) : (
        <Suspense fallback={<LoadingSheet label="Loading mission control" />}>
          <MissionControl lc={lc} missionId={id} timezone={m.timezone} />
        </Suspense>
      )}
      <ProcurementCanvas missionId={id} timezone={m.timezone} />
    </div>
  );
}

function ProcurementCanvas({ missionId, timezone }: { missionId: string; timezone: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Kicker>Procurement Canvas</Kicker>
          <p className="mt-1 text-sm text-muted">
            Every feasible plan the solver found — cheapest, fastest and fewest merchants — with the
            listings each hard constraint excluded.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Hide alternatives' : 'Compare alternatives'}
        </Button>
      </div>
      {open ? <CanvasBody missionId={missionId} timezone={timezone} /> : null}
    </Sheet>
  );
}

function CanvasBody({ missionId, timezone }: { missionId: string; timezone: string }) {
  const offers = useMissionOffers(missionId);
  if (offers.isLoading) return <LoadingSheet label="Comparing offers" />;
  if (!offers.data) return <p className="mt-3 text-sm text-breach">{errorMessage(offers.error)}</p>;
  return (
    <div className="mt-6">
      <OfferBoard data={offers.data} timezone={timezone} />
    </div>
  );
}
