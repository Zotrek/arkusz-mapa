/**
 * Migracja i aliasy kluczy cache geokodowania (np. stary klucz z powtórzonym numerem budynku).
 */

import {
  buildCanonicalCacheKey,
  canonicalCacheKeyFromLegacyAddress,
  legacyStreetAbbrevCacheKeyVariants,
  parseCacheAddressKey,
} from './cacheKeyNormalize.js';
import { legacyCityNameVariants } from './cityNormalize.js';
import { buildAddress } from './sheets.js';
import { stripPolishDiacritics } from './polishText.js';

export type CacheEntryStatus = 'ok' | 'ok_no_postcode' | 'uncertain' | 'city_only' | 'bad';

export type CacheEntry = {
  status: CacheEntryStatus;
  lat?: number;
  lng?: number;
  wojewodztwo?: string;
  updatedAt: string;
};

const STATUS_RANK: Record<CacheEntryStatus, number> = {
  ok: 5,
  ok_no_postcode: 4,
  city_only: 3,
  uncertain: 2,
  bad: 1,
};

/** Klucz ze starym formatem: „… 33 33” → kanoniczny „… 33”. */
export function canonicalCacheKeyFromLegacy(address: string): string | null {
  const match = address.match(/^(.+?)\s(\d+[a-zA-Z]?)\s\2$/u);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return `${match[1]} ${match[2]}`;
}

/** Kanoniczny klucz „… 33” → stary alias „… 33 33”. */
export function legacyDuplicateNumberCacheKey(address: string): string | null {
  const match = address.match(/^(.+\s)(\d+[a-zA-Z]?)$/u);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return `${match[1]}${match[2]} ${match[2]}`;
}

export function isBetterCacheEntry(incoming: CacheEntry, existing: CacheEntry): boolean {
  const rankIncoming = STATUS_RANK[incoming.status] ?? 0;
  const rankExisting = STATUS_RANK[existing.status] ?? 0;
  if (rankIncoming !== rankExisting) {
    return rankIncoming > rankExisting;
  }
  return (incoming.updatedAt ?? '') >= (existing.updatedAt ?? '');
}

export function mergeCacheEntry(
  existing: CacheEntry | undefined,
  incoming: CacheEntry,
): CacheEntry {
  if (!existing) {
    return incoming;
  }
  return isBetterCacheEntry(incoming, existing) ? incoming : existing;
}

export function cacheEntryStatusRank(status: CacheEntryStatus): number {
  return STATUS_RANK[status] ?? 0;
}

function canonicalCacheKeyCandidates(key: string): string[] {
  const candidates = new Set<string>();
  const fromAddress = canonicalCacheKeyFromLegacyAddress(key);
  if (fromAddress) {
    candidates.add(fromAddress);
  }
  const fromDup = canonicalCacheKeyFromLegacy(key);
  if (fromDup) {
    candidates.add(fromDup);
  }
  const fromCity = canonicalCacheKeyFromNormalizedCity(key);
  if (fromCity) {
    candidates.add(fromCity);
  }
  return [...candidates].filter((candidate) => candidate !== key);
}

/**
 * Scala wpisy pod kanonicznymi kluczami i usuwa legacy (miasto, ulica, numer).
 * Lepszy status wygrywa (ok > uncertain).
 */
export function migrateCacheEntries(entries: Record<string, CacheEntry>): {
  entries: Record<string, CacheEntry>;
  migrated: number;
  removedLegacyKeys: string[];
} {
  const result: Record<string, CacheEntry> = { ...entries };
  const legacyKeysToRemove = new Set<string>();
  let migrated = 0;

  for (const [key, entry] of Object.entries(entries)) {
    for (const canonical of canonicalCacheKeyCandidates(key)) {
      result[canonical] = mergeCacheEntry(result[canonical], entry);
      legacyKeysToRemove.add(key);
      migrated += 1;
      break;
    }
  }

  for (const key of Object.keys(result)) {
    const legacyKey = legacyDuplicateNumberCacheKey(key);
    if (!legacyKey || legacyKey === key || !result[legacyKey]) {
      continue;
    }
    const before = result[key];
    result[key] = mergeCacheEntry(result[key], result[legacyKey]!);
    if (result[key] !== before) {
      migrated += 1;
    }
    legacyKeysToRemove.add(legacyKey);
  }

  for (const key of legacyKeysToRemove) {
    delete result[key];
  }

  return {
    entries: result,
    migrated,
    removedLegacyKeys: [...legacyKeysToRemove],
  };
}

