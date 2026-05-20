/**
 * Faza 2: odczyt i parsowanie danych z Google Sheets.
 */

import { readFile } from 'node:fs/promises';
import { google, type sheets_v4 } from 'googleapis';
import {
  COL_KOD_POCZTOWY,
  COL_MIASTO,
  COL_ULICA,
  COL_NUMER_BUDYNKU,
  COL_NUMER_PLOMBY,
  COL_DATA_ZAMKNIECIA_WORKA,
  COL_ZBIORKA,
  DEFAULT_ADDRESS_ALIASES_PATH,
} from './config.js';

export interface AddressParts {
  kodPocztowy: string;
  miasto: string;
  ulica: string;
  numerBudynku: string;
}

export interface SheetRow extends AddressParts {
  sourceRowIndex: number;
  podmiotHandlowy: string;
  sklep: string;
  gmina: string;
  numerPlomby: string;
  /** Kolumna L: data zamknięcia worka (surowy tekst z arkusza). */
  dataZamknieciaWorka: string;
  /** Kolumna M: tryb zbiórki – ręczna / maszyna */
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

export function mapRawRowToSheetRow(raw: string[], sourceRowIndex: number): SheetRow {
  const kodPocztowy = normalizeCell(raw[COL_KOD_POCZTOWY]);
  const miasto = normalizeCell(raw[COL_MIASTO]);
  const ulica = normalizeCell(raw[COL_ULICA]);
  const numerBudynku = normalizeCell(raw[COL_NUMER_BUDYNKU]);

  return {
    sourceRowIndex,
    podmiotHandlowy: normalizeCell(raw[0]),
    sklep: normalizeCell(raw[1]),
    kodPocztowy,
    miasto,
    ulica,
    numerBudynku,
  gmina: normalizeCell(raw[6]),
  numerPlomby: normalizeCell(raw[COL_NUMER_PLOMBY]),
  dataZamknieciaWorka: normalizeCell(raw[COL_DATA_ZAMKNIECIA_WORKA] ?? ''),
  zbiorka: normalizeCell(raw[COL_ZBIORKA] ?? ''),
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

export function parseSheetRows(values: string[][]): { headers: string[]; rows: SheetRow[] } {
  if (!values || values.length === 0) {
    return { headers: [], rows: [] };
  }

  const [headers, ...dataRows] = values;
  const rows = dataRows.map((rawRow, idx) => mapRawRowToSheetRow(rawRow, idx + 2));

  return { headers, rows };
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
): Promise<{ sheetTitle: string; headers: string[]; rows: SheetRow[] }> {
  const metaResponse = await api.spreadsheets.get({ spreadsheetId });
  const sheetTitle = getFirstSheetTitle((metaResponse.data as SheetMeta) ?? {});
  const values = await fetchSourceSheetValues(api, spreadsheetId, sheetTitle);
  const parsed = parseSheetRows(values);

  return {
    sheetTitle,
    headers: parsed.headers,
    rows: parsed.rows,
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
