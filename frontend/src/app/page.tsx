import Link from 'next/link';
import { FoldSpecimen } from '@/components/landing/fold-specimen';
import { PayPalStatus } from '@/components/paypal-status';
import { PublicFooter, PublicHeader } from '@/components/public-chrome';
import { ButtonLink, Chip, HealthStamp, Kicker, Sheet } from '@/components/ui';

const PILLARS = [
  [
    'Understand needs',
    'Describe the need in words or by voice. AI turns it into hard rules (quantity, budget, deadline, materials) and soft preferences, asks what is missing, and waits for your confirmation.',
  ],
  [
    'Coordinate merchants',
    'Agents discover listings, explain every exclusion, split quantity across merchants and negotiate offers that connected merchants explicitly accept.',
  ],
  [
    'Execute through PayPal',
    'One PayPal order per merchant. Sponsors approve each order; a deterministic policy gates every authorize, capture, void and refund.',
  ],
  [
    'Protect every purchase',
    'PromiseTwin watches each order. When a merchant fails, it diagnoses the cause, releases or refunds the money and re-plans with human approval.',
  ],
  [
    'Verified mission outcome',
    'Mission Atlas keeps requested, sourced, paid and received apart. Only the recipient’s confirmation counts as delivery.',
  ],
] as const;

const FLOW = [
  ['01', 'Describe', 'Harbor Light needs 30 fragrance-free hygiene kits by Friday, under $175.'],
  [
    '02',
    'Confirm',
    'The Mission Blueprint shows every rule. Nothing runs until the organization confirms.',
  ],
  [
    '03',
    'Source & negotiate',
    'Agents compare four merchants. Beacon offers $6.00; the org counters $5.20 and Beacon accepts.',
  ],
  [
    '04',
    'Fund',
    'The mission is published. Two sponsors from different organizations each fund one merchant order in PayPal.',
  ],
  [
    '05',
    'Recover',
    'A merchant stocks out. PromiseTwin flags the breach, the authorization is voided and the agents re-plan.',
  ],
  [
    '06',
    'Prove',
    'The shelter confirms what arrived. A Mission Receipt shows paid vs. received vs. never charged.',
  ],
] as const;

const AUDIENCES = [
  [
    'Organizations',
    'Shelters, schools, clinics. Create missions, verify your org, negotiate, confirm delivery, see outcomes.',
    'Create a mission',
    '/sign-in?persona=jordan&next=/missions/new',
  ],
  [
    'Sponsors',
    'Discover verified needs that match your interests and budget. Fund a specific merchant order — never a pooled wallet.',
    'Explore missions',
    '/explore',
  ],
  [
    'Merchants',
    'See matching demand, submit offers, answer counteroffers, confirm stock and ship. You are paid through PayPal.',
    'Open merchant offers',
    '/sign-in?persona=dana&next=/merchant',
  ],
] as const;

const PRINCIPLES = [
  [
    'Agents plan. Policy decides. PayPal executes.',
    'Models never move money. A deterministic policy approves or denies every payment action.',
  ],
  [
    'Every payment has a human.',
    'Sponsors approve each order. Replacement orders after a failure need a fresh approval.',
  ],
  [
    'A capture is not a delivery.',
    'PayPal records the money. Only the recipient can confirm the goods arrived.',
  ],
  [
    'Simulated is always labelled.',
    'Fictional merchants, simulated rails and future integrations are marked as such.',
  ],
] as const;

