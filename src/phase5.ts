/**
 * Faza 5: geokodowanie przez Nominatim + wyznaczanie błędnych adresów.
 * Wpis w cache (dowolny status) ma pierwszeństwo — bez ponownego geokodowania.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { normalizeCityForCompare, normalizeCityFromSheet } from './cityNormalize.js';
import { nominatimAsciiQueryVariant } from './polishText.js';
import type { AddressGroup } from './phase3.js';
import type { SheetRow } from './sheets.js';
import {
  canonicalCacheKeyFromLegacy,
  legacyCacheKeyAliases,
  migrateCacheEntries,
  purgeLegacyAbbreviationCacheKeys,
  resolveCacheEntry,
} from './cacheMigrate.js';
import {
  getOsiedleCoreName,
  isHamletPlaceStreet,
  isOsiedleStreet,
  needsStreetPrefixQueryVariants,
  normalizeStreetForCompare,
  streetTitleAbbreviationQueryVariants,
  stripStreetPrefix,
} from './streetNormalize.js';

import { polishAsciiFold } from './polishText.js';

export { stripStreetPrefix } from './streetNormalize.js';

interface NominatimResult {
  lat?: string;
  lon?: string;
  type?: string;
  class?: string;
  address?: {
    state?: string;
    county?: string;
    postcode?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    hamlet?: string;
    suburb?: string;
    city_district?: string;
    neighbourhood?: string;
    quarter?: string;
    place?: string;
    isolated_dwelling?: string;
    road?: string;
    pedestrian?: string;
    house_number?: string;
  };
}

export interface GeocodedAddress {
  address: string;
  count: number;
  lat: number;
  lng: number;
  wojewodztwo: string;
  /** Zbiórka: "Ręczna" / "Maszyna" / "Ręczna / Maszyna" (z kolumny L) */
  zbiorka?: string;
  rows: SheetRow[];
}

export interface GroupedNiepewnyAdres {
  address: string;
  liczbaWystapien: number;
  przykladoweLat: number;
  przykladoweLng: number;
  wojewodztwo: string;
}

export interface GroupedBlednyAdres {
  address: string;
  liczbaWystapien: number;
}

export interface Phase5Result {
  geocoded: GeocodedAddress[];
  geocodedNoPostcode: GeocodedAddress[];
  uncertainGeocoded: GeocodedAddress[];
  cityOnlyGeocoded: GeocodedAddress[];
  rowsBledneAdresy: SheetRow[];
  rowsNiepewneWyniki: SheetRow[];
  groupedNiepewneAdresy: GroupedNiepewnyAdres[];
  groupedBledneAdresy: GroupedBlednyAdres[];
  totalUniqueAddresses: number;
  totalBatches: number;
  geocodedUniqueAddresses: number;
  geocodedNoPostcodeUniqueAddresses: number;
  uncertainUniqueAddresses: number;
  cityOnlyUniqueAddresses: number;
  badUniqueAddresses: number;
  badAddressRows: number;
}

export interface ExecutePhase5Options {
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  userAgent?: string;
  rateLimitMs?: number;
  /** Timeout pojedynczego żądania do Nominatim (ms). Domyślnie 15s. */
  requestTimeoutMs?: number;
  /** Liczba ponownych prób przy błędzie sieci/timeout (0 = brak retry). Domyślnie 2 (łącznie 3 próby). */
  requestRetries?: number;
  batchSize?: number;
  cacheFilePath?: string;
  logger?: {
    info?: (message: string, ...args: unknown[]) => void;
    warn?: (message: string, ...args: unknown[]) => void;
  };
  readFileFn?: (path: string, encoding: BufferEncoding) => Promise<string>;
  writeFileFn?: (path: string, content: string, encoding: BufferEncoding) => Promise<void>;
  mkdirFn?: (path: string, options: { recursive: true }) => Promise<unknown>;
}

function normalize(value: string | undefined): string {
  return (value ?? '').trim();
}

function normalizeForCompare(value: string | undefined): string {
  return polishAsciiFold(normalize(value));
}

/** Min. długość krótszej nazwy przy dopasowaniu „zawiera”, żeby uniknąć np. Park vs Parkowa. */
const MIN_STREET_CONTAINS_LENGTH = 5;

function streetNamesMatch(expected: string, candidate: string): boolean {
  if (!expected || !candidate) {
    return false;
  }
  if (expected === candidate) {
    return true;
  }
  const a = expected.trim();
  const b = candidate.trim();
  if (a.length < MIN_STREET_CONTAINS_LENGTH && b.length < MIN_STREET_CONTAINS_LENGTH) {
    return false;
  }
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < MIN_STREET_CONTAINS_LENGTH) {
    return false;
  }
  return longer.includes(shorter);
}

/** Zwraca część przed "/" (np. 10/10 → 10) – do zapytań i porównań numeru budynku. */
export function stripAfterSlash(value: string | undefined): string {
  const s = normalize(value);
  const beforeSlash = s.split('/')[0];
  return (beforeSlash ?? s).trim();
}

/** Kod pocztowy do porównania: tylko 5 cyfr (62-320 i 62320 → 62320). Zwiększa dopasowanie. */
function normalizePostcodeForCompare(postcode: string | undefined): string {
  const digits = (postcode ?? '').replace(/\D/g, '');
  return digits.slice(0, 5);
}

/** Pierwsze 3 cyfry kodu pocztowego (np. 62-320 → 623). P7: zgodność prefixu. */
function first3DigitsOfPostcode(postcode: string | undefined): string {
  const digits = (postcode ?? '').replace(/\D/g, '');
  return digits.slice(0, 3);
}

function isMissingStreet(street: string): boolean {
  const s = street.trim().toLowerCase();
  return s.length === 0 || s === 'brak';
}

/** W arkuszu numer budynku powtórzony w kolumnie „Ulica” (np. ulica=170, numer=170). */
export function isNumericDuplicateStreetNumber(
  row: Pick<SheetRow, 'ulica' | 'numerBudynku'>,
): boolean {
  const ulica = normalize(row.ulica);
  if (isMissingStreet(ulica)) {
    return false;
  }
  const number = normalizeForCompare(stripAfterSlash(row.numerBudynku));
  if (!number) {
    return false;
  }
  return normalizeForCompare(ulica) === number;
}

/**
 * Adres wiejski bez ulicy: w arkuszu w kolumnie „Ulica” jest nazwa miejscowości (ew. z numerem),
 * a nie nazwa drogi. OSM używa wtedy addr:place — zapytania i scoring jak przy braku ulicy.
 */
