/**
 * Weryfikacja grubych niespójności: współrzędne daleko od strefy kodu pocztowego.
 *
 * Strefa = pierwsze 2 cyfry PNA (przybliżony centroid). Próg: >50 km od centroidu
 * oraz województwo z geokodu inne niż oczekiwane z prefiksu kodu — sam dystans
 * 50 km w dużych strefach PNA generuje setki fałszywych alarmów.
 */

import { readFile } from 'node:fs/promises';

export const POSTCODE_ZONE_MISMATCH_THRESHOLD_KM = 50;

/** Przybliżone centroida stref PNA (pierwsze 2 cyfry kodu). */
const PREFIX_CENTROID: Record<string, { lat: number; lng: number }> = {
  '00': { lat: 52.23, lng: 21.01 },
  '01': { lat: 52.25, lng: 20.95 },
  '02': { lat: 52.2, lng: 21.0 },
  '03': { lat: 52.27, lng: 21.1 },
  '04': { lat: 52.18, lng: 21.1 },
  '05': { lat: 52.2, lng: 20.7 },
  '06': { lat: 52.7, lng: 20.5 },
  '07': { lat: 52.55, lng: 22.0 },
  '08': { lat: 52.15, lng: 22.3 },
  '09': { lat: 52.55, lng: 19.7 },
  '10': { lat: 53.78, lng: 20.48 },
  '11': { lat: 54.05, lng: 21.4 },
  '12': { lat: 53.5, lng: 21.0 },
  '13': { lat: 53.4, lng: 20.4 },
  '14': { lat: 54.05, lng: 19.6 },
  '15': { lat: 53.13, lng: 23.16 },
  '16': { lat: 53.8, lng: 22.9 },
  '17': { lat: 52.8, lng: 23.2 },
  '18': { lat: 53.2, lng: 22.3 },
  '19': { lat: 54.0, lng: 22.5 },
  '20': { lat: 51.25, lng: 22.57 },
  '21': { lat: 51.7, lng: 22.5 },
  '22': { lat: 51.0, lng: 23.2 },
  '23': { lat: 50.8, lng: 22.9 },
  '24': { lat: 51.4, lng: 22.0 },
  '25': { lat: 50.87, lng: 20.63 },
  '26': { lat: 51.1, lng: 20.8 },
  '27': { lat: 50.95, lng: 21.4 },
  '28': { lat: 50.6, lng: 20.8 },
  '29': { lat: 50.8, lng: 20.2 },
  '30': { lat: 50.06, lng: 19.94 },
  '31': { lat: 50.08, lng: 19.95 },
  '32': { lat: 50.0, lng: 19.6 },
  '33': { lat: 49.7, lng: 20.4 },
  '34': { lat: 49.5, lng: 19.8 },
  '35': { lat: 50.04, lng: 22.0 },
  '36': { lat: 49.8, lng: 22.0 },
  '37': { lat: 50.0, lng: 22.5 },
  '38': { lat: 49.7, lng: 21.8 },
  '39': { lat: 50.3, lng: 21.5 },
  '40': { lat: 50.26, lng: 19.02 },
  '41': { lat: 50.3, lng: 18.9 },
  '42': { lat: 50.8, lng: 19.1 },
  '43': { lat: 49.8, lng: 19.0 },
  '44': { lat: 50.2, lng: 18.6 },
  '45': { lat: 50.67, lng: 17.93 },
  '46': { lat: 50.5, lng: 17.5 },
  '47': { lat: 50.3, lng: 18.0 },
  '48': { lat: 50.4, lng: 17.4 },
  '49': { lat: 50.7, lng: 17.4 },
  '50': { lat: 51.11, lng: 17.04 },
  '51': { lat: 51.15, lng: 17.0 },
  '52': { lat: 51.05, lng: 17.1 },
  '53': { lat: 51.1, lng: 16.9 },
  '54': { lat: 51.15, lng: 17.1 },
  '55': { lat: 51.2, lng: 16.8 },
  '56': { lat: 51.3, lng: 17.0 },
  '57': { lat: 50.4, lng: 16.7 },
  '58': { lat: 50.8, lng: 16.3 },
  '59': { lat: 51.2, lng: 15.6 },
  '60': { lat: 52.41, lng: 16.93 },
  '61': { lat: 52.4, lng: 16.93 },
  '62': { lat: 52.3, lng: 17.5 },
  '63': { lat: 51.8, lng: 17.0 },
  '64': { lat: 52.5, lng: 16.0 },
  '65': { lat: 51.94, lng: 15.5 },
  '66': { lat: 52.2, lng: 15.5 },
  '67': { lat: 51.7, lng: 15.6 },
  '68': { lat: 51.8, lng: 14.8 },
  '69': { lat: 52.8, lng: 15.2 },
  '70': { lat: 53.43, lng: 14.55 },
  '71': { lat: 53.45, lng: 14.55 },
  '72': { lat: 53.5, lng: 14.8 },
  '73': { lat: 53.3, lng: 15.0 },
  '74': { lat: 53.2, lng: 15.0 },
  '75': { lat: 54.2, lng: 16.2 },
  '76': { lat: 54.2, lng: 16.8 },
  '77': { lat: 53.8, lng: 17.0 },
  '78': { lat: 54.0, lng: 16.0 },
  '80': { lat: 54.35, lng: 18.65 },
  '81': { lat: 54.5, lng: 18.5 },
  '82': { lat: 54.0, lng: 19.0 },
  '83': { lat: 54.0, lng: 18.0 },
  '84': { lat: 54.5, lng: 17.5 },
  '85': { lat: 53.12, lng: 18.0 },
  '86': { lat: 53.2, lng: 18.2 },
  '87': { lat: 53.0, lng: 18.8 },
  '88': { lat: 52.8, lng: 18.2 },
  '89': { lat: 53.4, lng: 17.8 },
  '90': { lat: 51.76, lng: 19.46 },
  '91': { lat: 51.8, lng: 19.4 },
  '92': { lat: 51.75, lng: 19.5 },
  '93': { lat: 51.7, lng: 19.4 },
  '94': { lat: 51.75, lng: 19.3 },
  '95': { lat: 51.8, lng: 19.4 },
  '96': { lat: 52.0, lng: 20.0 },
  '97': { lat: 51.4, lng: 19.6 },
  '98': { lat: 51.3, lng: 18.8 },
  '99': { lat: 52.1, lng: 19.4 },
};

