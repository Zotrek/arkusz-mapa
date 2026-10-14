/**
 * Brakujące stawki podjazdu i worka na nierozliczonych wierszach Na zgłoszenie.
 * Snapshot przy dopisaniu transportu zostaje. Ten krok uzupełnia tylko puste
 * komórki, gdy para pojawiła się w Bazie stawek później (także po ręcznym wpisie).
 * Remis tej samej daty i wiersz z Rozliczony=tak zostają bez zmian.
 */

import { REPORT_MONTH_SHEET_PREFIX } from './config.js';
import { normalizeOdebraneHeader } from './odebraneZHarmonogramu.js';
import { normalizeRateShopKey, RATE_SHEET_NAME } from './saveRate.js';
import { compareDdMmYyyy, formatDdMmYyyy, parseToDdMmYyyy, sheetRateWriteValue } from './syncZestawienieHarmonogram.js';

/** Legacy rejestr Na zgłoszenie w tym samym pliku co zakładki miesięczne. */
export const LEGACY_REPORT_SHEET_NAME = 'Arkusz1';

export interface ReportRateRow {
  shop: string;
  contractor: string;
  pickup: string | number;
  bag: string | number;
  /** Pusty = od zawsze. Data już jako dd.mm.yyyy. */
  validFrom: string;
}

export interface ReportRegisterSheet {
  sheetName: string;
  headers: string[];
  rows: unknown[][];
}

export interface ReportRateFill {
  sheetName: string;
  /** Wiersz arkusza, 1-based (nagłówek = 1). */
  sheetRow: number;
  /** Kolumna 0-based. */
  columnIndex: number;
  value: string | number;
}

type SheetsClient = {
  spreadsheets: {
    get(args: { spreadsheetId: string }): Promise<{ data: unknown }>;
    values: {
      get(args: { spreadsheetId: string; range: string }): Promise<{ data: unknown }>;
      batchUpdate(args: {
        spreadsheetId: string;
        requestBody: { valueInputOption: string; data: Array<{ range: string; values: unknown[][] }> };
      }): Promise<unknown>;
    };
  };
};

interface LoggerLike {
  info: (message: string, ...args: unknown[]) => void;
  warn?: (message: string, ...args: unknown[]) => void;
}

export interface FillMissingReportRatesResult {
  filledCells: number;
  skippedSheets: number;
}

function headerIndex(headers: string[], name: string): number {
  const wanted = normalizeOdebraneHeader(name);
  for (let i = 0; i < headers.length; i++) {
    if (normalizeOdebraneHeader(String(headers[i] ?? '')) === wanted) {
      return i;
    }
  }
  return -1;
}

/** Żywy arkusz ma „Adres sklepu” / „Cena…”, zapis z mapy zakłada „Sklep” / „Kwota…”. */
function headerIndexAny(headers: string[], names: string[]): number {
  for (const name of names) {
    const index = headerIndex(headers, name);
    if (index >= 0) {
      return index;
    }
  }
  return -1;
}

function cellText(row: unknown[] | undefined, index: number): string {
  return String(row?.[index] ?? '').trim();
}

function isBlankRateCell(value: unknown): boolean {
  if (value == null) {
    return true;
  }
  if (typeof value === 'number') {
    return !Number.isFinite(value);
  }
  return String(value).trim() === '';
}

/** dd.mm.yyyy, ISO albo numer seryjny arkusza. Puste → null. */
export function reportRateDateKey(value: unknown): string | null {
  if (value == null || value === '') {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 20000 || value > 80000) {
      return null;
    }
    const serial = new Date((value - 25569) * 86400000);
    if (Number.isNaN(serial.getTime())) {
      return null;
    }
    return formatDdMmYyyy(serial.getUTCFullYear(), serial.getUTCMonth() + 1, serial.getUTCDate());
  }
  return parseToDdMmYyyy(String(value).trim());
}

function compareValidFrom(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (!a) {
    return -1;
  }
  if (!b) {
    return 1;
  }
  return compareDdMmYyyy(a, b);
}

function rateApplies(validFrom: string, pickupDate: string): boolean {
  if (!validFrom) {
    return true;
  }
  return compareValidFrom(validFrom, pickupDate) <= 0;
}

/**
 * Najnowsza para z Bazy stawek obowiązująca na dzień odbioru.
 * Ten sam klucz co snapshot przy dopisaniu transportu: adres po normalizacji + kto odbiera.
 * Dwie stawki z tą samą datą → puste (remis).
 */
