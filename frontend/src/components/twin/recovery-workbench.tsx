'use client';

import clsx from 'clsx';
import { useState } from 'react';
import type { TwinDetail } from '@promesa/contracts';
import { humanize, money, when } from '@/lib/format';
import { Button, ButtonLink, Chip, SectionHeading, Sheet } from '@/components/ui';

type Remedy = {
  key: string;
  title: string;
  detail: string;
  /** Who must authorize it before anything happens. */
  requires: string;
  available: boolean;
  why: string;
};

/**
 * Recovery Workbench: remedies the policy would consider for this twin. Nothing here executes a
 * payment action — every remedy is a proposal that needs the named party's authorization.
 */
function remedies(t: TwinDetail): Remedy[] {
  const paid = t.payment.status === 'CAPTURED';
  const authorized = t.payment.status === 'APPROVED' || t.payment.status === 'ORDER_CREATED';
  const troubled = t.health === 'AT_RISK' || t.health === 'BREACHED';
  return [
    {
      key: 'seller',
      title: 'Ask the seller for a remedy',
      detail:
        'Send the seller the broken term and the evidence, and ask for a corrected date, a partial refund or a cancellation.',
      requires: 'Seller response (they may decline)',
      available: troubled && t.commitment !== null,
      why: t.commitment
        ? 'Only when the promise is at risk or breached.'
        : 'No seller-accepted terms yet.',
    },
    {
      key: 'void',
      title: 'Void the PayPal authorization',
      detail: 'Release the held funds. Nothing was captured, so no money moves.',
      requires: 'Buyer approval · policy check',
      available: troubled && authorized,
      why: authorized
        ? 'Only when the promise is at risk or breached.'
        : 'No uncaptured authorization exists.',
    },
    {
      key: 'refund',
      title: 'Request a full or partial refund',
      detail: 'A captured PayPal payment can only be refunded with the merchant’s authorization.',
      requires: 'Merchant authorization · buyer approval · policy check',
      available: t.health === 'BREACHED' && paid,
      why: paid ? 'Only after a breach is established.' : 'Nothing has been captured.',
    },
    {
      key: 'replace',
      title: 'Buy from an alternative seller',
      detail:
        'Re-run the offer solver against the same confirmed intent. The new purchase needs its own approval.',
      requires: 'Buyer approval of a new payment',
      available: t.health === 'BREACHED',
      why: 'Only after a breach is established.',
    },
  ];
}

export function RecoveryWorkbench({ twin }: { twin: TwinDetail }) {
  const [copied, setCopied] = useState(false);
  const list = remedies(twin);
  const cause = twin.latestEvaluation?.causes[0];
  const draft = twin.commitment
    ? `Hello ${twin.commitment.merchantName}, on ${when(twin.commitment.acceptedAt, twin.commitment.terms.deliveryTimezone)} you accepted delivery of ${twin.commitment.terms.quantity} × ${twin.commitment.terms.title} by ${when(twin.commitment.terms.deliverBy, twin.commitment.terms.deliveryTimezone)} for ${money(twin.commitment.terms.totalMinor, twin.commitment.terms.currency)}. Our records show this is ${humanize(twin.health).toLowerCase()}${cause ? ` (${humanize(cause.classification).toLowerCase()})` : ''}. Please confirm a corrected delivery date, or offer a partial refund or cancellation under your policy: “${twin.commitment.terms.refundPolicy}”.`
    : '';
  return (
    <Sheet className="p-5">
      <SectionHeading
        kicker="Recovery Workbench"
        title="Remedies the policy would allow"
        aside={<Chip>Proposals only · nothing runs without approval</Chip>}
      />
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {list.map((r) => (
          <li
            key={r.key}
            className={clsx(
              'rounded-md border p-3 text-sm',
              r.available
                ? 'border-signal/40 bg-signal-soft'
                : 'border-hairline bg-paper-2 text-muted',
            )}
          >
            <p className="font-medium text-ink">{r.title}</p>
            <p className="mt-1 text-[13px]">{r.detail}</p>
            <p className="mt-2 text-[12px]">
              <span className="kicker">Requires</span> {r.requires}
            </p>
            {!r.available ? <p className="mt-1 text-[12px] italic">{r.why}</p> : null}
            {r.available && r.key === 'replace' ? (
              <ButtonLink href="/purchases/new" size="sm" variant="secondary" className="mt-2">
                Compare alternative sellers
              </ButtonLink>
            ) : null}
          </li>
        ))}
      </ul>
      {draft && list[0]!.available ? (
        <div className="mt-4 rounded-md border border-hairline p-3">
          <p className="kicker">
            Draft message to the seller · AI-free template, edit before sending
          </p>
          <p className="mt-2 text-[13px] text-ink">{draft}</p>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() =>
              void navigator.clipboard.writeText(draft).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              })
            }
          >
            {copied ? 'Copied' : 'Copy message'}
          </Button>
        </div>
      ) : null}
      <p className="mt-3 text-[12px] text-muted">
        NeedMesh never contacts sellers that are not connected to the platform on your behalf, and
        never moves money from this screen.
      </p>
    </Sheet>
  );
}