export function isVillagePlaceAddress(row: Pick<SheetRow, 'ulica' | 'miasto' | 'numerBudynku'>): boolean {
  const ulica = normalize(row.ulica);
  if (isMissingStreet(ulica)) {
    return false;
  }

  const city = normalizeForCompare(normalizeCityForGeocoding(row.miasto));
  const street = normalizeStreetForCompare(ulica);
  const number = normalizeForCompare(stripAfterSlash(row.numerBudynku));
  if (!city || !street) {
    return false;
  }

  if (street === city) {
    return true;
  }
  if (number && street === `${city} ${number}`) {
    return true;
  }
  if (street.startsWith(`${city} `)) {
    const rest = street.slice(city.length + 1).trim();
    if (!rest || (number && rest === number)) {
      return true;
    }
  }

  return false;
}

function hasRealStreet(row: SheetRow): boolean {
  return !isMissingStreet(row.ulica) && !isPlaceOnlyAddress(row);
}

function treatAsMissingStreet(row: SheetRow): boolean {
  return isMissingStreet(row.ulica) || isPlaceOnlyAddress(row);
}

function normalizeCityForGeocoding(city: string): string {
  return normalizeCityFromSheet(city);
}

/** W kolumnie Ulica jest nazwa przysiółka/wsi w obrębie miasta z kolumny Miasto. */
export function isHamletPlaceAddress(row: Pick<SheetRow, 'ulica' | 'miasto' | 'numerBudynku'>): boolean {
  return isHamletPlaceStreet(row.ulica, row.miasto);
}

function isPlaceOnlyAddress(row: Pick<SheetRow, 'ulica' | 'miasto' | 'numerBudynku'>): boolean {
  return (
    isVillagePlaceAddress(row) ||
    isHamletPlaceAddress(row) ||
    isNumericDuplicateStreetNumber(row)
  );
}

/** Duże miasta — w arkuszu często mylone kody pocztowe; przy dopasowaniu ulicy ignorujemy rozbieżność kodu. */
const LARGE_CITY_LOOKUP_KEYS = new Set(
  [
    'Warszawa',
    'Kraków',
    'Łódź',
    'Wrocław',
    'Poznań',
    'Gdańsk',
    'Gdynia',
    'Szczecin',
    'Bydgoszcz',
    'Lublin',
    'Białystok',
    'Katowice',
    'Częstochowa',
    'Radom',
    'Sosnowiec',
    'Toruń',
    'Kielce',
    'Rzeszów',
    'Gliwice',
    'Zabrze',
    'Olsztyn',
    'Bielsko-Biała',
    'Bytom',
    'Ruda Śląska',
    'Rybnik',
    'Tychy',
    'Opole',
  ].map((city) => normalizeForCompare(city)),
);

export function isLargeCity(city: string): boolean {
  return LARGE_CITY_LOOKUP_KEYS.has(normalizeForCompare(normalizeCityForGeocoding(city)));
}

export function buildGeocodingQuery(row: SheetRow): string {
  const kod = normalize(row.kodPocztowy);
  const miasto = normalizeCityForGeocoding(row.miasto);
  const ulica = normalize(row.ulica);
  const ulicaBezPrefiksu = stripStreetPrefix(ulica) || ulica;
  const numer = stripAfterSlash(row.numerBudynku);

  if (treatAsMissingStreet(row)) {
    return `${miasto} ${numer}, ${kod}, Polska`.replace(/\s+/g, ' ').trim();
  }

  const parts: string[] = [kod, miasto, ulicaBezPrefiksu, numer];
  return `${parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()}, Polska`;
}

function normalizeGmina(gmina: string): string {
  return normalize(gmina).split('(')[0]?.trim() ?? '';
}

/** Z wierszy zbiera wartości z kolumny L (zbiórka), zwraca "Ręczna" / "Maszyna" / "Ręczna / Maszyna" lub undefined. */
function aggregateZbiorka(rows: SheetRow[]): string | undefined {
  const values = new Set<string>();
  for (const row of rows) {
    const v = (row.zbiorka ?? '').trim().toLowerCase();
    if (v) {
      if (v.includes('ręcz') || v === 'r') values.add('Ręczna');
      else if (v.includes('maszyn') || v === 'm') values.add('Maszyna');
      else values.add(v.charAt(0).toUpperCase() + v.slice(1));
    }
  }
  if (values.size === 0) return undefined;
  return [...values].sort().join(' / ');
}

function pushQuery(target: string[], query: string): void {
  const cleaned = query.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return;
  }
  if (!target.includes(cleaned)) {
    target.push(cleaned);
  }
}

function appendNominatimAsciiQueryVariants(queries: string[]): void {
  const snapshot = [...queries];
  for (const query of snapshot) {
    const variant = nominatimAsciiQueryVariant(query);
    if (variant) {
      pushQuery(queries, variant);
    }
  }
}

function appendStreetAbbreviationQueryVariants(
  queries: string[],
  kod: string,
  miasto: string,
  ulica: string,
  numer: string,
  ulicaRaw = '',
): void {
  for (const streetVariant of streetTitleAbbreviationQueryVariants(ulica, ulicaRaw)) {
    const core = stripStreetPrefix(streetVariant) || streetVariant;
    pushQuery(queries, `${miasto} ${core} ${numer}, Polska`);
    pushQuery(queries, `${core} ${numer} ${miasto}, Polska`);
    pushQuery(queries, `${kod} ${miasto} ${core} ${numer}, Polska`);
    pushQuery(queries, `${kod} ${miasto} ul. ${core} ${numer}, Polska`);
  }
}

