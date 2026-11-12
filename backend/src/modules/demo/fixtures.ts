import type { Persona, Role, TenantKind } from '@promesa/contracts';

/**
 * Deterministic, clearly fictional demo data. Every merchant here is a fictional catalog entry
 * (`isDemo=true`, source DEMO_FIXTURE). No PayPal resource IDs are ever seeded.
 */

const id = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const IDS = {
  tenants: {
    bakery: id('7e000000', 1),
    shelter: id('7e000000', 2),
    kraftfold: id('7e000000', 3),
    northpack: id('7e000000', 4),
    leafLedger: id('7e000000', 5),
    cleanStart: id('7e000000', 6),
    harborGoods: id('7e000000', 7),
    beaconBasics: id('7e000000', 8),
    northside: id('7e000000', 9),
  },
  users: {
    maya: id('a5e40000', 1),
    jordan: id('a5e40000', 2),
    priya: id('a5e40000', 3),
    sam: id('a5e40000', 4),
    leo: id('a5e40000', 5),
    dana: id('a5e40000', 6),
    alex: id('a5e40000', 7),
    hana: id('a5e40000', 8),
  },
  bakery: {
    intent: id('b0000000', 1),
    purchase: id('b0000000', 2),
    twin: id('b0000000', 3),
    offer: id('b0000000', 4),
    commitment: id('b0000000', 5),
  },
  shelter: {
    intent: id('5e000000', 1),
    mission: id('5e000000', 2),
  },
  /** Two completed past shelter missions: feed analytics and the shortage forecast. */
  history: [
    { mission: id('5e000000', 11), intent: id('5e000000', 12), order: id('5e000000', 13) },
    { mission: id('5e000000', 21), intent: id('5e000000', 22), order: id('5e000000', 23) },
  ],
} as const;

export const SCENARIOS = {
  bakery: 'DEMO-BAKERY-001',
  shelter: 'DEMO-SHELTER-001',
} as const;

export type TenantFixture = { id: string; name: string; kind: TenantKind; timezone: string };

/** Demo trust & preference data. Verification method DEMO_REVIEW: no external registry was queried. */
export const TENANT_PROFILES: Record<
  string,
  {
    verified?: { note: string };
    publicProfile?: { city: string; missionStatement: string; website: string | null };
    preferences?: Record<string, unknown>;
  }
> = {
  [IDS.tenants.shelter]: {
    verified: {
      note: 'Demo review of fictional registration HL-2019-0042. No external registry queried.',
    },
    publicProfile: {
      city: 'Portland, ME',
      missionStatement: 'Emergency overnight shelter and daytime services for adults.',
      website: null,
    },
    preferences: {
      requiredAttributes: ['fragrance-free'],
      prohibitedAttributes: ['fragranced'],
      defaultBudgetMinor: '17500',
      notes: 'Many guests have scent sensitivities. Individually wrapped items only.',
      categories: [],
    },
  },
  [IDS.tenants.northside]: {
    verified: { note: 'Demo review of fictional community fund NCF-2021-0007.' },
    publicProfile: {
      city: 'Portland, ME',
      missionStatement: 'Neighbourhood fund that pays merchants directly for verified local needs.',
      website: null,
    },
    preferences: {
      requiredAttributes: [],
      prohibitedAttributes: [],
      categories: ['hygiene', 'shelter'],
      maxOrderMinor: '12000',
    },
  },
};

