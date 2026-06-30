#!/usr/bin/env node
/**
 * Przywraca status i współrzędne z git HEAD dla wpisów obecnie bad w cache.
 * Uruchom: npx tsx scripts/restore-bad-from-morning.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { buildCanonicalCacheKey } from '../src/cacheKeyNormalize.js';
import {
  canonicalCacheKeyFromLegacy,
  canonicalCacheKeyFromLegacyAddress,
  legacyCacheKeyAliases,
  legacyDuplicateNumberCacheKey,
  type CacheEntry,
} from '../src/cacheMigrate.js';

const CACHE_PATH = join(import.meta.dirname, '../data/phase5-cache.json');

type CachePayload = { version: number; entries: Record<string, CacheEntry> };

function allLookupKeys(key: string): string[] {
  const keys = new Set<string>([key]);
  for (const alias of legacyCacheKeyAliases(key)) {
    keys.add(alias);
  }
  for (const candidate of [
    legacyDuplicateNumberCacheKey(key),
    canonicalCacheKeyFromLegacy(key),
    buildCanonicalCacheKey(key),
    canonicalCacheKeyFromLegacyAddress(key),
  ]) {
    if (candidate) {
      keys.add(candidate);
    }
  }
  return [...keys];
}

function findMorningEntry(
  morning: Record<string, CacheEntry>,
  key: string,
): { key: string; entry: CacheEntry } | null {
  let fallback: { key: string; entry: CacheEntry } | null = null;
  for (const alias of allLookupKeys(key)) {
    const hit = morning[alias];
    if (!hit) {
      continue;
    }
    if (hit.lat != null && hit.lng != null) {
      return { key: alias, entry: hit };
    }
    fallback ??= { key: alias, entry: hit };
  }
  return fallback;
}

function targetKeyForRestore(key: string): string {
  return (
    buildCanonicalCacheKey(key) ??
    canonicalCacheKeyFromLegacy(key) ??
    canonicalCacheKeyFromLegacyAddress(key) ??
    key
  );
}

const morningRaw = execSync('git show HEAD:data/phase5-cache.json', { encoding: 'utf8' });
const morning = (JSON.parse(morningRaw) as CachePayload).entries;
const cache = JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as CachePayload;

const badKeys = Object.keys(cache.entries).filter((key) => cache.entries[key]?.status === 'bad');
const restored: string[] = [];
const removed: string[] = [];
const skipped: string[] = [];

for (const badKey of badKeys) {
  const morningHit = findMorningEntry(morning, badKey);
  if (!morningHit || morningHit.entry.lat == null || morningHit.entry.lng == null) {
    skipped.push(badKey);
    continue;
  }

  const canonical = targetKeyForRestore(badKey);
  cache.entries[canonical] = {
    status: morningHit.entry.status,
    lat: morningHit.entry.lat,
    lng: morningHit.entry.lng,
    wojewodztwo: morningHit.entry.wojewodztwo,
    updatedAt: morningHit.entry.updatedAt ?? new Date().toISOString(),
  };
  restored.push(`${badKey} → ${canonical} (${morningHit.entry.status})`);

  for (const alias of allLookupKeys(badKey)) {
    if (alias === canonical) {
      continue;
    }
    const current = cache.entries[alias];
    if (current?.status === 'bad') {
      delete cache.entries[alias];
      removed.push(alias);
    }
  }
}

writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');

const stats: Record<string, number> = {};
for (const entry of Object.values(cache.entries)) {
  stats[entry.status] = (stats[entry.status] ?? 0) + 1;
}

console.log('Przywrócono z rana (HEAD):');
for (const line of restored) {
  console.log(' ', line);
}
if (removed.length > 0) {
  console.log('\nUsunięto duplikaty bad:');
  for (const key of removed) {
    console.log(' ', key);
  }
}
if (skipped.length > 0) {
  console.log('\nPominięto (brak coords rano):');
  for (const key of skipped) {
    console.log(' ', key);
  }
}
console.log('\nCache po restore:', Object.keys(cache.entries).length, 'wpisów');
console.log('Status:', stats);
