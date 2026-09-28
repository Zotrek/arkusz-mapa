/**
 * Zakładka „zestawienie z harmonogramu” — rejestr jak Arkusz1, bez nr zlecenia.
 * Sync po „odebrane”: uzupełnia braki / aktualizuje nierozliczone; NIGDY nie czyści zakładki.
 */

import {
  SHEET_NAME_BAZA_CEN_HARMONOGRAM,
  SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU,
  SHEET_NAME_ZESTAWIENIE_HARMONOGRAM,
} from './config.js';
import { parseWeekdaysFromDniHarmonogramu } from './harmonogramDays.js';
import { ensureSheetExists } from './phase4.js';
import { sheetExists, normalizeOdebraneHeader } from './odebraneZHarmonogramu.js';
import { buildAddress } from './sheets.js';
import { aggregateRodzajZbiorkiFromSealRows, parseDataZamknieciaWorkaToSortMs } from './wordMapSupport.js';

/** Bez „Nr zlecenia transportowego”. Kolumna 17 = transport się odbył. */
export const ZESTAWIENIE_HARMONOGRAM_HEADERS = [
  'Adres odbioru',
  'Nazwa kontrahenta / podmiot handlowy',
  'Nazwa punktu / nazwa skrócona',
  'Data odbioru',
  'Kto odbiera',
  'Miejsce zrzutu',
  'Rodzaj zbiórki',
  'Ilość worków',
  'Trasa',
  'Stawka za trasę',
  'Stawka za podjazd',
  'Stawka za worek',
  'Rozliczony',
  'Numer faktury',
  'Koszt odbioru',
  'Koszt odbioru per worek',
  'transport się odbył',
  'Komentarz 1',
  'Komentarz 2',
] as const;

/** 1-based index of „transport się odbył” in {@link ZESTAWIENIE_HARMONOGRAM_HEADERS}. */
export const SCHEDULE_COL_TRANSPORT_ODBYL = 17;

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
  sheetRow: number;
  key: string;
  settled: boolean;
}

export interface ScheduleSyncPlan {
  create: ScheduleSyncExpectedRow[];
  update: Array<{ sheetRow: number; row: ScheduleSyncExpectedRow }>;
  skippedSettled: number;
}

