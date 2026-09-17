/**
 * Wyznaczanie województwa z lat/lng (point-in-polygon na GeoJSON granic).
 * Ten sam zbiór co granice na mapie (GEOJSON_WOJEWODZTWA_URL).
 */

import { GEOJSON_WOJEWODZTWA_URL } from './config.js';

export interface WojewodztwoGeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface WojewodztwoGeoJsonMultiPolygon {
  type: 'MultiPolygon';
  coordinates: number[][][][];
}

export interface WojewodztwoGeoJsonFeature {
  type: 'Feature';
  properties?: Record<string, unknown> | null;
  geometry: WojewodztwoGeoJsonPolygon | WojewodztwoGeoJsonMultiPolygon | null;
}

export interface WojewodztwoGeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features: WojewodztwoGeoJsonFeature[];
}

/** Czy etykieta województwa jest pusta / zastępcza. */
export function isUnknownWojewodztwo(woj: string | undefined): boolean {
  const t = String(woj ?? '').trim();
  if (t.length === 0 || t === 'Nieznane') {
    return true;
  }
  const lower = t.toLowerCase();
  return lower === 'do uzupełnienia' || lower === 'do uzupelnienia';
}

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  const n = ring.length;
  if (n < 3) {
    return false;
  }
  let j = n - 1;
  for (let i = 0; i < n; i += 1) {
    const xi = ring[i]?.[0];
    const yi = ring[i]?.[1];
    const xj = ring[j]?.[0];
    const yj = ring[j]?.[1];
    if (
      xi == null ||
      yi == null ||
      xj == null ||
      yj == null ||
      !Number.isFinite(xi) ||
      !Number.isFinite(yi) ||
      !Number.isFinite(xj) ||
      !Number.isFinite(yj)
    ) {
      j = i;
      continue;
    }
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersect) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}

function pointInPolygonGeometry(
  lng: number,
  lat: number,
  geometry: WojewodztwoGeoJsonPolygon | WojewodztwoGeoJsonMultiPolygon,
): boolean {
  const polygons =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  for (const poly of polygons) {
    if (!poly || poly.length === 0) {
      continue;
    }
    const outer = poly[0];
    if (!outer || !pointInRing(lng, lat, outer)) {
      continue;
    }
    let inHole = false;
    for (let h = 1; h < poly.length; h += 1) {
      const hole = poly[h];
      if (hole && pointInRing(lng, lat, hole)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) {
      return true;
    }
  }
  return false;
}

/** Normalizacja nazwy jak w {@link extractVoivodeship} (Nominatim state). */
export function normalizeWojewodztwoGeoJsonName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }
  const lowered = trimmed.toLowerCase();
  const withoutPrefix = lowered.startsWith('województwo ')
    ? trimmed.slice('województwo '.length).trim()
    : trimmed;
  if (!withoutPrefix) {
    return '';
  }
  return withoutPrefix.charAt(0).toUpperCase() + withoutPrefix.slice(1);
}

function featureVoivodeshipName(feature: WojewodztwoGeoJsonFeature): string {
  const props = feature.properties ?? {};
  for (const key of ['name', 'NAME_1', 'nazwa', 'NAZWA', 'wojewodztwo', 'Województwo'] as const) {
    const v = props[key];
    if (typeof v === 'string' && v.trim()) {
      return normalizeWojewodztwoGeoJsonName(v);
    }
  }
  return '';
}

/**
 * Zwraca nazwę województwa dla punktu albo pusty string, gdy poza granicami / brak dopasowania.
 */
export function resolveWojewodztwoFromLatLng(
  lat: number,
  lng: number,
  features: readonly WojewodztwoGeoJsonFeature[],
): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || features.length === 0) {
    return '';
  }
  for (const feature of features) {
    const geometry = feature.geometry;
    if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
      continue;
    }
    if (!pointInPolygonGeometry(lng, lat, geometry)) {
      continue;
    }
    return featureVoivodeshipName(feature);
  }
  return '';
}

export function parseWojewodztwaGeoJson(raw: unknown): WojewodztwoGeoJsonFeature[] {
  if (!raw || typeof raw !== 'object') {
    return [];
  }
  const fc = raw as Partial<WojewodztwoGeoJsonFeatureCollection>;
  if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    return [];
  }
  return fc.features.filter((f): f is WojewodztwoGeoJsonFeature => Boolean(f && f.type === 'Feature'));
}

export async function loadWojewodztwaGeoJsonFeatures(
  fetchFn: typeof fetch,
  url: string = GEOJSON_WOJEWODZTWA_URL,
): Promise<WojewodztwoGeoJsonFeature[]> {
  const response = await fetchFn(url, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`GeoJSON województw HTTP ${response.status}`);
  }
  const raw: unknown = await response.json();
  return parseWojewodztwaGeoJson(raw);
}

/**
 * Uzupełnia `wojewodztwo`, gdy brak / „Nieznane” i są współrzędne.
 * Zwraca ten sam obiekt, gdy nic nie zmieniono.
 */
export function enrichWojewodztwoIfMissing<T extends { lat?: number; lng?: number; wojewodztwo?: string }>(
  entry: T,
  features: readonly WojewodztwoGeoJsonFeature[] | null | undefined,
): T {
  if (!isUnknownWojewodztwo(entry.wojewodztwo)) {
    return entry;
  }
  if (typeof entry.lat !== 'number' || typeof entry.lng !== 'number') {
    return entry;
  }
  if (!features || features.length === 0) {
    return entry;
  }
  const woj = resolveWojewodztwoFromLatLng(entry.lat, entry.lng, features);
  if (!woj) {
    return entry;
  }
  return { ...entry, wojewodztwo: woj };
}
