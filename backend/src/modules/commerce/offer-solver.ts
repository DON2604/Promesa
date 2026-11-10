import {
  type ConstraintCheck,
  type IntentSpec,
  type OfferView,
  type PlanAlternative,
  formatInZone,
  formatMoney,
} from '@promesa/contracts';

export const SOLVER_VERSION = 'offer-solver@1.0.0';

export type CatalogItem = {
  id: string;
  sku: string;
  title: string;
  productKind: string;
  attributes: string[];
  unitPriceMinor: bigint;
  currency: string;
  inventoryQty: number;
  leadTimeHours: number;
  deliveryTerms: string;
  source: string;
  isDemo: boolean;
  lastVerifiedAt: Date;
  merchant: { tenantId: string; name: string; paypalConnected: boolean };
};

export type SolverResult = {
  offers: OfferView[];
  plans: PlanAlternative[];
  infeasibleReason: string | null;
};

/**
 * Deterministic integer-money solver. Hard constraints are never traded for price:
 * a cheaper item that violates a material rule is excluded with an explicit reason.
 */
export function solveOffers(intent: IntentSpec, catalog: CatalogItem[], now: Date): SolverResult {
  const deadline = new Date(intent.deadlineISO);
  const budget = BigInt(intent.budgetMinor);
  const qty = BigInt(intent.quantity);

  const offers: OfferView[] = catalog
    .filter((item) => item.productKind === intent.productKind)
    .map((item) => {
      const eta = new Date(now.getTime() + item.leadTimeHours * 3600_000);
      const fullTotal = item.unitPriceMinor * qty;
      const missing = intent.requiredAttributes.filter((a) => !item.attributes.includes(a));
      const forbidden = intent.prohibitedAttributes.filter((a) => item.attributes.includes(a));
      const checks: ConstraintCheck[] = [
        {
          constraintId: 'required',
          label: 'Required attributes',
          passed: missing.length === 0,
          detail:
            missing.length === 0
              ? 'All required attributes listed by the seller.'
              : `Missing: ${missing.join(', ')}`,
        },
        {
          constraintId: 'prohibited',
          label: 'Prohibited attributes',
          passed: forbidden.length === 0,
          detail:
            forbidden.length === 0
              ? 'No prohibited attributes.'
              : `Contains prohibited: ${forbidden.join(', ')}`,
        },
        {
          constraintId: 'budget',
          label: 'Budget for full quantity',
          passed: fullTotal <= budget,
          detail: `${intent.quantity} × ${formatMoney(item.unitPriceMinor, item.currency)} = ${formatMoney(fullTotal, item.currency)} (limit ${formatMoney(budget, intent.currency)})`,
        },
        {
          constraintId: 'stock',
          label: 'Stock',
          passed: item.inventoryQty >= intent.quantity,
          detail: `${item.inventoryQty} available, ${intent.quantity} needed`,
        },
        {
          constraintId: 'deadline',
          label: 'Estimated arrival',
          passed: eta.getTime() <= deadline.getTime(),
          detail: `Seller estimate ${formatInZone(eta, intent.timezone)} vs required ${formatInZone(deadline, intent.timezone)} (an estimate, not a commitment)`,
        },
        {
          constraintId: 'currency',
          label: 'Currency',
          passed: item.currency === intent.currency,
          detail: item.currency,
        },
      ];
      const exclusionReasons = checks
        .filter((c) => !c.passed)
        .map((c) => `${c.label}: ${c.detail}`);
      return {
        productId: item.id,
        sku: item.sku,
        title: item.title,
        merchant: item.merchant,
        attributes: item.attributes,
        unitPriceMinor: item.unitPriceMinor.toString(),
        currency: item.currency,
        quantityOffered: Math.min(item.inventoryQty, intent.quantity),
        totalMinor: (
          item.unitPriceMinor * BigInt(Math.min(item.inventoryQty, intent.quantity))
        ).toString(),
        inventoryQty: item.inventoryQty,
        estimatedDeliveryAt: eta.toISOString(),
        deliveryTerms: item.deliveryTerms,
        source: item.source,
        isDemo: item.isDemo,
        lastVerifiedAt: item.lastVerifiedAt.toISOString(),
        eligible: checks.every((c) => c.passed),
        checks,
        exclusionReasons,
      } satisfies OfferView;
    })
    .sort((a, b) => Number(BigInt(a.totalMinor) - BigInt(b.totalMinor)));

  const plans: PlanAlternative[] = [];
  const single = offers.filter((o) => o.eligible);
  if (single.length > 0) {
    const cheapest = [...single].sort((a, b) =>
      Number(BigInt(a.totalMinor) - BigInt(b.totalMinor)),
    )[0]!;
    const fastest = [...single].sort(
      (a, b) => Date.parse(a.estimatedDeliveryAt) - Date.parse(b.estimatedDeliveryAt),
    )[0]!;
    plans.push(singlePlan('LOWEST_COST', 'Lowest cost', cheapest, intent));
    if (fastest.productId !== cheapest.productId) {
      plans.push(singlePlan('EARLIEST_ARRIVAL', 'Earliest estimated arrival', fastest, intent));
    }
  }

  // Split across sellers only with items that satisfy every non-quantity hard constraint.
  const splittable = offers
    .filter((o) =>
      o.checks.every((c) => c.passed || c.constraintId === 'stock' || c.constraintId === 'budget'),
    )
    .sort((a, b) => Number(BigInt(a.unitPriceMinor) - BigInt(b.unitPriceMinor)));
  if (single.length === 0 && splittable.length > 1) {
    let remaining = intent.quantity;
    const lines: PlanAlternative['lines'] = [];
    for (const offer of splittable) {
      if (remaining <= 0) break;
      const take = Math.min(offer.inventoryQty, remaining);
      if (take <= 0) continue;
      lines.push({
        productId: offer.productId,
        merchantName: offer.merchant.name,
        quantity: take,
        totalMinor: (BigInt(offer.unitPriceMinor) * BigInt(take)).toString(),
      });
      remaining -= take;
    }
    const total = lines.reduce((acc, l) => acc + BigInt(l.totalMinor), 0n);
    if (remaining === 0 && total <= budget) {
      const latest = Math.max(
        ...lines.map((l) =>
          Date.parse(splittable.find((o) => o.productId === l.productId)!.estimatedDeliveryAt),
        ),
      );
      plans.push({
        key: 'FEWEST_MERCHANTS',
        label: `Split across ${lines.length} sellers`,
        lines,
        totalMinor: total.toString(),
        currency: intent.currency,
        latestDeliveryAt: new Date(latest).toISOString(),
        merchantCount: lines.length,
        explanation: `No single seller satisfies every hard constraint for ${intent.quantity} ${intent.unit}. Cheapest compliant units are allocated first; each seller needs its own order and its own buyer approval.`,
      });
    }
  }

  let infeasibleReason: string | null = null;
  if (plans.length === 0) {
    infeasibleReason =
      offers.length === 0
        ? `No catalog items match the product kind "${intent.productKind}".`
        : 'No combination of listed offers satisfies every hard constraint (attributes, budget, stock and arrival estimate). Consider adjusting the budget or deadline.';
  }

  return { offers, plans, infeasibleReason };
}

function singlePlan(
  key: PlanAlternative['key'],
  label: string,
  offer: OfferView,
  intent: IntentSpec,
): PlanAlternative {
  return {
    key,
    label,
    lines: [
      {
        productId: offer.productId,
        merchantName: offer.merchant.name,
        quantity: intent.quantity,
        totalMinor: offer.totalMinor,
      },
    ],
    totalMinor: offer.totalMinor,
    currency: intent.currency,
    latestDeliveryAt: offer.estimatedDeliveryAt,
    merchantCount: 1,
    explanation: `${offer.merchant.name} lists ${offer.sku} meeting every hard constraint at ${formatMoney(offer.totalMinor, offer.currency)} (${formatMoney(BigInt(intent.budgetMinor) - BigInt(offer.totalMinor), intent.currency)} under budget). Delivery is an estimate until the seller accepts terms.`,
  };
}
