'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { shortWhen } from '@/lib/format';
import { qk, useScenarios } from '@/lib/queries';
import { Button, Kicker, SimulatedTag } from '@/components/ui';

/** Demo-only clock. Forward-only by design; the API rejects moving backwards. */
export function DemoControls({ scenarioKey, twinId }: { scenarioKey: string; twinId: string }) {
  const client = useQueryClient();
  const scenarios = useScenarios();
  const [confirmReset, setConfirmReset] = useState(false);
  const scenario = scenarios.data?.find((s) => s.key === scenarioKey);

  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: qk.twin(twinId) }),
      client.invalidateQueries({ queryKey: qk.scenarios }),
      client.invalidateQueries({ queryKey: qk.dashboard }),
    ]);
  };

  const advance = useMutation({
    mutationFn: (checkpoint: string) =>
      api(`/v1/demo/scenarios/${scenarioKey}/clock`, { method: 'POST', body: { checkpoint } }),
    onSuccess: refresh,
  });
  const reset = useMutation({
    mutationFn: () => api(`/v1/demo/scenarios/${scenarioKey}/reset`, { method: 'POST', body: {} }),
    onSuccess: async () => {
      setConfirmReset(false);
      await refresh();
    },
  });

  if (!scenario) return null;
  const now = new Date(scenario.simulatedNow).getTime();
  const busy = advance.isPending || reset.isPending;

  return (
    <div className="rounded-[var(--radius-sheet)] border border-dashed border-caution/50 bg-caution-soft/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <Kicker>Demo clock</Kicker>
        <SimulatedTag />
      </div>
      <p className="mt-2 text-sm text-ink">
        Simulated now:{' '}
        <span className="tabular">{shortWhen(scenario.simulatedNow, scenario.timezone)}</span>
      </p>
      <ul className="mt-3 space-y-2">
        {scenario.checkpoints.map((c) => {
          const past = new Date(c.at).getTime() <= now;
          return (
            <li key={c.key}>
              <Button
                size="sm"
                variant={past ? 'ghost' : 'secondary'}
                className="w-full justify-between text-left"
                disabled={past || busy}
                busy={advance.isPending && advance.variables === c.key}
                onClick={() => advance.mutate(c.key)}
              >
                <span className="truncate">{c.label}</span>
                <span className="tabular shrink-0 text-xs text-muted">
                  {past ? 'passed' : shortWhen(c.at, scenario.timezone)}
                </span>
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {confirmReset ? (
          <>
            <Button
              size="sm"
              variant="danger"
              busy={reset.isPending}
              onClick={() => reset.mutate()}
            >
              Confirm reset
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmReset(true)}>
            Reset scenario
          </Button>
        )}
      </div>
      {advance.isError || reset.isError ? (
        <p role="alert" className="mt-2 text-sm text-breach">
          {errorMessage(advance.error ?? reset.error)}
        </p>
      ) : null}
      <p className="mt-3 text-xs text-muted">
        Advancing the clock replays pre-scripted, simulated merchant events and re-evaluates the
        twin. Nothing here touches PayPal.
      </p>
    </div>
  );
}
