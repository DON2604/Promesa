import {
  type Attribute,
  type CompileIntentResponse,
  type IntentDraft,
  type IntentField,
  type ProductKind,
  type SourceSpan,
  formatInZone,
  formatMoney,
  getZonedParts,
  isValidTimeZone,
  majorStringToMinor,
  nextWeekdayDate,
  zonedWallTimeToUtc,
  toZonedIso,
} from '@promesa/contracts';

/**
 * Deterministic intent parser. Used by the fixture LLM provider (offline demo + CI) and as the
 * cross-check for real model output. It extracts only what the text states and records the
 * exact character span for every extracted field so the UI can show where each constraint came from.
 */

export const PARSER_VERSION = 'intent-parser@1.0.0';

type Spans = Partial<Record<IntentField, SourceSpan[]>>;

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const ZONE_ABBREVIATIONS: Record<string, string> = {
  et: 'America/New_York',
  est: 'America/New_York',
  edt: 'America/New_York',
  ct: 'America/Chicago',
  cst: 'America/Chicago',
  cdt: 'America/Chicago',
  mt: 'America/Denver',
  pt: 'America/Los_Angeles',
  pst: 'America/Los_Angeles',
  pdt: 'America/Los_Angeles',
};

const POSITIVE_ATTRIBUTES: Array<{ pattern: RegExp; attribute: Attribute }> = [
  { pattern: /\bfood[\s-]?(?:safe|grade)\b/gi, attribute: 'food-safe' },
  { pattern: /\b(?<!no[\s-])(?<!not[\s-])paper(?:board)?\b/gi, attribute: 'paper' },
  { pattern: /\bkraft\b/gi, attribute: 'kraft' },
  { pattern: /\brecyclable\b/gi, attribute: 'recyclable' },
  { pattern: /\bcompostable\b/gi, attribute: 'compostable' },
  { pattern: /\breusable\b/gi, attribute: 'reusable' },
  { pattern: /\b(?:fragrance[\s-]?free|unscented)\b/gi, attribute: 'fragrance-free' },
  { pattern: /\balcohol[\s-]?free\b/gi, attribute: 'alcohol-free' },
  { pattern: /\bindividually[\s-]wrapped\b/gi, attribute: 'individually-wrapped' },
];

const NEGATED_ATTRIBUTES: Array<{
  pattern: RegExp;
  attribute: Attribute;
  alsoRequire?: Attribute;
}> = [
  {
    pattern: /\b(?:not|no|non|without|avoid|never)[\s-]+plastics?\b|\bplastic[\s-]free\b/gi,
    attribute: 'plastic',
  },
  {
    pattern: /\b(?:not|no|without|avoid)[\s-]+(?:fragrances?|scents?|perfumes?)\b/gi,
    attribute: 'fragranced',
    alsoRequire: 'fragrance-free',
  },
  { pattern: /\b(?:not|no|without|avoid)[\s-]+latex\b|\blatex[\s-]free\b/gi, attribute: 'latex' },
];

const PRODUCT_KINDS: Array<{ pattern: RegExp; kind: ProductKind }> = [
  { pattern: /\bhygiene[\s-]kits?\b/i, kind: 'hygiene-kit' },
  { pattern: /\b(?:packaging\s+)?boxes\b|\bbox(?:es)?\b|\bpackaging\b/i, kind: 'packaging-box' },
  { pattern: /\b(?:food\s+)?containers?\b/i, kind: 'food-container' },
];

const INJECTION_PATTERN =
  /\b(ignore (?:all |any |the |previous |prior )*(?:instructions|budget|rules|limits?)|issue (?:a )?refund|send (?:money|payment)|approve (?:the )?payment|transfer (?:funds|money)|change (?:the )?payee)\b[^.!?\n]*/gi;

function span(text: string, start: number, end: number): SourceSpan {
  return { start, end, text: text.slice(start, end) };
}

function addSpan(spans: Spans, field: IntentField, s: SourceSpan) {
  (spans[field] ??= []).push(s);
}