export function ProofPassport({ twin }: { twin: TwinDetail }) {
  const tz = twin.intent.spec.timezone;
  const delivery = twin.evidence.filter((e) =>
    ['SHIPPED', 'DELIVERED', 'RECEIPT_ACKNOWLEDGED'].includes(e.assertion),
  );
  const rows: Array<[string, string, string, boolean]> = [
    [
      'Intent',
      `Confirmed ${when(twin.intent.confirmedAt, tz)}`,
      `compiler ${twin.intent.compilerVersion}`,
      true,
    ],
    [
      'Seller terms',
      twin.commitment
        ? `${twin.commitment.merchantName} · accepted by ${twin.commitment.acceptedByName}`
        : 'No accepted terms',
      twin.commitment ? `terms ${twin.commitment.termsHash.slice(0, 12)}…` : '—',
      twin.commitment !== null,
    ],
    [
      'PayPal',
      `${humanize(twin.payment.status)}${twin.payment.amountMinor ? ` · ${money(twin.payment.amountMinor, twin.payment.currency)}` : ''}`,
      twin.payment.paypalCaptureId ?? twin.payment.paypalOrderId ?? '—',
      twin.payment.status === 'CAPTURED' || twin.payment.status === 'REFUNDED',
    ],
    [
      'Delivery',
      delivery.length
        ? delivery.map((d) => humanize(d.assertion)).join(' · ')
        : 'No delivery evidence yet',
      delivery.some((d) => d.isSimulated)
        ? 'simulated evidence'
        : delivery.length
          ? 'recorded'
          : '—',
      delivery.some((d) => d.assertion === 'DELIVERED' || d.assertion === 'RECEIPT_ACKNOWLEDGED'),
    ],
  ];
  const download = () => {
    const body = {
      twinId: twin.id,
      title: twin.title,
      health: twin.health,
      intent: { confirmedAt: twin.intent.confirmedAt, spec: twin.intent.spec },
      commitment: twin.commitment,
      payment: twin.payment,
      evidence: twin.evidence.map((e) => ({
        kind: e.kind,
        assertion: e.assertion,
        summary: e.summary,
        occurredAt: e.occurredAt,
        simulated: e.isSimulated,
        source: e.provenance.source,
      })),
      exportedAt: new Date().toISOString(),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `proof-passport-${twin.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Sheet stacked className="p-5">
      <SectionHeading
        kicker="Proof Passport"
        title="Payment and delivery, side by side"
        aside={
          <Button size="sm" variant="secondary" onClick={download}>
            Download passport
          </Button>
        }
      />
      <dl className="mt-4 divide-y divide-hairline text-sm">
        {rows.map(([k, v, ref, ok]) => (
          <div
            key={k}
            className="grid grid-cols-[6.5rem_1fr] gap-3 py-2.5 sm:grid-cols-[6.5rem_1fr_12rem]"
          >
            <dt className="kicker pt-0.5">
              <span aria-hidden className={ok ? 'text-good' : 'text-muted'}>
                {ok ? '● ' : '○ '}
              </span>
              {k}
            </dt>
            <dd className="text-ink">{v}</dd>
            <dd className="truncate font-mono text-[12px] text-muted sm:text-right">{ref}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[12px] text-muted">
        A PayPal capture proves money moved — not that goods arrived. Delivery is shown only from
        shipping and recipient evidence.
      </p>
    </Sheet>
  );
}
