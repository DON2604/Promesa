'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Me, Role } from '@promesa/contracts';
import { api, ApiError, errorMessage } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useMe, useNotifications, usePresence } from '@/lib/queries';
import { useEventStream, type StreamStatus } from '@/lib/use-event-stream';
import { Wordmark } from './brand';
import { PayPalStatus } from './paypal-status';
import { Button, LoadingSheet, StateBlock } from './ui';

function NotificationBell() {
  const n = useNotifications();
  const count = n.data?.pending.length ?? 0;
  return (
    <Link
      href="/notifications"
      className="relative inline-flex h-8 items-center gap-1.5 rounded-md border border-hairline-strong bg-paper px-2.5 text-[13px] text-ink hover:border-signal"
      aria-label={`Notifications${count ? `, ${count} pending` : ''}`}
    >
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M4 11V7a4 4 0 1 1 8 0v4l1 1.5H3L4 11Z" />
        <path d="M6.5 14a1.5 1.5 0 0 0 3 0" />
      </svg>
      {count > 0 ? (
        <span className="tabular rounded-full bg-signal px-1.5 text-[11px] font-medium leading-4 text-paper">
          {count}
        </span>
      ) : null}
    </Link>
  );
}

const BUYER_ROLES: Role[] = ['BUYER'];
const ORG_ROLES: Role[] = ['ORG_ADMIN', 'ORG_OPERATOR'];

const MERCHANT_ROLES: Role[] = ['MERCHANT_ADMIN', 'MERCHANT_OPERATOR'];

function navFor(me: Me): Array<{ href: string; label: string }> {
  const role = me.activeRole;
  const items = [{ href: '/dashboard', label: 'Missions' }];
  if (me.activeTenant.kind === 'ORG' && ORG_ROLES.includes(role))
    items.push({ href: '/missions/new', label: 'Mission Studio' });
  if (MERCHANT_ROLES.includes(role)) items.push({ href: '/merchant', label: 'Merchant offers' });
  items.push({ href: '/explore', label: 'Explore' });
  if (!BUYER_ROLES.includes(role)) items.push({ href: '/analytics', label: 'Analytics' });
  items.push({ href: '/protection', label: 'Protection' });
  if (!MERCHANT_ROLES.includes(role)) items.push({ href: '/settings', label: 'Settings' });
  return items;
}

const MISSION_PATH = /^\/missions\/([0-9a-f-]{36})/;
const missionIdFrom = (pathname: string) => MISSION_PATH.exec(pathname)?.[1] ?? null;

export function roleColor(role: Role): string {
  if (role === 'SPONSOR') return 'bg-good';
  if (MERCHANT_ROLES.includes(role)) return 'bg-caution';
  if (ORG_ROLES.includes(role)) return 'bg-signal';
  return 'bg-ink';
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function Identity({ me }: { me: Me }) {
  return (
    <span className="hidden items-center gap-2 sm:inline-flex" title={me.user.email}>
      <span
        aria-hidden
        className={clsx(
          'inline-flex size-8 items-center justify-center rounded-full text-[12px] font-semibold text-paper',
          roleColor(me.activeRole),
        )}
      >
        {initials(me.user.displayName)}
      </span>
      <span className="leading-tight">
        <span className="block text-[13px] font-medium text-ink">{me.user.displayName}</span>
        <span className="block text-[11px] text-muted">{humanize(me.activeRole)}</span>
      </span>
    </span>
  );
}

/** Keeps this user's presence fresh (scoped to the open mission) and shows who else is online. */
function OnlineCount({ missionId }: { missionId: string | null }) {
  const presence = usePresence(missionId);
  const total = presence.data?.onlineTotal ?? 0;
  if (total === 0) return null;
  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border border-good/40 bg-good-soft px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.1em] text-good xl:inline-flex"
      title="People with NeedMesh open right now"
    >
      <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-good" />
      {total} online
    </span>
  );
}

