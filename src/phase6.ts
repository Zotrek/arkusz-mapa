/**
 * Faza 6: generowanie pliku mapy HTML.
 * Opcjonalnie: osadzony szablon Word + lista podwykonawców → generowanie .docx w przeglądarce (PizZip + docxtemplater z CDN).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getOptionalWordMapAssetPaths, getTransportWebAppUrl } from './config.js';
import type { GeocodedAddress } from './phase5.js';
import type { SheetRow } from './sheets.js';
import {
  buildMapPointDocPayload,
  formatRodzajZbiorkiForDoc,
  loadPodwykoOptionsFromSpreadsheet,
  readWordTemplateAsBase64ForMap,
  type MapPointDocPayload,
  type PodwykoOption,
  firstPodmiotHandlowyFromRows,
  firstSklepFromRows,
  sealRowsFromSheetRows,
  type SealRowLite,
} from './wordMapSupport.js';

/** Kolor pinezki dla 15+ wystąpień (wyróżnienie dużych zbiórek). */
const COLOR_15_PLUS = '#fd7e14';

/** Kolor pinezki dla 10–14 wystąpień. */
const COLOR_10_14 = '#ffc107';

/** Kolor pinezki zaznaczonej do zbiorczego protokołu (poza paletą worków). */
const COLOR_BULK_SELECTED = '#6f42c1';

/** Maks. odległość między punktami (m), aby uznać je za „nakładające się” na mapie. */
export const MAP_MARKER_CLUSTER_MAX_M = 20;

/** Promień rozsunięcia markerów wokół środka klastra (m) — widoczne osobne pinezki. */
export const MAP_MARKER_SPREAD_RADIUS_M = 18;

/** Zoom przy dokładnie jednym wyniku wyszukiwania (skala okolicy / ulic). */
export const MAP_SEARCH_SINGLE_MATCH_ZOOM = 16;

/** Górny limit zoomu przy wielu wynikach (fitBounds — nie „wchodzi” za głęboko). */
export const MAP_SEARCH_MULTI_MATCH_MAX_ZOOM = 16;

/** Margines od krawędzi mapy przy fitBounds wielu wyników [px góra-dół, px lewo-prawo]. */
export const MAP_SEARCH_FIT_PADDING: [number, number] = [72, 72];

export interface MapPointCoords {
  lat: number;
  lng: number;
}

export interface CloseMapPointPair {
  distanceM: number;
  indexA: number;
  indexB: number;
}

/** Wiersz zakładki „Bliskie adresy” — para punktów mapy w odległości ≤ 20 m. */
export interface CloseAddressPairRow {
  adresA: string;
  adresB: string;
  odlegloscM: number;
  latA: number;
  lngA: number;
  latB: number;
  lngB: number;
  wojA: string;
  wojB: string;
  liczbaWystapienA: number;
  liczbaWystapienB: number;
}

/** Odległość między dwoma współrzędnymi (metry). */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function moveLatLngByMeters(
  lat: number,
  lng: number,
  northM: number,
  eastM: number,
): { lat: number; lng: number } {
  const latRad = (lat * Math.PI) / 180;
  const dLat = northM / 111320;
  const dLng = eastM / (111320 * Math.cos(latRad));
  return { lat: lat + dLat, lng: lng + dLng };
}

/** Pary punktów w odległości ≤ maxDistanceM (do diagnostyki / raportu). */
export function findCloseMapPointPairs(
  points: MapPointCoords[],
  maxDistanceM: number = MAP_MARKER_CLUSTER_MAX_M,
): CloseMapPointPair[] {
  const pairs: CloseMapPointPair[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const pi = points[i]!;
      const pj = points[j]!;
      const distanceM = haversineMeters(pi.lat, pi.lng, pj.lat, pj.lng);
      if (distanceM <= maxDistanceM) {
        pairs.push({ distanceM, indexA: i, indexB: j });
      }
    }
  }
  pairs.sort((a, b) => a.distanceM - b.distanceM);
  return pairs;
}

/**
 * Pary adresów z mapy (wszystkie typy geokodowania) w odległości ≤ {@link MAP_MARKER_CLUSTER_MAX_M}.
 */
export function buildCloseGeocodedAddressPairs(
  geocoded: GeocodedAddress[],
  geocodedNoPostcode: GeocodedAddress[] = [],
  uncertainGeocoded: GeocodedAddress[] = [],
  cityOnlyGeocoded: GeocodedAddress[] = [],
): CloseAddressPairRow[] {
  const all = [...geocoded, ...geocodedNoPostcode, ...uncertainGeocoded, ...cityOnlyGeocoded];
  const coords = all.map((g) => ({ lat: g.lat, lng: g.lng }));
  const pairs = findCloseMapPointPairs(coords);
  return pairs.map(({ indexA, indexB, distanceM }) => {
    const a = all[indexA]!;
    const b = all[indexB]!;
    return {
      adresA: a.address,
      adresB: b.address,
      odlegloscM: Math.round(distanceM * 10) / 10,
      latA: a.lat,
      lngA: a.lng,
      latB: b.lat,
      lngB: b.lng,
      wojA: a.wojewodztwo || '',
      wojB: b.wojewodztwo || '',
      liczbaWystapienA: a.count,
      liczbaWystapienB: b.count,
    };
  });
}

/**
 * Rozsuwa pinezki blisko siebie (np. ten sam budynek / geokod), żeby były widoczne osobno.
 * Współrzędne źródłowe (lat/lng) pozostają; markerLat/markerLng służą do rysowania.
 */
export function spreadCloseMarkerPositions<T extends MapPointCoords>(
  points: T[],
  maxClusterDistanceM: number = MAP_MARKER_CLUSTER_MAX_M,
  spreadRadiusM: number = MAP_MARKER_SPREAD_RADIUS_M,
): Array<T & { markerLat: number; markerLng: number }> {
  const n = points.length;
  if (n === 0) {
    return [];
  }

  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) {
      parent[root] = parent[parent[root]!]!;
      root = parent[root]!;
    }
    return root;
  };
  const unite = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      parent[rb] = ra;
    }
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const pi = points[i]!;
      const pj = points[j]!;
      if (haversineMeters(pi.lat, pi.lng, pj.lat, pj.lng) <= maxClusterDistanceM) {
        unite(i, j);
      }
    }
  }

  const clusters = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!clusters.has(root)) {
      clusters.set(root, []);
    }
    clusters.get(root)!.push(i);
  }

  const result: Array<T & { markerLat: number; markerLng: number }> = points.map((p) => ({
    ...p,
    markerLat: p.lat,
    markerLng: p.lng,
  }));

  for (const indices of clusters.values()) {
    if (indices.length < 2) {
      continue;
    }
    indices.sort((a, b) => a - b);
    const centroidLat = indices.reduce((sum, idx) => sum + points[idx]!.lat, 0) / indices.length;
    const centroidLng = indices.reduce((sum, idx) => sum + points[idx]!.lng, 0) / indices.length;
    const count = indices.length;
    indices.forEach((idx, pos) => {
      const angle = (2 * Math.PI * pos) / count - Math.PI / 2;
      const northM = spreadRadiusM * Math.cos(angle);
      const eastM = spreadRadiusM * Math.sin(angle);
      const moved = moveLatLngByMeters(centroidLat, centroidLng, northM, eastM);
      result[idx]!.markerLat = moved.lat;
      result[idx]!.markerLng = moved.lng;
    });
  }

  return result;
}

/** Strefa czasowa dla nazwy pliku mapy (czas polski: CET / CEST, nie strefa runnera). */
const MAP_FILENAME_TIME_ZONE = 'Europe/Warsaw';

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? '00';
}

/**
 * Znacznik czasu w nazwie pliku: kalendarz i zegar w {@link MAP_FILENAME_TIME_ZONE}
 * (np. GitHub Actions = UTC — i tak dostajesz godzinę polską).
 */
export function formatTimestampForFileName(date: Date): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: MAP_FILENAME_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  return `${partValue(parts, 'year')}-${partValue(parts, 'month')}-${partValue(parts, 'day')}_${partValue(
    parts,
    'hour',
  )}-${partValue(parts, 'minute')}-${partValue(parts, 'second')}`;
}

export function buildMapFileName(date: Date): string {
  return `mapa_${formatTimestampForFileName(date)}.html`;
}

/**
 * Domyślna data załadunku w oknie Word (pole type=date, YYYY-MM-DD).
 * Pon–pt 00:00–03:59 → dziś; pon–czw od 04:00 → jutro; pt od 04:00 → poniedziałek (+3);
 * sobota → poniedziałek (+2); niedziela → poniedziałek (+1).
 */
