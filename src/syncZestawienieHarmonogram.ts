/**
 * Rejestr Harmonogram — zakładki miesięczne `Harmonogram {Miesiąc} {YYYY}` + legacy
 * `zestawienie z harmonogramu`. Sync po „odebrane”: uzupełnia braki / aktualizuje nierozliczone;
 * NIGDY nie czyści zakładki. Nowe wiersze → zakładka miesiąca z daty odbioru (po nazwie).
 * Ilość worków przy update: tylko w górę (max z istniejącej i z odebrane).
 */

import {
  MONTH_NAMES_PL,
  SCHEDULE_MONTH_SHEET_PREFIX,
  SHEET_NAME_BAZA_CEN_HARMONOGRAM,
  SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU,
  SHEET_NAME_ZESTAWIENIE_HARMONOGRAM,
} from './config.js';
import { parseWeekdaysFromDniHarmonogramu, todayWarsawUtcMidnight } from './harmonogramDays.js';
import { ensureSheetExists } from './phase4.js';
import { sheetExists, normalizeOdebraneHeader } from './odebraneZHarmonogramu.js';
import { normalizeRateShopKey } from './saveRate.js';
import { buildAddress } from './sheets.js';
import { aggregateRodzajZbiorkiFromSealRows, parseDataZamknieciaWorkaToSortMs } from './wordMapSupport.js';

/** Bez „Nr zlecenia transportowego”. Kolumna 9 = transport się odbył (po Ilość worków). */
export const ZESTAWIENIE_HARMONOGRAM_HEADERS = [
  'Adres odbioru',
  'Nazwa kontrahenta / podmiot handlowy',
  'Nazwa punktu / nazwa skrócona',
  'Data odbioru',
  'Kto odbiera',
  'Miejsce zrzutu',
  'Rodzaj zbiórki',
  'Ilość worków',
  'transport się odbył',
  'Trasa',
  'Stawka za trasę',
  'Stawka za podjazd',
  'Stawka za worek',
  'Rozliczony',
  'Numer faktury',
  'Koszt odbioru',
  'Koszt odbioru per worek',
  'Komentarz 1',
  'Komentarz 2',
] as const;

/** 1-based index of „transport się odbył” in {@link ZESTAWIENIE_HARMONOGRAM_HEADERS}. */
export const SCHEDULE_COL_TRANSPORT_ODBYL = 9;

/** 1-based last data column (Komentarz 2) — zakres przekreślenia wiersza. */
export const SCHEDULE_COL_KOMENTARZ2 = 19;

/** V2: kolumna 9 = Trasa (przed przesunięciem „transport się odbył”). */
export function isScheduleHeadersV2(headers: string[]): boolean {
  const h9 = String(headers[8] ?? '').trim();
  const h11 = String(headers[10] ?? '').trim();
  return h9 === 'Trasa' && h11 === 'Stawka za podjazd';
}

export interface ScheduleSyncExpectedRow {
  key: string;
  address: string;
  shopName: string;
  podmiot: string;
  contractor: string;
  pickupDate: string;
  bagCount: number;
  rodzajZbiorki: string;
  routeName: string;
  routeRate: string;
  pickupRate: string;
  bagRate: string;
}

export interface ScheduleRegisterExistingRow {
  sheetName: string;
  sheetRow: number;
  key: string;
  settled: boolean;
  /** Aktualna Ilość worków w zestawieniu (do max przy sync). */
  bagCount: number;
}

export interface ScheduleSyncPlan {
  create: ScheduleSyncExpectedRow[];
  update: Array<{ sheetName: string; sheetRow: number; row: ScheduleSyncExpectedRow }>;
  skippedSettled: number;
  /** Wiersze z kluczem powtórzonym dalej w rejestrze — sync ich nie widzi. */
  duplicates: ScheduleRegisterExistingRow[];
}

/** `Harmonogram Październik 2026` z daty dd.mm.yyyy. */
export function scheduleMonthSheetName(pickupDate: string, now = new Date()): string {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(pickupDate.trim());
  if (m) {
    const month = Number(m[2]);
    const year = Number(m[3]);
    if (month >= 1 && month <= 12) {
      return `${SCHEDULE_MONTH_SHEET_PREFIX}${MONTH_NAMES_PL[month - 1]} ${year}`;
    }
  }
  const today = new Date(todayWarsawUtcMidnight(now));
  return `${SCHEDULE_MONTH_SHEET_PREFIX}${MONTH_NAMES_PL[today.getUTCMonth()]} ${today.getUTCFullYear()}`;
}

export function isScheduleMonthSheetName(name: string): boolean {
  const n = name.trim();
  return n.startsWith(SCHEDULE_MONTH_SHEET_PREFIX) && n.length > SCHEDULE_MONTH_SHEET_PREFIX.length;
}

type SheetsClient = {
  spreadsheets: {
    get(args: unknown, ...rest: unknown[]): Promise<{ data: unknown }>;
    batchUpdate(args: unknown, ...rest: unknown[]): Promise<unknown>;
    values: {
      get(args: unknown, ...rest: unknown[]): Promise<{ data: unknown }>;
      update(args: unknown, ...rest: unknown[]): Promise<unknown>;
      append(args: unknown, ...rest: unknown[]): Promise<unknown>;
      batchUpdate(args: unknown, ...rest: unknown[]): Promise<unknown>;
    };
  };
};

