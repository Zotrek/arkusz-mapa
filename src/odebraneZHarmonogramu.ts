/**
 * Kopiowanie kwalifikujących się plomb do zakładki „odebrane z harmonogramu”.
 * Przy każdym uruchomieniu: czyści zakładkę i zapisuje pełną listę kandydatów
 * (mapowanie po nazwach nagłówków — kolejność kolumn ewidencji może różnić się od trasówek).
 */

import { SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU } from './config.js';
import { parseDataZamknieciaWorkaToSortMs } from './wordMapSupport.js';
import { expandAllTables } from './sheetTables.js';
import { shouldCopyToOdebraneZHarmonogramu } from './harmonogramDays.js';
import { ensureSheetExists } from './phase4.js';
import type { SheetColumnMap, SheetRow } from './sheets.js';

type SheetsMetaClient = {
  spreadsheets: {
    get(args: any, ...rest: any[]): Promise<{ data: unknown }>;
    batchUpdate(args: any, ...rest: any[]): Promise<unknown>;
  };
};

type SheetsValuesClient = {
  spreadsheets: {
    values: {
      get(args: any, ...rest: any[]): Promise<{ data: unknown }>;
      clear(args: any, ...rest: any[]): Promise<unknown>;
      update(args: any, ...rest: any[]): Promise<unknown>;
      append(args: any, ...rest: any[]): Promise<unknown>;
      batchUpdate(args: any, ...rest: any[]): Promise<unknown>;
    };
  };
};

export type OdebraneSheetsClient = SheetsMetaClient & SheetsValuesClient;

type SheetMeta = {
  sheets?: Array<{
    properties?: {
      title?: string;
    };
  }>;
};

function buildSheetRange(sheetName: string): string {
  const escaped = sheetName.replace(/'/g, "''");
  return `'${escaped}'!A:Z`;
}

function buildSheetStartRange(sheetName: string): string {
  const escaped = sheetName.replace(/'/g, "''");
  return `'${escaped}'!A1`;
}

export function normalizeOdebraneHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ');
}

/** Ujednolica warianty nazw kolumn ewidencja ↔ trasówki. */
function canonicalOdebraneHeader(normalized: string): string {
  let h = normalized;
  if (h === 'stan worka') {
    h = 'status worka';
  }
  if (h === 'status tms') {
    h = 'status tms worka';
  }
  if (h === 'data zamkniecia' || h === 'data zamkniecia worka') {
    h = 'data zamkniecia worka';
  }
  if (h === 'podmiot har' || h.startsWith('podmiot har')) {
    h = 'podmiot handlowy';
  }
  if (h === 'firma transp' || h.startsWith('firma transp')) {
    h = 'firma transportowa';
  }
  if (h === 'numer budy' || h.startsWith('numer budy')) {
    h = 'numer budynku';
  }
  return h;
}

export function headersLooselyMatch(a: string, b: string): boolean {
  const ca = canonicalOdebraneHeader(normalizeOdebraneHeader(a));
  const cb = canonicalOdebraneHeader(normalizeOdebraneHeader(b));
  if (ca.length === 0 || cb.length === 0) {
    return false;
  }
  if (ca === cb) {
    return true;
  }
  // Skrócone nagłówki w UI (np. „Wg harmoni…” vs „Wg harmonogramu”).
  const shorter = ca.length <= cb.length ? ca : cb;
  const longer = ca.length <= cb.length ? cb : ca;
  return shorter.length >= 6 && longer.startsWith(shorter);
}

/**
 * Indeks kolumny „Numer plomby” w nagłówkach ewidencji (−1 gdy brak).
 */
export function findNumerPlombyColumnIndex(headers: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = normalizeOdebraneHeader(headers[i] ?? '');
    if (h.includes('numer plomb') || h.includes('plomb')) {
      return i;
    }
  }
  return -1;
}

function headerIsDateColumn(header: string): boolean {
  return normalizeOdebraneHeader(header).includes('data');
}

