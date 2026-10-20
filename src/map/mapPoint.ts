/** Punkt mapy osadzany w HTML (`adresy` w skrypcie przeglądarki). */

import { shouldCopyToOdebraneZHarmonogramu } from '../harmonogramDays.js';
import type { GeocodedAddress } from '../phase5.js';
import type { SheetRow } from '../sheets.js';
import {
  buildMiejsceZaladunkuText,
  firstPodmiotHandlowyFromRows,
  firstSklepFromRows,
  sealRowsFromSheetRowsWithOdebraneFlag,
  type MapPointDocPayload,
  type SealRowLite,
} from '../wordMapSupport.js';
import { formatRodzajZbiorkiForDoc } from '../zbiorkaClassify.js';
import { normalizeForAddressSearch, normalizeWojewodztwoLabel } from './searchFilters.js';

export type MapPoint = {
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
  /** Miejscowość z arkusza — tylko do przecinka w widocznym adresie. */
  miasto: string;
  /** Wiersze plomb do filtrowania w protokole (data zamknięcia worka). */
  sealRows: SealRowLite[];
  /** Zbiórka: Ręczna / Maszyna (z kolumny L) */
  zbiorka?: string;
  /** Wg harmonogramu: tak / nie */
  wgHarmonogramu?: string;
  /** Dni harmonogramu (np. pn, cz) — do prefilla stawek z harmonogramu. */
  dniHarmonogramu?: string;
  /** Firma transportowa (gdy harmonogram tak — pokazywana w popupie). */
  firmaTransportowa?: string;
  /** Agregat zbiórki całej pinezki (mapa). Protokół Word i rejestr transportu liczą rodzaj z `sealRows` po filtrze daty. */
  rodzaj_zbiorki: string;
  /** Listę plomb przeglądarka buduje z `sealRows` po filtrze daty — tu tylko miejsce załadunku. */
  doc: Pick<MapPointDocPayload, 'miejsce_zaladunku'>;
};

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

function firstMiastoFromRows(rows: SheetRow[]): string {
  for (const row of rows) {
    const city = row.miasto.trim();
    if (city) {
      return city;
    }
  }
  return '';
}

export function toMapPoint(item: GeocodedAddress, confidence: MapPoint['confidence']): MapPoint {
  return {
    adres: item.address,
    count: item.count,
    lat: item.lat,
    lng: item.lng,
    markerLat: item.lat,
    markerLng: item.lng,
    woj: normalizeWojewodztwoLabel(item.wojewodztwo),
    confidence,
    searchLabels: uniqueSearchLabelsFromRows(item.rows),
    podmiotyHandlowe: uniquePodmiotyHandloweFromRows(item.rows),
    podmiotHandlowy: firstPodmiotHandlowyFromRows(item.rows),
    sklep: firstSklepFromRows(item.rows),
    miasto: firstMiastoFromRows(item.rows),
    sealRows: sealRowsFromSheetRowsWithOdebraneFlag(item.rows, (r) =>
      shouldCopyToOdebraneZHarmonogramu({
        zbiorka: r.zbiorka,
        wgHarmonogramu: r.wgHarmonogramu,
        dniHarmonogramu: r.dniHarmonogramu,
        dataZamknieciaWorka: r.dataZamknieciaWorka,
      }),
    ),
    zbiorka: item.zbiorka,
    wgHarmonogramu: item.wgHarmonogramu,
    dniHarmonogramu: item.dniHarmonogramu,
    firmaTransportowa: item.firmaTransportowa,
    rodzaj_zbiorki: formatRodzajZbiorkiForDoc(item.zbiorka),
    doc: { miejsce_zaladunku: buildMiejsceZaladunkuText(item.rows) },
  };
}