export function defaultDateZaladunkuYmd(from: Date = new Date()): string {
  const d = new Date(from);
  const dow = d.getDay();
  const hour = d.getHours();
  if (dow === 6) {
    d.setDate(d.getDate() + 2);
  } else if (dow === 0) {
    d.setDate(d.getDate() + 1);
  } else if (dow === 5) {
    if (hour >= 4) {
      d.setDate(d.getDate() + 3);
    }
  } else {
    const dayOffset = hour >= 0 && hour < 4 ? 0 : 1;
    d.setDate(d.getDate() + dayOffset);
  }
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

export interface WordMapHtmlEmbed {
  templateBase64: string;
  podwykoOptions: PodwykoOption[];
}

type MapPoint = {
  adres: string;
  count: number;
  lat: number;
  lng: number;
  markerLat: number;
  markerLng: number;
  woj: string;
  confidence: 'ok' | 'ok_no_postcode' | 'uncertain' | 'city_only';
  /** Unikalne etykiety z kolumn A (podmiot) i B (sklep) — wyszukiwarka mapy. */
  searchLabels: string[];
  /** Unikalne wartości kolumny A (podmiot handlowy) — popup na mapie. */
  podmiotyHandlowe: string[];
  /** Pierwszy podmiot handlowy z grupy — klucz historii transportów. */
  podmiotHandlowy: string;
  /** Pierwszy sklep z grupy — zapis w rejestrze transportów. */
  sklep: string;
  /** Wiersze plomb do filtrowania w protokole (data zamknięcia worka). */
  sealRows: SealRowLite[];
  /** Zbiórka: Ręczna / Maszyna (z kolumny L) */
  zbiorka?: string;
  /** Do {{rodzaj_zbiorki}} w Word: ręczna | automatyczna | ręczna i automatyczna */
  rodzaj_zbiorki: string;
  doc: MapPointDocPayload;
};

const LEGEND_QUALITY: Record<MapPoint['confidence'], { label: string; color: string }> = {
  ok: { label: 'Adres OK', color: '#198754' },
  ok_no_postcode: { label: 'Bez kodu w wyniku', color: '#ffc107' },
  city_only: { label: 'Tylko kod + miasto', color: '#0d6efd' },
  uncertain: { label: 'Wynik niepewny', color: '#D40418' },
};

/**
 * Normalizacja tekstu do porównań w wyszukiwarce mapy (małe litery, polskie znaki → ASCII, pozostałe diakrytyki przez NFD).
 * Wygenerowany skrypt HTML musi stosować tę samą logikę co `normalizeForAddressSearchMap` w szablonie.
 */
export function normalizeForAddressSearch(text: string): string {
  let s = text.normalize('NFD').replace(/\p{M}/gu, '');
  s = s
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'l')
    .replace(/ą/g, 'a')
    .replace(/Ą/g, 'a')
    .replace(/ć/g, 'c')
    .replace(/Ć/g, 'c')
    .replace(/ę/g, 'e')
    .replace(/Ę/g, 'e')
    .replace(/ń/g, 'n')
    .replace(/Ń/g, 'n')
    .replace(/ó/g, 'o')
    .replace(/Ó/g, 'o')
    .replace(/ś/g, 's')
    .replace(/Ś/g, 's')
    .replace(/ź/g, 'z')
    .replace(/Ź/g, 'z')
    .replace(/ż/g, 'z')
    .replace(/Ż/g, 'z');
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lista podwykonawców (modal Word): dopasowanie po nazwie (A) lub treści do dokumentu (B).
 * Pusty query = wszystkie pozycje.
 */
export function podwykoOptionMatchesSearch(label: string, dane: string, query: string): boolean {
  const q = normalizeForAddressSearch(query);
  if (!q) {
    return true;
  }
  if (normalizeForAddressSearch(label).includes(q)) {
    return true;
  }
  if (normalizeForAddressSearch(dane).includes(q)) {
    return true;
  }
  return false;
}

/** Czy fragment zapytania występuje w adresie (po {@link normalizeForAddressSearch}). Pusty query = dopasuj wszystko. */
export function addressMatchesSearch(adres: string, query: string): boolean {
  const q = normalizeForAddressSearch(query);
  if (!q) {
    return true;
  }
  return normalizeForAddressSearch(adres).includes(q);
}

/**
 * Wyszukiwarka mapy: dopasowanie do adresu punktu albo do kolumn A/B (podmiot, sklep).
 * Pusty query = wszystkie punkty.
 */
export function mapPointMatchesSearch(adres: string, searchLabels: string[], query: string): boolean {
  const q = normalizeForAddressSearch(query);
  if (!q) {
    return true;
  }
  if (normalizeForAddressSearch(adres).includes(q)) {
    return true;
  }
  for (const label of searchLabels) {
    if (normalizeForAddressSearch(label).includes(q)) {
      return true;
    }
  }
  return false;
}

/** Klucz sklepu w rejestrze transportów (podmiot + adres, ta sama normalizacja co Apps Script). */
export function buildTransportShopKey(podmiot: string, adres: string): string {
  return `${normalizeForAddressSearch(podmiot)}\u0000${normalizeForAddressSearch(adres)}`;
}

export interface TransportCutoffPoint {
  podmiotHandlowy?: string;
  podmiotyHandlowe?: string[];
  adres: string;
}

/**
 * Ostatnia data transportu (ms UTC) dla punktu mapy.
 * Wymaga dopasowania **podmiot + adres** — próbuje wszystkich podmiotów przypisanych do punktu.
 */
export function resolveTransportCutoffMsForPoint(
  point: TransportCutoffPoint,
  byKey: Record<string, number>,
): number | null {
  if (!byKey) {
    return null;
  }
  const normAdres = normalizeForAddressSearch(point.adres);
  if (normAdres.length === 0) {
    return null;
  }

  const podmioty: string[] = [];
  const addPodmiot = (raw: string | undefined): void => {
    const t = String(raw ?? '').trim();
    if (t.length === 0) {
      return;
    }
    if (podmioty.some((existing) => normalizeForAddressSearch(existing) === normalizeForAddressSearch(t))) {
      return;
    }
    podmioty.push(t);
  };
  addPodmiot(point.podmiotHandlowy);
  if (point.podmiotyHandlowe) {
    for (const p of point.podmiotyHandlowe) {
      addPodmiot(p);
    }
  }
  if (podmioty.length === 0) {
    return null;
  }

  let best: number | null = null;
  for (const podmiot of podmioty) {
    const ms = byKey[buildTransportShopKey(podmiot, point.adres)];
    if (ms != null && Number.isFinite(ms) && (best == null || ms > best)) {
      best = ms;
    }
  }

  return best;
}

/** Filtr warstwy zbiórki na mapie (domyślnie: wszystkie punkty). */
export type ZbiorkaFilterMode = 'wszystkie' | 'obie' | 'reczna' | 'maszyna';

export type MapPointZbiorkaKind = 'obie' | 'reczna' | 'maszyna' | 'unknown';

export interface ZbiorkaFlags {
  hasReczna: boolean;
  hasMaszyna: boolean;
}

/** Parsuje agregat kolumny zbiórki (jak {@link aggregateZbiorka} / popup na mapie). */
export function parseZbiorkaFlags(zbiorka: string | undefined): ZbiorkaFlags {
  const raw = (zbiorka ?? '').trim();
  if (raw.length === 0) {
    return { hasReczna: false, hasMaszyna: false };
  }
  const lower = raw.toLowerCase();
  const segments = lower
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const toScan = segments.length > 0 ? segments : [lower];
  let hasReczna = false;
  let hasMaszyna = false;
  for (const seg of toScan) {
    if (seg.includes('ręcz') || seg === 'r') {
      hasReczna = true;
    } else if (seg.includes('maszyn') || seg === 'm' || seg.includes('automat')) {
      hasMaszyna = true;
    }
  }
  return { hasReczna, hasMaszyna };
}

/** Klasyfikacja punktu mapy wg trybu zbiórki. */
export function classifyMapPointZbiorka(zbiorka: string | undefined): MapPointZbiorkaKind {
  const { hasReczna, hasMaszyna } = parseZbiorkaFlags(zbiorka);
  if (hasReczna && hasMaszyna) {
    return 'obie';
  }
  if (hasReczna) {
    return 'reczna';
  }
  if (hasMaszyna) {
    return 'maszyna';
  }
  return 'unknown';
}

/** Czy punkt jest widoczny przy wybranym filtrze zbiórki. */
export function mapPointMatchesZbiorkaFilter(
  zbiorka: string | undefined,
  mode: ZbiorkaFilterMode,
): boolean {
  if (mode === 'wszystkie') {
    return true;
  }
  return classifyMapPointZbiorka(zbiorka) === mode;
}

/** Unikalne wartości kolumny A z wierszy punktu (deduplikacja po {@link normalizeForAddressSearch}). */
export function uniquePodmiotyHandloweFromRows(rows: SheetRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const t = String(r.podmiotHandlowy ?? '').trim();
    if (t.length === 0) {
      continue;
    }
    const key = normalizeForAddressSearch(t);
    if (key.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** Wartości A/B z wierszy punktu (deduplikacja po {@link normalizeForAddressSearch}). */
function uniqueSearchLabelsFromRows(rows: SheetRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    for (const raw of [r.podmiotHandlowy, r.sklep]) {
      const t = String(raw ?? '').trim();
      if (t.length === 0) {
        continue;
      }
      const key = normalizeForAddressSearch(t);
      if (key.length === 0 || seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

function toMapPoint(item: GeocodedAddress, confidence: MapPoint['confidence']): MapPoint {
  return {
    adres: item.address,
    count: item.count,
    lat: item.lat,
    lng: item.lng,
    markerLat: item.lat,
    markerLng: item.lng,
    woj: item.wojewodztwo || 'Nieznane',
    confidence,
    searchLabels: uniqueSearchLabelsFromRows(item.rows),
    podmiotyHandlowe: uniquePodmiotyHandloweFromRows(item.rows),
    podmiotHandlowy: firstPodmiotHandlowyFromRows(item.rows),
    sklep: firstSklepFromRows(item.rows),
    sealRows: sealRowsFromSheetRows(item.rows),
    zbiorka: item.zbiorka,
    rodzaj_zbiorki: formatRodzajZbiorkiForDoc(item.zbiorka),
    doc: buildMapPointDocPayload(item.rows),
  };
}

/** Palety: jasny (1–3), ciemny (4–9), żółty (10–14). Dla 15+ używany COLOR_15_PLUS (pomarańczowy). */
const PALETTE_OK = ['#97F0C7', '#198754', COLOR_10_14] as const;
const PALETTE_UNCERTAIN = ['#D1A5A9', '#D40418', COLOR_10_14] as const;

export function buildMapHtml(
  geocoded: GeocodedAddress[],
  uncertainGeocoded: GeocodedAddress[],
  geoJsonUrl: string,
  cityOnlyGeocoded: GeocodedAddress[] = [],
  geocodedNoPostcode: GeocodedAddress[] = [],
  wordEmbed: WordMapHtmlEmbed | null = null,
  transportWebAppUrl: string = '',
): string {
  const rawPoints: MapPoint[] = [
    ...geocoded.map((item) => toMapPoint(item, 'ok')),
    ...geocodedNoPostcode.map((item) => toMapPoint(item, 'ok_no_postcode')),
    ...uncertainGeocoded.map((item) => toMapPoint(item, 'uncertain')),
    ...cityOnlyGeocoded.map((item) => toMapPoint(item, 'city_only')),
  ];
  const points: MapPoint[] = spreadCloseMarkerPositions(rawPoints);

  const presentConfidences = [...new Set(points.map((p) => p.confidence))];
  const legendQualityItems = presentConfidences.map((c) => ({
    label: LEGEND_QUALITY[c].label,
    color: LEGEND_QUALITY[c].color,
  }));
  const hasAnyPoints = points.length > 0;
  const showZbiorkaFilter = points.some((p) => classifyMapPointZbiorka(p.zbiorka) !== 'unknown');
  const wordEnabled = Boolean(wordEmbed?.templateBase64);
  const transportApiEnabled = wordEnabled && transportWebAppUrl.length > 0;

  const wordModal = wordEnabled
    ? `  <div id="doc-modal" class="doc-modal-overlay" style="display:none" aria-hidden="true">
    <div class="doc-modal-panel" role="dialog" aria-labelledby="doc-modal-title">
      <h3 id="doc-modal-title">Generuj dokument Word</h3>
      <label for="doc-sel-przewoznik">Przewoźnik</label>
      <div class="doc-combobox-wrap">
        <input type="text" id="doc-sel-przewoznik" class="doc-combobox-input" autocomplete="off" spellcheck="false" placeholder="Wpisz fragment nazwy lub danych…" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="doc-sel-przewoznik-list" />
        <input type="hidden" id="doc-val-przewoznik" value="" />
        <ul id="doc-sel-przewoznik-list" class="doc-combobox-list" role="listbox" hidden></ul>
      </div>
      <label for="doc-sel-miejsce">Miejsce dostawy</label>
      <div class="doc-combobox-wrap">
        <input type="text" id="doc-sel-miejsce" class="doc-combobox-input" autocomplete="off" spellcheck="false" placeholder="Wpisz fragment nazwy lub danych…" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="doc-sel-miejsce-list" />
        <input type="hidden" id="doc-val-miejsce" value="" />
        <ul id="doc-sel-miejsce-list" class="doc-combobox-list" role="listbox" hidden></ul>
      </div>
      <label for="doc-inp-data-zaladunku">Data załadunku</label>
      <input type="date" id="doc-inp-data-zaladunku" />
      <div id="doc-bulk-points-wrap" class="doc-bulk-points-wrap" hidden>
        <p class="doc-bulk-points-title">Wybrane punkty</p>
        <ul id="doc-bulk-points-list" class="doc-bulk-points-list"></ul>
      </div>
      <div id="doc-single-numer-wrap">
        <label for="doc-inp-numer-zlecenia">Numer dokumentu (zlecenie transportowe)</label>
        <input type="text" id="doc-inp-numer-zlecenia" maxlength="120" placeholder="np. 1460" autocomplete="off" spellcheck="false" />
      </div>
      <p id="doc-bulk-numer-info" class="doc-bulk-numer-info" hidden aria-live="polite"></p>
      <p id="doc-filter-info" class="doc-filter-info" aria-live="polite"></p>
      <div class="doc-modal-actions">
        <button type="button" id="doc-btn-cancel">Anuluj</button>
        <button type="button" id="doc-btn-ok">Pobierz .docx</button>
      </div>
    </div>
  </div>
`
    : '';

  const docStyles = wordEnabled
    ? `
    .btn-gen-doc { margin-top: 8px; padding: 6px 12px; cursor: pointer; border-radius: 6px; border: 1px solid #0d6efd; background: #0d6efd; color: #fff; font-size: 13px; width: 100%; }
    .btn-gen-doc:hover { filter: brightness(1.05); }
    .btn-gen-doc:disabled { opacity: 0.45; cursor: not-allowed; filter: none; background: #adb5bd; border-color: #adb5bd; }
    .btn-gen-doc:disabled:hover { filter: none; }
    .doc-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 20000; align-items: center; justify-content: center; }
    .doc-modal-panel { background: #fff; padding: 20px 22px; border-radius: 10px; max-width: 420px; width: 90%; box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
    .doc-modal-panel h3 { margin: 0 0 14px 0; font-size: 16px; }
    .doc-modal-panel label { display: block; font-size: 13px; margin: 10px 0 4px; color: #333; }
    .doc-modal-panel input[type="date"], .doc-modal-panel input[type="text"], .doc-modal-panel .doc-combobox-input { width: 100%; padding: 8px 10px; font-size: 14px; border-radius: 6px; border: 1px solid #ccc; box-sizing: border-box; }
    .doc-combobox-wrap { position: relative; }
    .doc-combobox-list { position: absolute; left: 0; right: 0; top: calc(100% + 2px); max-height: 220px; overflow-y: auto; z-index: 10; margin: 0; padding: 0; list-style: none; background: #fff; border: 1px solid #ccc; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.12); }
    .doc-combobox-list li { padding: 8px 10px; cursor: pointer; font-size: 14px; }
    .doc-combobox-list li:hover, .doc-combobox-list li.doc-combobox-active { background: #e7f1ff; }
    .doc-combobox-list li.doc-combobox-empty { color: #666; cursor: default; }
    .doc-combobox-list li.doc-combobox-empty:hover { background: transparent; }
    .doc-modal-actions { margin-top: 16px; display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; }
    .doc-modal-actions button { padding: 8px 14px; border-radius: 6px; cursor: pointer; font-size: 14px; border: 1px solid #ccc; background: #f8f9fa; }
    .doc-filter-info { font-size: 12px; color: #555; margin: 8px 0 0; min-height: 1.2em; }
    .doc-bulk-points-wrap { margin-top: 8px; max-height: 160px; overflow-y: auto; border: 1px solid #e8e8e8; border-radius: 6px; padding: 8px 10px; background: #fafafa; }
    .doc-bulk-points-title { font-size: 12px; font-weight: 600; margin: 0 0 6px; color: #333; }
    .doc-bulk-points-list { margin: 0; padding: 0 0 0 16px; font-size: 12px; color: #444; line-height: 1.45; }
    .doc-bulk-numer-info { font-size: 12px; color: #0d6efd; margin: 8px 0 0; min-height: 1.2em; }
    .popup-bulk-select { display: flex; align-items: center; gap: 6px; font-size: 12px; margin-top: 8px; cursor: pointer; color: #333; }
    .popup-bulk-select input { margin: 0; flex-shrink: 0; }
    .map-bulk-panel { margin-top: 10px; padding-top: 10px; border-top: 1px solid #e8e8e8; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .map-bulk-panel[hidden] { display: none !important; }
    .map-bulk-count { font-size: 12px; color: #333; flex: 1; min-width: 120px; }
    .map-bulk-generate { padding: 6px 10px; font-size: 12px; border-radius: 6px; border: 1px solid #198754; background: #198754; color: #fff; cursor: pointer; }
    .map-bulk-generate:hover { filter: brightness(1.05); }
    .map-bulk-clear { padding: 6px 10px; font-size: 12px; border-radius: 6px; border: 1px solid #ccc; background: #f8f9fa; cursor: pointer; }
    #doc-btn-ok { background: #198754; border-color: #198754; color: #fff; }
`
    : '';

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mapa adresów</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; }
    #map { width: 100%; height: 100vh; }
    .leaflet-popup-content-wrapper { border-radius: 8px; }
    .leaflet-popup-content { margin: 12px 16px; min-width: 220px; }
    .popup-address { font-weight: 600; margin-bottom: 6px; color: #1a1a1a; }
    .popup-podmiot { font-size: 0.92em; color: #333; margin-bottom: 6px; }
    .popup-count { color: #0d6efd; font-size: 1.05em; }
    .popup-count-detail { font-size: 0.88em; color: #555; margin-top: 4px; }
    .popup-woj { font-size: 0.85em; color: #555; margin-top: 4px; }
    .popup-zbiorka { font-size: 0.85em; color: #0d6efd; margin-top: 4px; }
    .popup-confidence { font-size: 0.85em; color: #b02a37; margin-top: 4px; font-weight: 600; }
    .pin-woj { background: none !important; border: none !important; }
    .map-legend { background: #fff; padding: 10px 14px; border-radius: 8px; box-shadow: 0 1px 5px rgba(0,0,0,0.4); font-size: 12px; line-height: 1.5; }
    .map-legend h3 { margin: 0 0 6px 0; font-size: 13px; }
    .map-legend ul { margin: 0; padding: 0; list-style: none; }
    .map-legend li { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .map-legend li:last-child { margin-bottom: 0; }
    .map-legend .legend-swatch { width: 14px; height: 14px; border-radius: 50%; border: 1px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,0.2); flex-shrink: 0; }
    .map-legend .legend-section { margin-bottom: 10px; }
    .map-legend .legend-section:last-child { margin-bottom: 0; }
    .map-search-panel { background: #fff; padding: 10px 12px; border-radius: 8px; box-shadow: 0 1px 5px rgba(0,0,0,0.35); min-width: 220px; max-width: min(420px, calc(100vw - 48px)); }
    .map-search-label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px; color: #333; }
    .map-search-input-row { display: flex; align-items: center; gap: 8px; }
    .map-search-input { flex: 1; min-width: 0; padding: 8px 10px; font-size: 14px; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; }
    .map-zoom-inline { display: flex; flex-direction: row; flex-shrink: 0; }
    .map-zoom-inline button { width: 32px; height: 32px; padding: 0; border: 1px solid #ccc; background: #fff; cursor: pointer; font-size: 18px; line-height: 1; color: #333; display: flex; align-items: center; justify-content: center; }
    .map-zoom-inline button:hover { background: #f4f4f4; }
    .map-zoom-inline button:first-child { border-radius: 4px 0 0 4px; border-right: none; }
    .map-zoom-inline button:last-child { border-radius: 0 4px 4px 0; }
    .map-search-status { margin-top: 6px; font-size: 11px; color: #555; min-height: 1.2em; }
    .map-zbiorka-filter { margin-top: 10px; padding-top: 10px; border-top: 1px solid #e8e8e8; }
    .map-zbiorka-filter-title { display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px; color: #333; }
    .map-zbiorka-filter-options { display: flex; flex-direction: column; gap: 4px; }
    .map-zbiorka-filter-options label { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 400; color: #444; cursor: pointer; margin: 0; }
    .map-zbiorka-filter-options input { margin: 0; flex-shrink: 0; }
${
  transportApiEnabled
    ? `    .map-transport-loader { position: fixed; z-index: 15000; left: 50%; top: 14px; transform: translateX(-50%); pointer-events: none; }
    .map-transport-loader[hidden] { display: none !important; }
    .map-transport-loader-panel { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: rgba(255,255,255,0.96); border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,0.18); font-size: 13px; color: #333; border: 1px solid #dee2e6; }
    .map-transport-loader-spinner { width: 18px; height: 18px; border: 2px solid #dee2e6; border-top-color: #0d6efd; border-radius: 50%; animation: map-transport-spin 0.75s linear infinite; flex-shrink: 0; }
    @keyframes map-transport-spin { to { transform: rotate(360deg); } }
`
    : ''
}${docStyles}  </style>
</head>
<body>
  <div id="map"></div>
${
  transportApiEnabled
    ? `  <div id="map-transport-loader" class="map-transport-loader" role="status" aria-live="polite" aria-busy="true">
    <div class="map-transport-loader-panel">
      <span class="map-transport-loader-spinner" aria-hidden="true"></span>
      <span>Pobieranie danych transportu…</span>
    </div>
  </div>
`
    : ''
}${wordModal}  <script>
    const adresy = ${JSON.stringify(points)};
    const legendQualityItems = ${JSON.stringify(legendQualityItems)};
    const hasCountLegend = ${JSON.stringify(hasAnyPoints)};
    const showZbiorkaFilter = ${JSON.stringify(showZbiorkaFilter)};
    const wordDocEnabled = ${JSON.stringify(wordEnabled)};
    const transportApiEnabled = ${JSON.stringify(transportApiEnabled)};
    const TRANSPORT_WEBAPP_URL = ${JSON.stringify(transportWebAppUrl)};
    const PODWYKOLISTA = ${JSON.stringify(wordEmbed?.podwykoOptions ?? [])};
    const WORD_TEMPLATE_B64 = ${JSON.stringify(wordEmbed?.templateBase64 ?? '')};

    const map = L.map('map', { zoomControl: false }).setView([52.1, 19.4], 6);
    var attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
    var layerCarto = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
      subdomains: 'abcd',
      maxZoom: 19,
      attribution: '&copy; <a href="https://carto.com/attributions/">CARTO</a> | ' + attribution
    });
    var layerTileServerS = L.tileLayer('https://tileservers.com/hot/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://tileservers.com/">TileServers</a> | ' + attribution
    });
    layerCarto.addTo(map);
    var cartoTileErrors = 0;
    var cartoTileLoaded = false;
    var cartoFallbackActive = false;
    var CARTO_FALLBACK_MIN_ERRORS = 4;
    function activateCartoFallback() {
      if (cartoFallbackActive) return;
      cartoFallbackActive = true;
      layerCarto.off('tileerror');
      layerCarto.off('tileload');
      map.removeLayer(layerCarto);
      map.addLayer(layerTileServerS);
    }
    layerCarto.on('tileerror', function() {
      if (cartoFallbackActive || cartoTileLoaded) return;
      cartoTileErrors++;
      if (cartoTileErrors >= CARTO_FALLBACK_MIN_ERRORS) {
        activateCartoFallback();
      }
    });
    layerCarto.on('tileload', function() {
      cartoTileLoaded = true;
      cartoTileErrors = 0;
    });

    var colorBulkSelected = ${JSON.stringify(COLOR_BULK_SELECTED)};
    function pinIcon(kolor, highlight) {
      var shadow = highlight
        ? '0 0 0 3px #ea3aed, 0 1px 4px rgba(0,0,0,0.45)'
        : '0 1px 4px rgba(0,0,0,0.4)';
      return L.divIcon({
        className: 'pin-woj',
        html: '<span style="display:block;width:24px;height:24px;border-radius:50%;background:' + kolor + ';border:2px solid #fff;box-shadow:' + shadow + '"></span>',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12]
      });
    }
    function markerDisplayIcon(entry, searchHighlight) {
      var selected = isBulkPointSelected(entry.pointIdx);
      var fill = selected ? colorBulkSelected : entry.kolor;
      return pinIcon(fill, selected || searchHighlight);
    }
    function normalizeForAddressSearchMap(text) {
      var s = String(text).normalize('NFD').replace(/\\p{M}/gu, '');
      s = s
        .replace(/ł/g, 'l')
        .replace(/Ł/g, 'l')
        .replace(/ą/g, 'a')
        .replace(/Ą/g, 'a')
        .replace(/ć/g, 'c')
        .replace(/Ć/g, 'c')
        .replace(/ę/g, 'e')
        .replace(/Ę/g, 'e')
        .replace(/ń/g, 'n')
        .replace(/Ń/g, 'n')
        .replace(/ó/g, 'o')
        .replace(/Ó/g, 'o')
        .replace(/ś/g, 's')
        .replace(/Ś/g, 's')
        .replace(/ź/g, 'z')
        .replace(/Ź/g, 'z')
        .replace(/ż/g, 'z')
        .replace(/Ż/g, 'z');
      return s
        .toLowerCase()
        .replace(/\\s+/g, ' ')
        .trim();
    }
    function mapPointMatchesSearchMap(p, query) {
      var q = normalizeForAddressSearchMap(query);
      if (!q) return true;
      if (normalizeForAddressSearchMap(p.adres).indexOf(q) !== -1) return true;
      var labels = p.searchLabels || [];
      for (var i = 0; i < labels.length; i++) {
        if (normalizeForAddressSearchMap(String(labels[i])).indexOf(q) !== -1) return true;
      }
      return false;
    }
    function parseZbiorkaFlagsMap(zbiorka) {
      var raw = String(zbiorka || '').trim();
      if (!raw) return { hasReczna: false, hasMaszyna: false };
      var lower = raw.toLowerCase();
      var segments = lower.split('/').map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });
      var toScan = segments.length > 0 ? segments : [lower];
      var hasReczna = false, hasMaszyna = false;
      for (var i = 0; i < toScan.length; i++) {
        var seg = toScan[i];
        if (seg.indexOf('ręcz') !== -1 || seg === 'r') hasReczna = true;
        else if (seg.indexOf('maszyn') !== -1 || seg === 'm' || seg.indexOf('automat') !== -1) hasMaszyna = true;
      }
      return { hasReczna: hasReczna, hasMaszyna: hasMaszyna };
    }
    function classifyMapPointZbiorkaMap(zbiorka) {
      var f = parseZbiorkaFlagsMap(zbiorka);
      if (f.hasReczna && f.hasMaszyna) return 'obie';
      if (f.hasReczna) return 'reczna';
      if (f.hasMaszyna) return 'maszyna';
      return 'unknown';
    }
    function mapPointMatchesZbiorkaFilterMap(zbiorka, mode) {
      if (mode === 'wszystkie') return true;
      return classifyMapPointZbiorkaMap(zbiorka) === mode;
    }
    function getZbiorkaFilterMode() {
      var el = document.querySelector('input[name="map-zbiorka-filter"]:checked');
      return el ? String(el.value) : 'wszystkie';
    }
    function setMarkerClickable(marker, clickable) {
      var el = marker.getElement ? marker.getElement() : null;
      if (el) el.style.pointerEvents = clickable ? '' : 'none';
    }

    function hexToRgb(hex) {
      var n = parseInt(hex.slice(1), 16);
      return [ (n >> 16) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255 ];
    }
    function rgbToHex(r, g, b) {
      return '#' + [r,g,b].map(function(x) {
        var v = Math.round(Math.max(0, Math.min(1, x)) * 255);
        return (v < 16 ? '0' : '') + v.toString(16);
      }).join('');
    }
    function hexWithSaturation(hex, satFactor) {
      var rgb = hexToRgb(hex);
      var r = rgb[0], g = rgb[1], b = rgb[2];
      var max = Math.max(r, g, b), min = Math.min(r, g, b);
      var l = (max + min) / 2, h, s;
      if (max === min) { h = s = 0; }
      else {
        var d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
          case g: h = ((b - r) / d + 2) / 6; break;
          default: h = ((r - g) / d + 4) / 6;
        }
      }
      s = Math.min(1, s * satFactor);
      if (s === 0) return rgbToHex(l, l, l);
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      var hue2rgb = function(p, q, t) {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      return rgbToHex(hue2rgb(p, q, h + 1/3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1/3));
    }
    var paletteOk = ${JSON.stringify([...PALETTE_OK])};
    var paletteUncertain = ${JSON.stringify([...PALETTE_UNCERTAIN])};
    var color15Plus = ${JSON.stringify(COLOR_15_PLUS)};
    function kolorPinezki(confidence, count) {
      if (count >= 15) return color15Plus;
      var idx = count >= 10 ? 2 : count >= 4 ? 1 : 0;
      if (confidence === 'ok' || confidence === 'ok_no_postcode') return paletteOk[idx];
      if (confidence === 'uncertain') return paletteUncertain[idx];
      var kolorBazowy = '#0d6efd';
      if (count >= 10) return ${JSON.stringify(COLOR_10_14)};
      if (count >= 4) return kolorBazowy;
      return hexWithSaturation(kolorBazowy, 0.35);
    }

    function buildTransportShopKeyMap(podmiot, adres) {
      return normalizeForAddressSearchMap(podmiot) + '\\0' + normalizeForAddressSearchMap(adres);
    }
    function getPointTransportCutoff(p) {
      var byKey = window.__transportDateByKey;
      if (!byKey) return null;
      if (!normalizeForAddressSearchMap(p.adres)) return null;
      var podmioty = [];
      function addPodmiot(raw) {
        var t = String(raw || '').trim();
        if (!t) return;
        var nk = normalizeForAddressSearchMap(t);
        for (var i = 0; i < podmioty.length; i++) {
          if (normalizeForAddressSearchMap(podmioty[i]) === nk) return;
        }
        podmioty.push(t);
      }
      addPodmiot(p.podmiotHandlowy);
      if (p.podmiotyHandlowe) {
        for (var pi = 0; pi < p.podmiotyHandlowe.length; pi++) addPodmiot(p.podmiotyHandlowe[pi]);
      }
      if (podmioty.length === 0) return null;
      var best = null;
      for (var pj = 0; pj < podmioty.length; pj++) {
        var ms = byKey[buildTransportShopKeyMap(podmioty[pj], p.adres)];
        if (ms != null && isFinite(ms) && (best == null || ms > best)) best = ms;
      }
      return best;
    }
    function countSealRows(sealRows) {
      return (sealRows || []).length;
    }
    function getPointSealCounts(p) {
      var total = countSealRows(p.sealRows);
      if (total === 0) total = p.count || 0;
      var cutoffMs = transportApiEnabled && window.__transportDatesLoaded ? getPointTransportCutoff(p) : null;
      var filtered = cutoffMs != null
        ? filterSealRowsByMinDate(p.sealRows || [], cutoffMs).length
        : total;
      var cutoffYmd = null;
      if (cutoffMs != null) {
        var d = new Date(cutoffMs);
        cutoffYmd = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
      }
      return { total: total, filtered: filtered, cutoffMs: cutoffMs, cutoffYmd: cutoffYmd };
    }
    function displayCountForPoint(p) {
      return getPointSealCounts(p).filtered;
    }
    function buildPopupCountHtml(p) {
      var c = getPointSealCounts(p);
      if (transportApiEnabled && !window.__transportDatesLoaded) {
        return '<div class="popup-count">Worki do odebrania: <strong>…</strong></div>' +
          '<div class="popup-count-detail">Trwa pobieranie danych transportu</div>';
      }
      if (!transportApiEnabled) {
        return '<div class="popup-count">Liczba wystąpień: <strong>' + c.total + '</strong></div>';
      }
      var main = '<div class="popup-count">Worki do odebrania: <strong>' + c.filtered + '</strong></div>';
      var transportDate = c.cutoffYmd
        ? '<div class="popup-count-detail">Ostatni transport: ' + formatYmdToDisplay(c.cutoffYmd) + '</div>'
        : '';
      return main + transportDate + '<div class="popup-count-detail">Wszystkie worki: ' + c.total + '</div>';
    }
    function buildPopupContent(p, pointIdx) {
      var confidenceLabel =
        p.confidence === 'uncertain'
          ? '<div class="popup-confidence">Wynik niepewny</div>'
          : p.confidence === 'city_only'
            ? '<div class="popup-confidence">Tylko kod+miasto</div>'
            : p.confidence === 'ok_no_postcode'
              ? '<div class="popup-confidence">Bez kodu w wyniku</div>'
              : '';
      var zbiorkaLine = p.zbiorka
        ? '<div class="popup-zbiorka">Zbiórka: ' + p.zbiorka + '</div>'
        : '';
      var podmiotLine =
        p.podmiotyHandlowe && p.podmiotyHandlowe.length > 0
          ? '<div class="popup-podmiot">Podmiot handlowy: ' + p.podmiotyHandlowe.join(', ') + '</div>'
          : '';
      var bulkSelected = isBulkPointSelected(pointIdx);
      var genDocBtn = wordDocEnabled
        ? '<div><button type="button" class="btn-gen-doc"' + (bulkSelected ? ' disabled' : '') +
          '>Generuj dokument</button></div>'
        : '';
      var bulkSelect = wordDocEnabled
        ? '<label class="popup-bulk-select"><input type="checkbox" class="popup-bulk-cb" data-point-idx="' + pointIdx + '"' +
          (window.__bulkSelectedPointIdxs && window.__bulkSelectedPointIdxs[pointIdx] ? ' checked' : '') +
          ' /> Zaznacz do zbiorczego protokołu</label>'
        : '';
      return '<div class="popup-address">' + p.adres + '</div>' +
        (podmiotLine || '') +
        buildPopupCountHtml(p) +
        (zbiorkaLine || '') +
        '<div class="popup-woj">' + p.woj + '</div>' +
        confidenceLabel +
        bulkSelect +
        genDocBtn;
    }
    window.__bulkSelectedPointIdxs = window.__bulkSelectedPointIdxs || {};
    function getBulkSelectedIndices() {
      var out = [];
      var sel = window.__bulkSelectedPointIdxs || {};
      Object.keys(sel).forEach(function (k) {
        if (sel[k]) {
          var idx = parseInt(k, 10);
          if (!isNaN(idx) && adresy[idx]) out.push(idx);
        }
      });
      out.sort(function (a, b) { return a - b; });
      return out;
    }
    function isBulkPointSelected(pointIdx) {
      return !!(window.__bulkSelectedPointIdxs && window.__bulkSelectedPointIdxs[pointIdx]);
    }
    function setBulkPointSelected(pointIdx, selected) {
      if (!window.__bulkSelectedPointIdxs) window.__bulkSelectedPointIdxs = {};
      if (selected) {
        window.__bulkSelectedPointIdxs[pointIdx] = true;
      } else {
        delete window.__bulkSelectedPointIdxs[pointIdx];
      }
      updateBulkSelectionUi();
    }
    function clearBulkSelection() {
      window.__bulkSelectedPointIdxs = {};
      updateBulkSelectionUi();
    }
    function updateBulkSelectionUi() {
      var indices = getBulkSelectedIndices();
      var panel = document.getElementById('map-bulk-panel');
      var countEl = document.getElementById('map-bulk-count');
      if (panel) panel.hidden = indices.length === 0;
      if (countEl) {
        countEl.textContent = indices.length === 1
          ? '1 punkt zaznaczony'
          : indices.length + ' punktów zaznaczonych';
      }
      if (typeof markerEntries !== 'undefined') {
        markerEntries.forEach(function (entry) {
          var inputEl = document.getElementById('map-address-search');
          var raw = inputEl ? inputEl.value : '';
          var hasSearchFilter = String(raw).trim().length > 0;
          var sMatch = !hasSearchFilter || mapPointMatchesSearchMap(entry.p, raw);
          entry.marker.setIcon(markerDisplayIcon(entry, hasSearchFilter && sMatch));
        });
      }
    }
    function wirePopupControls(marker, pointIdx) {
      if (!wordDocEnabled) return;
      var el = marker.getPopup().getElement();
      if (!el) return;
      var cb = el.querySelector('.popup-bulk-cb');
      if (cb) {
        cb.onchange = function () {
          setBulkPointSelected(pointIdx, cb.checked);
          marker.setPopupContent(buildPopupContent(adresy[pointIdx], pointIdx));
          wirePopupControls(marker, pointIdx);
        };
      }
      var btn = el.querySelector('.btn-gen-doc');
      if (!btn || btn.disabled) return;
      btn.onclick = function (ev) {
        if (ev.stopPropagation) ev.stopPropagation();
        openDocModal(pointIdx);
      };
    }
    function refreshMarkerDisplay(entry) {
      var p = entry.p;
      var displayCount = displayCountForPoint(p);
      var kolor = kolorPinezki(p.confidence, displayCount);
      entry.kolor = kolor;
      entry.marker.setIcon(markerDisplayIcon(entry, false));
      entry.marker.setPopupContent(buildPopupContent(p, entry.pointIdx));
    }
    function setTransportDatesLoading(loading) {
      var el = document.getElementById('map-transport-loader');
      if (!el) return;
      el.hidden = !loading;
      el.setAttribute('aria-busy', loading ? 'true' : 'false');
    }
    function loadBulkTransportDates() {
      window.__transportDateByKey = {};
      window.__transportDatesLoaded = false;
      if (!transportApiEnabled) {
        window.__transportDatesLoaded = true;
        setTransportDatesLoading(false);
        return Promise.resolve();
      }
      setTransportDatesLoading(true);
      return fetchTransportGet({ action: 'bulkLastTransportDates' }).then(function (resp) {
        var byKey = {};
        if (resp && resp.ok && resp.shops) {
          resp.shops.forEach(function (s) {
            if (s && s.key != null && s.lastTransportDateMs != null) {
              byKey[s.key] = s.lastTransportDateMs;
            }
          });
        }
        window.__transportDateByKey = byKey;
        window.__transportDatesLoaded = true;
        markerEntries.forEach(function (entry) {
          refreshMarkerDisplay(entry);
        });
      }).catch(function (err) {
        console.error(err);
        window.__transportDatesLoaded = true;
        markerEntries.forEach(function (entry) {
          refreshMarkerDisplay(entry);
        });
      }).then(function () {
        setTransportDatesLoading(false);
      });
    }
    function podwykoOptionMatchesQuery(opt, query) {
      var q = normalizeForAddressSearchMap(query);
      if (!q) return true;
      if (normalizeForAddressSearchMap(opt.label).indexOf(q) !== -1) return true;
      if (normalizeForAddressSearchMap(opt.dane).indexOf(q) !== -1) return true;
      return false;
    }
    var docComboboxInited = false;
    function hideDocComboboxList(listEl, inputEl) {
      if (!listEl) return;
      listEl.hidden = true;
      listEl.innerHTML = '';
      if (inputEl) inputEl.setAttribute('aria-expanded', 'false');
    }
    function showDocComboboxList(listEl, inputEl) {
      if (!listEl) return;
      listEl.hidden = false;
      if (inputEl) inputEl.setAttribute('aria-expanded', 'true');
    }
    var DOC_LS_PRZEWOZNIK = 'arkusz-mapa-doc-last-przewoznik-label';
    var DOC_LS_MIEJSCE = 'arkusz-mapa-doc-last-miejsce-label';
    var DOC_LISTA_PLOMB_HP = '28';
    function saveDocComboboxLastLabel(storageKey, label) {
      if (!storageKey || !label) return;
      try { localStorage.setItem(storageKey, label); } catch (e) {}
    }
    function parseSealClosureDateMs(raw) {
      var s = String(raw || '').trim();
      if (!s) return Number.NEGATIVE_INFINITY;
      var iso = s.match(/^(\\d{4})-(\\d{1,2})-(\\d{1,2})(?:\\b|T)/);
      if (iso) {
        var month = parseInt(iso[2], 10);
        var day = parseInt(iso[3], 10);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          return Date.UTC(parseInt(iso[1], 10), month - 1, day);
        }
      }
      var dmy = s.match(/^(\\d{1,2})[./-](\\d{1,2})[./-](\\d{2,4})\\b/);
      if (dmy) {
        var day2 = parseInt(dmy[1], 10);
        var month2 = parseInt(dmy[2], 10);
        var y = parseInt(dmy[3], 10);
        if (y < 100) y = y >= 70 ? 1900 + y : 2000 + y;
        if (month2 >= 1 && month2 <= 12 && day2 >= 1 && day2 <= 31) {
          return Date.UTC(y, month2 - 1, day2);
        }
      }
      if (/^\\d{5,6}$/.test(s)) {
        var serial = parseInt(s, 10);
        if (serial >= 20000 && serial <= 80000) {
          var ms = (serial - 25569) * 86400000;
          var d = new Date(ms);
          if (!isNaN(d.getTime())) {
            return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
          }
        }
      }
      var parsed = Date.parse(s);
      if (!isNaN(parsed)) {
        var d2 = new Date(parsed);
        return Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());
      }
      return Number.NEGATIVE_INFINITY;
    }
    function filterSealRowsByMinDate(sealRows, minDateMs) {
      if (minDateMs == null || !isFinite(minDateMs)) {
        return (sealRows || []).slice();
      }
      return (sealRows || []).filter(function (r) {
        var ms = parseSealClosureDateMs(r.dataZamknieciaWorka);
        if (!isFinite(ms) || ms === Number.NEGATIVE_INFINITY) return false;
        return ms >= minDateMs;
      });
    }
    function formatSealDateMmDd(raw) {
      var s = String(raw || '').trim();
      if (!s) return '';
      var iso = s.match(/^(\\d{4})-(\\d{1,2})-(\\d{1,2})(?:\\b|T)/);
      if (iso) {
        return String(parseInt(iso[2], 10)).padStart(2, '0') + '-' + String(parseInt(iso[3], 10)).padStart(2, '0');
      }
      var dmy = s.match(/^(\\d{1,2})[./-](\\d{1,2})[./-](\\d{2,4})\\b/);
      if (dmy) {
        return String(parseInt(dmy[2], 10)).padStart(2, '0') + '-' + String(parseInt(dmy[1], 10)).padStart(2, '0');
      }
      return '';
    }
    function formatRodzajZbiorkiSeal(zbiorka) {
      var raw = String(zbiorka || '').trim();
      if (!raw) return '';
      var lower = raw.toLowerCase();
      var segments = lower.split('/').map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
      var toScan = segments.length > 0 ? segments : [lower];
      var hasReczna = false, hasMaszyna = false;
      for (var i = 0; i < toScan.length; i++) {
        var seg = toScan[i];
        if (seg.indexOf('ręcz') !== -1 || seg.indexOf('recz') !== -1 || seg === 'r') hasReczna = true;
        else if (seg.indexOf('maszyn') !== -1 || seg === 'm' || seg.indexOf('automat') !== -1) hasMaszyna = true;
      }
      if (hasReczna && hasMaszyna) return 'ręczna i automatyczna';
      if (hasReczna) return 'ręczna';
      if (hasMaszyna) return 'automatyczna';
      return '';
    }
    function sortSealRowsForDoc(sealRows) {
      return (sealRows || []).slice().sort(function (a, b) {
        return parseSealClosureDateMs(b.dataZamknieciaWorka) - parseSealClosureDateMs(a.dataZamknieciaWorka);
      });
    }
    function buildListaPlombFromSealRows(sealRows) {
      var ordered = sortSealRowsForDoc(sealRows);
      var rodzaje = {};
      ordered.forEach(function (r) {
        var rodzaj = formatRodzajZbiorkiSeal(r.zbiorka);
        if (rodzaj === 'ręczna' || rodzaj === 'automatyczna') rodzaje[rodzaj] = true;
      });
      var shouldAppend = Object.keys(rodzaje).length > 1;
      var lines = [];
      var i = 0;
      ordered.forEach(function (r) {
        var n = String(r.numerPlomby || '').trim();
        if (!n) return;
        i += 1;
        var mmdd = formatSealDateMmDd(r.dataZamknieciaWorka);
        var rodzajWorka = shouldAppend ? formatRodzajZbiorkiSeal(r.zbiorka) : '';
        var line = mmdd.length > 0 ? (i + '.\\t' + mmdd + '\\t' + n) : (i + '.\\t' + n);
        if (rodzajWorka) line += '\\t' + rodzajWorka;
        lines.push(line);
      });
      return lines;
    }
    function escapeXmlForWordTextMap(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
    function buildListaPlombOoxmlFromLines(lines) {
      var rpr = '<w:rPr><w:sz w:val="' + DOC_LISTA_PLOMB_HP + '"/><w:szCs w:val="' + DOC_LISTA_PLOMB_HP + '"/></w:rPr>';
      if (lines.length === 0) {
        return '<w:p><w:r>' + rpr + '<w:t></w:t></w:r></w:p>';
      }
      return lines.map(function (line) {
        return '<w:p><w:r>' + rpr + '<w:t xml:space="preserve">' + escapeXmlForWordTextMap(line) + '</w:t></w:r></w:p>';
      }).join('');
    }
    function buildListaPlombOoxmlFromSealRows(sealRows) {
      return buildListaPlombOoxmlFromLines(buildListaPlombFromSealRows(sealRows));
    }
    function buildDocListsFromSealRows(sealRows) {
      var lines = buildListaPlombFromSealRows(sealRows);
      return {
        lista_plomb: lines.join('\\n'),
        lista_plomb_xml: buildListaPlombOoxmlFromLines(lines)
      };
    }
    function rebuildDocPreparedLists(sealRows) {
      window.__docPreparedLists = buildDocListsFromSealRows(sealRows || []);
    }
    function formatYmdToDisplay(ymd) {
      if (!ymd) return '';
      var p = String(ymd).split('-');
      if (p.length !== 3) return String(ymd);
      return p[2] + '.' + p[1] + '.' + p[0];
    }
    function updateDocFilterInfo(total, filtered, cutoffYmd) {
      var el = document.getElementById('doc-filter-info');
      if (!el) return;
      if (filtered === total) {
        el.textContent = 'Worki w protokole: ' + filtered;
        return;
      }
      var extra = cutoffYmd ? (' (od ostatniego transportu ' + formatYmdToDisplay(cutoffYmd) + ')') : '';
      el.textContent = 'Worki w protokole: ' + filtered + ' z ' + total + extra;
    }
    function transportApiUrl(params) {
      var q = params || {};
      var parts = [];
      Object.keys(q).forEach(function (k) {
        if (q[k] != null && q[k] !== '') {
          parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(q[k])));
        }
      });
      var sep = TRANSPORT_WEBAPP_URL.indexOf('?') >= 0 ? '&' : '?';
      return TRANSPORT_WEBAPP_URL + (parts.length ? sep + parts.join('&') : '');
    }
    function fetchTransportGet(params) {
      return fetch(transportApiUrl(params)).then(function (res) { return res.json(); });
    }
    function appendTransportRow(payload) {
      return fetch(TRANSPORT_WEBAPP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      }).then(function (res) { return res.json(); });
    }
    function setDocModalMode(mode) {
      window.__docModalMode = mode;
      var isBulk = mode === 'bulk';
      var titleEl = document.getElementById('doc-modal-title');
      var bulkWrap = document.getElementById('doc-bulk-points-wrap');
      var singleNumerWrap = document.getElementById('doc-single-numer-wrap');
      var bulkNumerInfo = document.getElementById('doc-bulk-numer-info');
      var okBtn = document.getElementById('doc-btn-ok');
      if (titleEl) {
        titleEl.textContent = isBulk
          ? 'Generuj dokumenty Word (' + (window.__bulkDocPointIdxs || []).length + ' punktów)'
          : 'Generuj dokument Word';
      }
      if (bulkWrap) bulkWrap.hidden = !isBulk;
      if (singleNumerWrap) singleNumerWrap.hidden = isBulk;
      if (bulkNumerInfo) bulkNumerInfo.hidden = !isBulk;
      if (okBtn) okBtn.textContent = isBulk ? 'Pobierz wszystkie .docx' : 'Pobierz .docx';
    }
    function preparePointDocSeals(pointIdx) {
      var p = adresy[pointIdx];
      if (!p) return { filteredSeals: [], cutoffYmd: null, total: 0 };
      var cutoffMs = transportApiEnabled && window.__transportDatesLoaded ? getPointTransportCutoff(p) : null;
      var all = p.sealRows || [];
      var filteredSeals = filterSealRowsByMinDate(all, cutoffMs);
      var cutoffYmd = null;
      if (cutoffMs != null) {
        var d = new Date(cutoffMs);
        cutoffYmd = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
      }
      return { filteredSeals: filteredSeals, cutoffYmd: cutoffYmd, total: all.length };
    }
    function renderBulkPointsList(indices) {
      var listEl = document.getElementById('doc-bulk-points-list');
      if (!listEl) return;
      listEl.innerHTML = '';
      indices.forEach(function (idx) {
        var p = adresy[idx];
        if (!p) return;
        var prep = preparePointDocSeals(idx);
        var li = document.createElement('li');
        var suffix = prep.filteredSeals.length === prep.total
          ? prep.filteredSeals.length + ' worków'
          : prep.filteredSeals.length + ' z ' + prep.total + ' worków';
        li.textContent = p.adres + ' — ' + suffix;
        listEl.appendChild(li);
      });
    }
    function loadBulkDocModalData(indices) {
      window.__docModalDataReady = false;
      window.__docBulkPointJobs = [];
      var filterInfo = document.getElementById('doc-filter-info');
      var bulkNumerInfo = document.getElementById('doc-bulk-numer-info');
      var okBtn = document.getElementById('doc-btn-ok');
      if (filterInfo) filterInfo.textContent = 'Przygotowywanie danych…';
      if (bulkNumerInfo) bulkNumerInfo.textContent = '';
      if (okBtn) okBtn.disabled = true;
      renderBulkPointsList(indices);
      indices.forEach(function (idx) {
        var p = adresy[idx];
        if (!p) return;
        var prep = preparePointDocSeals(idx);
        window.__docBulkPointJobs.push({
          pointIdx: idx,
          filteredSeals: prep.filteredSeals,
          preparedLists: buildDocListsFromSealRows(prep.filteredSeals)
        });
      });
      var totalWorkow = 0;
      var skipped = 0;
      window.__docBulkPointJobs.forEach(function (job) {
        totalWorkow += job.filteredSeals.length;
        if (job.filteredSeals.length === 0) skipped += 1;
      });
      if (filterInfo) {
        var msg = indices.length + ' punktów · ' + totalWorkow + ' worków łącznie';
        if (skipped > 0) msg += ' (' + skipped + ' bez worków — pominięte)';
        filterInfo.textContent = msg;
      }
      function finishBulkLoading(previewNumer) {
        if (bulkNumerInfo) {
          if (transportApiEnabled && previewNumer) {
            var validCount = window.__docBulkPointJobs.filter(function (j) { return j.filteredSeals.length > 0; }).length;
            if (validCount <= 1) {
              bulkNumerInfo.textContent = 'Numer zostanie nadany automatycznie.';
            } else {
              bulkNumerInfo.textContent = 'Numery zostaną nadane automatycznie kolejno (od ' + previewNumer + ').';
            }
          } else {
            bulkNumerInfo.textContent = 'Każdy punkt otrzyma osobny numer zlecenia transportowego.';
          }
        }
        window.__docModalDataReady = true;
        if (okBtn) okBtn.disabled = false;
      }
      if (transportApiEnabled) {
        return fetchTransportGet({ action: 'previewNumber' }).then(function (resp) {
          finishBulkLoading(resp && resp.ok ? String(resp.numer || '') : '');
        }).catch(function () {
          finishBulkLoading('');
        });
      }
      finishBulkLoading('');
      return Promise.resolve();
    }
    function loadDocModalData(pointIdx) {
      var p = adresy[pointIdx];
      window.__docCutoffMs = null;
      window.__docModalDataReady = false;
      window.__docPreviewNumer = '';
      window.__docFilteredSeals = (p && p.sealRows) ? p.sealRows.slice() : [];
      var filterInfo = document.getElementById('doc-filter-info');
      var okBtn = document.getElementById('doc-btn-ok');
      if (filterInfo) filterInfo.textContent = 'Ładowanie danych transportu…';
      if (okBtn) okBtn.disabled = true;
      var numEl = document.getElementById('doc-inp-numer-zlecenia');
      function finishLoading() {
        window.__docModalDataReady = true;
        if (okBtn) okBtn.disabled = false;
      }
      if (!transportApiEnabled) {
        if (numEl) numEl.value = '';
        updateDocFilterInfo(window.__docFilteredSeals.length, window.__docFilteredSeals.length, null);
        rebuildDocPreparedLists(window.__docFilteredSeals);
        finishLoading();
        return Promise.resolve();
      }
      var podmiot = p.podmiotHandlowy || (p.podmiotyHandlowe && p.podmiotyHandlowe[0]) || '';
      var cachedCutoff = window.__transportDatesLoaded ? getPointTransportCutoff(p) : null;
      return fetchTransportGet({ action: 'modalData', podmiot: podmiot, adres: p.adres }).then(function (resp) {
        if (resp && resp.ok && numEl) {
          numEl.value = String(resp.numer || '');
          window.__docPreviewNumer = String(resp.numer || '');
        }
        var cutoffMs = cachedCutoff;
        var cutoffYmd = null;
        if (cutoffMs == null && resp && resp.ok && resp.lastTransportDateMs != null) {
          cutoffMs = resp.lastTransportDateMs;
          cutoffYmd = resp.lastTransportDateYmd || null;
        } else if (cutoffMs != null) {
          var cd = new Date(cutoffMs);
          cutoffYmd = cd.getUTCFullYear() + '-' + String(cd.getUTCMonth() + 1).padStart(2, '0') + '-' + String(cd.getUTCDate()).padStart(2, '0');
        }
        window.__docCutoffMs = cutoffMs;
        var all = p.sealRows || [];
        window.__docFilteredSeals = filterSealRowsByMinDate(all, cutoffMs);
        updateDocFilterInfo(all.length, window.__docFilteredSeals.length, cutoffYmd);
        rebuildDocPreparedLists(window.__docFilteredSeals);
      }).catch(function (err) {
        console.error(err);
        if (filterInfo) {
          filterInfo.textContent = 'Nie udało się pobrać danych transportu — użyto wszystkich worków.';
        }
        window.__docFilteredSeals = (p.sealRows || []).slice();
        rebuildDocPreparedLists(window.__docFilteredSeals);
      }).then(function () {
        finishLoading();
      });
    }
    function findPodwykoIdxByLabel(label) {
      if (!label) return -1;
      var i;
      for (i = 0; i < PODWYKOLISTA.length; i++) {
        if (PODWYKOLISTA[i].label === label) return i;
      }
      var q = normalizeForAddressSearchMap(label);
      for (i = 0; i < PODWYKOLISTA.length; i++) {
        if (normalizeForAddressSearchMap(PODWYKOLISTA[i].label) === q) return i;
      }
      return -1;
    }
    function selectDocComboboxOption(inputEl, hiddenEl, listEl, idx, storageKey) {
      var opt = PODWYKOLISTA[idx];
      if (!opt || !inputEl || !hiddenEl) return;
      inputEl.value = opt.label;
      hiddenEl.value = String(idx);
      if (storageKey) saveDocComboboxLastLabel(storageKey, opt.label);
      hideDocComboboxList(listEl, inputEl);
    }
    function renderDocComboboxList(listEl, inputEl, hiddenEl, query, storageKey) {
      if (!listEl || !inputEl || !hiddenEl) return;
      listEl.innerHTML = '';
      if (PODWYKOLISTA.length === 0) {
        var emptyLi = document.createElement('li');
        emptyLi.className = 'doc-combobox-empty';
        emptyLi.textContent = '(Brak listy — dodaj docs/podwyko lista.xlsx lub ustaw PODWYKOLISTA_ODS_PATH)';
        listEl.appendChild(emptyLi);
        showDocComboboxList(listEl, inputEl);
        return;
      }
      var shown = 0;
      var maxShow = 80;
      PODWYKOLISTA.forEach(function (opt, idx) {
        if (!podwykoOptionMatchesQuery(opt, query)) return;
        if (shown >= maxShow) return;
        shown += 1;
        var li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.setAttribute('data-idx', String(idx));
        li.textContent = opt.label;
        li.addEventListener('mousedown', function (ev) {
          ev.preventDefault();
          selectDocComboboxOption(inputEl, hiddenEl, listEl, idx, storageKey);
        });
        listEl.appendChild(li);
      });
      if (shown === 0) {
        var noLi = document.createElement('li');
        noLi.className = 'doc-combobox-empty';
        noLi.textContent = 'Brak dopasowań';
        listEl.appendChild(noLi);
      }
      showDocComboboxList(listEl, inputEl);
    }
    function tryResolveDocComboboxFromInput(inputEl, hiddenEl, storageKey) {
      if (!inputEl || !hiddenEl) return;
      var text = String(inputEl.value).trim();
      if (!text) {
        hiddenEl.value = '';
        return;
      }
      var q = normalizeForAddressSearchMap(text);
      var i;
      for (i = 0; i < PODWYKOLISTA.length; i++) {
        if (normalizeForAddressSearchMap(PODWYKOLISTA[i].label) === q) {
          selectDocComboboxOption(inputEl, hiddenEl, null, i, storageKey);
          return;
        }
      }
      var matches = [];
      for (i = 0; i < PODWYKOLISTA.length; i++) {
        if (podwykoOptionMatchesQuery(PODWYKOLISTA[i], text)) matches.push(i);
      }
      if (matches.length === 1) {
        selectDocComboboxOption(inputEl, hiddenEl, null, matches[0], storageKey);
        return;
      }
      hiddenEl.value = '';
    }
    function restoreDocComboboxFromSavedLabel(inputId, hiddenId, listId, storageKey) {
      resetDocCombobox(inputId, hiddenId, listId);
      var saved = '';
      try { saved = localStorage.getItem(storageKey) || ''; } catch (e) {}
      saved = String(saved).trim();
      if (!saved) return;
      var idx = findPodwykoIdxByLabel(saved);
      if (idx < 0) return;
      var inputEl = document.getElementById(inputId);
      var hiddenEl = document.getElementById(hiddenId);
      var listEl = document.getElementById(listId);
      selectDocComboboxOption(inputEl, hiddenEl, listEl, idx);
    }
    function resetDocCombobox(inputId, hiddenId, listId) {
      var inputEl = document.getElementById(inputId);
      var hiddenEl = document.getElementById(hiddenId);
      var listEl = document.getElementById(listId);
      if (!inputEl || !hiddenEl) return;
      inputEl.value = '';
      hiddenEl.value = '';
      hideDocComboboxList(listEl, inputEl);
    }
    function setupDocCombobox(inputId, hiddenId, listId, storageKey) {
      var inputEl = document.getElementById(inputId);
      var hiddenEl = document.getElementById(hiddenId);
      var listEl = document.getElementById(listId);
      if (!inputEl || !hiddenEl || !listEl) return;
      inputEl.addEventListener('focus', function () {
        renderDocComboboxList(listEl, inputEl, hiddenEl, inputEl.value, storageKey);
      });
      inputEl.addEventListener('input', function () {
        hiddenEl.value = '';
        renderDocComboboxList(listEl, inputEl, hiddenEl, inputEl.value, storageKey);
      });
      inputEl.addEventListener('blur', function () {
        window.setTimeout(function () {
          tryResolveDocComboboxFromInput(inputEl, hiddenEl, storageKey);
          hideDocComboboxList(listEl, inputEl);
        }, 150);
      });
      inputEl.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') {
          hideDocComboboxList(listEl, inputEl);
          return;
        }
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          var items = listEl.querySelectorAll('li[data-idx]');
          if (!items.length) return;
          ev.preventDefault();
          var active = listEl.querySelector('li.doc-combobox-active');
          var nextIdx = 0;
          if (active) {
            for (var j = 0; j < items.length; j++) {
              if (items[j] === active) {
                nextIdx = ev.key === 'ArrowDown' ? Math.min(j + 1, items.length - 1) : Math.max(j - 1, 0);
                break;
              }
            }
          } else if (ev.key === 'ArrowUp') {
            nextIdx = items.length - 1;
          }
          for (var k = 0; k < items.length; k++) {
            items[k].classList.toggle('doc-combobox-active', k === nextIdx);
          }
          items[nextIdx].scrollIntoView({ block: 'nearest' });
          return;
        }
        if (ev.key === 'Enter') {
          var pick = listEl.querySelector('li.doc-combobox-active') || listEl.querySelector('li[data-idx]');
          if (pick && pick.getAttribute('data-idx') != null) {
            ev.preventDefault();
            selectDocComboboxOption(inputEl, hiddenEl, listEl, parseInt(pick.getAttribute('data-idx'), 10), storageKey);
          } else {
            tryResolveDocComboboxFromInput(inputEl, hiddenEl, storageKey);
            hideDocComboboxList(listEl, inputEl);
          }
        }
      });
    }
    function initDocComboboxes() {
      if (docComboboxInited) return;
      docComboboxInited = true;
      setupDocCombobox('doc-sel-przewoznik', 'doc-val-przewoznik', 'doc-sel-przewoznik-list', DOC_LS_PRZEWOZNIK);
      setupDocCombobox('doc-sel-miejsce', 'doc-val-miejsce', 'doc-sel-miejsce-list', DOC_LS_MIEJSCE);
    }
    function defaultDateZaladunkuYmd() {
      var d = new Date();
      var dow = d.getDay();
      var hour = d.getHours();
      if (dow === 6) {
        d.setDate(d.getDate() + 2);
      } else if (dow === 0) {
        d.setDate(d.getDate() + 1);
      } else if (dow === 5) {
        if (hour >= 4) {
          d.setDate(d.getDate() + 3);
        }
      } else {
        var dayOffset = hour >= 0 && hour < 4 ? 0 : 1;
        d.setDate(d.getDate() + dayOffset);
      }
      var y = d.getFullYear();
      var mo = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return y + '-' + mo + '-' + day;
    }
    function openDocModal(pointIdx) {
      if (!wordDocEnabled) return;
      if (transportApiEnabled && !window.__transportDatesLoaded) {
        alert('Poczekaj na pobranie danych transportu (w górnej części mapy).');
        return;
      }
      window.__currentDocPointIdx = pointIdx;
      window.__bulkDocPointIdxs = [];
      setDocModalMode('single');
      var m = document.getElementById('doc-modal');
      initDocComboboxes();
      restoreDocComboboxFromSavedLabel('doc-sel-przewoznik', 'doc-val-przewoznik', 'doc-sel-przewoznik-list', DOC_LS_PRZEWOZNIK);
      restoreDocComboboxFromSavedLabel('doc-sel-miejsce', 'doc-val-miejsce', 'doc-sel-miejsce-list', DOC_LS_MIEJSCE);
      var dateEl = document.getElementById('doc-inp-data-zaladunku');
      if (dateEl) dateEl.value = defaultDateZaladunkuYmd();
      var numEl = document.getElementById('doc-inp-numer-zlecenia');
      if (numEl) numEl.value = '';
      ensureDocxLibrariesLoaded();
      prewarmDocxTemplateCache();
      loadDocModalData(pointIdx);
      m.style.display = 'flex';
      m.setAttribute('aria-hidden', 'false');
    }
    function openBulkDocModal(indices) {
      if (!wordDocEnabled || !indices || indices.length === 0) return;
      if (transportApiEnabled && !window.__transportDatesLoaded) {
        alert('Poczekaj na pobranie danych transportu (w górnej części mapy).');
        return;
      }
      window.__currentDocPointIdx = null;
      window.__bulkDocPointIdxs = indices.slice();
      setDocModalMode('bulk');
      var m = document.getElementById('doc-modal');
      initDocComboboxes();
      restoreDocComboboxFromSavedLabel('doc-sel-przewoznik', 'doc-val-przewoznik', 'doc-sel-przewoznik-list', DOC_LS_PRZEWOZNIK);
      restoreDocComboboxFromSavedLabel('doc-sel-miejsce', 'doc-val-miejsce', 'doc-sel-miejsce-list', DOC_LS_MIEJSCE);
      var dateEl = document.getElementById('doc-inp-data-zaladunku');
      if (dateEl) dateEl.value = defaultDateZaladunkuYmd();
      ensureDocxLibrariesLoaded();
      prewarmDocxTemplateCache();
      loadBulkDocModalData(indices);
      m.style.display = 'flex';
      m.setAttribute('aria-hidden', 'false');
    }
    function closeDocModal() {
      var m = document.getElementById('doc-modal');
      if (!m) return;
      m.style.display = 'none';
      m.setAttribute('aria-hidden', 'true');
    }
    function b64ToUint8(b64) {
      var bin = atob(b64);
      var n = bin.length;
      var u = new Uint8Array(n);
      for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
      return u;
    }
    var wordTemplateBytesCache = null;
    function getWordTemplateBytes() {
      if (!wordTemplateBytesCache) {
        wordTemplateBytesCache = b64ToUint8(WORD_TEMPLATE_B64);
      }
      return wordTemplateBytesCache;
    }
    function prewarmDocxTemplateCache() {
      if (!wordDocEnabled || !WORD_TEMPLATE_B64) return;
      try { getWordTemplateBytes(); } catch (e) { console.warn(e); }
    }
    var docxLibsPromise = null;
    function loadScriptOnce(src) {
      return new Promise(function (resolve, reject) {
        var existing = document.querySelector('script[src="' + src + '"]');
        if (existing) {
          if (existing.getAttribute('data-loaded') === '1') {
            resolve();
            return;
          }
          existing.addEventListener('load', function () { resolve(); });
          existing.addEventListener('error', function () { reject(new Error('script: ' + src)); });
          return;
        }
        var s = document.createElement('script');
        s.src = src;
        s.crossOrigin = '';
        s.onload = function () { s.setAttribute('data-loaded', '1'); resolve(); };
        s.onerror = function () { reject(new Error('script: ' + src)); };
        document.head.appendChild(s);
      });
    }
    function ensureDocxLibrariesLoaded() {
      if (typeof PizZip !== 'undefined' && typeof docxtemplater !== 'undefined' && typeof saveAs !== 'undefined') {
        return Promise.resolve();
      }
      if (!docxLibsPromise) {
        docxLibsPromise = loadScriptOnce('https://unpkg.com/pizzip@3.1.7/dist/pizzip.min.js')
          .then(function () { return loadScriptOnce('https://unpkg.com/docxtemplater@3.50.0/build/docxtemplater.js'); })
          .then(function () { return loadScriptOnce('https://unpkg.com/file-saver@2.0.5/dist/FileSaver.min.js'); });
      }
      return docxLibsPromise;
    }
    function sanitizeFileNamePart(text) {
      return String(text)
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\\s+/g, ' ')
        .trim();
    }
    function buildDocxDownloadName(przewoznikLabel, dataDdMmRr, adresSklepu) {
      var base = [sanitizeFileNamePart(przewoznikLabel), dataDdMmRr, sanitizeFileNamePart(adresSklepu)]
        .filter(function (x) { return x.length > 0; })
        .join(' ');
      if (base.length === 0) {
        base = 'dokument';
      }
      var maxLen = 220;
      if (base.length > maxLen) {
        base = base.slice(0, maxLen - 3).trim() + '...';
      }
      return base + '.docx';
    }
    function renderDocxAndDownload(p, pr, md, prOpt, dz, dzPlik, numerZlecenia, filteredSeals, preparedLists, options) {
      var opts = options || {};
      var lists = preparedLists || buildDocListsFromSealRows(filteredSeals);
      var zip = new PizZip(getWordTemplateBytes());
      var Doc = window.docxtemplater;
      var doc = new Doc(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: '{{', end: '}}' },
      });
      doc.render({
        miejsce_zaladunku: p.doc.miejsce_zaladunku,
        lista_plomb: lists.lista_plomb,
        lista_plomb_xml: lists.lista_plomb_xml,
        przewoznik: pr,
        miejsce_dostawy: md,
        data_zaladunku: dz,
        numer_zlecenia_transportowego: numerZlecenia,
        rodzaj_zbiorki: p.rodzaj_zbiorki ? (' ' + p.rodzaj_zbiorki) : ''
      });
      var out = doc.getZip().generate({
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });
      var safeName = buildDocxDownloadName(prOpt.label, dzPlik, p.adres);
      saveAs(out, safeName);
      if (opts.closeModal !== false) {
        closeDocModal();
      }
    }
    function isManualTransportNumer(inputValue, previewNumer) {
      var v = String(inputValue || '').trim();
      if (!v) return false;
      return v !== String(previewNumer || '');
    }
    function parseDocFormValues() {
      var prInput = document.getElementById('doc-sel-przewoznik');
      var mdInput = document.getElementById('doc-sel-miejsce');
      var prVal = document.getElementById('doc-val-przewoznik');
      var mdVal = document.getElementById('doc-val-miejsce');
      if (prInput && prVal) tryResolveDocComboboxFromInput(prInput, prVal);
      if (mdInput && mdVal) tryResolveDocComboboxFromInput(mdInput, mdVal);
      var prIdx = prVal ? prVal.value : '';
      var mdIdx = mdVal ? mdVal.value : '';
      if (prIdx === '' || mdIdx === '') {
        alert('Wybierz przewoźnika i miejsce dostawy (wpisz fragment nazwy lub danych i wybierz z listy).');
        return null;
      }
      var pi = parseInt(prIdx, 10);
      var mi = parseInt(mdIdx, 10);
      var prOpt = PODWYKOLISTA[pi];
      var mdOpt = PODWYKOLISTA[mi];
      if (!prOpt || !mdOpt) {
        alert('Błąd wyboru z listy.');
        return null;
      }
      var dateEl = document.getElementById('doc-inp-data-zaladunku');
      var ymd = dateEl ? String(dateEl.value).trim() : '';
      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(ymd)) {
        alert('Wybierz datę załadunku (kalendarz).');
        return null;
      }
      var pe = ymd.split('-');
      var y = parseInt(pe[0], 10);
      var mo = parseInt(pe[1], 10) - 1;
      var d = parseInt(pe[2], 10);
      var chk = new Date(y, mo, d);
      if (chk.getFullYear() !== y || chk.getMonth() !== mo || chk.getDate() !== d) {
        alert('Nieprawidłowa data załadunku.');
        return null;
      }
      var dd = String(d).padStart(2, '0');
      var mm = String(mo + 1).padStart(2, '0');
      var yyyy = String(y);
      var rr = yyyy.slice(-2);
      return {
        pr: prOpt.dane,
        md: mdOpt.dane,
        prOpt: prOpt,
        mdOpt: mdOpt,
        dz: dd + '.' + mm + '.' + yyyy,
        dzPlik: dd + '.' + mm + '.' + rr
      };
    }
    function updateTransportCutoffAfterAppend(p, dz) {
      if (!window.__transportDateByKey) window.__transportDateByKey = {};
      var podmiot = p.podmiotHandlowy || (p.podmiotyHandlowe && p.podmiotyHandlowe[0]) || '';
      var key = buildTransportShopKeyMap(podmiot, p.adres);
      var ms = parseSealClosureDateMs(dz);
      if (isFinite(ms) && ms !== Number.NEGATIVE_INFINITY) {
        window.__transportDateByKey[key] = ms;
      }
    }
    function delayMs(ms) {
      return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
    }
    function runBulkDocGenerate() {
      if (transportApiEnabled && !window.__docModalDataReady) {
        alert('Poczekaj na załadowanie danych transportu.');
        return;
      }
      if (!transportApiEnabled) {
        alert('Tryb zbiorczy wymaga połączenia z rejestrem transportów (TRANSPORT_WEBAPP_URL).');
        return;
      }
      var form = parseDocFormValues();
      if (!form) return;
      var jobs = (window.__docBulkPointJobs || []).filter(function (job) {
        return job.filteredSeals && job.filteredSeals.length > 0;
      });
      if (jobs.length === 0) {
        alert('Brak worków do protokołu we wszystkich zaznaczonych punktach.');
        return;
      }
      var okBtn = document.getElementById('doc-btn-ok');
      var filterInfo = document.getElementById('doc-filter-info');
      if (okBtn) okBtn.disabled = true;
      ensureDocxLibrariesLoaded().then(function () {
        var generated = 0;
        var failed = 0;
        var chain = Promise.resolve();
        jobs.forEach(function (job, jobIdx) {
          chain = chain.then(function () {
            var p = adresy[job.pointIdx];
            if (!p) return Promise.resolve();
            if (filterInfo) {
              filterInfo.textContent = 'Generowanie ' + (jobIdx + 1) + ' / ' + jobs.length + ': ' + p.adres;
            }
            var podmiot = p.podmiotHandlowy || (p.podmiotyHandlowe && p.podmiotyHandlowe[0]) || '';
            var transportPayload = {
              numer: '',
              adresSklepu: p.adres,
              podmiotHandlowy: podmiot,
              sklep: p.sklep || '',
              dataOdbioru: form.dz,
              ktoOdbiera: form.prOpt.label,
              miejsceZrzutu: form.mdOpt.label,
              rodzajZbiorki: p.rodzaj_zbiorki || '',
              iloscWorkow: job.filteredSeals.length
            };
            return appendTransportRow(transportPayload).then(function (resp) {
              if (!resp || !resp.ok) {
                throw new Error(resp && resp.error ? resp.error : 'błąd API');
              }
              var numerZlecenia = String(resp.numer || '');
              renderDocxAndDownload(p, form.pr, form.md, form.prOpt, form.dz, form.dzPlik, numerZlecenia, job.filteredSeals, job.preparedLists, { closeModal: false });
              updateTransportCutoffAfterAppend(p, form.dz);
              if (typeof markerEntries !== 'undefined') {
                markerEntries.forEach(function (entry) {
                  if (entry.pointIdx === job.pointIdx) refreshMarkerDisplay(entry);
                });
              }
              generated += 1;
              return delayMs(400);
            });
          }).catch(function (err) {
            console.error(err);
            failed += 1;
          });
        });
        return chain.then(function () {
          clearBulkSelection();
          closeDocModal();
          if (failed > 0) {
            alert('Wygenerowano ' + generated + ' protokołów. Nie udało się: ' + failed + '.');
          } else {
            alert('Wygenerowano ' + generated + ' protokołów.');
          }
        });
      }).catch(function (err) {
        console.error(err);
        alert('Nie udało się załadować bibliotek Word (PizZip/docxtemplater). Sprawdź połączenie z internetem.');
      }).then(function () {
        if (okBtn) okBtn.disabled = false;
      });
    }
    function runDocGenerate() {
      if (window.__docModalMode === 'bulk') {
        runBulkDocGenerate();
        return;
      }
      if (transportApiEnabled && !window.__docModalDataReady) {
        alert('Poczekaj na załadowanie danych transportu (numer i filtr worków).');
        return;
      }
      var idx = window.__currentDocPointIdx;
      if (idx == null || idx < 0 || !adresy[idx]) {
        alert('Błąd: brak punktu.');
        return;
      }
      var form = parseDocFormValues();
      if (!form) return;
      var pr = form.pr;
      var md = form.md;
      var prOpt = form.prOpt;
      var mdOpt = form.mdOpt;
      var dz = form.dz;
      var dzPlik = form.dzPlik;
      var p = adresy[idx];
      var filteredSeals = window.__docFilteredSeals || p.sealRows || [];
      if (filteredSeals.length === 0) {
        alert('Brak worków do protokołu po filtrze dat (od ostatniego transportu).');
        return;
      }
      var numEl = document.getElementById('doc-inp-numer-zlecenia');
      var okBtn = document.getElementById('doc-btn-ok');
      if (okBtn) okBtn.disabled = true;
      if (!window.__docPreparedLists) {
        rebuildDocPreparedLists(filteredSeals);
      }
      var preparedLists = window.__docPreparedLists;
      function finishWithNumber(numerZlecenia) {
        ensureDocxLibrariesLoaded().then(function () {
          try {
            if (!numerZlecenia) {
              alert('Brak numeru zlecenia transportowego.');
              return;
            }
            renderDocxAndDownload(p, pr, md, prOpt, dz, dzPlik, numerZlecenia, filteredSeals, preparedLists);
          } catch (err) {
            console.error(err);
            alert('Nie udało się utworzyć dokumentu. Sprawdź szablon (tagi {{miejsce_zaladunku}}, {{przewoznik}}, {{numer_zlecenia_transportowego}}, …) i spróbuj ponownie.');
          } finally {
            if (okBtn) okBtn.disabled = false;
          }
        }).catch(function (err) {
          console.error(err);
          alert('Nie udało się załadować bibliotek Word (PizZip/docxtemplater). Sprawdź połączenie z internetem.');
          if (okBtn) okBtn.disabled = false;
        });
      }
      if (transportApiEnabled) {
        var podmiot = p.podmiotHandlowy || (p.podmiotyHandlowe && p.podmiotyHandlowe[0]) || '';
        var numerWpisany = numEl ? String(numEl.value).trim() : '';
        var manualNumer = isManualTransportNumer(numerWpisany, window.__docPreviewNumer);
        var transportPayload = {
          numer: manualNumer ? numerWpisany : '',
          adresSklepu: p.adres,
          podmiotHandlowy: podmiot,
          sklep: p.sklep || '',
          dataOdbioru: dz,
          ktoOdbiera: prOpt.label,
          miejsceZrzutu: mdOpt.label,
          rodzajZbiorki: p.rodzaj_zbiorki || '',
          iloscWorkow: filteredSeals.length
        };
        if (manualNumer) {
          finishWithNumber(numerWpisany);
          appendTransportRow(transportPayload).then(function (resp) {
            if (!resp || !resp.ok) {
              alert('Dokument pobrany, ale zapis w arkuszu nie powiódł się: ' + (resp && resp.error ? resp.error : 'błąd API'));
            }
          }).catch(function (err) {
            console.error(err);
            alert('Dokument pobrany, ale nie udało się zapisać transportu w arkuszu. Sprawdź połączenie i URL Web App.');
          });
          return;
        }
        appendTransportRow(transportPayload).then(function (resp) {
          if (!resp || !resp.ok) {
            alert('Nie udało się zapisać transportu w arkuszu: ' + (resp && resp.error ? resp.error : 'błąd API'));
            if (okBtn) okBtn.disabled = false;
            return;
          }
          finishWithNumber(String(resp.numer || ''));
        }).catch(function (err) {
          console.error(err);
          alert('Nie udało się zapisać transportu w arkuszu. Sprawdź połączenie i URL Web App (TRANSPORT_WEBAPP_URL).');
          if (okBtn) okBtn.disabled = false;
        });
        return;
      }
      var numerManual = numEl ? String(numEl.value).trim() : '';
      finishWithNumber(numerManual);
    }

    if (wordDocEnabled) {
      initDocComboboxes();
      document.getElementById('doc-btn-cancel').onclick = closeDocModal;
      document.getElementById('doc-btn-ok').onclick = runDocGenerate;
      document.getElementById('doc-modal').onclick = function(ev) {
        if (ev.target.id === 'doc-modal') closeDocModal();
      };
    }

    var wojBoundsByKey = {};
    fetch(${JSON.stringify(geoJsonUrl)})
      .then(function(res) { return res.json(); })
      .then(function(geojson) {
        L.geoJSON(geojson, {
          onEachFeature: function(feature, layer) {
            var p = feature.properties;
            var n = p && p.name;
            if (typeof n !== 'string' || !n.trim()) return;
            var k = normalizeForAddressSearchMap(n);
            if (k) wojBoundsByKey[k] = layer.getBounds();
          },
          style: { color: '#c00', weight: 3, fill: false }
        }).addTo(map);
      })
      .catch(function() {
        console.warn('Nie załadowano granic województw.');
      });

    var markerEntries = [];
    adresy.forEach(function(p, pointIdx) {
      var displayCount = displayCountForPoint(p);
      var kolor = kolorPinezki(p.confidence, displayCount);
      var marker = L.marker([p.markerLat, p.markerLng], { icon: pinIcon(kolor, false) })
        .addTo(map)
        .bindPopup(buildPopupContent(p, pointIdx));
      markerEntries.push({ marker: marker, p: p, kolor: kolor, pointIdx: pointIdx });
      marker.on('popupopen', function() {
        marker.setPopupContent(buildPopupContent(p, pointIdx));
        wirePopupControls(marker, pointIdx);
      });
    });

    loadBulkTransportDates();

    var allPointsBounds = null;
    if (adresy.length > 0) {
      allPointsBounds = L.latLngBounds(adresy.map(function(p) { return [p.markerLat, p.markerLng]; }));
      map.fitBounds(allPointsBounds, { padding: [40, 40] });
    }

    var zbiorkaFilterHtml = showZbiorkaFilter
      ? '<div class="map-zbiorka-filter" role="group" aria-labelledby="map-zbiorka-filter-title">' +
        '<span id="map-zbiorka-filter-title" class="map-zbiorka-filter-title">Warstwa zbiórki</span>' +
        '<div class="map-zbiorka-filter-options">' +
        '<label><input type="radio" name="map-zbiorka-filter" value="wszystkie" checked /> Wszystkie punkty</label>' +
        '<label><input type="radio" name="map-zbiorka-filter" value="obie" /> Ręczna i maszynowa</label>' +
        '<label><input type="radio" name="map-zbiorka-filter" value="reczna" /> Tylko ręczna</label>' +
        '<label><input type="radio" name="map-zbiorka-filter" value="maszyna" /> Tylko maszynowa</label>' +
        '</div></div>'
      : '';
    var bulkPanelHtml = wordDocEnabled
      ? '<div id="map-bulk-panel" class="map-bulk-panel" hidden>' +
        '<span id="map-bulk-count" class="map-bulk-count">0 punktów zaznaczonych</span>' +
        '<button type="button" id="map-bulk-generate" class="map-bulk-generate">Generuj protokoły</button>' +
        '<button type="button" id="map-bulk-clear" class="map-bulk-clear">Wyczyść</button>' +
        '</div>'
      : '';

    var searchControl = L.control({ position: 'topleft' });
    searchControl.onAdd = function() {
      var wrap = L.DomUtil.create('div', 'map-search-panel');
      wrap.innerHTML =
        '<label class="map-search-label" for="map-address-search">Szukaj na mapie</label>' +
        '<div class="map-search-input-row">' +
        '<input type="search" id="map-address-search" class="map-search-input" placeholder="Adres, podmiot handlowy lub sklep…" autocomplete="off" spellcheck="false" aria-label="Szukaj: adres, podmiot lub sklep" />' +
        '<div class="map-zoom-inline" role="toolbar" aria-label="Powiększenie mapy">' +
        '<button type="button" id="map-zoom-out" title="Pomniejsz" aria-label="Pomniejsz">−</button>' +
        '<button type="button" id="map-zoom-in" title="Powiększ" aria-label="Powiększ">+</button>' +
        '</div></div>' +
        '<div id="map-search-status" class="map-search-status" role="status" aria-live="polite"></div>' +
        zbiorkaFilterHtml +
        bulkPanelHtml;
      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.disableScrollPropagation(wrap);
      var zIn = wrap.querySelector('#map-zoom-in');
      var zOut = wrap.querySelector('#map-zoom-out');
      if (zIn) zIn.onclick = function() { map.zoomIn(); };
      if (zOut) zOut.onclick = function() { map.zoomOut(); };
      if (showZbiorkaFilter) {
        var zbiorkaRadios = wrap.querySelectorAll('input[name="map-zbiorka-filter"]');
        for (var zi = 0; zi < zbiorkaRadios.length; zi++) {
          zbiorkaRadios[zi].addEventListener('change', applyAddressSearch);
        }
      }
      if (wordDocEnabled) {
        var bulkGenBtn = wrap.querySelector('#map-bulk-generate');
        var bulkClearBtn = wrap.querySelector('#map-bulk-clear');
        if (bulkGenBtn) {
          bulkGenBtn.onclick = function () {
            var indices = getBulkSelectedIndices();
            if (indices.length === 0) {
              alert('Zaznacz co najmniej jeden punkt na mapie.');
              return;
            }
            openBulkDocModal(indices);
          };
        }
        if (bulkClearBtn) {
          bulkClearBtn.onclick = function () {
            clearBulkSelection();
            markerEntries.forEach(function (entry) {
              entry.marker.setPopupContent(buildPopupContent(entry.p, entry.pointIdx));
            });
            applyAddressSearch();
          };
        }
      }
      return wrap;
    };
    searchControl.addTo(map);

    var searchViewTimer = null;
    var skipInitialSearchViewport = true;
    function scheduleSearchViewport(hasFilter, raw, matchCount) {
      clearTimeout(searchViewTimer);
      if (skipInitialSearchViewport && !hasFilter) {
        return;
      }
      if (!hasFilter) {
        if (allPointsBounds && allPointsBounds.isValid()) {
          map.fitBounds(allPointsBounds, { padding: [40, 40] });
        }
        return;
      }
      if (matchCount === 0) {
        return;
      }
      searchViewTimer = setTimeout(function() {
        var inputEl = document.getElementById('map-address-search');
        var r = inputEl ? inputEl.value : '';
        if (String(r).trim().length === 0) return;
        var zMode = getZbiorkaFilterMode();
        var matched = markerEntries.filter(function(e) {
          var zOk = !showZbiorkaFilter || mapPointMatchesZbiorkaFilterMap(e.p.zbiorka, zMode);
          return zOk && mapPointMatchesSearchMap(e.p, r);
        });
        if (matched.length === 0) return;
        if (matched.length === 1) {
          var one = matched[0].p;
          map.setView([one.markerLat, one.markerLng], ${JSON.stringify(MAP_SEARCH_SINGLE_MATCH_ZOOM)}, { animate: true });
          return;
        }
        var pointBounds = L.latLngBounds(matched.map(function(e) { return [e.p.markerLat, e.p.markerLng]; }));
        if (pointBounds.isValid()) {
          map.fitBounds(pointBounds, {
            padding: ${JSON.stringify(MAP_SEARCH_FIT_PADDING)},
            maxZoom: ${JSON.stringify(MAP_SEARCH_MULTI_MATCH_MAX_ZOOM)},
            animate: true
          });
        }
      }, 300);
    }

    function applyAddressSearch() {
      var inputEl = document.getElementById('map-address-search');
      var statusEl = document.getElementById('map-search-status');
      var raw = inputEl ? inputEl.value : '';
      var hasSearchFilter = String(raw).trim().length > 0;
      var zbiorkaMode = getZbiorkaFilterMode();
      var matchCount = 0;
      markerEntries.forEach(function(entry) {
        var zMatch = !showZbiorkaFilter || mapPointMatchesZbiorkaFilterMap(entry.p.zbiorka, zbiorkaMode);
        if (!zMatch) {
          entry.marker.setOpacity(0);
          entry.marker.setZIndexOffset(0);
          setMarkerClickable(entry.marker, false);
          return;
        }
        var sMatch = mapPointMatchesSearchMap(entry.p, raw);
        if (hasSearchFilter && sMatch) matchCount++;
        setMarkerClickable(entry.marker, true);
        entry.marker.setOpacity(hasSearchFilter && !sMatch ? 0.3 : 1);
        entry.marker.setZIndexOffset(hasSearchFilter && sMatch ? 800 : 0);
        entry.marker.setIcon(markerDisplayIcon(entry, hasSearchFilter && sMatch));
      });
      if (statusEl) {
        if (!hasSearchFilter) {
          statusEl.textContent = '';
        } else if (matchCount === 0) {
          statusEl.textContent = 'Brak dopasowań';
        } else {
          statusEl.textContent = 'Znaleziono: ' + matchCount;
        }
      }
      scheduleSearchViewport(hasSearchFilter, raw, matchCount);
      skipInitialSearchViewport = false;
    }
    var searchInputEl = document.getElementById('map-address-search');
    if (searchInputEl) {
      searchInputEl.addEventListener('input', applyAddressSearch);
      searchInputEl.addEventListener('search', applyAddressSearch);
    }
    applyAddressSearch();

    var legend = L.control({ position: 'bottomright' });
    legend.onAdd = function() {
      var div = L.DomUtil.create('div', 'map-legend');
      var qualityHtml = legendQualityItems.length > 0
        ? '<div class="legend-section"><h3>Jakość adresu</h3><ul>' +
          legendQualityItems.map(function(item) {
            return '<li><span class="legend-swatch" style="background:' + item.color + '"></span> ' + item.label + '</li>';
          }).join('') + '</ul></div>'
        : '';
      var okLight = paletteOk[0], okMed = paletteOk[1], okFull = paletteOk[2];
      var countLegendTitle = transportApiEnabled ? 'Worki do odebrania' : 'Liczba wystąpień';
      var countHtml = hasCountLegend
        ? '<div class="legend-section"><h3>' + countLegendTitle + '</h3><ul>' +
          '<li><span class="legend-swatch" style="background:' + okLight + '"></span> 1–3</li>' +
          '<li><span class="legend-swatch" style="background:' + okMed + '"></span> 4–9</li>' +
          '<li><span class="legend-swatch" style="background:' + okFull + '"></span> 10–14</li>' +
          '<li><span class="legend-swatch" style="background:' + color15Plus + '"></span> 15+</li>' +
          '</ul></div>'
        : '';
      var bulkLegendHtml = wordDocEnabled
        ? '<div class="legend-section"><h3>Zaznaczenie zbiorcze</h3><ul>' +
          '<li><span class="legend-swatch" style="background:' + colorBulkSelected + '"></span> Punkt zaznaczony</li>' +
          '</ul></div>'
        : '';
      div.innerHTML = qualityHtml + countHtml + bulkLegendHtml;
      return div;
    };
    legend.addTo(map);
  </script>
</body>
</html>`;
}

async function resolveWordMapHtmlEmbed(
  input: ExecutePhase6Input,
): Promise<WordMapHtmlEmbed | null> {
  if (input.wordMapEmbed !== undefined) {
    const manual = input.wordMapEmbed;
    if (!manual.templateBase64) {
      return null;
    }
    return {
      templateBase64: manual.templateBase64,
      podwykoOptions: manual.podwykoOptions ?? [],
    };
  }
  const paths = input.wordMapPaths ?? getOptionalWordMapAssetPaths();
  try {
    const templateBase64 = await readWordTemplateAsBase64ForMap(paths.templatePath);
    let podwykoOptions: PodwykoOption[] = [];
    try {
      podwykoOptions = await loadPodwykoOptionsFromSpreadsheet(paths.podwykoPath);
    } catch {
      /* brak lub uszkodzony plik listy */
    }
    return { templateBase64, podwykoOptions };
  } catch {
    return null;
  }
}

export interface ExecutePhase6Input {
  outputDir: string;
  geocoded: GeocodedAddress[];
  uncertainGeocoded: GeocodedAddress[];
  cityOnlyGeocoded?: GeocodedAddress[];
  geocodedNoPostcode?: GeocodedAddress[];
  geoJsonUrl: string;
  /** Jawne osadzenie szablonu/listy (testy) albo wyłączenie przez { templateBase64: '' }. */
  wordMapEmbed?: WordMapHtmlEmbed;
  /** Nadpisuje domyślne ścieżki docs/pusty.docx i docs/podwyko lista.xlsx */
  wordMapPaths?: { templatePath: string; podwykoPath: string };
  /** URL Web App rejestru transportów (nadpisuje TRANSPORT_WEBAPP_URL z env). */
  transportWebAppUrl?: string;
  now?: () => Date;
  mkdirFn?: (path: string, options: { recursive: true }) => Promise<unknown>;
  writeFileFn?: (path: string, content: string, encoding: BufferEncoding) => Promise<unknown>;
}

export interface ExecutePhase6Result {
  fileName: string;
  filePath: string;
  htmlContent: string;
}

export async function executePhase6(input: ExecutePhase6Input): Promise<ExecutePhase6Result> {
  const now = input.now ?? (() => new Date());
  const mkdirFn = input.mkdirFn ?? mkdir;
  const writeFileFn =
    input.writeFileFn ??
    (async (path: string, content: string, encoding: BufferEncoding) => {
      await writeFile(path, content, encoding);
    });

  const fileName = buildMapFileName(now());
  const filePath = join(input.outputDir, fileName);
  const wordEmbed = await resolveWordMapHtmlEmbed(input);
  const transportWebAppUrl = input.transportWebAppUrl ?? getTransportWebAppUrl();
  const htmlContent = buildMapHtml(
    input.geocoded,
    input.uncertainGeocoded,
    input.geoJsonUrl,
    input.cityOnlyGeocoded ?? [],
    input.geocodedNoPostcode ?? [],
    wordEmbed,
    transportWebAppUrl,
  );

  await mkdirFn(input.outputDir, { recursive: true });
  await writeFileFn(filePath, htmlContent, 'utf-8');

  return { fileName, filePath, htmlContent };
}
