/**
 * Odczyt słowników referencyjnych (Google Sheet transportów + JSON z pull:reference).
 */

import { existsSync, readFileSync } from 'node:fs';
import {
  DEFAULT_REFERENCE_DOSTAWA_PATH,
  DEFAULT_REFERENCE_PRZEWOZNICY_PATH,
  getTransportSheetsId,
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

export interface PrzewoznikRecord {
  nazwaWyswietlana: string;
  nazwaDoProtokolu: string;
  adres: string;
  nip: string;
  bdo: string;
}

export interface ReferenceDataBundle {
  przewoznicy: PrzewoznikRecord[];
  miejscaDostawy: PodwykoOption[];
  poprawAdres: PoprawAdresEntry[];
  poprawAdresIndex: Map<string, PoprawAdresEntry>;
}

type SheetsValuesClient = {
  spreadsheets: {
    values: {
      get(args: { spreadsheetId: string; range: string }): Promise<{ data: { values?: unknown[][] } }>;
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

function parsePrzewoznikRow(row: unknown[]): PrzewoznikRecord | null {
  const nazwaWyswietlana = cellStr(row, 0);
  if (!nazwaWyswietlana) {
    return null;
  }
  return {
    nazwaWyswietlana,
    nazwaDoProtokolu: cellStr(row, 1) || nazwaWyswietlana,
    adres: cellStr(row, 2),
    nip: cellStr(row, 3),
    bdo: cellStr(row, 4),
  };
}

function parseDostawaRow(row: unknown[]): { baseLabel: string; dane: string } | null {
  const nazwa = cellStr(row, 0);
  const dane = cellStr(row, 1);
  if (!nazwa && !dane) {
    return null;
  }
  const baseLabel = nazwa || (dane.length > 100 ? `${dane.slice(0, 99).trim()}…` : dane);
  return { baseLabel, dane: dane || baseLabel };
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
    const values = res.data.values ?? [];
    return values.map((row) => row.map((cell) => (cell == null ? '' : String(cell))));
  } catch {
    return [];
  }
}

export async function loadReferenceDataFromSheets(
  client: SheetsValuesClient,
  spreadsheetId = getTransportSheetsId(),
): Promise<ReferenceDataBundle> {
  const [przRows, dosRows, poprawRows] = await Promise.all([
    readSheetMatrix(client, spreadsheetId, SHEET_NAME_PRZEWOZNICY),
    readSheetMatrix(client, spreadsheetId, SHEET_NAME_MIEJSCA_DOSTAWY),
    readSheetMatrix(client, spreadsheetId, SHEET_NAME_POPRAW_ADRES),
  ]);

  const przewoznicy: PrzewoznikRecord[] = [];
  for (let i = 1; i < przRows.length; i += 1) {
    const record = parsePrzewoznikRow(przRows[i] as unknown[]);
    if (record) {
      przewoznicy.push(record);
    }
  }

  const dostawaRaw: Array<{ baseLabel: string; dane: string }> = [];
  for (let i = 1; i < dosRows.length; i += 1) {
    const row = parseDostawaRow(dosRows[i] as unknown[]);
    if (row) {
      dostawaRaw.push(row);
    }
  }

  const poprawAdres = parsePoprawAdresSheetRows(poprawRows);

  return {
    przewoznicy,
    miejscaDostawy: finalizePodwykoOptions(dostawaRaw),
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

export function loadReferenceDataFromJsonFiles(): Pick<
  ReferenceDataBundle,
  'przewoznicy' | 'miejscaDostawy'
> {
  const przewoznicy = readJsonArray<PrzewoznikRecord>(DEFAULT_REFERENCE_PRZEWOZNICY_PATH);
  const miejscaDostawyRaw = readJsonArray<{ label: string; dane: string }>(
    DEFAULT_REFERENCE_DOSTAWA_PATH,
  );
  const miejscaDostawy =
    miejscaDostawyRaw.length > 0
      ? miejscaDostawyRaw.map((item) => ({
          label: item.label,
          dane: item.dane,
        }))
      : [];
  return { przewoznicy, miejscaDostawy };
}

export async function loadPodwykoOptionsWithReferenceFallback(
  podwykoXlsxPath: string,
  loadFromXlsx: (path: string) => Promise<PodwykoOption[]>,
): Promise<PodwykoOption[]> {
  const { przewoznicy, miejscaDostawy } = loadReferenceDataFromJsonFiles();
  if (przewoznicy.length > 0 || miejscaDostawy.length > 0) {
    const merged: PodwykoOption[] = [];
    const seen = new Set<string>();
    for (const p of przewoznicy) {
      const label = p.nazwaWyswietlana;
      const dane = p.nazwaDoProtokolu || label;
      const key = `${label}\0${dane}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ label, dane });
    }
    for (const item of miejscaDostawy) {
      const key = `${item.label}\0${item.dane}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
    return merged;
  }
  try {
    return await loadFromXlsx(podwykoXlsxPath);
  } catch {
    return [];
  }
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
      przewoznicy?: PrzewoznikRecord[];
      miejscaDostawy?: Array<{ nazwa: string; dane: string }>;
      poprawAdres?: PoprawAdresEntry[];
    };
  };
  if (!json.ok || !json.data) {
    return {};
  }
  const miejscaDostawy = (json.data.miejscaDostawy ?? []).map((item) => ({
    label: item.nazwa,
    dane: item.dane,
  }));
  const poprawAdres = json.data.poprawAdres ?? [];
  return {
    przewoznicy: json.data.przewoznicy ?? [],
    miejscaDostawy,
    poprawAdres,
    poprawAdresIndex: buildPoprawAdresIndex(poprawAdres),
  };
}

export async function writeReferenceJsonFiles(
  bundle: Pick<ReferenceDataBundle, 'przewoznicy' | 'miejscaDostawy'>,
  writeFileFn?: (path: string, content: string) => Promise<void>,
): Promise<void> {
  const write =
    writeFileFn ??
    (async (path: string, content: string) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(path, content, 'utf-8');
    });
  await write(
    DEFAULT_REFERENCE_PRZEWOZNICY_PATH,
    `${JSON.stringify(bundle.przewoznicy, null, 2)}\n`,
  );
  const dostawaForJson = bundle.miejscaDostawy.map((item) => ({
    label: item.label,
    dane: item.dane,
  }));
  await write(
    DEFAULT_REFERENCE_DOSTAWA_PATH,
    `${JSON.stringify(dostawaForJson, null, 2)}\n`,
  );
}
