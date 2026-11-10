'use client';

import clsx from 'clsx';
import { usePayPalHealth } from '@/lib/queries';
import { Chip } from './ui';
import type { Tone } from '@/lib/format';

const TONE: Record<string, Tone> = {
  OK: 'good',
  CONFIGURED: 'good',
  ERROR: 'breach',
  NOT_CONFIGURED: 'neutral',
  DISABLED: 'neutral',
  IDLE: 'signal',
};

/** Live, unembellished integration status from the API — never a static marketing claim. */
export function PayPalStatus({ compact = false }: { compact?: boolean }) {
  const { data, isLoading, isError } = usePayPalHealth();

  if (isLoading) return <p className="kicker">Checking PayPal integration…</p>;
  if (isError || !data)
    return (
      <p className="text-sm text-muted">
        PayPal status unavailable — the NeedMesh API could not be reached.
      </p>
    );

  const rows: Array<[string, string, string]> = [
    ['REST API (Orders v2, Payments)', data.restApi.status, data.restApi.detail],
    ['Agent Toolkit / MCP', data.mcp.status, data.mcp.detail],
    ['Webhooks', data.webhooks.status, data.webhooks.detail],
  ];

  if (compact)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="kicker">PayPal {data.environment}</span>
        {rows.map(([label, status]) => (
          <Chip key={label} tone={TONE[status] ?? 'neutral'} title={label}>
            {label.split(' ')[0]} · {status.replace(/_/g, ' ').toLowerCase()}
          </Chip>
        ))}
      </div>
    );

  return (
    <ul className="divide-y divide-hairline">
      {rows.map(([label, status, detail]) => (
        <li
          key={label}
          className="grid gap-1 py-3 sm:grid-cols-[14rem_9rem_1fr] sm:items-baseline sm:gap-4"
        >
          <span className="text-sm text-ink">{label}</span>
          <span>
            <Chip tone={TONE[status] ?? 'neutral'}>{status.replace(/_/g, ' ').toLowerCase()}</Chip>
          </span>
          <span className={clsx('text-sm text-muted')}>{detail}</span>
        </li>
      ))}
      <li className="py-3 text-sm text-muted">
        Environment: <span className="font-mono text-ink">{data.environment}</span> · Live writes{' '}
        {data.liveWritesEnabled ? 'enabled' : 'disabled'}
      </li>
    </ul>
  );
}