/**
 * Główne mapowanie PNA (2 cyfry) → województwo „bazowe” + dodatkowe dozwolone,
 * gdy ten sam prefiks realnie występuje po reformach w sąsiednich województwach
 * (np. 26-xxx: Kielce / Radom / Opoczno).
 */
const PREFIX_PRIMARY_WOJEWODZTWO: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  const ranges: Array<[number, number, string]> = [
    [0, 9, 'Mazowieckie'],
    [10, 14, 'Warmińsko-Mazurskie'],
    [15, 19, 'Podlaskie'],
    [20, 24, 'Lubelskie'],
    [25, 29, 'Świętokrzyskie'],
    [30, 34, 'Małopolskie'],
    [35, 39, 'Podkarpackie'],
    [40, 44, 'Śląskie'],
    [45, 49, 'Opolskie'],
    [50, 59, 'Dolnośląskie'],
    [60, 64, 'Wielkopolskie'],
    [65, 69, 'Lubuskie'],
    [70, 78, 'Zachodniopomorskie'],
    [80, 84, 'Pomorskie'],
    [85, 89, 'Kujawsko-Pomorskie'],
    [90, 99, 'Łódzkie'],
  ];
  for (const [from, to, woj] of ranges) {
    for (let i = from; i <= to; i++) {
      out[String(i).padStart(2, '0')] = woj;
    }
  }
  return out;
})();

/** Prefiks → dodatkowe województwa (obok bazowego), bez literówek w arkuszu. */
const PREFIX_EXTRA_WOJEWODZTWA: Record<string, readonly string[]> = {
  '19': ['Warmińsko-Mazurskie'], // Olecko, Gołdap, Świętajno
  '26': ['Mazowieckie', 'Łódzkie'], // Radom, Kozienice; Opoczno, Drzewica
  '38': ['Małopolskie'], // Gorlice, Bobowa, Brunary
  '47': ['Śląskie'], // Racibórz
  '67': ['Dolnośląskie'], // Głogów
  '77': ['Wielkopolskie'], // Złotów
  '82': ['Warmińsko-Mazurskie'], // Elbląg
  '89': ['Wielkopolskie'], // Wysoka, Wyrzysk, Łobżenica
  '96': ['Mazowieckie'], // Sochaczew
};

function allowedWojewodztwaForPrefix(prefix: string): string[] {
  const primary = PREFIX_PRIMARY_WOJEWODZTWO[prefix];
  if (!primary) {
    return [];
  }
  const extras = PREFIX_EXTRA_WOJEWODZTWA[prefix] ?? [];
  return [primary, ...extras];
}

export interface PostcodeZoneCheckInput {
  address: string;
  count: number;
  lat: number;
  lng: number;
  wojewodztwo: string;
}

