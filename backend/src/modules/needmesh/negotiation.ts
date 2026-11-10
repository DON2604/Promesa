import { type IntentSpec, formatMoney } from '@promesa/contracts';
import { type CatalogItem, solveOffers } from '../commerce/offer-solver';

export const NEGOTIATION_VERSION = 'negotiation-agent@1.0.0';

export type ProposalTerms = {
  quantity: number;
  unitPriceMinor: bigint;
  leadTimeHours: number;
};

export type ProposalEvaluation = {
  compatible: boolean;
  recommendation: 'ACCEPT' | 'COUNTER' | 'DECLINE';
  targetUnitPriceMinor: bigint;
  rationale: string;
  checks: Array<{ label: string; passed: boolean; detail: string }>;
};

/**
 * Deterministic Negotiation agent. It never accepts anything on a merchant's behalf: it only
 * recommends ACCEPT / COUNTER / DECLINE for the organization and proposes a counter price that
 * keeps the whole mission inside its budget.
 *
 * Target unit price = min(listed catalog price, remaining budget ÷ units still needed).
 * A proposal more than 25% above target is recommended for decline rather than counter.
 */
export function evaluateProposal(args: {
  intent: IntentSpec;
  product: CatalogItem;
  terms: ProposalTerms;
  now: Date;
  budgetRemainingMinor: bigint;
  unitsStillNeeded: number;
}): ProposalEvaluation {
  const { intent, product, terms, now } = args;
  const asOffered: CatalogItem = {
    ...product,
    unitPriceMinor: terms.unitPriceMinor,
    leadTimeHours: terms.leadTimeHours,
    inventoryQty: Math.min(product.inventoryQty, terms.quantity),
  };
  const [offer] = solveOffers({ ...intent, quantity: terms.quantity }, [asOffered], now).offers;
  const checks = (offer?.checks ?? [])
    .filter((c) => c.constraintId !== 'budget' && c.constraintId !== 'stock')
    .map((c) => ({ label: c.label, passed: c.passed, detail: c.detail }));
  if (terms.quantity > product.inventoryQty)
    checks.push({
      label: 'Stock',
      passed: false,
      detail: `Offers ${terms.quantity} but lists only ${product.inventoryQty} in stock.`,
    });
  const compatible = checks.every((c) => c.passed);

  const needed = Math.max(1, args.unitsStillNeeded);
  const budgetPerUnit =
    args.budgetRemainingMinor > 0n ? args.budgetRemainingMinor / BigInt(needed) : 0n;
  const target = budgetPerUnit < product.unitPriceMinor ? budgetPerUnit : product.unitPriceMinor;
  const price = (m: bigint) => formatMoney(m, intent.currency);

  if (!compatible) {
    const failed = checks.filter((c) => !c.passed).map((c) => `${c.label}: ${c.detail}`);
    return {
      compatible,
      recommendation: 'DECLINE',
      targetUnitPriceMinor: target,
      rationale: `Breaks a hard constraint, so price is irrelevant. ${failed.join(' ')}`,
      checks,
    };
  }
  if (terms.unitPriceMinor <= target) {
    return {
      compatible,
      recommendation: 'ACCEPT',
      targetUnitPriceMinor: target,
      rationale: `${price(terms.unitPriceMinor)}/unit is at or below the target of ${price(target)} (listed ${price(product.unitPriceMinor)}, budget allows ${price(budgetPerUnit)} per remaining unit).`,
      checks,
    };
  }
  const tooFar = terms.unitPriceMinor * 100n > target * 125n;
  return {
    compatible,
    recommendation: tooFar ? 'DECLINE' : 'COUNTER',
    targetUnitPriceMinor: target,
    rationale: tooFar
      ? `${price(terms.unitPriceMinor)}/unit is more than 25% above the ${price(target)} the budget allows; a counter is unlikely to close.`
      : `Counter at ${price(target)}/unit: that keeps the remaining ${needed} units inside the budget. Listed price is ${price(product.unitPriceMinor)}.`,
    checks,
  };
}

/** Accepted proposals replace the listed price and cap quantity for that listing in future plans. */
export function applyAcceptedTerms(
  catalog: CatalogItem[],
  accepted: Array<{
    catalogProductId: string;
    agreedUnitPriceMinor: bigint;
    quantity: number;
    leadTimeHours: number;
  }>,
): { catalog: CatalogItem[]; negotiated: Map<string, { listUnitPriceMinor: bigint }> } {
  const negotiated = new Map<string, { listUnitPriceMinor: bigint }>();
  const byProduct = new Map(accepted.map((a) => [a.catalogProductId, a]));
  const next = catalog.map((item) => {
    const deal = byProduct.get(item.id);
    if (!deal) return item;
    negotiated.set(item.id, { listUnitPriceMinor: item.unitPriceMinor });
    return {
      ...item,
      unitPriceMinor: deal.agreedUnitPriceMinor,
      leadTimeHours: deal.leadTimeHours,
      inventoryQty: Math.min(item.inventoryQty, deal.quantity),
    };
  });
  return { catalog: next, negotiated };
}