function pushStreetPrefixQueryVariants(
  queries: string[],
  kod: string,
  miasto: string,
  ulica: string,
  numer: string,
): void {
  if (!needsStreetPrefixQueryVariants(ulica, miasto)) {
    return;
  }

  const trimmedUlica = ulica.trim();
  const hadAlejaPrefix = /^Aleja\s+/iu.test(trimmedUlica);
  const hadPlacPrefix = /^Plac\s+/iu.test(trimmedUlica);
  const core = stripStreetPrefix(ulica) || ulica;
  pushQuery(queries, `${kod} ${miasto} ul. ${core} ${numer}, Polska`);
  pushQuery(queries, `${miasto} ul. ${core} ${numer}, Polska`);

  if (!/^\s*(al\.?|aleja|alei)\s+/iu.test(ulica) && !/^Aleja\s+/iu.test(core) && !hadAlejaPrefix) {
    pushQuery(queries, `${kod} ${miasto} al. ${core} ${numer}, Polska`);
  }
  if (!/^\s*(pl\.?|plac)\s+/iu.test(ulica) && !/^Plac\s+/iu.test(core) && !hadPlacPrefix) {
    pushQuery(queries, `${kod} ${miasto} plac ${core} ${numer}, Polska`);
  }
  if (hadAlejaPrefix || /^Aleja\s+/iu.test(core)) {
    const withoutAleja = hadAlejaPrefix ? core : core.replace(/^Aleja\s+/iu, '').trim();
    pushQuery(queries, `${kod} ${miasto} ${withoutAleja} ${numer}, Polska`);
    pushQuery(queries, `${kod} ${miasto} al. ${withoutAleja} ${numer}, Polska`);
  }
  if (hadPlacPrefix || /^Plac\s+/iu.test(core)) {
    const withoutPlac = hadPlacPrefix ? core : core.replace(/^Plac\s+/iu, '').trim();
    pushQuery(queries, `${kod} ${miasto} ${withoutPlac} ${numer}, Polska`);
  }
}

export function buildGeocodingQueries(row: SheetRow): string[] {
  const kod = normalize(row.kodPocztowy);
  const miasto = normalizeCityForGeocoding(row.miasto);
  const ulica = normalize(row.ulica);
  const numer = stripAfterSlash(row.numerBudynku);
  const gmina = normalizeGmina(row.gmina);
  const missingStreet = treatAsMissingStreet(row);

  const queries: string[] = [];

  if (missingStreet) {
    const place = normalizeCityForGeocoding(row.miasto);
    if (numer) {
      // Nominatim: wsi bez ulicy — „miejscowość numer, kod, Polska” (kod na początku zwykle nie działa).
      pushQuery(queries, `${place} ${numer}, ${kod}, Polska`);
    }
    if (isVillagePlaceAddress(row) || isNumericDuplicateStreetNumber(row)) {
      pushQuery(queries, `${kod} ${place} ${numer}, Polska`);
      pushQuery(queries, `${kod} ${place}, Polska`);
    }
    if (isHamletPlaceAddress(row)) {
      const hamlet = stripStreetPrefix(ulica) || ulica;
      pushQuery(queries, `${kod} ${hamlet} ${numer}, Polska`);
      pushQuery(queries, `${kod} ${miasto} ${hamlet} ${numer}, Polska`);
      pushQuery(queries, `${hamlet} ${numer} ${miasto}, Polska`);
    }
    pushQuery(queries, `${kod} ${miasto} ${numer}, Polska`);
    pushQuery(queries, `${kod} ${gmina} ${numer}, Polska`);
    pushQuery(queries, `${kod} ${miasto}, Polska`);
    pushQuery(queries, `${kod} ${gmina}, Polska`);
  } else {
    const ulicaBezPrefiksu = stripStreetPrefix(ulica) || ulica;
    // Warianty bez kodu na początku – Nominatim lepiej zwraca budynki przy "miasto ulica numer" / "ulica numer miasto". Kod i tak weryfikujemy w scoreCandidate.
    pushQuery(queries, `${miasto} ${ulicaBezPrefiksu} ${numer}, Polska`);
    pushQuery(queries, `${ulicaBezPrefiksu} ${numer} ${miasto}, Polska`);
    if (isOsiedleStreet(ulica)) {
      const osiedleCore = getOsiedleCoreName(ulica);
      pushQuery(queries, `${kod} ${miasto} osiedle ${osiedleCore} ${numer}, Polska`);
      pushQuery(queries, `${miasto} osiedle ${osiedleCore} ${numer}, Polska`);
      pushQuery(queries, `${kod} ${miasto} ${ulicaBezPrefiksu} ${numer}, Polska`);
    }
    pushQuery(queries, `${kod} ${miasto}, Polska`);
    pushQuery(queries, `${kod} ${miasto} ${numer}, Polska`);
    pushQuery(queries, `${kod} ${gmina} ${numer}, Polska`);
    pushQuery(queries, `${kod} ${gmina}, Polska`);
    const lastWordOfStreet = ulicaBezPrefiksu.split(/\s+/).filter(Boolean).pop();
    if (lastWordOfStreet && lastWordOfStreet.length >= 4 && lastWordOfStreet !== ulicaBezPrefiksu) {
      pushQuery(queries, `${kod} ${miasto} ${lastWordOfStreet} ${numer}, Polska`);
      pushQuery(queries, `${kod} ${miasto} ${lastWordOfStreet}, Polska`);
    }
    pushQuery(queries, `${kod} ${miasto} ${ulicaBezPrefiksu} ${numer}, Polska`);
    pushQuery(queries, `${kod} ${gmina} ${ulicaBezPrefiksu} ${numer}, Polska`);
    pushQuery(queries, `${kod} ${miasto} ${ulicaBezPrefiksu}, Polska`);
    pushQuery(queries, `${kod} ${gmina} ${ulicaBezPrefiksu}, Polska`);
    pushStreetPrefixQueryVariants(queries, kod, miasto, ulica, numer);
    appendStreetAbbreviationQueryVariants(queries, kod, miasto, ulica, numer, row.ulicaRaw);
  }

  // Dodatkowy fallback - nadal z kodem pocztowym, żeby nie "uciekać" do złego regionu.
  pushQuery(queries, `${kod} ${row.address}, Polska`);
  appendNominatimAsciiQueryVariants(queries);
  return queries;
}

export function buildNominatimUrl(query: string): string {
  return `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    query,
  )}&format=json&limit=${NOMINATIM_CANDIDATE_LIMIT}&addressdetails=1&countrycodes=pl`;
}

export function extractVoivodeship(result: { address?: { state?: string; county?: string } }): string {
  const raw = normalize(result.address?.state);
  if (!raw) {
    return 'Nieznane';
  }

  const lowered = raw.toLowerCase();
  const withoutPrefix = lowered.startsWith('województwo ')
    ? raw.slice('województwo '.length).trim()
    : raw;
  if (!withoutPrefix) {
    return 'Nieznane';
  }
  return withoutPrefix.charAt(0).toUpperCase() + withoutPrefix.slice(1);
}

