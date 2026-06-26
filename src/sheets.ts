/**
 * Faza 2: odczyt i parsowanie danych z Google Sheets.
 */

import { readFile } from 'node:fs/promises';
import { google, type sheets_v4 } from 'googleapis';
import { DEFAULT_SHEET_COLUMN_MAP, DEFAULT_ADDRESS_ALIASES_PATH } from './config.js';

export interface AddressParts {
  kodPocztowy: string;
  miasto: string;
  ulica: string;
  numerBudynku: string;
}

export type SheetColumnMap = {
  [K in keyof typeof DEFAULT_SHEET_COLUMN_MAP]: number;
};

export interface SheetRow extends AddressParts {
  sourceRowIndex: number;
  podmiotHandlowy: string;
  sklep: string;
  gmina: string;
  numerPlomby: string;
  /** Kolumna daty zamknięcia worka (surowy tekst z arkusza). */
  dataZamknieciaWorka: string;
  /** Tryb zbiórki – ręczna / maszyna */
  zbiorka: string;
  raw: string[];
  address: string;
}

type SheetMeta = {
  sheets?: Array<{
    properties?: {
      title?: string;
    };
  }>;
};

type SheetsValuesGetClient = {
  spreadsheets: {
    values: {
      get(
        args: { spreadsheetId: string; range: string },
        ...rest: unknown[]
      ): Promise<{ data: unknown }>;
    };
  };
};

type SheetsReadClient = SheetsValuesGetClient & {
  spreadsheets: SheetsValuesGetClient['spreadsheets'] & {
    get(args: { spreadsheetId: string }, ...rest: unknown[]): Promise<{ data: unknown }>;
  };
};

function normalizeCell(value: string | undefined): string {
  return (value ?? '').trim();
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function findHeaderIndex(headers: string[], matchers: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const header = normalizeHeader(headers[i] ?? '');
    if (matchers.some((matcher) => header.includes(normalizeHeader(matcher)))) {
      return i;
    }
  }
  return -1;
}

/**
 * Mapuje kolumny arkusza po nagłówkach (odporne na dodanie kolumn typu NIP / Województwo).
 * Gdy brak nagłówków — używa {@link DEFAULT_SHEET_COLUMN_MAP}.
 */
export function resolveSheetColumnMap(headers: string[]): SheetColumnMap {
  if (!headers || headers.length === 0 || headers.every((header) => header.trim().length === 0)) {
    return { ...DEFAULT_SHEET_COLUMN_MAP };
  }

  const pick = (matchers: string[], fallback: number): number => {
    const index = findHeaderIndex(headers, matchers);
    return index >= 0 ? index : fallback;
  };

  return {
    podmiotHandlowy: pick(['podmiot handlowy', 'podmiot'], DEFAULT_SHEET_COLUMN_MAP.podmiotHandlowy),
    sklep: pick(['sklep'], DEFAULT_SHEET_COLUMN_MAP.sklep),
    kodPocztowy: pick(['kod pocztowy', 'kod poczt'], DEFAULT_SHEET_COLUMN_MAP.kodPocztowy),
    miasto: pick(['miasto'], DEFAULT_SHEET_COLUMN_MAP.miasto),
    ulica: pick(['ulica'], DEFAULT_SHEET_COLUMN_MAP.ulica),
    numerBudynku: pick(['numer budynku', 'numer bud'], DEFAULT_SHEET_COLUMN_MAP.numerBudynku),
    gmina: pick(['gmina'], DEFAULT_SHEET_COLUMN_MAP.gmina),
    numerPlomby: pick(['numer plomby', 'numer plomb'], DEFAULT_SHEET_COLUMN_MAP.numerPlomby),
    dataZamknieciaWorka: pick(
      ['data zamkniecia worka', 'data zamkniecia', 'data zamk'],
      DEFAULT_SHEET_COLUMN_MAP.dataZamknieciaWorka,
    ),
    zbiorka: pick(['tryb zbiorki', 'tryb zbior', 'zbiorki'], DEFAULT_SHEET_COLUMN_MAP.zbiorka),
  };
}

function isMissingStreet(street: string): boolean {
  return street.trim().length === 0 || street.trim().toLowerCase() === 'brak';
}

