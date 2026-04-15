/**
 * Faza 5: geokodowanie przez Nominatim + wyznaczanie błędnych adresów.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AddressGroup } from './phase3.js';
import type { SheetRow } from './sheets.js';

interface NominatimResult {
  lat?: string;
  lon?: string;
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
  retryBadCache?: boolean;
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
  return normalize(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Prefiksy ulic do ujednolicenia (ul., os., al. itd.) – porównanie i zapytania. P6. */
const STREET_PREFIX_PATTERN = /^\s*(ul\.?|ulica|os\.?|osiedle|al\.?|aleja|alei|rondo|r\.|pl\.?|plac|bulw\.?|bulwar|skwer|park|droga|dl\.?)\s+/iu;

/** Zwraca nazwę ulicy bez dopisku (ul., os., al. itd.) – do zapytań i porównań. */
export function stripStreetPrefix(street: string | undefined): string {
  const s = normalize(street);
  return s.replace(STREET_PREFIX_PATTERN, '').trim();
}

/** Ulica znormalizowana do porównania: bez diakrytyków, bez prefiksu ul./os./al. */
function normalizeStreetForCompare(street: string | undefined): string {
  const base = normalizeForCompare(street);
  const withoutPrefix = base.replace(
    /^(ul|ulica|os|osiedle|al|aleja|alei|rondo|pl|plac|bulwar|skwer|park|droga|dl)\s+/,
    '',
  );
  return withoutPrefix.trim();
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

function normalizeForStrictCityCompare(value: string | undefined): string {
  const trimmed = normalize(value);
  const withoutParenthesis = trimmed.replace(/\s*\([^)]*\)\s*$/gu, '').trim();
  return withoutParenthesis
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
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

function normalizeCityForGeocoding(city: string): string {
  let normalized = normalize(city);
  normalized = normalized.replace(/\s*\([^)]*\)\s*$/gu, '').trim();
  if (normalized.toUpperCase() === 'WROCŁAW-FABRYCZNA') {
    return 'Wrocław';
  }
  return normalized;
}

