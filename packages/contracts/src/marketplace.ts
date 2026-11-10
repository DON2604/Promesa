import { z } from 'zod';
import type { MissionState } from './enums';
import type { ProposalView } from './needmesh';

/**
 * NeedMesh reverse marketplace: needs come first. Everything here is public-safe — no delivery
 * addresses, no beneficiary identities, no PayPal credentials.
 */

export type MarketplaceMissionCard = {
  id: string;
  title: string;
  category: string;
  state: MissionState;
  orgName: string;
  orgVerified: boolean;
  orgCity: string | null;
  publicSummary: string | null;
  productLabel: string;
  quantity: number;
  unit: string;
  requiredAttributes: string[];
  prohibitedAttributes: string[];
  budgetMinor: string;
  currency: string;
  deadline: string;
  timezone: string;
  publishedAt: string | null;
  isDemo: boolean;
  progress: { requested: number; planned: number; funded: number; received: number };
  unfundedMinor: string;
  /** Orders still waiting for a sponsor. */
  openOrders: number;
  proposals: number;
  /** Present for signed-in sponsors and merchants: why this mission fits them. */
  match: { score: number; reasons: string[] } | null;
};

export type MarketplaceView = {
  asOf: string;
  categories: Array<{ key: string; label: string; count: number }>;
  missions: MarketplaceMissionCard[];
  viewer: { role: string | null; tenantName: string | null };
};

export type MerchantWorkspaceView = {
  merchantName: string;
  catalog: Array<{
    productId: string;
    sku: string;
    title: string;
    productKind: string;
    unitPriceMinor: string;
    inventoryQty: number;
    leadTimeHours: number;
    deliveryTerms: string;
  }>;
  /** Published missions whose need matches at least one of this merchant's listings. */
  opportunities: Array<
    MarketplaceMissionCard & {
      matchingProducts: Array<{
        productId: string;
        sku: string;
        compatible: boolean;
        reasons: string[];
      }>;
    }
  >;
  proposals: ProposalView[];
  orders: Array<{
    missionId: string;
    missionTitle: string;
    orderId: string;
    sku: string;
    quantity: number;
    amountMinor: string;
    currency: string;
    state: string;
  }>;
};

export const PreferencesSchema = z.object({
  /** ORG: attributes always required / always excluded in new missions. */
  requiredAttributes: z.array(z.string().trim().min(2).max(40)).max(12).default([]),
  prohibitedAttributes: z.array(z.string().trim().min(2).max(40)).max(12).default([]),
  defaultBudgetMinor: z
    .string()
    .regex(/^\d{1,9}$/)
    .optional(),
  notes: z.string().trim().max(400).optional(),
  /** SPONSOR: funding interests used for mission matching. */
  categories: z.array(z.string().trim().min(2).max(40)).max(12).default([]),
  maxOrderMinor: z
    .string()
    .regex(/^\d{1,9}$/)
    .optional(),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

export const VerificationRequestSchema = z.object({
  legalName: z.string().trim().min(3).max(120),
  registrationId: z.string().trim().min(3).max(60),
  website: z.string().trim().url().max(200).optional(),
  city: z.string().trim().min(2).max(80),
  missionStatement: z.string().trim().min(10).max(400),
});
export type VerificationRequest = z.infer<typeof VerificationRequestSchema>;

export type OrgProfileView = {
  tenantId: string;
  name: string;
  kind: string;
  verification: {
    status: 'VERIFIED' | 'UNVERIFIED';
    verifiedAt: string | null;
    method: string | null;
    note: string | null;
  };
  publicProfile: { city: string | null; missionStatement: string | null; website: string | null };
  preferences: Preferences;
};

export type AnalyticsView = {
  asOf: string;
  scope: 'ORG' | 'SPONSOR' | 'MERCHANT';
  missions: { total: number; completed: number; active: number; published: number };
  units: { requested: number; funded: number; delivered: number; fulfillmentRate: number };
  money: {
    currency: string;
    budgetMinor: string;
    capturedMinor: string;
    neverChargedMinor: string;
    refundedMinor: string;
    avgUnitCostMinor: string | null;
    budgetUtilization: number;
  };
  recovery: { stockouts: number; replacementOrders: number; recoveredUnits: number };
  sponsors: number;
  merchants: Array<{
    name: string;
    orders: number;
    units: number;
    amountMinor: string;
    stockouts: number;
  }>;
  byMission: Array<{
    id: string;
    title: string;
    state: MissionState;
    requested: number;
    delivered: number;
    spentMinor: string;
    deadline: string;
  }>;
};

export type ShortageForecastView = {
  basis: string;
  items: Array<{
    productKind: string;
    productLabel: string;
    missionsObserved: number;
    averageQuantity: number;
    averageIntervalDays: number | null;
    lastNeededBy: string;
    predictedNextNeedBy: string | null;
    recommendation: string;
    sourceMissionId: string;
  }>;
};

export type NotificationView = {
  pending: Array<{
    id: string;
    kind: string;
    title: string;
    detail: string;
    href: string;
    severity: 'ACTION' | 'INFO' | 'WARNING';
  }>;
  activity: Array<{
    id: string;
    missionId: string;
    missionTitle: string;
    agent: string;
    title: string;
    source: string;
    occurredAt: string;
  }>;
};
