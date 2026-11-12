import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NarrationSchema } from './llm-provider';
import { LlmDeclined } from './llm-provider';
import {
  GeminiBudget,
  freeTierBudget,
  nextPacificMidnight,
  pacificDay,
  type GeminiLimits,
} from './gemini-budget';
import { GeminiProvider } from './gemini-provider';

const LIMITS: GeminiLimits = { requestsPerMinute: 4, requestsPerDay: 15, tokensPerMinute: 1_000 };

function budget(now: () => number, limits: GeminiLimits = LIMITS) {
  return new GeminiBudget(limits, { now });
}

describe('Gemini free-tier budget', () => {
  it('stops one request before the published per-minute and per-day caps', () => {
    expect(freeTierBudget('gemini-2.5-flash-lite')).toEqual({
      requestsPerMinute: 4,
      requestsPerDay: 15,
      tokensPerMinute: 200_000,
    });
    expect(freeTierBudget('gemini-2.0-flash').requestsPerMinute).toBe(0);
  });

  it('allows four calls in a minute and refuses the fifth without counting it', () => {
    let now = Date.parse('2026-11-10T18:00:00Z');
    const gate = budget(() => now);
    for (let i = 0; i < 4; i += 1) {
      now += 2_000;
      expect(gate.tryReserve(10).ok).toBe(true);
    }
    now += 2_000;
    const denied = gate.tryReserve(10);
    expect(denied.ok).toBe(false);
    now += 60_000;
    expect(gate.tryReserve(10).ok).toBe(true);
  });

  it('refuses a burst closer than the spacing gap', () => {
    let now = Date.parse('2026-11-10T18:00:00Z');
    const gate = budget(() => now);
    expect(gate.tryReserve(10).ok).toBe(true);
    now += 500;
    expect(gate.tryReserve(10).ok).toBe(false);
  });

  it('resets the daily count at midnight Pacific', () => {
    // 07:30Z is still the previous Pacific day in November (PST, UTC-8). 08:30Z is the next day.
    let now = Date.parse('2026-11-10T07:30:00Z');
    const gate = budget(() => now, { ...LIMITS, requestsPerMinute: 100, requestsPerDay: 2 });
    expect(gate.tryReserve(10).ok).toBe(true);
    now += 2_000;
    expect(gate.tryReserve(10).ok).toBe(true);
    now += 2_000;
    expect(gate.tryReserve(10).ok).toBe(false);
    now = Date.parse('2026-11-10T08:30:00Z');
    expect(pacificDay(now)).toBe('2026-11-10');
    expect(gate.tryReserve(10).ok).toBe(true);
  });

  it('remembers the daily count across a restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gemini-budget-'));
    const file = join(dir, 'budget.json');
    const now = Date.parse('2026-11-10T18:00:00Z');
    const first = new GeminiBudget(
      { ...LIMITS, requestsPerDay: 2, requestsPerMinute: 100 },
      { now: () => now, file },
    );
    expect(first.tryReserve(10).ok).toBe(true);
    const second = new GeminiBudget(
      { ...LIMITS, requestsPerDay: 2, requestsPerMinute: 100 },
      { now: () => now + 2_000, file },
    );
    expect(second.tryReserve(10).ok).toBe(true);
    expect(second.tryReserve(10).ok).toBe(false);
    expect(JSON.parse(readFileSync(file, 'utf8')).count).toBe(2);
  });

  it('a daily 429 pauses calls until the next Pacific midnight', () => {
    let now = Date.parse('2026-11-10T18:00:00Z');
    const gate = budget(() => now);
    expect(gate.tryReserve(10).ok).toBe(true);
    gate.penalize({ daily: true });
    now += 5_000;
    expect(gate.tryReserve(10).ok).toBe(false);
    const midnight = nextPacificMidnight(Date.parse('2026-11-10T18:00:00Z'));
    expect(pacificDay(midnight)).not.toBe(pacificDay(Date.parse('2026-11-10T18:00:00Z')));
    now = midnight + 2_000;
    expect(gate.tryReserve(10).ok).toBe(true);
  });
});

const narration = {
  headline: 'Plan stays inside the budget',
  rationale: 'Two merchants cover the quantity.',
  tradeoffs: ['Split across merchants'],
};

describe('Gemini client', () => {
  afterEach(() => vi.unstubAllGlobals());

  const request = {
    task: 'mission.narrate' as const,
    schema: NarrationSchema,
    systemPolicy: 'Explain only.',
    trustedContext: { facts: { total: '$10.00' } },
    untrustedInput: '',
  };

  function provider(now: () => number) {
    return new GeminiProvider({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: 'test-key',
      model: 'gemini-3.5-flash-lite',
      retryDelayMs: 0,
      budget: new GeminiBudget(
        { requestsPerMinute: 4, requestsPerDay: 15, tokensPerMinute: 200_000 },
        { now },
      ),
    });
  }

  it('does not call Gemini again once the local budget is spent', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(narration) } }] }),
        { status: 200 },
      );
    });
    let now = Date.parse('2026-11-10T18:00:00Z');
    const client = provider(() => now);
    await expect(client.generateStructured(request)).resolves.toMatchObject({
      headline: narration.headline,
    });
    now += 100;
    await expect(client.generateStructured(request)).rejects.toBeInstanceOf(LlmDeclined);
    expect(calls).toBe(1);
  });

  it('does not retry a 429, and the next narration is not sent', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ error: { message: 'GenerateRequestsPerDayPerProject exceeded' } }),
        {
          status: 429,
          headers: { 'retry-after': '30', 'Content-Type': 'application/json' },
        },
      );
    });
    let now = Date.parse('2026-11-10T18:00:00Z');
    const client = provider(() => now);
    await expect(client.generateStructured(request)).rejects.toBeInstanceOf(LlmDeclined);
    now += 5_000;
    await expect(client.generateStructured(request)).rejects.toBeInstanceOf(LlmDeclined);
    expect(calls).toBe(1);
  });

  it('retries a 503 once and uses the second answer', async () => {
    const statuses = [503, 200];
    vi.stubGlobal('fetch', async () => {
      const status = statuses.shift() ?? 500;
      return status === 200
        ? new Response(
            JSON.stringify({ choices: [{ message: { content: JSON.stringify(narration) } }] }),
            { status },
          )
        : new Response('{}', { status });
    });
    let now = Date.parse('2026-11-10T18:00:00Z');
    const client = provider(() => (now += 2_000));
    await expect(client.generateStructured(request)).resolves.toMatchObject({
      headline: narration.headline,
    });
    expect(statuses).toHaveLength(0);
  });

  it('gives up after the single 5xx retry', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      return new Response('{}', { status: 503 });
    });
    let now = Date.parse('2026-11-10T18:00:00Z');
    const client = provider(() => (now += 2_000));
    await expect(client.generateStructured(request)).rejects.toBeInstanceOf(LlmDeclined);
    expect(calls).toBe(2);
  });
});
