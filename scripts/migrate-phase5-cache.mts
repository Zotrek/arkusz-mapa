#!/usr/bin/env node
/**
 * Jednorazowa migracja data/phase5-cache.json:
 * - scala legacy klucze z powtórzonym numerem (… 33 33 → … 33)
 * - preferuje status ok nad uncertain
 *
 * Uruchom: npx tsx scripts/migrate-phase5-cache.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrateCacheEntries, purgeLegacyAbbreviationCacheKeys } from '../src/cacheMigrate.js';

const CACHE_PATH = join(import.meta.dirname, '../data/phase5-cache.json');

const raw = JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as {
  version: number;
  entries: Record<string, unknown>;
};

if (raw.version !== 2 || !raw.entries) {
  throw new Error('Nieobsługiwany format cache');
}

const before = Object.keys(raw.entries).length;
const stats = (entries: Record<string, { status?: string }>) => {
  const counts: Record<string, number> = {};
  for (const e of Object.values(entries)) {
    const s = e.status ?? 'brak';
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return counts;
};

const beforeStats = stats(raw.entries as Record<string, { status?: string }>);
const { entries: merged, migrated, removedLegacyKeys } = migrateCacheEntries(
  raw.entries as Record<string, import('../src/cacheMigrate.js').CacheEntry>,
);
const { entries, removed: removedAbbrevKeys } = purgeLegacyAbbreviationCacheKeys(merged);

writeFileSync(CACHE_PATH, JSON.stringify({ version: 2, entries }, null, 2), 'utf8');

const after = Object.keys(entries).length;
const afterStats = stats(entries);

console.log('Migracja phase5-cache.json');
console.log(`  wpisy: ${before} → ${after}`);
console.log(`  scalono: ${migrated}, usunięto legacy numer: ${removedLegacyKeys.length}`);
console.log(`  usunięto legacy skróty: ${removedAbbrevKeys.length}`);
console.log('  przed:', beforeStats);
console.log('  po:   ', afterStats);
if (removedLegacyKeys.length > 0) {
  console.log('  usunięte klucze legacy (próbka):');
  removedLegacyKeys.slice(0, 10).forEach((k) => console.log(`    - ${k}`));
}
