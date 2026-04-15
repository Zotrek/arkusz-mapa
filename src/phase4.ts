/**
 * Faza 4: zapis do Sheets – zakładki z liczbą wystąpień:
 * Duplikaty plomb (pełne wiersze, tylko gdy występują), Zgrupowane niepewne adresy, Zgrupowane błędne adresy,
 * Adresy pewne (3 typy: pewne, pewne bez kodu, tylko kod+miasto).
 * Nie tworzy zakładek: Błędne adresy, Wyniki niepewne, Adresy niepewne.
 */

import {
  SHEET_NAME_ADRESY_PEWNE,
  SHEET_NAME_ADRESY_PEWNE_BEZ_KODU,
  SHEET_NAME_ADRESY_TYLKO_KOD_MIASTO,
  SHEET_NAME_DUPLIKATY_PLOMB,
  SHEET_NAME_ZGRUPOWANE_BLEDNE_ADRESY,
  SHEET_NAME_ZGRUPOWANE_NIEPEWNE_ADRESY,
} from './config.js';
import type { GeocodedAddress } from './phase5.js';
import type { GroupedBlednyAdres, GroupedNiepewnyAdres } from './phase5.js';
import type { SheetRow } from './sheets.js';

type SheetsMetaClient = {
  spreadsheets: {
    get(args: any, ...rest: any[]): Promise<{ data: unknown }>;
    batchUpdate(args: any, ...rest: any[]): Promise<unknown>;
  };
};

type SheetsValuesClient = {
  spreadsheets: {
    values: {
      clear(args: any, ...rest: any[]): Promise<unknown>;
      update(args: any, ...rest: any[]): Promise<unknown>;
    };
  };
};

type SheetsWriteClient = SheetsMetaClient & SheetsValuesClient;

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

/**
 * Sprawdza, czy arkusz o podanej nazwie już istnieje (dokładne dopasowanie).
 * Zapobiega tworzeniu duplikatów (np. "Wyniki niepewne (2)").
 */
export async function ensureSheetExists(
  api: SheetsMetaClient,
  spreadsheetId: string,
  sheetName: string,
): Promise<void> {
  const metaResponse = await api.spreadsheets.get({ spreadsheetId });
  const meta = (metaResponse.data as SheetMeta) ?? {};
  const titles = (meta.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((t): t is string => typeof t === 'string');
  const exists = titles.some((title) => title === sheetName);

  if (exists) {
    return;
  }

  await api.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: sheetName } } }],
    },
  });
}

export async function overwriteSheetRows(
  api: SheetsValuesClient,
  spreadsheetId: string,
  sheetName: string,
  headers: string[],
  rows: SheetRow[],
): Promise<void> {
  const values: string[][] = [headers, ...rows.map((row) => row.raw)];

  await api.spreadsheets.values.clear({
    spreadsheetId,
    range: buildSheetRange(sheetName),
  });

  await api.spreadsheets.values.update({
    spreadsheetId,
    range: buildSheetStartRange(sheetName),
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
}

export interface Phase4Input {
  spreadsheetId: string;
  headers: string[];
  /** Wiersze z zduplikowanym numerem plomby – zapisywane do zakładki "Duplikaty plomb" tylko gdy length > 0 */
  rowsDuplikatyPlomb: SheetRow[];
  rowsNiepewneWyniki: SheetRow[];
  groupedNiepewneAdresy: GroupedNiepewnyAdres[];
  groupedBledneAdresy: GroupedBlednyAdres[];
  geocoded?: GeocodedAddress[];
  geocodedNoPostcode?: GeocodedAddress[];
  uncertainGeocoded?: GeocodedAddress[];
  cityOnlyGeocoded?: GeocodedAddress[];
}

const GROUPED_NIEPEWNE_HEADERS = [
  'adres',
  'liczba_wystapien',
  'przykladowe_lat',
  'przykladowe_lng',
  'wojewodztwo',
];

const GROUPED_BLEDNE_HEADERS = ['adres', 'liczba_wystapien'];

const ADRESY_TYP_HEADERS = ['adres', 'liczba_wystapien'];

async function overwriteAdresyTypSheet(
  api: SheetsValuesClient,
  spreadsheetId: string,
  sheetName: string,
  items: GeocodedAddress[],
): Promise<void> {
  await api.spreadsheets.values.clear({
    spreadsheetId,
    range: buildSheetRange(sheetName),
  });
  await api.spreadsheets.values.update({
    spreadsheetId,
    range: buildSheetStartRange(sheetName),
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        ADRESY_TYP_HEADERS,
        ...items.map((item) => [item.address, String(item.count)]),
      ],
    },
  });
}

