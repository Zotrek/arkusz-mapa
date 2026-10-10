/**
 * Wspólny harmonogram sklepów: te same dni + ten sam podwykonawca.
 * Id nadaje zapis. Awizacja do Bolęcina: bieżący miesiąc, od 22. także następny.
 */

import { normalizeRateShopKey } from './saveRate.js';
import {
  HARMONOGRAM_DAY_OPTIONS,
  parseHarmonogramDayTokens,
} from './harmonogramDays.js';

/** Od tego dnia miesiąca proponujemy też cały kolejny miesiąc (jak druga mila). */
export const INCLUDE_NEXT_MONTH_FROM_DAY = 22;

export const HARMONOGRAMY_SHEET_NAME = 'Harmonogramy';
export const HARMONOGRAM_ID_HEADER = 'Id harmonogramu';

export const HARMONOGRAMY_HEADERS = [
  'Id',
  'Podwykonawca',
  'Dni odbiorów',
  'Cena za trasę',
  'Miejsce zrzutu',
  'Okno awizacji',
  'Awizacja',
  'Rodzaj zbiórki',
  'Rodzaj transportu',
  'Spodziewane worki',
] as const;

export const BOLECIN_HEADERS = [
  'Okno awizacji',
  'Adres odbioru',
  'Nazwa kontrahenta / podmiot handlowy',
  'Data odbioru',
  'Kto odbiera',
  'Miejsce zrzutu',
  'Rodzaj zbiórki',
  'Ile worków',
  'rodzaj traportu',
  'awizacja',
] as const;

export interface HarmonogramShopRow {
  sheetRow: number;
  adres: string;
  podwykonawca: string;
  dni: string;
  harmonogramId: string;
}

export interface HarmonogramHead {
  id: string;
  podwykonawca: string;
  dni: string;
  cenaTrasy: string;
  miejsceZrzutu: string;
  oknoAwizacji: string;
  awizacja: string;
  rodzajZbiorki: string;
  rodzajTransportu: string;
  spodziewaneWorki: string;
}

export interface HarmonogramListShop {
  adres: string;
  rows: number[];
}

export interface HarmonogramListGroup {
  id: string;
  podwykonawca: string;
  dni: string;
  cenaTrasy: string;
  miejsceZrzutu: string;
  oknoAwizacji: string;
  awizacja: string;
  rodzajZbiorki: string;
  rodzajTransportu: string;
  spodziewaneWorki: string;
  bolecin: boolean;
  daty: string[];
  sklepy: HarmonogramListShop[];
}

export interface HarmonogramListBucket {
  podwykonawca: string;
  dni: string;
  sklepy: HarmonogramListShop[];
}

export type GroupSelection =
  | { ok: true; dni: string; podwykonawca: string; sheetRows: number[] }
  | { ok: false; error: 'zaznacz' | 'rozne' | 'brak_dni' };

function collapse(value: string): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

/** „cz, pn” i „pn, cz” → „pn, cz”. */
export function canonicalHarmonogramDays(raw: string): string {
  return parseHarmonogramDayTokens(raw).join(', ');
}

export function nextHarmonogramId(existingIds: readonly string[]): string {
  let max = 0;
  for (const raw of existingIds) {
    const match = /^H(\d+)$/.exec(collapse(raw));
    if (!match) {
      continue;
    }
    const value = Number(match[1]);
    if (value > max) {
      max = value;
    }
  }
  return `H${String(max + 1).padStart(4, '0')}`;
}