interface LoggerLike {
  info: (message: string, ...args: unknown[]) => void;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatDdMmYyyy(year: number, month: number, day: number): string {
  return `${pad2(day)}.${pad2(month)}.${year}`;
}

/** Fold klucza sync: al./pl./Św. jak w stawkach, potem ASCII (ogonki). */
export function foldScheduleKeyPart(text: string): string {
  return normalizeRateShopKey(text)
    .replace(/ą/g, 'a')
    .replace(/ć/g, 'c')
    .replace(/ę/g, 'e')
    .replace(/ł/g, 'l')
    .replace(/ń/g, 'n')
    .replace(/ó/g, 'o')
    .replace(/ś/g, 's')
    .replace(/ź/g, 'z')
    .replace(/ż/g, 'z')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function scheduleRowKey(address: string, pickupDate: string, contractor: string): string {
  return `${foldScheduleKeyPart(address)}\n${pickupDate}\n${foldScheduleKeyPart(contractor)}`;
}

export function msToDdMmYyyy(ms: number): string | null {
  if (!Number.isFinite(ms) || ms === Number.NEGATIVE_INFINITY) {
    return null;
  }
  const d = new Date(ms);
  return formatDdMmYyyy(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function parseToDdMmYyyy(raw: string): string | null {
  return msToDdMmYyyy(parseDataZamknieciaWorkaToSortMs(raw));
}

export function compareDdMmYyyy(a: string, b: string): number {
  const pa = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(a);
  const pb = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(b);
  if (!pa || !pb) {
    return 0;
  }
  const ya = Number(pa[3]);
  const yb = Number(pb[3]);
  if (ya !== yb) return ya - yb;
  const ma = Number(pa[2]);
  const mb = Number(pb[2]);
  if (ma !== mb) return ma - mb;
  return Number(pa[1]) - Number(pb[1]);
}

export function dateInRange(pickup: string, dataOd: string, dataDo: string): boolean {
  if (compareDdMmYyyy(pickup, dataDo) > 0) return false;
  if (dataOd && compareDdMmYyyy(pickup, dataOd) < 0) return false;
  return true;
}

/** Dzień po dacie dd.mm.yyyy (UTC). */
export function addOneDayDdMmYyyy(date: string): string | null {
  const p = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(date);
  if (!p) {
    return null;
  }
  const next = new Date(Date.UTC(Number(p[3]), Number(p[2]) - 1, Number(p[1]) + 1));
  return formatDdMmYyyy(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

/**
 * Do zestawienia wiersz trafia dzień po teoretycznej / faktycznej dacie odbioru.
 * np. odbiór 01.10 → dopisanie gdy asOf ≥ 02.10 (Data odbioru zostaje 01.10).
 */
export function pickupReadyForZestawienie(pickupDate: string, asOfDate: string): boolean {
  const appearOn = addOneDayDdMmYyyy(pickupDate);
  if (!appearOn) {
    return false;
  }
  return compareDdMmYyyy(appearOn, asOfDate) <= 0;
}

export function datesMatchingWeekdays(
  dataOd: string,
  dataDo: string,
  weekdays: number[],
): string[] {
  if (!dataOd || !dataDo || weekdays.length === 0) {
    return [];
  }
  if (compareDdMmYyyy(dataOd, dataDo) > 0) {
    return [];
  }
  const wanted = new Set(weekdays);
  const start = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dataOd);
  if (!start) {
    return [];
  }
  let y = Number(start[3]);
  let m = Number(start[2]);
  let d = Number(start[1]);
  const out: string[] = [];
  for (let guard = 0; guard < 400; guard++) {
    const text = formatDdMmYyyy(y, m, d);
    if (compareDdMmYyyy(text, dataDo) > 0) {
      break;
    }
    if (wanted.has(new Date(Date.UTC(y, m - 1, d)).getUTCDay())) {
      out.push(text);
    }
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    y = next.getUTCFullYear();
    m = next.getUTCMonth() + 1;
    d = next.getUTCDate();
  }
  return out;
}

/** Dni wstecz, które okno zawsze obejmuje — także przez granicę miesiąca. */
export const SYNC_WINDOW_LOOKBACK_DAYS = 7;

/**
 * Od wcześniejszej z dat: 1. dzień bieżącego miesiąca albo dziś − {@link SYNC_WINDOW_LOOKBACK_DAYS}.
 * Odbiór z ostatniego dnia miesiąca jest gotowy dopiero 1. dnia następnego, więc samo
 * „od 1. dnia miesiąca” nigdy by go nie dopisało. „Dziś” w Europe/Warsaw (runner CI ma UTC).
 */
export function defaultSyncWindow(now = new Date()): { dataOd: string; dataDo: string } {
  const today = new Date(todayWarsawUtcMidnight(now));
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;
  const d = today.getUTCDate();
  const back = new Date(Date.UTC(y, m - 1, d - SYNC_WINDOW_LOOKBACK_DAYS));
  const dataOd =
    d > SYNC_WINDOW_LOOKBACK_DAYS
      ? formatDdMmYyyy(y, m, 1)
      : formatDdMmYyyy(back.getUTCFullYear(), back.getUTCMonth() + 1, back.getUTCDate());
  return {
    dataOd,
    dataDo: formatDdMmYyyy(y, m, d),
  };
}

function headerIndex(headers: string[], name: string): number {
  const wanted = normalizeOdebraneHeader(name);
  for (let i = 0; i < headers.length; i++) {
    if (normalizeOdebraneHeader(headers[i] ?? '') === wanted) {
      return i;
    }
  }
  return -1;
}

/** Tryb zbiórki / Zbiórka / Rodzaj zbiórki w odebrane. */
function findZbiorkaColumnIndex(headers: string[]): number {
  const names = ['Tryb zbiórki', 'Zbiórka', 'Rodzaj zbiórki'];
  for (const name of names) {
    const ix = headerIndex(headers, name);
    if (ix >= 0) return ix;
  }
  return -1;
}

function cell(row: string[] | undefined, index: number): string {
  return String(row?.[index] ?? '').trim();
}

function quoteSheet(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

type BazaRate = {
  shop: string;
  contractor: string;
  routeName: string;
  pickupAmount: string;
  bagAmount: string;
  routeAmount: string;
  validFrom: string;
  days: string;
};

/**
 * Oczekiwane wiersze: dni z Bazy cen + worki z odebrane.
 * Wiersz dopiero dzień po dacie odbioru (asOf = dataDo): odbiór 01.10 → zestawienie od 02.10.
 * Nazwy punktu/kontrahenta: z worków dnia, a przy 0 workach z dowolnego wiersza odebrane tego adresu.
 * Rodzaj zbiórki = agregat Tryb zbiórki z worków grupy; przy 0 workach = „brak worków”.
 */
export function buildScheduleSyncExpected(
  dataOd: string,
  dataDo: string,
  bazaHeaders: string[],
  bazaRows: string[][],
  odebraneHeaders: string[],
  odebraneRows: string[][],
): ScheduleSyncExpectedRow[] {
  const start = parseToDdMmYyyy(dataOd) ?? dataOd;
  const end = parseToDdMmYyyy(dataDo) ?? dataDo;
  if (!start || !end || compareDdMmYyyy(start, end) > 0) {
    return [];
  }

  const ixShop = headerIndex(bazaHeaders, 'Adres sklepu');
  const ixContractor = headerIndex(bazaHeaders, 'Podwykonawca');
  const ixRoute = headerIndex(bazaHeaders, 'Nazwa trasy');
  const ixPickup = headerIndex(bazaHeaders, 'Cena za podjazd');
  const ixBag = headerIndex(bazaHeaders, 'Cena za worek');
  const ixRoutePrice = headerIndex(bazaHeaders, 'Cena za trasę');
  const ixFrom = headerIndex(bazaHeaders, 'Od kiedy obowiązuje cena');
  const ixDays = headerIndex(bazaHeaders, 'Dni odbiorów');

  const rateRows: BazaRate[] = [];
  const shops = new Map<string, { address: string; contractor: string; days: string }>();
  if (ixShop >= 0 && ixContractor >= 0) {
    for (const row of bazaRows) {
      const shop = cell(row, ixShop);
      const contractor = cell(row, ixContractor);
      if (!shop || !contractor) continue;
      const rawFrom = ixFrom >= 0 ? cell(row, ixFrom) : '';
      let validFrom = '';
      if (rawFrom) {
        const parsed = parseToDdMmYyyy(rawFrom);
        if (!parsed) continue;
        validFrom = parsed;
      }
      const days = ixDays >= 0 ? cell(row, ixDays) : '';
      rateRows.push({
        shop,
        contractor,
        routeName: ixRoute >= 0 ? cell(row, ixRoute) : '',
        pickupAmount: ixPickup >= 0 ? cell(row, ixPickup) : '',
        bagAmount: ixBag >= 0 ? cell(row, ixBag) : '',
        routeAmount: ixRoutePrice >= 0 ? cell(row, ixRoutePrice) : '',
        validFrom,
        days,
      });
      const sk = `${foldScheduleKeyPart(shop)}\n${foldScheduleKeyPart(contractor)}`;
      const prev = shops.get(sk);
      if (!prev) {
        shops.set(sk, { address: shop, contractor, days });
      } else if (!prev.days && days) {
        prev.days = days;
      }
    }
  }

  const ixKod = headerIndex(odebraneHeaders, 'Kod pocztowy');
  const ixMiasto = headerIndex(odebraneHeaders, 'Miasto');
  const ixUlica = headerIndex(odebraneHeaders, 'Ulica');
  const ixNumer = headerIndex(odebraneHeaders, 'Numer budynku');
  const ixFirma = headerIndex(odebraneHeaders, 'Firma transportowa');
  const ixData = headerIndex(odebraneHeaders, 'Data zamknięcia worka');
  const ixSklep = headerIndex(odebraneHeaders, 'Sklep');
  const ixPodmiot = headerIndex(odebraneHeaders, 'Podmiot handlowy');
  const ixZbiorka = findZbiorkaColumnIndex(odebraneHeaders);
  const ixPlomba = headerIndex(odebraneHeaders, 'Numer plomby');

  const bagGroups = new Map<
    string,
    {
      address: string;
      shopName: string;
      podmiot: string;
      contractor: string;
      pickupDate: string;
      bagCount: number;
      seals: Array<{ numerPlomby: string; zbiorka: string }>;
    }
  >();
  if (ixKod >= 0 && ixMiasto >= 0 && ixUlica >= 0 && ixNumer >= 0 && ixFirma >= 0 && ixData >= 0) {
    for (const row of odebraneRows) {
      const firma = cell(row, ixFirma);
      if (!firma) continue;
      const adres = buildAddress({
        kodPocztowy: cell(row, ixKod),
        miasto: cell(row, ixMiasto),
        ulica: cell(row, ixUlica),
        numerBudynku: cell(row, ixNumer),
      });
      if (!adres) continue;
      const closeDate = parseToDdMmYyyy(cell(row, ixData));
      if (!closeDate || !dateInRange(closeDate, start, end)) continue;
      const key = scheduleRowKey(adres, closeDate, firma);
      const plomba = ixPlomba >= 0 ? cell(row, ixPlomba) : '';
      const zbiorka = ixZbiorka >= 0 ? cell(row, ixZbiorka) : '';
      const prev = bagGroups.get(key);
      if (!prev) {
        bagGroups.set(key, {
          address: adres,
          shopName: ixSklep >= 0 ? cell(row, ixSklep) : '',
          podmiot: ixPodmiot >= 0 ? cell(row, ixPodmiot) : '',
          contractor: firma,
          pickupDate: closeDate,
          bagCount: 1,
          seals: [{ numerPlomby: plomba || '1', zbiorka }],
        });
      } else {
        prev.bagCount += 1;
        prev.seals.push({
          numerPlomby: plomba || String(prev.bagCount),
          zbiorka,
        });
        if (!prev.shopName && ixSklep >= 0) prev.shopName = cell(row, ixSklep);
        if (!prev.podmiot && ixPodmiot >= 0) prev.podmiot = cell(row, ixPodmiot);
      }
    }
  }

  const namesByAddress = new Map<string, { shopName: string; podmiot: string }>();
  if (ixKod >= 0 && ixMiasto >= 0 && ixUlica >= 0 && ixNumer >= 0) {
    for (const row of odebraneRows) {
      const adres = buildAddress({
        kodPocztowy: cell(row, ixKod),
        miasto: cell(row, ixMiasto),
        ulica: cell(row, ixUlica),
        numerBudynku: cell(row, ixNumer),
      });
      if (!adres) continue;
      const shopName = ixSklep >= 0 ? cell(row, ixSklep) : '';
      const podmiot = ixPodmiot >= 0 ? cell(row, ixPodmiot) : '';
      if (!shopName && !podmiot) continue;
      const key = foldScheduleKeyPart(adres);
      const prev = namesByAddress.get(key);
      if (!prev) {
        namesByAddress.set(key, { shopName, podmiot });
      } else {
        if (!prev.shopName && shopName) prev.shopName = shopName;
        if (!prev.podmiot && podmiot) prev.podmiot = podmiot;
      }
    }
  }

  const expected = new Map<string, ScheduleSyncExpectedRow>();
  const order: string[] = [];

  function ensure(
    address: string,
    contractor: string,
    pickupDate: string,
    shopName: string,
    podmiot: string,
    bagCount: number,
    rodzajZbiorki: string,
  ): ScheduleSyncExpectedRow {
    const key = scheduleRowKey(address, pickupDate, contractor);
    let row = expected.get(key);
    if (!row) {
      row = {
        key,
        address,
        shopName: shopName || '',
        podmiot: podmiot || '',
        contractor,
        pickupDate,
        bagCount,
        rodzajZbiorki: rodzajZbiorki || '',
        routeName: '',
        routeRate: '',
        pickupRate: '',
        bagRate: '',
      };
      expected.set(key, row);
      order.push(key);
    } else {
      row.bagCount = bagCount;
      if (rodzajZbiorki) row.rodzajZbiorki = rodzajZbiorki;
      if (shopName && !row.shopName) row.shopName = shopName;
      if (podmiot && !row.podmiot) row.podmiot = podmiot;
    }
    return row;
  }

  for (const meta of shops.values()) {
    const weekdays = parseWeekdaysFromDniHarmonogramu(meta.days);
    if (weekdays.length === 0) continue;
    for (const day of datesMatchingWeekdays(start, end, weekdays)) {
      if (!pickupReadyForZestawienie(day, end)) continue;
      const names = namesByAddress.get(foldScheduleKeyPart(meta.address));
      const row = ensure(
        meta.address,
        meta.contractor,
        day,
        names?.shopName ?? '',
        names?.podmiot ?? '',
        0,
        'brak worków',
      );
      let best: BazaRate | null = null;
      for (const rate of rateRows) {
        if (foldScheduleKeyPart(rate.shop) !== foldScheduleKeyPart(meta.address)) continue;
        if (foldScheduleKeyPart(rate.contractor) !== foldScheduleKeyPart(meta.contractor)) continue;
        if (rate.validFrom && compareDdMmYyyy(rate.validFrom, day) > 0) continue;
        if (
          !best ||
          compareDdMmYyyy(rate.validFrom || '01.01.1900', best.validFrom || '01.01.1900') > 0
        ) {
          best = rate;
        }
      }
      if (best) {
        row.routeName = best.routeName;
        row.routeRate = best.routeAmount;
        row.pickupRate = best.pickupAmount;
        row.bagRate = best.bagAmount;
      }
      const bagKey = scheduleRowKey(meta.address, day, meta.contractor);
      const bags = bagGroups.get(bagKey);
      if (bags) {
        row.bagCount = bags.bagCount;
        row.rodzajZbiorki = aggregateRodzajZbiorkiFromSealRows(
          bags.seals.map((s) => ({
            numerPlomby: s.numerPlomby,
            dataZamknieciaWorka: bags.pickupDate,
            zbiorka: s.zbiorka,
          })),
        );
        if (bags.shopName) row.shopName = bags.shopName;
        if (bags.podmiot) row.podmiot = bags.podmiot;
        bagGroups.delete(bagKey);
      }
    }
  }

  for (const g of bagGroups.values()) {
    if (!pickupReadyForZestawienie(g.pickupDate, end)) continue;
    ensure(
      g.address,
      g.contractor,
      g.pickupDate,
      g.shopName,
      g.podmiot,
      g.bagCount,
      aggregateRodzajZbiorkiFromSealRows(
        g.seals.map((s) => ({
          numerPlomby: s.numerPlomby,
          dataZamknieciaWorka: g.pickupDate,
          zbiorka: s.zbiorka,
        })),
      ),
    );
  }

  return order.map((k) => expected.get(k)!);
}

function parseBagCountCell(raw: string): number {
  const s = String(raw ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(',', '.');
  if (!s) {
    return 0;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Sheets API RAW: liczba → komórka liczbowa (bez apostrofu tekstowego).
 * Puste zostaje pustym stringiem.
 */
export function sheetRateWriteValue(raw: string | number | null | undefined): string | number {
  if (raw == null || raw === '') {
    return '';
  }
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : '';
  }
  const s = String(raw)
    .trim()
    .replace(/\s/g, '')
    .replace(',', '.');
  if (s === '') {
    return '';
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : String(raw).trim();
}

/** Wiersz 1 zawiera kolumny klucza (adres, data, kto) — da się czytać i dopisywać. */
export function isScheduleHeaderRow(headers: string[]): boolean {
  return (
    headerIndex(headers, 'Adres odbioru') >= 0 &&
    headerIndex(headers, 'Data odbioru') >= 0 &&
    headerIndex(headers, 'Kto odbiera') >= 0
  );
}

function readRegisterRow(
  headers: string[],
  row: string[] | undefined,
): { key: string; settled: boolean; bagCount: number } | null {
  const address = cell(row, headerIndex(headers, 'Adres odbioru'));
  const pickupDate = parseToDdMmYyyy(cell(row, headerIndex(headers, 'Data odbioru')));
  const contractor = cell(row, headerIndex(headers, 'Kto odbiera'));
  if (!address || !pickupDate || !contractor) {
    return null;
  }
  const ixRoz = headerIndex(headers, 'Rozliczony');
  const ixBags = headerIndex(headers, 'Ilość worków');
  return {
    key: scheduleRowKey(address, pickupDate, contractor),
    settled: ixRoz >= 0 && foldScheduleKeyPart(cell(row, ixRoz)) === 'tak',
    bagCount: ixBags >= 0 ? parseBagCountCell(cell(row, ixBags)) : 0,
  };
}

export function parseScheduleRegisterRows(
  headers: string[],
  rows: string[][],
  sheetName: string,
): ScheduleRegisterExistingRow[] {
  const existing: ScheduleRegisterExistingRow[] = [];
  if (!isScheduleHeaderRow(headers)) {
    return existing;
  }
  rows.forEach((row, index) => {
    const parsed = readRegisterRow(headers, row);
    if (parsed) {
      existing.push({ sheetName, sheetRow: index + 2, ...parsed });
    }
  });
  return existing;
}

/**
 * Plan sync: create / update nierozliczonych.
 * Przy update Ilość worków = max(istniejąca, oczekiwana) — nie cofamy sumy po usunięciu worków z odebrane.
 */
export function planScheduleSync(
  expected: ScheduleSyncExpectedRow[],
  existing: ScheduleRegisterExistingRow[],
): ScheduleSyncPlan {
  const byKey = new Map<string, ScheduleRegisterExistingRow>();
  const duplicates: ScheduleRegisterExistingRow[] = [];
  for (const e of existing) {
    const shadowed = byKey.get(e.key);
    if (shadowed) duplicates.push(shadowed);
    byKey.set(e.key, e);
  }
  const create: ScheduleSyncExpectedRow[] = [];
  const update: Array<{ sheetName: string; sheetRow: number; row: ScheduleSyncExpectedRow }> = [];
  let skippedSettled = 0;
  for (const row of expected) {
    const found = byKey.get(row.key);
    if (found) {
      if (found.settled) {
        skippedSettled += 1;
        continue;
      }
      const bagCount = Math.max(found.bagCount || 0, row.bagCount || 0);
      update.push({
        sheetName: found.sheetName,
        sheetRow: found.sheetRow,
        row: bagCount === row.bagCount ? row : { ...row, bagCount },
      });
      continue;
    }
    create.push(row);
  }
  return { create, update, skippedSettled, duplicates };
}

async function listSpreadsheetSheetTitles(
  api: SheetsClient,
  spreadsheetId: string,
): Promise<string[]> {
  const metaResponse = await api.spreadsheets.get({ spreadsheetId });
  const sheets = (metaResponse.data as { sheets?: Array<{ properties?: { title?: string } }> })
    .sheets;
  return (sheets ?? [])
    .map((s) => String(s.properties?.title ?? '').trim())
    .filter((title) => title.length > 0);
}

/** Legacy + wszystkie zakładki `Harmonogram …` (po nazwie). */
export function scheduleRegisterSheetNamesFromTitles(titles: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  if (titles.includes(SHEET_NAME_ZESTAWIENIE_HARMONOGRAM)) {
    out.push(SHEET_NAME_ZESTAWIENIE_HARMONOGRAM);
    seen.add(SHEET_NAME_ZESTAWIENIE_HARMONOGRAM);
  }
  for (const title of titles) {
    if (seen.has(title) || !isScheduleMonthSheetName(title)) continue;
    out.push(title);
    seen.add(title);
  }
  return out;
}

export function zestawienieRowValues(
  row: ScheduleSyncExpectedRow,
  headers: string[],
): Array<string | number> {
  const values: Array<string | number> = headers.map(() => '');
  const put = (name: string, value: string | number) => {
    const index = headerIndex(headers, name);
    if (index >= 0) values[index] = value;
  };
  put('Adres odbioru', row.address);
  put('Nazwa kontrahenta / podmiot handlowy', row.podmiot);
  put('Nazwa punktu / nazwa skrócona', row.shopName);
  put('Data odbioru', row.pickupDate);
  put('Kto odbiera', row.contractor);
  put('Rodzaj zbiórki', row.rodzajZbiorki);
  put('Ilość worków', row.bagCount);
  put('Trasa', row.routeName);
  put('Stawka za trasę', sheetRateWriteValue(row.routeRate));
  put('Stawka za podjazd', sheetRateWriteValue(row.pickupRate));
  put('Stawka za worek', sheetRateWriteValue(row.bagRate));
  return values;
}

async function readValues(
  api: SheetsClient,
  spreadsheetId: string,
  sheetName: string,
): Promise<string[][]> {
  const response = await api.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheet(sheetName)}!A:T`,
  });
  return ((response.data as { values?: string[][] }).values ?? []) as string[][];
}

function columnLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

type SheetProperties = {
  sheetId?: number;
  title?: string;
  gridProperties?: { rowCount?: number };
};

async function sheetProperties(
  api: SheetsClient,
  spreadsheetId: string,
  sheetName: string,
): Promise<SheetProperties | undefined> {
  const metaResponse = await api.spreadsheets.get({ spreadsheetId });
  const sheets = (metaResponse.data as { sheets?: Array<{ properties?: SheetProperties }> }).sheets;
  return (sheets ?? []).find((s) => s.properties?.title === sheetName)?.properties;
}

/**
 * V2 → V3: „transport się odbył” z kol. 17 na 9 przez `moveDimension` — kolumny jadą razem
 * z liczbami, datami, formatami i formułami (odczyt + zapis wartości zamieniłby je w tekst).
 */
async function migrateScheduleSheetV2toV3(
  api: SheetsClient,
  spreadsheetId: string,
  sheetName: string,
  v2Headers: string[],
): Promise<void> {
  const sheetId = (await sheetProperties(api, spreadsheetId, sheetName))?.sheetId;
  if (sheetId == null) {
    throw new Error(`Zestawienie: brak zakładki „${sheetName}” do migracji V2→V3`);
  }
  await api.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          moveDimension: {
            source: { sheetId, dimension: 'COLUMNS', startIndex: 16, endIndex: 17 },
            destinationIndex: SCHEDULE_COL_TRANSPORT_ODBYL - 1,
          },
        },
      ],
    },
  });
  await api.spreadsheets.values.update({
    spreadsheetId,
    range: `${quoteSheet(sheetName)}!A1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[...v2Headers.slice(0, 8), ...ZESTAWIENIE_HARMONOGRAM_HEADERS.slice(8)]],
    },
  });
}

async function ensureTransportOdbyłValidation(
  api: SheetsClient,
  spreadsheetId: string,
  sheetName: string,
  addStrikeRule: boolean,
): Promise<void> {
  const props = await sheetProperties(api, spreadsheetId, sheetName);
  const sheetId = props?.sheetId;
  if (sheetId == null) {
    return;
  }
  const rowCount = Math.max(props?.gridProperties?.rowCount ?? 1000, 2);
  const col = SCHEDULE_COL_TRANSPORT_ODBYL - 1;
  const requests: unknown[] = [
    {
      setDataValidation: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: rowCount,
          startColumnIndex: col,
          endColumnIndex: col + 1,
        },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [{ userEnteredValue: 'tak' }, { userEnteredValue: 'nie' }],
          },
          showCustomUi: true,
          strict: false,
        },
      },
    },
  ];
  if (addStrikeRule) {
    requests.push({
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId,
              startRowIndex: 1,
              endRowIndex: rowCount,
              startColumnIndex: 0,
              endColumnIndex: SCHEDULE_COL_KOMENTARZ2,
            },
          ],
          booleanRule: {
            condition: {
              type: 'CUSTOM_FORMULA',
              values: [{ userEnteredValue: `=$${columnLetter(col)}2="nie"` }],
            },
            format: { textFormat: { strikethrough: true } },
          },
        },
        index: 0,
      },
    });
  }
  await api.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

