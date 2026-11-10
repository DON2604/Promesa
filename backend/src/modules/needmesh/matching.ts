import { formatMoney } from '@promesa/contracts';

export type SponsorInterests = { categories: string[]; maxOrderMinor?: bigint | null };

export type MatchableMission = {
  category: string;
  deadline: Date;
  orgVerified: boolean;
  openOrderAmounts: bigint[];
  unfundedMinor: bigint;
  currency: string;
};

/**
 * Deterministic sponsor ↔ mission matching. Scores 0–100 and always explains itself; it never
 * decides on a sponsor's behalf.
 */
export function matchSponsor(
  interests: SponsorInterests,
  m: MatchableMission,
  now: Date,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (interests.categories.length === 0) {
    score += 25;
    reasons.push('No category preference saved — every category is shown.');
  } else if (interests.categories.map((c) => c.toLowerCase()).includes(m.category.toLowerCase())) {
    score += 40;
    reasons.push(`Matches your interest in ${m.category}.`);
  } else {
    reasons.push(`Outside your saved categories (${interests.categories.join(', ')}).`);
  }

  const smallest = m.openOrderAmounts.length
    ? m.openOrderAmounts.reduce((a, b) => (b < a ? b : a))
    : null;
  if (smallest === null) {
    reasons.push(m.unfundedMinor > 0n ? 'Waiting for the agents to plan orders.' : 'Fully funded.');
  } else if (!interests.maxOrderMinor || smallest <= interests.maxOrderMinor) {
    score += 30;
    reasons.push(
      `An open order of ${formatMoney(smallest, m.currency)} fits ${interests.maxOrderMinor ? `your ${formatMoney(interests.maxOrderMinor, m.currency)} limit` : 'your budget'}.`,
    );
  } else {
    reasons.push(`Smallest open order ${formatMoney(smallest, m.currency)} exceeds your limit.`);
  }

  const days = (m.deadline.getTime() - now.getTime()) / 86_400_000;
  if (days >= 0 && days <= 7) {
    score += 20;
    reasons.push(
      `Needed within ${Math.max(1, Math.ceil(days))} day${Math.ceil(days) === 1 ? '' : 's'}.`,
    );
  } else if (days > 7) {
    score += 8;
  }
  if (m.orgVerified) {
    score += 10;
    reasons.push('Requesting organization is verified.');
  }
  return { score: Math.min(100, score), reasons };
}

export type HistoryPoint = {
  missionId: string;
  productKind: string;
  productLabel: string;
  quantity: number;
  neededBy: Date;
};

/**
 * Shortage forecast from the organization's own mission history (authorized data only).
 * Deterministic: average interval between past need dates projected forward. Needs ≥ 2 missions.
 */
export function forecastShortages(history: HistoryPoint[], now: Date) {
  // Several missions for the same kind due on the same day are one need, not separate cycles.
  const byDay = new Map<string, HistoryPoint>();
  for (const h of history) {
    const key = `${h.productKind}|${h.neededBy.toISOString().slice(0, 10)}`;
    const prev = byDay.get(key);
    if (!prev || h.quantity > prev.quantity) byDay.set(key, h);
  }
  const byKind = new Map<string, HistoryPoint[]>();
  for (const h of byDay.values())
    byKind.set(h.productKind, [...(byKind.get(h.productKind) ?? []), h]);
  const items = [];
  for (const [productKind, points] of byKind) {
    const sorted = [...points].sort((a, b) => a.neededBy.getTime() - b.neededBy.getTime());
    const last = sorted[sorted.length - 1]!;
    const avgQty = Math.round(sorted.reduce((a, p) => a + p.quantity, 0) / sorted.length);
    let avgInterval: number | null = null;
    if (sorted.length >= 2) {
      const gaps = sorted
        .slice(1)
        .map((p, i) => (p.neededBy.getTime() - sorted[i]!.neededBy.getTime()) / 86_400_000);
      avgInterval = Math.round((gaps.reduce((a, g) => a + g, 0) / gaps.length) * 10) / 10;
    }
    const next = avgInterval ? new Date(last.neededBy.getTime() + avgInterval * 86_400_000) : null;
    const leadDays = next ? Math.round((next.getTime() - now.getTime()) / 86_400_000) : null;
    items.push({
      productKind,
      productLabel: last.productLabel,
      missionsObserved: sorted.length,
      averageQuantity: avgQty,
      averageIntervalDays: avgInterval,
      lastNeededBy: last.neededBy.toISOString(),
      predictedNextNeedBy: next?.toISOString() ?? null,
      recommendation: next
        ? `About ${avgQty} ${last.productLabel.toLowerCase()} every ${avgInterval} days. Next need ≈ ${next.toISOString().slice(0, 10)}${leadDays !== null && leadDays >= 0 ? ` (in ${leadDays} days)` : ''}. Start a repeat mission ~5 days earlier to avoid a shortage.`
        : 'Only one mission so far — not enough history to forecast.',
      sourceMissionId: last.missionId,
    });
  }
  return items.sort((a, b) => b.missionsObserved - a.missionsObserved);
}