export function buildGeocodingQuery(row: SheetRow): string {
  const kod = normalize(row.kodPocztowy);
  const miasto = normalizeCityForGeocoding(row.miasto);
  const ulica = normalize(row.ulica);
  const ulicaBezPrefiksu = stripStreetPrefix(ulica) || ulica;
  const numer = stripAfterSlash(row.numerBudynku);

  const parts: string[] = [kod, miasto];
  if (!isMissingStreet(ulica)) {
    parts.push(ulicaBezPrefiksu);
  }
  parts.push(numer);

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

export function buildGeocodingQueries(row: SheetRow): string[] {
  const kod = normalize(row.kodPocztowy);
  const miasto = normalizeCityForGeocoding(row.miasto);
  const ulica = normalize(row.ulica);
  const numer = stripAfterSlash(row.numerBudynku);
  const gmina = normalizeGmina(row.gmina);
  const missingStreet = isMissingStreet(ulica);

  const queries: string[] = [];

  if (missingStreet) {
    pushQuery(queries, `${kod} ${miasto} ${numer}, Polska`);
    pushQuery(queries, `${kod} ${gmina} ${numer}, Polska`);
    pushQuery(queries, `${kod} ${miasto}, Polska`);
    pushQuery(queries, `${kod} ${gmina}, Polska`);
  } else {
    const ulicaBezPrefiksu = stripStreetPrefix(ulica) || ulica;
    // Warianty bez kodu na początku – Nominatim lepiej zwraca budynki przy "miasto ulica numer" / "ulica numer miasto". Kod i tak weryfikujemy w scoreCandidate.
    pushQuery(queries, `${miasto} ${ulicaBezPrefiksu} ${numer}, Polska`);
    pushQuery(queries, `${ulicaBezPrefiksu} ${numer} ${miasto}, Polska`);
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
  }

  // Dodatkowy fallback - nadal z kodem pocztowym, żeby nie "uciekać" do złego regionu.
  pushQuery(queries, `${kod} ${row.address}, Polska`);
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

function shouldRetrySuspiciousCacheEntry(entry: CacheEntry): boolean {
  if (entry.status === 'bad') {
    return false;
  }
  const woj = normalize(entry.wojewodztwo).toLowerCase();
  return woj.startsWith('powiat ') || woj.startsWith('gmina ') || woj.length === 0;
}

function getCandidateLocality(result: NominatimResult): string {
  return (
    result.address?.city ??
    result.address?.town ??
    result.address?.village ??
    result.address?.municipality ??
    result.address?.hamlet ??
    result.address?.suburb ??
    result.address?.county ??
    ''
  );
}

function getCandidateStreet(result: NominatimResult): string {
  return result.address?.road ?? result.address?.pedestrian ?? '';
}

const CONFIDENCE_SCORE_THRESHOLD = 6;

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
  const expectedCity = normalizeForStrictCityCompare(normalizeCityForGeocoding(row.miasto));
  const expectedStreet = normalizeStreetForCompare(row.ulica);
  const expectedNumber = normalizeForCompare(stripAfterSlash(row.numerBudynku));
  const hasStreet = !isMissingStreet(row.ulica);

  const candidatePostcode = normalizePostcodeForCompare(result.address?.postcode);
  const candidateCity = normalizeForStrictCityCompare(getCandidateLocality(result));
  const candidateStreet = normalizeStreetForCompare(getCandidateStreet(result));
  const candidateNumber = normalizeForCompare(stripAfterSlash(result.address?.house_number));

  const cityMatch = Boolean(expectedCity && candidateCity && expectedCity === candidateCity);
  const streetMatch = Boolean(
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
        score: 4 + (streetMatch ? 3 : 0),
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
}

/** Score 6+ = ok (pewne), 4 = tylko kod+miasto (city_only), inaczej uncertain. */
function pickBestCandidate(payload: NominatimResult[], row: SheetRow): CandidatePickResult {
  const withCoords = payload.filter((item) => {
    if (!item.lat || !item.lon) {
      return false;
    }
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    return !Number.isNaN(lat) && !Number.isNaN(lon);
  });
  if (withCoords.length === 0) {
    return {
      status: 'bad',
    };
  }

  const hasStreet = !isMissingStreet(row.ulica);
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
    status = 'city_only';
  } else {
    status = 'uncertain';
  }
  return {
    bestCandidate: best,
    status,
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
    return result;
  } catch {
    return {};
  }
}

const ADDRESS_OVERRIDES_FILENAME = 'phase5-address-overrides.json';

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
  await writeFileFn(cacheFilePath, JSON.stringify(payload, null, 2), 'utf-8');
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
  const retryBadCache = options.retryBadCache ?? true;
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
  if (options.cacheFilePath) {
    const overrides = await loadAddressOverrides(options.cacheFilePath, readFileFn);
    const overrideCount = Object.keys(overrides).length;
    if (overrideCount > 0) {
      Object.assign(cacheEntries, overrides);
      logger?.info?.('Phase 5: applied %d address overrides from %s', overrideCount, ADDRESS_OVERRIDES_FILENAME);
    }
    logger?.info?.(
      'Phase 5: cache file ready — %d entries in memory from %s (GitHub Actions: sprawdź krok „Przywróć cache” jeśli 0 przy drugim runie)',
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

    for (const [address, group] of batch) {
      const cached = cacheEntries[address];
      if (cached) {
        if (shouldRetrySuspiciousCacheEntry(cached)) {
          logger?.info?.('Phase 5: retrying suspicious cache entry for address: %s', address);
        } else if (cached.status === 'ok' && typeof cached.lat === 'number' && typeof cached.lng === 'number') {
          geocoded.push({
            address,
            count: group.count,
            lat: cached.lat,
            lng: cached.lng,
            wojewodztwo: cached.wojewodztwo ?? 'Nieznane',
            zbiorka: aggregateZbiorka(group.rows),
            rows: group.rows,
          });
        } else if (
          cached.status === 'ok_no_postcode' &&
          typeof cached.lat === 'number' &&
          typeof cached.lng === 'number'
        ) {
          geocodedNoPostcode.push({
            address,
            count: group.count,
            lat: cached.lat,
            lng: cached.lng,
            wojewodztwo: cached.wojewodztwo ?? 'Nieznane',
            zbiorka: aggregateZbiorka(group.rows),
            rows: group.rows,
          });
        } else if (
          cached.status === 'uncertain' &&
          typeof cached.lat === 'number' &&
          typeof cached.lng === 'number'
        ) {
          uncertainGeocoded.push({
            address,
            count: group.count,
            lat: cached.lat,
            lng: cached.lng,
            wojewodztwo: cached.wojewodztwo ?? 'Nieznane',
            zbiorka: aggregateZbiorka(group.rows),
            rows: group.rows,
          });
          rowsNiepewneWyniki.push(...group.rows);
          groupedNiepewneAdresy.push({
            address,
            liczbaWystapien: group.count,
            przykladoweLat: cached.lat,
            przykladoweLng: cached.lng,
            wojewodztwo: cached.wojewodztwo ?? 'Nieznane',
          });
        } else if (
          cached.status === 'city_only' &&
          typeof cached.lat === 'number' &&
          typeof cached.lng === 'number'
        ) {
          cityOnlyGeocoded.push({
            address,
            count: group.count,
            lat: cached.lat,
            lng: cached.lng,
            wojewodztwo: cached.wojewodztwo ?? 'Nieznane',
            zbiorka: aggregateZbiorka(group.rows),
            rows: group.rows,
          });
        } else if (!retryBadCache) {
          rowsBledneAdresy.push(...group.rows);
          groupedBledneAdresy.push({
            address,
            liczbaWystapien: group.count,
          });
        } else {
          logger?.info?.('Phase 5: retrying cached bad address: %s', address);
          // kontynuuj do ponownego geokodowania
          // (nie robimy "continue")
          const forceRetry = true;
          if (forceRetry) {
            // no-op
          }
        }

        if (
          !shouldRetrySuspiciousCacheEntry(cached) &&
          (cached.status === 'ok' ||
            cached.status === 'ok_no_postcode' ||
            cached.status === 'uncertain' ||
            cached.status === 'city_only' ||
            !retryBadCache)
        ) {
          logger?.info?.('Phase 5: cache hit for address: %s', address);
          processedAddresses += 1;
          continue;
        }
      }

      try {
        const sampleRow = group.rows[0];
        const queries = buildGeocodingQueries(sampleRow);
        let success = false;

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
          const best = picked.bestCandidate;
          if (!best || !best.lat || !best.lon || picked.status === 'bad') {
            await sleepFn(rateLimitMs);
            continue;
          }

          const lat = Number(best.lat);
          const lng = Number(best.lon);
          if (Number.isNaN(lat) || Number.isNaN(lng)) {
            await sleepFn(rateLimitMs);
            continue;
          }

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
          if (picked.status === 'ok') {
            geocoded.push(geocodedItem);
          } else if (picked.status === 'ok_no_postcode') {
            geocodedNoPostcode.push(geocodedItem);
          } else if (picked.status === 'city_only') {
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
          cacheEntries[address] = {
            status: picked.status,
            lat,
            lng,
            wojewodztwo,
            updatedAt: new Date().toISOString(),
          };
          success = true;
          break;
        }

        if (!success) {
          rowsBledneAdresy.push(...group.rows);
          groupedBledneAdresy.push({
            address,
            liczbaWystapien: group.count,
          });
          cacheEntries[address] = {
            status: 'bad',
            updatedAt: new Date().toISOString(),
          };
        }
      } catch (error) {
        rowsBledneAdresy.push(...group.rows);
        groupedBledneAdresy.push({
          address,
          liczbaWystapien: group.count,
        });
        cacheEntries[address] = {
          status: 'bad',
          updatedAt: new Date().toISOString(),
        };
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
      await saveCache(options.cacheFilePath, cacheEntries, writeFileFn, mkdirFn);
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
