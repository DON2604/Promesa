import { formatInZone, formatMoney } from '@promesa/contracts';
import type { TwinHealth } from '@promesa/contracts';

export function money(minor: string | null | undefined, currency = 'USD'): string {
  if (minor == null) return '—';
  return formatMoney(minor, currency);
}

/** Deadlines are always shown with their zone so "Friday" is never ambiguous. */
export function when(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '—';
  return formatInZone(iso, timeZone);
}

export function shortWhen(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '—';
  return formatInZone(iso, timeZone, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function relative(iso: string, now: Date = new Date()): string {
  const diffMs = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60_000) return rtf.format(Math.round(diffMs / 1000), 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(diffMs / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diffMs / 3_600_000), 'hour');
  return rtf.format(Math.round(diffMs / 86_400_000), 'day');
}

export const HEALTH_LABEL: Record<TwinHealth, string> = {
  UNDETERMINED: 'Undetermined',
  ON_TRACK: 'On track',
  AT_RISK: 'At risk',
  BREACHED: 'Breached',
  UNDER_RECOVERY: 'Under recovery',
  FULFILLED: 'Fulfilled',
  UNRESOLVED: 'Unresolved',
};

/** Text + symbol so state never relies on colour alone. */
export const HEALTH_SYMBOL: Record<TwinHealth, string> = {
  UNDETERMINED: '◌',
  ON_TRACK: '●',
  AT_RISK: '▲',
  BREACHED: '✕',
  UNDER_RECOVERY: '↺',
  FULFILLED: '✓',
  UNRESOLVED: '?',
};

export type Tone = 'neutral' | 'good' | 'caution' | 'breach' | 'signal';

export const HEALTH_TONE: Record<TwinHealth, Tone> = {
  UNDETERMINED: 'neutral',
  ON_TRACK: 'good',
  AT_RISK: 'caution',
  BREACHED: 'breach',
  UNDER_RECOVERY: 'signal',
  FULFILLED: 'good',
  UNRESOLVED: 'neutral',
};

export function humanize(value: string): string {
  const s = value.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
