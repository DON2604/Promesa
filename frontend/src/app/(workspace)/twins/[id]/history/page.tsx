'use client';

import { useParams } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { HEALTH_SYMBOL, shortWhen } from '@/lib/format';
import { useAnimeScope } from '@/lib/motion';
import { useSnapshot, useSnapshots, useTwin } from '@/lib/queries';
import {
  ButtonLink,
  Chip,
  HealthStamp,
  Kicker,
  LoadingSheet,
  ProvenanceTag,
  Sheet,
  SimulatedTag,
  StateBlock,
} from '@/components/ui';

export default function TimefoldPage() {
  const { id } = useParams<{ id: string }>();
  const sliderId = useId();
  const twin = useTwin(id);
  const snapshots = useSnapshots(id);
  const items = snapshots.data?.items ?? [];
  const [index, setIndex] = useState<number | null>(null);
  const current = index ?? items.length - 1;
  const selected = items[current] ?? null;
  const detail = useSnapshot(id, selected?.id ?? null);
  const page = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (index !== null && index > items.length - 1) setIndex(null);
  }, [index, items.length]);

  useAnimeScope(
    page,
    ({ animate }) => {
      animate('[data-page]', {
        rotateY: [-10, 0],
        opacity: [0.35, 1],
        translateX: [-12, 0],
        duration: 460,
        ease: 'out(3)',
      });
    },
    detail.data?.id,
    !!detail.data,
  );

  if (snapshots.isLoading || twin.isLoading) return <LoadingSheet label="Loading history" />;
  if (snapshots.isError || !snapshots.data)
    return (
      <StateBlock tone="breach" title="History could not be loaded.">
        {errorMessage(snapshots.error)}
      </StateBlock>
    );

  const tz = twin.data?.intent.spec.timezone ?? 'UTC';
  if (items.length === 0) return <StateBlock title="No snapshots recorded yet." />;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Kicker>Timefold · immutable snapshots</Kicker>
          <h1 className="font-display mt-2 text-[clamp(1.7rem,3.4vw,2.6rem)] leading-[1.06]">
            {twin.data?.title ?? 'PromiseTwin history'}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Each page is what Promesa knew at that moment. Later evidence never rewrites an earlier
            page.
          </p>
        </div>
        <ButtonLink href={`/twins/${id}`} variant="secondary">
          ← Back to PromiseTwin
        </ButtonLink>
      </header>

      <Sheet className="p-5">
        <label htmlFor={sliderId} className="kicker">
          Snapshot {current + 1} of {items.length}
        </label>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={items.length - 1}
          step={1}
          value={current}
          onChange={(e) => setIndex(Number(e.target.value))}
          aria-valuetext={selected ? `${selected.label}, ${selected.health}` : undefined}
          className="mt-3 w-full accent-[var(--ink)]"
        />
        <ol
          className="mt-3 grid gap-2"
          style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
        >
          {items.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-current={i === current ? 'step' : undefined}
                className={`w-full rounded-md border p-2 text-left text-xs transition-colors ${
                  i === current
                    ? 'border-ink bg-paper'
                    : 'border-hairline text-muted hover:border-hairline-strong'
                }`}
              >
                <span aria-hidden>{HEALTH_SYMBOL[s.health]}</span>{' '}
                <span className="line-clamp-2">{s.label}</span>
                <span className="mt-1 block tabular text-[10.5px] text-muted">
                  {shortWhen(s.knownAt, tz)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </Sheet>

      <div ref={page} className="fold-stage">
        {detail.isLoading || !detail.data ? (
          <LoadingSheet label="Loading snapshot" />
        ) : (
          <div
            data-page
            className="sheet sheet-folded p-5 sm:p-7"
            style={{ transformOrigin: 'left center' }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Kicker>
                  Event {detail.data.eventSeq} · known at {shortWhen(detail.data.knownAt, tz)}
                </Kicker>
                <p className="font-display mt-2 text-2xl">{detail.data.label}</p>
              </div>
              <div className="flex items-center gap-2">
                {detail.data.isSimulated ? <SimulatedTag /> : null}
                <HealthStamp health={detail.data.health} size="lg" />
              </div>
            </div>
            <p className="mt-4 text-sm text-ink">{detail.data.state.interpretation}</p>
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div>
                <Kicker>Constraints at this moment</Kicker>
                <ul className="mt-3 divide-y divide-hairline text-sm">
                  {detail.data.state.constraints.map((c) => (
                    <li
                      key={c.constraintId}
                      className="flex items-baseline justify-between gap-3 py-2"
                    >
                      <span className="text-ink">{c.label}</span>
                      <Chip
                        tone={
                          c.status === 'SATISFIED'
                            ? 'good'
                            : c.status === 'AT_RISK'
                              ? 'caution'
                              : c.status === 'VIOLATED'
                                ? 'breach'
                                : 'neutral'
                        }
                      >
                        {c.status.replace(/_/g, ' ').toLowerCase()}
                      </Chip>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <Kicker>Evidence known then</Kicker>
                <ul className="mt-3 space-y-2 text-sm">
                  {detail.data.evidence.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-ink">{e.summary}</span>
                      <ProvenanceTag provenance={e.provenance} />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="mt-6 break-all font-mono text-[10.5px] text-muted">
              snapshot {detail.data.snapshotHash}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
