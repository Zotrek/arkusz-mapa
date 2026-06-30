/**
 * Audyt i czyszczenie cache dla adresów objętych poprawkami pipeline.
 * Uruchom: npx tsx scripts/verify-fix-addresses-cache.mts [--purge] [--geocode]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mapRawRowToSheetRow } from '../src/sheets.js';
import { migrateCacheEntries, purgeLegacyAbbreviationCacheKeys } from '../src/cacheMigrate.js';
import { executePhase5 } from '../src/phase5.js';
import type { AddressGroup } from '../src/phase3.js';
import type { SheetRow } from '../src/sheets.js';

const CACHE_PATH = join(import.meta.dirname, '../data/phase5-cache.json');

/** Przykładowe wiersze arkusza (kolumny A–J) dla adresów z poprawek. */
const FIX_CASES: Array<{ label: string; raw: string[] }> = [
  { label: 'wieś Bogucin', raw: ['', '', '', '21-080', 'Bogucin', 'Bogucin', '59A', '', '', '1'] },
  { label: 'wieś Gostwica', raw: ['', '', '', '33-386', 'Gostwica', 'Gostwica', '329', '', '', '2'] },
  {
    label: 'wieś Gołkowice Górne',
    raw: ['', '', '', '33-388', 'GOŁKOWICE GÓRNE', 'GOŁKOWICE GÓRNE', '189', '', '', '3'],
  },
  { label: 'wieś Łącko', raw: ['', '', '', '33-390', 'ŁĄCKO', 'ŁĄCKO', '106A', '', '', '4'] },
  {
    label: 'wieś Jasienica Rosielna',
    raw: ['', '', '', '36-220', 'Jasienica Rosielna', 'Jasienica Rosielna', '255b', '', '', '5'],
  },
  { label: 'wieś Biecz', raw: ['', '', '', '68-343', 'Biecz', 'Biecz', '61', '', '', '6'] },
  {
    label: 'duplikat numeru Dubiecko',
    raw: ['', '', '', '37-750', 'Dubiecko', 'Winne-Podbukowina 11', '11', '', '', '7'],
  },
  {
    label: 'duplikat numeru Tokarnia',
    raw: ['', '', '', '32-436', 'Tokarnia', 'Tokarnia 853', '853', '', '', '8'],
  },
  {
    label: 'duplikat numeru Dziwnów',
    raw: ['', '', '', '72-420', 'Dziwnów', 'OSIEDLE RYBACKIE 113A', '113A', '', '', '9'],
  },
  {
    label: 'duplikat numeru Muszaki',
    raw: ['', '', '', '13-113', 'Muszaki', 'Muszaki 13', '13', '', '', '10'],
  },
  {
    label: 'prefiks al.Chryzantem',
    raw: ['', '', '', '91-718', 'Łódź', 'al.Chryzantem', '8', '', '', '11'],
  },
  {
    label: 'skrót B. Głowackiego',
    raw: ['', '', '', '24-140', 'Nałęczów', 'B. Głowackiego', '12', '', '', '12'],
  },
  {
    label: 'literówka Ramba Brzeska',
    raw: ['', '', '', '22-100', 'Chełm', 'Ramba Brzeska', '14A', '', '', '13'],
  },
  {
    label: 'skrót K. WIELKIEGO',
    raw: ['', '', '', '36-065', 'DYNÓW', 'K. WIELKIEGO', '1/1', '', '', '14'],
  },
  {
    label: 'duże miasto zły kod Kraków',
    raw: ['', '', '', '30-382', 'Kraków', 'PRZYBYSZEWSKIEGO', '75', '', '', '15'],
  },
  {
    label: 'literówka kodu Śrem',
    raw: ['', '', '', '62-100', 'Śrem', 'Chopina', '1D', '', '', '16'],
  },
  {
    label: 'przysiółek GDÓW KLĘCZANA',
    raw: ['', '', '', '32-420', 'GDÓW', 'KLĘCZANA', '33', '', '', '17'],
  },
  {
    label: 'przysiółek BIAŁA PODLASKA POROSIUKI',
    raw: ['', '', '', '21-500', 'BIAŁA PODLASKA', 'POROSIUKI', '130', '', '', '18'],
  },
  {
    label: 'wieś Leszczyna',
    raw: ['', '', '', '32-733', 'Leszczyna', 'Leszczyna', '186', '', '', '19'],
  },
  {
    label: 'skrót Gen. Sikorskiego',
    raw: ['', '', '', '39-451', 'Skopanie', 'Gen. Sikorskiego', '11', '', '', '20'],
  },
  {
    label: 'ulica Targowa bez prefiksu',
    raw: ['', '', '', '34-130', 'Kalwaria Zabrzydowska', 'Targowa', '3', '', '', '21'],
  },
  {
    label: 'duże miasto Gdansk Olejarna',
    raw: ['', '', '', '80-843', 'Gdansk', 'Olejarna', '3', '', '', '22'],
  },
  {
    label: 'duże miasto Łódż Wilcza',
    raw: ['', '', '', '90-339', 'Łódż', 'Wilcza', '4', '', '', '23'],
  },
];