export function resolveReportRateSnapshot(
  rates: ReportRateRow[],
  shop: string,
  contractor: string,
  pickupDate: string,
): { pickup: string | number; bag: string | number } {
  const empty = { pickup: '' as const, bag: '' as const };
  if (!shop || !contractor || !pickupDate || rates.length === 0) {
    return empty;
  }
  const shopKey = normalizeRateShopKey(shop);
  const matching = rates.filter(
    (rate) =>
      normalizeRateShopKey(rate.shop) === shopKey &&
      rate.contractor === contractor &&
      rateApplies(rate.validFrom, pickupDate),
  );
  if (matching.length === 0) {
    return empty;
  }
  let best = matching[0]!.validFrom;
  for (let i = 1; i < matching.length; i++) {
    if (compareValidFrom(matching[i]!.validFrom, best) > 0) {
      best = matching[i]!.validFrom;
    }
  }
  const winners = matching.filter((rate) => rate.validFrom === best);
  if (winners.length !== 1) {
    return empty;
  }
  const winner = winners[0]!;
  return {
    pickup: isBlankRateCell(winner.pickup) ? '' : winner.pickup,
    bag: isBlankRateCell(winner.bag) ? '' : winner.bag,
  };
}

export function isReportMonthSheetName(name: string): boolean {
  const n = name.trim();
  return n.startsWith(REPORT_MONTH_SHEET_PREFIX) && n.length > REPORT_MONTH_SHEET_PREFIX.length;
}

/** Legacy Arkusz1 + zakładki `Na zgłoszenie …`. Harmonogramu tu nie ma. */
export function reportRegisterSheetNamesFromTitles(titles: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  if (titles.includes(LEGACY_REPORT_SHEET_NAME)) {
    out.push(LEGACY_REPORT_SHEET_NAME);
    seen.add(LEGACY_REPORT_SHEET_NAME);
  }
  for (const title of titles) {
    if (seen.has(title) || !isReportMonthSheetName(title)) {
      continue;
    }
    out.push(title);
    seen.add(title);
  }
  return out;
}

export function parseReportRateRows(headers: string[], rows: unknown[][]): ReportRateRow[] {
  const ixShop = headerIndexAny(headers, ['Sklep', 'Adres sklepu']);
  const ixContractor = headerIndex(headers, 'Podwykonawca');
  const ixPickup = headerIndexAny(headers, ['Kwota za podjazd', 'Cena za podjazd']);
  const ixBag = headerIndexAny(headers, ['Kwota za worek', 'Cena za worek']);
  const ixFrom = headerIndexAny(headers, ['Od kiedy obowiązuje', 'Od kiedy obowiązuje cena']);
  if (ixShop < 0 || ixContractor < 0 || ixPickup < 0 || ixBag < 0 || ixFrom < 0) {
    return [];
  }
  const out: ReportRateRow[] = [];
  for (const row of rows) {
    const shop = cellText(row, ixShop);
    const contractor = cellText(row, ixContractor);
    if (!shop || !contractor) {
      continue;
    }
    const rawFrom = row?.[ixFrom];
    const validFrom = rawFrom == null || String(rawFrom).trim() === '' ? '' : reportRateDateKey(rawFrom);
    if (validFrom == null) {
      continue;
    }
    const pickup = row?.[ixPickup];
    const bag = row?.[ixBag];
    out.push({
      shop,
      contractor,
      pickup: pickup == null || pickup === '' ? '' : (pickup as string | number),
      bag: bag == null || bag === '' ? '' : (bag as string | number),
      validFrom,
    });
  }
  return out;
}

function pushFill(
  fills: ReportRateFill[],
  sheetName: string,
  sheetRow: number,
  columnIndex: number,
  raw: string | number,
): void {
  const value = sheetRateWriteValue(raw);
  if (value === '') {
    return;
  }
  fills.push({ sheetName, sheetRow, columnIndex, value });
}

/**
 * Puste Stawka za podjazd / Stawka za worek na nierozliczonych wierszach.
 * Wypełniona komórka zostaje. Rozliczony=tak jest pomijany.
 */
