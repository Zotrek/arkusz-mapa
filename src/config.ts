/**
 * Konfiguracja skryptu Arkusz → Mapa (Faza 1).
 * REQ-1.4: odczyt z env; REQ-1.5: stałe kolumn, zakładek, URL GeoJSON.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

/** Katalog pakietu `arkusz-mapa` (nad `src/`) — stałe niezależnie od `process.cwd()`. */
const ARKUSZ_MAPA_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// REQ-1.5: indeksy kolumn (A=0, B=1, C=2, …)
// Aktualna struktura arkusza (2026-06: kolumna NIP na A; 2026-04: Województwo):
// A=0 NIP, B=1 Podmiot handlowy, C=2 Sklep, D=3 Kod pocztowy, E=4 Miasto, F=5 Ulica,
// G=6 Numer budynku, H=7 Gmina, I=8 Województwo, J=9 Numer plomby,
// K=10 Status worka, L=11 Status TMS worka, M=12 Data zamknięcia worka,
// N=13 Tryb zbiórki, O=14 Waga, P=15 Frakcja, Q=16 Typ worka
export const COL_NIP = 0;
export const COL_PODMIOT_HANDLOWY = 1;
export const COL_SKLEP = 2;
export const COL_KOD_POCZTOWY = 3;   // D
export const COL_MIASTO = 4;          // E
export const COL_ULICA = 5;           // F
export const COL_NUMER_BUDYNKU = 6;   // G
export const COL_GMINA = 7;           // H
export const COL_WOJEWODZTWO = 8;     // I
export const COL_NUMER_PLOMBY = 9;    // J
/** M (12): data zamknięcia worka — m.in. do listy plomb w Wordzie (mm-dd). */
export const COL_DATA_ZAMKNIECIA_WORKA = 12;
export const COL_ZBIORKA = 13;        // N – Tryb zbiórki

/** Domyślne indeksy kolumn — używane gdy brak wiersza nagłówków; patrz też resolveSheetColumnMap(). */
export const DEFAULT_SHEET_COLUMN_MAP = {
  podmiotHandlowy: COL_PODMIOT_HANDLOWY,
  sklep: COL_SKLEP,
  kodPocztowy: COL_KOD_POCZTOWY,
  miasto: COL_MIASTO,
  ulica: COL_ULICA,
  numerBudynku: COL_NUMER_BUDYNKU,
  gmina: COL_GMINA,
  numerPlomby: COL_NUMER_PLOMBY,
  dataZamknieciaWorka: COL_DATA_ZAMKNIECIA_WORKA,
  zbiorka: COL_ZBIORKA,
} as const;

// REQ-1.5: nazwy zakładek w Google Sheets
export const SHEET_NAME_DUPLIKATY_PLOMB = 'Duplikaty plomb';
export const SHEET_NAME_WYNIKI_NIEPEWNE = 'Wyniki niepewne';
export const SHEET_NAME_ZGRUPOWANE_NIEPEWNE_ADRESY = 'Zgrupowane niepewne adresy';
export const SHEET_NAME_ZGRUPOWANE_BLEDNE_ADRESY = 'Zgrupowane błędne adresy';

export const SHEET_NAME_ADRESY_PEWNE = 'Adresy pewne';
export const SHEET_NAME_ADRESY_PEWNE_BEZ_KODU = 'Adresy pewne bez kodu';
export const SHEET_NAME_ADRESY_NIEPEWNE = 'Adresy niepewne';
export const SHEET_NAME_ADRESY_TYLKO_KOD_MIASTO = 'Adresy tylko kod+miasto';
/** Pary adresów na mapie w odległości ≤ 20 m (nakładające się pinezki). */
export const SHEET_NAME_BLISKIE_ADRESY = 'Bliskie adresy (≤20 m)';

// REQ-1.5: URL GeoJSON granic województw (Polska)
export const GEOJSON_WOJEWODZTWA_URL =
  'https://gist.githubusercontent.com/filipstachura/391ecb779d56483c070616a4d9239cc7/raw/poland_woj.json';

export interface AppConfig {
  sheetsId: string;
  credentialsPath: string;
  outputDir: string;
}

/**
 * Wczytuje konfigurację z zmiennych środowiskowych (.env lub process.env).
 * REQ-1.4: wymagane GOOGLE_SHEETS_ID, GOOGLE_APPLICATION_CREDENTIALS, OUTPUT_DIR.
 */
export function getConfig(): AppConfig {
  const sheetsId = process.env.GOOGLE_SHEETS_ID?.trim();
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  const outputDir = process.env.OUTPUT_DIR?.trim();

  if (!sheetsId) {
    throw new Error('Missing or empty GOOGLE_SHEETS_ID in environment');
  }
  if (!credentialsPath) {
    throw new Error('Missing or empty GOOGLE_APPLICATION_CREDENTIALS in environment');
  }
  if (!outputDir) {
    throw new Error('Missing or empty OUTPUT_DIR in environment');
  }

  return { sheetsId, credentialsPath, outputDir };
}

/**
 * Ścieżki do szablonu Word i listy podwykonawców (XLSX lub ODS) przy generowaniu mapy.
 * Domyślnie: `docs/pusty.docx` oraz `docs/podwyko lista.xlsx`.
 * Nadpisanie: WORD_TEMPLATE_PATH, PODWYKOLISTA_ODS_PATH (nazwa historyczna — działa też dla .xlsx).
 */
export function getOptionalWordMapAssetPaths(): { templatePath: string; podwykoPath: string } {
  const templatePath =
    process.env.WORD_TEMPLATE_PATH?.trim() ?? join(ARKUSZ_MAPA_ROOT, 'docs', 'pusty.docx');
  const podwykoPath =
    process.env.PODWYKOLISTA_ODS_PATH?.trim() ?? join(ARKUSZ_MAPA_ROOT, 'docs', 'podwyko lista.xlsx');
  return { templatePath, podwykoPath };
}

/** Wspólny plik cache (lokalnie + seed w CI) — commituj po aktualizacji geokodów. */
export const DEFAULT_PHASE5_CACHE_PATH = join(ARKUSZ_MAPA_ROOT, 'data', 'phase5-cache.json');

/**
 * Literówki / warianty zapisu → kanoniczny adres (ten sam sklep/punkt).
 * Klucz = adres z arkusza; wartość = adres używany przy grupowaniu i geokodowaniu.
 */
export const DEFAULT_ADDRESS_ALIASES_PATH = join(ARKUSZ_MAPA_ROOT, 'data', 'address-aliases.json');

/**
 * Plik JSON z cache wyników geokodowania (faza 5).
 * Domyślnie: `data/phase5-cache.json` (ten sam plik co w repo / seed w GitHub Actions).
 * Nadpisanie: `PHASE5_CACHE_PATH` — CI ustawia `.cache/phase5-cache.json` (Actions cache, poza artefaktem Pages).
 */
export function getPhase5CacheFilePath(_outputDir: string): string {
  const fromEnv = process.env.PHASE5_CACHE_PATH?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return DEFAULT_PHASE5_CACHE_PATH;
}
