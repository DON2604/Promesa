'use client';

import clsx from 'clsx';
import { useMemo, useRef } from 'react';
import type { ThreadEdge, ThreadNode } from '@promesa/contracts';
import { useAnimeScope } from '@/lib/motion';
import { ProvenanceTag } from '@/components/ui';

const LANES: Array<ThreadNode['track']> = ['INTENT', 'MERCHANT', 'PAYPAL', 'DELIVERY'];
const LANE_LABEL: Record<ThreadNode['track'], string> = {
  INTENT: 'Intent',
  MERCHANT: 'Merchant',
  PAYPAL: 'PayPal',
  DELIVERY: 'Delivery',
};
const STATUS_COLOR: Record<ThreadNode['status'], string> = {
  CONFIRMED: 'var(--ink)',
  PENDING: 'var(--caution)',
  FAILED: 'var(--breach)',
  PLANNED: 'var(--muted-ink)',
  UNKNOWN: 'var(--muted-ink)',
};
const RELATION_COLOR: Record<ThreadEdge['relation'], string> = {
  COMMITS_TO: 'var(--signal)',
  PAYS_FOR: 'var(--signal)',
  FULFILS: 'var(--good)',
  CONTRADICTS: 'var(--breach)',
  EVALUATES: 'var(--muted-ink)',
  AWAITS: 'var(--hairline-strong)',
};

const W = 920;
const LANE_H = 78;
const PAD_X = 120;
const PAD_Y = 34;

type Placed = ThreadNode & { x: number; y: number };

export function layoutThreads(nodes: ThreadNode[]): Placed[] {
  const ordered = [...nodes].sort((a, b) => a.eventSequence - b.eventSequence);
  const step = ordered.length > 1 ? (W - PAD_X - 40) / (ordered.length - 1) : 0;
  return ordered.map((n, i) => ({
    ...n,
    x: PAD_X + i * step,
    y: PAD_Y + LANES.indexOf(n.track) * LANE_H,
  }));
}

/**
 * Promise Threads: one row per track, nodes ordered by the twin's event sequence, edges for the
 * relationships the API reports. A full text list mirrors the graph for screen readers and phones.
 */
export function PromiseThreads({ nodes, edges }: { nodes: ThreadNode[]; edges: ThreadEdge[] }) {
  const root = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string>>(new Set());
  const placed = useMemo(() => layoutThreads(nodes), [nodes]);
  const byId = useMemo(() => new Map(placed.map((n) => [n.id, n])), [placed]);
  const key = placed.map((n) => `${n.id}:${n.status}`).join('|');
  const H = PAD_Y * 2 + LANE_H * (LANES.length - 1);

  useAnimeScope(
    root,
    ({ animate, createDrawable, stagger }) => {
      const fresh = placed.filter((n) => !seen.current.has(n.id)).map((n) => n.id);
      const firstRun = seen.current.size === 0;
      placed.forEach((n) => seen.current.add(n.id));
      if (fresh.length === 0) return;
      const sel = (attr: string) => fresh.map((id) => `[${attr}="${CSS.escape(id)}"]`).join(',');
      animate(sel('data-node'), {
        opacity: [0, 1],
        scale: [0.6, 1],
        duration: 520,
        delay: stagger(firstRun ? 70 : 0),
        ease: 'out(3)',
      });
      const edgeEls = root.current?.querySelectorAll<SVGPathElement>(
        fresh.map((id) => `path[data-to="${CSS.escape(id)}"]`).join(','),
      );
      if (edgeEls && edgeEls.length > 0) {
        animate(createDrawable(edgeEls), {
          draw: ['0 0', '0 1'],
          duration: 800,
          delay: stagger(firstRun ? 70 : 0, { start: 150 }),
          ease: 'inOut(2)',
        });
      }
    },
    key,
  );

  return (
    <div ref={root}>
      <div className="hidden overflow-x-auto md:block">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full min-w-[720px]"
          role="img"
          aria-labelledby="threads-title"
        >
          <title id="threads-title">
            Promise threads across intent, merchant, PayPal and delivery tracks
          </title>
          {LANES.map((lane, i) => (
            <g key={lane}>
              <line
                x1={PAD_X - 20}
                x2={W - 20}
                y1={PAD_Y + i * LANE_H}
                y2={PAD_Y + i * LANE_H}
                stroke="var(--hairline)"
                strokeDasharray="2 5"
              />
              <text
                x={0}
                y={PAD_Y + i * LANE_H + 4}
                className="fill-[var(--muted-ink)] font-mono text-[11px] uppercase tracking-[0.14em]"
              >
                {LANE_LABEL[lane]}
              </text>
            </g>
          ))}
          {edges.map((e) => {
            const a = byId.get(e.from);
            const b = byId.get(e.to);
            if (!a || !b) return null;
            const mx = (a.x + b.x) / 2;
            return (
              <path
                key={`${e.from}-${e.to}-${e.relation}`}
                data-to={e.to}
                d={`M${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`}
                fill="none"
                stroke={RELATION_COLOR[e.relation]}
                strokeWidth={e.relation === 'CONTRADICTS' ? 1.8 : 1.3}
                strokeDasharray={e.relation === 'AWAITS' ? '4 5' : undefined}
              />
            );
          })}
          {placed.map((n, i) => {
            const planned = n.status === 'PLANNED' || n.status === 'UNKNOWN';
            const color = STATUS_COLOR[n.status];
            return (
              <g
                key={n.id}
                data-node={n.id}
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
              >
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={planned ? 7 : 8}
                  fill={planned ? 'var(--paper)' : color}
                  stroke={color}
                  strokeWidth={1.6}
                  strokeDasharray={planned ? '2.5 2.5' : undefined}
                />
                {n.provenance?.verification === 'SIMULATED' ? (
                  <circle cx={n.x + 9} cy={n.y - 9} r={3} fill="var(--caution)" />
                ) : null}
                <text
                  x={n.x}
                  y={i % 2 === 0 ? n.y + 25 : n.y - 15}
                  textAnchor="middle"
                  className="fill-[var(--ink)] text-[12px]"
                >
                  {n.label.length > 24 ? `${n.label.slice(0, 23)}…` : n.label}
                  <title>{`${n.label} — ${n.detail}`}</title>
                </text>
              </g>
            );
          })}
        </svg>
        <p className="mt-2 flex flex-wrap gap-4 text-[11px] text-muted">
          <span>● confirmed</span>
          <span>◌ planned — no record exists yet</span>
          <span className="text-caution">● simulated source</span>
          <span className="text-breach">— contradicts</span>
        </p>
      </div>

      <ol className="space-y-3 md:sr-only" aria-label="Promise threads">
        {placed.map((n) => (
          <li
            key={n.id}
            className="grid grid-cols-[5.5rem_1fr] gap-3 border-t border-hairline pt-3 text-sm"
          >
            <span className="kicker pt-0.5">{LANE_LABEL[n.track]}</span>
            <div>
              <p className={clsx('text-ink', n.status === 'PLANNED' && 'text-muted')}>
                {n.label} · <span className="text-muted">{n.status.toLowerCase()}</span>
              </p>
              <p className="text-muted">{n.detail}</p>
              <div className="mt-1">
                <ProvenanceTag provenance={n.provenance} />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
