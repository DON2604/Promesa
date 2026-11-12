#!/usr/bin/env node
/**
 * Devpost "Project Media" gallery: five 3:2 JPGs (3000×2000, well under 5 MB). Drives the live app
 * through the shelter mission and the bakery PromiseTwin, frames each moment with a caption, then
 * reseeds so the demo data is fresh again. Needs the web app and API running.
 *
 *   node scripts/video/gallery.mjs     → out/gallery/01-….jpg … 05-….jpg
 */
/* global window, document -- used inside browser-side callbacks */
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:4000';
const MISSION = '5e000000-0000-4000-8000-000000000002';
const PASSWORD = process.env.DEMO_ACCOUNT_PASSWORD ?? 'needmesh-sandbox';
const OUT = join(process.cwd(), 'out', 'gallery');
const RAW = join(OUT, 'raw');
mkdirSync(RAW, { recursive: true });

const reseed = () => {
  const r = spawnSync('npm run demo:seed', { shell: true, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`demo:seed failed:\n${r.stdout}\n${r.stderr}`);
};

/** Scrolls an element to the top of the viewport, just below the sticky workspace header. */
async function reveal(page, locator, offset = 84) {
  await locator.first().waitFor({ state: 'attached', timeout: 30_000 });
  await locator.first().evaluate((el, off) => {
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - off });
  }, offset);
  await page.waitForTimeout(1200);
}

async function signIn(page, persona, next) {
  await page.context().clearCookies();
  await page.goto(`${WEB}/sign-in?persona=${persona}&next=${encodeURIComponent(next)}`);
  await page.waitForFunction(() => document.querySelector('#email')?.value?.includes('@'));
  await page.fill('#password', PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 30_000 });
  await page.waitForTimeout(2500);
}

async function snap(page, name) {
  const file = join(RAW, `${name}.png`);
  await page.mouse.move(1, 1);
  await page.screenshot({ path: file });
  return file;
}

const SLIDES = [
  {
    file: '01-describe-the-need',
    shot: 'studio',
    kicker: '01 · Describe the need',
    title: 'Tell us what’s needed. <em>AI structures it.</em>',
    body: 'A shelter types one sentence. NeedMesh turns it into a mission, with hard rules kept apart from preferences.',
  },
  {
    file: '02-ai-command-center',
    shot: 'command-center',
    kicker: '02 · AI Command Center',
    title: 'Agents plan the mission <em>live.</em>',
    body: 'People on the left, NeedMesh agents in the middle, PayPal on the right. Every step shows its source.',
  },
  {
    file: '03-plan-inside-budget',
    shot: 'plan',
    kicker: '03 · Optimize',
    title: '30 of 30 kits, <em>$20 under budget.</em>',
    body: 'The planner splits the order across merchants. The policy engine checks every dollar. One PayPal order per merchant.',
  },
  {
    file: '04-supply-constellation',
    shot: 'constellation',
    kicker: '04 · Discover & compare',
    title: 'Every listing, <em>every reason.</em>',
    body: 'Connected merchants plus Channel3 product discovery. A listing that breaks a hard rule is excluded, with the reason shown.',
  },
  {
    file: '05-promisetwin',
    shot: 'twin',
    kicker: '05 · PromiseTwin',
    title: 'A purchase that <em>protects itself.</em>',
    body: 'Intent, seller commitment, PayPal state and delivery are tracked separately, so a broken promise is caught early.',
  },
];

