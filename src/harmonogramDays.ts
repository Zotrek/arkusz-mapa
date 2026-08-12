/**
 * „Dni harmonogramu” + kwalifikacja kopii do „odebrane z harmonogramu”.
 * Reguła: data_zamknięcia < D < dziś (D = roboczy dzień z harmonogramu, Europe/Warsaw).
 */

import { classifyMapPointZbiorka, normalizeWgHarmonogramu } from './phase6.js';
import { parseDataZamknieciaWorkaToSortMs } from './wordMapSupport.js';

/** JS getDay(): 0=nd … 6=sb */
const WEEKDAY_BY_NORM: Record<string, number> = {
  nd: 0,
  niedziela: 0,
  niedziele: 0,
  pn: 1,
  poniedzialek: 1,
  poniedzialki: 1,
  wt: 2,
  wtorek: 2,
  wtorki: 2,
  sr: 3,
  sroda: 3,
  srody: 3,
  cz: 4,
  czw: 4,
  czwartek: 4,
  czwartki: 4,
  pt: 5,
  piatek: 5,
  piatki: 5,
  sb: 6,
  so: 6,
  sobota: 6,
  soboty: 6,
};

const MS_PER_DAY = 86_400_000;

export function normalizePlDayToken(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/ą/g, 'a')
    .replace(/ć/g, 'c')
    .replace(/ę/g, 'e')
    .replace(/ł/g, 'l')
    .replace(/ń/g, 'n')
    .replace(/ó/g, 'o')
    .replace(/ś/g, 's')
    .replace(/ź/g, 'z')
    .replace(/ż/g, 'z')
    .replace(/[^a-z]/g, '');
}

/** Unikalne getDay() z „Dni harmonogramu” (pn, cz / pn,śr …). */
export function parseWeekdaysFromDniHarmonogramu(raw: string): number[] {
  const text = String(raw || '').trim();
  if (!text) {
    return [];
  }
  const found = new Set<number>();
  const parts = text.split(/[/;,]+|\s+/);
  for (const part of parts) {
    const norm = normalizePlDayToken(part);
    if (!norm) continue;
    const exact = WEEKDAY_BY_NORM[norm];
    if (exact !== undefined) {
      found.add(exact);
      continue;
    }
    for (const [name, day] of Object.entries(WEEKDAY_BY_NORM)) {
      if (name.length >= 2 && (norm === name || norm.includes(name))) {
        found.add(day);
      }
    }
  }
  return [...found].sort((a, b) => a - b);
}

/** Niedziela Wielkanocna (UTC midnight) — Anonymous Gregorian. */
export function easterSundayUtc(year: number): number {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

function ymdUtc(y: number, month1: number, day: number): number {
  return Date.UTC(y, month1 - 1, day);
}

/** Ustawowo wolne od pracy w PL (UTC midnight). */
export function isPolishPublicHolidayUtc(ms: number): boolean {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const fixed = [
    [1, 1],
    [1, 6],
    [5, 1],
    [5, 3],
    [8, 15],
    [11, 1],
    [11, 11],
    [12, 25],
    [12, 26],
  ] as const;
  for (const [fm, fd] of fixed) {
    if (m === fm && day === fd) {
      return true;
    }
  }
  const easter = easterSundayUtc(y);
  const movable = [0, 1, 49, 60].map((offset) => easter + offset * MS_PER_DAY);
  return movable.some((h) => h === Date.UTC(y, m - 1, day));
}

/** Kalendarzowy dzień „dziś” w Europe/Warsaw jako UTC midnight. */
export function todayWarsawUtcMidnight(now: Date = new Date()): number {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  return ymdUtc(y, month, day);
}

export function utcMidnightFromSortMs(ms: number): number | null {
  if (!Number.isFinite(ms) || ms === Number.NEGATIVE_INFINITY) {
    return null;
  }
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Czy istnieje roboczy D z harmonogramu: closureUtc < D < todayUtc.
 */
export function hasPastScheduleDayAfterClosure(
  weekdays: number[],
  closureUtc: number,
  todayUtc: number,
): boolean {
  if (weekdays.length === 0) {
    return false;
  }
  if (!(closureUtc < todayUtc)) {
    return false;
  }
  const wanted = new Set(weekdays);
  for (let t = closureUtc + MS_PER_DAY; t < todayUtc; t += MS_PER_DAY) {
    const d = new Date(t);
    if (!wanted.has(d.getUTCDay())) {
      continue;
    }
    if (isPolishPublicHolidayUtc(t)) {
      continue;
    }
    return true;
  }
  return false;
}

export interface OdebraneZHarmonogramuInput {
  zbiorka: string;
  wgHarmonogramu: string;
  dniHarmonogramu: string;
  dataZamknieciaWorka: string;
  /** Domyślnie teraz (Warsaw). W testach podawać Date / UTC midnight via todayUtc. */
  today?: Date;
  todayUtc?: number;
}

export function shouldCopyToOdebraneZHarmonogramu(input: OdebraneZHarmonogramuInput): boolean {
  if (classifyMapPointZbiorka(input.zbiorka) !== 'maszyna') {
    return false;
  }
  if (normalizeWgHarmonogramu(input.wgHarmonogramu) !== 'tak') {
    return false;
  }
  const weekdays = parseWeekdaysFromDniHarmonogramu(input.dniHarmonogramu);
  if (weekdays.length === 0) {
    return false;
  }
  const closureUtc = utcMidnightFromSortMs(parseDataZamknieciaWorkaToSortMs(input.dataZamknieciaWorka));
  if (closureUtc === null) {
    return false;
  }
  const todayUtc = input.todayUtc ?? todayWarsawUtcMidnight(input.today ?? new Date());
  return hasPastScheduleDayAfterClosure(weekdays, closureUtc, todayUtc);
}

/** Czy flaga kopiowania jest włączona (env). */
export function isCopyOdebraneZHarmonogramuEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = (env.COPY_ODEBRANE_Z_HARMONOGRAMU ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'tak';
}