export interface SyncZestawienieHarmonogramResult {
  expectedCount: number;
  createdCount: number;
  updatedCount: number;
  skippedSettled: number;
  /** Wiersze przesunięte / rozliczone między odczytem a zapisem — bez update. */
  skippedChanged: number;
  sheetCreated: boolean;
  dataOd: string;
  dataDo: string;
}

const UPDATE_FIELDS: Array<{
  name: string;
  value: (r: ScheduleSyncExpectedRow) => string | number;
}> = [
  { name: 'Ilość worków', value: (r) => r.bagCount },
  { name: 'Rodzaj zbiórki', value: (r) => r.rodzajZbiorki },
  { name: 'Trasa', value: (r) => r.routeName },
  { name: 'Stawka za trasę', value: (r) => sheetRateWriteValue(r.routeRate) },
  { name: 'Stawka za podjazd', value: (r) => sheetRateWriteValue(r.pickupRate) },
  { name: 'Stawka za worek', value: (r) => sheetRateWriteValue(r.bagRate) },
  { name: 'Nazwa punktu / nazwa skrócona', value: (r) => r.shopName },
  { name: 'Nazwa kontrahenta / podmiot handlowy', value: (r) => r.podmiot },
];

/**
 * Update po numerze wiersza z odczytu sprzed kilku sekund — tuż przed zapisem czyta zakładki
 * jeszcze raz i pomija wiersze, pod którymi jest już inny klucz albo „Rozliczony = tak”
 * (ręczne sortowanie/usunięcie, zatwierdzenie w rozliczeniach w międzyczasie).
 */
