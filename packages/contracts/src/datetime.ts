/**
 * Timezone helpers built on Intl only (no runtime dependency), used for deadline interpretation
 * on the server and unambiguous display on the client.
 */

export type WallTime = { year: number; month: number; day: number; hour: number; minute: number };

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function getZonedParts(date: Date, timeZone: string): WallTime & { weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: weekdays.indexOf(get('weekday')),
  };
}

function offsetMinutes(utcMillis: number, timeZone: string): number {
  const p = getZonedParts(new Date(utcMillis), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(utcMillis / 60000) * 60000) / 60000);
}

/** Converts a wall-clock time in `timeZone` to the corresponding UTC instant (DST-aware). */
export function zonedWallTimeToUtc(wall: WallTime, timeZone: string): Date {
  const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  let offset = offsetMinutes(guess, timeZone);
  let result = guess - offset * 60000;
  const recheck = offsetMinutes(result, timeZone);
  if (recheck !== offset) {
    offset = recheck;
    result = guess - offset * 60000;
  }
  return new Date(result);
}

/** ISO-8601 string with the zone's numeric offset, e.g. 2026-11-13T17:00:00-05:00. */
export function toZonedIso(date: Date, timeZone: string): string {
  const p = getZonedParts(date, timeZone);
  const offset = offsetMinutes(date.getTime(), timeZone);
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00${sign}${pad(
    Math.floor(abs / 60),
  )}:${pad(abs % 60)}`;
}

/** Next occurrence (strictly after today in `timeZone`, unless `allowToday`) of `weekday` (0=Sun). */
export function nextWeekdayDate(
  reference: Date,
  weekday: number,
  timeZone: string,
  allowToday = false,
): { year: number; month: number; day: number } {
  const today = getZonedParts(reference, timeZone);
  let delta = (weekday - today.weekday + 7) % 7;
  if (delta === 0 && !allowToday) delta = 7;
  const base = new Date(Date.UTC(today.year, today.month - 1, today.day + delta));
  return { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: base.getUTCDate() };
}

export function formatInZone(
  iso: string | Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  },
  locale = 'en-US',
): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date);
}
