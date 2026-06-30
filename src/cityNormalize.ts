/**
 * Normalizacja nazwy miasta z arkusza (literówki: Gdańska → Gdańsk).
 */

import {
  polishAsciiLower,
  stripPolishDiacritics,
} from './polishText.js';

function normalizeCell(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

const CITY_TYPOS: Record<string, string> = {
  lodz: 'Łódź',
  gdansk: 'Gdańsk',
  gdanska: 'Gdańsk',
  swietoszow: 'Świętyszów',
  slawa: 'Sława',
};

/** Znane legacy zapisy miasta (bez ogonków / literówki) → kanoniczna forma. */
const CITY_LEGACY_FORMS: Record<string, string[]> = {
  'Łódź': ['Łódż', 'Lodz', 'lodz'],
  'Gdańsk': ['Gdansk', 'gdansk'],
  'Świętyszów': ['Swietoszow', 'swietoszow'],
  'Sława': ['Slawa', 'slawa'],
};

/** Nazwa miasta do porównania z wynikiem Nominatim (ł/ź/ż, Gdansk→Gdańsk). */
export function normalizeCityForCompare(city: string): string {
  let normalized = normalizeCell(city);
  normalized = normalized.replace(/\s*\([^)]*\)\s*$/gu, '').trim();
  const canonical = CITY_TYPOS[polishAsciiLower(normalized)];
  if (canonical) {
    normalized = canonical;
  }
  return polishAsciiLower(normalized);
}

/** Ujednolica nazwę miasta przed geokodowaniem i kluczem cache. */
export function normalizeCityFromSheet(city: string): string {
  let normalized = normalizeCell(city);
  normalized = normalized.replace(/\s*\([^)]*\)\s*$/gu, '').trim();
  if (normalized.toUpperCase() === 'WROCŁAW-FABRYCZNA') {
    return 'Wrocław';
  }
  const cityKey = polishAsciiLower(normalized);
  const canonical = CITY_TYPOS[cityKey];
  if (canonical) {
    return canonical;
  }
  return normalized;
}

/** Legacy warianty miasta w kluczu cache (Gdańsk → Gdansk, Świętyszów → Swietoszow). */
export function legacyCityNameVariants(city: string): string[] {
  const canonical = normalizeCityFromSheet(city);
  const variants = new Set<string>();

  const ascii = stripPolishDiacritics(city);
  if (ascii !== city) {
    variants.add(ascii);
  }

  const canonicalAscii = stripPolishDiacritics(canonical);
  if (canonicalAscii !== canonical) {
    variants.add(canonicalAscii);
  }

  for (const legacy of CITY_LEGACY_FORMS[canonical] ?? []) {
    variants.add(legacy);
  }

  variants.delete(city);
  variants.delete(canonical);
  return [...variants];
}

/** Czy pierwszy token klucza cache to znane miasto (kanoniczne lub poprawiane z legacy). */
export function isKnownCanonicalCityName(cityToken: string): boolean {
  const normalized = normalizeCityFromSheet(cityToken);
  if (normalized !== cityToken) {
    return true;
  }
  for (const canonical of Object.keys(CITY_LEGACY_FORMS)) {
    if (polishAsciiLower(canonical) === polishAsciiLower(cityToken)) {
      return true;
    }
  }
  return false;
}