/** Stare klucze cache (przed normalizacją ulicy / numeru). */
const STALE_CACHE_KEYS = [
  '37-750 Dubiecko Winne-Podbukowina 11 11',
  '32-436 Tokarnia Tokarnia 853 853',
  '72-420 Dziwnów OSIEDLE RYBACKIE 113A 113A',
  '13-113 Muszaki Muszaki 13 13',
  '91-718 Łódź al.Chryzantem 8',
  '24-140 Nałęczów B. Głowackiego 12',
  '22-100 Chełm Ramba Brzeska 14A',
  '32-420 GDÓW KLĘCZANA 33 33',
  '21-500 BIAŁA PODLASKA POROSIUKI 130 130',
  '32-420 GDÓW KAMYK 144 144',
];

function asGrouped(rows: SheetRow[]): Map<string, AddressGroup> {
  const grouped = new Map<string, AddressGroup>();
  for (const row of rows) {
    const sklepKey = row.sklep.trim().replace(/\s+/g, ' ').toLowerCase();
    const groupingKey = sklepKey.length > 0 ? `${row.address}\u0000${sklepKey}` : row.address;
    const current = grouped.get(groupingKey);
    if (!current) {
      grouped.set(groupingKey, { address: row.address, count: 1, rows: [row] });
    } else {
      current.count += 1;
      current.rows.push(row);
    }
  }
  return grouped;
}

async function loadCache(): Promise<{ version?: number; entries: Record<string, unknown> }> {
  const raw = await readFile(CACHE_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as { version?: number; entries: Record<string, unknown> };
  if (parsed.version === 2 && parsed.entries) {
    parsed.entries = purgeLegacyAbbreviationCacheKeys(
      migrateCacheEntries(
        parsed.entries as Record<string, import('../src/cacheMigrate.js').CacheEntry>,
      ).entries,
    ).entries;
  }
  return parsed;
}

async function main(): Promise<void> {
  const purge = process.argv.includes('--purge');
  const geocode = process.argv.includes('--geocode');
  const cache = await loadCache();
  const entries = cache.entries ?? {};

  const rows = FIX_CASES.map((c, i) => mapRawRowToSheetRow(c.raw, i + 2));
  const canonicalAddresses = rows.map((r) => r.address);

  console.log('=== Adresy po normalizacji (klucze cache) ===');
  for (let i = 0; i < FIX_CASES.length; i++) {
    console.log(`  ${FIX_CASES[i]!.label}: ${canonicalAddresses[i]}`);
  }

  const keysToPurge = new Set<string>([...STALE_CACHE_KEYS, ...canonicalAddresses]);

  console.log('\n=== Stan cache przed czyszczeniem ===');
  for (const key of [...keysToPurge].sort((a, b) => a.localeCompare(b, 'pl'))) {
    const entry = entries[key] as { status?: string; lat?: number; lng?: number } | undefined;
    if (!entry) {
      console.log(`  [brak] ${key}`);
      continue;
    }
    const coords =
      typeof entry.lat === 'number' && typeof entry.lng === 'number'
        ? `${entry.lat}, ${entry.lng}`
        : 'brak współrzędnych';
    console.log(`  [${entry.status ?? '?'}] ${key} → ${coords}`);
  }

  if (purge) {
    let removed = 0;
    for (const key of keysToPurge) {
      if (entries[key]) {
        delete entries[key];
        removed += 1;
      }
    }
    cache.entries = entries;
    await writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf-8');
    console.log(`\nUsunięto ${removed} wpisów z cache.`);
  }

  if (geocode) {
    console.log('\n=== Geokodowanie (Nominatim) ===');
    const grouped = asGrouped(rows);
    const result = await executePhase5(grouped, {
      cacheFilePath: CACHE_PATH,
      rateLimitMs: 1100,
      logger: {
        info: (msg, ...args) => console.log(msg, ...args),
        warn: (msg, ...args) => console.warn(msg, ...args),
      },
    });

    const byAddress = new Map<string, { status: string; lat?: number; lng?: number }>();
    for (const item of result.geocoded) {
      byAddress.set(item.address, { status: 'ok', lat: item.lat, lng: item.lng });
    }
    for (const item of result.geocodedNoPostcode) {
      byAddress.set(item.address, { status: 'ok_no_postcode', lat: item.lat, lng: item.lng });
    }
    for (const item of result.uncertainGeocoded) {
      byAddress.set(item.address, { status: 'uncertain', lat: item.lat, lng: item.lng });
    }
    for (const item of result.cityOnlyGeocoded) {
      byAddress.set(item.address, { status: 'city_only', lat: item.lat, lng: item.lng });
    }
    for (const row of result.rowsBledneAdresy) {
      if (!byAddress.has(row.address)) {
        byAddress.set(row.address, { status: 'bad' });
      }
    }

    let okCount = 0;
    for (let i = 0; i < FIX_CASES.length; i++) {
      const addr = canonicalAddresses[i]!;
      const hit = byAddress.get(addr);
      const label = FIX_CASES[i]!.label;
      if (!hit) {
        console.log(`  FAIL ${label}: brak wyniku (${addr})`);
        continue;
      }
      const good = hit.status === 'ok' || hit.status === 'ok_no_postcode';
      if (good) okCount += 1;
      const icon = good ? 'OK' : hit.status.toUpperCase();
      const coords =
        typeof hit.lat === 'number' ? ` (${hit.lat}, ${hit.lng})` : '';
      console.log(`  ${icon} ${label}: ${hit.status}${coords}`);
    }
    console.log(`\nPodsumowanie: ${okCount}/${FIX_CASES.length} jako ok / ok_no_postcode`);
  }
}

await main();
