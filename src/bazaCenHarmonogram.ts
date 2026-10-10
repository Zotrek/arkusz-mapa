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
import { canonicalHarmonogramDays, HARMONOGRAM_ID_HEADER } from './harmonogramGroup.js';
import { normalizeRateShopKey } from './saveRate.js';
import { buildAddress, stripTrailingHouseNumberFromStreet } from './sheets.js';
import { normalizeCityFromSheet } from './cityNormalize.js';
import { normalizeStreetFromSheet } from './streetNormalize.js';

export const BAZA_CEN_HEADERS = [
  'Adres sklepu',
  'Podwykonawca',
  'Nazwa trasy',
  'Cena za podjazd',
  'Cena za worek',
  'Cena za trasę',
  'Od kiedy obowiązuje cena',
  'Dni odbiorów',
  HARMONOGRAM_ID_HEADER,
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
  /** Kolumna „Od kiedy obowiązuje cena” (pusta = od zawsze). */
  validFrom: string;
  routeName: string;
  /** Czy którakolwiek z kolumn cen jest wypełniona. */
  hasPrices: boolean;
  /** Puste, gdy sklep nie jest w wspólnym harmonogramie. */
  harmonogramId: string;
}

export interface BazaCenSyncPlan {
  append: BazaCenShop[];
  dayUpdates: Array<{ sheetRow: number; dni: string }>;
  /** Ujednolicenie adresu do formy z mapy (al./pl./Św. → kanoniczny). */
  addressHeals: Array<{ sheetRow: number; adres: string }>;
  /**
   * Wiersze do usunięcia: bliźniaki po normalizacji adresu (ten sam klucz sklep+firma
   * i ta sama data obowiązywania) albo pusty seed bez cen przy istniejącym wierszu z cenami.
   */
  duplicateDeletes: number[];
  /** Czyści „Id harmonogramu”, gdy kanoniczne dni odbiorów się zmieniły. */
  idClears: number[];
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
  return `${normalizeRateShopKey(adres)}\n${collapse(podwykonawca)}`;
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

function cellHasAmount(value: string): boolean {
  return collapse(value).length > 0;
}

function duplicateKeepScore(row: BazaCenExistingRow): number {
  let score = 0;
  if (row.hasPrices) score += 100;
  if (row.routeName) score += 10;
  if (row.dni) score += 1;
  return score;
}

/**
 * Usuwa bliźniaki powstałe po healu al./pl./Św. (ten sam sklep+firma+data).
 * Zostawia historię cen (różne „Od kiedy”).
 * Usuwa też pusty seed bez cen, gdy istnieje wiersz z cenami dla tej samej pary.
 */
export function planBazaCenDuplicateDeletes(existing: BazaCenExistingRow[]): number[] {
  const byShop = new Map<string, BazaCenExistingRow[]>();
  for (const row of existing) {
    if (!row.adres || !row.podwykonawca) {
      continue;
    }
    const key = bazaCenKey(row.adres, row.podwykonawca);
    const list = byShop.get(key);
    if (list) {
      list.push(row);
    } else {
      byShop.set(key, [row]);
    }
  }

  const toDelete = new Set<number>();
  for (const rows of byShop.values()) {
    if (rows.length < 2) {
      continue;
    }

    const hasPricedSibling = rows.some((row) => row.hasPrices);
    if (hasPricedSibling) {
      for (const row of rows) {
        if (!row.hasPrices && !row.validFrom) {
          toDelete.add(row.sheetRow);
        }
      }
    }

    const survivors = rows.filter((row) => !toDelete.has(row.sheetRow));
    const byValidFrom = new Map<string, BazaCenExistingRow[]>();
    for (const row of survivors) {
      const dateKey = row.validFrom;
      const list = byValidFrom.get(dateKey);
      if (list) {
        list.push(row);
      } else {
        byValidFrom.set(dateKey, [row]);
      }
    }

    for (const group of byValidFrom.values()) {
      if (group.length < 2) {
        continue;
      }
      const ranked = [...group].sort((a, b) => {
        const scoreDiff = duplicateKeepScore(b) - duplicateKeepScore(a);
        if (scoreDiff !== 0) {
          return scoreDiff;
        }
        return a.sheetRow - b.sheetRow;
      });
      for (const row of ranked.slice(1)) {
        toDelete.add(row.sheetRow);
      }
    }
  }

  return [...toDelete].sort((a, b) => b - a);
}

/**
 * Jedna pozycja na adres + firmę transportową.
 * Adres jak na mapie: normalizacja miasta/ulicy (al./pl./Św.).
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
    const miastoNorm = normalizeCityFromSheet(collapse(cell(row, miasto)));
    const numerBudynku = collapse(cell(row, numer));
    const ulicaNorm = normalizeStreetFromSheet(
      stripTrailingHouseNumberFromStreet(collapse(cell(row, ulica)), numerBudynku),
      miastoNorm,
    );
    const adres = buildAddress({
      kodPocztowy: collapse(cell(row, kod)),
      miasto: miastoNorm,
      ulica: ulicaNorm,
      numerBudynku,
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
  const routeName = headerIndex(headers, 'Nazwa trasy');
  const pickup = headerIndex(headers, 'Cena za podjazd');
  const bag = headerIndex(headers, 'Cena za worek');
  const routeAmount = headerIndex(headers, 'Cena za trasę');
  const validFrom = headerIndex(headers, 'Od kiedy obowiązuje cena');
  const harmonogramId = headerIndex(headers, HARMONOGRAM_ID_HEADER);
  const parsed: BazaCenExistingRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (row.every((value) => String(value ?? '').trim() === '')) {
      continue;
    }
    const pickupVal = pickup >= 0 ? cell(row, pickup) : '';
    const bagVal = bag >= 0 ? cell(row, bag) : '';
    const routeAmountVal = routeAmount >= 0 ? cell(row, routeAmount) : '';
    parsed.push({
      sheetRow: i + 2,
      adres: collapse(cell(row, adres)),
      podwykonawca: collapse(cell(row, podwykonawca)),
      dni: collapse(cell(row, dni)),
      validFrom: validFrom >= 0 ? collapse(cell(row, validFrom)) : '',
      routeName: routeName >= 0 ? collapse(cell(row, routeName)) : '',
      hasPrices:
        cellHasAmount(pickupVal) || cellHasAmount(bagVal) || cellHasAmount(routeAmountVal),
      harmonogramId: harmonogramId >= 0 ? collapse(cell(row, harmonogramId)) : '',
    });
  }
  return parsed;
}

/** Dopisuje brakujące sklepy. Dni aktualizuje na każdym wierszu tej pary. Cen nie rusza. */
export function planBazaCenSync(shops: BazaCenShop[], existing: BazaCenExistingRow[]): BazaCenSyncPlan {
  const duplicateDeletes = planBazaCenDuplicateDeletes(existing);
  const deleteSet = new Set(duplicateDeletes);
  const survivors = existing.filter((row) => !deleteSet.has(row.sheetRow));

  const rowsByKey = new Map<string, BazaCenExistingRow[]>();
  for (const row of survivors) {
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
  const addressHeals: Array<{ sheetRow: number; adres: string }> = [];
  const idClears: number[] = [];
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
      if (
        row.harmonogramId &&
        canonicalHarmonogramDays(row.dni) !== canonicalHarmonogramDays(shop.dni)
      ) {
        idClears.push(row.sheetRow);
      }
      if (row.adres !== shop.adres) {
        addressHeals.push({ sheetRow: row.sheetRow, adres: shop.adres });
      }
    }
  }
  return { append, dayUpdates, addressHeals, duplicateDeletes, idClears };
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

async function resolveSheetId(
  api: SheetsClient,
  spreadsheetId: string,
  sheetName: string,
): Promise<number | null> {
  const metaResponse = await api.spreadsheets.get({ spreadsheetId });
  const sheets = (
    metaResponse.data as {
      sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
    }
  ).sheets;
  const props = (sheets ?? []).find((s) => s.properties?.title === sheetName)?.properties;
  return props?.sheetId ?? null;
}

async function deleteSheetRows(
  api: SheetsClient,
  spreadsheetId: string,
  sheetId: number,
  sheetRows: number[],
): Promise<void> {
  if (sheetRows.length === 0) {
    return;
  }
  const sorted = [...sheetRows].sort((a, b) => b - a);
  await api.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: sorted.map((sheetRow) => ({
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: sheetRow - 1,
            endIndex: sheetRow,
          },
        },
      })),
    },
  });
}

