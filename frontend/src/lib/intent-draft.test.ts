import { describe, expect, it } from 'vitest';
import type { IntentDraft } from '@promesa/contracts';
import {
  draftToSpec,
  inputToBudget,
  isoToWallInput,
  segmentsFromSpans,
  wallInputToIso,
} from './intent-draft';

const draft: IntentDraft = {
  productKind: 'packaging-box',
  productLabel: 'Paper packaging boxes',
  quantity: 100,
  unit: 'box',
  requiredAttributes: ['paper', 'food-safe'],
  prohibitedAttributes: ['plastic'],
  budgetMinor: '10000',
  currency: 'USD',
  deadlineISO: '2026-11-13T17:00:00-05:00',
  timezone: 'America/New_York',
  hardConstraints: [],
  softPreferences: [],
  assumptions: [],
  unresolvedQuestions: [],
};

describe('segmentsFromSpans', () => {
  it('splits text into highlighted and plain segments in order', () => {
    const text = 'Need 100 boxes under $100';
    const segs = segmentsFromSpans(text, {
      quantity: [{ start: 5, end: 8, text: '100' }],
      budgetMinor: [{ start: 15, end: 25, text: 'under $100' }],
    });
    expect(segs.map((s) => s.text).join('')).toBe(text);
    expect(segs.filter((s) => s.field).map((s) => s.field)).toEqual(['quantity', 'budgetMinor']);
  });

  it('drops overlapping and out-of-range spans', () => {
    const segs = segmentsFromSpans('abcdef', {
      quantity: [{ start: 0, end: 4, text: 'abcd' }],
      budgetMinor: [
        { start: 2, end: 5, text: 'cde' },
        { start: 3, end: 99, text: 'x' },
      ],
    });
    expect(segs).toEqual([
      { text: 'abcd', field: 'quantity' },
      { text: 'ef', field: null },
    ]);
  });
});

describe('deadline wall-time conversion', () => {
  it('round-trips through the deadline time zone, not the browser zone', () => {
    expect(isoToWallInput('2026-11-13T22:00:00.000Z', 'America/New_York')).toBe('2026-11-13T17:00');
    expect(wallInputToIso('2026-11-13T17:00', 'America/New_York')).toBe(
      '2026-11-13T17:00:00-05:00',
    );
    expect(wallInputToIso('2026-07-03T17:00', 'America/New_York')).toBe(
      '2026-07-03T17:00:00-04:00',
    );
    expect(wallInputToIso('not a date', 'UTC')).toBeNull();
  });
});

describe('inputToBudget', () => {
  it('parses decimal strings without floats and rejects junk', () => {
    expect(inputToBudget('100')).toBe('10000');
    expect(inputToBudget('99.99')).toBe('9999');
    expect(inputToBudget('1,250.50')).toBe('125050');
    expect(inputToBudget('1.234')).toBeNull();
    expect(inputToBudget('0')).toBeNull();
    expect(inputToBudget('abc')).toBeNull();
  });
});

describe('draftToSpec', () => {
  it('accepts a complete draft and regenerates hard constraints', () => {
    const { spec, issues } = draftToSpec(draft);
    expect(issues).toEqual([]);
    expect(spec?.hardConstraints).toContain('Must not be: plastic');
  });

  it('reports missing fields instead of guessing', () => {
    const { spec, issues } = draftToSpec({ ...draft, budgetMinor: null, deadlineISO: null });
    expect(spec).toBeNull();
    expect(issues).toEqual(['Enter a maximum budget.', 'Choose a deadline.']);
  });

  it('rejects an attribute that is both required and prohibited', () => {
    const { spec, issues } = draftToSpec({ ...draft, prohibitedAttributes: ['plastic', 'paper'] });
    expect(spec).toBeNull();
    expect(issues.join(' ')).toMatch(/both required and prohibited/);
  });
});
