#!/usr/bin/env node
/**
 * Records the NeedMesh two-browser demo on the real PayPal Sandbox.
 *
 * Two isolated browser contexts (Browser 1: the shelter, Browser 2: sponsor and merchants) are
 * driven through the shelter mission. Frames come from the CDP screencast (sharper than Playwright's
 * built-in video), and every scene is voiced with a neural TTS line that is written from the live
 * mission state, so the narrated figures match the screen. `build-demo.mjs` turns the result into
 * a YouTube-ready MP4.
 *
 *   $env:PAYPAL_BUYER_EMAIL = 'sb-...@personal.example.com'
 *   $env:PAYPAL_BUYER_PASSWORD = '...'
 *   node scripts/video/record-demo.mjs        # UNTIL=<scene id> stops early for a dry run
 */
/* global window, document -- used inside page.evaluate callbacks, which run in the browser */
import { chromium } from 'playwright-core';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:4000';
const MISSION = '5e000000-0000-4000-8000-000000000002';
const PASSWORD = process.env.DEMO_ACCOUNT_PASSWORD ?? 'needmesh-sandbox';
const BUYER_EMAIL = process.env.PAYPAL_BUYER_EMAIL;
const BUYER_PASSWORD = process.env.PAYPAL_BUYER_PASSWORD;
const VOICE = process.env.VOICE ?? 'en-US-AndrewMultilingualNeural';
const UNTIL = process.env.UNTIL;
const WORK = join(process.cwd(), 'out', 'video', 'work');
const VIEWPORT = { width: 1600, height: 900 };

const now = () => Date.now() / 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (minor) => {
  const n = Number(minor) / 100;
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
};
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ---------------------------------------------------------------- capture */

class Recorder {
  constructor(name, page) {
    this.name = name;
    this.page = page;
    this.dir = join(WORK, 'frames', name);
    mkdirSync(this.dir, { recursive: true });
    this.frames = [];
    this.n = 0;
    this.active = false;
    this.last = null;
  }

  async start() {
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
      this.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      const t = now();
      this.last = data;
      if (this.active) this.save(data, t);
    });
    await this.screencast();
    this.page.on('framenavigated', (f) => {
      if (f === this.page.mainFrame()) this.screencast().catch(() => {});
    });
  }

  screencast() {
    return this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 90,
      maxWidth: 1920,
      maxHeight: 1080,
      everyNthFrame: 1,
    });
  }

  save(data, t) {
    const f = join(this.dir, `${String(this.n++).padStart(6, '0')}.jpg`);
    writeFileSync(f, Buffer.from(data, 'base64'));
    this.frames.push({ f, t });
  }

  begin(t) {
    this.active = true;
    if (this.last) this.save(this.last, t);
  }

  end() {
    this.active = false;
  }
}

/* ---------------------------------------------------------------- narration */

const SAY = [
  [/NeedMesh/g, 'Need Mesh'],
  [/\bMCP\b/g, 'M C P'],
];