const STREAM_LABEL: Record<StreamStatus, string> = {
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  offline: 'Updates paused',
};

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const client = useQueryClient();
  const me = useMe();
  const unauthenticated = me.error instanceof ApiError && me.error.isUnauthenticated;
  const stream = useEventStream(!!me.data);

  const switchRole = useMutation({
    mutationFn: (v: { tenantId: string; role: Role }) =>
      api('/v1/auth/role', { method: 'POST', body: v }),
    onSuccess: async () => {
      await client.invalidateQueries();
      router.push('/dashboard');
    },
  });

  const signOut = useMutation({
    mutationFn: () => api('/v1/auth/session', { method: 'DELETE' }),
    onSettled: () => {
      client.clear();
      router.push('/');
    },
  });

  // An explicit sign-out goes home; only an expired or missing session redirects to sign-in.
  const signingOut = signOut.isPending || signOut.isSuccess || signOut.isError;
  useEffect(() => {
    if (unauthenticated && !signingOut)
      router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
  }, [unauthenticated, signingOut, pathname, router]);

  if (me.isLoading || unauthenticated)
    return (
      <div className="mx-auto max-w-[1200px] px-5 py-16 sm:px-8">
        <LoadingSheet label="Opening your workspace" />
      </div>
    );
  if (me.isError || !me.data)
    return (
      <div className="mx-auto max-w-[720px] px-5 py-16">
        <StateBlock
          tone="breach"
          title="Your workspace could not be loaded."
          action={
            <Button variant="secondary" onClick={() => void me.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(me.error)}
        </StateBlock>
      </div>
    );

  const data = me.data;
  const activeKey = `${data.activeTenant.id}|${data.activeRole}`;

  return (
    <div className="min-h-dvh">
      <div className="border-b border-signal/20 bg-signal-soft">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-2 px-5 py-1.5 text-[12.5px] text-ink sm:px-8">
          <p>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-signal-strong">
              PayPal Sandbox
            </span>{' '}
            · Real PayPal Sandbox API calls, no real money. Organizations and merchants are
            fictional.
          </p>
          <div className="hidden md:block">
            <PayPalStatus compact />
          </div>
        </div>
      </div>
      <header className="sticky top-0 z-30 border-b border-hairline bg-paper">
        <div className="mx-auto flex min-h-16 max-w-[1280px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-2 sm:px-8">
          <Wordmark href="/dashboard" />
          <nav
            aria-label="Workspace"
            className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto"
          >
            {navFor(data).map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={clsx(
                    'whitespace-nowrap rounded-md px-3 py-1.5 text-sm',
                    active
                      ? 'bg-signal-soft font-medium text-signal-strong'
                      : 'text-muted hover:bg-cutout hover:text-ink',
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span
              className="hidden items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted lg:inline-flex"
              role="status"
              aria-live="polite"
            >
              <span
                aria-hidden
                className={clsx(
                  'size-1.5 rounded-full',
                  stream === 'live' ? 'bg-good' : stream === 'offline' ? 'bg-breach' : 'bg-caution',
                )}
              />
              {STREAM_LABEL[stream]}
            </span>
            <OnlineCount missionId={missionIdFrom(pathname)} />
            <Identity me={data} />
            <label className="sr-only" htmlFor="role-switch">
              Active workspace and role
            </label>
            <select
              id="role-switch"
              value={activeKey}
              disabled={switchRole.isPending}
              onChange={(e) => {
                const [tenantId, role] = e.target.value.split('|') as [string, Role];
                switchRole.mutate({ tenantId, role });
              }}
              className="h-8 max-w-[15rem] truncate rounded-md border border-hairline-strong bg-paper px-2 text-[13px] text-ink"
            >
              {data.memberships.map((m) => (
                <option key={`${m.tenantId}|${m.role}`} value={`${m.tenantId}|${m.role}`}>
                  {m.tenantName} — {humanize(m.role)}
                </option>
              ))}
            </select>
            <NotificationBell />
            <Button
              size="sm"
              variant="ghost"
              busy={signOut.isPending}
              onClick={() => signOut.mutate()}
            >
              Sign out
            </Button>
          </div>
        </div>
        {switchRole.isError ? (
          <p role="alert" className="mx-auto max-w-[1280px] px-5 pb-2 text-sm text-breach sm:px-8">
            {errorMessage(switchRole.error)}
          </p>
        ) : null}
      </header>
      <main id="main" className="mx-auto max-w-[1280px] px-5 pb-24 pt-8 sm:px-8">
        {children}
      </main>
    </div>
  );
}