export function isBolecinPlace(text: string): boolean {
  const combined = String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  if (!combined.trim()) {
    return false;
  }
  return combined.includes('bolecin') || combined.includes('biosystem');
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDotDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

/**
 * Daty wybranych dni tygodnia od dziś do końca miesiąca.
 * Od {@link INCLUDE_NEXT_MONTH_FROM_DAY} dołącza też cały następny miesiąc.
 */
export function harmonogramProposalDates(daysRaw: string, today: Date = new Date()): string[] {
  const tokens = new Set(parseHarmonogramDayTokens(daysRaw));
  const wanted = new Set<number>(
    HARMONOGRAM_DAY_OPTIONS.filter((day) => tokens.has(day.value)).map((day) => day.jsDay),
  );
  if (wanted.size === 0) {
    return [];
  }
  const base = startOfLocalDay(today);
  const year = base.getFullYear();
  const month = base.getMonth();
  const dayOfMonth = base.getDate();
  const out: string[] = [];

  const lastDay = new Date(year, month + 1, 0).getDate();
  for (let day = dayOfMonth; day <= lastDay; day += 1) {
    const date = new Date(year, month, day);
    if (wanted.has(date.getDay())) {
      out.push(formatDotDate(date));
    }
  }

  if (dayOfMonth >= INCLUDE_NEXT_MONTH_FROM_DAY) {
    const lastNext = new Date(year, month + 2, 0).getDate();
    for (let day = 1; day <= lastNext; day += 1) {
      const date = new Date(year, month + 1, day);
      if (wanted.has(date.getDay())) {
        out.push(formatDotDate(date));
      }
    }
  }

  return out;
}

/** Unikalne etykiety, kolejność pl, separator „; ”. Pierwsza pisownia wygrywa. */
export function joinHarmonogramLabels(values: readonly string[]): string {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const label = collapse(value);
    if (!label) {
      continue;
    }
    const key = label.toLocaleLowerCase('pl');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(label);
  }
  unique.sort((a, b) => a.localeCompare(b, 'pl'));
  return unique.join('; ');
}

export function bolecinRowIdentity(adres: string, data: string, kto: string): string {
  return [adres, data, kto].map((part) => collapse(part).toLocaleLowerCase('pl')).join('\n');
}

export function buildBolecinRow(fields: {
  oknoAwizacji: string;
  adres: string;
  nazwa: string;
  data: string;
  kto: string;
  miejsce: string;
  rodzajZbiorki: string;
  worki: string;
  rodzajTransportu: string;
  awizacja: string;
}): string[] {
  return [
    fields.oknoAwizacji,
    fields.adres,
    fields.nazwa,
    fields.data,
    fields.kto,
    fields.miejsce,
    fields.rodzajZbiorki,
    fields.worki,
    fields.rodzajTransportu,
    fields.awizacja,
  ];
}

function bucketKey(row: HarmonogramShopRow): string {
  return `${canonicalHarmonogramDays(row.dni)}\n${collapse(row.podwykonawca)}`;
}

function siblingKey(row: HarmonogramShopRow): string {
  return `${normalizeRateShopKey(row.adres)}\n${bucketKey(row)}`;
}

export function memberMatchesHarmonogram(shop: HarmonogramShopRow, group: HarmonogramHead): boolean {
  if (!shop.harmonogramId || shop.harmonogramId !== group.id) {
    return false;
  }
  if (collapse(shop.podwykonawca) !== collapse(group.podwykonawca)) {
    return false;
  }
  const days = canonicalHarmonogramDays(shop.dni);
  return days.length > 0 && days === canonicalHarmonogramDays(group.dni);
}

function collapseShops(rows: readonly HarmonogramShopRow[]): HarmonogramListShop[] {
  const byAdres = new Map<string, number[]>();
  const order: string[] = [];
  for (const row of rows) {
    const adres = collapse(row.adres);
    if (!adres) {
      continue;
    }
    const list = byAdres.get(adres);
    if (list) {
      list.push(row.sheetRow);
    } else {
      byAdres.set(adres, [row.sheetRow]);
      order.push(adres);
    }
  }
  order.sort((a, b) => a.localeCompare(b, 'pl'));
  return order.map((adres) => ({
    adres,
    rows: [...(byAdres.get(adres) ?? [])].sort((a, b) => a - b),
  }));
}

