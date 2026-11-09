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
 * Skupiska lądują na siatce sześciokątnej — odpychanie z limitem kroków nie kończyło
 * rozsuwania przy przybliżeniu i pinezki zostawały jedna na drugiej.
 */
export function separateOverlappingPoints(points: ScreenPoint[], minDistancePx: number): ScreenPoint[] {
  const count = points.length;
  const pos: ScreenPoint[] = [];
  for (let index = 0; index < count; index++) {
    const point = points[index]!;
    pos.push({ x: point.x, y: point.y });
  }
  if (count < 2 || minDistancePx <= 0) {
    return pos;
  }

  const hexY = Math.sqrt(3) / 2;
  const dirs: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ];
  function hexRound(qf: number, rf: number): readonly [number, number] {
    const sf = -qf - rf;
    let q = Math.round(qf);
    let r = Math.round(rf);
    let s = Math.round(sf);
    const dq = Math.abs(q - qf);
    const dr = Math.abs(r - rf);
    const ds = Math.abs(s - sf);
    if (dq > dr && dq > ds) {
      q = -r - s;
    } else if (dr > ds) {
      r = -q - s;
    }
    return [q, r];
  }
  function hexOf(x: number, y: number): readonly [number, number] {
    const r = y / (minDistancePx * hexY);
    const q = x / minDistancePx - r / 2;
    return hexRound(q, r);
  }

  const cell = minDistancePx;
  const gap = minDistancePx - 0.01;
  const occupiedHex = new Set<string>();
  const offGrid = new Map<string, ScreenPoint[]>();
  function offGridHits(x: number, y: number): boolean {
    const cellX = Math.floor(x / cell);
    const cellY = Math.floor(y / cell);
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        const bucket = offGrid.get(`${cellX + offsetX}:${cellY + offsetY}`);
        if (!bucket) {
          continue;
        }
        for (const other of bucket) {
          if (Math.hypot(other.x - x, other.y - y) < gap) {
            return true;
          }
        }
      }
    }
    return false;
  }
  function rememberOffGrid(x: number, y: number): void {
    const key = `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
    const bucket = offGrid.get(key);
    if (bucket) {
      bucket.push({ x, y });
    } else {
      offGrid.set(key, [{ x, y }]);
    }
  }

  const crowded = new Array<boolean>(count).fill(false);
  const originGrid = new Map<string, number[]>();
  for (let index = 0; index < count; index++) {
    const key = `${Math.floor(pos[index]!.x / cell)}:${Math.floor(pos[index]!.y / cell)}`;
    const bucket = originGrid.get(key);
    if (bucket) {
      bucket.push(index);
    } else {
      originGrid.set(key, [index]);
    }
  }
  for (let index = 0; index < count; index++) {
    const cellX = Math.floor(pos[index]!.x / cell);
    const cellY = Math.floor(pos[index]!.y / cell);
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        const bucket = originGrid.get(`${cellX + offsetX}:${cellY + offsetY}`);
        if (!bucket) {
          continue;
        }
        for (const other of bucket) {
          if (other <= index) {
            continue;
          }
          if (Math.hypot(pos[other]!.x - pos[index]!.x, pos[other]!.y - pos[index]!.y) < minDistancePx) {
            crowded[index] = true;
            crowded[other] = true;
          }
        }
      }
    }
  }

  for (let index = 0; index < count; index++) {
    if (!crowded[index]) {
      rememberOffGrid(pos[index]!.x, pos[index]!.y);
    }
  }

  let fallbackId = 0;
  function nearestFree(x: number, y: number): { x: number; y: number; key: string } {
    const origin = hexOf(x, y);
    const originQ = origin[0];
    const originR = origin[1];
    const maxRing = count + 1;
    for (let ring = 0; ring <= maxRing; ring++) {
      let bestX = 0;
      let bestY = 0;
      let bestKey = '';
      let bestDist = Infinity;
      function visit(q: number, r: number): void {
        const key = `${q}:${r}`;
        if (occupiedHex.has(key)) {
          return;
        }
        const px = minDistancePx * (q + r / 2);
        const py = minDistancePx * hexY * r;
        if (offGridHits(px, py)) {
          return;
        }
        const dist = Math.hypot(px - x, py - y);
        if (dist < bestDist) {
          bestDist = dist;
          bestX = px;
          bestY = py;
          bestKey = key;
        }
      }
      if (ring === 0) {
        visit(originQ, originR);
      } else {
        let q = originQ + dirs[4]![0] * ring;
        let r = originR + dirs[4]![1] * ring;
        for (let side = 0; side < 6; side++) {
          const dir = dirs[side]!;
          for (let step = 0; step < ring; step++) {
            visit(q, r);
            q += dir[0];
            r += dir[1];
          }
        }
      }
      if (bestKey) {
        return { x: bestX, y: bestY, key: bestKey };
      }
    }
    fallbackId += 1;
    return {
      x,
      y: y + minDistancePx * (count + fallbackId),
      key: `fb:${fallbackId}`,
    };
  }

  for (let index = 0; index < count; index++) {
    if (!crowded[index]) {
      continue;
    }
    const free = nearestFree(pos[index]!.x, pos[index]!.y);
    if (free.key.startsWith('fb:')) {
      rememberOffGrid(free.x, free.y);
    } else {
      occupiedHex.add(free.key);
    }
    pos[index] = { x: free.x, y: free.y };
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
