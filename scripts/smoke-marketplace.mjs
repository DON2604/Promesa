// NeedMesh marketplace smoke test: public discovery -> merchant offer -> org counter -> merchant accepts
// -> planner uses negotiated price -> two sponsors from different organizations fund separate orders
// -> merchant user confirms its own order -> analytics, forecast, notifications, repeat mission.
const API = process.env.SMOKE_API_URL ?? 'http://localhost:4000';
const ORIGIN = process.env.SMOKE_ORIGIN ?? 'http://localhost:3000';
const MISSION = '5e000000-0000-4000-8000-000000000002';
const BEACON_KIT = 'ca000000-0000-4000-8000-000000000008';

let cookie = '';
let failures = 0;

async function call(method, path, body) {
  const headers = { Origin: ORIGIN, Accept: 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-Promesa-Csrf'] = '1';
  const res = await fetch(API + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

function check(name, cond, detail) {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(
      `  FAIL ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail).slice(0, 600)}`}`,
    );
  }
}

const as = async (personaKey) => {
  const r = await call('POST', '/v1/auth/session', { personaKey });
  if (r.status >= 300) throw new Error(`sign-in ${personaKey} failed: ${JSON.stringify(r.json)}`);
};
const life = async () => (await call('GET', `/v1/missions/${MISSION}/lifecycle`)).json;

console.log(`NeedMesh marketplace smoke test against ${API}`);

await as('jordan');
const reset = await call('POST', '/v1/demo/scenarios/DEMO-SHELTER-001/reset', {});
check('reset shelter scenario', reset.status < 300, reset);

// 1. Public discovery, signed out
cookie = '';
const pub = await call('GET', '/v1/marketplace/missions');
const card = pub.json?.missions?.find((m) => m.id === MISSION);
check('published shelter mission is publicly discoverable', Boolean(card), pub.json);
check('organization shown as verified', card?.orgVerified === true, card);
check(
  'public card never carries raw request text or addresses',
  card && !('rawText' in card) && !JSON.stringify(card).match(/address|beneficiar/i),
  card,
);
const filtered = await call('GET', '/v1/marketplace/missions?category=education');
check('category filter excludes it', !filtered.json?.missions?.some((m) => m.id === MISSION));

// 2. External sponsor sees a match score
await as('leo');
const leoView = await call('GET', '/v1/marketplace/missions');
const leoCard = leoView.json?.missions?.find((m) => m.id === MISSION);
check('sponsor gets an explained match score', leoCard?.match?.score > 0, leoCard?.match);

// 3. Merchant offer
await as('dana');
const ws = await call('GET', '/v1/merchant/workspace');
check(
  'merchant workspace lists the mission as an opportunity',
  ws.json?.opportunities?.some((o) => o.id === MISSION),
  ws.json,
);
const offer = await call('POST', `/v1/missions/${MISSION}/proposals`, {
  catalogProductId: BEACON_KIT,
  quantity: 30,
  unitPriceMinor: '600',
  leadTimeHours: 40,
  deliveryTerms: 'Local courier, next-day',
});
check('merchant submits an offer', offer.status === 201, offer);
check(
  'Negotiation agent recommends a counter',
  offer.json?.recommendation === 'COUNTER',
  offer.json,
);
const wrong = await call('POST', `/v1/missions/${MISSION}/proposals`, {
  catalogProductId: 'ca000000-0000-4000-8000-000000000005',
  quantity: 10,
  unitPriceMinor: '400',
  leadTimeHours: 40,
  deliveryTerms: 'Courier',
});
check('merchant cannot offer another merchant’s listing', wrong.status === 422, wrong);

// 4. Org counters, merchant accepts
await as('jordan');
let lc = await life();
const proposal = lc.proposals?.[0];
check(
  'org sees the offer with counter allowed',
  proposal?.allowedActions?.includes('ORG_COUNTER'),
  proposal,
);
const counter = await call('POST', `/v1/proposals/${proposal.id}/decision`, {
  action: 'ORG_COUNTER',
  counterUnitPriceMinor: '520',
});
check('org sends a counteroffer', counter.status < 300, counter);
await as('dana');
const accept = await call('POST', `/v1/proposals/${proposal.id}/decision`, {
  action: 'MERCHANT_ACCEPT',
});
check('merchant explicitly accepts the counter', accept.status < 300, accept);

// 5. Planner uses the agreed price
await as('jordan');
const plan = await call('POST', `/v1/missions/${MISSION}/agents/plan`, {});
check('agents plan', plan.status < 300, plan);
lc = await life();
const beacon = lc.orders?.find((o) => o.sku === 'KIT-FF-03');
check('negotiated order uses $5.20/unit', beacon?.unitPriceMinor === '520', beacon);
check(
  'order links to the accepted proposal',
  beacon?.negotiated?.proposalId === proposal.id,
  beacon?.negotiated,
);
check('agent run trace recorded', lc.agentRuns?.[0]?.nodes?.length >= 5, lc.agentRuns);
check(
  'Channel3 honestly reported',
  lc.discoverySources?.some((s) => s.name.includes('Channel3')),
  lc.discoverySources,
);
check(
  'supply constellation has compatible and excluded nodes',
  lc.supply?.some((s) => s.compatible) && lc.supply?.some((s) => !s.compatible),
  lc.supply,
);
check(
  'every order carries PromiseTwin protection',
  lc.orders?.every((o) => o.protection?.tracks?.length === 4),
  lc.orders?.[0]?.protection,
);
const cleanStart = lc.orders?.find((o) => o.sku === 'KIT-FF-01');

// 6. Two sponsors from different organizations fund different orders
await as('leo');
const leoApprove = await call('POST', `/v1/missions/${MISSION}/orders/${beacon.id}/approve`, {});
check('external sponsor funds the Beacon order', leoApprove.status < 300, leoApprove);
await as('priya');
const priyaApprove = await call(
  'POST',
  `/v1/missions/${MISSION}/orders/${cleanStart.id}/approve`,
  {},
);
check('shelter sponsor funds the CleanStart order', priyaApprove.status < 300, priyaApprove);
lc = await life();
for (const o of lc.orders.filter((x) => x.state === 'PAYPAL_ORDER_CREATED')) {
  const r = await call('POST', `/v1/missions/${MISSION}/orders/${o.id}/authorize`, {
    paypalOrderId: o.paypal.orderId,
  });
  check(`authorize ${o.sku}`, r.status < 300, r);
}
lc = await life();
check('two distinct sponsors recorded', lc.sponsors?.length === 2, lc.sponsors);
check(
  'fundedBy names the external fund',
  lc.orders.find((o) => o.id === beacon.id)?.fundedBy?.sponsorOrg === 'Northside Community Fund',
  lc.orders.find((o) => o.id === beacon.id)?.fundedBy,
);

// 7. Merchant user acts only on its own order
await as('dana');
const own = await call('POST', `/v1/missions/${MISSION}/orders/${beacon.id}/merchant`, {
  action: 'CONFIRM_STOCK',
});
check('merchant confirms its own order (capture released)', own.status < 300, own);
const other = await call('POST', `/v1/missions/${MISSION}/orders/${cleanStart.id}/merchant`, {
  action: 'CONFIRM_STOCK',
});
check('merchant cannot act on another merchant’s order', other.status === 403, other);

// 8. Outcomes
await as('jordan');
lc = await life();
check(
  'atlas separates funded, purchased and received',
  lc.atlas?.funded === 30 && lc.atlas?.purchased === beacon.quantity && lc.atlas?.received === 0,
  lc.atlas,
);
const analytics = await call('GET', '/v1/analytics');
check(
  'analytics include history missions',
  analytics.json?.missions?.completed >= 2,
  analytics.json?.missions,
);
const forecast = await call('GET', '/v1/forecast');
check(
  'shortage forecast projects a 14-day cycle',
  forecast.json?.items?.[0]?.averageIntervalDays === 14,
  forecast.json,
);
const notes = await call('GET', '/v1/notifications');
check(
  'notifications return activity',
  Array.isArray(notes.json?.activity) && notes.json.activity.length > 0,
  notes.json,
);
const profile = await call('GET', '/v1/org/profile');
check(
  'org profile shows DEMO_REVIEW verification',
  profile.json?.verification?.method === 'DEMO_REVIEW',
  profile.json,
);
const repeat = await call('POST', `/v1/missions/${MISSION}/repeat`, {});
check(
  'repeat mission created',
  repeat.status === 201 && typeof repeat.json?.missionId === 'string',
  repeat,
);

console.log(
  failures === 0
    ? '\nAll marketplace smoke checks passed.'
    : `\n${failures} marketplace check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
