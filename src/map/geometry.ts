/** Odległości i rozsuwanie nakładających się pinezek mapy. */

import type { GeocodedAddress } from '../phase5.js';

/** Maks. odległość między punktami (m), aby uznać je za „nakładające się” na mapie. */
export const MAP_MARKER_CLUSTER_MAX_M = 20;

/** Promień rozsunięcia markerów wokół środka klastra (m) — pozycja zanim mapa dopasuje odstęp do zoomu. */
export const MAP_MARKER_SPREAD_RADIUS_M = 18;

/** Średnica ikony pinezki na mapie (px). Zgodna z `pinIcon` w skrypcie przeglądarki. */
export const PIN_ICON_PX = 24;

/** Odstęp między krawędziami sąsiednich ikon (px), żeby pinezki stały obok siebie i nie nachodziły. */
export const PIN_GAP_PX = 8;

export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Rozsuwa punkty na ekranie tak, żeby środki były co najmniej `minDistancePx` od siebie.
 * Punkt, który już ma dość miejsca, zostaje na swoim miejscu.
 */
export function separateOverlappingPoints(
  points: ScreenPoint[],
  minDistancePx: number,
  maxIterations = 48,
): ScreenPoint[] {
  const pos = points.map((point) => ({ x: point.x, y: point.y }));
  const count = pos.length;
  if (count < 2 || minDistancePx <= 0) {
    return pos;
  }
  const cell = minDistancePx;
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const grid = new Map<string, number[]>();
    for (let index = 0; index < count; index++) {
      const key = `${Math.floor(pos[index]!.x / cell)}:${Math.floor(pos[index]!.y / cell)}`;
      const bucket = grid.get(key);
      if (bucket) {
        bucket.push(index);
      } else {
        grid.set(key, [index]);
      }
    }
    const shiftX = new Array<number>(count).fill(0);
    const shiftY = new Array<number>(count).fill(0);
    let moved = false;
    for (let index = 0; index < count; index++) {
      const cellX = Math.floor(pos[index]!.x / cell);
      const cellY = Math.floor(pos[index]!.y / cell);
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        for (let offsetY = -1; offsetY <= 1; offsetY++) {
          const bucket = grid.get(`${cellX + offsetX}:${cellY + offsetY}`);
          if (!bucket) {
            continue;
          }
          for (const other of bucket) {
            if (other <= index) {
              continue;
            }
            let deltaX = pos[other]!.x - pos[index]!.x;
            let deltaY = pos[other]!.y - pos[index]!.y;
            const distance = Math.hypot(deltaX, deltaY);
            if (distance >= minDistancePx) {
              continue;
            }
            let unitX: number;
            let unitY: number;
            let gap: number;
            if (distance < 0.5) {
              const angle = ((index * 13 + other * 7) % 360) * (Math.PI / 180);
              unitX = Math.cos(angle);
              unitY = Math.sin(angle);
              gap = minDistancePx;
            } else {
              unitX = deltaX / distance;
              unitY = deltaY / distance;
              gap = minDistancePx - distance;
            }
            const shift = gap / 2;
            shiftX[index]! -= unitX * shift;
            shiftY[index]! -= unitY * shift;
            shiftX[other]! += unitX * shift;
            shiftY[other]! += unitY * shift;
            moved = true;
          }
        }
      }
    }
    if (!moved) {
      break;
    }
    for (let index = 0; index < count; index++) {
      pos[index]!.x += shiftX[index]!;
      pos[index]!.y += shiftY[index]!;
    }
  }
  return pos;
}

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
