#!/usr/bin/env node
/**
 * CI: scala cache geokodowania przed `npm run generate`.
 * - Baza z Actions (.cache/ po restore)
 * - Wpisy z repo (data/phase5-cache.json) nadpisują ten sam klucz adresu (lokalne poprawki wygrywają)
 * - Wpisy tylko z Actions zostają (geokody z poprzednich runów CI, których nie ma w commicie)
 */
import fs from 'node:fs';
import path from 'node:path';

const DATA_FILE = 'data/phase5-cache.json';
const CACHE_FILE = '.cache/phase5-cache.json';

function loadEntries(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed.version !== 2 || !parsed.entries || typeof parsed.entries !== 'object') {
      return { entries: {}, bytes: Buffer.byteLength(raw, 'utf8') };
    }
    return { entries: parsed.entries, bytes: Buffer.byteLength(raw, 'utf8') };
  } catch {
    return { entries: {}, bytes: 0 };
  }
}

function fileSize(path) {
  try {
    return fs.statSync(path).size;
  } catch {
    return 0;
  }
}

function countByStatus(entries) {
  const counts = { ok: 0, ok_no_postcode: 0, uncertain: 0, city_only: 0, bad: 0, other: 0 };
  for (const entry of Object.values(entries)) {
    const s = entry?.status;
    if (s && s in counts) counts[s] += 1;
    else counts.other += 1;
  }
  return counts;
}

const dataSize = fileSize(DATA_FILE);
const actionsSize = fileSize(CACHE_FILE);
const data = dataSize > 0 ? loadEntries(DATA_FILE) : { entries: {}, bytes: 0 };
const actions = actionsSize > 0 ? loadEntries(CACHE_FILE) : { entries: {}, bytes: 0 };

const dataKeys = Object.keys(data.entries);
const actionKeys = Object.keys(actions.entries);
const mergedEntries = { ...actions.entries, ...data.entries };
const overlap = dataKeys.filter((k) => k in actions.entries).length;
const onlyActions = actionKeys.filter((k) => !(k in data.entries)).length;
const onlyData = dataKeys.filter((k) => !(k in actions.entries)).length;

if (dataKeys.length === 0 && actionKeys.length === 0) {
  console.log('::warning::Brak cache: ani data/phase5-cache.json, ani Actions — faza 5 zacznie od zera.');
  process.exit(0);
}

fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
const payload = { version: 2, entries: mergedEntries };
fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2));

const mergedBytes = fs.statSync(CACHE_FILE).size;
const dataStats = countByStatus(data.entries);
const actionsStats = countByStatus(actions.entries);
const mergedStats = countByStatus(mergedEntries);

console.log('Phase 5 cache merge (repo data/ ma pierwszeństwo przy tym samym adresie):');
console.log(
  `  data/    entries=${dataKeys.length} bytes=${data.bytes} bad=${dataStats.bad} ok=${dataStats.ok}`,
);
console.log(
  `  actions  entries=${actionKeys.length} bytes=${actions.bytes} bad=${actionsStats.bad} ok=${actionsStats.ok} cache-hit context`,
);
console.log(
  `  merged   entries=${Object.keys(mergedEntries).length} bytes=${mergedBytes} bad=${mergedStats.bad} ok=${mergedStats.ok}`,
);
console.log(`  overlap=${overlap} onlyActions=${onlyActions} onlyData=${onlyData} (repo nadpisało ${overlap} wspólnych kluczy)`);
