/**
 * Kopiowanie kwalifikujących się plomb do zakładki „odebrane z harmonogramu”.
 * Przy każdym uruchomieniu: czyści zakładkę i zapisuje pełną listę kandydatów
 * (mapowanie po nazwach nagłówków — kolejność kolumn ewidencji może różnić się od trasówek).
 */

import { SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU } from './config.js';
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
    const exact = sourceIndexByCanonical.get(targetKey);
    if (exact !== undefined) {
      return String(sourceRaw[exact] ?? '');
    }
    for (let i = 0; i < sourceHeaders.length; i++) {
      if (headersLooselyMatch(targetHeader, sourceHeaders[i] ?? '')) {
        return String(sourceRaw[i] ?? '');
      }
    }
    return '';
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
