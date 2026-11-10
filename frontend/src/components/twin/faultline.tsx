'use client';

import clsx from 'clsx';
import { useRef } from 'react';
import type { ConstraintStatus, ContrastView } from '@promesa/contracts';
import { useAnimeScope } from '@/lib/motion';
import { Chip, Kicker } from '@/components/ui';
import type { Tone } from '@/lib/format';

const STATUS: Record<ConstraintStatus, { tone: Tone; symbol: string; label: string }> = {
  SATISFIED: { tone: 'good', symbol: '✓', label: 'Satisfied' },
  AT_RISK: { tone: 'caution', symbol: '▲', label: 'At risk' },
  VIOLATED: { tone: 'breach', symbol: '✕', label: 'Violated' },
  PENDING: { tone: 'neutral', symbol: '…', label: 'Pending' },
  NOT_COMMITTED: { tone: 'neutral', symbol: '◌', label: 'Not committed' },
  UNKNOWN: { tone: 'neutral', symbol: '?', label: 'Unknown' },
};

const OUTCOME_COPY: Record<ContrastView['outcome'], string> = {
  ON_TRACK: 'Promise and reality agree so far.',
  AT_RISK: 'Reality is drifting from the promise.',
  BREACHED: 'The promise and reality have split.',
  FULFILLED: 'The promise was kept.',
  UNCERTAIN: 'Not enough evidence to say.',
};

/**
 * Faultline: the accepted promise above the seam, observed reality below. The seam only breaks
 * for a breach backed by evidence; "at risk" shows strain, never a break.
 */
export function Faultline({ contrast }: { contrast: ContrastView }) {
  const root = useRef<HTMLDivElement>(null);
  const breached = contrast.outcome === 'BREACHED';
  const strained = contrast.outcome === 'AT_RISK';

  useAnimeScope(
    root,
    ({ animate }) => {
      if (!breached) return;
      animate('[data-fault-upper]', { translateY: [0, -4], duration: 620, ease: 'out(3)' });
      animate('[data-fault-lower]', { translateY: [0, 6], duration: 620, ease: 'out(3)' });
    },
    `${contrast.evaluationVersion}:${contrast.outcome}`,
  );

  return (
    <div ref={root} className="space-y-5">
      <div className="relative">
        <div
          data-fault-upper
          style={{ transform: breached ? 'translateY(-4px)' : undefined }}
          className="flex items-center gap-3"
        >
          <span className="kicker w-20 shrink-0">Promised</span>
          <span className="h-px flex-1 bg-ink" />
        </div>
        <div
          data-fault-lower
          style={{ transform: breached ? 'translateY(6px)' : undefined }}
          className="mt-1.5 flex items-center gap-3"
        >
          <span className="kicker w-20 shrink-0">Observed</span>
          <span
            className={clsx(
              'h-px flex-1',
              breached
                ? 'bg-breach'
                : strained
                  ? 'bg-[repeating-linear-gradient(90deg,var(--caution)_0_6px,transparent_6px_10px)]'
                  : 'bg-ink',
            )}
          />
        </div>
        <p
          className={clsx(
            'font-display mt-5 text-xl',
            breached ? 'text-breach' : strained ? 'text-caution' : 'text-ink',
          )}
        >
          {OUTCOME_COPY[contrast.outcome]}
        </p>
        <p className="mt-1 text-sm text-muted">{contrast.interpretation}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-sm">
          <caption className="sr-only">
            Constraint by constraint: requested, committed, observed
          </caption>
          <thead>
            <tr className="border-b border-ink">
              <th scope="col" className="py-2 pr-3 font-normal">
                <Kicker>Constraint</Kicker>
              </th>
              <th scope="col" className="py-2 pr-3 font-normal">
                <Kicker>Requested</Kicker>
              </th>
              <th scope="col" className="py-2 pr-3 font-normal">
                <Kicker>Seller committed</Kicker>
              </th>
              <th scope="col" className="py-2 pr-3 font-normal">
                <Kicker>Observed</Kicker>
              </th>
              <th scope="col" className="py-2 font-normal">
                <Kicker>Status</Kicker>
              </th>
            </tr>
          </thead>
          <tbody>
            {contrast.constraints.map((c) => {
              const s = STATUS[c.status];
              const unmet = contrast.unmetConstraintIds.includes(c.constraintId);
              return (
                <tr
                  key={c.constraintId}
                  className={clsx(
                    'border-b border-hairline align-top',
                    unmet && 'bg-breach-soft/40',
                  )}
                >
                  <th scope="row" className="py-3 pr-3 font-medium text-ink">
                    {c.label}
                  </th>
                  <td className="py-3 pr-3 text-ink">{c.requested}</td>
                  <td className="py-3 pr-3 text-ink">
                    {c.committed ?? <span className="text-muted">Not committed</span>}
                  </td>
                  <td className="py-3 pr-3 text-ink">
                    {c.observed ?? <span className="text-muted">No evidence yet</span>}
                  </td>
                  <td className="py-3">
                    <Chip tone={s.tone}>
                      <span aria-hidden>{s.symbol}</span> {s.label}
                    </Chip>
                    <p className="mt-1.5 max-w-[16rem] text-xs text-muted">{c.explanation}</p>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
