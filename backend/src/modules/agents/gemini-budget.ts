import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type GeminiLimits = {
  requestsPerMinute: number;
  requestsPerDay: number;
  tokensPerMinute: number;
};

/**
 * Caps we will not cross. These sit under the tightest free-tier figures still reported for a
 * Gemini model that actually serves free traffic (about 5 requests/minute and 20/day). Staying
 * under them means Google is not the thing that rejects the call.
 */
export const CONSERVATIVE_FREE_TIER: GeminiLimits = {
  requestsPerMinute: 4,
  requestsPerDay: 15,
  tokensPerMinute: 200_000,
};

/** Models whose free quota has been reported as zero: the first call returns 429. */
const NO_FREE_QUOTA = [/^gemini-2\.0-flash$/, /^gemini-1\.5-/];

export function freeTierBudget(model: string): GeminiLimits {
  const id = model.replace(/^models\//, '');
  if (NO_FREE_QUOTA.some((re) => re.test(id))) {
    return { requestsPerMinute: 0, requestsPerDay: 0, tokensPerMinute: 0 };
  }
  return { ...CONSERVATIVE_FREE_TIER };
}

type Persisted = { day: string; count: number };

/**
 * Local budget for the Gemini free tier. `tryReserve` is synchronous, so two narrations in the
 * same process cannot both pass the check. The daily count survives a restart. When the budget
 * is spent the caller skips the network call entirely.
 */
export class GeminiBudget {
  private stamps: number[] = [];
  private tokenStamps: Array<{ t: number; n: number }> = [];
  private day = '';
  private dayCount = 0;
  private blockedUntil = 0;

  constructor(
    private readonly limits: GeminiLimits,
    private readonly opts: { now?: () => number; file?: string } = {},
  ) {
    this.restore();
  }

  tryReserve(estimatedTokens: number): { ok: true } | { ok: false; reason: string } {
    const now = this.now();
    if (now < this.blockedUntil) {
      return { ok: false, reason: 'Gemini is cooling down after a rate-limit response' };
    }
    this.rollDay(now);
    if (this.limits.requestsPerMinute <= 0 || this.limits.requestsPerDay <= 0) {
      return {
        ok: false,
        reason:
          'This Gemini model has no free-tier budget. Set GEMINI_RPM and GEMINI_RPD from AI Studio to allow calls.',
      };
    }
    this.stamps = this.stamps.filter((t) => now - t < 60_000);
    this.tokenStamps = this.tokenStamps.filter((x) => now - x.t < 60_000);
    const last = this.stamps.at(-1);
    // A same-second burst is still one minute's worth of quota on Google's side.
    if (last !== undefined && now - last < 1_200) {
      return {
        ok: false,
        reason: 'Spacing Gemini calls so a burst cannot cross the per-minute limit',
      };
    }
    if (this.dayCount >= this.limits.requestsPerDay) {
      return { ok: false, reason: `Daily Gemini budget of ${this.limits.requestsPerDay} is used` };
    }
    if (this.stamps.length >= this.limits.requestsPerMinute) {
      return {
        ok: false,
        reason: `Per-minute Gemini budget of ${this.limits.requestsPerMinute} is used`,
      };
    }
    const used = this.tokenStamps.reduce((sum, x) => sum + x.n, 0);
    if (used + estimatedTokens > this.limits.tokensPerMinute) {
      return { ok: false, reason: 'Per-minute Gemini token budget is used' };
    }
    this.stamps.push(now);
    this.tokenStamps.push({ t: now, n: Math.max(1, estimatedTokens) });
    this.dayCount += 1;
    this.persist();
    return { ok: true };
  }

  /** A 429 still happened (shared project quota, or another client). Stop calling. */
  penalize(args: { daily: boolean; retryAfterMs?: number }) {
    const now = this.now();
    const pause = Math.min(Math.max(args.retryAfterMs ?? 60_000, 1_000), 24 * 60 * 60 * 1000);
    this.blockedUntil = Math.max(this.blockedUntil, now + pause);
    if (args.daily) {
      this.rollDay(now);
      this.dayCount = Math.max(this.dayCount, this.limits.requestsPerDay);
      this.blockedUntil = Math.max(this.blockedUntil, nextPacificMidnight(now));
      this.persist();
    }
  }

  private now() {
    return this.opts.now?.() ?? Date.now();
  }

  private rollDay(now: number) {
    const day = pacificDay(now);
    if (day === this.day) return;
    this.day = day;
    this.dayCount = 0;
    this.stamps = [];
    this.tokenStamps = [];
  }

  private restore() {
    if (!this.opts.file || !existsSync(this.opts.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.opts.file, 'utf8')) as Persisted;
      const today = pacificDay(this.now());
      this.day = today;
      this.dayCount = parsed.day === today && parsed.count > 0 ? parsed.count : 0;
    } catch {
      this.day = pacificDay(this.now());
      this.dayCount = 0;
    }
  }

  private persist() {
    if (!this.opts.file) return;
    try {
      mkdirSync(dirname(this.opts.file), { recursive: true });
      const body: Persisted = { day: this.day || pacificDay(this.now()), count: this.dayCount };
      writeFileSync(this.opts.file, JSON.stringify(body));
    } catch {
      // A full disk must not fail the mission. The in-memory count still applies for this process.
    }
  }
}

/** Google resets requests-per-day at midnight Pacific. */
export function pacificDay(nowMs: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(nowMs));
}

export function nextPacificMidnight(nowMs: number): number {
  const day = pacificDay(nowMs);
  let t = nowMs + 60_000;
  for (let i = 0; i < 24 * 60 + 5; i += 1) {
    if (pacificDay(t) !== day) return t;
    t += 60_000;
  }
  return nowMs + 24 * 60 * 60 * 1000;
}