function getCandidateLocality(result: NominatimResult): string {
  return (
    result.address?.city ??
    result.address?.town ??
    result.address?.village ??
    result.address?.municipality ??
    result.address?.hamlet ??
    result.address?.suburb ??
    result.address?.city_district ??
    result.address?.county ??
    ''
  );
}

function stripLeadingGmina(name: string): string {
  return name.replace(/^gmina\s+/iu, '').trim();
}

/** Dopasowanie miejscowości dla wsi / przysiółka (OSM: village, hamlet, gmina X itd.). */
function placeLocalityMatches(row: Pick<SheetRow, 'miasto' | 'ulica' | 'numerBudynku'>, result: NominatimResult): boolean {
  const expectedNames = new Set<string>();
  const parent = normalizeForCompare(normalizeCityForGeocoding(row.miasto));
  if (parent) {
    expectedNames.add(parent);
  }
  if (isPlaceOnlyAddress(row)) {
    const place = normalizeStreetForCompare(row.ulica);
    if (place) {
      expectedNames.add(place);
    }
  }

  if (expectedNames.size === 0) {
    return false;
  }

  const addr = result.address;
  if (!addr) {
    return false;
  }

  const fields = [
    addr.city,
    addr.town,
    addr.village,
    addr.municipality,
    addr.hamlet,
    addr.suburb,
    addr.city_district,
    addr.place,
    addr.isolated_dwelling,
  ];

  for (const raw of fields) {
    const candidate = normalizeForCompare(stripLeadingGmina(normalize(raw)));
    if (!candidate) {
      continue;
    }
    for (const expected of expectedNames) {
      if (candidate === expected || candidate.includes(expected) || expected.includes(candidate)) {
        return true;
      }
    }
  }

  return false;
}

function getCandidateStreet(result: NominatimResult): string {
  return result.address?.road ?? result.address?.pedestrian ?? '';
}

/** OSM zapisuje osiedla w neighbourhood/quarter, nie w road. */
function osiedleNamesMatch(ulica: string, result: NominatimResult): boolean {
  const core = normalizeForCompare(getOsiedleCoreName(ulica));
  if (!core) {
    return false;
  }

  const fields = [
    result.address?.neighbourhood,
    result.address?.quarter,
    result.address?.suburb,
    result.address?.road,
    result.address?.pedestrian,
  ];

  for (const raw of fields) {
    const normalized = normalizeForCompare(raw);
    if (!normalized) {
      continue;
    }
    const withoutOsiedlePrefix = normalized.replace(/^osiedle\s+/, '').trim();
    if (withoutOsiedlePrefix === core || normalized === core) {
      return true;
    }
    if (streetNamesMatch(core, withoutOsiedlePrefix)) {
      return true;
    }
  }

  return false;
}

/** Nominatim zwrócił konkretny budynek (nie centroid kodu / miejscowości). */
function isBuildingLevelResult(result: NominatimResult): boolean {
  const type = normalize(result.type).toLowerCase();
  const klass = normalize(result.class).toLowerCase();
  if (type === 'house' || type === 'building' || type === 'isolated_dwelling') {
    return true;
  }
  if (klass === 'building' && normalize(result.address?.house_number).length > 0) {
    return true;
  }
  return false;
}

/**
 * Wieś / przysiółek: zgodny kod (lub prefix) + numer budynku + wynik na poziomie budynku.
 * OSM często nie zwraca nazwy miejscowości w polach address mimo trafnego punktu.
 */
function placeOnlyPreciseBuildingMatch(row: SheetRow, result: NominatimResult): boolean {
  if (!isPlaceOnlyAddress(row) || !isBuildingLevelResult(result)) {
    return false;
  }

  const expectedNumber = normalizeForCompare(stripAfterSlash(row.numerBudynku));
  const candidateNumber = normalizeForCompare(stripAfterSlash(result.address?.house_number));
  if (!expectedNumber || expectedNumber !== candidateNumber) {
    return false;
  }

  const expectedPostcode = normalizePostcodeForCompare(row.kodPocztowy);
  const candidatePostcode = normalizePostcodeForCompare(result.address?.postcode);
  if (expectedPostcode.length >= 5 && candidatePostcode === expectedPostcode) {
    return true;
  }

  const expectedPrefix = first3DigitsOfPostcode(row.kodPocztowy);
  const candidatePrefix = first3DigitsOfPostcode(result.address?.postcode);
  return (
    expectedPrefix.length >= 3 &&
    candidatePrefix.length >= 3 &&
    expectedPrefix === candidatePrefix
  );
}

const CONFIDENCE_SCORE_THRESHOLD = 6;

function resolvePlaceLocalityMatch(row: SheetRow, result: NominatimResult): boolean {
  if (placeLocalityMatches(row, result)) {
    return true;
  }
  return placeOnlyPreciseBuildingMatch(row, result);
}

function isPostcodeCentroidResult(result: NominatimResult): boolean {
  return normalize(result.type).toLowerCase() === 'postcode';
}

/** Limit kandydatów zwracanych przez Nominatim (więcej = lepsze dopasowanie przy wielu wynikach). */
export const NOMINATIM_CANDIDATE_LIMIT = 15;

interface CandidateScore {
  score: number;
  postcodeMatched: boolean;
  streetMatch: boolean;
  /** false gdy zaakceptowano wynik mimo braku kodu w odpowiedzi Nominatim */
  postcodePresentInResult: boolean;
}