export function buildHarmonogramList(
  shops: readonly HarmonogramShopRow[],
  groups: readonly HarmonogramHead[],
  today: Date = new Date(),
): { harmonogramy: HarmonogramListGroup[]; doZgrupowania: HarmonogramListBucket[] } {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const members = new Map<string, HarmonogramShopRow[]>();
  const loose: HarmonogramShopRow[] = [];

  for (const shop of shops) {
    const group = byId.get(collapse(shop.harmonogramId));
    if (group && memberMatchesHarmonogram(shop, group)) {
      const list = members.get(group.id);
      if (list) {
        list.push(shop);
      } else {
        members.set(group.id, [shop]);
      }
      continue;
    }
    if (!collapse(shop.adres) || !collapse(shop.podwykonawca) || !canonicalHarmonogramDays(shop.dni)) {
      continue;
    }
    loose.push(shop);
  }

  const memberSibling = new Map<string, string>();
  for (const [id, list] of members) {
    for (const shop of list) {
      memberSibling.set(siblingKey(shop), id);
    }
  }
  const stillLoose: HarmonogramShopRow[] = [];
  for (const shop of loose) {
    const joined = memberSibling.get(siblingKey(shop));
    if (!joined) {
      stillLoose.push(shop);
      continue;
    }
    const list = members.get(joined);
    if (list) {
      list.push(shop);
    }
  }

  const harmonogramy: HarmonogramListGroup[] = [...groups]
    .filter((group) => collapse(group.id).length > 0)
    .sort((a, b) => a.id.localeCompare(b.id, 'pl'))
    .map((group) => ({
      id: group.id,
      podwykonawca: group.podwykonawca,
      dni: canonicalHarmonogramDays(group.dni),
      cenaTrasy: group.cenaTrasy,
      miejsceZrzutu: group.miejsceZrzutu,
      oknoAwizacji: group.oknoAwizacji,
      awizacja: group.awizacja,
      rodzajZbiorki: group.rodzajZbiorki,
      rodzajTransportu: group.rodzajTransportu,
      spodziewaneWorki: group.spodziewaneWorki,
      bolecin: isBolecinPlace(group.miejsceZrzutu),
      daty: harmonogramProposalDates(group.dni, today),
      sklepy: collapseShops(members.get(group.id) ?? []),
    }));

  const buckets = new Map<string, HarmonogramShopRow[]>();
  for (const shop of stillLoose) {
    const key = `${canonicalHarmonogramDays(shop.dni)}\n${collapse(shop.podwykonawca)}`;
    const list = buckets.get(key);
    if (list) {
      list.push(shop);
    } else {
      buckets.set(key, [shop]);
    }
  }

  const doZgrupowania: HarmonogramListBucket[] = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'pl'))
    .map(([, rows]) => ({
      podwykonawca: collapse(rows[0]?.podwykonawca ?? ''),
      dni: canonicalHarmonogramDays(rows[0]?.dni ?? ''),
      sklepy: collapseShops(rows),
    }));

  return { harmonogramy, doZgrupowania };
}

/**
 * Zaznaczone wiersze muszą być jednym kubełkiem (dni + podwykonawca).
 * Dopisuje bliźniaki tego samego sklepu (historia cen).
 */
export function selectedShopsForGroup(
  shops: readonly HarmonogramShopRow[],
  rows: readonly number[],
): GroupSelection {
  const wanted = new Set(rows.filter((row) => Number.isInteger(row) && row >= 2));
  if (wanted.size === 0) {
    return { ok: false, error: 'zaznacz' };
  }
  const picked = shops.filter((shop) => wanted.has(shop.sheetRow));
  if (picked.length === 0) {
    return { ok: false, error: 'zaznacz' };
  }
  const bucket = bucketKey(picked[0] as HarmonogramShopRow);
  if (picked.some((shop) => bucketKey(shop) !== bucket)) {
    return { ok: false, error: 'rozne' };
  }
  const dni = canonicalHarmonogramDays(picked[0]?.dni ?? '');
  const podwykonawca = collapse(picked[0]?.podwykonawca ?? '');
  if (!dni || !podwykonawca) {
    return { ok: false, error: 'brak_dni' };
  }
  const siblings = new Set(picked.map((shop) => siblingKey(shop)));
  const sheetRows = shops
    .filter((shop) => siblings.has(siblingKey(shop)))
    .map((shop) => shop.sheetRow)
    .sort((a, b) => a - b);
  return { ok: true, dni, podwykonawca, sheetRows };
}
