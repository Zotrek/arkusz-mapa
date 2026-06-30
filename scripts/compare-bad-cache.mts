#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import {
  buildCanonicalCacheKey,
  canonicalCacheKeyFromLegacyAddress,
} from '../src/cacheKeyNormalize.js';
import {
  legacyCacheKeyAliases,
  legacyDuplicateNumberCacheKey,
  canonicalCacheKeyFromLegacy,
} from '../src/cacheMigrate.js';

type CacheEntry = {
  status: string;
  lat?: number;
  lng?: number;
  wojewodztwo?: string;
  updatedAt?: string;
};

const morningRaw = execSync('git show HEAD:data/phase5-cache.json', { encoding: 'utf8' });
const morning = (JSON.parse(morningRaw) as { entries: Record<string, CacheEntry> }).entries;
const now = (
  JSON.parse(readFileSync('data/phase5-cache.json', 'utf8')) as { entries: Record<string, CacheEntry> }
).entries;

function stats(entries: Record<string, CacheEntry>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of Object.values(entries)) {
    counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  }
  return counts;
}

function coords(entry: CacheEntry): string {
  if (entry.lat == null || entry.lng == null) {
    return '(brak coords)';
  }
  return `(${entry.lat}, ${entry.lng})`;
}

function allAliases(key: string): string[] {
  const aliases = new Set<string>([key]);
  for (const alias of legacyCacheKeyAliases(key)) {
    aliases.add(alias);
  }
  const dup = legacyDuplicateNumberCacheKey(key);
  if (dup) {
    aliases.add(dup);
  }
  const leg = canonicalCacheKeyFromLegacy(key);
  if (leg) {
    aliases.add(leg);
  }
  const canon = buildCanonicalCacheKey(key);
  if (canon) {
    aliases.add(canon);
  }
  const fromLeg = canonicalCacheKeyFromLegacyAddress(key);
  if (fromLeg) {
    aliases.add(fromLeg);
  }
  return [...aliases];
}

function findIn(
  entries: Record<string, CacheEntry>,
  key: string,
): { key: string; entry: CacheEntry } | null {
  for (const alias of allAliases(key)) {
    const hit = entries[alias];
    if (hit) {
      return { key: alias, entry: hit };
    }
  }
  return null;
}

const morningBad = Object.entries(morning)
  .filter(([, entry]) => entry.status === 'bad')
  .map(([key]) => key)
  .sort();
const nowBad = Object.entries(now)
  .filter(([, entry]) => entry.status === 'bad')
  .map(([key]) => key)
  .sort();

console.log('=== STATYSTYKI ===');
console.log('Rano (HEAD):', stats(morning), 'total', Object.keys(morning).length);
console.log('Teraz:      ', stats(now), 'total', Object.keys(now).length);
console.log(`bad rano: ${morningBad.length} | bad teraz: ${nowBad.length}`);

console.log('\n=== BAD TERAZ → stan RANO (przez aliasy) ===');
for (const key of nowBad) {
  const hit = findIn(morning, key);
  const canon = buildCanonicalCacheKey(key) ?? key;
  console.log('---');
  console.log('TERAZ bad:', key);
  console.log('  kanoniczny:', canon !== key ? canon : '(ten sam)');
  if (hit) {
    console.log('  RANO pod kluczem:', hit.key);
    console.log('  RANO status:', hit.entry.status, coords(hit.entry));
    console.log('  RANO updated:', hit.entry.updatedAt?.slice(0, 10) ?? '?');
  } else {
    console.log('  RANO: brak (ani klucz, ani aliasy)');
  }
}

console.log('\n=== BAD RANO → stan TERAZ ===');
for (const key of morningBad) {
  const hit = findIn(now, key);
  console.log('---');
  console.log('RANO bad:', key);
  if (hit) {
    console.log('  TERAZ pod kluczem:', hit.key);
    console.log('  TERAZ status:', hit.entry.status, coords(hit.entry));
  } else {
    console.log('  TERAZ: brak');
  }
}

console.log('\n=== PODSUMOWANIE ===');
let okMorning = 0;
let badMorning = 0;
let missingMorning = 0;
for (const key of nowBad) {
  const hit = findIn(morning, key);
  if (!hit) {
    missingMorning += 1;
    continue;
  }
  if (hit.entry.status === 'ok' || hit.entry.status === 'ok_no_postcode') {
    okMorning += 1;
  } else if (hit.entry.status === 'bad') {
    badMorning += 1;
  }
}
console.log(`Bad teraz z ok rano (utrata coords): ${okMorning}/${nowBad.length}`);
console.log(`Bad teraz które były bad rano: ${badMorning}/${nowBad.length}`);
console.log(`Bad teraz bez śladu rano: ${missingMorning}/${nowBad.length}`);
