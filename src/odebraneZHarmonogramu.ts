/**
 * Kopiowanie kwalifikujących się plomb do zakładki „odebrane z harmonogramu”.
 * Tworzy zakładkę / dopisuje tylko gdy są nowe przypadki (idempotencja po numerze plomby).
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

export async function sheetExists(
  api: SheetsMetaClient,
  spreadsheetId: string,
  sheetName: string,
): Promise<boolean> {
  const metaResponse = await api.spreadsheets.get({ spreadsheetId });
  const meta = (metaResponse.data as SheetMeta) ?? {};
  return (meta.sheets ?? []).some((s) => s.properties?.title === sheetName);
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
  for (let i = 1; i < values.length; i++) {
    const seal = String(values[i]?.[numerPlombyCol] ?? '').trim();
    if (seal) {
      out.add(seal);
    }
  }
  return out;
}

export interface ExecuteOdebraneZHarmonogramuInput {
  spreadsheetId: string;
  headers: string[];
  rows: SheetRow[];
  columnMap: SheetColumnMap;
  todayUtc?: number;
}

export interface ExecuteOdebraneZHarmonogramuResult {
  candidatesCount: number;
  appendedCount: number;
  skippedExistingCount: number;
  sheetCreated: boolean;
}

interface LoggerLike {
  info: (message: string, ...args: unknown[]) => void;
}

/**
 * Kopiuje nowe kwalifikujące się wiersze. Nie tworzy zakładki, gdy brak nowych do dopisania.
 */
export async function executeOdebraneZHarmonogramu(
  api: OdebraneSheetsClient,
  input: ExecuteOdebraneZHarmonogramuInput,
  logger?: LoggerLike,
): Promise<ExecuteOdebraneZHarmonogramuResult> {
  const candidates = filterRowsForOdebraneZHarmonogramu(input.rows, input.todayUtc);
  if (candidates.length === 0) {
    logger?.info('Odebrane z harmonogramu: brak kandydatów do skopiowania');
    return {
      candidatesCount: 0,
      appendedCount: 0,
      skippedExistingCount: 0,
      sheetCreated: false,
    };
  }

  const exists = await sheetExists(api, input.spreadsheetId, SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU);
  let existing = new Set<string>();
  let sheetCreated = false;

  if (exists) {
    existing = await loadExistingSealNumbers(
      api,
      input.spreadsheetId,
      SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU,
      input.columnMap.numerPlomby,
    );
  }

  const toAppend = candidates.filter((row) => {
    const seal = row.numerPlomby.trim();
    return seal.length > 0 && !existing.has(seal);
  });
  const skippedExistingCount = candidates.length - toAppend.length;

  if (toAppend.length === 0) {
    logger?.info(
      'Odebrane z harmonogramu: %d kandydat(ów), wszystkie już w zakładce',
      candidates.length,
    );
    return {
      candidatesCount: candidates.length,
      appendedCount: 0,
      skippedExistingCount,
      sheetCreated: false,
    };
  }

  if (!exists) {
    await ensureSheetExists(api, input.spreadsheetId, SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU);
    sheetCreated = true;
    await api.spreadsheets.values.update({
      spreadsheetId: input.spreadsheetId,
      range: buildSheetStartRange(SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU),
      valueInputOption: 'RAW',
      requestBody: {
        values: [input.headers, ...toAppend.map((r) => r.raw)],
      },
    });
  } else {
    await api.spreadsheets.values.append({
      spreadsheetId: input.spreadsheetId,
      range: buildSheetRange(SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU),
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: toAppend.map((r) => r.raw),
      },
    });
  }

  logger?.info(
    'Odebrane z harmonogramu: skopiowano %d (kandydaci %d, pominięte duplikaty %d, nowa zakładka=%s)',
    toAppend.length,
    candidates.length,
    skippedExistingCount,
    sheetCreated,
  );

  return {
    candidatesCount: candidates.length,
    appendedCount: toAppend.length,
    skippedExistingCount,
    sheetCreated,
  };
}
