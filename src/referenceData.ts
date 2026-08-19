/**
 * Odczyt słowników referencyjnych (Google Sheet transportów + JSON z pull:reference).
 * Wspólna lista podwykonawców (jak docs/podwyko lista.xlsx) — jeden combobox w Word/mapa.
 */

import { existsSync, readFileSync } from 'node:fs';
import {
  DEFAULT_REFERENCE_DOSTAWA_PATH,
  DEFAULT_REFERENCE_PODWYKO_PATH,
  DEFAULT_REFERENCE_PRZEWOZNICY_PATH,
  getTransportSheetsId,
  SHEET_NAME_LISTA_PODWYKONAWCOW,
  SHEET_NAME_MIEJSCA_DOSTAWY,
  SHEET_NAME_PRZEWOZNICY,
  SHEET_NAME_POPRAW_ADRES,
} from './config.js';
import {
  buildPoprawAdresIndex,
  parsePoprawAdresSheetRows,
  type PoprawAdresEntry,
} from './poprawAdres.js';
import type { PodwykoOption } from './wordMapSupport.js';
import { finalizePodwykoOptions } from './wordMapSupport.js';

export interface ReferenceDataBundle {
  podwykoLista: PodwykoOption[];
  poprawAdres: PoprawAdresEntry[];
  poprawAdresIndex: Map<string, PoprawAdresEntry>;
}

type SheetsValuesClient = {
  spreadsheets: {
    values: {
      get(args: unknown, ...rest: unknown[]): Promise<{ data: unknown }>;
    };
  };
};

function cellStr(row: unknown[], col: number): string {
  const v = row[col];
  if (v == null) {
    return '';
  }
  return String(v).trim();
}

function normalizePodwykoRow(
  nazwa: string,
  dane: string,
): { baseLabel: string; dane: string } | null {
  if (!nazwa && !dane) {
    return null;
  }
  const baseLabel = nazwa || (dane.length > 100 ? `${dane.slice(0, 99).trim()}…` : dane);
  const normalizedDane = dane || baseLabel;
  return { baseLabel, dane: normalizedDane };
}

function podwykoKey(label: string, dane: string): string {
  return `${label.trim().toLowerCase()}\0${dane.trim().toLowerCase()}`;
}

export function mergePodwykoEntries(
  sources: Array<Array<{ baseLabel: string; dane: string }>>,
): PodwykoOption[] {
  const raw: Array<{ baseLabel: string; dane: string }> = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const item of source) {
      const key = podwykoKey(item.baseLabel, item.dane);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      raw.push(item);
    }
  }
  return finalizePodwykoOptions(raw);
}

function parsePodwykoSheetRow(row: unknown[]): { baseLabel: string; dane: string } | null {
  return normalizePodwykoRow(cellStr(row, 0), cellStr(row, 1));
}

function parsePrzewoznikLegacyRow(row: unknown[]): { baseLabel: string; dane: string } | null {
  const nazwaWyswietlana = cellStr(row, 0);
  if (!nazwaWyswietlana) {
    return null;
  }
  const nazwaDoProtokolu = cellStr(row, 1) || nazwaWyswietlana;
  return { baseLabel: nazwaWyswietlana, dane: nazwaDoProtokolu };
}

async function readSheetMatrix(
  client: SheetsValuesClient,
  spreadsheetId: string,
  sheetName: string,
): Promise<string[][]> {
  const escaped = sheetName.replace(/'/g, "''");
  const range = `'${escaped}'!A:H`;
  try {
    const res = await client.spreadsheets.values.get({ spreadsheetId, range });
    const data = res.data as { values?: unknown[][] };
    const values = data.values ?? [];
    return values.map((row) => row.map((cell) => (cell == null ? '' : String(cell))));
  } catch {
    return [];
  }
}

function parsePodwykoRowsFromMatrix(rows: string[][]): Array<{ baseLabel: string; dane: string }> {
  const out: Array<{ baseLabel: string; dane: string }> = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = parsePodwykoSheetRow(rows[i] as unknown[]);
    if (row) {
      out.push(row);
    }
  }
  return out;
}

function parsePrzewoznikLegacyRows(rows: string[][]): Array<{ baseLabel: string; dane: string }> {
  const out: Array<{ baseLabel: string; dane: string }> = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = parsePrzewoznikLegacyRow(rows[i] as unknown[]);
    if (row) {
      out.push(row);
    }
  }
  return out;
}

export async function loadReferenceDataFromSheets(
  client: SheetsValuesClient,
  spreadsheetId = getTransportSheetsId(),
): Promise<ReferenceDataBundle> {
  const [podwykoRows, przRows, dosRows, poprawRows] = await Promise.all([
    readSheetMatrix(client, spreadsheetId, SHEET_NAME_LISTA_PODWYKONAWCOW),
    readSheetMatrix(client, spreadsheetId, SHEET_NAME_PRZEWOZNICY),
    readSheetMatrix(client, spreadsheetId, SHEET_NAME_MIEJSCA_DOSTAWY),
    readSheetMatrix(client, spreadsheetId, SHEET_NAME_POPRAW_ADRES),
  ]);

  const podwykoLista = mergePodwykoEntries([
    parsePodwykoRowsFromMatrix(podwykoRows),
    parsePrzewoznikLegacyRows(przRows),
    parsePodwykoRowsFromMatrix(dosRows),
  ]);

  const poprawAdres = parsePoprawAdresSheetRows(poprawRows);

  return {
    podwykoLista,
    poprawAdres,
    poprawAdresIndex: buildPoprawAdresIndex(poprawAdres),
  };
}