export const TENANTS: TenantFixture[] = [
  {
    id: IDS.tenants.bakery,
    name: 'Crumb & Co. Bakery',
    kind: 'BUSINESS',
    timezone: 'America/New_York',
  },
  {
    id: IDS.tenants.shelter,
    name: 'Harbor Light Shelter',
    kind: 'ORG',
    timezone: 'America/New_York',
  },
  {
    id: IDS.tenants.kraftfold,
    name: 'Kraftfold Packaging Co.',
    kind: 'MERCHANT',
    timezone: 'America/New_York',
  },
  {
    id: IDS.tenants.northpack,
    name: 'Northpack Plastics',
    kind: 'MERCHANT',
    timezone: 'America/Chicago',
  },
  {
    id: IDS.tenants.leafLedger,
    name: 'Leaf & Ledger Paper Goods',
    kind: 'MERCHANT',
    timezone: 'America/New_York',
  },
  {
    id: IDS.tenants.cleanStart,
    name: 'CleanStart Supply',
    kind: 'MERCHANT',
    timezone: 'America/New_York',
  },
  {
    id: IDS.tenants.harborGoods,
    name: 'Harbor Goods Co.',
    kind: 'MERCHANT',
    timezone: 'America/New_York',
  },
  {
    id: IDS.tenants.beaconBasics,
    name: 'Beacon Basics Wholesale',
    kind: 'MERCHANT',
    timezone: 'America/New_York',
  },
  {
    id: IDS.tenants.northside,
    name: 'Northside Community Fund',
    kind: 'ORG',
    timezone: 'America/New_York',
  },
];

export type PersonaFixture = Persona & {
  userId: string;
  email: string;
  memberships: Array<{ tenantId: string; role: Role }>;
};

export const PERSONAS: PersonaFixture[] = [
  {
    key: 'maya',
    userId: IDS.users.maya,
    email: 'maya@crumbandco.example',
    displayName: 'Maya Ortiz',
    title: 'Owner',
    tenantName: 'Crumb & Co. Bakery',
    tenantKind: 'BUSINESS',
    roles: ['BUYER'],
    summary: 'Small-business buyer. Protects the packaging purchase with a PromiseTwin.',
    memberships: [{ tenantId: IDS.tenants.bakery, role: 'BUYER' }],
  },
  {
    key: 'jordan',
    userId: IDS.users.jordan,
    email: 'jordan@harborlight.example',
    displayName: 'Jordan Lee',
    title: 'Program Director',
    tenantName: 'Harbor Light Shelter',
    tenantKind: 'ORG',
    roles: ['ORG_ADMIN', 'ORG_OPERATOR'],
    summary:
      'Organization admin. States the need, runs the NeedMesh agents and confirms what arrived.',
    memberships: [
      { tenantId: IDS.tenants.shelter, role: 'ORG_ADMIN' },
      { tenantId: IDS.tenants.shelter, role: 'ORG_OPERATOR' },
    ],
  },
  {
    key: 'priya',
    userId: IDS.users.priya,
    email: 'priya@sponsor.example',
    displayName: 'Priya Shah',
    title: 'Sponsor',
    tenantName: 'Harbor Light Shelter',
    tenantKind: 'ORG',
    roles: ['SPONSOR'],
    summary: 'Sponsor. Reviews each merchant order the agents plan and approves it through PayPal.',
    memberships: [{ tenantId: IDS.tenants.shelter, role: 'SPONSOR' }],
  },
  {
    key: 'sam',
    userId: IDS.users.sam,
    email: 'sam@kraftfold.example',
    displayName: 'Sam Rivera',
    title: 'Merchant administrator',
    tenantName: 'Kraftfold Packaging Co.',
    tenantKind: 'MERCHANT',
    roles: ['MERCHANT_ADMIN'],
    summary: 'Merchant admin. Accepts terms and authorizes eligible remedies (Phase 2+).',
    memberships: [{ tenantId: IDS.tenants.kraftfold, role: 'MERCHANT_ADMIN' }],
  },
  {
    key: 'leo',
    userId: IDS.users.leo,
    email: 'leo@northsidefund.example',
    displayName: 'Leo Martin',
    title: 'Grants lead',
    tenantName: 'Northside Community Fund',
    tenantKind: 'ORG',
    roles: ['SPONSOR'],
    summary:
      'External sponsor. Discovers published missions in Explore, sees match scores and funds individual merchant orders.',
    memberships: [{ tenantId: IDS.tenants.northside, role: 'SPONSOR' }],
  },
  {
    key: 'dana',
    userId: IDS.users.dana,
    email: 'dana@beaconbasics.example',
    displayName: 'Dana Brooks',
    title: 'Sales manager',
    tenantName: 'Beacon Basics Wholesale',
    tenantKind: 'MERCHANT',
    roles: ['MERCHANT_ADMIN'],
    summary:
      'Merchant. Sees matching missions, submits offers, answers counteroffers and confirms, ships or reports stockouts.',
    memberships: [{ tenantId: IDS.tenants.beaconBasics, role: 'MERCHANT_ADMIN' }],
  },
  {
    key: 'alex',
    userId: IDS.users.alex,
    email: 'alex@cleanstart.example',
    displayName: 'Alex Kim',
    title: 'Fulfillment lead',
    tenantName: 'CleanStart Supply',
    tenantKind: 'MERCHANT',
    roles: ['MERCHANT_ADMIN'],
    summary:
      'Merchant. Confirms stock (which triggers the PayPal capture), ships, or reports a stockout that starts AI recovery.',
    memberships: [{ tenantId: IDS.tenants.cleanStart, role: 'MERCHANT_ADMIN' }],
  },
  {
    key: 'hana',
    userId: IDS.users.hana,
    email: 'hana@harborgoods.example',
    displayName: 'Hana Ito',
    title: 'Store manager',
    tenantName: 'Harbor Goods Co.',
    tenantKind: 'MERCHANT',
    roles: ['MERCHANT_ADMIN'],
    summary:
      'Merchant. Picks up replacement orders when the Recovery agent re-plans around a stockout.',
    memberships: [{ tenantId: IDS.tenants.harborGoods, role: 'MERCHANT_ADMIN' }],
  },
];

