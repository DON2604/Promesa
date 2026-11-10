import { describe, expect, it } from 'vitest';
import { formatMoney, majorStringToMinor, minorToMajorString, sumMinor } from './money';
import { formatInZone, toZonedIso, zonedWallTimeToUtc } from './datetime';
import { IntentSpecSchema } from './intent';

describe('money', () => {
  it('round-trips minor units without floats', () => {
    expect(majorStringToMinor('85.00', 'USD')).toBe(8500n);
    expect(majorStringToMinor('0.1', 'USD')).toBe(10n);
    expect(minorToMajorString(8500n, 'USD')).toBe('85.00');
    expect(minorToMajorString('5', 'USD')).toBe('0.05');
    expect(sumMinor(['8500', 8900n, 1])).toBe(17401n);
  });

  it('rejects ambiguous precision', () => {
    expect(() => majorStringToMinor('1.005', 'USD')).toThrow();
    expect(() => minorToMajorString('1.5', 'USD')).toThrow();
  });

  it('formats with Intl', () => {
    expect(formatMoney('8500', 'USD')).toBe('$85.00');
    expect(formatMoney(10000n, 'USD')).toBe('$100.00');
  });
});

describe('datetime', () => {
  it('converts New York wall time across the DST boundary', () => {
    const friday = zonedWallTimeToUtc(
      { year: 2026, month: 11, day: 13, hour: 17, minute: 0 },
      'America/New_York',
    );
    expect(friday.toISOString()).toBe('2026-11-13T22:00:00.000Z');
    const summer = zonedWallTimeToUtc(
      { year: 2026, month: 7, day: 10, hour: 17, minute: 0 },
      'America/New_York',
    );
    expect(summer.toISOString()).toBe('2026-07-10T21:00:00.000Z');
    expect(toZonedIso(friday, 'America/New_York')).toBe('2026-11-13T17:00:00-05:00');
    expect(formatInZone(friday, 'America/New_York')).toContain('Fri');
  });
});

describe('IntentSpecSchema', () => {
  const base = {
    productKind: 'packaging-box',
    productLabel: 'food-safe paper packaging boxes',
    quantity: 100,
    unit: 'boxes',
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

  it('accepts the bakery intent', () => {
    expect(IntentSpecSchema.safeParse(base).success).toBe(true);
  });

  it('rejects negative quantity, unknown materials and contradictions', () => {
    expect(IntentSpecSchema.safeParse({ ...base, quantity: -1 }).success).toBe(false);
    expect(
      IntentSpecSchema.safeParse({ ...base, requiredAttributes: ['unobtanium'] }).success,
    ).toBe(false);
    expect(IntentSpecSchema.safeParse({ ...base, prohibitedAttributes: ['paper'] }).success).toBe(
      false,
    );
    expect(IntentSpecSchema.safeParse({ ...base, timezone: 'Mars/Olympus' }).success).toBe(false);
  });
});
