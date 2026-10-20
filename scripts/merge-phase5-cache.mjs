/**
 * CI: scala cache geokodowania przed `npm run generate`.
 * - Baza z Actions (.cache/ po restore)
 * - Wpisy z repo (data/phase5-cache.json) nadpisują ten sam klucz adresu (lokalne poprawki wygrywają)
 * - Wpisy tylko z Actions zostają (geokody z poprzednich runów CI, których nie ma w commicie)
 * - Wpis usunięty z data/ znika też z Actions (lista kluczy z data/ z poprzedniego biegu w .cache/)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_FILE = 'data/phase5-cache.json';
const CACHE_FILE = '.cache/phase5-cache.json';
const DATA_KEYS_FILE = '.cache/phase5-data-keys.json';

/**
 * @param {Record<string, unknown>} dataEntries
 * @param {Record<string, unknown>} actionsEntries
 * @param {string[] | null} previousDataKeys klucze z data/ przy poprzednim scaleniu; null = brak listy
 */
export function mergePhase5CacheEntries(dataEntries, actionsEntries, previousDataKeys) {
  const previous = new Set(previousDataKeys ?? []);
  const keptActions = {};
  const removed = [];
  for (const [key, entry] of Object.entries(actionsEntries)) {
    if (!(key in dataEntries) && previous.has(key)) {
      removed.push(key);
      continue;
    }
    keptActions[key] = entry;
  }
  return { entries: { ...keptActions, ...dataEntries }, removed };
}

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

function loadDataKeys(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : null;
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, value) {
  const tmpFile = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(value, null, 2));
  fs.renameSync(tmpFile, filePath);
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

function main() {
  const data = loadEntries(DATA_FILE);
  const actions = loadEntries(CACHE_FILE);
  const dataKeys = Object.keys(data.entries);
  const actionKeys = Object.keys(actions.entries);

  if (dataKeys.length === 0 && actionKeys.length === 0) {
    console.log('::warning::Brak cache: ani data/phase5-cache.json, ani Actions — faza 5 zacznie od zera.');
    return;
  }

  const { entries: mergedEntries, removed } = mergePhase5CacheEntries(
    data.entries,
    actions.entries,
    loadDataKeys(DATA_KEYS_FILE),
  );
  const overlap = dataKeys.filter((k) => k in actions.entries).length;
  const onlyActions = actionKeys.filter((k) => !(k in data.entries)).length - removed.length;
  const onlyData = dataKeys.filter((k) => !(k in actions.entries)).length;

  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  writeJsonAtomic(CACHE_FILE, { version: 2, entries: mergedEntries });
  writeJsonAtomic(DATA_KEYS_FILE, dataKeys);

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
  if (removed.length > 0) {
    console.log(`  usunięte z data/ → usunięte z Actions: ${removed.length} (${removed.slice(0, 5).join('; ')})`);
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  main();
}
