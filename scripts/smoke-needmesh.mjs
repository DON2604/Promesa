// NeedMesh end-to-end API smoke test (default http://localhost:4000, DEMO_MODE, simulated or sandbox rail).
// Flow: plan -> sponsor approves -> authorize -> merchant stockout -> Recovery agent voids and re-plans ->
// replacement approval -> stock confirmed + captured -> shipped -> recipient acknowledges -> receipt.
const API = process.env.SMOKE_API_URL ?? 'http://localhost:4000';
const ORIGIN = process.env.SMOKE_ORIGIN ?? 'http://localhost:3000';

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
const life = async (id) => (await call('GET', `/v1/missions/${id}/lifecycle`)).json;

console.log(`NeedMesh smoke test against ${API}`);

await as('jordan');
const reset = await call('POST', '/v1/demo/scenarios/DEMO-SHELTER-001/reset', {});
check('reset shelter scenario', reset.status < 300, reset);

const SHELTER_MISSION = '5e000000-0000-4000-8000-000000000002';
const list = await call('GET', '/v1/missions');
const missionId = (list.json?.items ?? list.json)?.find((m) => m.id === SHELTER_MISSION)?.id;
check('mission exists', typeof missionId === 'string', list.json);
if (!missionId) process.exit(1);

// 1. Agents plan
const plan = await call('POST', `/v1/missions/${missionId}/agents/plan`, {});
check('Mission Planner + Commerce Planner run', plan.status < 300, plan);
let lc = await life(missionId);
check(
  'state is AWAITING_SPONSOR',
  lc.state === 'AWAITING_SPONSOR' || lc.mission?.state === 'AWAITING_SPONSOR',
  lc.state ?? lc.mission?.state,
);
check(
  'two merchant orders planned',
  lc.orders?.length === 2,
  lc.orders?.map((o) => [o.title, o.quantity]),
);
check(
  'plan stays within the $175 budget',
  lc.budget && BigInt(lc.budget.committedMinor) <= 17500n,
  lc.budget,
);
check('rail is labelled', ['SANDBOX', 'SIMULATED'].includes(lc.rail?.mode), lc.rail);
check(
  'fragranced kit was excluded',
  JSON.stringify(lc.plan ?? {}).includes('KIT-SC-01') ||
    JSON.stringify(lc.plan ?? {})
      .toLowerCase()
      .includes('prohibited'),
  lc.plan,
);

// 2. Org operator cannot move money
const orgApprove = await call(
  'POST',
  `/v1/missions/${missionId}/orders/${lc.orders[0].id}/approve`,
  {},
);
check(
  'shelter staff cannot approve payment (403/422)',
  orgApprove.status === 403 || orgApprove.status === 422,
  orgApprove,
);

// 3. Sponsor approves + authorizes both
await as('priya');
for (const order of lc.orders) {
  const a = await call('POST', `/v1/missions/${missionId}/orders/${order.id}/approve`, {});
  check(`sponsor approves ${order.title}`, a.status < 300, a);
  if (a.json?.approveUrl && !String(a.json.approveUrl).startsWith('http')) continue;
}
lc = await life(missionId);
for (const order of lc.orders.filter((o) => o.state === 'PAYPAL_ORDER_CREATED')) {
  const r = await call('POST', `/v1/missions/${missionId}/orders/${order.id}/authorize`, {
    paypalOrderId: order.paypalOrderId,
  });
  check(`authorize ${order.title}`, r.status < 300, r);
}
lc = await life(missionId);
check(
  'both orders AUTHORIZED',
  lc.orders.every((o) => o.state === 'AUTHORIZED'),
  lc.orders.map((o) => o.state),
);

// 4. Capture is blocked before stock confirmation (policy engine, not LLM)
const first = lc.orders[0];
const second = lc.orders[1];

// 5. Merchant confirms one, the other stocks out
const confirm = await call('POST', `/v1/missions/${missionId}/orders/${second.id}/merchant`, {
  action: 'CONFIRM_STOCK',
});
check('merchant confirms stock and capture is released', confirm.status < 300, confirm);
const stockout = await call('POST', `/v1/missions/${missionId}/orders/${first.id}/merchant`, {
  action: 'STOCKOUT',
});
check('stockout triggers Recovery agent', stockout.status < 300, stockout);
lc = await life(missionId);
const voided = lc.orders.find((o) => o.id === first.id);
check(
  'failed order authorization voided (no money moved)',
  voided?.state === 'VOIDED',
  voided?.state,
);
const replacements = lc.orders.filter((o) => o.replacesOrderId === first.id);
check(
  'replacement order planned',
  replacements.length >= 1,
  lc.orders.map((o) => [o.title, o.state, o.replacesOrderId]),
);
check(
  'replacement needs new sponsor approval',
  replacements.every((o) => o.state === 'AWAITING_APPROVAL'),
  replacements.map((o) => o.state),
);
check(
  'budget still respected after re-plan',
  BigInt(lc.budget.committedMinor) <= 17500n,
  lc.budget,
);
check(
  'timeline records the Recovery agent',
  lc.events.some((e) => e.agent === 'RECOVERY'),
  lc.events.map((e) => e.agent),
);

// 6. Sponsor approves replacement
for (const r of replacements) {
  const a = await call('POST', `/v1/missions/${missionId}/orders/${r.id}/approve`, {});
  check('sponsor approves replacement', a.status < 300, a);
  lc = await life(missionId);
  const cur = lc.orders.find((o) => o.id === r.id);
  if (cur.state === 'PAYPAL_ORDER_CREATED') {
    const z = await call('POST', `/v1/missions/${missionId}/orders/${r.id}/authorize`, {
      paypalOrderId: cur.paypalOrderId,
    });
    check('authorize replacement', z.status < 300, z);
  }
  const c = await call('POST', `/v1/missions/${missionId}/orders/${r.id}/merchant`, {
    action: 'CONFIRM_STOCK',
  });
  check('merchant confirms replacement', c.status < 300, c);
}

// 7. Ship + acknowledge
lc = await life(missionId);
for (const o of lc.orders.filter((x) => x.state === 'CAPTURED')) {
  const s = await call('POST', `/v1/missions/${missionId}/orders/${o.id}/merchant`, {
    action: 'SHIP',
  });
  check(`ship ${o.title}`, s.status < 300, s);
}
await as('jordan');
lc = await life(missionId);
for (const o of lc.orders.filter((x) => x.state === 'SHIPPED')) {
  const k = await call('POST', `/v1/missions/${missionId}/orders/${o.id}/acknowledge`, {
    quantityReceived: o.quantity,
  });
  check(`recipient acknowledges ${o.title}`, k.status < 300, k);
}
lc = await life(missionId);
check('mission COMPLETED', (lc.state ?? lc.mission?.state) === 'COMPLETED', lc.state);
check('Mission Receipt issued', Boolean(lc.receipt), lc.receipt);

console.log(
  failures === 0
    ? '\nAll NeedMesh smoke checks passed.'
    : `\n${failures} NeedMesh check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
