'use client';

import clsx from 'clsx';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { usePersonas } from '@/lib/queries';
import { Button, Chip, LoadingSheet, StateBlock } from '@/components/ui';
import { humanize } from '@/lib/format';

/** Only same-origin, path-relative redirects are honoured after sign-in. */
function safeNext(raw: string | null, fallback: string): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
  return raw;
}

export function PersonaPicker() {
  const params = useSearchParams();
  const router = useRouter();
  const client = useQueryClient();
  const preferred = params.get('persona');
  const next = safeNext(params.get('next'), '/dashboard');
  const { data, isLoading, isError, error, refetch } = usePersonas();
  const [pending, setPending] = useState<string | null>(null);

  const signIn = useMutation({
    mutationFn: (personaKey: string) =>
      api('/v1/auth/session', { method: 'POST', body: { personaKey } }),
    onMutate: (key) => setPending(key),
    onSuccess: async () => {
      client.clear();
      router.push(next);
    },
    onSettled: () => setPending(null),
  });

  if (isLoading) return <LoadingSheet label="Loading personas" />;
  if (isError || !data)
    return (
      <StateBlock
        tone="breach"
        title="The NeedMesh API is not reachable."
        action={
          <Button variant="secondary" onClick={() => void refetch()}>
            Try again
          </Button>
        }
      >
        {errorMessage(error)} Start it with <code className="font-mono">npm run dev</code> from the
        repository root.
      </StateBlock>
    );
  if (!data.enabled || data.personas.length === 0)
    return <StateBlock title="Demo sign-in is disabled in this environment." />;

  return (
    <div>
      {signIn.isError ? (
        <div className="mb-6">
          <StateBlock tone="breach" title="Sign-in failed.">
            {errorMessage(signIn.error)}
          </StateBlock>
        </div>
      ) : null}
      <ul className="grid gap-5 sm:grid-cols-2">
        {data.personas.map((p) => {
          const highlighted = p.key === preferred;
          return (
            <li key={p.key}>
              <article
                className={clsx(
                  'sheet flex h-full flex-col p-6 transition-[border-color] duration-[var(--dur-base)]',
                  highlighted ? 'border-ink' : 'hover:border-hairline-strong',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="kicker">{p.tenantName}</p>
                    <h2 className="font-display mt-2 text-2xl">{p.displayName}</h2>
                    <p className="text-sm text-muted">{p.title}</p>
                  </div>
                  {highlighted ? <Chip tone="signal">Suggested</Chip> : null}
                </div>
                <p className="mt-4 flex-1 text-[15px] leading-relaxed text-ink">{p.summary}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {p.roles.map((r) => (
                    <Chip key={r}>{humanize(r)}</Chip>
                  ))}
                </div>
                <Button
                  className="mt-6 w-full"
                  variant={highlighted ? 'primary' : 'secondary'}
                  busy={pending === p.key}
                  disabled={signIn.isPending}
                  onClick={() => signIn.mutate(p.key)}
                >
                  Continue as {p.displayName.split(' ')[0]}
                </Button>
              </article>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
