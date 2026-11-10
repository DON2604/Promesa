'use client';

import clsx from 'clsx';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import type { ThreadNode, TwinDetail } from '@promesa/contracts';
import { api, errorMessage } from '@/lib/api';
import { humanize, money, shortWhen, when } from '@/lib/format';
import { qk, useContrast, useHealthBreakdown, useThreads, useTwin } from '@/lib/queries';
import { DemoControls } from '@/components/twin/demo-controls';
import { Faultline } from '@/components/twin/faultline';
import { PromiseThreads } from '@/components/twin/promise-threads';
import { ProofPassport, RecoveryWorkbench } from '@/components/twin/recovery-workbench';
import {
  Button,
  ButtonLink,
  Chip,
  HealthStamp,
  Kicker,
  LoadingSheet,
  ProvenanceTag,
  SectionHeading,
  Sheet,
  SimulatedTag,
  StateBlock,
} from '@/components/ui';

const TRACKS: Array<ThreadNode['track']> = ['INTENT', 'MERCHANT', 'PAYPAL', 'DELIVERY'];
const TRACK_LABEL: Record<ThreadNode['track'], string> = {
  INTENT: 'Intent',
  MERCHANT: 'Merchant',
  PAYPAL: 'PayPal',
  DELIVERY: 'Delivery',
};

