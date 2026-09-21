/**
 * Zakładka „Baza cen harmonogram” w arkuszu ewidencji.
 * Źródło sklepu, podwykonawcy i dni: „odebrane z harmonogramu”.
 * Ceny, nazwa trasy i data obowiązywania zostają puste albo nietknięte.
 */

import {
  SHEET_NAME_BAZA_CEN_HARMONOGRAM,
  SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU,
} from './config.js';
import { ensureSheetExists } from './phase4.js';
import { sheetExists, normalizeOdebraneHeader } from './odebraneZHarmonogramu.js';
import { buildAddress } from './sheets.js';

export const BAZA_CEN_HEADERS = [
  'Adres sklepu',
  'Podwykonawca',
  'Nazwa trasy',
  'Cena za podjazd',
  'Cena za worek',
  'Cena za trasę',
  'Od kiedy obowiązuje cena',
  'Dni odbiorów',
] as const;

export interface BazaCenShop {
  adres: string;
  podwykonawca: string;
  dni: string;
}

export interface BazaCenExistingRow {
  sheetRow: number;
  adres: string;
  podwykonawca: string;
  dni: string;
}

export interface BazaCenSyncPlan {
  append: BazaCenShop[];
  dayUpdates: Array<{ sheetRow: number; dni: string }>;
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

function collapse(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function bazaCenKey(adres: string, podwykonawca: string): string {
  return `${collapse(adres)}\n${collapse(podwykonawca)}`;
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

function requireHeader(headers: string[], name: string, sheetName: string): number {
  const index = headerIndex(headers, name);
  if (index < 0) {
    throw new Error(`Brak kolumny „${name}” w zakładce „${sheetName}”`);
  }
  return index;
}

function cell(row: string[] | undefined, index: number): string {
  return String(row?.[index] ?? '');
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

/**
 * Jedna pozycja na adres + firmę transportową.
 * Przy różnych dniach zostaje pierwsza niepusta wartość.
 */
export function shopsFromOdebraneRows(headers: string[], rows: string[][]): BazaCenShop[] {
  const kod = requireHeader(headers, 'Kod pocztowy', SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU);
  const miasto = requireHeader(headers, 'Miasto', SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU);
  const ulica = requireHeader(headers, 'Ulica', SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU);
  const numer = requireHeader(headers, 'Numer budynku', SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU);
  const firma = requireHeader(headers, 'Firma transportowa', SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU);
  const dni = requireHeader(headers, 'Dni harmonogramu', SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU);

  const byKey = new Map<string, BazaCenShop>();
  for (const row of rows) {
    const adres = buildAddress({
      kodPocztowy: cell(row, kod),
      miasto: cell(row, miasto),
      ulica: cell(row, ulica),
      numerBudynku: cell(row, numer),
    });
    const podwykonawca = collapse(cell(row, firma));
    if (!adres || !podwykonawca) {
      continue;
    }
    const key = bazaCenKey(adres, podwykonawca);
    const days = collapse(cell(row, dni));
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { adres, podwykonawca, dni: days });
      continue;
    }
    if (!current.dni && days) {
      current.dni = days;
    }
  }
  return [...byKey.values()];
}

export function parseBazaCenRows(headers: string[], rows: string[][]): BazaCenExistingRow[] {
  const adres = requireHeader(headers, 'Adres sklepu', SHEET_NAME_BAZA_CEN_HARMONOGRAM);
  const podwykonawca = requireHeader(headers, 'Podwykonawca', SHEET_NAME_BAZA_CEN_HARMONOGRAM);
  const dni = requireHeader(headers, 'Dni odbiorów', SHEET_NAME_BAZA_CEN_HARMONOGRAM);
  const parsed: BazaCenExistingRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (row.every((value) => String(value ?? '').trim() === '')) {
      continue;
    }
    parsed.push({
      sheetRow: i + 2,
      adres: collapse(cell(row, adres)),
      podwykonawca: collapse(cell(row, podwykonawca)),
      dni: collapse(cell(row, dni)),
    });
  }
  return parsed;
}

/** Dopisuje brakujące sklepy. Dni aktualizuje na każdym wierszu tej pary. Cen nie rusza. */
export function planBazaCenSync(shops: BazaCenShop[], existing: BazaCenExistingRow[]): BazaCenSyncPlan {
  const rowsByKey = new Map<string, BazaCenExistingRow[]>();
  for (const row of existing) {
    if (!row.adres || !row.podwykonawca) {
      continue;
    }
    const key = bazaCenKey(row.adres, row.podwykonawca);
    const list = rowsByKey.get(key);
    if (list) {
      list.push(row);
    } else {
      rowsByKey.set(key, [row]);
    }
  }

  const append: BazaCenShop[] = [];
  const dayUpdates: Array<{ sheetRow: number; dni: string }> = [];
  for (const shop of shops) {
    const rows = rowsByKey.get(bazaCenKey(shop.adres, shop.podwykonawca));
    if (!rows) {
      append.push(shop);
      continue;
    }
    for (const row of rows) {
      if (row.dni !== shop.dni) {
        dayUpdates.push({ sheetRow: row.sheetRow, dni: shop.dni });
      }
    }
  }
  return { append, dayUpdates };
}

export function bazaCenRowValues(shop: BazaCenShop, headers: string[]): string[] {
  const values = headers.map(() => '');
  const put = (name: string, value: string) => {
    const index = headerIndex(headers, name);
    if (index >= 0) {
      values[index] = value;
    }
  };
  put('Adres sklepu', shop.adres);
  put('Podwykonawca', shop.podwykonawca);
  put('Dni odbiorów', shop.dni);
  return values;
}

async function readValues(
  api: SheetsClient,
  spreadsheetId: string,
  sheetName: string,
): Promise<string[][]> {
  const response = await api.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheet(sheetName)}!A:Z`,
  });
  return ((response.data as { values?: string[][] }).values ?? []) as string[][];
}

export interface SyncBazaCenHarmonogramResult {
  shopCount: number;
  appendedCount: number;
  daysUpdatedCount: number;
  sheetCreated: boolean;
}

export async function syncBazaCenHarmonogram(
  api: SheetsClient,
  input: { spreadsheetId: string },
  logger?: LoggerLike,
): Promise<SyncBazaCenHarmonogramResult> {
  const spreadsheetId = input.spreadsheetId.trim();
  if (!spreadsheetId) {
    throw new Error('Missing spreadsheetId for Baza cen harmonogram');
  }

  const sourceExists = await sheetExists(api, spreadsheetId, SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU);
  if (!sourceExists) {
    logger?.info('Baza cen harmonogram: brak zakładki „odebrane z harmonogramu”');
    return { shopCount: 0, appendedCount: 0, daysUpdatedCount: 0, sheetCreated: false };
  }

  const sourceValues = await readValues(api, spreadsheetId, SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU);
  const sourceHeaders = (sourceValues[0] ?? []).map((header) => String(header ?? ''));
  const shops =
    sourceHeaders.length === 0
      ? []
      : shopsFromOdebraneRows(
          sourceHeaders,
          sourceValues.slice(1).map((row) => row.map((value) => String(value ?? ''))),
        );

  const sheetName = SHEET_NAME_BAZA_CEN_HARMONOGRAM;
  const exists = await sheetExists(api, spreadsheetId, sheetName);
  let sheetCreated = false;
  if (!exists) {
    await ensureSheetExists(api, spreadsheetId, sheetName);
    sheetCreated = true;
  }

  const currentValues = exists ? await readValues(api, spreadsheetId, sheetName) : [];
  const currentHeaders = (currentValues[0] ?? []).map((header) => String(header ?? ''));
  const headers = currentHeaders.some((header) => header.trim().length > 0)
    ? currentHeaders
    : [...BAZA_CEN_HEADERS];

  if (!currentHeaders.some((header) => header.trim().length > 0)) {
    await api.spreadsheets.values.update({
      spreadsheetId,
      range: `${quoteSheet(sheetName)}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }

  const existing = parseBazaCenRows(
    headers,
    currentValues.slice(1).map((row) => row.map((value) => String(value ?? ''))),
  );
  const plan = planBazaCenSync(shops, existing);
  const dniColumn = requireHeader(headers, 'Dni odbiorów', sheetName);

  if (plan.append.length > 0) {
    await api.spreadsheets.values.append({
      spreadsheetId,
      range: `${quoteSheet(sheetName)}!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: plan.append.map((shop) => bazaCenRowValues(shop, headers)),
      },
    });
  }

  if (plan.dayUpdates.length > 0) {
    const letter = columnLetter(dniColumn);
    await api.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: plan.dayUpdates.map((update) => ({
          range: `${quoteSheet(sheetName)}!${letter}${update.sheetRow}`,
          values: [[update.dni]],
        })),
      },
    });
  }

  logger?.info(
    'Baza cen harmonogram: sklepy %d, dopisane %d, dni zaktualizowane %d, nowa zakładka=%s',
    shops.length,
    plan.append.length,
    plan.dayUpdates.length,
    sheetCreated,
  );

  return {
    shopCount: shops.length,
    appendedCount: plan.append.length,
    daysUpdatedCount: plan.dayUpdates.length,
    sheetCreated,
  };
}