/** Tekst daty do komórki: `dd-mm-yyyy`. Nie-data zostaje jak była. */
export function sheetCellDateText(raw: string): string {
  const text = raw.trim();
  if (!text) {
    return '';
  }
  const ms = parseDataZamknieciaWorkaToSortMs(text);
  if (ms === Number.NEGATIVE_INFINITY || !Number.isFinite(ms)) {
    return text;
  }
  const parsed = new Date(ms);
  const year = parsed.getUTCFullYear();
  const month = parsed.getUTCMonth() + 1;
  const day = parsed.getUTCDate();
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${pad(day)}-${pad(month)}-${year}`;
}

/**
 * Przepisuje wiersz źródłowy (trasówki) na kolejność kolumn ewidencji po nazwach nagłówków.
 */
export function remapRawRowToTargetHeaders(
  sourceHeaders: string[],
  sourceRaw: string[],
  targetHeaders: string[],
): string[] {
  const sourceIndexByCanonical = new Map<string, number>();
  for (let i = 0; i < sourceHeaders.length; i++) {
    const key = canonicalOdebraneHeader(normalizeOdebraneHeader(sourceHeaders[i] ?? ''));
    if (key.length > 0 && !sourceIndexByCanonical.has(key)) {
      sourceIndexByCanonical.set(key, i);
    }
  }

  return targetHeaders.map((targetHeader) => {
    const targetKey = canonicalOdebraneHeader(normalizeOdebraneHeader(targetHeader));
    let value = '';
    const exact = sourceIndexByCanonical.get(targetKey);
    if (exact !== undefined) {
      value = String(sourceRaw[exact] ?? '');
    } else {
      for (let i = 0; i < sourceHeaders.length; i++) {
        if (headersLooselyMatch(targetHeader, sourceHeaders[i] ?? '')) {
          value = String(sourceRaw[i] ?? '');
          break;
        }
      }
    }
    return headerIsDateColumn(targetHeader) ? sheetCellDateText(value) : value;
  });
}

export function filterRowsForOdebraneZHarmonogramu(
  rows: SheetRow[],
  todayUtc?: number,
): SheetRow[] {
  return rows.filter((row) =>
    shouldCopyToOdebraneZHarmonogramu({
      zbiorka: row.zbiorka,
      wgHarmonogramu: row.wgHarmonogramu,
      dniHarmonogramu: row.dniHarmonogramu,
      dataZamknieciaWorka: row.dataZamknieciaWorka,
      todayUtc,
    }),
  );
}

/** Unikalne po numerze plomby (pierwsze wystąpienie wygrywa); puste plomby pomijane. */
export function dedupeCandidatesBySeal(rows: SheetRow[]): {
  unique: SheetRow[];
  skippedDuplicateCount: number;
} {
  const seen = new Set<string>();
  const unique: SheetRow[] = [];
  let skippedDuplicateCount = 0;
  for (const row of rows) {
    const seal = row.numerPlomby.trim();
    if (seal.length === 0) {
      skippedDuplicateCount += 1;
      continue;
    }
    if (seen.has(seal)) {
      skippedDuplicateCount += 1;
      continue;
    }
    seen.add(seal);
    unique.push(row);
  }
  return { unique, skippedDuplicateCount };
}

export async function sheetExists(
  api: SheetsMetaClient,
  spreadsheetId: string,
  sheetName: string,
): Promise<boolean> {
  const metaResponse = await api.spreadsheets.get({ spreadsheetId });
  const meta = (metaResponse.data as SheetMeta) ?? {};
  return (meta.sheets ?? []).some((s) => s.properties?.title === sheetName);
}

/** Odczyt nagłówków zakładki ewidencji (wiersz 1). */
export async function loadOdebraneTargetHeaders(
  api: SheetsValuesClient,
  spreadsheetId: string,
  sheetName: string,
): Promise<string[]> {
  const response = await api.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName.replace(/'/g, "''")}'!1:1`,
  });
  const values = ((response.data as { values?: string[][] }).values ?? []) as string[][];
  return (values[0] ?? []).map((h) => String(h ?? ''));
}

