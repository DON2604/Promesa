'use client';

import { useParams } from 'next/navigation';
import { errorMessage } from '@/lib/api';
import { humanize, money, when } from '@/lib/format';
import { usePurchase, usePurchaseOffers } from '@/lib/queries';
import { OfferBoard } from '@/components/offer-board';
import {
  Button,
  ButtonLink,
  Chip,
  Dl,
  HealthStamp,
  Kicker,
  LoadingSheet,
  Sheet,
  SimulatedTag,
  StateBlock,
} from '@/components/ui';

export default function PurchasePage() {
  const { id } = useParams<{ id: string }>();
  const purchase = usePurchase(id);
  const offers = usePurchaseOffers(id);

  if (purchase.isLoading) return <LoadingSheet label="Loading purchase" />;
  if (purchase.isError || !purchase.data)
    return (
      <StateBlock
        tone="breach"
        title="This purchase could not be loaded."
        action={
          <ButtonLink href="/dashboard" variant="secondary">
            Back to overview
          </ButtonLink>
        }
      >
        {errorMessage(purchase.error)}
      </StateBlock>
    );

  const p = purchase.data;
  const spec = p.intent.spec;
  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Kicker>Purchase · {humanize(p.state)}</Kicker>
          <h1 className="font-display mt-2 text-[clamp(1.8rem,3.6vw,2.8rem)] leading-[1.06]">
            {p.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <HealthStamp health={p.twinHealth} />
            {p.isDemo ? <SimulatedTag /> : null}
          </div>
        </div>
        <ButtonLink href={`/twins/${p.twinId}`} size="lg">
          Open PromiseTwin →
        </ButtonLink>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <Sheet className="p-5 lg:col-span-2">
          <Kicker>Confirmed intent · v{p.intent.compilerVersion}</Kicker>
          <blockquote className="font-display mt-3 border-l-2 border-ink pl-4 text-[19px] leading-snug text-ink">
            “{p.intent.rawText}”
          </blockquote>
          <Dl
            className="mt-5"
            items={[
              ['Quantity', `${spec.quantity} ${spec.productLabel.toLowerCase()}`],
              ['Must be', spec.requiredAttributes.join(', ') || '—'],
              ['Must not be', spec.prohibitedAttributes.join(', ') || '—'],
              ['Budget', `≤ ${money(spec.budgetMinor, spec.currency)}`],
              ['Deadline', `${when(spec.deadlineISO, spec.timezone)} (buyer requirement)`],
              ['Confirmed', when(p.intent.confirmedAt, spec.timezone)],
            ]}
          />
        </Sheet>
        <div className="space-y-6">
          <Sheet className="p-5">
            <Kicker>Seller commitment</Kicker>
            {p.commitment ? (
              <div className="mt-2 space-y-1 text-sm">
                <p className="text-ink">
                  {p.commitment.merchantName} accepted v{p.commitment.version}
                </p>
                <p className="text-muted">
                  Deliver by{' '}
                  {when(p.commitment.terms.deliverBy, p.commitment.terms.deliveryTimezone)}
                </p>
                <p className="tabular text-muted">
                  {money(p.commitment.terms.totalMinor, p.commitment.terms.currency)}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted">
                No merchant has accepted these terms yet. Merchant acceptance arrives with the
                merchant workspace.
              </p>
            )}
          </Sheet>
          <Sheet className="p-5">
            <div className="flex items-center justify-between">
              <Kicker>PayPal</Kicker>
              <Chip>{humanize(p.payment.status)}</Chip>
            </div>
            <p className="mt-2 text-sm text-muted">{p.payment.note}</p>
          </Sheet>
        </div>
      </div>

      {offers.isLoading ? (
        <LoadingSheet label="Solving offers" />
      ) : offers.isError || !offers.data ? (
        <StateBlock
          tone="breach"
          title="Offers could not be computed."
          action={
            <Button variant="secondary" onClick={() => void offers.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(offers.error)}
        </StateBlock>
      ) : (
        <OfferBoard data={offers.data} timezone={spec.timezone} />
      )}
    </div>
  );
}