type SheetsClient = {
  spreadsheets: {
    get(args: any, ...rest: any[]): Promise<{ data: unknown }>;
    batchUpdate(args: any, ...rest: any[]): Promise<unknown>;
    values: {
      get(args: any, ...rest: any[]): Promise<{ data: unknown }>;
      update(args: any, ...rest: any[]): Promise<unknown>;
      append(args: any, ...rest: any[]): Promise<unknown>;
      batchUpdate(args: any, ...rest: any[]): Promise<unknown>;
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

export function foldScheduleKeyPart(text: string): string {
  return String(text || '')
    .trim()
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

export function defaultSyncWindow(now = new Date()): { dataOd: string; dataDo: string } {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  return {
    dataOd: formatDdMmYyyy(y, m, 1),
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
 * Rodzaj zbiórki = agregat Tryb zbiórki z worków grupy.
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
      const row = ensure(meta.address, meta.contractor, day, '', '', 0, '');
      let best: BazaRate | null = null;
      for (const rate of rateRows) {
        if (rate.shop !== meta.address) continue;
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

export function parseScheduleRegisterRows(
  headers: string[],
  rows: string[][],
): ScheduleRegisterExistingRow[] {
  const ixAdres = headerIndex(headers, 'Adres odbioru');
  const ixData = headerIndex(headers, 'Data odbioru');
  const ixKto = headerIndex(headers, 'Kto odbiera');
  const ixRoz = headerIndex(headers, 'Rozliczony');
  const existing: ScheduleRegisterExistingRow[] = [];
  if (ixAdres < 0 || ixData < 0 || ixKto < 0) {
    return existing;
  }
  rows.forEach((row, index) => {
    const address = cell(row, ixAdres);
    const pickupDate = parseToDdMmYyyy(cell(row, ixData));
    const contractor = cell(row, ixKto);
    if (!address || !pickupDate || !contractor) return;
    existing.push({
      sheetRow: index + 2,
      key: scheduleRowKey(address, pickupDate, contractor),
      settled: ixRoz >= 0 && foldScheduleKeyPart(cell(row, ixRoz)) === 'tak',
    });
  });
  return existing;
}

export function planScheduleSync(
  expected: ScheduleSyncExpectedRow[],
  existing: ScheduleRegisterExistingRow[],
): ScheduleSyncPlan {
  const byKey = new Map(existing.map((e) => [e.key, e]));
  const create: ScheduleSyncExpectedRow[] = [];
  const update: Array<{ sheetRow: number; row: ScheduleSyncExpectedRow }> = [];
  let skippedSettled = 0;
  for (const row of expected) {
    const found = byKey.get(row.key);
    if (found) {
      if (found.settled) {
        skippedSettled += 1;
        continue;
      }
      update.push({ sheetRow: found.sheetRow, row });
      continue;
    }
    create.push(row);
  }
  return { create, update, skippedSettled };
}

export function zestawienieRowValues(row: ScheduleSyncExpectedRow, headers: string[]): string[] {
  const values = headers.map(() => '');
  const put = (name: string, value: string | number) => {
    const index = headerIndex(headers, name);
    if (index >= 0) values[index] = String(value);
  };
  put('Adres odbioru', row.address);
  put('Nazwa kontrahenta / podmiot handlowy', row.podmiot);
  put('Nazwa punktu / nazwa skrócona', row.shopName);
  put('Data odbioru', row.pickupDate);
  put('Kto odbiera', row.contractor);
  put('Rodzaj zbiórki', row.rodzajZbiorki);
  put('Ilość worków', row.bagCount);
  put('Trasa', row.routeName);
  put('Stawka za trasę', row.routeRate);
  put('Stawka za podjazd', row.pickupRate);
  put('Stawka za worek', row.bagRate);
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

async function ensureTransportOdbyłValidation(
  api: SheetsClient,
  spreadsheetId: string,
  sheetName: string,
  addStrikeRule: boolean,
): Promise<void> {
  const metaResponse = await api.spreadsheets.get({ spreadsheetId });
  const sheets = (
    metaResponse.data as {
      sheets?: Array<{
        properties?: { sheetId?: number; title?: string; gridProperties?: { rowCount?: number } };
      }>;
    }
  ).sheets;
  const props = (sheets ?? []).find((s) => s.properties?.title === sheetName)?.properties;
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
              endColumnIndex: SCHEDULE_COL_TRANSPORT_ODBYL,
            },
          ],
          booleanRule: {
            condition: {
              type: 'CUSTOM_FORMULA',
              values: [{ userEnteredValue: '=$Q2="nie"' }],
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
  sheetCreated: boolean;
  dataOd: string;
  dataDo: string;
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

  const sheetName = SHEET_NAME_ZESTAWIENIE_HARMONOGRAM;
  const exists = await sheetExists(api, spreadsheetId, sheetName);
  let sheetCreated = false;
  if (!exists) {
    await ensureSheetExists(api, spreadsheetId, sheetName);
    sheetCreated = true;
  }

  const currentValues = exists ? await readValues(api, spreadsheetId, sheetName) : [];
  const currentHeaders = (currentValues[0] ?? []).map((h) => String(h ?? ''));
  const headers = currentHeaders.some((h) => h.trim().length > 0)
    ? currentHeaders
    : [...ZESTAWIENIE_HARMONOGRAM_HEADERS];

  if (!currentHeaders.some((h) => h.trim().length > 0)) {
    await api.spreadsheets.values.update({
      spreadsheetId,
      range: `${quoteSheet(sheetName)}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }

  await ensureTransportOdbyłValidation(api, spreadsheetId, sheetName, sheetCreated);

  const existing = parseScheduleRegisterRows(
    headers,
    currentValues.slice(1).map((r) => r.map((c) => String(c ?? ''))),
  );
  const plan = planScheduleSync(expected, existing);

  if (plan.create.length > 0) {
    await api.spreadsheets.values.append({
      spreadsheetId,
      range: `${quoteSheet(sheetName)}!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: plan.create.map((row) => zestawienieRowValues(row, headers)),
      },
    });
  }

  if (plan.update.length > 0) {
    const fields: Array<{ name: string; value: (r: ScheduleSyncExpectedRow) => string }> = [
      { name: 'Ilość worków', value: (r) => String(r.bagCount) },
      { name: 'Rodzaj zbiórki', value: (r) => r.rodzajZbiorki },
      { name: 'Trasa', value: (r) => r.routeName },
      { name: 'Stawka za trasę', value: (r) => r.routeRate },
      { name: 'Stawka za podjazd', value: (r) => r.pickupRate },
      { name: 'Stawka za worek', value: (r) => r.bagRate },
      { name: 'Nazwa punktu / nazwa skrócona', value: (r) => r.shopName },
      { name: 'Nazwa kontrahenta / podmiot handlowy', value: (r) => r.podmiot },
    ];
    const data: Array<{ range: string; values: string[][] }> = [];
    for (const item of plan.update) {
      for (const field of fields) {
        const ix = headerIndex(headers, field.name);
        if (ix < 0) continue;
        const val = field.value(item.row);
        if (
          (field.name === 'Nazwa punktu / nazwa skrócona' ||
            field.name === 'Nazwa kontrahenta / podmiot handlowy') &&
          !val
        ) {
          continue;
        }
        data.push({
          range: `${quoteSheet(sheetName)}!${columnLetter(ix)}${item.sheetRow}`,
          values: [[val]],
        });
      }
    }
    if (data.length > 0) {
      await api.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'RAW', data },
      });
    }
  }

  logger?.info(
    'Zestawienie z harmonogramu: oczekiwane %d, nowe %d, zaktualizowane %d, pominięte rozliczone %d, okno %s–%s, nowa zakładka=%s (bez clear)',
    expected.length,
    plan.create.length,
    plan.update.length,
    plan.skippedSettled,
    dataOd,
    dataDo,
    sheetCreated,
  );

  return {
    expectedCount: expected.length,
    createdCount: plan.create.length,
    updatedCount: plan.update.length,
    skippedSettled: plan.skippedSettled,
    sheetCreated,
    dataOd,
    dataDo,
  };
}
