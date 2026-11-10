/**
 * Money is always integer minor units. JSON carries minor units as decimal strings because
 * Postgres stores BIGINT. Never convert to a JS float for arithmetic.
 */

const CURRENCY_EXPONENTS: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  JPY: 0,
};

export const SUPPORTED_CURRENCIES = ['USD'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function currencyExponent(currency: string): number {
  const exponent = CURRENCY_EXPONENTS[currency.toUpperCase()];
  if (exponent === undefined) throw new Error(`Unsupported currency: ${currency}`);
  return exponent;
}

const MINOR_PATTERN = /^-?\d+$/;

export function toMinorBigInt(value: string | number | bigint): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Minor units must be a safe integer');
    return BigInt(value);
  }
  if (!MINOR_PATTERN.test(value)) throw new Error(`Invalid minor-unit string: ${value}`);
  return BigInt(value);
}

/** "85.00" / "85" / "85.5" → 8500n for USD. Rejects more fractional digits than the currency allows. */
export function majorStringToMinor(major: string, currency: string): bigint {
  const exponent = currencyExponent(currency);
  const trimmed = major.trim().replace(/,/g, '');
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) throw new Error(`Invalid amount: ${major}`);
  const [, sign, whole = '0', fraction = ''] = match;
  if (fraction.length > exponent) throw new Error(`Too many decimal places for ${currency}`);
  const minor = BigInt(whole + fraction.padEnd(exponent, '0'));
  return sign ? -minor : minor;
}

/** 8500n → "85.00" — the decimal string format PayPal expects at the API boundary. */
export function minorToMajorString(minor: string | number | bigint, currency: string): string {
  const exponent = currencyExponent(currency);
  const value = toMinorBigInt(minor);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const digits = abs.toString().padStart(exponent + 1, '0');
  const whole = exponent === 0 ? digits : digits.slice(0, -exponent);
  const fraction = exponent === 0 ? '' : `.${digits.slice(-exponent)}`;
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

export function formatMoney(
  minor: string | number | bigint,
  currency: string,
  locale = 'en-US',
): string {
  const exponent = currencyExponent(currency);
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  });
  // Intl accepts exact decimal strings, so no float conversion happens here.
  return formatter.format(minorToMajorString(minor, currency) as unknown as number);
}

export function sumMinor(values: Array<string | number | bigint>): bigint {
  return values.reduce<bigint>((acc, v) => acc + toMinorBigInt(v), 0n);
}
