/**
 * Rejestr „Popraw adres” — ręcznie zweryfikowane współrzędne (Google Sheet + fallback JSON overrides).
 */

import { readFile } from 'node:fs/promises';
import type { AddressGroup } from './phase3.js';
import { getPhase5AddressOverridesPath, SHEET_NAME_POPRAW_ADRES } from './config.js';
import { polishAsciiFold } from './polishText.js';

export interface PoprawAdresEntry {
  podmiotHandlowy: string;
  sklep: string;
  adres: string;
  lat: number;
  lng: number;
  uwagi?: string;
  updatedAt?: string;
  author?: string;
}

export interface PoprawAdresMatch {
  entry: PoprawAdresEntry;
  source: 'popraw_adres_sheet' | 'popraw_adres_overrides';
}

function normalizeKeyPart(value: string): string {
  return polishAsciiFold(value.trim().replace(/\s+/g, ' ').toLowerCase());
}

export function buildPoprawAdresLookupKey(
  adres: string,
  podmiotHandlowy = '',
  sklep = '',
): string {
  return `${normalizeKeyPart(adres)}\0${normalizeKeyPart(podmiotHandlowy)}\0${normalizeKeyPart(sklep)}`;
}

/** PL locale Sheets: "50,39196" → 50.39196 (parseFloat stops at comma otherwise). */
function parseCoordNumber(raw: unknown): number {
  if (typeof raw === 'number') {
    return raw;
  }
  const normalized = String(raw ?? '')
    .trim()
    .replace(',', '.');
  return Number.parseFloat(normalized);
}

function parseLatLng(rawLat: unknown, rawLng: unknown): { lat: number; lng: number } | null {
  const lat = parseCoordNumber(rawLat);
  const lng = parseCoordNumber(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    return null;
  }
  return { lat, lng };
}

function rowCell(row: unknown[], index: number): string {
  const v = row[index];
  if (v === null || v === undefined) {
    return '';
  }
  return String(v).trim();
}

/** Parsuje wiersze zakładki „Popraw adres” (nagłówek w wierszu 1). */
export function parsePoprawAdresSheetRows(rows: string[][]): PoprawAdresEntry[] {
  if (rows.length < 2) {
    return [];
  }
  const out: PoprawAdresEntry[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] as unknown[];
    const adres = rowCell(row, 2);
    const coords = parseLatLng(row[3], row[4]);
    if (!adres || !coords) {
      continue;
    }
    out.push({
      podmiotHandlowy: rowCell(row, 0),
      sklep: rowCell(row, 1),
      adres,
      lat: coords.lat,
      lng: coords.lng,
      uwagi: rowCell(row, 5) || undefined,
      updatedAt: rowCell(row, 6) || undefined,
      author: rowCell(row, 7) || undefined,
    });
  }
  return out;
}

export function buildPoprawAdresIndex(entries: PoprawAdresEntry[]): Map<string, PoprawAdresEntry> {
  const index = new Map<string, PoprawAdresEntry>();
  for (const entry of entries) {
    const key = buildPoprawAdresLookupKey(entry.adres, entry.podmiotHandlowy, entry.sklep);
    index.set(key, entry);
  }
  return index;
}

/**
 * Dopasowanie: najpierw pełny klucz (adres+podmiot+sklep), potem sam adres z pustym podmiotem/sklepem.
 */
export function findPoprawAdresMatch(
  index: Map<string, PoprawAdresEntry>,
  address: string,
  group: AddressGroup,
): PoprawAdresEntry | undefined {
  const sample = group.rows[0];
  const podmiot = sample?.podmiotHandlowy ?? '';
  const sklep = sample?.sklep ?? '';

  const fullKey = buildPoprawAdresLookupKey(address, podmiot, sklep);
  const fullHit = index.get(fullKey);
  if (fullHit) {
    return fullHit;
  }

  const addressOnlyKey = buildPoprawAdresLookupKey(address, '', '');
  const addressOnlyHit = index.get(addressOnlyKey);
  if (addressOnlyHit) {
    return addressOnlyHit;
  }

  for (const [key, entry] of index.entries()) {
    const parts = key.split('\0');
    const keyAdres = parts[0] ?? '';
    if (keyAdres !== normalizeKeyPart(address)) {
      continue;
    }
    const keyPodmiot = parts[1] ?? '';
    const keySklep = parts[2] ?? '';
    if (keyPodmiot && normalizeKeyPart(podmiot) !== keyPodmiot) {
      continue;
    }
    if (keySklep && normalizeKeyPart(sklep) !== keySklep) {
      continue;
    }
    return entry;
  }

  return undefined;
}

/** Wpisy z phase5-address-overrides.json jako PoprawAdresEntry (fallback). */
export async function loadPoprawAdresFromOverridesJson(
  readFileFn: (path: string, encoding: BufferEncoding) => Promise<string> = readFile,
): Promise<PoprawAdresEntry[]> {
  const path = getPhase5AddressOverridesPath();
  try {
    const raw = await readFileFn(path, 'utf-8');
    const parsed = JSON.parse(raw) as Record<
      string,
      { lat?: number; lng?: number; status?: string }
    >;
    const entries: PoprawAdresEntry[] = [];
    for (const [adres, entry] of Object.entries(parsed)) {
      const coords = parseLatLng(entry.lat, entry.lng);
      if (!coords) {
        continue;
      }
      entries.push({
        podmiotHandlowy: '',
        sklep: '',
        adres,
        lat: coords.lat,
        lng: coords.lng,
      });
    }
    return entries;
  } catch {
    return [];
  }
}

export { SHEET_NAME_POPRAW_ADRES };