export type CatalogFixture = {
  id: string;
  sellerTenantId: string;
  sku: string;
  title: string;
  productKind: string;
  attributes: string[];
  unitPriceMinor: bigint;
  inventoryQty: number;
  leadTimeHours: number;
  deliveryTerms: string;
};

export const CATALOG: CatalogFixture[] = [
  {
    id: id('ca000000', 1),
    sellerTenantId: IDS.tenants.kraftfold,
    sku: 'BOX-PAPER-100',
    title: 'Food-safe kraft paper bakery box, 8×8×4 in',
    productKind: 'packaging-box',
    attributes: ['paper', 'kraft', 'food-safe', 'recyclable'],
    unitPriceMinor: 85n,
    inventoryQty: 1200,
    leadTimeHours: 48,
    deliveryTerms: 'Ground delivery, seller confirms the date on acceptance',
  },
  {
    id: id('ca000000', 2),
    sellerTenantId: IDS.tenants.kraftfold,
    sku: 'BOX-PAPER-100-EXP',
    title: 'Food-safe kraft paper bakery box — express dispatch',
    productKind: 'packaging-box',
    attributes: ['paper', 'kraft', 'food-safe', 'recyclable'],
    unitPriceMinor: 89n,
    inventoryQty: 400,
    leadTimeHours: 20,
    deliveryTerms: 'Express next-day dispatch',
  },
  {
    id: id('ca000000', 3),
    sellerTenantId: IDS.tenants.northpack,
    sku: 'CLAM-PET-100',
    title: 'Clear PET clamshell pastry container',
    productKind: 'packaging-box',
    attributes: ['plastic', 'food-safe', 'recyclable'],
    unitPriceMinor: 62n,
    inventoryQty: 5000,
    leadTimeHours: 36,
    deliveryTerms: 'Freight, 1–2 business days',
  },
  {
    id: id('ca000000', 4),
    sellerTenantId: IDS.tenants.leafLedger,
    sku: 'BOX-PAPER-PREM',
    title: 'Premium white paperboard cake box with window',
    productKind: 'packaging-box',
    attributes: ['paper', 'food-safe', 'compostable'],
    unitPriceMinor: 112n,
    inventoryQty: 300,
    leadTimeHours: 30,
    deliveryTerms: 'Ground delivery',
  },
  {
    id: id('ca000000', 5),
    sellerTenantId: IDS.tenants.cleanStart,
    sku: 'KIT-FF-01',
    title: 'Fragrance-free hygiene kit (soap, toothbrush, toothpaste, wipes)',
    productKind: 'hygiene-kit',
    attributes: ['fragrance-free', 'individually-wrapped'],
    unitPriceMinor: 500n,
    inventoryQty: 20,
    leadTimeHours: 40,
    deliveryTerms: 'Local courier',
  },
  {
    id: id('ca000000', 6),
    sellerTenantId: IDS.tenants.harborGoods,
    sku: 'KIT-FF-02',
    title: 'Fragrance-free hygiene kit, travel size',
    productKind: 'hygiene-kit',
    attributes: ['fragrance-free', 'alcohol-free', 'individually-wrapped'],
    unitPriceMinor: 600n,
    inventoryQty: 50,
    leadTimeHours: 52,
    deliveryTerms: 'Ground delivery',
  },
  {
    id: id('ca000000', 7),
    sellerTenantId: IDS.tenants.harborGoods,
    sku: 'KIT-SC-01',
    title: 'Scented hygiene kit, lavender',
    productKind: 'hygiene-kit',
    attributes: ['fragranced', 'individually-wrapped'],
    unitPriceMinor: 400n,
    inventoryQty: 100,
    leadTimeHours: 30,
    deliveryTerms: 'Ground delivery',
  },
  {
    id: id('ca000000', 8),
    sellerTenantId: IDS.tenants.beaconBasics,
    sku: 'KIT-FF-03',
    title: 'Fragrance-free hygiene kit, community pack',
    productKind: 'hygiene-kit',
    attributes: ['fragrance-free', 'alcohol-free', 'individually-wrapped'],
    unitPriceMinor: 550n,
    inventoryQty: 40,
    leadTimeHours: 44,
    deliveryTerms: 'Local courier, next-day on request',
  },
];