function scoreCandidate(result: NominatimResult, row: SheetRow): CandidateScore {
  const expectedPostcode = normalizePostcodeForCompare(row.kodPocztowy);
  const expectedCity = normalizeCityForCompare(row.miasto);
  const expectedStreet = normalizeStreetForCompare(row.ulica, row.miasto);
  const expectedNumber = normalizeForCompare(stripAfterSlash(row.numerBudynku));
  const hasStreet = hasRealStreet(row);
  const villagePlace = isVillagePlaceAddress(row);
  const hamletPlace = isHamletPlaceAddress(row);
  const placeOnly = villagePlace || hamletPlace;
  const osiedleStreet = isOsiedleStreet(row.ulica);

  const candidatePostcode = normalizePostcodeForCompare(result.address?.postcode);
  const candidateCity = normalizeCityForCompare(getCandidateLocality(result));
  const candidateStreet = normalizeStreetForCompare(getCandidateStreet(result), row.miasto);
  const candidateNumber = normalizeForCompare(stripAfterSlash(result.address?.house_number));

  const cityMatch = placeOnly
    ? resolvePlaceLocalityMatch(row, result)
    : Boolean(expectedCity && candidateCity && expectedCity === candidateCity);
  const streetMatch = osiedleStreet
    ? osiedleNamesMatch(row.ulica, result)
    : Boolean(
        hasStreet &&
          expectedStreet &&
          candidateStreet &&
          streetNamesMatch(expectedStreet, candidateStreet),
      );
  const numberMatch = Boolean(expectedNumber && candidateNumber && expectedNumber === candidateNumber);

  if (expectedPostcode.length >= 5 && candidatePostcode !== expectedPostcode) {
    const expectedPrefix = first3DigitsOfPostcode(row.kodPocztowy);
    const candidatePrefix = first3DigitsOfPostcode(result.address?.postcode);
    if (
      expectedPrefix.length >= 3 &&
      candidatePrefix.length >= 3 &&
      expectedPrefix === candidatePrefix &&
      cityMatch &&
      (!hasStreet || streetMatch)
    ) {
      return {
        score: 4 + (streetMatch ? 3 : 0) + (placeOnly && numberMatch ? 2 : 0),
        postcodeMatched: true,
        streetMatch,
        postcodePresentInResult: true,
      };
    }
    if (
      candidatePostcode.length < 3 &&
      cityMatch &&
      (!hasStreet || streetMatch)
    ) {
      return {
        score: 4 + (streetMatch ? 3 : 0) + (numberMatch ? 2 : 0),
        postcodeMatched: true,
        streetMatch,
        postcodePresentInResult: false,
      };
    }
    if (isLargeCity(row.miasto) && cityMatch && streetMatch) {
      return {
        score: 4 + 3 + (numberMatch ? 2 : 0),
        postcodeMatched: true,
        streetMatch,
        postcodePresentInResult: true,
      };
    }
    if (placeOnly && cityMatch && numberMatch) {
      return {
        score: CONFIDENCE_SCORE_THRESHOLD,
        postcodeMatched: expectedPrefix.length >= 3 && expectedPrefix === candidatePrefix,
        streetMatch: false,
        postcodePresentInResult: candidatePostcode.length >= 3,
      };
    }
    return {
      score: -100,
      postcodeMatched: false,
      streetMatch: false,
      postcodePresentInResult: true,
    };
  }

  let score = 0;
  if (cityMatch) {
    score += 4;
  }
  if (streetMatch) {
    score += 3;
  }
  if (numberMatch) {
    score += 2;
  }
  if (placeOnly && numberMatch) {
    score = Math.max(score, CONFIDENCE_SCORE_THRESHOLD);
  }

  return {
    score,
    postcodeMatched: true,
    streetMatch,
    postcodePresentInResult: true,
  };
}

type CandidateClassification = 'ok' | 'ok_no_postcode' | 'uncertain' | 'city_only' | 'bad';

interface CandidatePickResult {
  bestCandidate?: NominatimResult;
  status: CandidateClassification;
  bestScore: number;
}

function classificationStatusRank(status: CandidateClassification): number {
  if (status === 'ok') {
    return 5;
  }
  if (status === 'ok_no_postcode') {
    return 4;
  }
  if (status === 'city_only') {
    return 3;
  }
  if (status === 'uncertain') {
    return 2;
  }
  return 0;
}

function isBetterPick(
  next: CandidatePickResult,
  current: CandidatePickResult | undefined,
): boolean {
  if (!current) {
    return next.status !== 'bad';
  }
  const nextRank = classificationStatusRank(next.status);
  const currentRank = classificationStatusRank(current.status);
  if (nextRank !== currentRank) {
    return nextRank > currentRank;
  }
  return next.bestScore > current.bestScore;
}

