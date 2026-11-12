#!/usr/bin/env node
/**
 * Devpost thumbnail (3:2). Captures the live AI Command Center while the agents plan the shelter
 * mission, places it beside the title, then reseeds so the mission is fresh again.
 *
 *   node scripts/video/thumbnail.mjs     → out/video/needmesh-thumbnail.png
 */
/* global document -- used inside browser-side callbacks */
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:4000';
const MISSION = '5e000000-0000-4000-8000-000000000002';
const PASSWORD = process.env.DEMO_ACCOUNT_PASSWORD ?? 'needmesh-sandbox';
const OUT = join(process.cwd(), 'out', 'video');
mkdirSync(OUT, { recursive: true });

const reseed = () => {
  const r = spawnSync('npm run demo:seed', { shell: true, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`demo:seed failed:\n${r.stdout}\n${r.stderr}`);
};

reseed();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const app = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 2,
  });
  await app.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = 'nextjs-portal{display:none!important}';
      document.head.appendChild(s);
    });
  });
  const page = await app.newPage();
  await page.goto(`${WEB}/sign-in?persona=jordan&next=/missions/${MISSION}`);
  await page.waitForFunction(() => document.querySelector('#email')?.value?.includes('@'));
  await page.fill('#password', PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const stage = page.locator('.ai-stage').first();
  await stage.waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Run NeedMesh agents' }).click();
  for (let i = 0; i < 120; i++) {
    const res = await app.request.get(`${API}/v1/missions/${MISSION}/lifecycle`);
    if (res.ok() && (await res.json()).orders.length > 0) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1400);
  await page.addStyleTag({ content: 'header{visibility:hidden!important}' });
  const shot = join(OUT, 'thumbnail-stage.png');
  await stage.screenshot({ path: shot });

  const img = `data:image/png;base64,${readFileSync(shot).toString('base64')}`;
  const card = await browser.newContext({
    viewport: { width: 1500, height: 1000 },
    deviceScaleFactor: 1,
  });
  const art = await card.newPage();
  await art.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    html,body{margin:0;width:1500px;height:1000px;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif;color:#f8fafc;
      background:radial-gradient(900px 700px at 0% 0%,#1d4ed8 0%,#0b1020 52%,#05070f 100%)}
    .glow{position:absolute;right:-220px;bottom:-260px;width:900px;height:900px;border-radius:50%;
      background:conic-gradient(from 40deg,#2563eb55,#7c3aed66,#f59e0b55,#2563eb55);filter:blur(90px)}
    .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(148,163,184,.07) 1px,transparent 1px),
      linear-gradient(90deg,rgba(148,163,184,.07) 1px,transparent 1px);background-size:50px 50px;
      mask-image:linear-gradient(90deg,#000 0%,transparent 70%)}
    .text{position:absolute;left:90px;top:110px;width:700px}
    .k{font:600 22px/1 'Cascadia Mono',Consolas,monospace;letter-spacing:.24em;text-transform:uppercase;color:#93c5fd}
    h1{margin:26px 0 0;font-size:150px;line-height:.95;font-weight:800;letter-spacing:-.04em}
    h2{margin:34px 0 0;font-size:58px;line-height:1.08;font-weight:700;letter-spacing:-.02em}
    h2 em{font-style:normal;background:linear-gradient(90deg,#60a5fa,#a78bfa 55%,#fbbf24);
      -webkit-background-clip:text;background-clip:text;color:transparent}
    p{margin:28px 0 0;font-size:30px;line-height:1.4;color:#cbd5e1;width:620px}
    .chips{position:absolute;left:90px;bottom:90px;display:flex;gap:14px;flex-wrap:wrap;width:1320px}
    .chip{border-radius:999px;padding:12px 22px;font-size:24px;font-weight:600;background:rgba(15,23,42,.72);
      border:1px solid rgba(148,163,184,.4)}
    .chip.pp{border-color:#fbbf24;color:#fde68a}.chip.ai{border-color:#a78bfa;color:#ddd6fe}
    .shot{position:absolute;left:790px;top:330px;width:860px;border-radius:22px;overflow:hidden;
      border:2px solid rgba(148,163,184,.45);box-shadow:0 40px 120px rgba(0,0,0,.65),0 0 0 10px rgba(37,99,235,.12);
      transform:perspective(1800px) rotateY(-13deg) rotateX(3deg);transform-origin:left center}
    .shot img{display:block;width:100%}
  </style></head><body>
    <div class="glow"></div><div class="grid"></div>
    <div class="shot"><img src="${img}"></div>
    <div class="text">
      <div class="k">AI agents × PayPal</div>
      <h1>NeedMesh</h1>
      <h2>A purchase that<br><em>protects itself.</em></h2>
      <p>AI finds the sellers. PayPal holds the money until the goods are real.</p>
    </div>
    <div class="chips">
      <span class="chip pp">PayPal Sandbox</span><span class="chip pp">PayPal MCP</span>
      <span class="chip ai">Google Gemini</span><span class="chip">Multi-user · live</span>
    </div>
  </body></html>`);
  await art.waitForTimeout(500);
  await art.screenshot({ path: join(OUT, 'needmesh-thumbnail.png') });
  console.log(join(OUT, 'needmesh-thumbnail.png'));
} finally {
  await browser.close();
  reseed();
}
