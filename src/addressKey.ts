/**
 * Kanoniczne klucze adresów cache — odtwarzanie z legacy (skróty, brak al./plac).
 */

import { mapRawRowToSheetRow } from './sheets.js';

const CACHE_KEY_PATTERN = /^(\d{2}-\d{3})\s+(.+)\s+(\d+[a-zA-Z]?)$/u;

/** Przebudowuje klucz cache po normalizacji ulicy i miasta; null gdy już kanoniczny. */
export function rebuildCanonicalAddressKey(legacyKey: string): string | null {
  const match = legacyKey.match(CACHE_KEY_PATTERN);
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }

  const kod = match[1];
  const numer = match[3];
  const words = match[2].split(/\s+/).filter(Boolean);
  const maxCityWords = Math.min(words.length - 1, 5);

  for (let cityWords = maxCityWords; cityWords >= 1; cityWords--) {
    const miasto = words.slice(0, cityWords).join(' ');
    const ulica = words.slice(cityWords).join(' ');
    if (!ulica) {
      continue;
    }
    const row = mapRawRowToSheetRow(['', '', '', kod, miasto, ulica, numer, '', '', '1'], 2);
    if (row.address !== legacyKey) {
      return row.address;
    }
  }

  return null;
}