/** Score 6+ = ok (pewne), 4 = tylko kod+miasto (city_only), inaczej uncertain. */
function pickBestCandidate(payload: NominatimResult[], row: SheetRow): CandidatePickResult {
  const hasStreet = hasRealStreet(row);
  const withCoords = payload.filter((item) => {
    if (!item.lat || !item.lon) {
      return false;
    }
    if (hasStreet && isPostcodeCentroidResult(item)) {
      return false;
    }
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    return !Number.isNaN(lat) && !Number.isNaN(lon);
  });
  if (withCoords.length === 0) {
    return {
      status: 'bad',
      bestScore: -1,
    };
  }

  let best: NominatimResult | undefined;
  let bestScore = -1;
  let bestPostcodeMatched = false;
  let bestStreetMatch = false;
  let bestPostcodePresentInResult = true;
  for (const candidate of withCoords) {
    const evaluation = scoreCandidate(candidate, row);
    if (evaluation.score > bestScore) {
      best = candidate;
      bestScore = evaluation.score;
      bestPostcodeMatched = evaluation.postcodeMatched;
      bestStreetMatch = evaluation.streetMatch;
      bestPostcodePresentInResult = evaluation.postcodePresentInResult;
    }
  }

  if (!best || !bestPostcodeMatched) {
    return {
      status: 'bad',
      bestScore: -1,
    };
  }

  let status: CandidateClassification;
  if (bestScore >= CONFIDENCE_SCORE_THRESHOLD) {
    if (hasStreet && !bestStreetMatch) {
      status = 'uncertain';
    } else if (!bestPostcodePresentInResult) {
      status = 'ok_no_postcode';
    } else {
      status = 'ok';
    }
  } else if (bestScore === 4) {
    if (isVillagePlaceAddress(row)) {
      status = 'ok';
    } else if (isHamletPlaceAddress(row)) {
      status = 'city_only';
    } else {
      status = 'city_only';
    }
  } else {
    status = 'uncertain';
  }
  return {
    bestCandidate: best,
    status,
    bestScore,
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatDurationMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
    seconds,
  ).padStart(2, '0')}`;
}

type CacheEntry = {
  status: 'ok' | 'ok_no_postcode' | 'uncertain' | 'city_only' | 'bad';
  lat?: number;
  lng?: number;
  wojewodztwo?: string;
  updatedAt: string;
};

/** Tylko te pola są zapisywane i odczytywane z pliku cache (bez zbiorka, count itp.). */
const CACHE_ENTRY_KEYS: (keyof CacheEntry)[] = ['status', 'lat', 'lng', 'wojewodztwo', 'updatedAt'];

function toCacheEntry(raw: unknown): CacheEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const status = o.status as CacheEntry['status'];
  const updatedAt = typeof o.updatedAt === 'string' ? o.updatedAt : '';
  if (!status || !updatedAt) return null;
  return {
    status,
    ...(typeof o.lat === 'number' && !Number.isNaN(o.lat) && { lat: o.lat }),
    ...(typeof o.lng === 'number' && !Number.isNaN(o.lng) && { lng: o.lng }),
    ...(typeof o.wojewodztwo === 'string' && { wojewodztwo: o.wojewodztwo }),
    updatedAt,
  };
}

function sanitizeCacheEntryForWrite(entry: CacheEntry): CacheEntry {
  return Object.fromEntries(
    CACHE_ENTRY_KEYS.filter((k) => entry[k] !== undefined).map((k) => [k, entry[k]]),
  ) as CacheEntry;
}

type CachePayload = {
  version: 2;
  entries: Record<string, CacheEntry>;
};

async function loadCache(
  cacheFilePath: string,
  readFileFn: (path: string, encoding: BufferEncoding) => Promise<string>,
): Promise<Record<string, CacheEntry>> {
  try {
    const raw = await readFileFn(cacheFilePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<CachePayload>;
    if (parsed.version !== 2 || !parsed.entries || typeof parsed.entries !== 'object') {
      return {};
    }
    const result: Record<string, CacheEntry> = {};
    for (const [address, entry] of Object.entries(parsed.entries)) {
      const sanitized = toCacheEntry(entry);
      if (sanitized) result[address] = sanitized;
    }
    const migrated = migrateCacheEntries(result).entries;
    return purgeLegacyAbbreviationCacheKeys(migrated).entries;
  } catch {
    return {};
  }
}

const ADDRESS_OVERRIDES_FILENAME = 'phase5-address-overrides.json';

/** Ręczne współrzędne — nie nadpisywać geokodowaniem ani zapisem `bad`. */
function stampAddressOverrideIntoCache(
  cacheEntries: Record<string, CacheEntry>,
  protectedAddresses: Set<string>,
  address: string,
  entry: CacheEntry,
): void {
  protectedAddresses.add(address);
  cacheEntries[address] = entry;
  const canonical = canonicalCacheKeyFromLegacy(address);
  if (canonical && canonical !== address) {
    protectedAddresses.add(canonical);
    cacheEntries[canonical] = entry;
  }
  for (const alias of legacyCacheKeyAliases(address)) {
    protectedAddresses.add(alias);
    cacheEntries[alias] = entry;
  }
}

function setCacheEntryUnlessProtected(
  cacheEntries: Record<string, CacheEntry>,
  protectedAddresses: Set<string>,
  address: string,
  entry: CacheEntry,
): void {
  if (protectedAddresses.has(address)) {
    return;
  }
  cacheEntries[address] = entry;
}

async function loadAddressOverrides(
  cacheFilePath: string,
  readFileFn: (path: string, encoding: BufferEncoding) => Promise<string>,
): Promise<Record<string, CacheEntry>> {
  const overridesPath = join(dirname(cacheFilePath), ADDRESS_OVERRIDES_FILENAME);
  try {
    const raw = await readFileFn(overridesPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, Partial<CacheEntry>>;
    if (!parsed || typeof parsed !== 'object') return {};
    const entries: Record<string, CacheEntry> = {};
    const now = new Date().toISOString();
    for (const [address, entry] of Object.entries(parsed)) {
      if (
        entry &&
        (entry.status === 'ok' || entry.status === 'ok_no_postcode' || entry.status === 'city_only') &&
        typeof entry.lat === 'number' &&
        typeof entry.lng === 'number' &&
        !(entry.lat === 0 && entry.lng === 0)
      ) {
        const sanitized = toCacheEntry({
          status: entry.status,
          lat: entry.lat,
          lng: entry.lng,
          wojewodztwo: entry.wojewodztwo ?? 'Nieznane',
          updatedAt: entry.updatedAt ?? now,
        });
        if (sanitized) entries[address] = sanitized;
      }
    }
    return entries;
  } catch {
    return {};
  }
}

async function saveCache(
  cacheFilePath: string,
  entries: Record<string, CacheEntry>,
  writeFileFn: (path: string, content: string, encoding: BufferEncoding) => Promise<void>,
  mkdirFn: (path: string, options: { recursive: true }) => Promise<unknown>,
  readFileFn: (path: string, encoding: BufferEncoding) => Promise<string>,
): Promise<void> {
  await mkdirFn(dirname(cacheFilePath), { recursive: true });
  const entriesForFile: Record<string, CacheEntry> = {};
  for (const [address, entry] of Object.entries(entries)) {
    entriesForFile[address] = sanitizeCacheEntryForWrite(entry);
  }
  const payload: CachePayload = {
    version: 2,
    entries: entriesForFile,
  };
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  try {
    const existing = await readFileFn(cacheFilePath, 'utf-8');
    if (existing === content) {
      return;
    }
  } catch {
    // brak pliku — zapisz
  }
  await writeFileFn(cacheFilePath, content, 'utf-8');
}

/** Wpis w cache ma pierwszeństwo — bez ponownego geokodowania. */
function applyGeocodingFromCache(
  address: string,
  group: AddressGroup,
  cached: CacheEntry,
  geocoded: GeocodedAddress[],
  geocodedNoPostcode: GeocodedAddress[],
  uncertainGeocoded: GeocodedAddress[],
  cityOnlyGeocoded: GeocodedAddress[],
  rowsBledneAdresy: SheetRow[],
  rowsNiepewneWyniki: SheetRow[],
  groupedNiepewneAdresy: GroupedNiepewnyAdres[],
  groupedBledneAdresy: GroupedBlednyAdres[],
): void {
  const hasCoords = typeof cached.lat === 'number' && typeof cached.lng === 'number';
  const base = {
    address,
    count: group.count,
    zbiorka: aggregateZbiorka(group.rows),
    rows: group.rows,
  };

  if (cached.status === 'ok' && hasCoords) {
    geocoded.push({
      ...base,
      lat: cached.lat!,
      lng: cached.lng!,
      wojewodztwo: cached.wojewodztwo ?? 'Nieznane',
    });
    return;
  }
  if (cached.status === 'ok_no_postcode' && hasCoords) {
    geocodedNoPostcode.push({
      ...base,
      lat: cached.lat!,
      lng: cached.lng!,
      wojewodztwo: cached.wojewodztwo ?? 'Nieznane',
    });
    return;
  }
  if (cached.status === 'uncertain' && hasCoords) {
    uncertainGeocoded.push({
      ...base,
      lat: cached.lat!,
      lng: cached.lng!,
      wojewodztwo: cached.wojewodztwo ?? 'Nieznane',
    });
    rowsNiepewneWyniki.push(...group.rows);
    groupedNiepewneAdresy.push({
      address,
      liczbaWystapien: group.count,
      przykladoweLat: cached.lat!,
      przykladoweLng: cached.lng!,
      wojewodztwo: cached.wojewodztwo ?? 'Nieznane',
    });
    return;
  }
  if (cached.status === 'city_only' && hasCoords) {
    cityOnlyGeocoded.push({
      ...base,
      lat: cached.lat!,
      lng: cached.lng!,
      wojewodztwo: cached.wojewodztwo ?? 'Nieznane',
    });
    return;
  }

  rowsBledneAdresy.push(...group.rows);
  groupedBledneAdresy.push({
    address,
    liczbaWystapien: group.count,
  });
}

export async function executePhase5(
  groupedByAddress: Map<string, AddressGroup>,
  options: ExecutePhase5Options = {},
): Promise<Phase5Result> {
  const fetchFn = options.fetchFn ?? fetch;
  const sleepFn = options.sleepFn ?? defaultSleep;
  const userAgent = options.userAgent ?? 'arkusz-mapa/0.1 (+local-script)';
  const rateLimitMs = options.rateLimitMs ?? 1100;
  const requestTimeoutMs = options.requestTimeoutMs ?? 15000;
  const requestRetries = options.requestRetries ?? 2;
  const batchSize = options.batchSize ?? 20;
  const logger = options.logger;
  const readFileFn =
    options.readFileFn ?? (async (path: string, encoding: BufferEncoding) => readFile(path, encoding));
  const writeFileFn =
    options.writeFileFn ??
    (async (path: string, content: string, encoding: BufferEncoding) => {
      await writeFile(path, content, encoding);
    });
  const mkdirFn = options.mkdirFn ?? mkdir;

  const geocoded: GeocodedAddress[] = [];
  const geocodedNoPostcode: GeocodedAddress[] = [];
  const uncertainGeocoded: GeocodedAddress[] = [];
  const cityOnlyGeocoded: GeocodedAddress[] = [];
  const rowsBledneAdresy: SheetRow[] = [];
  const rowsNiepewneWyniki: SheetRow[] = [];
  const groupedNiepewneAdresy: GroupedNiepewnyAdres[] = [];
  const groupedBledneAdresy: GroupedBlednyAdres[] = [];
  const cacheEntries: Record<string, CacheEntry> = options.cacheFilePath
    ? await loadCache(options.cacheFilePath, readFileFn)
    : {};
  const protectedOverrideAddresses = new Set<string>();
  if (options.cacheFilePath) {
    const overrides = await loadAddressOverrides(options.cacheFilePath, readFileFn);
    const overrideCount = Object.keys(overrides).length;
    if (overrideCount > 0) {
      for (const [address, entry] of Object.entries(overrides)) {
        stampAddressOverrideIntoCache(cacheEntries, protectedOverrideAddresses, address, entry);
      }
      logger?.info?.('Phase 5: applied %d address overrides from %s', overrideCount, ADDRESS_OVERRIDES_FILENAME);
    }
    logger?.info?.(
      'Phase 5: cache file ready — %d entries in memory from %s (CI: Actions cache + opcjonalnie data/phase5-cache.json w repo)',
      Object.keys(cacheEntries).length,
      options.cacheFilePath,
    );
  }

  const groupedEntries = Array.from(groupedByAddress.entries());
  const total = groupedEntries.length;
  const totalBatches = Math.max(1, Math.ceil(total / batchSize));
  const progressStartMs = Date.now();
  const etaLogIntervalMs = 5 * 60 * 1000;
  let lastEtaLogMs = progressStartMs;
  let processedAddresses = 0;
  logger?.info?.(
    'Phase 5: start geocoding %d unique addresses in %d batches (batchSize=%d)',
    total,
    totalBatches,
    batchSize,
  );

  for (let batchStart = 0; batchStart < groupedEntries.length; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, groupedEntries.length);
    logger?.info?.(
      'Phase 5: processing batch %d-%d of %d',
      batchStart + 1,
      batchEnd,
      total,
    );
    const batch = groupedEntries.slice(batchStart, batchEnd);

    for (const [_groupKey, group] of batch) {
      const address = group.address;
      const cached = protectedOverrideAddresses.has(address)
        ? cacheEntries[address]
        : resolveCacheEntry(cacheEntries, address);
      if (cached) {
        applyGeocodingFromCache(
          address,
          group,
          cached,
          geocoded,
          geocodedNoPostcode,
          uncertainGeocoded,
          cityOnlyGeocoded,
          rowsBledneAdresy,
          rowsNiepewneWyniki,
          groupedNiepewneAdresy,
          groupedBledneAdresy,
        );
        logger?.info?.('Phase 5: cache hit for address: %s', address);
        processedAddresses += 1;
        continue;
      }

      if (protectedOverrideAddresses.has(address)) {
        logger?.info?.('Phase 5: skipping geocoding for manual override: %s', address);
        processedAddresses += 1;
        continue;
      }

      try {
        const sampleRow = group.rows[0];
        const queries = buildGeocodingQueries(sampleRow);
        let bestPick: CandidatePickResult | undefined;

        for (const query of queries) {
          const url = buildNominatimUrl(query);
          let response: Response | null = null;
          let lastError: unknown;
          for (let attempt = 0; attempt <= requestRetries; attempt++) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);
            try {
              response = await fetchFn(url, {
                headers: {
                  'User-Agent': userAgent,
                  'Accept-Language': 'pl',
                },
                signal: controller.signal,
              });
              clearTimeout(timeoutId);
              break;
            } catch (err) {
              clearTimeout(timeoutId);
              lastError = err;
              if (attempt < requestRetries) {
                logger?.warn?.(
                  'Phase 5: request failed for address %s (attempt %d/%d), retrying in %d ms',
                  address,
                  attempt + 1,
                  requestRetries + 1,
                  rateLimitMs,
                );
                await sleepFn(rateLimitMs);
              }
            }
          }

          if (!response) {
            logger?.warn?.('Phase 5: all attempts failed for address: %s (%s)', address, String(lastError));
            await sleepFn(rateLimitMs);
            continue;
          }

          if (!response.ok) {
            await sleepFn(rateLimitMs);
            continue;
          }

          const payload = (await response.json()) as NominatimResult[];
          const picked = pickBestCandidate(payload, sampleRow);
          if (picked.status === 'bad') {
            await sleepFn(rateLimitMs);
            continue;
          }
          if (isBetterPick(picked, bestPick)) {
            bestPick = picked;
          }
          if (picked.status === 'ok') {
            break;
          }
          await sleepFn(rateLimitMs);
        }

        if (bestPick && bestPick.bestCandidate && bestPick.status !== 'bad') {
          const best = bestPick.bestCandidate;
          const lat = Number(best.lat);
          const lng = Number(best.lon);
          if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
            const wojewodztwo = extractVoivodeship(best);
            const geocodedItem: GeocodedAddress = {
              address,
              count: group.count,
              lat,
              lng,
              wojewodztwo,
              zbiorka: aggregateZbiorka(group.rows),
              rows: group.rows,
            };
            if (bestPick.status === 'ok') {
              geocoded.push(geocodedItem);
            } else if (bestPick.status === 'ok_no_postcode') {
              geocodedNoPostcode.push(geocodedItem);
            } else if (bestPick.status === 'city_only') {
              cityOnlyGeocoded.push(geocodedItem);
            } else {
              uncertainGeocoded.push(geocodedItem);
              rowsNiepewneWyniki.push(...group.rows);
              groupedNiepewneAdresy.push({
                address,
                liczbaWystapien: group.count,
                przykladoweLat: lat,
                przykladoweLng: lng,
                wojewodztwo,
              });
            }
            setCacheEntryUnlessProtected(cacheEntries, protectedOverrideAddresses, address, {
              status: bestPick.status,
              lat,
              lng,
              wojewodztwo,
              updatedAt: new Date().toISOString(),
            });
          } else {
            rowsBledneAdresy.push(...group.rows);
            groupedBledneAdresy.push({
              address,
              liczbaWystapien: group.count,
            });
            setCacheEntryUnlessProtected(cacheEntries, protectedOverrideAddresses, address, {
              status: 'bad',
              updatedAt: new Date().toISOString(),
            });
          }
        } else {
          rowsBledneAdresy.push(...group.rows);
          groupedBledneAdresy.push({
            address,
            liczbaWystapien: group.count,
          });
          setCacheEntryUnlessProtected(cacheEntries, protectedOverrideAddresses, address, {
            status: 'bad',
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        rowsBledneAdresy.push(...group.rows);
        groupedBledneAdresy.push({
          address,
          liczbaWystapien: group.count,
        });
        setCacheEntryUnlessProtected(cacheEntries, protectedOverrideAddresses, address, {
          status: 'bad',
          updatedAt: new Date().toISOString(),
        });
        logger?.warn?.('Phase 5: geocoding failed for address: %s (%s)', address, String(error));
      }

      processedAddresses += 1;
      const processed = processedAddresses;
      const remaining = Math.max(0, total - processed);
      const nowMs = Date.now();
      if (processed > 0 && remaining > 0 && nowMs - lastEtaLogMs >= etaLogIntervalMs) {
        const elapsedMs = nowMs - progressStartMs;
        const avgMsPerAddress = elapsedMs / processed;
        const etaMs = avgMsPerAddress * remaining;
        logger?.info?.(
          'Phase 5: progress %d/%d, ETA ~%s',
          processed,
          total,
          formatDurationMs(etaMs),
        );
        lastEtaLogMs = nowMs;
      }

      await sleepFn(rateLimitMs);
    }

    if (options.cacheFilePath) {
      await saveCache(options.cacheFilePath, cacheEntries, writeFileFn, mkdirFn, readFileFn);
      const geocodedUniqueAddresses = geocoded.length;
      const geocodedNoPostcodeUniqueAddresses = geocodedNoPostcode.length;
      const uncertainUniqueAddresses = uncertainGeocoded.length;
      const cityOnlyUniqueAddresses = cityOnlyGeocoded.length;
      const badUniqueAddresses = Math.max(
        0,
        batchEnd -
          geocodedUniqueAddresses -
          geocodedNoPostcodeUniqueAddresses -
          uncertainUniqueAddresses -
          cityOnlyUniqueAddresses,
      );
      logger?.info?.(
        'Phase 5: cache saved after batch (%d entries). Progress: ok=%d, ok_no_postcode=%d, uncertain=%d, city_only=%d unique, processed=%d/%d',
        Object.keys(cacheEntries).length,
        geocodedUniqueAddresses,
        geocodedNoPostcodeUniqueAddresses,
        uncertainUniqueAddresses,
        cityOnlyUniqueAddresses,
        batchEnd,
        total,
      );
      logger?.info?.(
        'Phase 5: current bad unique addresses estimate=%d',
        badUniqueAddresses,
      );
    }
  }

  const geocodedUniqueAddresses = geocoded.length;
  const geocodedNoPostcodeUniqueAddresses = geocodedNoPostcode.length;
  const uncertainUniqueAddresses = uncertainGeocoded.length;
  const cityOnlyUniqueAddresses = cityOnlyGeocoded.length;
  const badUniqueAddresses = Math.max(
    0,
    total -
      geocodedUniqueAddresses -
      geocodedNoPostcodeUniqueAddresses -
      uncertainUniqueAddresses -
      cityOnlyUniqueAddresses,
  );
  const badAddressRows = rowsBledneAdresy.length;
  logger?.info?.(
    'Phase 5: done. unique=%d, batches=%d, ok=%d, ok_no_postcode=%d, uncertain=%d, city_only=%d, bad=%d, badRows=%d',
    total,
    totalBatches,
    geocodedUniqueAddresses,
    geocodedNoPostcodeUniqueAddresses,
    uncertainUniqueAddresses,
    cityOnlyUniqueAddresses,
    badUniqueAddresses,
    badAddressRows,
  );
  return {
    geocoded,
    geocodedNoPostcode,
    uncertainGeocoded,
    cityOnlyGeocoded,
    rowsBledneAdresy,
    rowsNiepewneWyniki,
    groupedNiepewneAdresy,
    groupedBledneAdresy,
    totalUniqueAddresses: total,
    totalBatches,
    geocodedUniqueAddresses,
    geocodedNoPostcodeUniqueAddresses,
    uncertainUniqueAddresses,
    cityOnlyUniqueAddresses,
    badUniqueAddresses,
    badAddressRows,
  };
}