export function planReportRateFills(rates: ReportRateRow[], registers: ReportRegisterSheet[]): ReportRateFill[] {
  const fills: ReportRateFill[] = [];
  for (const register of registers) {
    const headers = register.headers;
    const ixAdres = headerIndex(headers, 'Adres sklepu');
    const ixData = headerIndex(headers, 'Data odbioru');
    const ixKto = headerIndex(headers, 'Kto odbiera');
    const ixPickup = headerIndex(headers, 'Stawka za podjazd');
    const ixBag = headerIndex(headers, 'Stawka za worek');
    const ixSettled = headerIndex(headers, 'Rozliczony');
    if (ixAdres < 0 || ixData < 0 || ixKto < 0 || ixPickup < 0 || ixBag < 0 || ixSettled < 0) {
      continue;
    }
    for (let i = 0; i < register.rows.length; i++) {
      const row = register.rows[i];
      if (cellText(row, ixSettled).toLowerCase() === 'tak') {
        continue;
      }
      const pickupBlank = isBlankRateCell(row?.[ixPickup]);
      const bagBlank = isBlankRateCell(row?.[ixBag]);
      if (!pickupBlank && !bagBlank) {
        continue;
      }
      const pickupDate = reportRateDateKey(row?.[ixData]);
      if (!pickupDate) {
        continue;
      }
      const snap = resolveReportRateSnapshot(rates, cellText(row, ixAdres), cellText(row, ixKto), pickupDate);
      const sheetRow = i + 2;
      if (pickupBlank) {
        pushFill(fills, register.sheetName, sheetRow, ixPickup, snap.pickup);
      }
      if (bagBlank) {
        pushFill(fills, register.sheetName, sheetRow, ixBag, snap.bag);
      }
    }
  }
  return fills;
}

function quoteSheet(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`;
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

async function listTitles(api: SheetsClient, spreadsheetId: string): Promise<string[]> {
  const metaResponse = await api.spreadsheets.get({ spreadsheetId });
  const sheets = (metaResponse.data as { sheets?: Array<{ properties?: { title?: string } }> }).sheets;
  return (sheets ?? [])
    .map((s) => String(s.properties?.title ?? '').trim())
    .filter((title) => title.length > 0);
}

async function readValues(api: SheetsClient, spreadsheetId: string, sheetName: string): Promise<unknown[][]> {
  const response = await api.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheet(sheetName)}!A:T`,
  });
  return ((response.data as { values?: unknown[][] }).values ?? []) as unknown[][];
}

export async function fillMissingReportRates(
  api: SheetsClient,
  input: { spreadsheetId: string },
  logger?: LoggerLike,
): Promise<FillMissingReportRatesResult> {
  const titles = await listTitles(api, input.spreadsheetId);
  if (!titles.includes(RATE_SHEET_NAME)) {
    logger?.info('Brak zakładki „%s” — puste stawki Na zgłoszenie zostają puste', RATE_SHEET_NAME);
    return { filledCells: 0, skippedSheets: 0 };
  }
  const rateValues = await readValues(api, input.spreadsheetId, RATE_SHEET_NAME);
  const rates = parseReportRateRows(
    (rateValues[0] ?? []).map((h) => String(h ?? '')),
    rateValues.slice(1),
  );
  const sheetNames = reportRegisterSheetNamesFromTitles(titles);
  const registers: ReportRegisterSheet[] = [];
  let skippedSheets = 0;
  for (const sheetName of sheetNames) {
    const values = await readValues(api, input.spreadsheetId, sheetName);
    const headers = (values[0] ?? []).map((h) => String(h ?? ''));
    const ready =
      headerIndex(headers, 'Adres sklepu') >= 0 &&
      headerIndex(headers, 'Stawka za podjazd') >= 0 &&
      headerIndex(headers, 'Rozliczony') >= 0;
    if (!ready) {
      skippedSheets += 1;
      const log = logger?.warn ?? logger?.info;
      log?.('Zakładka „%s” nie ma kolumn stawek Na zgłoszenie — pomijam', sheetName);
      continue;
    }
    registers.push({ sheetName, headers, rows: values.slice(1) });
  }
  const fills = planReportRateFills(rates, registers);
  if (fills.length === 0) {
    logger?.info('Na zgłoszenie: brak pustych stawek do uzupełnienia');
    return { filledCells: 0, skippedSheets };
  }
  await api.spreadsheets.values.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: fills.map((fill) => ({
        range: `${quoteSheet(fill.sheetName)}!${columnLetter(fill.columnIndex)}${fill.sheetRow}`,
        values: [[fill.value]],
      })),
    },
  });
  logger?.info('Na zgłoszenie: uzupełniono %d pustych stawek', fills.length);
  return { filledCells: fills.length, skippedSheets };
}