async function writeScheduleUpdates(
  api: SheetsClient,
  spreadsheetId: string,
  updates: ScheduleSyncPlan['update'],
  logger?: LoggerLike,
): Promise<{ updated: number; skippedChanged: number }> {
  const bySheet = new Map<string, ScheduleSyncPlan['update']>();
  for (const item of updates) {
    const list = bySheet.get(item.sheetName) ?? [];
    list.push(item);
    bySheet.set(item.sheetName, list);
  }
  const data: Array<{ range: string; values: Array<Array<string | number>> }> = [];
  let updated = 0;
  let skippedChanged = 0;
  for (const [sheetName, items] of bySheet) {
    const values = (await readValues(api, spreadsheetId, sheetName)).map((r) =>
      r.map((c) => String(c ?? '')),
    );
    const headers = values[0] ?? [];
    for (const item of items) {
      const now = readRegisterRow(headers, values[item.sheetRow - 1]);
      if (!now || now.key !== item.row.key || now.settled) {
        skippedChanged += 1;
        logger?.info(
          'Zestawienie Harmonogram: pominięto %s!%d — wiersz zmienił się od odczytu',
          sheetName,
          item.sheetRow,
        );
        continue;
      }
      updated += 1;
      for (const field of UPDATE_FIELDS) {
        const ix = headerIndex(headers, field.name);
        const val = field.value(item.row);
        if (ix < 0 || val === '') continue;
        data.push({
          range: `${quoteSheet(sheetName)}!${columnLetter(ix)}${item.sheetRow}`,
          values: [[val]],
        });
      }
    }
  }
  if (data.length > 0) {
    await api.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'RAW', data },
    });
  }
  return { updated, skippedChanged };
}