/**
 * Zapisuje zakładki z liczbą wystąpień:
 * 1. Duplikaty plomb (pełne wiersze źródłowe) – tylko gdy są duplikaty,
 * 2. Zgrupowane niepewne adresy (adres, liczba_wystapien),
 * 3. Zgrupowane błędne adresy (adres, liczba_wystapien),
 * 4. Adresy pewne (3 typy: pewne, pewne bez kodu, tylko kod+miasto).
 * Zakładka jest tworzona tylko wtedy, gdy są dla niej dane do zapisania.
 */
export async function executePhase4(
  api: SheetsWriteClient,
  input: Phase4Input,
): Promise<void> {
  if (input.rowsDuplikatyPlomb.length > 0) {
    await ensureSheetExists(api, input.spreadsheetId, SHEET_NAME_DUPLIKATY_PLOMB);
    await overwriteSheetRows(
      api,
      input.spreadsheetId,
      SHEET_NAME_DUPLIKATY_PLOMB,
      input.headers,
      input.rowsDuplikatyPlomb,
    );
  }

  if (input.groupedNiepewneAdresy.length > 0) {
    await ensureSheetExists(api, input.spreadsheetId, SHEET_NAME_ZGRUPOWANE_NIEPEWNE_ADRESY);
    await api.spreadsheets.values.clear({
      spreadsheetId: input.spreadsheetId,
      range: buildSheetRange(SHEET_NAME_ZGRUPOWANE_NIEPEWNE_ADRESY),
    });
    await api.spreadsheets.values.update({
      spreadsheetId: input.spreadsheetId,
      range: buildSheetStartRange(SHEET_NAME_ZGRUPOWANE_NIEPEWNE_ADRESY),
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          GROUPED_NIEPEWNE_HEADERS,
          ...input.groupedNiepewneAdresy.map((item) => [
            item.address,
            String(item.liczbaWystapien),
            String(item.przykladoweLat),
            String(item.przykladoweLng),
            item.wojewodztwo,
          ]),
        ],
      },
    });
  }

  if (input.groupedBledneAdresy.length > 0) {
    await ensureSheetExists(api, input.spreadsheetId, SHEET_NAME_ZGRUPOWANE_BLEDNE_ADRESY);
    await api.spreadsheets.values.clear({
      spreadsheetId: input.spreadsheetId,
      range: buildSheetRange(SHEET_NAME_ZGRUPOWANE_BLEDNE_ADRESY),
    });
    await api.spreadsheets.values.update({
      spreadsheetId: input.spreadsheetId,
      range: buildSheetStartRange(SHEET_NAME_ZGRUPOWANE_BLEDNE_ADRESY),
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          GROUPED_BLEDNE_HEADERS,
          ...input.groupedBledneAdresy.map((item) => [item.address, String(item.liczbaWystapien)]),
        ],
      },
    });
  }

  const geocoded = input.geocoded ?? [];
  if (geocoded.length > 0) {
    await ensureSheetExists(api, input.spreadsheetId, SHEET_NAME_ADRESY_PEWNE);
    await overwriteAdresyTypSheet(api, input.spreadsheetId, SHEET_NAME_ADRESY_PEWNE, geocoded);
  }

  const geocodedNoPostcode = input.geocodedNoPostcode ?? [];
  if (geocodedNoPostcode.length > 0) {
    await ensureSheetExists(api, input.spreadsheetId, SHEET_NAME_ADRESY_PEWNE_BEZ_KODU);
    await overwriteAdresyTypSheet(
      api,
      input.spreadsheetId,
      SHEET_NAME_ADRESY_PEWNE_BEZ_KODU,
      geocodedNoPostcode,
    );
  }

  const cityOnlyGeocoded = input.cityOnlyGeocoded ?? [];
  if (cityOnlyGeocoded.length > 0) {
    await ensureSheetExists(api, input.spreadsheetId, SHEET_NAME_ADRESY_TYLKO_KOD_MIASTO);
    await overwriteAdresyTypSheet(
      api,
      input.spreadsheetId,
      SHEET_NAME_ADRESY_TYLKO_KOD_MIASTO,
      cityOnlyGeocoded,
    );
  }
}