export async function loadExistingSealNumbers(
  api: SheetsValuesClient,
  spreadsheetId: string,
  sheetName: string,
  numerPlombyCol: number,
): Promise<Set<string>> {
  const response = await api.spreadsheets.values.get({
    spreadsheetId,
    range: buildSheetRange(sheetName),
  });
  const values = ((response.data as { values?: string[][] }).values ?? []) as string[][];
  const out = new Set<string>();
  if (numerPlombyCol < 0) {
    return out;
  }
  for (let i = 1; i < values.length; i++) {
    const seal = String(values[i]?.[numerPlombyCol] ?? '').trim();
    if (seal) {
      out.add(seal);
    }
  }
  return out;
}

export async function loadOdebraneTargetSheetState(
  api: SheetsValuesClient,
  spreadsheetId: string,
  sheetName: string,
): Promise<{ headers: string[]; existingSeals: Set<string> }> {
  const response = await api.spreadsheets.values.get({
    spreadsheetId,
    range: buildSheetRange(sheetName),
  });
  const values = ((response.data as { values?: string[][] }).values ?? []) as string[][];
  const headers = (values[0] ?? []).map((h) => String(h ?? ''));
  const numerPlombyCol = findNumerPlombyColumnIndex(headers);
  const existingSeals = new Set<string>();
  if (numerPlombyCol >= 0) {
    for (let i = 1; i < values.length; i++) {
      const seal = String(values[i]?.[numerPlombyCol] ?? '').trim();
      if (seal) {
        existingSeals.add(seal);
      }
    }
  }
  return { headers, existingSeals };
}

export interface ExecuteOdebraneZHarmonogramuInput {
  /** Arkusz źródłowy (trasówki) — tylko do mapowania kolumn / raw; zapis idzie do targetSpreadsheetId. */
  spreadsheetId?: string;
  /** Cel zapisu (ewidencja odbiorów). */
  targetSpreadsheetId: string;
  headers: string[];
  rows: SheetRow[];
  columnMap: SheetColumnMap;
  todayUtc?: number;
}

export interface ExecuteOdebraneZHarmonogramuResult {
  candidatesCount: number;
  /** Liczba wierszy zapisanych po odświeżeniu. */
  appendedCount: number;
  /** Pominięte w partii: puste plomby / powtórzenia numeru plomby. */
  skippedExistingCount: number;
  sheetCreated: boolean;
  /** Zakładka została wyczyszczona przed zapisem. */
  sheetCleared: boolean;
}

interface LoggerLike {
  info: (message: string, ...args: unknown[]) => void;
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

/**
 * RAW zostawia datę, gdy kolumna tabeli jest typu Data.
 * Apostrof (USER_ENTERED) i format tekstu trzymają `dd-mm-yyyy` jako tekst.
 */
async function forceOdebraneDateColumnsAsText(
  api: OdebraneSheetsClient,
  spreadsheetId: string,
  sheetName: string,
  headers: string[],
  dataRows: string[][],
): Promise<void> {
  if (dataRows.length === 0) {
    return;
  }
  const dateCols: number[] = [];
  for (let i = 0; i < headers.length; i++) {
    if (headerIsDateColumn(headers[i] ?? '')) {
      dateCols.push(i);
    }
  }
  if (dateCols.length === 0) {
    return;
  }

  const escaped = sheetName.replace(/'/g, "''");
  const data: Array<{ range: string; values: string[][] }> = [];
  for (const col of dateCols) {
    for (let r = 0; r < dataRows.length; r++) {
      const text = dataRows[r]?.[col] ?? '';
      if (!/^\d{2}-\d{2}-\d{4}$/.test(text)) {
        continue;
      }
      data.push({
        range: `'${escaped}'!${columnLetter(col)}${r + 2}`,
        values: [["'" + text]],
      });
    }
  }
  if (data.length === 0) {
    return;
  }

  await api.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  });

