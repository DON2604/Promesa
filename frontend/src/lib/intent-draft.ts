import {
  getZonedParts,
  IntentSpecSchema,
  majorStringToMinor,
  minorToMajorString,
  PRODUCT_KIND_LABELS,
  toZonedIso,
  zonedWallTimeToUtc,
  type CompileIntentResponse,
  type IntentDraft,
  type IntentField,
  type IntentSpec,
} from '@promesa/contracts';

export type Segment = { text: string; field: IntentField | null };

/** Splits raw text into plain and highlighted segments. Overlapping spans keep the earliest. */
export function segmentsFromSpans(
  rawText: string,
  spans: CompileIntentResponse['sourceSpans'],
): Segment[] {
  const flat: Array<{ start: number; end: number; field: IntentField }> = [];
  for (const [field, list] of Object.entries(spans) as Array<
    [IntentField, CompileIntentResponse['sourceSpans'][IntentField]]
  >) {
    for (const s of list ?? []) {
      if (s.start >= 0 && s.end <= rawText.length && s.end > s.start)
        flat.push({ start: s.start, end: s.end, field });
    }
  }
  flat.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Segment[] = [];
  let cursor = 0;
  for (const s of flat) {
    if (s.start < cursor) continue;
    if (s.start > cursor) out.push({ text: rawText.slice(cursor, s.start), field: null });
    out.push({ text: rawText.slice(s.start, s.end), field: s.field });
    cursor = s.end;
  }
  if (cursor < rawText.length) out.push({ text: rawText.slice(cursor), field: null });
  return out;
}

/** ISO instant → value for <input type="datetime-local"> expressed in `timeZone`. */
export function isoToWallInput(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  const p = getZonedParts(new Date(iso), timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** <input type="datetime-local"> value in `timeZone` → ISO with that zone's offset. */
export function wallInputToIso(value: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  return toZonedIso(
    zonedWallTimeToUtc({ year: y, month: mo, day: d, hour: h, minute: mi }, timeZone),
    timeZone,
  );
}

export function budgetToInput(minor: string | null): string {
  return minor ? minorToMajorString(minor, 'USD') : '';
}

export function inputToBudget(value: string): string | null {
  try {
    const minor = majorStringToMinor(value, 'USD');
    return minor > 0n ? minor.toString() : null;
  } catch {
    return null;
  }
}

/** Human-readable hard constraints, regenerated from structured fields so edits never go stale. */
export function describeConstraints(draft: IntentDraft): string[] {
  const out: string[] = [];
  if (draft.quantity && draft.productLabel)
    out.push(`Quantity: ${draft.quantity} ${draft.productLabel.toLowerCase()}`);
  if (draft.requiredAttributes.length) out.push(`Must be: ${draft.requiredAttributes.join(', ')}`);
  if (draft.prohibitedAttributes.length)
    out.push(`Must not be: ${draft.prohibitedAttributes.join(', ')}`);
  if (draft.budgetMinor)
    out.push(
      `Total at most ${minorToMajorString(draft.budgetMinor, draft.currency)} ${draft.currency}`,
    );
  if (draft.deadlineISO) out.push(`Delivered before ${draft.deadlineISO} (${draft.timezone})`);
  return out;
}

/** Validates an edited draft against the same schema the API enforces. */
export function draftToSpec(draft: IntentDraft): { spec: IntentSpec | null; issues: string[] } {
  const issues: string[] = [];
  if (!draft.productKind) issues.push('Choose what you are buying.');
  if (!draft.quantity) issues.push('Enter a quantity.');
  if (!draft.budgetMinor) issues.push('Enter a maximum budget.');
  if (!draft.deadlineISO) issues.push('Choose a deadline.');
  if (issues.length > 0 || !draft.productKind) return { spec: null, issues };

  const productLabel = draft.productLabel ?? PRODUCT_KIND_LABELS[draft.productKind];
  const candidate = {
    ...draft,
    productLabel,
    hardConstraints: describeConstraints({ ...draft, productLabel }),
  };
  const parsed = IntentSpecSchema.safeParse(candidate);
  if (!parsed.success) return { spec: null, issues: parsed.error.issues.map((i) => i.message) };
  return { spec: parsed.data, issues: [] };
}