export interface SyncBazaCenHarmonogramResult {
  shopCount: number;
  appendedCount: number;
  daysUpdatedCount: number;
  addressHealedCount: number;
  duplicatesRemovedCount: number;
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

  const emptyResult = {
    shopCount: 0,
    appendedCount: 0,
    daysUpdatedCount: 0,
    addressHealedCount: 0,
    duplicatesRemovedCount: 0,
    sheetCreated: false,
  };

  const sourceExists = await sheetExists(api, spreadsheetId, SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU);
  if (!sourceExists) {
    logger?.info('Baza cen harmonogram: brak zakładki „odebrane z harmonogramu”');
    return emptyResult;
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
  let headers = currentHeaders.some((header) => header.trim().length > 0)
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

  if (headerIndex(headers, HARMONOGRAM_ID_HEADER) < 0) {
    headers = [...headers, HARMONOGRAM_ID_HEADER];
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
  const adresColumn = requireHeader(headers, 'Adres sklepu', sheetName);
  const idColumn = headerIndex(headers, HARMONOGRAM_ID_HEADER);

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

  const batchData: Array<{ range: string; values: string[][] }> = [];
  if (plan.dayUpdates.length > 0) {
    const letter = columnLetter(dniColumn);
    for (const update of plan.dayUpdates) {
      batchData.push({
        range: `${quoteSheet(sheetName)}!${letter}${update.sheetRow}`,
        values: [[update.dni]],
      });
    }
  }
  if (plan.idClears.length > 0 && idColumn >= 0) {
    const letter = columnLetter(idColumn);
    for (const sheetRow of plan.idClears) {
      batchData.push({
        range: `${quoteSheet(sheetName)}!${letter}${sheetRow}`,
        values: [['']],
      });
    }
  }
  if (plan.addressHeals.length > 0) {
    const letter = columnLetter(adresColumn);
    for (const heal of plan.addressHeals) {
      batchData.push({
        range: `${quoteSheet(sheetName)}!${letter}${heal.sheetRow}`,
        values: [[heal.adres]],
      });
    }
  }
  if (batchData.length > 0) {
    await api.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: batchData,
      },
    });
  }

  let duplicatesRemovedCount = 0;
  if (plan.duplicateDeletes.length > 0) {
    const sheetId = await resolveSheetId(api, spreadsheetId, sheetName);
    if (sheetId == null) {
      throw new Error(`Brak sheetId dla zakładki „${sheetName}”`);
    }
    await deleteSheetRows(api, spreadsheetId, sheetId, plan.duplicateDeletes);
    duplicatesRemovedCount = plan.duplicateDeletes.length;
  }

  logger?.info(
    'Baza cen harmonogram: sklepy %d, dopisane %d, dni zaktualizowane %d, adresy ujednolicone %d, duplikaty usunięte %d, nowa zakładka=%s',
    shops.length,
    plan.append.length,
    plan.dayUpdates.length,
    plan.addressHeals.length,
    duplicatesRemovedCount,
    sheetCreated,
  );

  return {
    shopCount: shops.length,
    appendedCount: plan.append.length,
    daysUpdatedCount: plan.dayUpdates.length,
    addressHealedCount: plan.addressHeals.length,
    duplicatesRemovedCount,
    sheetCreated,
  };
}