export default function LandingPage() {
  return (
    <>
      <PublicHeader />
      <main id="main">
        {/* Hero */}
        <section className="ledger-grid border-b border-hairline">
          <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-5 pb-16 pt-12 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:pt-20">
            <div>
              <Kicker>NeedMesh · AI procurement missions on PayPal</Kicker>
              <h1 className="font-display mt-5 text-[clamp(2.5rem,6vw,5.2rem)] font-[380] leading-[1] text-ink">
                Tell us what’s needed.
                <span className="mt-2 block italic text-signal-strong">Our AI finds a way.</span>
              </h1>
              <p className="mt-7 max-w-xl text-[17px] leading-relaxed text-muted">
                NeedMesh turns a plain-language need into a funded, multi-merchant mission. AI
                understands the requirement, sources and negotiates with merchants, sponsors pay
                merchants directly through PayPal, and every unit is tracked until the recipient
                confirms it arrived.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <ButtonLink href="/sign-in?persona=jordan&next=/missions/new" size="lg">
                  Create a Mission
                </ButtonLink>
                <ButtonLink href="/explore" size="lg" variant="secondary">
                  Explore Missions
                </ButtonLink>
              </div>
              <p className="mt-5 text-[13px] text-muted">
                Demo environment · fictional merchants · PayPal Sandbox or a labelled simulated rail
              </p>
            </div>
            <Sheet stacked className="p-5 sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="kicker">Mission Atlas · shelter mission</p>
                <Chip tone="caution">Demo fixture</Chip>
              </div>
              <p className="font-display mt-3 text-xl leading-snug text-ink">
                30 fragrance-free hygiene kits · ≤ $175 · Fri 6 PM ET
              </p>
              <ul className="mt-5 space-y-3">
                {[
                  ['Requested', 30, 'bg-ink/80'],
                  ['Sourced', 30, 'bg-signal'],
                  ['Funded', 30, 'bg-signal-strong'],
                  ['Paid', 30, 'bg-good'],
                  ['Received', 30, 'bg-good'],
                ].map(([label, n, cls]) => (
                  <li
                    key={label as string}
                    className="grid grid-cols-[5.5rem_1fr_2rem] items-center gap-3 text-sm"
                  >
                    <span className="kicker">{label}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-cutout">
                      <span
                        className={`block h-full rounded-full ${cls}`}
                        style={{ width: `${(Number(n) / 30) * 100}%` }}
                      />
                    </span>
                    <span className="tabular text-right text-ink">{n}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-5 grid grid-cols-3 gap-2 border-t border-hairline pt-4 text-center text-[13px]">
                <div>
                  <p className="tabular font-display text-lg text-ink">$165</p>
                  <p className="text-muted">paid to merchants</p>
                </div>
                <div>
                  <p className="tabular font-display text-lg text-ink">$100</p>
                  <p className="text-muted">voided, never charged</p>
                </div>
                <div>
                  <p className="tabular font-display text-lg text-ink">2</p>
                  <p className="text-muted">sponsors</p>
                </div>
              </div>
            </Sheet>
          </div>
        </section>

        {/* Pillars */}
        <section aria-labelledby="pillars" className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8">
          <Kicker>What NeedMesh does</Kicker>
          <h2
            id="pillars"
            className="font-display mt-3 max-w-3xl text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.05]"
          >
            From “we need this” to verified delivery — one mission, many merchants.
          </h2>
          <ol className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {PILLARS.map(([title, body], i) => (
              <li key={title}>
                <Sheet className="h-full p-5">
                  <p className="font-mono text-[12px] text-signal">0{i + 1}</p>
                  <h3 className="font-display mt-2 text-xl leading-snug">{title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-muted">{body}</p>
                </Sheet>
              </li>
            ))}
          </ol>
        </section>

        {/* Flow */}
        <section aria-labelledby="how" className="border-y border-hairline bg-paper">
          <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8">
            <Kicker>A mission, end to end</Kicker>
            <h2
              id="how"
              className="font-display mt-3 max-w-3xl text-[clamp(1.7rem,3vw,2.5rem)] leading-[1.08]"
            >
              The shelter demo in six moves.
            </h2>
            <ol className="mt-12 grid gap-8 md:grid-cols-3 lg:grid-cols-6 md:gap-5">
              {FLOW.map(([n, title, body]) => (
                <li key={n} className="border-t-2 border-signal pt-4">
                  <p className="font-mono text-sm text-muted">{n}</p>
                  <h3 className="font-display mt-2 text-lg leading-snug">{title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-muted">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Audiences */}
        <section aria-labelledby="who" className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8">
          <Kicker>Three sides of the mesh</Kicker>
          <h2 id="who" className="font-display mt-3 text-[clamp(1.7rem,3vw,2.5rem)]">
            Built for organizations, sponsors and merchants
          </h2>
          <ul className="mt-8 grid gap-4 md:grid-cols-3">
            {AUDIENCES.map(([name, body, cta, href]) => (
              <li key={name}>
                <Sheet className="flex h-full flex-col p-6">
                  <p className="font-display text-2xl">{name}</p>
                  <p className="mt-2 flex-1 text-[14px] leading-relaxed text-muted">{body}</p>
                  <Link
                    href={href}
                    className="mt-4 text-sm font-medium text-signal hover:underline"
                  >
                    {cta} →
                  </Link>
                </Sheet>
              </li>
            ))}
          </ul>
        </section>

        {/* PromiseTwin */}
        <section aria-labelledby="specimen" className="mx-auto max-w-[1200px] px-5 sm:px-8">
          <div className="cutout grid items-center gap-10 p-6 sm:p-10 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <Kicker>PromiseTwin · protection built into every purchase</Kicker>
              <h2
                id="specimen"
                className="font-display mt-3 text-[clamp(1.7rem,3vw,2.5rem)] leading-[1.08]"
              >
                The payment went through. Did the promise arrive?
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-muted">
                Every NeedMesh order gets a <span className="text-ink">PromiseTwin</span>: the
                confirmed intent, the merchant’s commitment, the PayPal state and the delivery
                evidence, kept as separate tracks. When they diverge it explains why and proposes a
                policy-checked remedy. Small businesses can also protect a single purchase on its
                own.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-2">
                <HealthStamp health="AT_RISK" />
                <Chip tone="caution">Simulated bakery scenario</Chip>
              </div>
              <div className="mt-6">
                <ButtonLink href="/sign-in?persona=maya&next=/dashboard" variant="secondary">
                  See standalone purchase protection
                </ButtonLink>
              </div>
            </div>
            <FoldSpecimen />
          </div>
        </section>

        {/* Principles */}
        <section aria-labelledby="principles" className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8">
          <Kicker>House rules</Kicker>
          <h2 id="principles" className="font-display mt-3 text-[clamp(1.7rem,3vw,2.5rem)]">
            Trust is a set of constraints, not a slogan.
          </h2>
          <dl className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2">
            {PRINCIPLES.map(([t, d]) => (
              <div key={t} className="border-l-2 border-signal pl-5">
                <dt className="font-display text-xl">{t}</dt>
                <dd className="mt-2 text-[15px] text-muted">{d}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Honest integration status */}
        <section aria-labelledby="status" className="mx-auto max-w-[1200px] px-5 sm:px-8">
          <Sheet className="p-6 sm:p-8">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <Kicker>Live from the API</Kicker>
                <h2 id="status" className="font-display mt-2 text-2xl">
                  What is connected right now
                </h2>
              </div>
              <Link
                href="/how-it-works"
                className="text-sm text-signal underline-offset-4 hover:underline"
              >
                How NeedMesh uses PayPal →
              </Link>
            </div>
            <div className="mt-5">
              <PayPalStatus />
            </div>
          </Sheet>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
