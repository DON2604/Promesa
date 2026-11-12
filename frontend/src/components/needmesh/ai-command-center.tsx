'use client';

import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  MissionAgent,
  MissionEventView,
  MissionLifecycleView,
  PresenceView,
  Role,
} from '@promesa/contracts';
import { humanize, money } from '@/lib/format';
import { initials, roleColor } from '@/components/workspace-shell';

/* ---------- what the AI is doing right now (driven by in-flight mutations) ---------- */

export type AiBusy = 'plan' | 'approve' | 'capture' | 'recovery' | 'reconcile' | null;

const BUSY_STEPS: Record<Exclude<AiBusy, null>, { title: string; steps: string[] }> = {
  plan: {
    title: 'Agents are planning the mission',
    steps: [
      'Mission understanding · reading the confirmed need',
      'Product discovery · connected catalog + Channel3',
      'Merchant matching · applying hard constraints',
      'Offer evaluation · merchant-accepted terms only',
      'Procurement optimization · cheapest feasible split',
      'Deterministic policy validation · budget, payees, quote hashes',
      'Narration · the language model explains the decision',
    ],
  },
  approve: {
    title: 'PayPal Commerce agent is opening a PayPal order',
    steps: [
      'Policy engine · sponsor role, budget and quote hash',
      'PayPal Orders v2 · create order (intent=AUTHORIZE)',
      'Redirecting the sponsor to PayPal to approve',
    ],
  },
  capture: {
    title: 'Merchant confirmed stock: capturing on PayPal',
    steps: [
      'Fulfillment agent · stock confirmation recorded',
      'Policy engine · re-verifying the quote hash',
      'PayPal Payments v2 · capture authorization',
    ],
  },
  recovery: {
    title: 'Recovery agent is re-planning around a failure',
    steps: [
      'Fulfillment monitoring · stockout received',
      'PromiseTwin breach analysis',
      'PayPal state inspection · REST + MCP get_order',
      'Remedy (policy-gated) · void the uncaptured authorization',
      'Procurement re-plan · remaining budget',
      'Human approval gate · replacement needs a new sponsor approval',
    ],
  },
  reconcile: {
    title: 'Reconciliation agent is re-reading PayPal',
    steps: ['Reading every order, authorization and capture from PayPal', 'Correcting local state'],
  },
};

/* ---------- network layout ---------- */

type NodeId = MissionAgent | 'HUB' | 'ORG' | 'SPONSORS' | 'MERCHANTS' | 'PAYPAL';
type Pt = [number, number];

const W = 960;
const H = 440;

const POS: Record<NodeId, Pt> = {
  HUB: [480, 220],
  ORG: [86, 96],
  SPONSORS: [86, 220],
  MERCHANTS: [86, 344],
  PAYPAL: [872, 220],
  PROMISETWIN: [480, 44],
  MISSION_PLANNER: [322, 70],
  MERCHANT_MATCHING: [262, 168],
  NEGOTIATION: [262, 272],
  COMMERCE_PLANNER: [322, 370],
  FUNDING: [418, 404],
  FULFILLMENT: [542, 404],
  RECONCILIATION: [638, 370],
  PAYPAL_COMMERCE: [700, 272],
  POLICY_ENGINE: [700, 168],
  RECOVERY: [638, 70],
  HUMAN: [480, 220],
};

const AGENT_SHORT: Record<MissionAgent, string> = {
  MISSION_PLANNER: 'Mission Planner',
  MERCHANT_MATCHING: 'Matching',
  COMMERCE_PLANNER: 'Commerce Planner',
  NEGOTIATION: 'Negotiation',
  FUNDING: 'Funding',
  PROMISETWIN: 'PromiseTwin',
  POLICY_ENGINE: 'Policy Engine',
  PAYPAL_COMMERCE: 'PayPal Agent',
  RECOVERY: 'Recovery',
  FULFILLMENT: 'Fulfillment',
  RECONCILIATION: 'Reconciliation',
  HUMAN: 'Human',
};

const RING: MissionAgent[] = [
  'PROMISETWIN',
  'MISSION_PLANNER',
  'MERCHANT_MATCHING',
  'NEGOTIATION',
  'COMMERCE_PLANNER',
  'FUNDING',
  'FULFILLMENT',
  'RECONCILIATION',
  'PAYPAL_COMMERCE',
  'POLICY_ENGINE',
  'RECOVERY',
];