function isBlankRow(row: string[]): boolean {
  return row.every((c) => c.trim() === '');
}

/**
 * Uzupełnia braki i aktualizuje nierozliczone. NIE czyści zakładki (żadnego clear/overwrite całości).
 */
export async function syncZestawienieHarmonogram(
  api: SheetsClient,
  input: { spreadsheetId: string; dataOd?: string; dataDo?: string; now?: Date },
  logger?: LoggerLike,
): Promise<SyncZestawienieHarmonogramResult> {
  const spreadsheetId = input.spreadsheetId.trim();
  if (!spreadsheetId) {
    throw new Error('Missing spreadsheetId for zestawienie z harmonogramu');
  }
  const window = defaultSyncWindow(input.now);
  const dataOd = input.dataOd ? (parseToDdMmYyyy(input.dataOd) ?? input.dataOd) : window.dataOd;
  const dataDo = input.dataDo ? (parseToDdMmYyyy(input.dataDo) ?? input.dataDo) : window.dataDo;

  const odebraneExists = await sheetExists(api, spreadsheetId, SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU);
  const bazaExists = await sheetExists(api, spreadsheetId, SHEET_NAME_BAZA_CEN_HARMONOGRAM);

  const odebraneValues = odebraneExists
    ? await readValues(api, spreadsheetId, SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU)
    : [];
  const bazaValues = bazaExists
    ? await readValues(api, spreadsheetId, SHEET_NAME_BAZA_CEN_HARMONOGRAM)
    : [];

  const odebraneHeaders = (odebraneValues[0] ?? []).map((h) => String(h ?? ''));
  const bazaHeaders = (bazaValues[0] ?? []).map((h) => String(h ?? ''));
  const odebraneRows = odebraneValues.slice(1).map((r) => r.map((c) => String(c ?? '')));
  const bazaRows = bazaValues.slice(1).map((r) => r.map((c) => String(c ?? '')));

  const expected = buildScheduleSyncExpected(
    dataOd,
    dataDo,
    bazaHeaders,
    bazaRows,
    odebraneHeaders,
    odebraneRows,
  );

  const titles = await listSpreadsheetSheetTitles(api, spreadsheetId);
  const registerNames = scheduleRegisterSheetNamesFromTitles(titles);
  const existing: ScheduleRegisterExistingRow[] = [];
  const firstRowBySheet = new Map<string, string[]>();

  for (const sheetName of registerNames) {
    let currentValues = await readValues(api, spreadsheetId, sheetName);
    let currentHeaders = (currentValues[0] ?? []).map((h) => String(h ?? ''));
    if (isScheduleHeadersV2(currentHeaders)) {
      await migrateScheduleSheetV2toV3(api, spreadsheetId, sheetName, currentHeaders);
      logger?.info('zestawienie: migrated layout V2→V3 on %s', sheetName);
      currentValues = await readValues(api, spreadsheetId, sheetName);
      currentHeaders = (currentValues[0] ?? []).map((h) => String(h ?? ''));
    }
    firstRowBySheet.set(sheetName, currentHeaders);
    existing.push(
      ...parseScheduleRegisterRows(
        currentHeaders,
        currentValues.slice(1).map((r) => r.map((c) => String(c ?? ''))),
        sheetName,
      ),
    );
  }

  const plan = planScheduleSync(expected, existing);
  for (const dup of plan.duplicates) {
    logger?.info(
      'Zestawienie Harmonogram: UWAGA zdublowany klucz — %s!%d pominięty (ten sam adres, data i odbierający niżej w rejestrze)',
      dup.sheetName,
      dup.sheetRow,
    );
  }

  const createBySheet = new Map<string, ScheduleSyncExpectedRow[]>();
  for (const row of plan.create) {
    const sheetName = scheduleMonthSheetName(row.pickupDate, input.now);
    const list = createBySheet.get(sheetName) ?? [];
    list.push(row);
    createBySheet.set(sheetName, list);
  }

  for (const sheetName of createBySheet.keys()) {
    const firstRow = firstRowBySheet.get(sheetName) ?? [];
    if (!isBlankRow(firstRow) && !isScheduleHeaderRow(firstRow)) {
      throw new Error(
        `Zestawienie: zakładka „${sheetName}” nie ma nagłówków w wierszu 1 — sync nie dopisuje wierszy (popraw zakładkę ręcznie)`,
      );
    }
  }

  let sheetCreated = false;
  for (const [sheetName, rows] of createBySheet) {
    if (!titles.includes(sheetName)) {
      await ensureSheetExists(api, spreadsheetId, sheetName);
      sheetCreated = true;
    }
    let headers = firstRowBySheet.get(sheetName) ?? [];
    const headerWritten = isBlankRow(headers);
    if (headerWritten) {
      headers = [...ZESTAWIENIE_HARMONOGRAM_HEADERS];
      await api.spreadsheets.values.update({
        spreadsheetId,
        range: `${quoteSheet(sheetName)}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [headers] },
      });
    }
    await api.spreadsheets.values.append({
      spreadsheetId,
      range: `${quoteSheet(sheetName)}!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: rows.map((row) => zestawienieRowValues(row, headers)),
      },
    });
    await ensureTransportOdbyłValidation(api, spreadsheetId, sheetName, headerWritten);
  }

  const { updated, skippedChanged } =
    plan.update.length > 0
      ? await writeScheduleUpdates(api, spreadsheetId, plan.update, logger)
      : { updated: 0, skippedChanged: 0 };

  logger?.info(
    'Zestawienie Harmonogram: oczekiwane %d, nowe %d, zaktualizowane %d, pominięte rozliczone %d, pominięte zmienione %d, okno %s–%s, nowa zakładka=%s (bez clear)',
    expected.length,
    plan.create.length,
    updated,
    plan.skippedSettled,
    skippedChanged,
    dataOd,
    dataDo,
    sheetCreated,
  );

  return {
    expectedCount: expected.length,
    createdCount: plan.create.length,
    updatedCount: updated,
    skippedSettled: plan.skippedSettled,
    skippedChanged,
    sheetCreated,
    dataOd,
    dataDo,
  };
}

