// Browser walk-through of the NeedMesh demo against running web (3000) and API (4000) servers.
// Jordan (shelter) runs the agents -> Priya (sponsor) approves -> merchant stockout -> Recovery re-plan
// -> replacement approved -> shipped -> recipient confirms -> Mission Receipt. Screenshots go to docs/screenshots/needmesh.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(join(process.cwd(), 'frontend', 'package.json'));
const { chromium } = require('playwright-core');

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:3000';
const API = process.env.E2E_API_URL ?? 'http://localhost:4000';
const SHOTS = join(process.cwd(), 'docs', 'screenshots', 'needmesh');
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.E2E_CHANNEL ?? 'msedge',
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  colorScheme: 'light',
});
const page = await context.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text()}`);
});

let step = 0;
async function run(name, fn) {
  step += 1;
  try {
    await fn();
    console.log(`  ok   ${step}. ${name}`);
  } catch (err) {
    console.log(`  FAIL ${step}. ${name}\n       ${String(err.message).split('\n')[0]}`);
    await page
      .screenshot({ path: join(SHOTS, `fail-${step}.png`), fullPage: true })
      .catch(() => {});
    problems.push(`step ${step} failed: ${name}`);
  }
}
const shot = (n) => page.screenshot({ path: join(SHOTS, `${n}.png`), fullPage: true });

async function signIn(persona, next) {
  await page.goto(`${WEB}/sign-in?persona=${persona}&next=${encodeURIComponent(next)}`);
  await page.getByRole('button', { name: new RegExp(`Continue as ${persona}`, 'i') }).click();
  await page.waitForURL(`**${next}`);
}

console.log(`NeedMesh E2E against ${WEB}`);

let missionPath = '/dashboard';

await run('reset the shelter scenario and find the mission', async () => {
  await signIn('jordan', '/dashboard');
  await page.getByRole('link', { name: 'Open mission' }).first().waitFor();
  missionPath = '/missions/5e000000-0000-4000-8000-000000000002';
  const res = await page.evaluate(
    async ([api]) => {
      const r = await fetch(`${api}/v1/demo/scenarios/DEMO-SHELTER-001/reset`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-Promesa-Csrf': '1', 'Content-Type': 'application/json' },
        body: '{}',
      });
      return r.status;
    },
    [API],
  );
  if (res >= 300) throw new Error(`reset returned ${res}`);
});

await run('Jordan runs the NeedMesh agents', async () => {
  await page.goto(WEB + missionPath);
  await page.getByRole('button', { name: 'Run NeedMesh agents' }).click();
  await page.getByText('Merchant orders').waitFor();
  await page.getByText('Budget guardrail').waitFor();
  await page
    .getByText(/Commerce Planner/)
    .first()
    .waitFor();
  await page.getByText('Mission Atlas').first().waitFor();
  await page.getByText('Supply Constellation').first().waitFor();
  await page.getByText('Allocation Ribbon').first().waitFor();
  await page
    .getByText(/Planning run/)
    .first()
    .waitFor();
  await shot('01-plan');
});

await run('Jordan cannot approve payment', async () => {
  // The server only offers APPROVE to the sponsor, so shelter staff are pointed to Priya instead.
  const approve = page.getByRole('button', { name: /Approve & authorize in PayPal/ });
  if ((await approve.count()) > 0 && !(await approve.first().isDisabled()))
    throw new Error('shelter staff must not be able to approve payment');
  await page.getByRole('link', { name: /Continue as Priya/ }).waitFor();
});

await run('Priya approves both merchant orders', async () => {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn('priya', missionPath);
  for (let i = 0; i < 2; i += 1) {
    await page
      .getByRole('button', { name: /Approve & authorize in PayPal/ })
      .first()
      .click();
    await page.waitForTimeout(900);
  }
  await page.getByText('Authorized').first().waitFor();
  await shot('02-authorized');
});

await run('merchant stockout triggers the Recovery Agent', async () => {
  await page.getByRole('button', { name: 'Confirm stock' }).last().click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Report stockout' }).first().click();
  await page
    .getByText(/Recovery Agent/)
    .first()
    .waitFor({ timeout: 15000 });
  await page.getByText('Voided').first().waitFor();
  await page
    .getByText(/Replacement for a failed order/)
    .first()
    .waitFor();
  await shot('03-recovery');
});

await run('Priya approves the replacement and merchants ship', async () => {
  await page
    .getByRole('button', { name: /Approve & authorize in PayPal/ })
    .first()
    .click();
  await page.waitForTimeout(900);
  const confirm = page.getByRole('button', { name: 'Confirm stock' });
  while ((await confirm.count()) > 0) {
    await confirm.first().click();
    await page.waitForTimeout(700);
  }
  const ship = page.getByRole('button', { name: 'Mark shipped' });
  while ((await ship.count()) > 0) {
    await ship.first().click();
    await page.waitForTimeout(700);
  }
  await page.getByText('Shipped').first().waitFor();
});

await run('Jordan confirms receipt and the Mission Receipt appears', async () => {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn('jordan', missionPath);
  const confirm = page.getByRole('button', { name: 'Confirm received' });
  await confirm.first().waitFor();
  while ((await confirm.count()) > 0) {
    await confirm.first().click();
    await page.waitForTimeout(800);
  }
  await page.getByText(/Mission Receipt · revision/).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Download receipt (JSON)' }).waitFor();
  await shot('04-receipt');
});

await browser.close();
const fatal = problems.filter((p) => !p.includes('401'));
if (fatal.length) {
  console.log('\nProblems:');
  for (const p of fatal) console.log(`  - ${p}`);
}
console.log(
  fatal.length === 0 ? '\nAll NeedMesh E2E steps passed.' : `\n${fatal.length} problem(s).`,
);
process.exit(fatal.length === 0 ? 0 : 1);