function readJsonArray<T>(path: string): T[] {
  if (!existsSync(path)) {
    return [];
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export function loadPodwykoListaFromJsonFiles(): PodwykoOption[] {
  const primary = readJsonArray<{ label: string; dane: string }>(DEFAULT_REFERENCE_PODWYKO_PATH);
  if (primary.length > 0) {
    return primary.map((item) => ({
      label: item.label,
      dane: item.dane,
    }));
  }

  const legacyPrz = readJsonArray<{
    nazwaWyswietlana: string;
    nazwaDoProtokolu?: string;
  }>(DEFAULT_REFERENCE_PRZEWOZNICY_PATH);
  const legacyDos = readJsonArray<{ label: string; dane: string }>(DEFAULT_REFERENCE_DOSTAWA_PATH);
  if (legacyPrz.length === 0 && legacyDos.length === 0) {
    return [];
  }

  return mergePodwykoEntries([
    legacyPrz.map((item) => ({
      baseLabel: item.nazwaWyswietlana,
      dane: item.nazwaDoProtokolu || item.nazwaWyswietlana,
    })),
    legacyDos.map((item) => ({
      baseLabel: item.label,
      dane: item.dane,
    })),
  ]);
}

export async function loadPodwykoOptionsWithReferenceFallback(
  podwykoXlsxPath: string,
  loadFromXlsx: (path: string) => Promise<PodwykoOption[]>,
): Promise<PodwykoOption[]> {
  const podwykoLista = loadPodwykoListaFromJsonFiles();
  if (podwykoLista.length > 0) {
    return podwykoLista;
  }
  try {
    return await loadFromXlsx(podwykoXlsxPath);
  } catch {
    return [];
  }
}

function mapApiPodwykoLista(
  items: Array<{ nazwa?: string; label?: string; dane: string }>,
): PodwykoOption[] {
  return mergePodwykoEntries([
    items.map((item) => {
      const nazwa = item.nazwa ?? item.label ?? '';
      const row = normalizePodwykoRow(nazwa, item.dane);
      return row ?? { baseLabel: nazwa, dane: item.dane };
    }),
  ]);
}

function mapLegacyApiPodwyko(
  przewoznicy: Array<{ nazwaWyswietlana: string; nazwaDoProtokolu?: string }>,
  miejscaDostawy: Array<{ nazwa: string; dane: string }>,
): PodwykoOption[] {
  return mergePodwykoEntries([
    przewoznicy.map((item) => ({
      baseLabel: item.nazwaWyswietlana,
      dane: item.nazwaDoProtokolu || item.nazwaWyswietlana,
    })),
    miejscaDostawy.map((item) => ({
      baseLabel: item.nazwa,
      dane: item.dane,
    })),
  ]);
}

export async function fetchReferenceDataFromWebApp(
  webAppUrl: string,
): Promise<Partial<ReferenceDataBundle>> {
  const url =
    webAppUrl + (webAppUrl.includes('?') ? '&' : '?') + 'action=listReferenceData';
  const res = await fetch(url);
  const json = (await res.json()) as {
    ok?: boolean;
    data?: {
      podwykoLista?: Array<{ nazwa: string; dane: string }>;
      przewoznicy?: Array<{ nazwaWyswietlana: string; nazwaDoProtokolu?: string }>;
      miejscaDostawy?: Array<{ nazwa: string; dane: string }>;
      poprawAdres?: PoprawAdresEntry[];
    };
  };
  if (!json.ok || !json.data) {
    return {};
  }

  const podwykoLista =
    json.data.podwykoLista != null
      ? mapApiPodwykoLista(json.data.podwykoLista)
      : mapLegacyApiPodwyko(json.data.przewoznicy ?? [], json.data.miejscaDostawy ?? []);

  const poprawAdres = json.data.poprawAdres ?? [];
  return {
    podwykoLista,
    poprawAdres,
    poprawAdresIndex: buildPoprawAdresIndex(poprawAdres),
  };
}

export async function writeReferencePodwykoJsonFile(
  podwykoLista: PodwykoOption[],
  writeFileFn?: (path: string, content: string) => Promise<void>,
): Promise<void> {
  const write =
    writeFileFn ??
    (async (path: string, content: string) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(path, content, 'utf-8');
    });
  const forJson = podwykoLista.map((item) => ({
    label: item.label,
    dane: item.dane,
  }));
  await write(DEFAULT_REFERENCE_PODWYKO_PATH, `${JSON.stringify(forJson, null, 2)}\n`);
}
