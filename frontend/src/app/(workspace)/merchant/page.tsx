'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { MerchantWorkspaceView, ProposalView } from '@promesa/contracts';
import {
  Button,
  Chip,
  Kicker,
  LoadingSheet,
  SectionHeading,
  Sheet,
  StateBlock,
} from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { humanize, money, shortWhen } from '@/lib/format';
import { useMe, useMerchantWorkspace, useMissionActions, useProposalDecision } from '@/lib/queries';

const toMinor = (dollars: string) => String(Math.round(Number(dollars) * 100));

function OfferForm({
  opp,
  catalog,
}: {
  opp: MerchantWorkspaceView['opportunities'][number];
  catalog: MerchantWorkspaceView['catalog'];
}) {
  const actions = useMissionActions(opp.id);
  const compatible = opp.matchingProducts.filter((p) => p.compatible);
  const [productId, setProductId] = useState(compatible[0]?.productId ?? '');
  const listing = catalog.find((c) => c.productId === productId);
  const [qty, setQty] = useState(
    String(Math.min(opp.quantity, listing?.inventoryQty ?? opp.quantity)),
  );
  const [price, setPrice] = useState(
    listing ? (Number(listing.unitPriceMinor) / 100).toFixed(2) : '',
  );
  const [lead, setLead] = useState(String(listing?.leadTimeHours ?? 48));
  const [terms, setTerms] = useState(listing?.deliveryTerms ?? 'Local courier');
  const result = actions.propose.data;

  if (compatible.length === 0)
    return (
      <p className="text-[13px] text-muted">
        None of your listings meet the hard constraints:{' '}
        {opp.matchingProducts.flatMap((p) => p.reasons).join(' ')}
      </p>
    );
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1.4fr_0.6fr_0.7fr_0.6fr]"
      onSubmit={(e) => {
        e.preventDefault();
        actions.propose.mutate({
          catalogProductId: productId,
          quantity: Number(qty),
          unitPriceMinor: toMinor(price),
          leadTimeHours: Number(lead),
          deliveryTerms: terms,
        });
      }}
    >
      <label className="text-[12px] text-muted">
        Listing
        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          className="mt-1 h-9 w-full rounded-md border border-hairline-strong bg-paper px-2 text-sm text-ink"
        >
          {compatible.map((p) => (
            <option key={p.productId} value={p.productId}>
              {p.sku}
            </option>
          ))}
        </select>
      </label>
      <label className="text-[12px] text-muted">
        Units
        <input
          inputMode="numeric"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="tabular mt-1 h-9 w-full rounded-md border border-hairline-strong bg-paper px-2 text-sm text-ink"
        />
      </label>
      <label className="text-[12px] text-muted">
        Unit price ($)
        <input
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="tabular mt-1 h-9 w-full rounded-md border border-hairline-strong bg-paper px-2 text-sm text-ink"
        />
      </label>
      <label className="text-[12px] text-muted">
        Lead time (h)
        <input
          inputMode="numeric"
          value={lead}
          onChange={(e) => setLead(e.target.value)}
          className="tabular mt-1 h-9 w-full rounded-md border border-hairline-strong bg-paper px-2 text-sm text-ink"
        />
      </label>
      <label className="text-[12px] text-muted sm:col-span-3">
        Delivery terms
        <input
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          className="mt-1 h-9 w-full rounded-md border border-hairline-strong bg-paper px-2 text-sm text-ink"
        />
      </label>
      <div className="flex items-end">
        <Button type="submit" busy={actions.propose.isPending} className="w-full">
          Submit offer
        </Button>
      </div>
      {actions.propose.isError ? (
        <p role="alert" className="text-sm text-breach sm:col-span-4">
          {errorMessage(actions.propose.error)}
        </p>
      ) : null}
      {result ? (
        <p role="status" className="text-sm text-good sm:col-span-4">
          Offer sent. The organization’s Negotiation agent recommends:{' '}
          <strong>{humanize(result.recommendation)}</strong>. Nothing is agreed until both sides
          accept.
        </p>
      ) : null}
    </form>
  );
}

function ProposalRow({ p }: { p: ProposalView }) {
  const decide = useProposalDecision();
  return (
    <li className="grid gap-2 py-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
      <div>
        <p className="text-ink">
          {p.quantity} × {p.sku} at <span className="tabular">{money(p.unitPriceMinor)}</span>
          {p.counterUnitPriceMinor ? (
            <>
              {' '}
              → counter{' '}
              <span className="tabular font-medium">{money(p.counterUnitPriceMinor)}</span>
            </>
          ) : null}
        </p>
        <p className="text-[12px] text-muted">
          {humanize(p.state)} · list {money(p.listUnitPriceMinor)}
          {p.counterRationale ? ` · ${p.counterRationale}` : ''}
        </p>
      </div>
      <div className="flex gap-2">
        {p.allowedActions.includes('MERCHANT_ACCEPT') ? (
          <Button
            size="sm"
            busy={decide.isPending}
            onClick={() => decide.mutate({ proposalId: p.id, action: 'MERCHANT_ACCEPT' })}
          >
            Accept counter
          </Button>
        ) : null}
        {p.allowedActions.includes('MERCHANT_WITHDRAW') ? (
          <Button
            size="sm"
            variant="secondary"
            busy={decide.isPending}
            onClick={() => decide.mutate({ proposalId: p.id, action: 'MERCHANT_WITHDRAW' })}
          >
            Withdraw
          </Button>
        ) : null}
        {p.state === 'ACCEPTED' ? (
          <Chip tone="good">Agreed {money(p.agreedUnitPriceMinor)}</Chip>
        ) : null}
      </div>
    </li>
  );
}

