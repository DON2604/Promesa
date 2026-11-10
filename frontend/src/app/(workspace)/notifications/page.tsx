'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { Chip, Kicker, LoadingSheet, SectionHeading, Sheet, StateBlock } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { humanize, relative } from '@/lib/format';
import { useNotifications } from '@/lib/queries';

export default function NotificationsPage() {
  const n = useNotifications();
  if (n.isLoading) return <LoadingSheet label="Loading notifications" />;
  if (n.isError || !n.data)
    return (
      <StateBlock tone="breach" title="Notifications unavailable.">
        {errorMessage(n.error)}
      </StateBlock>
    );
  return (
    <div className="space-y-8">
      <header>
        <Kicker>NeedMesh · Notification center</Kicker>
        <h1 className="font-display mt-2 text-[clamp(1.8rem,3.4vw,2.6rem)] leading-tight">
          What needs you
        </h1>
      </header>
      <Sheet className="p-5">
        <SectionHeading kicker="Pending actions" title={`${n.data.pending.length} waiting`} />
        {n.data.pending.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nothing is waiting on you.</p>
        ) : (
          <ul className="mt-3 divide-y divide-hairline">
            {n.data.pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className={clsx(
                      'mt-1.5 size-2 rounded-full',
                      p.severity === 'WARNING'
                        ? 'bg-caution'
                        : p.severity === 'ACTION'
                          ? 'bg-signal'
                          : 'bg-muted',
                    )}
                  />
                  <div>
                    <p className="text-sm text-ink">{p.title}</p>
                    <p className="text-[13px] text-muted">{p.detail}</p>
                  </div>
                </div>
                <Link href={p.href} className="text-sm font-medium text-signal hover:underline">
                  Open →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
      <Sheet className="p-5">
        <SectionHeading kicker="Mission activity" title="Recent events" />
        <ul className="mt-3 divide-y divide-hairline">
          {n.data.activity.map((e) => (
            <li
              key={e.id}
              className="grid gap-1 py-2.5 text-sm sm:grid-cols-[9rem_1fr_auto] sm:items-baseline sm:gap-3"
            >
              <span className="kicker">{humanize(e.agent)}</span>
              <span>
                <span className="text-ink">{e.title}</span>{' '}
                <Link
                  href={`/missions/${e.missionId}`}
                  className="text-[12px] text-muted hover:text-signal"
                >
                  · {e.missionTitle}
                </Link>
              </span>
              <span className="flex items-center gap-2 text-[12px] text-muted">
                {e.source === 'SIMULATED' ? <Chip tone="caution">Simulated</Chip> : null}
                {relative(e.occurredAt)}
              </span>
            </li>
          ))}
        </ul>
      </Sheet>
    </div>
  );
}
