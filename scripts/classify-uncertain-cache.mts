/**
 * Segregacja wpisów cache ze statusem uncertain po heurystycznej przyczynie.
 * Uruchom: npx tsx scripts/classify-uncertain-cache.mts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isLargeCity, isVillagePlaceAddress } from '../src/phase5.js';
import { isOsiedleStreet, stripStreetPrefix } from '../src/streetNormalize.js';
import { mapRawRowToSheetRow } from '../src/sheets.js';

const CACHE_PATH = join(import.meta.dirname, '../data/phase5-cache.json');

type Category =
  | 'osiedle_krakow'
  | 'osiedle_inne'
  | 'wies_place'
  | 'numer_w_ulicy'
  | 'zly_kod_duze_miasto'
  | 'brak_ul_w_kluczu'
  | 'numer_zlozony'
  | 'miejscowosc_zamiast_ulicy'
  | 'skrot_ulicy'
  | 'inne';

const KRAKOW_OSIEDLA = /^(Tysiąclecia|Oświecenia|Złotego Wieku|Bohaterów Września|Kolorowe|Centrum|Ogrodowe|Stalowe|Na Lotnisku|Kalinowe|Kościuszkowskie|NIEPODLEGŁOŚCI)/i;

function parseAddressKey(key: string): {
  kod: string;
  rest: string;
  miasto: string;
  ulica: string;
  numer: string;
} {
  const m = key.match(/^(\d{2}-\d{3})\s+(.+)$/);
  if (!m) {
    return { kod: '', rest: key, miasto: '', ulica: '', numer: '' };
  }
  const kod = m[1]!;
  const rest = m[2]!;
  const parts = rest.split(/\s+/);
  if (parts.length < 2) {
    return { kod, rest, miasto: rest, ulica: '', numer: '' };
  }
  const numer = parts[parts.length - 1] ?? '';
  const miasto = parts[0] ?? '';
  const ulica = parts.slice(1, -1).join(' ');
  return { kod, rest, miasto, ulica, numer };
}

function hasDuplicateNumberInStreet(ulica: string, numer: string): boolean {
  const n = numer.trim();
  if (!n) return false;
  return ulica.endsWith(` ${n}`) || ulica.endsWith(` ${n.toLowerCase()}`);
}

function classify(key: string, allKeys: Set<string>): Category {
  const { kod, miasto, ulica, numer } = parseAddressKey(key);
  const row = mapRawRowToSheetRow(
    ['', '', '', kod, miasto, ulica, numer, '', '', '1'],
    2,
  );

  if (isOsiedleStreet(ulica) || /\bos\.\s/i.test(key)) {
    return miasto.toLowerCase().includes('krak') ? 'osiedle_krakow' : 'osiedle_inne';
  }
  if (miasto.toLowerCase().includes('krak') && KRAKOW_OSIEDLA.test(ulica)) {
    return 'osiedle_krakow';
  }
  if (isVillagePlaceAddress(row)) {
    return 'wies_place';
  }
  if (hasDuplicateNumberInStreet(ulica, numer)) {
    return 'numer_w_ulicy';
  }
  if (isLargeCity(miasto) && /^\d{2}-\d{3}/.test(key)) {
    const altWithUl = key.replace(` ${ulica} `, ` ul. ${ulica} `);
    const altWithAl = ulica.match(/^(Najświętszej|Armii|Wolności)/i)
      ? key.replace(` ${ulica} `, ` al. ${ulica} `)
      : '';
    if (allKeys.has(altWithUl) || (altWithAl && allKeys.has(altWithAl))) {
      return 'brak_ul_w_kluczu';
    }
  }
  if (isLargeCity(miasto)) {
    return 'zly_kod_duze_miasto';
  }
  if (/[\/-]/.test(numer) || /\d+\s+\d+/.test(ulica)) {
    return 'numer_zlozony';
  }
  if (/^(B\.\s|K\.\s|al\.)/i.test(ulica)) {
    return 'skrot_ulicy';
  }
  const uNorm = stripStreetPrefix(ulica).toLowerCase();
  const mNorm = miasto.toLowerCase();
  if (uNorm && mNorm && uNorm !== mNorm && !ulica.match(/^(ul\.|al\.|os\.)/i)) {
    const looksLikeVillage =
      uNorm.split(/\s+/).length <= 3 &&
      (uNorm.includes(mNorm) || mNorm.includes(uNorm) || /^[A-ZĄĆĘŁŃÓŚŹŻ\s]+$/.test(ulica));
    if (looksLikeVillage && uNorm !== mNorm) {
      return 'miejscowosc_zamiast_ulicy';
    }
  }
  return 'inne';
}

const cache = JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as {
  entries: Record<string, { status: string }>;
};
const allKeys = new Set(Object.keys(cache.entries));
const uncertain = Object.entries(cache.entries).filter(([, e]) => e.status === 'uncertain');

const labels: Record<Category, string> = {
  osiedle_krakow: 'Osiedla Krakowa (ulica w neighbourhood, nie w road)',
  osiedle_inne: 'Osiedla poza Krakowem',
  wies_place: 'Wieś — ulica = nazwa miejscowości',
  numer_w_ulicy: 'Numer powtórzony w kolumnie ulica',
  zly_kod_duze_miasto: 'Duże miasto — możliwy błędny kod pocztowy',
  brak_ul_w_kluczu: 'Brak ul./al. w kluczu (jest wersja ok z prefiksem)',
  numer_zlozony: 'Złożony numer (12/43, 19-20, 1/1)',
  miejscowosc_zamiast_ulicy: 'Nazwa miejscowości zamiast ulicy',
  skrot_ulicy: 'Skrót / prefiks ulicy (B., K., al.)',
  inne: 'Inne — wymaga ręcznej oceny',
};

const byCategory = new Map<Category, string[]>();
for (const [key] of uncertain) {
  const cat = classify(key, allKeys);
  const list = byCategory.get(cat) ?? [];
  list.push(key);
  byCategory.set(cat, list);
}

console.log(`=== uncertain: ${uncertain.length} ===\n`);
for (const cat of Object.keys(labels) as Category[]) {
  const list = byCategory.get(cat) ?? [];
  if (list.length === 0) continue;
  console.log(`## ${labels[cat]} (${list.length})`);
  list.sort((a, b) => a.localeCompare(b, 'pl')).forEach((k) => console.log(`  - ${k}`));
  console.log('');
}
