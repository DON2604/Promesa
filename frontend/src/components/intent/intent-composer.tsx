'use client';

import clsx from 'clsx';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useRef, useState } from 'react';
import {
  ATTRIBUTES,
  isValidTimeZone,
  PRODUCT_KIND_LABELS,
  PRODUCT_KINDS,
  type Attribute,
  type CompileIntentResponse,
  type IntentDraft,
  type ProductKind,
} from '@promesa/contracts';
import { api, errorMessage } from '@/lib/api';
import { money, when } from '@/lib/format';
import { useAnimeScope } from '@/lib/motion';
import {
  budgetToInput,
  draftToSpec,
  inputToBudget,
  isoToWallInput,
  segmentsFromSpans,
  wallInputToIso,
} from '@/lib/intent-draft';
import { Button, Chip, Kicker, Sheet, StateBlock } from '@/components/ui';
import { PromiseFold } from './promise-fold';
import { VoiceInput } from './voice-input';

type Mode = 'purchase' | 'mission';

const EXAMPLES: Record<Mode, Array<{ label: string; text: string }>> = {
  purchase: [
    {
      label: 'Bakery boxes',
      text: 'I need 100 food-safe paper boxes delivered before Friday 5 PM EST for under $100. No plastic.',
    },
    {
      label: 'Compostable containers',
      text: 'Need 60 compostable food containers by Thursday noon, budget $90, no plastic.',
    },
  ],
  mission: [
    {
      label: 'Shelter hygiene kits',
      text: 'Our shelter needs 30 fragrance-free hygiene kits by Friday at 6 p.m., total budget $175, no fragrances.',
    },
  ],
};

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'UTC',
];

const FIELD_LABEL: Record<string, string> = {
  quantity: 'Quantity',
  productKind: 'Product',
  requiredAttributes: 'Must be',
  prohibitedAttributes: 'Must not be',
  budgetMinor: 'Budget',
  deadlineISO: 'Deadline',
};