export function buildAddress(parts: AddressParts): string {
  const items = [normalizeCell(parts.kodPocztowy), normalizeCell(parts.miasto)];
  if (!isMissingStreet(parts.ulica)) {
    items.push(normalizeCell(parts.ulica));
  }
  items.push(normalizeCell(parts.numerBudynku));

  return items
    .filter((item) => item.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mapRawRowToSheetRow(
  raw: string[],
  sourceRowIndex: number,
  columns: SheetColumnMap = DEFAULT_SHEET_COLUMN_MAP,
): SheetRow {
  const kodPocztowy = normalizeCell(raw[columns.kodPocztowy]);
  const miasto = normalizeCell(raw[columns.miasto]);
  const ulica = normalizeCell(raw[columns.ulica]);
  const numerBudynku = normalizeCell(raw[columns.numerBudynku]);

  return {
    sourceRowIndex,
    podmiotHandlowy: normalizeCell(raw[columns.podmiotHandlowy]),
    sklep: normalizeCell(raw[columns.sklep]),
    kodPocztowy,
    miasto,
    ulica,
    numerBudynku,
    gmina: normalizeCell(raw[columns.gmina]),
    numerPlomby: normalizeCell(raw[columns.numerPlomby]),
    dataZamknieciaWorka: normalizeCell(raw[columns.dataZamknieciaWorka] ?? ''),
    zbiorka: normalizeCell(raw[columns.zbiorka] ?? ''),
    raw,
    address: buildAddress({
      kodPocztowy,
      miasto,
      ulica,
      numerBudynku,
    }),
  };
}

/** Wpis w `address-aliases.json`: string (kanoniczny) lub obiekt z polem `canonical`. */
type AddressAliasEntry = string | { canonical: string; note?: string };

/**
 * Wczytuje mapę aliasów adresów (literówki → kanoniczny zapis). Brak pliku = pusta mapa.
 */
export async function loadAddressAliases(
  filePath: string = DEFAULT_ADDRESS_ALIASES_PATH,
): Promise<Record<string, string>> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, AddressAliasEntry>;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [variant, entry] of Object.entries(parsed)) {
      const canonical = typeof entry === 'string' ? entry : entry?.canonical;
      if (typeof canonical === 'string' && canonical.length > 0) {
        result[variant] = canonical;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Zamienia `row.address` na kanoniczny, gdy wariant jest w pliku aliasów (ten sam sklep).
 */
export function applyAddressAliases(
  rows: SheetRow[],
  aliases: Record<string, string>,
): SheetRow[] {
  if (Object.keys(aliases).length === 0) {
    return rows;
  }
  return rows.map((row) => {
    const canonical = aliases[row.address];
    if (!canonical || canonical === row.address) {
      return row;
    }
    return { ...row, address: canonical };
  });
}

export function parseSheetRows(values: string[][]): {
  headers: string[];
  rows: SheetRow[];
  columnMap: SheetColumnMap;
} {
  if (!values || values.length === 0) {
    return { headers: [], rows: [], columnMap: { ...DEFAULT_SHEET_COLUMN_MAP } };
  }

  const [headers, ...dataRows] = values;
  const columnMap = resolveSheetColumnMap(headers);
  const rows = dataRows.map((rawRow, idx) => mapRawRowToSheetRow(rawRow, idx + 2, columnMap));

  return { headers, rows, columnMap };
}

export function getFirstSheetTitle(meta: SheetMeta): string {
  return meta.sheets?.[0]?.properties?.title ?? 'Arkusz1';
}

export function buildSheetRange(sheetTitle: string): string {
  const escaped = sheetTitle.replace(/'/g, "''");
  return `'${escaped}'!A:Z`;
}

export async function fetchSourceSheetValues(
  api: SheetsValuesGetClient,
  spreadsheetId: string,
  sheetTitle: string,
): Promise<string[][]> {
  const response = await api.spreadsheets.values.get({
    spreadsheetId,
    range: buildSheetRange(sheetTitle),
  });

  const data = response.data as { values?: string[][] };
  return data.values ?? [];
}

export async function loadSourceRows(
  api: SheetsReadClient,
  spreadsheetId: string,
): Promise<{ sheetTitle: string; headers: string[]; rows: SheetRow[]; columnMap: SheetColumnMap }> {
  const metaResponse = await api.spreadsheets.get({ spreadsheetId });
  const sheetTitle = getFirstSheetTitle((metaResponse.data as SheetMeta) ?? {});
  const values = await fetchSourceSheetValues(api, spreadsheetId, sheetTitle);
  const parsed = parseSheetRows(values);

  return {
    sheetTitle,
    headers: parsed.headers,
    rows: parsed.rows,
    columnMap: parsed.columnMap,
  };
}

export function createSheetsClient(credentialsPath: string): sheets_v4.Sheets {
  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({
    version: 'v4',
    auth,
  });
}