/** All times are fictional scenario times in America/New_York, kept separate from the real clock. */
export const BAKERY_TIMELINE = {
  intentConfirmedAt: '2026-11-09T09:12:00-05:00',
  termsAcceptedAt: '2026-11-09T10:05:00-05:00',
  committedDeliverBy: '2026-11-13T17:00:00-05:00',
  etaRevisedAt: '2026-11-11T14:30:00-05:00',
  revisedEta: '2026-11-16T12:00:00-05:00',
  seededClock: '2026-11-11T15:00:00-05:00',
  afterDeadline: '2026-11-14T09:00:00-05:00',
} as const;

export const BAKERY_REQUEST =
  'Find 100 food-safe paper packaging boxes, not plastic, under $100, delivered by Friday 5pm America/New_York.';

export const SHELTER_TIMELINE = {
  intentConfirmedAt: '2026-11-09T08:30:00-05:00',
  seededClock: '2026-11-09T09:00:00-05:00',
} as const;

export const SHELTER_REQUEST =
  'Our shelter needs 30 fragrance-free hygiene kits by Friday at 6 p.m., total budget $175, no fragrances.';

export const SHELTER_PUBLIC_SUMMARY =
  'Overnight shelter restocking guest hygiene kits. Fragrance-free only (scent sensitivities). Delivered to the shelter’s receiving desk; no guest details are shared.';

/** Past missions (fictional, completed). Only aggregate facts are used by analytics and forecasts. */
export const SHELTER_HISTORY = [
  {
    title: '28 fragrance-free hygiene kits (October, week 2)',
    request:
      'Our shelter needs 28 fragrance-free hygiene kits by 2026-10-16 at 6 p.m., total budget $170, no fragrances.',
    at: '2026-10-12T09:00:00-04:00',
    deadline: '2026-10-16T18:00:00-04:00',
    budgetMinor: '17000',
    quantity: 28,
    unitPriceMinor: 550n,
    received: 28,
    deliveredAt: '2026-10-15T15:00:00-04:00',
  },
  {
    title: '30 fragrance-free hygiene kits (October, week 4)',
    request:
      'Our shelter needs 30 fragrance-free hygiene kits by 2026-10-30 at 6 p.m., total budget $175, no fragrances.',
    at: '2026-10-26T09:00:00-04:00',
    deadline: '2026-10-30T18:00:00-04:00',
    budgetMinor: '17500',
    quantity: 30,
    unitPriceMinor: 550n,
    received: 29,
    deliveredAt: '2026-10-29T14:00:00-04:00',
  },
] as const;