export function IntentComposer({
  mode,
  defaultTimezone,
  preferences,
}: {
  mode: Mode;
  defaultTimezone: string;
  /** Saved organization rules; offered as text so they go through the same compiler and review. */
  preferences?: { requiredAttributes: string[]; prohibitedAttributes: string[]; notes?: string };
}) {
  const router = useRouter();
  const ids = useId();
  const [rawText, setRawText] = useState('');
  const [timezone, setTimezone] = useState(
    isValidTimeZone(defaultTimezone) ? defaultTimezone : 'America/New_York',
  );
  const [compiled, setCompiled] = useState<CompileIntentResponse | null>(null);
  const [compiledText, setCompiledText] = useState('');
  const [draft, setDraft] = useState<IntentDraft | null>(null);
  const [title, setTitle] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [compileCount, setCompileCount] = useState(0);

  const compile = useMutation({
    mutationFn: () =>
      api<CompileIntentResponse>('/v1/intent/compile', {
        method: 'POST',
        body: {
          rawText,
          buyerType: mode === 'mission' ? 'ORG' : 'BUSINESS',
          currency: 'USD',
          timezone,
        },
      }),
    onSuccess: (res) => {
      setCompiled(res);
      setCompiledText(rawText);
      setDraft(res.draft);
      setConfirmed(false);
      setCompileCount((n) => n + 1);
      if (mode === 'mission' && !title)
        setTitle(
          res.draft.productLabel
            ? `${res.draft.quantity ?? ''} ${res.draft.productLabel}`.trim()
            : '',
        );
    },
  });

  const { spec, issues } = useMemo(
    () => (draft ? draftToSpec(draft) : { spec: null, issues: [] }),
    [draft],
  );
  const stale = compiled !== null && rawText !== compiledText;

  const create = useMutation({
    mutationFn: async () => {
      if (!spec || !compiled) throw new Error('The intent is incomplete.');
      const body = {
        rawText: compiledText,
        intent: spec,
        confirmed: true,
        compilerVersion: compiled.compiler.compilerVersion,
      };
      if (mode === 'mission') {
        const res = await api<{ missionId: string }>('/v1/missions', {
          method: 'POST',
          body: { ...body, title },
        });
        return `/missions/${res.missionId}`;
      }
      const res = await api<{ purchaseId: string; twinId: string }>('/v1/purchases', {
        method: 'POST',
        body,
      });
      return `/purchases/${res.purchaseId}`;
    },
    onSuccess: (href) => router.push(href),
  });

  const update = (patch: Partial<IntentDraft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setConfirmed(false);
  };

  const segments = compiled ? segmentsFromSpans(compiledText, compiled.sourceSpans) : [];
  const titleOk = mode !== 'mission' || title.trim().length >= 3;
  const canCreate = !!spec && confirmed && !stale && titleOk && !create.isPending;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* Compose */}
      <Sheet className="p-5 sm:p-7">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            compile.mutate();
          }}
        >
          <Kicker>Step 1 · Describe the need</Kicker>
          <label htmlFor={`${ids}-raw`} className="font-display mt-2 block text-2xl">
            {mode === 'mission'
              ? 'What does your community need?'
              : 'What do you need, and by when?'}
          </label>
          <textarea
            id={`${ids}-raw`}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={5}
            maxLength={2000}
            placeholder={EXAMPLES[mode][0]?.text}
            className="mt-4 w-full resize-y rounded-[var(--radius-control)] border border-hairline-strong bg-paper-2 p-4 text-[16px] leading-relaxed text-ink placeholder:text-muted/70 focus:border-ink focus:outline-none"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Try:</span>
            {EXAMPLES[mode].map((ex) => (
              <button
                key={ex.label}
                type="button"
                onClick={() => setRawText(ex.text)}
                className="rounded-full border border-hairline-strong px-3 py-1 text-xs text-ink hover:border-ink"
              >
                {ex.label}
              </button>
            ))}
            <span className="ml-auto">
              <VoiceInput onTranscript={(t) => setRawText((cur) => (cur ? `${cur} ${t}` : t))} />
            </span>
          </div>
          {preferences &&
          (preferences.requiredAttributes.length > 0 ||
            preferences.prohibitedAttributes.length > 0) ? (
            <div className="mt-4 rounded-md border border-signal/30 bg-signal-soft p-3 text-[13px]">
              <p className="font-medium text-signal-strong">Saved purchasing preferences</p>
              <p className="mt-0.5 text-ink">
                {preferences.requiredAttributes.length
                  ? `Always ${preferences.requiredAttributes.join(', ')}. `
                  : ''}
                {preferences.prohibitedAttributes.length
                  ? `Never ${preferences.prohibitedAttributes.join(', ')}.`
                  : ''}
                {preferences.notes ? ` ${preferences.notes}` : ''}
              </p>
              <button
                type="button"
                className="mt-1.5 text-signal hover:underline"
                onClick={() => {
                  const parts = [
                    ...preferences.requiredAttributes.filter(
                      (a) => !rawText.toLowerCase().includes(a.toLowerCase()),
                    ),
                  ];
                  const no = preferences.prohibitedAttributes
                    .filter(
                      (a) => !rawText.toLowerCase().includes(a.toLowerCase().replace(/d$/, '')),
                    )
                    .map((a) => `no ${a.replace(/ed$/, 'es')}`);
                  const add = [parts.length ? `must be ${parts.join(' and ')}` : '', ...no]
                    .filter(Boolean)
                    .join(', ');
                  if (add)
                    setRawText(
                      (cur) => `${cur.trim().replace(/\.$/, '')}${cur.trim() ? ', ' : ''}${add}.`,
                    );
                }}
              >
                Apply to this request
              </button>
            </div>
          ) : null}
          <div className="mt-5 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor={`${ids}-tz`} className="block text-xs text-muted">
                Deadline time zone (used when your text does not name one)
              </label>
              <select
                id={`${ids}-tz`}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="mt-1 h-10 rounded-[var(--radius-control)] border border-hairline-strong bg-paper px-3 text-sm"
              >
                {[...new Set([timezone, ...TIMEZONES])].map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="submit"
              size="md"
              busy={compile.isPending}
              disabled={rawText.trim().length < 8}
              className="ml-auto"
            >
              {compiled ? 'Recompile' : 'Compile intent'}
            </Button>
          </div>
          {compile.isError ? (
            <p role="alert" className="mt-3 text-sm text-breach">
              {errorMessage(compile.error)}
            </p>
          ) : null}
        </form>

        {compiled ? (
          <div className="mt-8 border-t border-hairline pt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Kicker>Where each constraint came from</Kicker>
              <span className="font-mono text-[10.5px] text-muted">
                {compiled.compiler.provider} · {compiled.compiler.compilerVersion}
              </span>
            </div>
            <p className="mt-3 text-[16px] leading-[1.9] text-ink">
              {segments.map((s, i) =>
                s.field ? (
                  <mark
                    key={i}
                    className="span-mark"
                    data-field={s.field}
                    title={FIELD_LABEL[s.field]}
                  >
                    {s.text}
                  </mark>
                ) : (
                  <span key={i}>{s.text}</span>
                ),
              )}
            </p>
            <ul
              className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted"
              aria-label="Highlight legend"
            >
              {Object.entries(FIELD_LABEL)
                .filter(
                  ([f]) => compiled.sourceSpans[f as keyof typeof compiled.sourceSpans]?.length,
                )
                .map(([f, label]) => (
                  <li key={f} className="inline-flex items-center gap-1.5">
                    <mark className="span-mark px-1.5" data-field={f}>
                      {label}
                    </mark>
                  </li>
                ))}
            </ul>
            {stale ? (
              <p className="mt-4 text-sm text-caution">
                ▲ The text changed since it was compiled. Recompile before confirming.
              </p>
            ) : null}
            {compiled.ignoredInstructions.length > 0 ? (
              <div className="mt-4 rounded-md border border-breach/40 bg-breach-soft p-3 text-sm">
                <p className="font-medium text-ink">Ignored instructions</p>
                <p className="text-muted">
                  These parts of the request tried to change how Promesa behaves. They were treated
                  as text, not commands.
                </p>
                <ul className="mt-2 list-disc pl-5 text-ink">
                  {compiled.ignoredInstructions.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </Sheet>

      {/* Review & confirm */}
      <div className="space-y-6">
        {!draft || !compiled ? (
          <div className="cutout p-6 sm:p-8">
            <Kicker>Step 2 · Review the promise</Kicker>
            <p className="font-display mt-2 text-2xl text-ink">
              Your constraints will appear here, folded like a contract.
            </p>
            <p className="mt-3 text-sm text-muted">
              Nothing is bought or reserved by compiling. You will review every field, see the
              assumptions Promesa made, and confirm explicitly.
            </p>
          </div>
        ) : (
          <>
            <PromiseFold
              summary={<PromiseSummary draft={draft} />}
              status={issues.length === 0 ? 'complete' : 'incomplete'}
            >
              <ConstraintEditor key={compileCount} draft={draft} update={update} ids={ids} />
            </PromiseFold>

            {mode === 'mission' ? <MissionBlueprint draft={draft} complete={!!spec} /> : null}

            {issues.length > 0 ? (
              <div
                role="status"
                className="rounded-md border border-caution/40 bg-caution-soft p-4 text-sm"
              >
                <p className="font-medium text-ink">Needs your input</p>
                <ul className="mt-1 list-disc pl-5 text-ink">
                  {[...new Set(issues)].map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {draft.assumptions.length > 0 || draft.unresolvedQuestions.length > 0 ? (
              <Sheet className="p-5">
                <Kicker>Assumptions Promesa made</Kicker>
                <ul className="mt-3 space-y-2 text-sm text-ink">
                  {draft.assumptions.map((a) => (
                    <li key={a} className="flex gap-2">
                      <span aria-hidden className="text-muted">
                        —
                      </span>
                      {a}
                    </li>
                  ))}
                  {draft.unresolvedQuestions.map((q) => (
                    <li key={q} className="flex gap-2 text-caution">
                      <span aria-hidden>?</span>
                      {q}
                    </li>
                  ))}
                </ul>
              </Sheet>
            ) : null}

            <Sheet className="p-5 sm:p-6">
              <Kicker>Step 3 · Confirm</Kicker>
              {mode === 'mission' ? (
                <div className="mt-3">
                  <label htmlFor={`${ids}-title`} className="block text-sm text-ink">
                    Mission title
                  </label>
                  <input
                    id={`${ids}-title`}
                    value={title}
                    maxLength={120}
                    onChange={(e) => setTitle(e.target.value)}
                    className="mt-1 h-10 w-full rounded-[var(--radius-control)] border border-hairline-strong bg-paper px-3 text-sm"
                  />
                </div>
              ) : null}
              <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                <div className="rounded-md border border-hairline p-3">
                  <p className="kicker">You request</p>
                  <p className="mt-1 text-ink">
                    {spec
                      ? `${spec.quantity} ${spec.productLabel.toLowerCase()} · ≤ ${money(spec.budgetMinor)} · before ${when(spec.deadlineISO, spec.timezone)}`
                      : 'Incomplete'}
                  </p>
                </div>
                <div className="rounded-md border border-dashed border-hairline-strong p-3">
                  <p className="kicker">Seller accepted</p>
                  <p className="mt-1 text-muted">
                    Not yet. Your deadline becomes a seller commitment only when a merchant accepts
                    these exact terms.
                  </p>
                </div>
              </div>
              <label className="mt-5 flex items-start gap-3 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={!spec || stale}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5 size-4 accent-[var(--ink)]"
                />
                <span>
                  I confirm these constraints. Promesa will{' '}
                  {mode === 'mission'
                    ? 'plan offers for this mission'
                    : 'look for merchants who accept them and open a PromiseTwin'}
                  . Nothing is paid until I approve a PayPal checkout.
                </span>
              </label>
              {create.isError ? (
                <p role="alert" className="mt-3 text-sm text-breach">
                  {errorMessage(create.error)}
                </p>
              ) : null}
              <div className="mt-5 flex justify-end">
                <Button
                  size="lg"
                  disabled={!canCreate}
                  busy={create.isPending}
                  onClick={() => create.mutate()}
                >
                  {mode === 'mission' ? 'Create mission' : 'Create purchase & PromiseTwin'}
                </Button>
              </div>
            </Sheet>
          </>
        )}
        {compile.isPending && !compiled ? <StateBlock title="Compiling your request…" /> : null}
      </div>
    </div>
  );
}

function PromiseSummary({ draft }: { draft: IntentDraft }) {
  return (
    <div>
      <p className="font-display text-[26px] leading-tight text-ink">
        {draft.quantity ?? '—'}{' '}
        {draft.productLabel ??
          (draft.productKind ? PRODUCT_KIND_LABELS[draft.productKind] : 'items')}
      </p>
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {draft.requiredAttributes.map((a) => (
          <Chip key={a} tone="good">
            {a}
          </Chip>
        ))}
        {draft.prohibitedAttributes.map((a) => (
          <Chip key={a} tone="breach">
            no {a}
          </Chip>
        ))}
      </ul>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="kicker">Budget</dt>
          <dd className="tabular mt-0.5 text-ink">
            {draft.budgetMinor ? `≤ ${money(draft.budgetMinor)}` : 'Missing'}
          </dd>
        </div>
        <div>
          <dt className="kicker">Deadline</dt>
          <dd className="mt-0.5 text-ink">
            {draft.deadlineISO ? when(draft.deadlineISO, draft.timezone) : 'Missing'}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function AttributePicker({
  label,
  value,
  other,
  tone,
  onChange,
}: {
  label: string;
  value: Attribute[];
  other: Attribute[];
  tone: 'good' | 'breach';
  onChange: (v: Attribute[]) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm text-ink">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {ATTRIBUTES.map((a) => {
          const on = value.includes(a);
          const blocked = other.includes(a);
          return (
            <button
              key={a}
              type="button"
              aria-pressed={on}
              disabled={blocked}
              onClick={() => onChange(on ? value.filter((x) => x !== a) : [...value, a])}
              title={blocked ? 'Already used in the other list' : undefined}
              className={clsx(
                'rounded-full border px-2.5 py-1 text-xs disabled:opacity-35',
                on
                  ? tone === 'good'
                    ? 'border-good bg-good-soft text-good'
                    : 'border-breach bg-breach-soft text-breach'
                  : 'border-hairline-strong text-muted hover:border-ink hover:text-ink',
              )}
            >
              {on ? (tone === 'good' ? '✓ ' : '✕ ') : ''}
              {a}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function ConstraintEditor({
  draft,
  update,
  ids,
}: {
  draft: IntentDraft;
  update: (p: Partial<IntentDraft>) => void;
  ids: string;
}) {
  const [budgetText, setBudgetText] = useState(budgetToInput(draft.budgetMinor));
  const inputCls =
    'mt-1 h-10 w-full rounded-[var(--radius-control)] border border-hairline-strong bg-paper px-3 text-sm text-ink focus:border-ink focus:outline-none';
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[7rem_1fr]">
        <div>
          <label htmlFor={`${ids}-qty`} className="text-sm text-ink">
            Quantity
          </label>
          <input
            id={`${ids}-qty`}
            type="number"
            min={1}
            max={100000}
            inputMode="numeric"
            value={draft.quantity ?? ''}
            onChange={(e) =>
              update({ quantity: e.target.value ? Math.trunc(Number(e.target.value)) : null })
            }
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor={`${ids}-kind`} className="text-sm text-ink">
            Product
          </label>
          <select
            id={`${ids}-kind`}
            value={draft.productKind ?? ''}
            onChange={(e) => {
              const kind = (e.target.value || null) as ProductKind | null;
              update({ productKind: kind, productLabel: kind ? PRODUCT_KIND_LABELS[kind] : null });
            }}
            className={inputCls}
          >
            <option value="">Choose…</option>
            {PRODUCT_KINDS.map((k) => (
              <option key={k} value={k}>
                {PRODUCT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <AttributePicker
        label="Must be"
        tone="good"
        value={draft.requiredAttributes}
        other={draft.prohibitedAttributes}
        onChange={(v) => update({ requiredAttributes: v })}
      />
      <AttributePicker
        label="Must not be"
        tone="breach"
        value={draft.prohibitedAttributes}
        other={draft.requiredAttributes}
        onChange={(v) => update({ prohibitedAttributes: v })}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${ids}-budget`} className="text-sm text-ink">
            Maximum total (USD)
          </label>
          <input
            id={`${ids}-budget`}
            inputMode="decimal"
            value={budgetText}
            onChange={(e) => {
              setBudgetText(e.target.value);
              update({ budgetMinor: inputToBudget(e.target.value) });
            }}
            className={clsx(inputCls, 'tabular')}
            aria-describedby={`${ids}-budget-hint`}
          />
          <p id={`${ids}-budget-hint`} className="mt-1 text-xs text-muted">
            Including delivery. Promesa never exceeds it without asking.
          </p>
        </div>
        <div>
          <label htmlFor={`${ids}-deadline`} className="text-sm text-ink">
            Delivered before ({draft.timezone})
          </label>
          <input
            id={`${ids}-deadline`}
            type="datetime-local"
            value={isoToWallInput(draft.deadlineISO, draft.timezone)}
            onChange={(e) =>
              update({ deadlineISO: wallInputToIso(e.target.value, draft.timezone) })
            }
            className={inputCls}
          />
        </div>
      </div>
    </div>
  );
}

/** Mission Blueprint: the confirmed need laid out as rules plus the procurement strategy. */
function MissionBlueprint({ draft, complete }: { draft: IntentDraft; complete: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useAnimeScope(
    root,
    ({ animate, stagger }) => {
      animate('[data-bp-row]', {
        opacity: [0, 1],
        translateX: [-8, 0],
        duration: 420,
        delay: stagger(45),
        ease: 'out(3)',
      });
    },
    `${draft.quantity}:${draft.budgetMinor}:${draft.deadlineISO}`,
  );
  const hard: string[] = [
    draft.quantity ? `${draft.quantity} ${draft.productLabel?.toLowerCase() ?? draft.unit}` : '',
    draft.budgetMinor ? `Total ≤ ${money(draft.budgetMinor)}` : '',
    draft.deadlineISO ? `Delivered before ${when(draft.deadlineISO, draft.timezone)}` : '',
    ...draft.requiredAttributes.map((a) => `Must be ${a.replace(/_/g, ' ')}`),
    ...draft.prohibitedAttributes.map((a) => `Must not be ${a.replace(/_/g, ' ')}`),
  ].filter(Boolean);
  const strategy = [
    'Discover listings from connected merchant catalogs (Channel3 not configured).',
    'Exclude any listing that breaks a hard rule, with the reason shown.',
    'Split the quantity across merchants for the lowest total within budget.',
    'Optionally publish to the marketplace so merchants can offer and sponsors can fund.',
    'One PayPal order per merchant; a sponsor approves each one.',
  ];
  return (
    <Sheet className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Kicker>Mission Blueprint</Kicker>
        <Chip tone={complete ? 'good' : 'caution'}>
          {complete ? 'Ready to confirm' : 'Incomplete'}
        </Chip>
      </div>
      <div ref={root} className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <p className="kicker">Hard rules · never broken</p>
          <ul className="mt-2 space-y-1.5">
            {hard.map((h) => (
              <li key={h} data-bp-row className="flex gap-2 text-ink">
                <span aria-hidden className="text-signal">
                  ■
                </span>
                {h}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="kicker">Soft preferences · traded off</p>
          <ul className="mt-2 space-y-1.5">
            {(draft.softPreferences.length
              ? draft.softPreferences
              : ['None stated — cost wins ties.']
            ).map((s) => (
              <li key={s} data-bp-row className="flex gap-2 text-muted">
                <span aria-hidden>◇</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-4 border-t border-hairline pt-3">
        <p className="kicker">Procurement strategy</p>
        <ol className="mt-2 space-y-1 text-[13px] text-ink">
          {strategy.map((s, i) => (
            <li key={s} data-bp-row className="flex gap-2">
              <span className="font-mono text-muted">{String(i + 1).padStart(2, '0')}</span>
              {s}
            </li>
          ))}
        </ol>
      </div>
    </Sheet>
  );
}
