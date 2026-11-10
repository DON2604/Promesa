import type { ProposalView, Role } from '@promesa/contracts';
import type { MerchantProposal } from '@prisma/client';

type Stored = {
  compatible?: boolean;
  recommendation?: 'ACCEPT' | 'COUNTER' | 'DECLINE';
  targetUnitPriceMinor?: string;
  rationale?: string;
  checks?: Array<{ label: string; passed: boolean; detail: string }>;
  listUnitPriceMinor?: string;
  sku?: string;
  title?: string;
};

export function toProposalView(
  p: MerchantProposal,
  names: Map<string, string>,
  viewer: { tenantId: string; role: Role; isOrg: boolean },
): ProposalView {
  const ev = (p.evaluationJson ?? {}) as Stored;
  const allowed: ProposalView['allowedActions'] = [];
  const orgRole = viewer.isOrg && (viewer.role === 'ORG_ADMIN' || viewer.role === 'ORG_OPERATOR');
  const merchantRole =
    viewer.tenantId === p.merchantTenantId &&
    (viewer.role === 'MERCHANT_ADMIN' || viewer.role === 'MERCHANT_OPERATOR');
  if (orgRole && p.state === 'SUBMITTED') allowed.push('ORG_ACCEPT', 'ORG_COUNTER', 'ORG_DECLINE');
  if (orgRole && p.state === 'COUNTERED') allowed.push('ORG_DECLINE');
  if (merchantRole && p.state === 'COUNTERED') allowed.push('MERCHANT_ACCEPT', 'MERCHANT_WITHDRAW');
  if (merchantRole && p.state === 'SUBMITTED') allowed.push('MERCHANT_WITHDRAW');
  return {
    id: p.id,
    missionId: p.missionId,
    merchantTenantId: p.merchantTenantId,
    merchantName: names.get(p.merchantTenantId) ?? 'Merchant',
    productId: p.catalogProductId,
    sku: ev.sku ?? '',
    title: ev.title ?? '',
    quantity: p.quantity,
    unitPriceMinor: p.unitPriceMinor.toString(),
    listUnitPriceMinor: ev.listUnitPriceMinor ?? p.unitPriceMinor.toString(),
    leadTimeHours: p.leadTimeHours,
    deliveryTerms: p.deliveryTerms,
    note: p.note,
    state: p.state as ProposalView['state'],
    counterUnitPriceMinor: p.counterUnitPriceMinor?.toString() ?? null,
    counterRationale: p.counterRationale,
    agreedUnitPriceMinor: p.agreedUnitPriceMinor?.toString() ?? null,
    evaluation: {
      compatible: ev.compatible ?? false,
      recommendation: ev.recommendation ?? 'DECLINE',
      targetUnitPriceMinor: ev.targetUnitPriceMinor ?? '0',
      rationale: ev.rationale ?? '',
      checks: ev.checks ?? [],
    },
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    allowedActions: allowed,
  };
}
