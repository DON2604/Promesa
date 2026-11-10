import type { Metadata } from 'next';
import { PayPalStatus } from '@/components/paypal-status';
import { PublicFooter, PublicHeader } from '@/components/public-chrome';
import { ButtonLink, HealthStamp, Kicker, Sheet } from '@/components/ui';
import type { TwinHealth } from '@promesa/contracts';

export const metadata: Metadata = { title: 'How it works' };

const LIFECYCLE = [
  [
    'Need',
    'An organisation describes what it needs. NeedMesh extracts testable constraints and shows the exact words each came from. Nothing is assumed silently.',
  ],
  [
    'Plan',
    'The Commerce Planner splits the need across verified merchants, cheapest eligible units first. Anything that breaks a hard constraint — like a fragranced kit — is excluded with a reason, never discounted into the plan.',
  ],
  [
    'Sponsor approval',
    'A sponsor approves each merchant order. NeedMesh creates one PayPal order per merchant with intent AUTHORIZE, so no money is captured yet.',
  ],
  [
    'Merchant confirmation',
    'Capture is released only after the merchant confirms stock. The policy engine denies a capture before that, and the denial is shown on the timeline.',
  ],
  [
    'Recovery',
    'If a merchant stocks out, the Recovery Agent reads the order from PayPal, voids an uncaptured authorization (or asks the merchant to approve a refund of a captured one), and re-plans inside the remaining budget. The replacement needs a new sponsor approval.',
  ],
  [
    'Fulfilment and receipt',
    'Shipment tracking is recorded, the recipient confirms what arrived, and a Mission Receipt shows payment, tracking and recipient confirmation as separate evidence.',
  ],
];
const HEALTH: Array<[TwinHealth, string]> = [
  ['UNDETERMINED', 'Not enough evidence yet: for example, no seller has accepted the terms.'],
  ['ON_TRACK', 'Every committed constraint is satisfied or still achievable on current evidence.'],
  [
    'AT_RISK',
    'A committed constraint is in danger — a revised ETA past the deadline, or a selection mismatch.',
  ],
  [
    'BREACHED',
    'A seller-committed term was violated, with evidence. Never inferred from silence alone.',
  ],
  ['FULFILLED', 'Delivery is confirmed by the recipient, and every committed term is met.'],
];

const TRACKS = [
  ['Intent', 'What you asked for, in your words and as constraints.'],
  ['Merchant', 'What the seller accepted, version by version.'],
  ['PayPal', 'What PayPal recorded: orders, captures, refunds. Money only.'],
  ['Delivery', 'What actually happened: tracking, recipient confirmation, evidence.'],
];

export default function HowItWorksPage() {
  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto max-w-[1000px] px-5 pt-14 sm:px-8">
        <Kicker>How it works</Kicker>
        <h1 className="font-display mt-4 text-[clamp(2.2rem,5vw,4rem)] leading-[1.02]">
          Agents plan. Policy decides. PayPal executes.
        </h1>
        <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-muted">
          NeedMesh connects the need, the supply and the payment into one mission. AI helps plan and
          explain, but a deterministic policy engine approves every payment action and PayPal is the
          system of record for money. Behind it, Promesa PromiseTwin keeps watching whether each
          promise actually arrives.
        </p>

        <section aria-labelledby="lifecycle" className="mt-16">
          <h2 id="lifecycle" className="font-display text-2xl">
            The NeedMesh mission lifecycle
          </h2>
          <ol className="mt-6 space-y-0">
            {LIFECYCLE.map(([t, d], i) => (
              <li key={t} className="grid grid-cols-[3rem_1fr] gap-4 border-t border-hairline py-5">
                <span className="font-mono text-sm text-muted">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <h3 className="text-[17px] font-medium text-ink">{t}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-muted">{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="tracks" className="mt-16 grid gap-8 md:grid-cols-2">
          <div>
            <h2 id="tracks" className="font-display text-2xl">
              Promesa safety net: four tracks, never blended
            </h2>
            <p className="mt-3 text-[15px] text-muted">
              A completed PayPal capture proves payment. It does not prove the boxes arrived. Each
              track has its own evidence and its own provenance.
            </p>
          </div>
          <Sheet className="p-5">
            <dl className="divide-y divide-hairline">
              {TRACKS.map(([t, d]) => (
                <div key={t} className="grid grid-cols-[6rem_1fr] gap-3 py-3 text-sm">
                  <dt className="kicker pt-0.5">{t}</dt>
                  <dd className="text-ink">{d}</dd>
                </div>
              ))}
            </dl>
          </Sheet>
        </section>

        <section aria-labelledby="health" className="mt-16">
          <h2 id="health" className="font-display text-2xl">
            What the health stamp means
          </h2>
          <dl className="mt-6 grid gap-4 sm:grid-cols-2">
            {HEALTH.map(([h, d]) => (
              <div key={h} className="sheet p-4">
                <dt>
                  <HealthStamp health={h} />
                </dt>
                <dd className="mt-2 text-sm text-muted">{d}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="paypal" className="mt-16">
          <h2 id="paypal" className="font-display text-2xl">
            How NeedMesh uses PayPal
          </h2>
          <p className="mt-3 max-w-2xl text-[15px] text-muted">
            All PayPal calls run on the server through a dedicated adapter; credentials never reach
            the browser. Orders v2 creates and authorizes orders, the Payments API captures, voids
            and refunds, shipment tracking is attached, and verified webhooks update the mission.
            The official PayPal MCP server is used read-only to look up an order before the Recovery
            Agent acts; it has no authorization-void tool, so voids go through REST. With no Sandbox
            credentials the rail is shown as Simulated. NeedMesh does not provide escrow and is not
            an official PayPal product. Current status:
          </p>
          <Sheet className="mt-6 p-5">
            <PayPalStatus />
          </Sheet>
        </section>

        <div className="mt-16 flex flex-wrap gap-3">
          <ButtonLink href="/sign-in?persona=jordan&next=/dashboard" size="lg">
            Open the shelter mission
          </ButtonLink>
          <ButtonLink href="/" size="lg" variant="secondary">
            Back to home
          </ButtonLink>
        </div>
      </main>
      <PublicFooter />
    </>
  );
}