function to24h(
  hour: number,
  minute: number,
  meridiem: string | undefined,
): { hour: number; minute: number } | null {
  if (minute > 59) return null;
  const m = meridiem?.replace(/\./g, '').toLowerCase();
  if (m === 'pm' && hour < 12) hour += 12;
  if (m === 'am' && hour === 12) hour = 0;
  if (hour > 23) return null;
  return { hour, minute };
}

export type ParseContext = { now: Date; timezone: string };

export function parseIntent(
  rawText: string,
  ctx: ParseContext,
): Omit<CompileIntentResponse, 'compiler' | 'validationIssues'> {
  const text = rawText.normalize('NFKC');
  const spans: Spans = {};
  const assumptions: string[] = [];
  const unresolved: string[] = [];
  const ignoredInstructions: string[] = [];

  // Untrusted instructions are data, never commands.
  for (const match of text.matchAll(INJECTION_PATTERN)) {
    ignoredInstructions.push(match[0].trim());
  }

  // ---- time zone (explicit IANA or common abbreviation overrides the profile zone)
  let timezone = ctx.timezone;
  const iana = /\b([A-Z][a-z]+\/[A-Z][A-Za-z_]+)\b/.exec(text);
  if (iana?.[1] && isValidTimeZone(iana[1])) {
    timezone = iana[1];
  } else {
    const abbr = /\b(ET|EST|EDT|CT|CST|CDT|MT|PT|PST|PDT)\b/.exec(text);
    if (abbr?.[1]) {
      const zone = ZONE_ABBREVIATIONS[abbr[1].toLowerCase()];
      if (zone) {
        timezone = zone;
        assumptions.push(`"${abbr[1]}" interpreted as the ${zone} time zone.`);
      }
    }
  }

  // ---- budget
  let budgetMinor: string | null = null;
  const budgetPattern =
    /(under|below|less than|max(?:imum)?(?: of)?|up to|no more than|at most|budget(?: of| is)?|total budget(?: of)?|within)?\s*(?:\$\s?|usd\s?)(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s*(?:usd|dollars)\b/gi;
  const budgetMatch = budgetPattern.exec(text);
  if (budgetMatch) {
    const amount = budgetMatch[2] ?? budgetMatch[3];
    if (amount) {
      try {
        budgetMinor = majorStringToMinor(amount, 'USD').toString();
        const amountStart = budgetMatch.index + budgetMatch[0].indexOf(amount);
        addSpan(
          spans,
          'budgetMinor',
          span(
            text,
            budgetMatch.index + (budgetMatch[0].length - budgetMatch[0].trimStart().length),
            amountStart + amount.length,
          ),
        );
        const qualifier = budgetMatch[1]?.toLowerCase();
        if (qualifier && ['under', 'below', 'less than'].includes(qualifier)) {
          assumptions.push(
            `"${qualifier} ${formatMoney(budgetMinor, 'USD')}" treated as a ceiling of ${formatMoney(budgetMinor, 'USD')} for the total, including shipping and tax.`,
          );
        } else if (!qualifier) {
          assumptions.push(
            `${formatMoney(budgetMinor, 'USD')} treated as the maximum total spend.`,
          );
        }
      } catch {
        budgetMinor = null;
      }
    }
  }
  if (!budgetMinor) unresolved.push('What is the maximum total you are willing to spend (USD)?');

  // ---- quantity: first integer followed by a word, excluding money and clock times
  let quantity: number | null = null;
  let productLabel: string | null = null;
  let unit = 'units';
  const quantityPattern =
    /(?<![$\d.,:])\b(\d{1,6})\s+(?!(?:a\.?m\.?|p\.?m\.?|usd|dollars|%|hours?|days?)\b)([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,5})/gi;
  for (const match of text.matchAll(quantityPattern)) {
    const before = text.slice(Math.max(0, match.index - 1), match.index);
    if (before === '$') continue;
    const n = Number(match[1]);
    if (!Number.isSafeInteger(n) || n <= 0) continue;
    quantity = n;
    addSpan(spans, 'quantity', span(text, match.index, match.index + (match[1]?.length ?? 0)));
    const phrase = (match[2] ?? '')
      .split(
        /\s+(?:by|under|before|for|delivered|that|not|no|with|within|at|on|and|total|budget|less|below|until)\b/i,
      )[0]
      ?.trim();
    if (phrase) {
      productLabel = phrase.replace(/[,.;]+$/, '');
      unit = productLabel.split(/\s+/).at(-1) ?? 'units';
    }
    break;
  }
  if (quantity === null) unresolved.push('How many units do you need?');

  // ---- product kind
  let productKind: ProductKind | null = null;
  for (const candidate of PRODUCT_KINDS) {
    const m = candidate.pattern.exec(text);
    if (m) {
      productKind = candidate.kind;
      addSpan(spans, 'productKind', span(text, m.index, m.index + m[0].length));
      break;
    }
  }
  if (!productKind) {
    unresolved.push(
      'Which product category is this? Supported in this demo: packaging boxes, hygiene kits, food containers.',
    );
  }

  // ---- attributes
  const prohibited = new Set<Attribute>();
  const required = new Set<Attribute>();
  const negatedRanges: Array<[number, number]> = [];
  for (const rule of NEGATED_ATTRIBUTES) {
    for (const m of text.matchAll(rule.pattern)) {
      prohibited.add(rule.attribute);
      if (rule.alsoRequire) required.add(rule.alsoRequire);
      negatedRanges.push([m.index, m.index + m[0].length]);
      addSpan(spans, 'prohibitedAttributes', span(text, m.index, m.index + m[0].length));
    }
  }
  for (const rule of POSITIVE_ATTRIBUTES) {
    for (const m of text.matchAll(rule.pattern)) {
      const inside = negatedRanges.some(([s, e]) => m.index >= s && m.index < e);
      if (inside) continue;
      required.add(rule.attribute);
      addSpan(spans, 'requiredAttributes', span(text, m.index, m.index + m[0].length));
    }
  }
  for (const attr of prohibited) required.delete(attr);

  // ---- deadline
  let deadlineISO: string | null = null;
  const timePart = String.raw`(?:[\s,]*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)|[\s,]*(?:at\s+)?(noon|midnight|end of day|eod))?`;
  const weekdayPattern = new RegExp(
    String.raw`\b(by|before|until|no later than|on)?\s*(today|tomorrow|${Object.keys(WEEKDAYS).join('|')})\b\.?` +
      timePart,
    'i',
  );
  const datePattern = new RegExp(
    String.raw`\b(by|before|until|no later than|on)?\s*(${Object.keys(MONTHS).join('|')})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b` +
      timePart,
    'i',
  );
  const isoPattern = /\b(by|before|until|on)?\s*(\d{4})-(\d{2})-(\d{2})\b/i;

  let day: { year: number; month: number; day: number } | null = null;
  let timeMatch: { hour: number; minute: number } | null = null;
  let deadlineSpan: SourceSpan | null = null;
  let qualifier: string | undefined;

  const wd = weekdayPattern.exec(text);
  const dm = datePattern.exec(text);
  const im = isoPattern.exec(text);
  const resolveTime = (m: RegExpExecArray, hIdx: number) => {
    const word = m[hIdx + 3]?.toLowerCase();
    if (word === 'noon') return { hour: 12, minute: 0 };
    if (word === 'midnight') return { hour: 23, minute: 59 };
    if (word === 'end of day' || word === 'eod') return { hour: 17, minute: 0 };
    if (m[hIdx]) return to24h(Number(m[hIdx]), Number(m[hIdx + 1] ?? 0), m[hIdx + 2]);
    return null;
  };

  if (im) {
    qualifier = im[1];
    day = { year: Number(im[2]), month: Number(im[3]), day: Number(im[4]) };
    deadlineSpan = span(text, im.index, im.index + im[0].length);
  } else if (dm) {
    qualifier = dm[1];
    const month = MONTHS[dm[2]!.toLowerCase()]!;
    let year = getZonedParts(ctx.now, timezone).year;
    const candidate = zonedWallTimeToUtc(
      { year, month, day: Number(dm[3]), hour: 23, minute: 59 },
      timezone,
    );
    if (candidate.getTime() < ctx.now.getTime()) year += 1;
    day = { year, month, day: Number(dm[3]) };
    timeMatch = resolveTime(dm, 4);
    deadlineSpan = span(text, dm.index, dm.index + dm[0].length);
  } else if (wd) {
    qualifier = wd[1];
    const word = wd[2]!.toLowerCase();
    timeMatch = resolveTime(wd, 3);
    if (word === 'today' || word === 'tomorrow') {
      const base = getZonedParts(ctx.now, timezone);
      const offset = word === 'tomorrow' ? 1 : 0;
      const d = new Date(Date.UTC(base.year, base.month - 1, base.day + offset));
      day = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
    } else {
      day = nextWeekdayDate(ctx.now, WEEKDAYS[word]!, timezone, true);
      const probe = zonedWallTimeToUtc(
        { ...day, hour: timeMatch?.hour ?? 17, minute: timeMatch?.minute ?? 0 },
        timezone,
      );
      if (probe.getTime() <= ctx.now.getTime())
        day = nextWeekdayDate(ctx.now, WEEKDAYS[word]!, timezone, false);
    }
    deadlineSpan = span(
      text,
      wd.index + (wd[0].length - wd[0].trimStart().length),
      wd.index + wd[0].length,
    );
  }

  if (day) {
    if (!timeMatch) {
      timeMatch = { hour: 17, minute: 0 };
      assumptions.push('No time of day was given, so the deadline is set to 17:00 local time.');
    }
    const instant = zonedWallTimeToUtc({ ...day, ...timeMatch }, timezone);
    deadlineISO = toZonedIso(instant, timezone);
    if (qualifier?.toLowerCase() === 'before') {
      assumptions.push(
        `"before" interpreted as "no later than ${formatInZone(instant, timezone)}". Edit the deadline if you need it earlier.`,
      );
    }
    if (deadlineSpan) addSpan(spans, 'deadlineISO', deadlineSpan);
    assumptions.push(
      'This deadline is your requirement. It becomes a seller promise only after a merchant explicitly accepts it.',
    );
  } else {
    unresolved.push(
      'When must the items arrive? Include a day and, ideally, a time and time zone.',
    );
  }

  // ---- soft preferences
  const softPreferences: string[] = [];
  for (const m of text.matchAll(
    /\b(?:prefer(?:ably)?|ideally|if possible|nice to have)\b[:,]?\s*([^.;,\n]+)/gi,
  )) {
    if (m[1]) softPreferences.push(m[1].trim());
  }

  const hardConstraints: string[] = [];
  if (quantity !== null) hardConstraints.push(`Quantity: exactly ${quantity} ${unit}`);
  if (required.size) hardConstraints.push(`Must be: ${[...required].join(', ')}`);
  if (prohibited.size) hardConstraints.push(`Must not be: ${[...prohibited].join(', ')}`);
  if (budgetMinor) hardConstraints.push(`Total ≤ ${formatMoney(budgetMinor, 'USD')} USD`);
  if (deadlineISO) hardConstraints.push(`Arrive by ${formatInZone(deadlineISO, timezone)}`);

  const draft: IntentDraft = {
    productKind,
    productLabel,
    quantity,
    unit,
    requiredAttributes: [...required],
    prohibitedAttributes: [...prohibited],
    budgetMinor,
    currency: 'USD',
    deadlineISO,
    timezone,
    hardConstraints,
    softPreferences,
    assumptions,
    unresolvedQuestions: unresolved,
  };

  return {
    draft,
    sourceSpans: spans,
    complete: unresolved.length === 0,
    ignoredInstructions,
  };
}
