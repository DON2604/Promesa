// Browser end-to-end check of the Phase 1 UI against running web (3000) and API (4000) servers.
// Uses the locally installed Microsoft Edge through playwright-core (no browser download).
/* global document */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(join(process.cwd(), 'frontend', 'package.json'));
const { chromium } = require('playwright-core');

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:3000';
const SHOTS = join(process.cwd(), 'docs', 'screenshots', 'phase1');
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
const shot = (n, full = true) => page.screenshot({ path: join(SHOTS, `${n}.png`), fullPage: full });

console.log(`E2E against ${WEB}`);

await run('landing renders hero and live PayPal status', async () => {
  await page.goto(WEB + '/', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1, name: /Tell us what’s needed/ }).waitFor();
  await page.getByRole('link', { name: 'Create a Mission' }).first().waitFor();
  await page.getByRole('link', { name: 'Explore Missions' }).first().waitFor();
  await page.getByText('REST API (Orders v2, Payments)').waitFor();
  await page.waitForTimeout(1600);
  await shot('01-landing');
});

await run('public marketplace lists the published shelter mission', async () => {
  await page.getByRole('link', { name: 'Explore Missions' }).first().click();
  await page.waitForURL('**/explore');
  await page.getByText('Harbor Light').first().waitFor();
  await page.getByRole('link', { name: 'View mission' }).first().waitFor();
  await shot('01b-explore');
});

await run('how it works page', async () => {
  await page.getByRole('link', { name: 'How it works' }).first().click();
  await page.getByRole('heading', { name: /Agents plan\. Policy decides/ }).waitFor();
});

await run('sign in as Maya from the demo CTA', async () => {
  await page.goto(WEB + '/', { waitUntil: 'networkidle' });
  await page
    .getByRole('link', { name: /See standalone purchase protection/ })
    .first()
    .click();
  await page.getByRole('heading', { name: /Choose who you are today/ }).waitFor();
  await page.getByText('Suggested').waitFor();
  await shot('02-sign-in');
  await page.getByRole('button', { name: /Continue as Maya/ }).click();
  await page.waitForURL('**/dashboard');
  await page.getByRole('heading', { level: 1, name: /Maya/ }).waitFor();
});

await run('reset the bakery scenario and open its PromiseTwin', async () => {
  await page.getByRole('link', { name: 'Open PromiseTwin' }).first().waitFor();
  await shot('03-dashboard');
  await page.getByRole('link', { name: 'Open PromiseTwin' }).first().click();
  await page.waitForURL('**/twins/**');
  const reset = page.getByRole('button', { name: 'Reset scenario' });
  await reset.waitFor();
  await reset.click();
  await page.getByRole('button', { name: 'Confirm reset' }).click();
  await page.getByRole('button', { name: 'Reset scenario' }).waitFor();
  await page.locator('header').getByText('At risk').first().waitFor();
  await page.getByText('Reality is drifting from the promise.').waitFor();
  await page.waitForTimeout(1400);
  await shot('04-twin-at-risk');
});

await run('advance the simulated clock past the deadline → BREACHED', async () => {
  await page.getByRole('button', { name: /Friday 17:00 passes/ }).click();
  await page.locator('header').getByText('Breached').first().waitFor({ timeout: 15000 });
  await page.getByText('The promise and reality have split.').waitFor();
  await page.waitForTimeout(900);
  await shot('05-twin-breached');
});

await run('Timefold history lists immutable snapshots', async () => {
  await page.getByRole('link', { name: 'History' }).click();
  await page.waitForURL('**/history');
  const slider = page.getByRole('slider');
  await slider.waitFor();
  const max = Number(await slider.getAttribute('max'));
  if (max < 2) throw new Error(`expected ≥3 snapshots, got ${max + 1}`);
  await page
    .getByRole('button', { name: /Seller ETA|ETA|revised/i })
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(700);
  await shot('06-timefold');
  await page.getByRole('link', { name: /Back to PromiseTwin/ }).click();
  await page.waitForURL(/\/twins\/[^/]+$/);
});

await run('reset again so the seed returns to AT_RISK', async () => {
  await page.getByRole('button', { name: 'Reset scenario' }).click();
  await page.getByRole('button', { name: 'Confirm reset' }).click();
  await page.locator('header').getByText('At risk').first().waitFor({ timeout: 15000 });
});

await run('light fintech theme is applied', async () => {
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  if (theme !== 'light') throw new Error(`theme is ${theme}`);
  await shot('07-twin-light');
});

await run('compile an intent, edit nothing, confirm, create purchase + twin', async () => {
  await page.goto(WEB + '/dashboard');
  await page.getByRole('link', { name: 'Protect a purchase' }).first().click();
  await page.waitForURL('**/purchases/new');
  await page.getByRole('button', { name: 'Bakery boxes' }).click();
  await page.getByRole('button', { name: 'Compile intent' }).click();
  await page.getByText('Where each constraint came from').waitFor();
  const marks = await page.locator('mark.span-mark').count();
  if (marks < 4) throw new Error(`expected source highlights, got ${marks}`);
  await page.getByRole('button', { name: 'Unfold to edit constraints' }).click();
  await page.getByLabel('Quantity').waitFor();
  await page.waitForTimeout(700);
  await shot('08-intent-composer');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /Create purchase/ }).click();
  await page.waitForURL(/\/purchases\/[0-9a-f-]{36}$/);
  await page.getByText('Plans that satisfy every hard constraint').waitFor();
  await page
    .getByText(/Excluded/)
    .first()
    .waitFor();
  await shot('09-purchase-offers');
  await page.getByRole('link', { name: /Open PromiseTwin/ }).click();
  await page.waitForURL('**/twins/**');
  await page.locator('header').getByText('Undetermined').first().waitFor();
});

await run('mobile PromiseTwin layout', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  // The SSE stream keeps a connection open, so "networkidle" never settles on workspace pages.
  await page.reload({ waitUntil: 'load' });
  await page.getByRole('list', { name: 'Promise threads' }).waitFor();
  await shot('10-twin-mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
});

await run('Jordan creates a mission for the shelter', async () => {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(WEB + '/');
  await page.goto(WEB + '/sign-in?persona=jordan&next=/missions/new');
  await page.getByRole('button', { name: /Continue as Jordan/ }).click();
  await page.waitForURL('**/missions/new');
  await page.getByRole('button', { name: 'Shelter hygiene kits' }).click();
  await page.getByRole('button', { name: 'Compile intent' }).click();
  await page.getByText('Where each constraint came from').waitFor();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create mission' }).click();
  await page.waitForURL(/\/missions\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Run NeedMesh agents' }).waitFor();
  await shot('11-mission');
});

await run('unauthenticated workspace redirects to sign-in', async () => {
  await context.clearCookies();
  await page.goto(WEB + '/dashboard');
  await page.waitForURL('**/sign-in?next=%2Fdashboard');
});

await browser.close();
const fatal = problems.filter((p) => !p.includes('401'));
if (fatal.length) {
  console.log('\nProblems:');
  for (const p of fatal) console.log(`  - ${p}`);
}
console.log(fatal.length === 0 ? '\nAll E2E steps passed.' : `\n${fatal.length} problem(s).`);
process.exit(fatal.length === 0 ? 0 : 1);