const STATIC_EDGES: Array<[NodeId, NodeId]> = [
  ['ORG', 'MISSION_PLANNER'],
  ['ORG', 'NEGOTIATION'],
  ['SPONSORS', 'FUNDING'],
  ['MERCHANTS', 'NEGOTIATION'],
  ['MERCHANTS', 'FULFILLMENT'],
  ['POLICY_ENGINE', 'PAYPAL_COMMERCE'],
  ['PAYPAL_COMMERCE', 'PAYPAL'],
  ['RECONCILIATION', 'PAYPAL'],
  ['RECOVERY', 'POLICY_ENGINE'],
];

const PAYPAL_SOURCES = new Set(['PAYPAL_API', 'PAYPAL_WEBHOOK', 'SIMULATED']);

/** Who started an event and which nodes it passed through, from the recorded agent and source. */
function routeFor(e: MissionEventView): NodeId[] {
  const kind = e.kind;
  if (e.agent === 'HUMAN') {
    if (kind.startsWith('sponsor')) return ['SPONSORS', 'FUNDING', 'HUB', 'POLICY_ENGINE'];
    if (kind.startsWith('merchant')) return ['MERCHANTS', 'FULFILLMENT', 'HUB'];
    return ['ORG', 'MISSION_PLANNER', 'HUB'];
  }
  const fromMerchant =
    kind.startsWith('merchant.') || kind.startsWith('proposal.') || e.agent === 'FULFILLMENT';
  const origin: NodeId[] = fromMerchant
    ? ['MERCHANTS', e.agent === 'FULFILLMENT' ? 'FULFILLMENT' : 'NEGOTIATION', 'HUB']
    : ['HUB'];
  const agent: NodeId = e.agent;
  const path: NodeId[] = origin.includes(agent) ? origin : [...origin, agent];
  if (PAYPAL_SOURCES.has(e.source) && e.agent !== 'FULFILLMENT') {
    if (!path.includes('POLICY_ENGINE') && e.agent !== 'RECONCILIATION') path.push('POLICY_ENGINE');
    if (!path.includes('PAYPAL_COMMERCE') && e.agent !== 'RECONCILIATION')
      path.push('PAYPAL_COMMERCE');
    path.push('PAYPAL');
  }
  return path;
}

function packetColor(e: MissionEventView): string {
  if (e.kind === 'policy.denied') return '#ff6b5e';
  if (PAYPAL_SOURCES.has(e.source)) return '#ffc439';
  if (e.engine.startsWith('llm:')) return '#b18cff';
  if (e.agent === 'HUMAN') return '#4ade80';
  return '#5aa9ff';
}

type Packet = {
  key: string;
  d: string;
  color: string;
  delay: number;
  dur: number;
  nodes: NodeId[];
};

