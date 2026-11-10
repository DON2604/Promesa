'use client';

import { useEffect, useState } from 'react';
import type { OrgProfileView } from '@promesa/contracts';
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
import { money, shortWhen } from '@/lib/format';
import { useMe, useOrgProfile, useOrgSettings } from '@/lib/queries';

const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const input =
  'mt-1 h-9 w-full rounded-md border border-hairline-strong bg-paper px-2.5 text-sm text-ink focus:border-signal';

function Verification({ profile, canEdit }: { profile: OrgProfileView; canEdit: boolean }) {
  const { verify } = useOrgSettings();
  const [f, setF] = useState({
    legalName: profile.name,
    registrationId: '',
    city: profile.publicProfile.city ?? '',
    missionStatement: profile.publicProfile.missionStatement ?? '',
  });
  const v = profile.verification;
  return (
    <Sheet className="p-5">
      <SectionHeading
        kicker="Trust"
        title="Organization verification"
        aside={
          v.status === 'VERIFIED' ? (
            <Chip tone="good">✓ Verified · {v.method}</Chip>
          ) : (
            <Chip tone="caution">Unverified</Chip>
          )
        }
      />
      <p className="mt-2 text-[13px] text-muted">
        Only verified organizations can publish missions to the marketplace. In this demo,
        verification is a recorded <strong>DEMO_REVIEW</strong>: no external charity or business
        registry is queried, and verification does not imply tax-deductible status.
      </p>
      {v.status === 'VERIFIED' ? (
        <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
          <dt className="text-muted">Verified</dt>
          <dd>{shortWhen(v.verifiedAt, 'America/New_York')}</dd>
          <dt className="text-muted">Note</dt>
          <dd>{v.note}</dd>
          <dt className="text-muted">Public city</dt>
          <dd>{profile.publicProfile.city ?? '—'}</dd>
          <dt className="text-muted">Statement</dt>
          <dd>{profile.publicProfile.missionStatement ?? '—'}</dd>
        </dl>
      ) : canEdit ? (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            verify.mutate(f);
          }}
        >
          {(
            [
              ['legalName', 'Legal name'],
              ['registrationId', 'Registration ID'],
              ['city', 'City (shown publicly)'],
              ['missionStatement', 'Mission statement (shown publicly)'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="text-[12px] text-muted">
              {label}
              <input
                className={input}
                value={f[k]}
                onChange={(e) => setF({ ...f, [k]: e.target.value })}
              />
            </label>
          ))}
          <div className="sm:col-span-2">
            <Button type="submit" busy={verify.isPending}>
              Submit for verification
            </Button>
            {verify.isError ? (
              <p role="alert" className="mt-2 text-sm text-breach">
                {errorMessage(verify.error)}
              </p>
            ) : null}
          </div>
        </form>
      ) : (
        <p className="mt-3 text-sm text-muted">An organization admin can request verification.</p>
      )}
    </Sheet>
  );
}

function Preferences({ profile, sponsor }: { profile: OrgProfileView; sponsor: boolean }) {
  const { preferences } = useOrgSettings();
  const p = profile.preferences;
  const [req, setReq] = useState(p.requiredAttributes.join(', '));
  const [proh, setProh] = useState(p.prohibitedAttributes.join(', '));
  const [budget, setBudget] = useState(
    p.defaultBudgetMinor ? String(Number(p.defaultBudgetMinor) / 100) : '',
  );
  const [notes, setNotes] = useState(p.notes ?? '');
  const [cats, setCats] = useState(p.categories.join(', '));
  const [maxOrder, setMaxOrder] = useState(
    p.maxOrderMinor ? String(Number(p.maxOrderMinor) / 100) : '',
  );
  useEffect(() => {
    setReq(p.requiredAttributes.join(', '));
    setProh(p.prohibitedAttributes.join(', '));
  }, [p.requiredAttributes, p.prohibitedAttributes]);
  return (
    <Sheet className="p-5">
      <SectionHeading
        kicker={sponsor ? 'Funding interests' : 'Purchasing preferences'}
        title={sponsor ? 'What you like to fund' : 'Saved rules for new missions'}
      />
      <p className="mt-2 text-[13px] text-muted">
        {sponsor
          ? 'Used to score and sort missions in Explore. Matching explains itself and never funds anything on your behalf.'
          : 'Mission Studio pre-fills these rules. You still confirm every mission before agents run.'}
      </p>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          preferences.mutate({
            requiredAttributes: list(req),
            prohibitedAttributes: list(proh),
            defaultBudgetMinor: budget ? String(Math.round(Number(budget) * 100)) : undefined,
            notes: notes || undefined,
            categories: list(cats),
            maxOrderMinor: maxOrder ? String(Math.round(Number(maxOrder) * 100)) : undefined,
          });
        }}
      >
        {sponsor ? (
          <>
            <label className="text-[12px] text-muted">
              Categories (comma-separated)
              <input className={input} value={cats} onChange={(e) => setCats(e.target.value)} />
            </label>
            <label className="text-[12px] text-muted">
              Max per order ($)
              <input
                className={input}
                inputMode="decimal"
                value={maxOrder}
                onChange={(e) => setMaxOrder(e.target.value)}
              />
            </label>
          </>
        ) : (
          <>
            <label className="text-[12px] text-muted">
              Always required
              <input className={input} value={req} onChange={(e) => setReq(e.target.value)} />
            </label>
            <label className="text-[12px] text-muted">
              Never allowed
              <input className={input} value={proh} onChange={(e) => setProh(e.target.value)} />
            </label>
            <label className="text-[12px] text-muted">
              Default budget ($)
              <input
                className={input}
                inputMode="decimal"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
            </label>
            <label className="text-[12px] text-muted">
              Notes for agents
              <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </>
        )}
        <div className="sm:col-span-2 flex items-center gap-3">
          <Button type="submit" busy={preferences.isPending}>
            Save
          </Button>
          {preferences.isSuccess ? <span className="text-sm text-good">Saved.</span> : null}
          {preferences.isError ? (
            <span role="alert" className="text-sm text-breach">
              {errorMessage(preferences.error)}
            </span>
          ) : null}
        </div>
      </form>
      {!sponsor && p.defaultBudgetMinor ? (
        <p className="mt-3 text-[12px] text-muted">
          Current default budget {money(p.defaultBudgetMinor)}.
        </p>
      ) : null}
    </Sheet>
  );
}

export default function SettingsPage() {
  const me = useMe();
  const profile = useOrgProfile();
  if (profile.isLoading || me.isLoading) return <LoadingSheet label="Loading settings" />;
  if (profile.isError || !profile.data || !me.data)
    return (
      <StateBlock tone="breach" title="Settings unavailable.">
        {errorMessage(profile.error)}
      </StateBlock>
    );
  const role = me.data.activeRole;
  const sponsor = role === 'SPONSOR';
  return (
    <div className="space-y-6">
      <header>
        <Kicker>Settings · {profile.data.name}</Kicker>
        <h1 className="font-display mt-2 text-[clamp(1.8rem,3.4vw,2.6rem)] leading-tight">
          Trust & preferences
        </h1>
      </header>
      {profile.data.kind === 'ORG' ? (
        <Verification profile={profile.data} canEdit={role === 'ORG_ADMIN'} />
      ) : null}
      {role === 'ORG_ADMIN' || sponsor || role === 'BUYER' ? (
        <Preferences profile={profile.data} sponsor={sponsor} />
      ) : (
        <StateBlock title="Preferences are managed by your organization admin." />
      )}
    </div>
  );
}