export default function MerchantPage() {
  const me = useMe();
  const merchant =
    me.data?.activeRole === 'MERCHANT_ADMIN' || me.data?.activeRole === 'MERCHANT_OPERATOR';
  const ws = useMerchantWorkspace(merchant);
  if (!merchant)
    return (
      <StateBlock title="The merchant workspace is for merchant accounts.">
        Sign in as Dana (Beacon Basics) to submit offers.
      </StateBlock>
    );
  if (ws.isLoading) return <LoadingSheet label="Loading merchant workspace" />;
  if (ws.isError || !ws.data)
    return (
      <StateBlock tone="breach" title="Merchant workspace unavailable.">
        {errorMessage(ws.error)}
      </StateBlock>
    );
  const d = ws.data;
  return (
    <div className="space-y-10">
      <header>
        <Kicker>NeedMesh · Merchant offers</Kicker>
        <h1 className="font-display mt-2 text-[clamp(1.8rem,3.4vw,2.6rem)] leading-tight">
          {d.merchantName}
        </h1>
        <p className="mt-2 max-w-2xl text-[14px] text-muted">
          Published missions that match your listings. Offers go to the organization’s Negotiation
          agent; a deal exists only when both sides explicitly accept. Payment comes from the
          sponsor through PayPal when they approve the resulting order.
        </p>
      </header>

      <section className="space-y-4" aria-labelledby="opps">
        <SectionHeading
          id="opps"
          kicker="Demand"
          title={`Matching missions (${d.opportunities.length})`}
        />
        {d.opportunities.length === 0 ? (
          <StateBlock title="No published missions match your catalog right now." />
        ) : (
          d.opportunities.map((o) => (
            <Sheet key={o.id} className="p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-display text-xl">{o.title}</p>
                  <p className="text-[13px] text-muted">
                    {o.orgName} {o.orgVerified ? '· ✓ verified' : ''} · {o.quantity} {o.unit} ·
                    budget {money(o.budgetMinor, o.currency)} · by{' '}
                    {shortWhen(o.deadline, o.timezone)}
                  </p>
                </div>
                <Link href={`/missions/${o.id}`} className="text-sm text-signal hover:underline">
                  Mission →
                </Link>
              </div>
              <div className="mt-4 border-t border-hairline pt-4">
                <OfferForm opp={o} catalog={d.catalog} />
              </div>
            </Sheet>
          ))
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Sheet className="p-5">
          <SectionHeading kicker="Negotiation" title="Your offers" />
          {d.proposals.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No offers yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-hairline">
              {d.proposals.map((p) => (
                <ProposalRow key={p.id} p={p} />
              ))}
            </ul>
          )}
        </Sheet>
        <Sheet className="p-5">
          <SectionHeading kicker="Fulfillment" title="Your orders" />
          {d.orders.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No orders yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-hairline">
              {d.orders.map((o) => (
                <li
                  key={o.orderId}
                  className="flex items-center justify-between gap-3 py-3 text-sm"
                >
                  <div>
                    <p className="text-ink">
                      {o.quantity} × {o.sku} ·{' '}
                      <span className="tabular">{money(o.amountMinor, o.currency)}</span>
                    </p>
                    <p className="text-[12px] text-muted">{o.missionTitle}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Chip>{humanize(o.state)}</Chip>
                    <Link href={`/missions/${o.missionId}`} className="text-signal hover:underline">
                      Open
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Sheet>
      </div>

      <Sheet className="p-5">
        <SectionHeading kicker="Catalog" title="Your listings" />
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-[12px] text-muted">
            <tr>
              <th className="py-2 font-normal">SKU</th>
              <th className="py-2 font-normal">Title</th>
              <th className="py-2 text-right font-normal">Price</th>
              <th className="py-2 text-right font-normal">Stock</th>
              <th className="py-2 text-right font-normal">Lead</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {d.catalog.map((c) => (
              <tr key={c.productId}>
                <td className="py-2 font-mono text-[12px]">{c.sku}</td>
                <td className="py-2">{c.title}</td>
                <td className="tabular py-2 text-right">{money(c.unitPriceMinor)}</td>
                <td className="tabular py-2 text-right">{c.inventoryQty}</td>
                <td className="tabular py-2 text-right">{c.leadTimeHours}h</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[12px] text-muted">
          Demo fixtures. Inventory sync with live stores is a future integration.
        </p>
      </Sheet>
    </div>
  );
}