function tts(id, text) {
  const file = join(WORK, 'audio', `${id}.mp3`);
  let spoken = text;
  for (const [re, to] of SAY) spoken = spoken.replace(re, to);
  for (let attempt = 1; attempt <= 5; attempt++) {
    const r = spawnSync(
      'python',
      [
        '-m',
        'edge_tts',
        '--voice',
        VOICE,
        '--rate',
        '+2%',
        '--text',
        spoken,
        '--write-media',
        file,
      ],
      { encoding: 'utf8' },
    );
    if (r.status === 0) break;
    if (attempt === 5) throw new Error(`TTS failed for ${id}: ${r.stderr}`);
    log(`voice retry ${attempt} for ${id}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2500 * attempt);
  }
  const dur = Number(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      file,
    ])
      .toString()
      .trim(),
  );
  return { file, dur };
}

/* ---------------------------------------------------------------- browser helpers */

const CURSOR_JS = `(() => {
  if (window.top !== window) return;
  const get = (k, d) => Number(sessionStorage.getItem(k) ?? d);
  const install = () => {
    if (document.getElementById('__demo_cursor')) return;
    const hide = document.createElement('style');
    hide.textContent = 'nextjs-portal{display:none!important}';
    document.head?.appendChild(hide);
    const c = document.createElement('div');
    c.id = '__demo_cursor';
    Object.assign(c.style, {
      position: 'fixed', left: '0', top: '0', width: '24px', height: '24px',
      marginLeft: '-12px', marginTop: '-12px', borderRadius: '50%',
      background: 'rgba(37, 99, 235, 0.28)', border: '2px solid rgba(255,255,255,0.95)',
      boxShadow: '0 2px 12px rgba(0,0,0,0.35)', zIndex: '2147483647', pointerEvents: 'none',
      transition: 'transform 0.75s cubic-bezier(.22,.8,.3,1)',
      transform: 'translate(' + get('__cx', innerWidth * 0.62) + 'px,' + get('__cy', innerHeight * 0.7) + 'px)',
    });
    document.documentElement.appendChild(c);
  };
  window.__demoMove = (x, y) => {
    install();
    sessionStorage.setItem('__cx', x); sessionStorage.setItem('__cy', y);
    document.getElementById('__demo_cursor').style.transform = 'translate(' + x + 'px,' + y + 'px)';
  };
  window.__demoClick = () => {
    const r = document.createElement('div');
    const x = get('__cx', 0), y = get('__cy', 0);
    Object.assign(r.style, {
      position: 'fixed', left: x + 'px', top: y + 'px', width: '16px', height: '16px',
      marginLeft: '-8px', marginTop: '-8px', borderRadius: '50%', border: '3px solid #2563eb',
      zIndex: '2147483646', pointerEvents: 'none', transition: 'all 0.55s ease-out', opacity: '1',
    });
    document.documentElement.appendChild(r);
    requestAnimationFrame(() => requestAnimationFrame(() => Object.assign(r.style, {
      width: '60px', height: '60px', marginLeft: '-30px', marginTop: '-30px', opacity: '0',
    })));
    setTimeout(() => r.remove(), 700);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();`;

async function pointAt(page, locator) {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.evaluate(
    ([x, y]) => window.__demoMove?.(x, y),
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  await page.waitForTimeout(800);
}

async function click(page, locator, { after = 300 } = {}) {
  await locator.waitFor({ state: 'visible', timeout: 45_000 });
  await locator.scrollIntoViewIfNeeded();
  await pointAt(page, locator);
  await page.evaluate(() => window.__demoClick?.()).catch(() => {});
  await locator.click();
  await page.waitForTimeout(after);
}

async function type(page, locator, text, delay = 40) {
  await click(page, locator, { after: 150 });
  await locator.fill('');
  await locator.pressSequentially(text, { delay });
}

async function scrollTo(page, locator, block = 'center') {
  await locator.first().waitFor({ state: 'attached', timeout: 30_000 });
  await locator
    .first()
    .evaluate((el, b) => el.scrollIntoView({ behavior: 'smooth', block: b }), block);
  await page.waitForTimeout(1200);
}

/** Scrolls an element to the top of the viewport, just below the sticky workspace header. */
async function reveal(page, locator, offset = 84) {
  await locator.first().waitFor({ state: 'attached', timeout: 30_000 });
  await locator.first().evaluate((el, off) => {
    window.scrollTo({
      top: el.getBoundingClientRect().top + window.scrollY - off,
      behavior: 'smooth',
    });
  }, offset);
  await page.waitForTimeout(1200);
}

const stage = (page) => page.locator('.ai-stage').first();

async function openMission(page) {
  await page.goto(`${WEB}/missions/${MISSION}`);
  await stage(page).waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(1500);
}

async function signIn(page, key, { slow = true, next = `/missions/${MISSION}` } = {}) {
  await page.context().clearCookies();
  await page.goto(`${WEB}/sign-in?persona=${key}&next=${encodeURIComponent(next)}`);
  await page.waitForFunction(() => document.querySelector('#email')?.value?.includes('@'), null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(slow ? 900 : 100);
  await type(page, page.locator('#password'), PASSWORD, slow ? 55 : 0);
  await click(page, page.getByRole('button', { name: 'Sign in' }));
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 30_000 });
  if (next.startsWith('/missions/') && next !== '/missions/new') {
    await stage(page).waitFor({ state: 'visible', timeout: 60_000 });
  }
  await page.waitForTimeout(1200);
}

function orderCard(page, order) {
  let cards = page.locator('article').filter({ hasText: order.merchantName });
  cards = order.replacesOrderId
    ? cards.filter({ hasText: 'Replacement for a failed order' })
    : cards.filter({ hasNotText: 'Replacement for a failed order' });
  return cards.first();
}

/** Drives PayPal's Sandbox checkout until it redirects back to NeedMesh. */
async function paypalApprove(page) {
  if (!BUYER_EMAIL || !BUYER_PASSWORD)
    throw new Error('Set PAYPAL_BUYER_EMAIL and PAYPAL_BUYER_PASSWORD (Sandbox personal account).');
  const deadline = Date.now() + 180_000;
  const visible = async (sel) =>
    page
      .locator(sel)
      .first()
      .isVisible()
      .catch(() => false);
  while (Date.now() < deadline) {
    if (page.url().startsWith(WEB)) return;
    try {
      if (await visible('#acceptAllButton')) {
        await click(page, page.locator('#acceptAllButton').first());
        continue;
      }
      if (await visible('#email')) {
        const email = page.locator('#email').first();
        if ((await email.inputValue()) !== BUYER_EMAIL) await type(page, email, BUYER_EMAIL, 25);
        if (await visible('#btnNext')) {
          await click(page, page.locator('#btnNext').first(), { after: 2000 });
          continue;
        }
      }
      if (await visible('#password')) {
        const pw = page.locator('#password').first();
        if (!(await pw.inputValue())) await type(page, pw, BUYER_PASSWORD, 25);
        if (await visible('#btnLogin')) {
          await click(page, page.locator('#btnLogin').first(), { after: 3000 });
          continue;
        }
      }
      for (const sel of [
        '#payment-submit-btn',
        '[data-testid="submit-button-initial"]',
        'button:has-text("Complete Purchase")',
        'button:has-text("Pay Now")',
        'button:has-text("Continue to Review Order")',
        'button:has-text("Agree & Continue")',
        'button:has-text("Continue")',
      ]) {
        if (await visible(sel)) {
          await click(page, page.locator(sel).first(), { after: 3000 });
          break;
        }
      }
    } catch (error) {
      log('paypal step retry:', error instanceof Error ? error.message.split('\n')[0] : error);
    }
    await page.waitForTimeout(900);
  }
  await page.screenshot({ path: join(WORK, 'paypal-timeout.png') });
  throw new Error(`PayPal approval did not return to NeedMesh (last URL ${page.url()})`);
}

/* ---------------------------------------------------------------- cards */

function card({ kicker, title, body, foot }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:radial-gradient(1200px 700px at 20% 10%,#1e3a8a 0%,#0b1020 55%,#05070f 100%);color:#f8fafc;font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden}
  .wrap{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 120px}
  .k{font:600 18px/1 'Cascadia Mono',Consolas,monospace;letter-spacing:.22em;text-transform:uppercase;color:#93c5fd;opacity:0;animation:in .8s .1s forwards}
  h1{font-size:76px;line-height:1.05;margin:22px 0 0;font-weight:700;letter-spacing:-.02em;opacity:0;animation:in .9s .35s forwards}
  h1 em{font-style:normal;background:linear-gradient(90deg,#60a5fa,#a78bfa 50%,#fbbf24);-webkit-background-clip:text;background-clip:text;color:transparent}
  p{font-size:30px;line-height:1.45;color:#cbd5e1;max-width:1150px;margin:28px 0 0;opacity:0;animation:in .9s .8s forwards}
  .f{position:absolute;left:120px;bottom:70px;display:flex;gap:14px;opacity:0;animation:in .9s 1.3s forwards}
  .f span{border:1px solid rgba(148,163,184,.35);border-radius:999px;padding:10px 18px;font-size:19px;color:#e2e8f0;background:rgba(15,23,42,.55)}
  .orb{position:absolute;right:-140px;top:-120px;width:620px;height:620px;border-radius:50%;background:conic-gradient(from 0deg,#2563eb33,#7c3aed44,#f59e0b33,#2563eb33);filter:blur(40px);animation:spin 18s linear infinite}
  @keyframes in{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
  @keyframes spin{to{transform:rotate(360deg)}}
  </style></head><body><div class="orb"></div><div class="wrap">
  <div class="k">${kicker}</div><h1>${title}</h1>${body ? `<p>${body}</p>` : ''}
  </div>${foot ? `<div class="f">${foot.map((t) => `<span>${t}</span>`).join('')}</div>` : ''}</body></html>`;
}

/* ---------------------------------------------------------------- main */

async function main() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(join(WORK, 'audio'), { recursive: true });

  log('reseeding the shelter mission');
  const seed = spawnSync('npm run demo:seed', { shell: true, encoding: 'utf8' });
  if (seed.status !== 0) throw new Error(`demo:seed failed:\n${seed.stdout}\n${seed.stderr}`);

  const personas = (await (await fetch(`${API}/v1/auth/personas`)).json()).personas;
  const who = (key) => personas.find((p) => p.key === key);
  const label = (n, key, role) => {
    const p = who(key);
    return `Browser ${n} · ${p.displayName} · ${role} · ${p.tenantName}`;
  };

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const version = browser.version();
  const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36 Edg/${version}`;
  const newContext = async () => {
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1.2,
      userAgent,
      locale: 'en-US',
      colorScheme: 'light',
    });
    await ctx.addInitScript(CURSOR_JS);
    return ctx;
  };
  const ctxA = await newContext();
  const ctxB = await newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const recA = new Recorder('A', pageA);
  const recB = new Recorder('B', pageB);
  await recA.start();
  await recB.start();

  const lifecycle = async (ctx = ctxA) => {
    const res = await ctx.request.get(`${API}/v1/missions/${MISSION}/lifecycle`);
    if (!res.ok()) throw new Error(`lifecycle ${res.status()}`);
    return res.json();
  };
  const waitFor = async (what, pred, timeout = 90_000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const lc = await lifecycle().catch(() => null);
      if (lc && pred(lc)) return lc;
      await sleep(700);
    }
    throw new Error(`Timed out waiting for ${what}`);
  };

  const scenes = [];
  const manifest = () =>
    writeFileSync(
      join(WORK, 'manifest.json'),
      JSON.stringify({ scenes, frames: { A: recA.frames, B: recB.frames } }, null, 1),
    );

  let labelA = '';
  let labelB = '';
  async function scene(id, opts, action) {
    const text = typeof opts.say === 'function' ? await opts.say() : opts.say;
    const audio = tts(id, text);
    const view = opts.view;
    const recs = view === 'split' ? [recA, recB] : [view === 'A' ? recA : recB];
    const start = now();
    for (const r of recs) r.begin(start);
    log(`scene ${id} (${view}, ${audio.dur.toFixed(1)}s voice)`);
    await action?.();
    const minEnd = start + audio.dur + (opts.tail ?? 0.8);
    if (now() < minEnd) await sleep((minEnd - now()) * 1000);
    const end = now();
    for (const r of recs) r.end();
    scenes.push({
      id,
      view,
      text,
      audio: audio.file,
      audioDur: audio.dur,
      start,
      end,
      speed: Boolean(opts.speed),
      maxSpeed: opts.maxSpeed,
      labelA,
      labelB,
      card: Boolean(opts.card),
    });
    manifest();
    if (UNTIL === id) throw Object.assign(new Error('stop'), { stop: true });
  }

  try {
    /* ---- intro cards */
    await pageA.setContent(
      card({
        kicker: 'PayPal AI Hackathon · NeedMesh',
        title:
          'When a community needs supplies,<br><em>money should only move for real goods.</em>',
        body: 'AI agents find the sellers and plan the order. PayPal holds the money until the goods are real. And if a supplier fails, the AI recovers.',
        foot: [
          'Live on PayPal Sandbox',
          'PayPal MCP',
          'Google Gemini',
          'Requester · Sponsor · Merchant',
        ],
      }),
    );
    await scene('intro', {
      view: 'A',
      card: true,
      say: 'When a shelter needs supplies, donors send money and hope. If a supplier fails, that money is gone. NeedMesh fixes this: AI agents plan the purchase, and PayPal holds the money until the goods are real.',
    });

    /* ---- Jordan (requester): sign in and describe the need */
    labelA = label(1, 'jordan', 'Requester');
    await signIn(pageA, 'jordan', { slow: false, next: '/missions/new' });
    await pageA.locator('textarea').first().waitFor({ timeout: 30_000 });

    await scene(
      'studio',
      {
        view: 'A',
        speed: true,
        maxSpeed: 2.5,
        say: 'Jordan runs a shelter, and she is the one making the request. She types the need in plain words, and the AI turns it into a mission, linking every rule to the words it came from.',
      },
      async () => {
        await type(
          pageA,
          pageA.locator('textarea').first(),
          'We need 30 fragrance-free hygiene kits for the Harbor Light shelter by Friday at 5pm. Keep it under $175 total.',
          22,
        );
        await click(pageA, pageA.getByRole('button', { name: /Compile intent/ }));
        const where = pageA.getByText('Where each constraint came from');
        await where.waitFor({ timeout: 30_000 });
        await scrollTo(pageA, where, 'start');
        await pageA.waitForTimeout(2500);
        await scrollTo(pageA, pageA.getByText('Step 3 · Confirm'), 'center');
      },
    );

    /* ---- The mission and the AI Command Center */
    await openMission(pageA);
    await reveal(pageA, stage(pageA));
    await scene(
      'plan',
      {
        view: 'A',
        speed: true,
        say: 'This is the AI Command Center. Jordan runs the agents: the planner reads the mission, matching drops a scented kit that breaks a rule, and the policy engine checks every dollar.',
      },
      async () => {
        await click(pageA, pageA.getByRole('button', { name: 'Run NeedMesh agents' }), {
          after: 200,
        });
        await waitFor('the plan', (lc) => lc.orders.length > 0);
      },
    );

    let lc = await lifecycle();
    const first = lc.orders;
    const describe = (orders) =>
      orders.map((o) => `${o.quantity} kits from ${o.merchantName}`).join(', and ');
    const total = first.reduce((a, o) => a + Number(o.amountMinor), 0);
    await scene(
      'plan-result',
      {
        view: 'A',
        say: () =>
          `The plan: ${describe(first)}, ${money(total)} in total. Gemini explains it, and every figure is checked against the planner's math. Each merchant gets its own PayPal order.`,
      },
      async () => {
        await reveal(pageA, pageA.getByText(/Agent plan · round/), 110);
        await pageA.waitForTimeout(4500);
        await reveal(pageA, pageA.locator('#orders'), 120);
      },
    );

    /* ---- Priya: second browser, funds through PayPal */
    await reveal(pageA, stage(pageA));
    await pageB.goto(
      `${WEB}/sign-in?persona=priya&next=${encodeURIComponent(`/missions/${MISSION}`)}`,
    );
    await pageB.waitForFunction(() => document.querySelector('#email')?.value?.includes('@'));
    labelB = label(2, 'priya', 'Sponsor');
    await scene(
      'priya-signin',
      {
        view: 'split',
        speed: true,
        say: 'In a second browser, Priya, the sponsor, signs in on her own. Both screens show two people live on the same mission.',
      },
      async () => {
        await type(pageB, pageB.locator('#password'), PASSWORD, 40);
        await click(pageB, pageB.getByRole('button', { name: 'Sign in' }));
        await stage(pageB).waitFor({ state: 'visible', timeout: 60_000 });
        await pageB.waitForTimeout(3000);
      },
    );

    const [o1] = first;
    /** In-app approval authorizes immediately. A PayPal redirect is completed only when it happens. */
    const authorize = async (order) => {
      await scrollTo(pageB, orderCard(pageB, order), 'center');
      await click(
        pageB,
        orderCard(pageB, order).getByRole('button', { name: /Approve & authorize in PayPal/ }),
      );
      const authorized = (l) => l.orders.some((o) => o.id === order.id && o.state === 'AUTHORIZED');
      const where = await Promise.race([
        pageB
          .waitForURL(/paypal\.com/, { timeout: 25_000 })
          .then(() => 'paypal')
          .catch(() => 'miss'),
        waitFor(`authorization of ${order.merchantName}`, authorized, 25_000)
          .then(() => 'app')
          .catch(() => 'miss'),
      ]);
      if (where === 'miss' && !authorized(await lifecycle()))
        throw new Error(`${order.merchantName} was neither authorized nor sent to PayPal`);
      if (where === 'paypal') {
        await paypalApprove(pageB);
        await waitFor(`authorization of ${order.merchantName}`, authorized);
        await stage(pageB).waitFor({ state: 'visible', timeout: 60_000 });
      }
      await scrollTo(pageB, orderCard(pageB, order), 'center');
      await pageB.waitForTimeout(1800);
    };
    await scene(
      'fund',
      {
        view: 'B',
        speed: true,
        maxSpeed: 6,
        say: 'Priya is the one accepting the payment request. She approves each merchant order. The money is authorized and held, and nobody has been charged yet.',
      },
      async () => {
        for (const order of first) await authorize(order);
      },
    );

    await scene(
      'authorized',
      {
        view: 'split',
        say: "On Jordan's screen, the PayPal order and authorization IDs arrive live.",
        tail: 0.4,
      },
      async () => {
        await scrollTo(pageA, orderCard(pageA, o1), 'center');
        await scrollTo(pageB, orderCard(pageB, o1), 'center');
      },
    );

    /* ---- Merchant: stockout and AI recovery */
    const keyFor = (merchantName) => personas.find((p) => p.tenantName === merchantName)?.key;
    const failing = o1;
    const failingKey = keyFor(failing.merchantName);
    await signIn(pageB, failingKey, { slow: false });
    labelB = label(2, failingKey, 'Merchant · accepts orders');
    await scrollTo(pageB, orderCard(pageB, failing), 'center');
    await scene('merchant', {
      view: 'B',
      say: `Now the other side: the merchant who accepts the request. ${who(failingKey).displayName} at ${failing.merchantName} can confirm stock, or report a problem. Today, he has run out.`,
      tail: 0.4,
    });

    await reveal(pageA, stage(pageA));
    await scene(
      'stockout',
      {
        view: 'split',
        speed: true,
        say: 'The Recovery agent reads the payment state, releases the hold so Priya is never charged, and re-plans the missing kits. Gemini explains what changed, live on both screens.',
      },
      async () => {
        await click(
          pageB,
          orderCard(pageB, failing).getByRole('button', { name: 'Report stockout' }),
        );
        await waitFor('recovery', (l) =>
          l.orders.some((o) => o.id === failing.id && o.state === 'VOIDED'),
        );
        await pageB.waitForTimeout(1500);
        await reveal(pageB, stage(pageB));
      },
    );

    lc = await waitFor(
      'replacement order',
      (l) => l.orders.some((o) => o.replacesOrderId),
      30_000,
    ).catch(() => lifecycle());
    const replacement = lc.orders.find((o) => o.replacesOrderId);
    await scene(
      'replan',
      {
        view: 'A',
        say: () =>
          replacement
            ? `${money(failing.amountMinor)} released, never charged. The replacement, ${replacement.quantity} kits from ${replacement.merchantName}, needs a fresh yes from the sponsor.`
            : `The ${failing.merchantName} order is voided: ${money(failing.amountMinor)} released, never charged.`,
      },
      async () => {
        await reveal(pageA, pageA.locator('#orders'), 120);
        await pageA.waitForTimeout(1200);
        if (replacement) await scrollTo(pageA, orderCard(pageA, replacement), 'center');
      },
    );

    if (replacement) {
      labelB = label(2, 'priya', 'Sponsor');
      await scene(
        'approve-3',
        {
          view: 'B',
          speed: true,
          maxSpeed: 6,
          say: 'Priya approves the replacement. Nothing moves without a person saying yes.',
        },
        async () => {
          await signIn(pageB, 'priya', { slow: false });
          await authorize(replacement);
        },
      );
    }

    /* ---- Merchants accept: confirm stock (capture) and ship */
    const active = (await lifecycle()).orders.filter((o) => o.state === 'AUTHORIZED');
    labelB = 'Browser 2 · Merchants · accept the order, capture, ship';
    await scene(
      'capture',
      {
        view: 'B',
        speed: true,
        maxSpeed: 8,
        say: 'Each merchant accepts the order by confirming the stock is real. Only then is the payment captured. Then the order ships, with a tracking number.',
      },
      async () => {
        for (const order of active) {
          await signIn(pageB, keyFor(order.merchantName), { slow: false });
          const cardB = orderCard(pageB, order);
          await scrollTo(pageB, cardB, 'center');
          await click(pageB, cardB.getByRole('button', { name: 'Confirm stock' }));
          await waitFor('capture', (l) =>
            l.orders.some((o) => o.id === order.id && o.state === 'CAPTURED'),
          );
          await pageB.waitForTimeout(2000);
          await click(pageB, cardB.getByRole('button', { name: 'Mark shipped' }));
          await waitFor(
            'shipment',
            (l) => l.orders.some((o) => o.id === order.id && o.state === 'SHIPPED'),
            30_000,
          ).catch((e) => log('ship:', e.message));
          await pageB.waitForTimeout(1500);
        }
      },
    );

    /* ---- Jordan confirms receipt; Mission Receipt */
    await scene(
      'receive',
      {
        view: 'A',
        speed: true,
        say: 'Back with Jordan, the requester. She confirms what actually arrived, and only that counts as delivery.',
      },
      async () => {
        const toAck = (await lifecycle()).orders.filter((o) =>
          o.allowedActions.includes('ACKNOWLEDGE'),
        );
        for (const order of toAck) {
          const cardA = orderCard(pageA, order);
          await scrollTo(pageA, cardA, 'center');
          await click(pageA, cardA.getByRole('button', { name: 'Confirm received' }));
          await waitFor('delivery', (l) =>
            l.orders.some((o) => o.id === order.id && o.state === 'DELIVERED'),
          );
          await pageA.waitForTimeout(800);
        }
      },
    );

    lc = await waitFor('receipt', (l) => Boolean(l.receipt), 30_000).catch(() => lifecycle());
    const receipt = lc.receipt;
    await scene(
      'receipt',
      {
        view: 'A',
        say: () =>
          receipt
            ? `The Mission Receipt: ${receipt.deliveredUnits} of ${receipt.requestedUnits} kits delivered, ${money(receipt.totalPaidMinor)} paid, ${money(receipt.voidedMinor)} voided and never charged, and ${receipt.recoveries} automatic recovery. The shelter got everything, even though a supplier failed.`
            : 'And the mission timeline records every step, with its source: the AI, the rules engine, or PayPal.',
      },
      async () => {
        if (receipt) await reveal(pageA, pageA.getByText(/Mission Receipt · revision/), 110);
        await pageA.waitForTimeout(5000);
      },
    );

    await pageA.setContent(
      card({
        kicker: 'NeedMesh',
        title: 'AI that plans and recovers.<br><em>PayPal that pays only for real goods.</em>',
        body: 'One PayPal order per merchant · authorize, capture, void · PayPal MCP verification · Gemini explanations checked against the math · live, multi-user missions.',
        foot: [
          'PayPal Orders v2',
          'Payments v2',
          'PayPal MCP',
          'Webhooks',
          'Google Gemini',
          'Channel3',
        ],
      }),
    );
    await scene('outro', {
      view: 'A',
      card: true,
      say: 'NeedMesh: AI agents that plan and recover, and PayPal that pays only for real goods. Thanks for watching.',
    });
  } catch (error) {
    if (!error.stop) {
      await pageA.screenshot({ path: join(WORK, 'fail-A.png') }).catch(() => {});
      await pageB.screenshot({ path: join(WORK, 'fail-B.png') }).catch(() => {});
      throw error;
    }
    log(`stopped after ${UNTIL}`);
  } finally {
    manifest();
    await browser.close();
  }
  log(`recorded ${scenes.length} scenes → ${join(WORK, 'manifest.json')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