export default function TwinPage() {
  const { id } = useParams<{ id: string }>();
  const client = useQueryClient();
  const twin = useTwin(id);
  const threads = useThreads(id);
  const contrast = useContrast(id);
  const breakdown = useHealthBreakdown(id);

  const evaluate = useMutation({
    mutationFn: () => api(`/v1/twins/${id}/evaluate`, { method: 'POST', body: {} }),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.twin(id) }),
  });

  if (twin.isLoading) return <LoadingSheet label="Loading PromiseTwin" />;
  if (twin.isError || !twin.data)
    return (
      <StateBlock
        tone="breach"
        title="This PromiseTwin could not be loaded."
        action={
          <ButtonLink href="/dashboard" variant="secondary">
            Back to overview
          </ButtonLink>
        }
      >
        {errorMessage(twin.error)}
      </StateBlock>
    );

  const t = twin.data;
  const tz = t.intent.spec.timezone;
  const ev = t.latestEvaluation;
  const nodes = threads.data?.nodes ?? t.firstPageThreads.nodes;
  const edges = threads.data?.edges ?? t.firstPageThreads.edges;

  return (
    <div className="space-y-8">
      <header className="sheet sticky top-[4.25rem] z-20 flex flex-wrap items-center justify-between gap-4 p-4 sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
        <div className="min-w-0">
          <Kicker>PromiseTwin{t.scenarioKey ? ` · ${t.scenarioKey}` : ''}</Kicker>
          <h1 className="font-display mt-1 text-[clamp(1.6rem,3.4vw,2.7rem)] leading-[1.06]">
            {t.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <HealthStamp health={t.health} size="lg" />
            {t.simulationMode ? <SimulatedTag /> : null}
            <span className="text-sm text-muted">
              As of {shortWhen(t.asOf, tz)}
              {ev?.clock.simulated ? ' (simulated clock)' : ''} · evaluation v{ev?.version ?? 0}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" busy={evaluate.isPending} onClick={() => evaluate.mutate()}>
            Re-evaluate
          </Button>
          <ButtonLink href={`/twins/${t.id}/history`} variant="secondary">
            History
          </ButtonLink>
          <ButtonLink href={`/purchases/${t.purchaseId}`} variant="ghost">
            Purchase
          </ButtonLink>
        </div>
        {evaluate.isError ? (
          <p role="alert" className="w-full text-sm text-breach">
            {errorMessage(evaluate.error)}
          </p>
        ) : null}
      </header>

      <FourTrackRail nodes={nodes} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.1fr)]">
        {/* Promised & paid */}
        <div className="space-y-6">
          <PromisePanel twin={t} />
        </div>

        {/* Threads */}
        <Sheet className="self-start p-5">
          <SectionHeading kicker="Promise threads" title="How the records connect" />
          <div className="mt-5">
            <PromiseThreads nodes={nodes} edges={edges} />
          </div>
        </Sheet>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2.1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Sheet className="p-5">
            <SectionHeading kicker="Faultline" title="Promise versus reality" />
            <div className="mt-5">
              {contrast.data ? (
                <Faultline contrast={contrast.data} />
              ) : contrast.isError ? (
                <p className="text-sm text-breach">{errorMessage(contrast.error)}</p>
              ) : (
                <LoadingSheet label="Loading contrast" />
              )}
            </div>
          </Sheet>
        </div>

        {/* Why */}
        <div className="space-y-6">
          <Sheet className="p-5">
            <SectionHeading
              kicker={`Deterministic evaluator · ${ev?.evaluator.version ?? '—'}`}
              title="Why this health"
            />
            {ev ? (
              <div className="mt-4 space-y-5 text-sm">
                <p className="text-ink">{ev.interpretation}</p>
                {ev.causes.length > 0 ? (
                  <div>
                    <Kicker>Likely cause</Kicker>
                    <ul className="mt-2 space-y-3">
                      {ev.causes.map((c) => (
                        <li
                          key={c.classification}
                          className="rounded-md border border-hairline p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-ink">
                              {humanize(c.classification)}
                            </span>
                            <span className="tabular font-mono text-xs text-muted">
                              {Math.round(c.confidence * 100)}% confidence
                            </span>
                          </div>
                          <p className="mt-1 text-muted">Next: {c.recommendedNextAction}</p>
                          {c.unknowns.length > 0 ? (
                            <p className="mt-1 text-xs text-muted">
                              Unknown: {c.unknowns.join('; ')}
                            </p>
                          ) : null}
                          <p className="mt-1 text-xs text-muted">Payment side effect: none</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div>
                  <Kicker>Facts (from evidence)</Kicker>
                  <ul className="mt-2 space-y-1.5">
                    {ev.facts.map((f) => (
                      <li key={f.evidenceId} className="flex gap-2">
                        <span aria-hidden className="text-good">
                          ■
                        </span>
                        <span className="text-ink">
                          {f.statement}{' '}
                          <span className="text-xs text-muted">· {humanize(f.source)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                {ev.predictions.length > 0 ? (
                  <div>
                    <Kicker>Predictions (not facts)</Kicker>
                    <ul className="mt-2 space-y-1.5">
                      {ev.predictions.map((p) => (
                        <li key={p} className="flex gap-2">
                          <span aria-hidden className="text-caution">
                            ◇
                          </span>
                          <span className="text-ink">{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {ev.evidenceGaps.length > 0 ? (
                  <div>
                    <Kicker>Evidence gaps</Kicker>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                      {ev.evidenceGaps.map((g) => (
                        <li key={g}>{g}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted">Not evaluated yet. Press Re-evaluate.</p>
            )}
          </Sheet>

          {breakdown.data ? (
            <Sheet className="p-5">
              <SectionHeading kicker="Health layers" title="What each layer proves" />
              <ul className="mt-4 space-y-2.5 text-sm">
                {breakdown.data.layers.map((l) => (
                  <li key={l.layer} className="grid grid-cols-[6.5rem_1fr] gap-2">
                    <span className="kicker pt-0.5">{humanize(l.layer)}</span>
                    <span>
                      <Chip
                        tone={
                          l.present
                            ? l.verification === 'SIMULATED'
                              ? 'caution'
                              : 'good'
                            : 'neutral'
                        }
                      >
                        {l.present ? l.verification.toLowerCase() : 'absent'}
                      </Chip>
                      <span className="mt-1 block text-xs text-muted">{l.note}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Sheet>
          ) : null}

          {t.scenarioKey && t.simulationMode ? (
            <DemoControls scenarioKey={t.scenarioKey} twinId={t.id} />
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <RecoveryWorkbench twin={t} />
        <ProofPassport twin={t} />
      </div>

      <Sheet className="p-5">
        <SectionHeading kicker="Evidence" title={`${t.evidence.length} records, append-only`} />
        <ol className="mt-4 divide-y divide-hairline">
          {t.evidence.map((e) => (
            <li
              key={e.id}
              className="grid gap-2 py-3 text-sm sm:grid-cols-[10rem_1fr_auto] sm:items-baseline sm:gap-4"
            >
              <span className="tabular text-muted">{shortWhen(e.occurredAt, tz)}</span>
              <span className="text-ink">
                {e.summary} <span className="text-xs text-muted">· {humanize(e.kind)}</span>
              </span>
              <ProvenanceTag provenance={e.provenance} />
            </li>
          ))}
        </ol>
      </Sheet>
    </div>
  );
}

function FourTrackRail({ nodes }: { nodes: ThreadNode[] }) {
  return (
    <ol
      className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-sheet)] border border-hairline bg-hairline md:grid-cols-4"
      aria-label="Four tracks"
    >
      {TRACKS.map((track) => {
        const items = nodes
          .filter((n) => n.track === track && n.kind !== 'ASSESSMENT')
          .sort((a, b) => b.eventSequence - a.eventSequence);
        const latest = items.find((n) => n.status !== 'PLANNED') ?? items[0];
        const status = latest?.status ?? 'PLANNED';
        return (
          <li key={track} className="bg-paper p-4">
            <p className="kicker">{TRACK_LABEL[track]}</p>
            <p
              className={clsx(
                'mt-2 text-[15px] font-medium',
                status === 'CONFIRMED' && 'text-ink',
                status === 'PENDING' && 'text-caution',
                status === 'FAILED' && 'text-breach',
                (status === 'PLANNED' || status === 'UNKNOWN') && 'text-muted',
              )}
            >
              <span aria-hidden>
                {status === 'CONFIRMED'
                  ? '● '
                  : status === 'FAILED'
                    ? '✕ '
                    : status === 'PENDING'
                      ? '▲ '
                      : '◌ '}
              </span>
              {latest?.label ?? 'Nothing yet'}
            </p>
            <p className="mt-1 line-clamp-2 text-xs text-muted">
              {latest?.detail ?? 'No record exists on this track.'}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function PromisePanel({ twin }: { twin: TwinDetail }) {
  const spec = twin.intent.spec;
  return (
    <>
      <Sheet className="p-5" folded>
        <Kicker>Buyer intent · confirmed</Kicker>
        <p className="font-display mt-2 text-[20px] leading-snug">
          {spec.quantity} {spec.productLabel.toLowerCase()}
        </p>
        <ul className="mt-3 space-y-1 text-sm text-ink">
          {spec.requiredAttributes.length ? (
            <li>Must be {spec.requiredAttributes.join(', ')}</li>
          ) : null}
          {spec.prohibitedAttributes.length ? (
            <li>Must not be {spec.prohibitedAttributes.join(', ')}</li>
          ) : null}
          <li>At most {money(spec.budgetMinor, spec.currency)}</li>
          <li>Before {when(spec.deadlineISO, spec.timezone)}</li>
        </ul>
        <p className="mt-3 text-xs text-muted">
          The deadline is the buyer’s requirement until a seller accepts it.
        </p>
      </Sheet>

      <Sheet className="p-5">
        <div className="flex items-center justify-between gap-2">
          <Kicker>Seller commitment</Kicker>
          {twin.commitment ? <ProvenanceTag provenance={twin.commitment.provenance} /> : null}
        </div>
        {twin.commitment ? (
          <div className="mt-2 space-y-1 text-sm">
            <p className="font-medium text-ink">
              {twin.commitment.merchantName} · terms v{twin.commitment.version}
            </p>
            <p className="text-ink">{twin.commitment.terms.title}</p>
            <p className="text-ink">
              Deliver by{' '}
              {when(twin.commitment.terms.deliverBy, twin.commitment.terms.deliveryTimezone)}
            </p>
            <p className="tabular text-ink">
              {money(twin.commitment.terms.totalMinor, twin.commitment.terms.currency)}
            </p>
            <p className="text-xs text-muted">
              Accepted by {twin.commitment.acceptedByName} ·{' '}
              {shortWhen(twin.commitment.acceptedAt, spec.timezone)}
            </p>
            <p className="text-xs text-muted">Refunds: {twin.commitment.terms.refundPolicy}</p>
            <p className="break-all font-mono text-[10px] text-muted">
              terms {twin.commitment.termsHash.slice(0, 16)}…
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">No seller has accepted these terms yet.</p>
        )}
      </Sheet>

      <Sheet className="p-5">
        <div className="flex items-center justify-between gap-2">
          <Kicker>PayPal</Kicker>
          <Chip tone={twin.payment.status === 'CAPTURED' ? 'good' : 'neutral'}>
            {humanize(twin.payment.status)}
          </Chip>
        </div>
        <p className="mt-2 text-sm text-muted">{twin.payment.note}</p>
        {twin.payment.paypalOrderId ? (
          <p className="mt-2 font-mono text-xs text-ink">Order {twin.payment.paypalOrderId}</p>
        ) : null}
        <p className="mt-3 text-xs text-muted">A completed capture proves payment, not delivery.</p>
      </Sheet>
    </>
  );
}