export interface PostcodeZoneMismatch {
  address: string;
  postcode: string;
  liczbaWystapien: number;
  lat: number;
  lng: number;
  wojewodztwo: string;
  /** Dozwolone województwa dla prefiksu (bazowe + wyjątki PNA), połączone „ / ”. */
  oczekiwaneWojewodztwo: string;
  odlegloscKm: number;
}

const POSTCODE_AT_START = /^(\d{2}-\d{3})\b/;

export function extractPostcodeFromAddress(address: string): string | null {
  const match = address.trim().match(POSTCODE_AT_START);
  return match?.[1] ?? null;
}

/** Województwo bazowe dla prefiksu (pierwsze z listy dozwolonych). */
export function expectedWojewodztwoForPostcode(postcode: string): string | null {
  const allowed = allowedWojewodztwaForPostcode(postcode);
  return allowed[0] ?? null;
}

/** Wszystkie dozwolone województwa dla kodu (PNA przecinające granice admin.). */
export function allowedWojewodztwaForPostcode(postcode: string): string[] {
  const digits = postcode.replace(/\D/g, '');
  if (digits.length < 2) {
    return [];
  }
  return allowedWojewodztwaForPrefix(digits.slice(0, 2));
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function foldWojewodztwo(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/g, 'l');
}

export function wojewodztwaMatch(a: string, b: string): boolean {
  return foldWojewodztwo(a) === foldWojewodztwo(b);
}

export function wojewodztwoInAllowed(actual: string, allowed: readonly string[]): boolean {
  const foldedActual = foldWojewodztwo(actual);
  if (!foldedActual || foldedActual === 'nieznane') {
    return false;
  }
  return allowed.some((w) => foldWojewodztwo(w) === foldedActual);
}

export interface FindPostcodeZoneMismatchesOptions {
  thresholdKm?: number;
  /** Adresy pomijane (znane fałszywe alarmy / zaakceptowane literówki). */
  excludedAddresses?: ReadonlySet<string>;
}

/**
 * Parsuje JSON wyjątków: obiekt `{ "adres": "notatka" }` albo tablica adresów.
 */
export function parsePostcodeExceptions(raw: unknown): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string' && item.trim()) {
        out.add(item.trim());
      }
    }
    return out;
  }
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(raw as Record<string, unknown>)) {
      if (key.trim()) {
        out.add(key.trim());
      }
    }
  }
  return out;
}

export async function loadPostcodeExceptions(
  filePath: string,
  readFileFn: (path: string, encoding: BufferEncoding) => Promise<string> = readFile,
): Promise<Set<string>> {
  try {
    const text = await readFileFn(filePath, 'utf-8');
    return parsePostcodeExceptions(JSON.parse(text) as unknown);
  } catch {
    return new Set();
  }
}

/**
 * Zwraca adresy z grubą niespójnością kod↔współrzędne, posortowane od największego dystansu.
 */
export function findPostcodeZoneMismatches(
  items: PostcodeZoneCheckInput[],
  options: FindPostcodeZoneMismatchesOptions = {},
): PostcodeZoneMismatch[] {
  const thresholdKm = options.thresholdKm ?? POSTCODE_ZONE_MISMATCH_THRESHOLD_KM;
  const excluded = options.excludedAddresses;
  const out: PostcodeZoneMismatch[] = [];

  for (const item of items) {
    if (excluded?.has(item.address)) {
      continue;
    }
    const postcode = extractPostcodeFromAddress(item.address);
    if (!postcode) {
      continue;
    }
    const prefix = postcode.replace(/\D/g, '').slice(0, 2);
    const centroid = PREFIX_CENTROID[prefix];
    const allowedWoj = allowedWojewodztwaForPrefix(prefix);
    if (!centroid || allowedWoj.length === 0) {
      continue;
    }
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) {
      continue;
    }

    const odlegloscKm = haversineKm(item.lat, item.lng, centroid.lat, centroid.lng);
    if (odlegloscKm <= thresholdKm) {
      continue;
    }
    if (wojewodztwoInAllowed(item.wojewodztwo, allowedWoj)) {
      continue;
    }

    out.push({
      address: item.address,
      postcode,
      liczbaWystapien: item.count,
      lat: item.lat,
      lng: item.lng,
      wojewodztwo: item.wojewodztwo,
      oczekiwaneWojewodztwo: allowedWoj.join(' / '),
      odlegloscKm: Math.round(odlegloscKm * 10) / 10,
    });
  }

  out.sort((a, b) => b.odlegloscKm - a.odlegloscKm || a.address.localeCompare(b.address, 'pl'));
  return out;
}