  const metaResponse = await api.spreadsheets.get({ spreadsheetId });
  const sheets =
    (
      metaResponse.data as {
        sheets?: Array<{ properties?: { title?: string; sheetId?: number } }>;
      }
    ).sheets ?? [];
  const sheetId = sheets.find((sheet) => sheet.properties?.title === sheetName)?.properties?.sheetId;
  if (sheetId == null) {
    return;
  }

  await api.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: dateCols.map((col) => ({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 1,
            endRowIndex: 1 + dataRows.length,
            startColumnIndex: col,
            endColumnIndex: col + 1,
          },
          cell: {
            userEnteredFormat: { numberFormat: { type: 'TEXT', pattern: '@' } },
          },
          fields: 'userEnteredFormat.numberFormat',
        },
      })),
    },
  });
}

async function overwriteOdebraneSheet(
  api: OdebraneSheetsClient,
  spreadsheetId: string,
  sheetName: string,
  headers: string[],
  dataRows: string[][],
): Promise<void> {
  await api.spreadsheets.values.clear({
    spreadsheetId,
    range: buildSheetRange(sheetName),
  });
  await api.spreadsheets.values.update({
    spreadsheetId,
    range: buildSheetStartRange(sheetName),
    valueInputOption: 'RAW',
    requestBody: {
      values: [headers, ...dataRows],
    },
  });
  await forceOdebraneDateColumnsAsText(api, spreadsheetId, sheetName, headers, dataRows);
}

/**
 * Pełne odświeżenie zakładki: clear + zapis wszystkich kwalifikujących się wierszy.
 * Zachowuje istniejące nagłówki ewidencji (mapowanie po nazwach).
 */
export async function executeOdebraneZHarmonogramu(
  api: OdebraneSheetsClient,
  input: ExecuteOdebraneZHarmonogramuInput,
  logger?: LoggerLike,
): Promise<ExecuteOdebraneZHarmonogramuResult> {
  const candidates = filterRowsForOdebraneZHarmonogramu(input.rows, input.todayUtc);
  const { unique: toWrite, skippedDuplicateCount } = dedupeCandidatesBySeal(candidates);

  const targetId = input.targetSpreadsheetId.trim();
  if (!targetId) {
    throw new Error(
      'Missing targetSpreadsheetId — set GOOGLE_EWIDENCJA_ODBIOROW_SHEETS_ID (arkusz ewidencja odbiorów)',
    );
  }

  const exists = await sheetExists(api, targetId, SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU);
  let sheetCreated = false;
  let targetHeaders = input.headers;

  if (!exists && toWrite.length === 0) {
    logger?.info('Odebrane z harmonogramu: brak kandydatów do skopiowania');
    return {
      candidatesCount: 0,
      appendedCount: 0,
      skippedExistingCount: skippedDuplicateCount,
      sheetCreated: false,
      sheetCleared: false,
    };
  }

  if (exists) {
    const existingHeaders = await loadOdebraneTargetHeaders(
      api,
      targetId,
      SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU,
    );
    if (existingHeaders.some((h) => h.trim().length > 0)) {
      targetHeaders = existingHeaders;
    }
  } else {
    await ensureSheetExists(api, targetId, SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU);
    sheetCreated = true;
  }

  const mappedRows = toWrite.map((r) =>
    remapRawRowToTargetHeaders(input.headers, r.raw, targetHeaders),
  );

  await overwriteOdebraneSheet(
    api,
    targetId,
    SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU,
    targetHeaders,
    mappedRows,
  );
  await expandAllTables(api, targetId);

  logger?.info(
    'Odebrane z harmonogramu → ewidencja (%s): odświeżono %d (kandydaci %d, pominięte w partii %d, nowa zakładka=%s)',
    targetId,
    mappedRows.length,
    candidates.length,
    skippedDuplicateCount,
    sheetCreated,
  );

  return {
    candidatesCount: candidates.length,
    appendedCount: mappedRows.length,
    skippedExistingCount: skippedDuplicateCount,
    sheetCreated,
    sheetCleared: true,
  };
}
