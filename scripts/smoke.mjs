// End-to-end API smoke test against a running backend (default http://localhost:4000).
// Exercises: health, OpenAPI, demo sign-in, CSRF enforcement, intent compile, purchase
// creation, PromiseTwin read models, demo clock advance and reset.
const API = process.env.SMOKE_API_URL ?? 'http://localhost:4000';
const ORIGIN = process.env.SMOKE_ORIGIN ?? 'http://localhost:3000';
const BAKERY_TWIN = 'b0000000-0000-4000-8000-000000000003';

let cookie = '';
let failures = 0;

async function call(method, path, body, { csrf = true } = {}) {
  const headers = { Origin: ORIGIN, Accept: 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrf && method !== 'GET') headers['X-Promesa-Csrf'] = '1';
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
    console.log(`  FAIL ${name}${detail ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ''}`);
  }
}

console.log(`Smoke test against ${API}`);

const live = await call('GET', '/health/live');
check('health/live', live.status === 200, live);
const ready = await call('GET', '/health/ready');
check(
  'health/ready reports database ok',
  ready.status === 200 && ready.json?.database === 'up',
  ready,
);
const openapi = await call('GET', '/openapi.json');
check('openapi.json served', openapi.status === 200 && typeof openapi.json?.paths === 'object');
const paypal = await call('GET', '/v1/integrations/paypal/health');
check(
  'paypal health is honest',
  paypal.status === 200 && typeof paypal.json?.restApi?.status === 'string',
  paypal,
);

const anon = await call('GET', '/v1/me');
check('unauthenticated /v1/me is 401', anon.status === 401, anon);

const noCsrf = await call('POST', '/v1/auth/session', { personaKey: 'maya' }, { csrf: false });
check('unsafe request without CSRF header is rejected', noCsrf.status === 403, noCsrf);

const signIn = await call('POST', '/v1/auth/session', { personaKey: 'maya' });
check('demo sign-in as Maya', signIn.status === 201 || signIn.status === 200, signIn);
const me = await call('GET', '/v1/me');
check('me returns BUYER role', me.status === 200 && me.json?.activeRole === 'BUYER', me);

const reset = await call('POST', '/v1/demo/scenarios/DEMO-BAKERY-001/reset', {});
check('reset bakery scenario', reset.status < 300, reset);

const twin = await call('GET', `/v1/twins/${BAKERY_TWIN}`);
check(
  'bakery twin is AT_RISK',
  twin.status === 200 && twin.json?.health === 'AT_RISK',
  twin.json?.health,
);

for (const sub of ['evidence', 'threads', 'contrast', 'health-breakdown', 'snapshots']) {
  const r = await call('GET', `/v1/twins/${BAKERY_TWIN}/${sub}`);
  check(`twin ${sub}`, r.status === 200, r);
}

const compile = await call('POST', '/v1/intent/compile', {
  rawText:
    'I need 100 food-safe paper boxes delivered before Friday 5 PM EST for under $100. No plastic.',
  buyerType: 'BUSINESS',
  currency: 'USD',
  timezone: 'America/New_York',
});
check(
  'intent compiles completely',
  compile.status === 200 && compile.json?.complete === true,
  compile,
);

if (compile.json?.complete) {
  const created = await call('POST', '/v1/purchases', {
    rawText:
      'I need 100 food-safe paper boxes delivered before Friday 5 PM EST for under $100. No plastic.',
    intent: compile.json.draft,
    confirmed: true,
    compilerVersion: compile.json.compiler.compilerVersion,
  });
  check('purchase created with twin', created.status === 201 && created.json?.twinId, created);
  if (created.json?.purchaseId) {
    const offers = await call('GET', `/v1/purchases/${created.json.purchaseId}/offers`);
    check('purchase offers', offers.status === 200 && Array.isArray(offers.json?.offers), offers);
  }
}

// Open the SSE stream resuming from the tenant's latest outbox sequence, then trigger an event.
const before = await call('GET', '/v1/operations/summary');
const resumeFrom = before.json?.aggregateVersion ?? 0;
const streamAbort = new AbortController();
const streamRes = await fetch(API + '/v1/stream', {
  headers: {
    Cookie: cookie,
    Origin: ORIGIN,
    Accept: 'text/event-stream',
    'Last-Event-ID': String(resumeFrom),
  },
  signal: streamAbort.signal,
});
check('SSE stream opens', streamRes.status === 200, streamRes.status);

const advance = await call('POST', '/v1/demo/scenarios/DEMO-BAKERY-001/clock', {
  checkpoint: 'AFTER_DEADLINE',
});
check('advance clock past deadline', advance.status < 300, advance);

const sseEvents = [];
const reader = streamRes.body.getReader();
const decoder = new TextDecoder();
const deadline = Date.now() + 8000;
let buffer = '';
let inflight = null;
while (Date.now() < deadline && !sseEvents.some((e) => e.aggregateType === 'twin')) {
  // Keep one read in flight across timeouts; abandoning it would drop the chunk it resolves with.
  inflight ??= reader.read();
  const chunk = await Promise.race([inflight, new Promise((r) => setTimeout(() => r(null), 500))]);
  if (chunk === null) continue;
  inflight = null;
  if (chunk.done) break;
  if (chunk.value) buffer += decoder.decode(chunk.value, { stream: true });
  for (const m of buffer.matchAll(/^data: (.+)$/gm)) {
    try {
      sseEvents.push(JSON.parse(m[1]));
    } catch {
      // partial frame; picked up on the next read
    }
  }
}
streamAbort.abort();
check(
  'SSE delivers the twin outbox event after resume',
  sseEvents.some((e) => e.aggregateType === 'twin' && e.seq > resumeFrom),
  sseEvents.map((e) => `${e.seq}:${e.type}`),
);
const breached = await call('GET', `/v1/twins/${BAKERY_TWIN}`);
check('bakery twin becomes BREACHED', breached.json?.health === 'BREACHED', breached.json?.health);

const back = await call('POST', '/v1/demo/scenarios/DEMO-BAKERY-001/clock', {
  checkpoint: 'ETA_REVISED',
});
check('clock cannot move backwards', back.status >= 400, back);

await call('POST', '/v1/demo/scenarios/DEMO-BAKERY-001/reset', {});

const switchRole = await call('POST', '/v1/auth/session', { personaKey: 'sam' });
check('sign in as merchant Sam', switchRole.status < 300, switchRole);
const forbidden = await call('POST', '/v1/purchases', {});
check(
  'merchant cannot create purchase',
  forbidden.status === 403 || forbidden.status === 400,
  forbidden,
);

console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} smoke check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