function pathD(nodes: NodeId[]): string {
  return nodes
    .map((n, i) => {
      const [x, y] = POS[n];
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
}

/* ---------- engine labels ---------- */

export function engineLabel(engine: string): { label: string; tone: 'ai' | 'mcp' | 'rule' } {
  if (engine.startsWith('llm:')) {
    const model = engine.split('/').slice(1).join('/') || engine.slice(4);
    return { label: `AI · ${model}`, tone: 'ai' };
  }
  if (engine.startsWith('mcp:')) return { label: `PayPal MCP · ${engine.slice(4)}`, tone: 'mcp' };
  if (engine.includes('fallback')) return { label: 'Rules (AI fallback)', tone: 'rule' };
  return { label: 'Rules engine', tone: 'rule' };
}

const AGENT_GLYPH: Partial<Record<MissionAgent, string>> = {
  MISSION_PLANNER: '◆',
  MERCHANT_MATCHING: '⌖',
  COMMERCE_PLANNER: '▦',
  NEGOTIATION: '⇄',
  FUNDING: '$',
  PROMISETWIN: '◎',
  POLICY_ENGINE: '⛨',
  PAYPAL_COMMERCE: 'P',
  RECOVERY: '↻',
  FULFILLMENT: '▣',
  RECONCILIATION: '≡',
  HUMAN: '●',
};

/* ---------- typewriter ---------- */

function useTypewriter(text: string, active: boolean, speed = 9) {
  const [n, setN] = useState(active ? 0 : text.length);
  useEffect(() => {
    if (!active) {
      setN(text.length);
      return;
    }
    setN(0);
    const id = setInterval(() => {
      setN((v) => {
        if (v >= text.length) {
          clearInterval(id);
          return v;
        }
        return v + 2;
      });
    }, speed);
    return () => clearInterval(id);
  }, [text, active, speed]);
  return { shown: text.slice(0, n), done: n >= text.length };
}

/* ---------- main component ---------- */

export function AiCommandCenter({
  lc,
  busy,
  presence,
}: {
  lc: MissionLifecycleView;
  busy: AiBusy;
  presence: PresenceView | undefined;
}) {
  const seen = useRef<number | null>(null);
  const [packets, setPackets] = useState<Packet[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [hot, setHot] = useState<Set<NodeId>>(new Set());

  // Animate only events that arrive while the page is open; the first load is the baseline.
  useEffect(() => {
    const maxSeq = lc.events.reduce((m, e) => Math.max(m, e.seq), 0);
    if (seen.current === null) {
      seen.current = maxSeq;
      return;
    }
    const incoming = lc.events.filter((e) => e.seq > (seen.current ?? 0));
    if (incoming.length === 0) return;
    seen.current = maxSeq;
    const now = Date.now();
    const next: Packet[] = incoming.slice(-8).map((e, i) => {
      const nodes = routeFor(e);
      return {
        key: `${e.id}-${now}`,
        d: pathD(nodes),
        color: packetColor(e),
        delay: i * 0.75,
        dur: Math.max(0.9, (nodes.length - 1) * 0.45),
        nodes,
      };
    });
    setPackets((p) => [...p, ...next].slice(-16));
    setFresh(new Set(incoming.map((e) => e.id)));
    setHot(new Set(next.flatMap((p) => p.nodes)));
    const total = Math.max(...next.map((p) => (p.delay + p.dur) * 1000)) + 1200;
    const t = setTimeout(() => {
      setPackets((p) => p.filter((x) => !next.includes(x)));
      setHot(new Set());
    }, total);
    return () => clearTimeout(t);
  }, [lc.events]);

  const counts = useMemo(() => {
    const c = new Map<MissionAgent, number>();
    for (const e of lc.events) c.set(e.agent, (c.get(e.agent) ?? 0) + 1);
    return c;
  }, [lc.events]);

  const online = useMemo(() => {
    const users = presence?.users ?? [];
    return {
      org: users.filter((u) => u.role === 'ORG_ADMIN' || u.role === 'ORG_OPERATOR'),
      sponsors: users.filter((u) => u.role === 'SPONSOR'),
      merchants: users.filter((u) => u.role === 'MERCHANT_ADMIN' || u.role === 'MERCHANT_OPERATOR'),
    };
  }, [presence]);

  const aiName =
    lc.ai.provider === 'deterministic'
      ? 'Rules only'
      : `${humanize(lc.ai.provider)} · ${lc.ai.model ?? ''}`;
  const thinking = busy !== null;

  return (
    <section
      aria-labelledby="ai-cc"
      className="ai-stage relative overflow-hidden rounded-[var(--radius-sheet)] border border-[#1d3a66] shadow-xl"
    >
      <div className="ai-grid pointer-events-none absolute inset-0" />
      <header className="relative flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="relative inline-flex size-2.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-[#5aa9ff] opacity-70" />
            <span className="relative size-2.5 rounded-full bg-[#5aa9ff]" />
          </span>
          <div>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-[#8fb3e8]">
              NeedMesh AI · live agent network
            </p>
            <h2 id="ai-cc" className="font-display text-xl text-white">
              {thinking ? BUSY_STEPS[busy].title : 'How AI and PayPal move this mission'}
            </h2>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StageChip tone="ai" title="Language model that writes agent explanations">
            ✦ {aiName}
          </StageChip>
          <StageChip tone={lc.rail.mode === 'SANDBOX' ? 'paypal' : 'muted'} title={lc.rail.detail}>
            {lc.rail.mode === 'SANDBOX' ? 'PayPal Sandbox · live API' : 'Simulated rail'}
          </StageChip>
          <StageChip tone={lc.mcp.status === 'OK' ? 'paypal' : 'muted'} title={lc.mcp.detail}>
            PayPal MCP · {humanize(lc.mcp.status)}
          </StageChip>
        </div>
      </header>

      <div className="relative grid gap-0 lg:grid-cols-[1fr_22rem]">
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full"
            role="img"
            aria-label="Agent network: people on the left, AI agents in the middle, PayPal on the right"
          >
            <defs>
              <radialGradient id="hubGlow">
                <stop offset="0%" stopColor="#5aa9ff" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#5aa9ff" stopOpacity="0" />
              </radialGradient>
              <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* spokes */}
            {RING.map((a) => (
              <line
                key={`s-${a}`}
                x1={POS.HUB[0]}
                y1={POS.HUB[1]}
                x2={POS[a][0]}
                y2={POS[a][1]}
                stroke={hot.has(a) ? '#5aa9ff' : 'rgba(143,179,232,0.22)'}
                strokeWidth={hot.has(a) ? 1.6 : 1}
                className="ai-flow"
              />
            ))}
            {STATIC_EDGES.map(([a, b]) => (
              <line
                key={`e-${a}-${b}`}
                x1={POS[a][0]}
                y1={POS[a][1]}
                x2={POS[b][0]}
                y2={POS[b][1]}
                stroke={hot.has(a) && hot.has(b) ? '#ffc439' : 'rgba(143,179,232,0.28)'}
                strokeWidth={1.2}
                className="ai-flow"
              />
            ))}

            {/* thinking: a packet circles through the ring */}
            {thinking
              ? RING.map((a, i) => (
                  <circle key={`t-${a}`} r={3.5} fill="#b18cff" filter="url(#glow)">
                    <animateMotion
                      dur="1.1s"
                      begin={`${i * 0.12}s`}
                      repeatCount="indefinite"
                      path={`M${POS.HUB[0]},${POS.HUB[1]} L${POS[a][0]},${POS[a][1]}`}
                    />
                  </circle>
                ))
              : null}

            {/* packets for real events */}
            {packets.map((p) => (
              <g key={p.key}>
                <path d={p.d} fill="none" stroke={p.color} strokeOpacity={0.35} strokeWidth={2}>
                  <animate
                    attributeName="stroke-opacity"
                    values="0;0.5;0"
                    dur={`${p.dur + 0.6}s`}
                    begin={`${p.delay}s`}
                    fill="freeze"
                  />
                </path>
                <circle r={6} fill={p.color} filter="url(#glow)" opacity={0}>
                  <animate
                    attributeName="opacity"
                    values="0;1;1;0"
                    keyTimes="0;0.08;0.9;1"
                    dur={`${p.dur}s`}
                    begin={`${p.delay}s`}
                    fill="freeze"
                  />
                  <animateMotion dur={`${p.dur}s`} begin={`${p.delay}s`} path={p.d} fill="freeze" />
                </circle>
              </g>
            ))}

            {/* hub */}
            <circle cx={POS.HUB[0]} cy={POS.HUB[1]} r={90} fill="url(#hubGlow)" />
            <circle
              cx={POS.HUB[0]}
              cy={POS.HUB[1]}
              r={58}
              fill="none"
              stroke="#5aa9ff"
              strokeOpacity={0.5}
              strokeDasharray="2 8"
              className={clsx('ai-hub-spin', thinking && 'fast')}
            />
            <circle cx={POS.HUB[0]} cy={POS.HUB[1]} r={46} fill="#0e2a52" stroke="#5aa9ff" />
            <text
              x={POS.HUB[0]}
              y={POS.HUB[1] - 6}
              textAnchor="middle"
              className="fill-white text-[13px] font-semibold"
            >
              NeedMesh AI
            </text>
            <text
              x={POS.HUB[0]}
              y={POS.HUB[1] + 11}
              textAnchor="middle"
              className="fill-[#b18cff] font-mono text-[9px]"
            >
              {thinking
                ? 'thinking…'
                : lc.ai.provider === 'deterministic'
                  ? 'rules'
                  : lc.ai.provider}
            </text>

            {/* agents */}
            {RING.map((a) => {
              const [x, y] = POS[a];
              const n = counts.get(a) ?? 0;
              const isHot = hot.has(a);
              return (
                <g key={a}>
                  {isHot ? (
                    <circle cx={x} cy={y} r={20} fill="#5aa9ff" className="ai-node-pulse" />
                  ) : null}
                  <circle
                    cx={x}
                    cy={y}
                    r={20}
                    fill={isHot ? '#1c4f94' : '#10264a'}
                    stroke={
                      a === 'POLICY_ENGINE'
                        ? '#4ade80'
                        : a === 'PAYPAL_COMMERCE'
                          ? '#ffc439'
                          : '#5aa9ff'
                    }
                    strokeWidth={1.4}
                  />
                  <text
                    x={x}
                    y={y + 4.5}
                    textAnchor="middle"
                    className="fill-white text-[13px] font-semibold"
                  >
                    {AGENT_GLYPH[a]}
                  </text>
                  <text
                    x={x}
                    y={y + 35}
                    textAnchor="middle"
                    className="fill-[#c9d8f0] text-[10.5px]"
                  >
                    {AGENT_SHORT[a]}
                  </text>
                  {n > 0 ? (
                    <g>
                      <circle cx={x + 16} cy={y - 15} r={8} fill="#5aa9ff" />
                      <text
                        x={x + 16}
                        y={y - 12}
                        textAnchor="middle"
                        className="fill-[#071630] font-mono text-[9px] font-bold"
                      >
                        {n}
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })}

            {/* people */}
            <PersonNode
              at={POS.ORG}
              label="Organization"
              sub={lc.marketplace.orgName}
              color="#5aa9ff"
              hot={hot.has('ORG')}
              online={online.org.map((u) => u.displayName)}
            />
            <PersonNode
              at={POS.SPONSORS}
              label="Sponsors"
              sub={
                lc.sponsors.length
                  ? `${lc.sponsors.length} funding`
                  : lc.marketplace.visibility === 'PUBLIC'
                    ? 'open to any sponsor'
                    : 'organization sponsors'
              }
              color="#4ade80"
              hot={hot.has('SPONSORS')}
              online={online.sponsors.map((u) => u.displayName)}
            />
            <PersonNode
              at={POS.MERCHANTS}
              label="Merchants"
              sub={`${new Set(lc.orders.map((o) => o.merchantName)).size || lc.supply.length} in play`}
              color="#ffb347"
              hot={hot.has('MERCHANTS')}
              online={online.merchants.map((u) => u.displayName)}
            />

            {/* PayPal */}
            <g>
              {hot.has('PAYPAL') ? (
                <rect
                  x={POS.PAYPAL[0] - 72}
                  y={POS.PAYPAL[1] - 58}
                  width={144}
                  height={126}
                  rx={16}
                  fill="#ffc439"
                  className="ai-node-pulse"
                />
              ) : null}
              <rect
                x={POS.PAYPAL[0] - 72}
                y={POS.PAYPAL[1] - 58}
                width={144}
                height={126}
                rx={16}
                fill="#0f2c5c"
                stroke="#ffc439"
                strokeWidth={1.5}
              />
              <text
                x={POS.PAYPAL[0]}
                y={POS.PAYPAL[1] - 22}
                textAnchor="middle"
                className="text-[17px] font-bold"
              >
                <tspan fill="#ffffff">Pay</tspan>
                <tspan fill="#5aa9ff">Pal</tspan>
              </text>
              <text
                x={POS.PAYPAL[0]}
                y={POS.PAYPAL[1] - 4}
                textAnchor="middle"
                className="fill-[#ffc439] font-mono text-[9px]"
              >
                {lc.rail.mode === 'SANDBOX' ? 'SANDBOX API' : 'SIMULATED'}
              </text>
              {paypalLines(lc).map((t, i) => (
                <text
                  key={t}
                  x={POS.PAYPAL[0]}
                  y={POS.PAYPAL[1] + 14 + i * 13}
                  textAnchor="middle"
                  className="fill-[#c9d8f0] font-mono text-[9.5px]"
                >
                  {t}
                </text>
              ))}
            </g>
          </svg>
          <Legend />
        </div>

        <ReasoningStream lc={lc} busy={busy} fresh={fresh} />
      </div>

      <ImpactStrip lc={lc} />
    </section>
  );
}

function paypalLines(lc: MissionLifecycleView): string[] {
  const has = (s: string[]) => lc.orders.filter((o) => s.includes(o.state)).length;
  return [
    `${lc.orders.filter((o) => o.paypal.orderId).length} orders`,
    `${has(['AUTHORIZED', 'CAPTURED', 'SHIPPED', 'DELIVERED', 'VOIDED', 'REFUND_PENDING', 'REFUNDED'])} authorized`,
    `${has(['CAPTURED', 'SHIPPED', 'DELIVERED', 'REFUND_PENDING', 'REFUNDED'])} captured`,
    `${has(['VOIDED'])} voided · ${has(['REFUNDED'])} refunded`,
  ];
}

function PersonNode({
  at,
  label,
  sub,
  color,
  hot,
  online,
}: {
  at: Pt;
  label: string;
  sub: string;
  color: string;
  hot: boolean;
  online: string[];
}) {
  const [x, y] = at;
  return (
    <g>
      {hot ? <circle cx={x} cy={y} r={26} fill={color} className="ai-node-pulse" /> : null}
      <circle cx={x} cy={y} r={26} fill="#0f2547" stroke={color} strokeWidth={1.6} />
      <text x={x} y={y + 5} textAnchor="middle" className="text-[15px]" fill={color}>
        {label === 'Organization' ? '⌂' : label === 'Sponsors' ? '♥' : '⛟'}
      </text>
      <text x={x + 36} y={y - 6} className="fill-white text-[12px] font-semibold">
        {label}
      </text>
      <text x={x + 36} y={y + 8} className="fill-[#8fb3e8] text-[10px]">
        {sub.length > 22 ? `${sub.slice(0, 21)}…` : sub}
      </text>
      {online.length ? (
        <g>
          <circle cx={x + 19} cy={y - 19} r={5} fill="#4ade80" stroke="#071630" strokeWidth={2} />
          <text x={x + 36} y={y + 22} className="fill-[#4ade80] text-[10px]">
            ● {online.slice(0, 2).join(', ')} online
          </text>
        </g>
      ) : null}
    </g>
  );
}

function Legend() {
  const items: Array<[string, string]> = [
    ['#5aa9ff', 'Agent step'],
    ['#b18cff', 'Language model'],
    ['#ffc439', 'PayPal API call'],
    ['#4ade80', 'Human decision'],
    ['#ff6b5e', 'Blocked by policy'],
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 px-5 pb-3 text-[11px] text-[#9fb6d9]">
      {items.map(([c, l]) => (
        <li key={l} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full" style={{ background: c }} />
          {l}
        </li>
      ))}
    </ul>
  );
}

function StageChip({
  tone,
  title,
  children,
}: {
  tone: 'ai' | 'paypal' | 'muted';
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em]',
        tone === 'ai' && 'border-[#b18cff]/50 bg-[#b18cff]/15 text-[#d9c8ff]',
        tone === 'paypal' && 'border-[#ffc439]/50 bg-[#ffc439]/10 text-[#ffd977]',
        tone === 'muted' && 'border-white/20 text-[#9fb6d9]',
      )}
    >
      {children}
    </span>
  );
}

/* ---------- reasoning stream ---------- */

function ReasoningStream({
  lc,
  busy,
  fresh,
}: {
  lc: MissionLifecycleView;
  busy: AiBusy;
  fresh: Set<string>;
}) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!busy) return;
    setStep(0);
    const id = setInterval(() => setStep((s) => s + 1), 850);
    return () => clearInterval(id);
  }, [busy]);

  const latest = [...lc.events].reverse().slice(0, 7);

  return (
    <aside
      className="relative flex max-h-[30rem] flex-col border-t border-white/10 lg:border-l lg:border-t-0"
      aria-live="polite"
    >
      <p className="px-4 pt-3 font-mono text-[10.5px] uppercase tracking-[0.18em] text-[#8fb3e8]">
        {busy ? 'Reasoning · in progress' : 'Reasoning stream'}
      </p>
      {busy ? (
        <ol className="space-y-1.5 px-4 py-3">
          {BUSY_STEPS[busy].steps.map((s, i) => {
            const current = Math.min(step, BUSY_STEPS[busy].steps.length - 1);
            const done = i < current;
            const now = i === current;
            return (
              <li
                key={s}
                className={clsx(
                  'flex items-start gap-2 rounded-md px-2 py-1.5 text-[12.5px]',
                  now && 'ai-shimmer bg-white/5 text-white',
                  done && 'text-[#c9d8f0]',
                  !done && !now && 'text-[#6f86ab]',
                )}
              >
                <span aria-hidden className="mt-0.5 w-3 shrink-0 text-center">
                  {done ? '✓' : now ? '◌' : '·'}
                </span>
                <span className={clsx(now && 'ai-caret')}>{s}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
      <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4 pt-2">
        {latest.length === 0 && !busy ? (
          <li className="text-[13px] text-[#9fb6d9]">
            Nothing yet. Run the agents and every step appears here as it happens, with the engine
            that produced it.
          </li>
        ) : null}
        {latest.map((e, i) => (
          <ThoughtCard
            key={e.id}
            e={e}
            typing={i === 0 && fresh.has(e.id)}
            isNew={fresh.has(e.id)}
          />
        ))}
      </ol>
    </aside>
  );
}

function ThoughtCard({
  e,
  typing,
  isNew,
}: {
  e: MissionEventView;
  typing: boolean;
  isNew: boolean;
}) {
  const { shown, done } = useTypewriter(e.detail, typing);
  const eng = engineLabel(e.engine);
  const denied = e.kind === 'policy.denied';
  return (
    <li
      className={clsx(
        'rounded-lg border p-2.5',
        isNew && 'ai-reveal',
        denied
          ? 'border-[#ff6b5e]/50 bg-[#ff6b5e]/10'
          : eng.tone === 'ai'
            ? 'border-[#b18cff]/40 bg-[#b18cff]/10'
            : PAYPAL_SOURCES.has(e.source)
              ? 'border-[#ffc439]/35 bg-[#ffc439]/[0.07]'
              : 'border-white/10 bg-white/[0.04]',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] text-white"
        >
          {AGENT_GLYPH[e.agent] ?? '•'}
        </span>
        <span className="truncate font-mono text-[10px] uppercase tracking-[0.12em] text-[#8fb3e8]">
          {AGENT_SHORT[e.agent] ?? e.agent}
        </span>
        <span
          className={clsx(
            'ml-auto shrink-0 rounded-full px-1.5 font-mono text-[9.5px]',
            eng.tone === 'ai' && 'bg-[#b18cff]/25 text-[#e4d7ff]',
            eng.tone === 'mcp' && 'bg-[#ffc439]/20 text-[#ffd977]',
            eng.tone === 'rule' && 'bg-white/10 text-[#9fb6d9]',
          )}
        >
          {eng.label}
        </span>
      </div>
      <p className="mt-1 text-[13px] font-medium leading-snug text-white">
        {denied ? '⛔ ' : ''}
        {e.title}
      </p>
      {e.detail ? (
        <p
          className={clsx(
            'mt-0.5 text-[12px] leading-snug text-[#b4c6e3]',
            typing && !done && 'ai-caret',
          )}
        >
          {shown}
        </p>
      ) : null}
      {PAYPAL_SOURCES.has(e.source) ? (
        <p className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-[#ffd977]">
          {e.source === 'SIMULATED' ? 'simulated rail' : 'verified with PayPal'}
        </p>
      ) : null}
    </li>
  );
}

/* ---------- impact strip ---------- */

function ImpactStrip({ lc }: { lc: MissionLifecycleView }) {
  const cur = lc.budget.currency;
  const sum = (states: string[]) =>
    String(
      lc.orders
        .filter((o) => states.includes(o.state))
        .reduce((s, o) => s + Number(o.amountMinor), 0),
    );
  const paypalCalls = lc.events.filter((e) => e.source === 'PAYPAL_API').length;
  const aiExplained = lc.events.filter((e) => e.engine.startsWith('llm:')).length;
  const mcpReads = lc.events.filter((e) => e.engine.startsWith('mcp:')).length;
  const blocked = lc.events.filter((e) => e.kind === 'policy.denied').length;
  const tiles: Array<{ k: string; v: string; hint: string; tone: string }> = [
    {
      k: 'Authorized (held)',
      v: money(sum(['AUTHORIZED']), cur),
      hint: 'Sponsor approved in PayPal; funds reserved until the merchant confirms stock',
      tone: 'text-[#5aa9ff]',
    },
    {
      k: 'Captured',
      v: money(sum(['CAPTURED', 'SHIPPED', 'DELIVERED']), cur),
      hint: 'Charged only after the merchant confirmed stock',
      tone: 'text-[#ffd977]',
    },
    {
      k: 'Released, never charged',
      v: money(sum(['VOIDED']), cur),
      hint: 'Authorizations the Recovery agent voided on PayPal after a failure',
      tone: 'text-[#4ade80]',
    },
    {
      k: 'PayPal-verified events',
      v: String(paypalCalls),
      hint: 'Timeline facts that came from PayPal API responses',
      tone: 'text-white',
    },
    {
      k: 'AI explanations',
      v: String(aiExplained),
      hint: 'Decisions narrated by the language model, numbers checked against the planner',
      tone: 'text-[#d9c8ff]',
    },
    {
      k: 'MCP reads · policy blocks',
      v: `${mcpReads} · ${blocked}`,
      hint: 'PayPal MCP get_order checks, and actions the policy engine refused',
      tone: 'text-white',
    },
  ];
  return (
    <dl className="relative grid grid-cols-2 border-t border-white/10 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t) => (
        <div
          key={t.k}
          className="border-white/10 px-4 py-3 [&:not(:last-child)]:border-r"
          title={t.hint}
        >
          <dt className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-[#8fb3e8]">
            {t.k}
          </dt>
          <dd className={clsx('font-display mt-0.5 text-xl tabular-nums', t.tone)}>{t.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------- people in this mission ---------- */

const ROLE_WORD: Partial<Record<Role, string>> = {
  ORG_ADMIN: 'requesting the supplies',
  ORG_OPERATOR: 'requesting the supplies',
  SPONSOR: 'can fund orders',
  MERCHANT_ADMIN: 'can fulfil orders',
  MERCHANT_OPERATOR: 'can fulfil orders',
};

export function PresenceBar({ presence }: { presence: PresenceView | undefined }) {
  const users = presence?.users ?? [];
  return (
    <div className="sheet flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
      <span className="kicker">In this mission now</span>
      {users.length === 0 ? (
        <span className="text-[13px] text-muted">Only you.</span>
      ) : (
        users.map((u) => (
          <span key={`${u.userId}-${u.role}`} className="inline-flex items-center gap-2">
            <span className="relative">
              <span
                aria-hidden
                className={clsx(
                  'inline-flex size-7 items-center justify-center rounded-full text-[11px] font-semibold text-paper',
                  roleColor(u.role),
                )}
              >
                {initials(u.displayName)}
              </span>
              <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-paper bg-good" />
            </span>
            <span className="leading-tight">
              <span className="block text-[13px] text-ink">
                {u.displayName}
                {u.isYou ? <span className="text-muted"> (you)</span> : null}
              </span>
              <span className="block text-[11px] text-muted">
                {u.tenantName} · {ROLE_WORD[u.role] ?? humanize(u.role)}
              </span>
            </span>
          </span>
        ))
      )}
      <span className="ml-auto text-[11px] text-muted">
        Other browsers see each change within a second or two.
      </span>
    </div>
  );
}

/* ---------- toasts for events that arrive while you watch ---------- */

export function LiveToasts({ events }: { events: MissionEventView[] }) {
  const seen = useRef<number | null>(null);
  const [toasts, setToasts] = useState<Array<MissionEventView & { tkey: string }>>([]);
  useEffect(() => {
    const max = events.reduce((m, e) => Math.max(m, e.seq), 0);
    if (seen.current === null) {
      seen.current = max;
      return;
    }
    const incoming = events.filter((e) => e.seq > (seen.current ?? 0)).slice(-4);
    seen.current = max;
    if (incoming.length === 0) return;
    const stamped = incoming.map((e) => ({ ...e, tkey: `${e.id}-${Date.now()}` }));
    setToasts((t) => [...t, ...stamped].slice(-4));
    const keys = new Set(stamped.map((s) => s.tkey));
    const timer = setTimeout(() => setToasts((t) => t.filter((x) => !keys.has(x.tkey))), 6500);
    return () => clearTimeout(timer);
  }, [events]);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-[22rem] flex-col gap-2">
      {toasts.map((t) => {
        const eng = engineLabel(t.engine);
        return (
          <div
            key={t.tkey}
            role="status"
            className="toast-in pointer-events-auto rounded-lg border border-[#1d3a66] bg-[#0b1f3a] p-3 text-white shadow-2xl"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#8fb3e8]">
              {AGENT_SHORT[t.agent] ?? t.agent} · {eng.label}
            </p>
            <p className="mt-0.5 text-[13.5px] font-medium leading-snug">{t.title}</p>
          </div>
        );
      })}
    </div>
  );
}