/** Klucz ze starym zapisem miasta → kanoniczny (Gdańsk, Świętyszów, Łódź). */
export function canonicalCacheKeyFromNormalizedCity(address: string): string | null {
  const canonical = buildCanonicalCacheKey(address);
  if (!canonical || canonical === address) {
    return null;
  }
  return canonical;
}

/** Klucz ze starym zapisem miasta (Gdansk, Łódż) → kanoniczny klucz. */
export function canonicalCacheKeyFromCityTypo(address: string): string | null {
  return canonicalCacheKeyFromNormalizedCity(address);
}

/** Kanoniczny klucz → legacy warianty miasta w kluczu cache. */
export function legacyCityCacheKeyVariants(address: string): string[] {
  const parts = parseCacheAddressKey(address);
  if (!parts) {
    return [];
  }

  const canonical = buildAddress(parts);
  const variants: string[] = [];

  for (const legacyCity of legacyCityNameVariants(parts.miasto)) {
    variants.push(buildAddress({ ...parts, miasto: legacyCity }));
  }

  const asciiCity = stripPolishDiacritics(parts.miasto);
  if (asciiCity !== parts.miasto) {
    variants.push(buildAddress({ ...parts, miasto: asciiCity }));
  }

  return [...new Set(variants)].filter((key) => key !== canonical);
}

/** Wszystkie legacy aliasy klucza cache (miasto, ulica, numer). */
export function legacyCacheKeyAliases(address: string): string[] {
  const aliases = new Set<string>();

  const dup = legacyDuplicateNumberCacheKey(address);
  if (dup) {
    aliases.add(dup);
  }

  for (const cityLegacy of legacyCityCacheKeyVariants(address)) {
    aliases.add(cityLegacy);
    const cityDup = legacyDuplicateNumberCacheKey(cityLegacy);
    if (cityDup) {
      aliases.add(cityDup);
    }
  }

  for (const streetLegacy of legacyStreetAbbrevCacheKeyVariants(address)) {
    aliases.add(streetLegacy);
    const streetDup = legacyDuplicateNumberCacheKey(streetLegacy);
    if (streetDup) {
      aliases.add(streetDup);
    }
    for (const cityLegacy of legacyCityCacheKeyVariants(streetLegacy)) {
      aliases.add(cityLegacy);
      const comboDup = legacyDuplicateNumberCacheKey(cityLegacy);
      if (comboDup) {
        aliases.add(comboDup);
      }
    }
  }

  aliases.delete(address);
  return [...aliases];
}

/** Kanoniczny klucz → stary alias z literówką miasta. */
export function legacyCityTypoCacheKey(address: string): string | null {
  const variants = legacyCityCacheKeyVariants(address);
  return variants[0] ?? null;
}

/**
 * Usuwa legacy klucze tylko gdy kanoniczny wpis już istnieje z lepszym statusem.
 * (Po migrateCacheEntries zwykle nie jest potrzebne.)
 */
export function purgeLegacyAbbreviationCacheKeys(entries: Record<string, CacheEntry>): {
  entries: Record<string, CacheEntry>;
  removed: string[];
} {
  const result: Record<string, CacheEntry> = { ...entries };
  const removed: string[] = [];

  for (const [key, entry] of Object.entries(entries)) {
    const canonical = buildCanonicalCacheKey(key);
    if (!canonical || canonical === key) {
      continue;
    }
    const canonicalEntry = result[canonical];
    if (
      canonicalEntry &&
      isBetterCacheEntry(canonicalEntry, entry) &&
      (entry.status === 'uncertain' || entry.status === 'city_only' || entry.status === 'bad')
    ) {
      delete result[key];
      removed.push(key);
    }
  }

  return { entries: result, removed };
}

/** Odczyt cache z fallbackiem na legacy aliasy klucza. */
export function resolveCacheEntry(
  entries: Record<string, CacheEntry>,
  address: string,
): CacheEntry | undefined {
  const direct = entries[address];
  if (direct) {
    return direct;
  }

  const fromDuplicateNumber = canonicalCacheKeyFromLegacy(address);
  if (fromDuplicateNumber) {
    const hit = entries[fromDuplicateNumber];
    if (hit) {
      return hit;
    }
  }

  for (const alias of legacyCacheKeyAliases(address)) {
    const hit = entries[alias];
    if (hit) {
      return hit;
    }
  }

  return undefined;
}

export { buildCanonicalCacheKey, canonicalCacheKeyFromLegacyAddress };
