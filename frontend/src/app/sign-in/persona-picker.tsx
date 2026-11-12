'use client';

import clsx from 'clsx';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Persona } from '@promesa/contracts';
import { api, errorMessage } from '@/lib/api';
import { usePersonas } from '@/lib/queries';
import { Button, Chip, StateBlock } from '@/components/ui';
import { humanize } from '@/lib/format';

/** Only same-origin, path-relative redirects are honoured after sign-in. */
function safeNext(raw: string | null, fallback: string): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
  return raw;
}

const KIND_LABEL: Record<Persona['tenantKind'], string> = {
  ORG: 'Organization',
  BUSINESS: 'Business',
  MERCHANT: 'Merchant',
  PLATFORM: 'Platform',
};

const ROLE_TONE = (roles: Persona['roles']) =>
  roles.includes('SPONSOR')
    ? 'good'
    : roles.some((r) => r.startsWith('MERCHANT'))
      ? 'caution'
      : 'signal';

export function PersonaPicker() {
  const params = useSearchParams();
  const router = useRouter();
  const client = useQueryClient();
  const preferred = params.get('persona');
  const next = safeNext(params.get('next'), '/dashboard');
  const accounts = usePersonas();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    const match = accounts.data?.personas.find((p) => p.key === preferred);
    if (match && !email) setEmail(match.email);
  }, [accounts.data, preferred, email]);

  const signIn = useMutation({
    mutationFn: () => api('/v1/auth/login', { method: 'POST', body: { email, password } }),
    onSuccess: async () => {
      client.clear();
      router.push(next);
    },
  });

  const list = accounts.data?.enabled ? accounts.data.personas : [];

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_1fr]">
      <form
        className="sheet h-fit p-6"
        onSubmit={(e) => {
          e.preventDefault();
          signIn.mutate();
        }}
      >
        <p className="kicker">Account sign-in</p>
        <label className="mt-4 block text-[13px] text-muted" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 h-11 w-full rounded-[var(--radius-control)] border border-hairline-strong bg-paper px-3 text-[15px] text-ink"
          placeholder="you@organization.example"
        />
        <label className="mt-4 block text-[13px] text-muted" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 h-11 w-full rounded-[var(--radius-control)] border border-hairline-strong bg-paper px-3 text-[15px] text-ink"
        />
        {signIn.isError ? (
          <p role="alert" className="mt-3 text-sm text-breach">
            {errorMessage(signIn.error)}
          </p>
        ) : null}
        <Button type="submit" size="lg" className="mt-5 w-full" busy={signIn.isPending}>
          Sign in
        </Button>
        <p className="mt-4 text-[12px] leading-relaxed text-muted">
          Each browser keeps its own HTTP-only session. Open a second browser (or a private window)
          and sign in as a different account to run the organization, sponsor and merchant side by
          side.
        </p>
      </form>

      <div>
        {accounts.isError ? (
          <StateBlock tone="breach" title="The NeedMesh API is not reachable.">
            {errorMessage(accounts.error)} Start it with{' '}
            <code className="font-mono">npm run dev</code> from the repository root.
          </StateBlock>
        ) : list.length > 0 ? (
          <>
            <p className="kicker">Seeded accounts · select one to fill the email</p>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {list.map((p) => {
                const selected = p.email === email;
                return (
                  <li key={p.key}>
                    <button
                      type="button"
                      onClick={() => setEmail(p.email)}
                      className={clsx(
                        'sheet flex h-full w-full flex-col p-4 text-left transition-[border-color] duration-[var(--dur-base)]',
                        selected ? 'border-signal' : 'hover:border-hairline-strong',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="kicker">
                            {KIND_LABEL[p.tenantKind]} · {p.tenantName}
                          </p>
                          <p className="font-display mt-1 text-lg">{p.displayName}</p>
                        </div>
                        <Chip tone={ROLE_TONE(p.roles)}>{humanize(p.roles[0]!)}</Chip>
                      </div>
                      <p className="mt-1 font-mono text-[12px] text-signal">{p.email}</p>
                      <p className="mt-2 text-[13px] leading-snug text-muted">{p.summary}</p>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