function slideHtml({ kicker, title, body }, img) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    html,body{margin:0;width:1500px;height:1000px;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif;color:#f8fafc;
      background:radial-gradient(1000px 640px at 0% 0%,#1d4ed8 0%,#0b1020 55%,#05070f 100%)}
    .glow{position:absolute;right:-260px;top:-320px;width:900px;height:900px;border-radius:50%;
      background:conic-gradient(from 40deg,#2563eb44,#7c3aed55,#f59e0b44,#2563eb44);filter:blur(100px)}
    .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(148,163,184,.06) 1px,transparent 1px),
      linear-gradient(90deg,rgba(148,163,184,.06) 1px,transparent 1px);background-size:50px 50px;
      mask-image:linear-gradient(180deg,#000 0%,transparent 40%)}
    .head{position:absolute;left:90px;right:90px;top:46px}
    .row{display:flex;justify-content:space-between;align-items:center}
    .k{font:600 18px/1 'Cascadia Mono',Consolas,monospace;letter-spacing:.22em;text-transform:uppercase;color:#93c5fd}
    .brand{font-size:22px;font-weight:700;letter-spacing:-.01em;color:#e2e8f0}
    .brand span{color:#fbbf24}
    h1{margin:16px 0 0;font-size:52px;line-height:1.05;font-weight:800;letter-spacing:-.025em}
    h1 em{font-style:normal;background:linear-gradient(90deg,#60a5fa,#a78bfa 55%,#fbbf24);
      -webkit-background-clip:text;background-clip:text;color:transparent}
    p{margin:12px 0 0;font-size:23px;line-height:1.35;color:#cbd5e1}
    .shot{position:absolute;left:90px;top:252px;width:1320px;height:742px;border-radius:18px 18px 0 0;overflow:hidden;
      border:2px solid rgba(148,163,184,.38);border-bottom:0;
      box-shadow:0 30px 100px rgba(0,0,0,.6),0 0 0 8px rgba(37,99,235,.12)}
    .shot img{display:block;width:100%}
  </style></head><body>
    <div class="glow"></div><div class="grid"></div>
    <div class="head">
      <div class="row"><div class="k">${kicker}</div><div class="brand">NeedMesh <span>× PayPal</span></div></div>
      <h1>${title}</h1>
      <p>${body}</p>
    </div>
    <div class="shot"><img src="${img}"></div>
  </body></html>`;
}

reseed();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 2,
    locale: 'en-US',
    colorScheme: 'light',
  });
  await ctx.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = 'nextjs-portal,.toast-in[role=status]{display:none!important}';
      document.head.appendChild(s);
    });
  });
  const page = await ctx.newPage();
  const lifecycle = async () =>
    (await ctx.request.get(`${API}/v1/missions/${MISSION}/lifecycle`)).json();
  const shots = {};

  await signIn(page, 'jordan', '/missions/new');
  await page
    .locator('textarea')
    .first()
    .fill(
      'We need 30 fragrance-free hygiene kits for the Harbor Light shelter by Friday at 5pm. Keep it under $175 total.',
    );
  await page.getByRole('button', { name: /Compile intent/ }).click();
  await page.getByText('Where each constraint came from').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  shots.studio = await snap(page, 'studio');

  await page.goto(`${WEB}/missions/${MISSION}`);
  const stage = page.locator('.ai-stage').first();
  await stage.waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Run NeedMesh agents' }).click();
  for (let i = 0; i < 120 && (await lifecycle()).orders.length === 0; i++) {
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(2500);
  await reveal(page, stage);
  shots['command-center'] = await snap(page, 'command-center');
  await reveal(page, page.getByText(/Agent plan · round/), 110);
  shots.plan = await snap(page, 'plan');
  await reveal(page, page.getByText('Every listing the agents considered'), 110);
  shots.constellation = await snap(page, 'constellation');

  await signIn(page, 'maya', '/dashboard');
  await page.locator('a[href^="/twins/"]').first().click();
  await page.waitForURL('**/twins/**');
  await page.waitForTimeout(2500);
  shots.twin = await snap(page, 'twin');

  const card = await browser.newContext({
    viewport: { width: 1500, height: 1000 },
    deviceScaleFactor: 2,
  });
  const art = await card.newPage();
  for (const slide of SLIDES) {
    const img = `data:image/png;base64,${readFileSync(shots[slide.shot]).toString('base64')}`;
    await art.setContent(slideHtml(slide, img));
    await art.waitForTimeout(400);
    const file = join(OUT, `${slide.file}.jpg`);
    await art.screenshot({ path: file, type: 'jpeg', quality: 90 });
    console.log(`${file}  ${(statSync(file).size / 1024 / 1024).toFixed(2)} MB`);
  }
} finally {
  await browser.close();
  reseed();
}
