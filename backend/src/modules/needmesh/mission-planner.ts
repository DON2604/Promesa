import { type IntentSpec, formatMoney } from '@promesa/contracts';
import { type CatalogItem, solveOffers } from '../commerce/offer-solver';

export const MISSION_PLANNER_VERSION = 'mission-planner@1.0.0';

export type PlannedLine = {
  product: CatalogItem;
  quantity: number;
  unitPriceMinor: bigint;
  amountMinor: bigint;
  estimatedDeliveryAt: Date;
};

export type ExcludedItem = { sku: string; merchantName: string; reasons: string[] };

export type MissionPlanResult = {
  lines: PlannedLine[];
  requestedQuantity: number;
  plannedQuantity: number;
  unmetQuantity: number;
  totalMinor: bigint;
  excluded: ExcludedItem[];
  /** Why the plan is partial or empty; null when the full quantity is covered. */
  shortfallReason: string | null;
};

export type PlanArgs = {
  intent: IntentSpec;
  catalog: CatalogItem[];
  now: Date;
  /** Units already covered by live (non-voided, non-refunded) orders of this mission. */
  coveredQuantity?: number;
  /** Money still available for new orders: mission budget minus live commitments. */
  budgetAvailableMinor: bigint;
  /** Units of each catalog product already reserved by this mission's live orders. */
  reservedByProduct?: ReadonlyMap<string, number>;
  /** Catalog products that must not be used (e.g. a merchant that just reported a stockout). */
  blockedProductIds?: ReadonlySet<string>;
};

/**
 * Deterministic multi-merchant allocator. Hard constraints (required/prohibited attributes,
 * currency, arrival estimate) are filters, never traded for price. Among eligible items the
 * cheapest unit price is filled first, which minimises total cost for a linear price model with
 * stock limits. Budget is a hard ceiling: the plan is shortened rather than exceeded.
 */
export function planMission(args: PlanArgs): MissionPlanResult {
  const { intent, catalog, now } = args;
  const requested = intent.quantity;
  const remainingNeeded = Math.max(0, requested - (args.coveredQuantity ?? 0));

  const { offers } = solveOffers(intent, catalog, now);
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const excluded: ExcludedItem[] = [];
  const candidates: Array<{ item: CatalogItem; available: number }> = [];

  for (const offer of offers) {
    const item = byId.get(offer.productId);
    if (!item) continue;
    // Stock and full-quantity budget are plan-level concerns, not per-item eligibility.
    const hardFailures = offer.checks.filter(
      (c) => !c.passed && c.constraintId !== 'stock' && c.constraintId !== 'budget',
    );
    if (hardFailures.length > 0) {
      excluded.push({
        sku: item.sku,
        merchantName: item.merchant.name,
        reasons: hardFailures.map((c) => `${c.label}: ${c.detail}`),
      });
      continue;
    }
    if (args.blockedProductIds?.has(item.id)) {
      excluded.push({
        sku: item.sku,
        merchantName: item.merchant.name,
        reasons: ['The merchant reported this item as out of stock.'],
      });
      continue;
    }
    const available = Math.max(0, item.inventoryQty - (args.reservedByProduct?.get(item.id) ?? 0));
    if (available === 0) {
      excluded.push({
        sku: item.sku,
        merchantName: item.merchant.name,
        reasons: ['All listed stock is already reserved by this mission.'],
      });
      continue;
    }
    candidates.push({ item, available });
  }

  candidates.sort(
    (a, b) =>
      Number(a.item.unitPriceMinor - b.item.unitPriceMinor) ||
      a.item.leadTimeHours - b.item.leadTimeHours ||
      a.item.merchant.name.localeCompare(b.item.merchant.name),
  );

  let remaining = remainingNeeded;
  let budgetLeft = args.budgetAvailableMinor;
  const lines: PlannedLine[] = [];
  let budgetLimited = false;

  for (const { item, available } of candidates) {
    if (remaining <= 0) break;
    const affordable = item.unitPriceMinor > 0n ? Number(budgetLeft / item.unitPriceMinor) : 0;
    const take = Math.min(available, remaining, affordable);
    if (affordable < Math.min(available, remaining)) budgetLimited = true;
    if (take <= 0) continue;
    const amountMinor = item.unitPriceMinor * BigInt(take);
    lines.push({
      product: item,
      quantity: take,
      unitPriceMinor: item.unitPriceMinor,
      amountMinor,
      estimatedDeliveryAt: new Date(now.getTime() + item.leadTimeHours * 3_600_000),
    });
    budgetLeft -= amountMinor;
    remaining -= take;
  }

  const totalMinor = lines.reduce((acc, l) => acc + l.amountMinor, 0n);
  const planned = lines.reduce((acc, l) => acc + l.quantity, 0);

  let shortfallReason: string | null = null;
  if (remaining > 0) {
    shortfallReason = budgetLimited
      ? `Only ${planned} of ${remainingNeeded} units fit inside the remaining budget of ${formatMoney(args.budgetAvailableMinor, intent.currency)}. Raise the budget or accept a partial mission.`
      : candidates.length === 0
        ? 'No listed merchant can supply this need under the hard constraints.'
        : `Listed stock covers only ${planned} of ${remainingNeeded} units that satisfy every hard constraint.`;
  }

  return {
    lines,
    requestedQuantity: requested,
    plannedQuantity: planned,
    unmetQuantity: remaining,
    totalMinor,
    excluded,
    shortfallReason,
  };
}
