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
// Aktualna struktura arkusza (od 2026-04-09 dodano kolumnę "Województwo" na pozycji H):
// A=0 Podmiot handlowy, B=1 Sklep, C=2 Kod pocztowy, D=3 Miasto, E=4 Ulica,
// F=5 Numer budynku, G=6 Gmina, H=7 Województwo, I=8 Numer plomby,
// J=9 Status worka, K=10 Status TMS worka, L=11 Data zamknięcia worka,
// M=12 Tryb zbiórki, N=13 Waga, O=14 Frakcja, P=15 Typ worka
export const COL_KOD_POCZTOWY = 2;   // C
export const COL_MIASTO = 3;          // D
export const COL_ULICA = 4;           // E
export const COL_NUMER_BUDYNKU = 5;   // F
export const COL_NUMER_PLOMBY = 8;    // I – przesunięte po dodaniu kolumny "Województwo" w H
/** L (11): data zamknięcia worka — m.in. do listy plomb w Wordzie (mm-dd). */
export const COL_DATA_ZAMKNIECIA_WORKA = 11;
export const COL_ZBIORKA = 12;        // M – Tryb zbiórki (poprzednio L=11)

// REQ-1.5: nazwy zakładek w Google Sheets
export const SHEET_NAME_DUPLIKATY_PLOMB = 'Duplikaty plomb';
export const SHEET_NAME_WYNIKI_NIEPEWNE = 'Wyniki niepewne';
export const SHEET_NAME_ZGRUPOWANE_NIEPEWNE_ADRESY = 'Zgrupowane niepewne adresy';
export const SHEET_NAME_ZGRUPOWANE_BLEDNE_ADRESY = 'Zgrupowane błędne adresy';

export const SHEET_NAME_ADRESY_PEWNE = 'Adresy pewne';
export const SHEET_NAME_ADRESY_PEWNE_BEZ_KODU = 'Adresy pewne bez kodu';
export const SHEET_NAME_ADRESY_NIEPEWNE = 'Adresy niepewne';
export const SHEET_NAME_ADRESY_TYLKO_KOD_MIASTO = 'Adresy tylko kod+miasto';

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
 * Ścieżki do szablonu Word i listy podwykonawców (ODS/XLSX) przy generowaniu mapy.
 * Domyślnie: `arkusz-mapa/docs/pusty.docx` oraz `arkusz-mapa/docs/podwyko lista.ods`
 * (np. na tym komputerze: …/srodowisko_pracy/arkusz-mapa/docs/…).
 * Nadpisanie: WORD_TEMPLATE_PATH, PODWYKOLISTA_ODS_PATH.
 */
export function getOptionalWordMapAssetPaths(): { templatePath: string; podwykoPath: string } {
  const templatePath =
    process.env.WORD_TEMPLATE_PATH?.trim() ?? join(ARKUSZ_MAPA_ROOT, 'docs', 'pusty.docx');
  const podwykoPath =
    process.env.PODWYKOLISTA_ODS_PATH?.trim() ?? join(ARKUSZ_MAPA_ROOT, 'docs', 'podwyko lista.ods');
  return { templatePath, podwykoPath };
}
