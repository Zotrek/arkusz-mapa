/**
 * Testy TDD dla Fazy 6 – generowanie mapy HTML.
 *
 * Wymagania:
 *   REQ-6.1: szablon Leaflet + granice województw (GeoJSON)
 *   REQ-6.2: dane geokodowane wstrzyknięte do mapy (adres, count, lat, lng, woj)
 *   REQ-6.3: nazwa pliku mapa_YYYY-MM-DD_HH-mm-ss.html (czas w strefie Europe/Warsaw)
 *   REQ-6.4: zapis pliku do OUTPUT_DIR
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, it, expect, vi } from 'vitest';
import type { GeocodedAddress } from './phase5';
import type { SheetRow } from './sheets';
import {
  formatTimestampForFileName,
  formatGeneratedAtLabel,
  buildMapFileName,
  defaultDateZaladunkuYmd,
  buildMapHtml,
  executePhase6,
  normalizeForAddressSearch,
  podwykoOptionMatchesSearch,
  addressMatchesSearch,
  mapPointMatchesSearch,
  uniquePodmiotyHandloweFromRows,
  classifyMapPointZbiorka,
  mapPointMatchesZbiorkaFilter,
  normalizeWgHarmonogramu,
  mapPointMatchesWgHarmonogramuFilter,
  normalizeWojewodztwoLabel,
  uniqueWojewodztwaFromMapPoints,
  mapPointMatchesWojewodztwoFilter,
  formatWojewodztwoFilterSummary,
  haversineMeters,
  spreadCloseMarkerPositions,
  findCloseMapPointPairs,
  buildCloseGeocodedAddressPairs,
  buildTransportShopKey,
  resolveTransportCutoffMsForPoint,
  MAP_MARKER_CLUSTER_MAX_M,
  MAP_SEARCH_SINGLE_MATCH_ZOOM,
  MAP_SEARCH_FIT_PADDING,
} from './phase6';
import { filterSealRowsByMinClosureDate } from './wordMapSupport';
import { routeNameBrowserScript } from './routeName';
import { routeProtocolBrowserScript } from './routeProtocol';

function makeSheetRow(overrides: Partial<SheetRow> = {}): SheetRow {
  return {
    sourceRowIndex: overrides.sourceRowIndex ?? 2,
    podmiotHandlowy: overrides.podmiotHandlowy ?? '',
    sklep: overrides.sklep ?? '',
    gmina: overrides.gmina ?? '',
    numerPlomby: overrides.numerPlomby ?? '',
    dataZamknieciaWorka: overrides.dataZamknieciaWorka ?? '',
    zbiorka: overrides.zbiorka ?? '',
    wgHarmonogramu: overrides.wgHarmonogramu ?? '',
    dniHarmonogramu: overrides.dniHarmonogramu ?? '',
    firmaTransportowa: overrides.firmaTransportowa ?? '',
    raw: overrides.raw ?? [],
    address: overrides.address ?? '62-320 Miłosław Leśna 1',
    kodPocztowy: overrides.kodPocztowy ?? '62-320',
    miasto: overrides.miasto ?? 'Miłosław',
    ulica: overrides.ulica ?? 'Leśna',
    ulicaRaw: overrides.ulicaRaw ?? overrides.ulica ?? 'Leśna',
    numerBudynku: overrides.numerBudynku ?? '1',
  };
}

function sampleGeocoded(): GeocodedAddress[] {
  return [
    {
      address: '62-320 Miłosław os. Władysława Łokietka 18',
      count: 5,
      lat: 52.206,
      lng: 17.489,
      wojewodztwo: 'Wielkopolskie',
      rows: [],
    },
    {
      address: '02-785 Warszawa Surowieckiego 10',
      count: 2,
      lat: 52.159,
      lng: 21.031,
      wojewodztwo: 'Mazowieckie',
      rows: [],
    },
  ];
}

function sampleUncertainGeocoded(): GeocodedAddress[] {
  return [
    {
      address: '34-700 Rabka Chopina 16',
      count: 1,
      lat: 49.609,
      lng: 19.966,
      wojewodztwo: 'Małopolskie',
      rows: [],
    },
  ];
}

describe('phase6', () => {
  describe('marker spread', () => {
    it('test_spreadCloseMarkerPositions_when_two_points_same_coords_should_offset_markers', () => {
      const base = { lat: 52.2, lng: 21.0 };
      const spread = spreadCloseMarkerPositions([
        { ...base, id: 'a' },
        { ...base, id: 'b' },
      ]);
      expect(spread[0]!.lat).toBe(52.2);
      expect(spread[0]!.lng).toBe(21.0);
      expect(spread[1]!.lat).toBe(52.2);
      expect(haversineMeters(spread[0]!.markerLat, spread[0]!.markerLng, spread[1]!.markerLat, spread[1]!.markerLng)).toBeGreaterThan(
        30,
      );
    });

    it('test_spreadCloseMarkerPositions_when_points_far_apart_should_keep_marker_coords', () => {
      const spread = spreadCloseMarkerPositions([
        { lat: 52.2, lng: 21.0 },
        { lat: 52.3, lng: 21.1 },
      ]);
      expect(spread[0]!.markerLat).toBe(52.2);
      expect(spread[0]!.markerLng).toBe(21.0);
      expect(spread[1]!.markerLat).toBe(52.3);
      expect(spread[1]!.markerLng).toBe(21.1);
    });

    it('test_findCloseMapPointPairs_when_within_20m_should_list_pair', () => {
      const pairs = findCloseMapPointPairs([
        { lat: 50.0, lng: 20.0 },
        { lat: 50.0, lng: 20.0001 },
      ]);
      expect(pairs).toHaveLength(1);
      expect(pairs[0]!.distanceM).toBeLessThanOrEqual(MAP_MARKER_CLUSTER_MAX_M);
    });

    it('test_buildCloseGeocodedAddressPairs_when_two_same_coords_should_return_row_with_addresses', () => {
      const base = {
        count: 1,
        lat: 52.1,
        lng: 21.0,
        wojewodztwo: 'Mazowieckie',
        rows: [] as SheetRow[],
      };
      const pairs = buildCloseGeocodedAddressPairs(
        [{ ...base, address: 'Adres A' }],
        [{ ...base, address: 'Adres B' }],
      );
      expect(pairs).toHaveLength(1);
      expect(pairs[0]!.adresA).toBe('Adres A');
      expect(pairs[0]!.adresB).toBe('Adres B');
      expect(pairs[0]!.odlegloscM).toBe(0);
    });
  });

  describe('address search helpers', () => {
    it('test_normalizeForAddressSearch_when_diacritics_should_fold_and_lower', () => {
      expect(normalizeForAddressSearch('Łódź')).toBe('lodz');
      expect(normalizeForAddressSearch('  WaWa  ')).toBe('wawa');
    });

    it('test_addressMatchesSearch_when_partial_city_should_match', () => {
      expect(addressMatchesSearch('62-320 Miłosław os. Władysława Łokietka 18', 'miloslaw')).toBe(true);
      expect(addressMatchesSearch('62-320 Miłosław os. Władysława Łokietka 18', 'lokietka')).toBe(true);
    });

    it('test_addressMatchesSearch_when_empty_query_should_match_all', () => {
      expect(addressMatchesSearch('ul. Test 1', '   ')).toBe(true);
      expect(addressMatchesSearch('ul. Test 1', '')).toBe(true);
    });

    it('test_addressMatchesSearch_when_no_substring_should_be_false', () => {
      expect(addressMatchesSearch('62-320 Miłosław', 'Warszawa')).toBe(false);
    });

    it('test_mapPointMatchesSearch_when_query_in_podmiot_should_match', () => {
      expect(
        mapPointMatchesSearch('00-001 Warszawa ul. Inna 1', ['Biedronka SA'], 'biedronka'),
      ).toBe(true);
    });

    it('test_uniquePodmiotyHandloweFromRows_when_rows_given_should_deduplicate_column_a', () => {
      const rows = [
        makeSheetRow({ podmiotHandlowy: 'ACME Sp. z o.o.', sklep: 'Sklep A' }),
        makeSheetRow({ podmiotHandlowy: 'ACME Sp. z o.o.', sklep: 'Sklep B' }),
        makeSheetRow({ podmiotHandlowy: 'Inna firma', sklep: '' }),
        makeSheetRow({ podmiotHandlowy: '  ', sklep: 'Tylko sklep' }),
      ];
      expect(uniquePodmiotyHandloweFromRows(rows)).toEqual(['ACME Sp. z o.o.', 'Inna firma']);
    });

    it('test_mapPointMatchesSearch_when_query_in_sklep_should_match', () => {
      expect(
        mapPointMatchesSearch('00-001 Warszawa ul. Inna 1', ['PH', 'Sklep przy Rynku'], 'rynku'),
      ).toBe(true);
    });

    it('test_podwykoOptionMatchesSearch_when_fragment_in_label_or_dane_should_match', () => {
      expect(
        podwykoOptionMatchesSearch('BLUECARGO', 'BLUECARGO Sp. ul. Rajska 1, Kraków', 'blue'),
      ).toBe(true);
      expect(
        podwykoOptionMatchesSearch('BLUECARGO', 'BLUECARGO Sp. ul. Rajska 1, Kraków', 'carg'),
      ).toBe(true);
      expect(
        podwykoOptionMatchesSearch('BLUECARGO', 'BLUECARGO Sp. ul. Rajska 1, Kraków', 'rajska'),
      ).toBe(true);
      expect(podwykoOptionMatchesSearch('Janex', 'Janex — pełne dane', 'janex')).toBe(true);
      expect(podwykoOptionMatchesSearch('Janex', 'Janex — pełne dane', 'pelne')).toBe(true);
    });

    it('test_podwykoOptionMatchesSearch_when_no_match_should_be_false', () => {
      expect(podwykoOptionMatchesSearch('BLUECARGO', 'Kraków', 'warszawa')).toBe(false);
    });

    it('test_podwykoOptionMatchesSearch_when_empty_query_should_match_all', () => {
      expect(podwykoOptionMatchesSearch('A', 'B', '')).toBe(true);
    });

    it('test_mapPointMatchesSearch_when_query_not_in_any_field_should_be_false', () => {
      expect(
        mapPointMatchesSearch('62-320 Miłosław Leśna 1', ['Firma X'], 'Warszawa'),
      ).toBe(false);
    });

    it('test_mapPointMatchesSearch_when_empty_query_should_match_all', () => {
      expect(mapPointMatchesSearch('x', [], '  ')).toBe(true);
    });
  });

  describe('zbiorka filter', () => {
    it('test_classifyMapPointZbiorka_when_reczna_and_maszyna_should_return_obie', () => {
      expect(classifyMapPointZbiorka('Ręczna / Maszyna')).toBe('obie');
    });

    it('test_classifyMapPointZbiorka_when_only_reczna_should_return_reczna', () => {
      expect(classifyMapPointZbiorka('Ręczna')).toBe('reczna');
    });

    it('test_classifyMapPointZbiorka_when_only_maszyna_should_return_maszyna', () => {
      expect(classifyMapPointZbiorka('Maszyna')).toBe('maszyna');
    });

    it('test_mapPointMatchesZbiorkaFilter_when_wszystkie_should_match_any_point', () => {
      expect(mapPointMatchesZbiorkaFilter('Ręczna / Maszyna', 'wszystkie')).toBe(true);
      expect(mapPointMatchesZbiorkaFilter('Ręczna', 'wszystkie')).toBe(true);
      expect(mapPointMatchesZbiorkaFilter(undefined, 'wszystkie')).toBe(true);
    });

    it('test_mapPointMatchesZbiorkaFilter_when_obie_should_match_both_modes_only', () => {
      expect(mapPointMatchesZbiorkaFilter('Ręczna / Maszyna', 'obie')).toBe(true);
      expect(mapPointMatchesZbiorkaFilter('Ręczna', 'obie')).toBe(false);
      expect(mapPointMatchesZbiorkaFilter('Maszyna', 'obie')).toBe(false);
    });

    it('test_mapPointMatchesZbiorkaFilter_when_reczna_mode_should_match_reczna_only', () => {
      expect(mapPointMatchesZbiorkaFilter('Ręczna', 'reczna')).toBe(true);
      expect(mapPointMatchesZbiorkaFilter('Ręczna / Maszyna', 'reczna')).toBe(false);
    });

    it('test_mapPointMatchesZbiorkaFilter_when_maszyna_mode_should_match_maszyna_only', () => {
      expect(mapPointMatchesZbiorkaFilter('Maszyna', 'maszyna')).toBe(true);
      expect(mapPointMatchesZbiorkaFilter('Ręczna / Maszyna', 'maszyna')).toBe(false);
    });
  });

  describe('wg harmonogramu filter', () => {
    it('test_normalizeWgHarmonogramu_when_tak_nie_should_normalize', () => {
      expect(normalizeWgHarmonogramu('tak')).toBe('tak');
      expect(normalizeWgHarmonogramu(' Tak ')).toBe('tak');
      expect(normalizeWgHarmonogramu('NIE')).toBe('nie');
      expect(normalizeWgHarmonogramu('')).toBe('');
      expect(normalizeWgHarmonogramu('może')).toBe('');
    });

    it('test_mapPointMatchesWgHarmonogramuFilter_when_modes_should_match', () => {
      expect(mapPointMatchesWgHarmonogramuFilter('tak', 'wszystkie')).toBe(true);
      expect(mapPointMatchesWgHarmonogramuFilter('', 'wszystkie')).toBe(true);
      expect(mapPointMatchesWgHarmonogramuFilter('tak', 'tak')).toBe(true);
      expect(mapPointMatchesWgHarmonogramuFilter('nie', 'tak')).toBe(false);
      expect(mapPointMatchesWgHarmonogramuFilter('nie', 'nie')).toBe(true);
      expect(mapPointMatchesWgHarmonogramuFilter(undefined, 'nie')).toBe(false);
    });

    it('test_buildMapHtml_when_odebrane_z_harmonogramu_row_should_embed_flag_and_collection_filter', () => {
      const geo: GeocodedAddress[] = [
        {
          address: 'Adres odebrane',
          count: 2,
          lat: 52.1,
          lng: 21.0,
          wojewodztwo: 'Mazowieckie',
          wgHarmonogramu: 'tak',
          rows: [
            makeSheetRow({
              numerPlomby: 'ODEBRANA',
              zbiorka: 'Maszyna',
              wgHarmonogramu: 'tak',
              dniHarmonogramu: 'pn',
              dataZamknieciaWorka: '07.08.2026',
            }),
            makeSheetRow({
              numerPlomby: 'BIEZACA',
              zbiorka: 'Ręczna',
              wgHarmonogramu: 'nie',
              dniHarmonogramu: '',
              dataZamknieciaWorka: '10.09.2026',
            }),
          ],
        },
      ];
      const html = buildMapHtml(geo, [], 'https://example.com/woj.json');
      expect(html).toContain('sealRowsForCollection');
      expect(html).toContain('"odebraneZHarmonogramu":true');
      expect(html).toContain('"odebraneZHarmonogramu":false');
      expect(html).toContain('ODEBRANA');
      expect(html).toContain('BIEZACA');
      // Fallback jak resolveCollectibleSealCount: puste sealRows → total (p.count), nie 0
      expect(html).toContain('countSealRows(p.sealRows) === 0 ? total : collectible.length');
    });

    it('test_buildMapHtml_when_harmonogram_data_present_should_embed_filter_controls', () => {
      const geo: GeocodedAddress[] = [
        {
          address: 'Adres tak',
          count: 1,
          lat: 52.1,
          lng: 21.0,
          wojewodztwo: 'Mazowieckie',
          wgHarmonogramu: 'tak',
          rows: [],
        },
        {
          address: 'Adres nie',
          count: 1,
          lat: 52.2,
          lng: 21.1,
          wojewodztwo: 'Mazowieckie',
          wgHarmonogramu: 'nie',
          rows: [],
        },
      ];
      const html = buildMapHtml(geo, [], 'https://example.com/woj.json');
      expect(html).toContain('map-harmonogram-filter');
      expect(html).toContain('Wg harmonogramu');
      expect(html).toContain('mapPointMatchesWgHarmonogramuFilterMap');
      expect(html).toContain('name="map-harmonogram-filter"');
      expect(html).toContain('value="tak"');
      expect(html).toContain('value="nie"');
    });

    it('test_buildMapHtml_when_harmonogram_should_embed_popup_tak_nie_or_brak', () => {
      const html = buildMapHtml(
        [
          {
            address: 'Adres tak',
            count: 1,
            lat: 52.1,
            lng: 21.0,
            wojewodztwo: 'Mazowieckie',
            wgHarmonogramu: 'tak',
            rows: [],
          },
        ],
        [],
        'https://example.com/woj.json',
      );
      expect(html).toContain('popup-harmonogram');
      expect(html).toContain("Harmonogram: ' + harmLabel");
      expect(html).toContain("harmNorm === 'tak' ? 'tak'");
      expect(html).toContain("harmNorm === 'nie' ? 'nie' : 'brak wartości'");
    });

    it('test_buildMapHtml_when_harmonogram_tak_with_firma_should_append_firma_in_popup_logic', () => {
      const html = buildMapHtml(
        [
          {
            address: 'Adres tak',
            count: 1,
            lat: 52.1,
            lng: 21.0,
            wojewodztwo: 'Mazowieckie',
            wgHarmonogramu: 'tak',
            firmaTransportowa: 'Janex Transport',
            rows: [],
          },
        ],
        [],
        'https://example.com/woj.json',
      );
      expect(html).toContain('firmaTransportowa');
      expect(html).toContain("harmNorm === 'tak' && p.firmaTransportowa");
      expect(html).toContain("'tak - ' + p.firmaTransportowa");
      expect(html).toContain('Janex Transport');
    });

    it('test_buildMapHtml_when_no_harmonogram_data_should_omit_filter_controls', () => {
      const html = buildMapHtml(sampleGeocoded(), [], 'https://example.com/woj.json');
      expect(html).toContain('showHarmonogramFilter = false');
    });
  });

  describe('wojewodztwo filter', () => {
    it('test_normalizeWojewodztwoLabel_when_empty_should_return_nieznane', () => {
      expect(normalizeWojewodztwoLabel('')).toBe('Nieznane');
      expect(normalizeWojewodztwoLabel('  ')).toBe('Nieznane');
      expect(normalizeWojewodztwoLabel(undefined)).toBe('Nieznane');
      expect(normalizeWojewodztwoLabel('Do uzupełnienia')).toBe('Nieznane');
      expect(normalizeWojewodztwoLabel(' Mazowieckie ')).toBe('Mazowieckie');
    });

    it('test_normalizeWojewodztwoLabel_when_mixed_case_should_unify_casing', () => {
      expect(normalizeWojewodztwoLabel('Kujawsko-Pomorskie')).toBe('Kujawsko-pomorskie');
      expect(normalizeWojewodztwoLabel('kujawsko-pomorskie')).toBe('Kujawsko-pomorskie');
      expect(normalizeWojewodztwoLabel('KUJAWSKO-POMORSKIE')).toBe('Kujawsko-pomorskie');
      expect(normalizeWojewodztwoLabel('Warmińsko-Mazurskie')).toBe('Warmińsko-mazurskie');
      expect(normalizeWojewodztwoLabel('ŚLĄSKIE')).toBe('Śląskie');
    });

    it('test_normalizeWojewodztwoLabel_when_missing_diacritics_should_map_to_official', () => {
      expect(normalizeWojewodztwoLabel('Swietokrzyskie')).toBe('Świętokrzyskie');
      expect(normalizeWojewodztwoLabel('Malopolskie')).toBe('Małopolskie');
      expect(normalizeWojewodztwoLabel('Lodzkie')).toBe('Łódzkie');
      expect(normalizeWojewodztwoLabel('Slaskie')).toBe('Śląskie');
    });

    it('test_uniqueWojewodztwaFromMapPoints_when_duplicates_should_dedupe_and_sort_pl', () => {
      expect(
        uniqueWojewodztwaFromMapPoints([
          { woj: 'Śląskie' },
          { woj: 'Mazowieckie' },
          { woj: 'Mazowieckie' },
          { woj: '' },
          { woj: 'Wielkopolskie' },
        ]),
      ).toEqual(['Mazowieckie', 'Nieznane', 'Śląskie', 'Wielkopolskie']);
    });

    it('test_uniqueWojewodztwaFromMapPoints_when_case_variants_should_dedupe', () => {
      expect(
        uniqueWojewodztwaFromMapPoints([
          { woj: 'Kujawsko-Pomorskie' },
          { woj: 'Kujawsko-pomorskie' },
          { woj: 'kujawsko-pomorskie' },
        ]),
      ).toEqual(['Kujawsko-pomorskie']);
    });

    it('test_mapPointMatchesWojewodztwoFilter_when_wszystkie_should_match_any', () => {
      expect(mapPointMatchesWojewodztwoFilter('Mazowieckie', 'wszystkie')).toBe(true);
      expect(mapPointMatchesWojewodztwoFilter('', 'wszystkie')).toBe(true);
      expect(mapPointMatchesWojewodztwoFilter(undefined, '')).toBe(true);
      expect(mapPointMatchesWojewodztwoFilter('Mazowieckie', [])).toBe(true);
    });

    it('test_mapPointMatchesWojewodztwoFilter_when_selected_should_match_exact_label', () => {
      expect(mapPointMatchesWojewodztwoFilter('Mazowieckie', 'Mazowieckie')).toBe(true);
      expect(mapPointMatchesWojewodztwoFilter('Wielkopolskie', 'Mazowieckie')).toBe(false);
      expect(mapPointMatchesWojewodztwoFilter('', 'Nieznane')).toBe(true);
      expect(mapPointMatchesWojewodztwoFilter(undefined, 'Nieznane')).toBe(true);
    });

    it('test_mapPointMatchesWojewodztwoFilter_when_case_differs_should_still_match', () => {
      expect(mapPointMatchesWojewodztwoFilter('Kujawsko-Pomorskie', 'Kujawsko-pomorskie')).toBe(true);
      expect(mapPointMatchesWojewodztwoFilter('kujawsko-pomorskie', ['Kujawsko-Pomorskie'])).toBe(true);
    });

    it('test_mapPointMatchesWojewodztwoFilter_when_multi_selected_should_match_any_of_them', () => {
      expect(mapPointMatchesWojewodztwoFilter('Mazowieckie', ['Mazowieckie', 'Wielkopolskie'])).toBe(true);
      expect(mapPointMatchesWojewodztwoFilter('Wielkopolskie', ['Mazowieckie', 'Wielkopolskie'])).toBe(true);
      expect(mapPointMatchesWojewodztwoFilter('Małopolskie', ['Mazowieckie', 'Wielkopolskie'])).toBe(false);
    });

    it('test_formatWojewodztwoFilterSummary_when_none_one_many_should_format', () => {
      expect(formatWojewodztwoFilterSummary([])).toBe('Wszystkie');
      expect(formatWojewodztwoFilterSummary(['Mazowieckie'])).toBe('Mazowieckie');
      expect(formatWojewodztwoFilterSummary(['Mazowieckie', 'Wielkopolskie'])).toBe('2 wybrane');
    });

    it('test_buildMapHtml_when_multiple_wojewodztwa_should_embed_filter_dropdown', () => {
      const html = buildMapHtml(sampleGeocoded(), sampleUncertainGeocoded(), 'https://example.com/woj.json');
      expect(html).toContain('showWojewodztwoFilter = true');
      expect(html).toContain('map-wojewodztwo-filter');
      expect(html).toContain('map-wojewodztwo-dropdown');
      expect(html).toContain('map-wojewodztwo-toggle');
      expect(html).toContain('map-wojewodztwo-menu');
      expect(html).toContain('map-wojewodztwo-clear');
      expect(html).toContain('Wyczyść filtr');
      expect(html).toContain('clearWojewodztwoFilter');
      expect(html).toContain('Województwo');
      expect(html).toContain('mapPointMatchesWojewodztwoFilterMap');
      expect(html).toContain('getWojewodztwoFilterSelection');
      expect(html).toContain('name="map-wojewodztwo-filter"');
      expect(html).toContain('type="checkbox"');
      expect(html).toContain('aria-multiselectable="true"');
      expect(html).toContain('Mazowieckie');
      expect(html).toContain('Wielkopolskie');
      expect(html).toContain('Małopolskie');
    });

    it('test_buildMapHtml_when_single_wojewodztwo_should_omit_filter', () => {
      const geo: GeocodedAddress[] = [
        {
          address: 'Adres A',
          count: 1,
          lat: 52.1,
          lng: 21.0,
          wojewodztwo: 'Mazowieckie',
          rows: [],
        },
        {
          address: 'Adres B',
          count: 1,
          lat: 52.2,
          lng: 21.1,
          wojewodztwo: 'Mazowieckie',
          rows: [],
        },
      ];
      const html = buildMapHtml(geo, [], 'https://example.com/woj.json');
      expect(html).toContain('showWojewodztwoFilter = false');
    });
  });

  describe('defaultDateZaladunkuYmd', () => {
    it('test_defaultDateZaladunkuYmd_when_friday_after_4am_should_be_next_monday', () => {
      expect(defaultDateZaladunkuYmd(new Date(2026, 5, 5, 10, 0, 0))).toBe('2026-06-08');
    });

    it('test_defaultDateZaladunkuYmd_when_friday_before_4am_should_be_today', () => {
      expect(defaultDateZaladunkuYmd(new Date(2026, 5, 5, 2, 0, 0))).toBe('2026-06-05');
    });

    it('test_defaultDateZaladunkuYmd_when_saturday_should_be_next_monday', () => {
      expect(defaultDateZaladunkuYmd(new Date(2026, 5, 6, 15, 0, 0))).toBe('2026-06-08');
    });

    it('test_defaultDateZaladunkuYmd_when_sunday_should_be_next_monday', () => {
      expect(defaultDateZaladunkuYmd(new Date(2026, 5, 7, 2, 0, 0))).toBe('2026-06-08');
    });

    it('test_defaultDateZaladunkuYmd_when_weekday_before_4am_should_be_today', () => {
      expect(defaultDateZaladunkuYmd(new Date(2026, 5, 4, 2, 0, 0))).toBe('2026-06-04');
    });

    it('test_defaultDateZaladunkuYmd_when_weekday_after_4am_should_be_tomorrow', () => {
      expect(defaultDateZaladunkuYmd(new Date(2026, 5, 4, 10, 0, 0))).toBe('2026-06-05');
    });
  });

  describe('filename helpers', () => {
    it('test_formatTimestampForFileName_when_winter_utc_should_use_europe_warsaw_cet', () => {
      const date = new Date('2026-02-25T17:05:06Z');
      expect(formatTimestampForFileName(date)).toBe('2026-02-25_18-05-06');
    });

    it('test_formatTimestampForFileName_when_summer_utc_should_use_europe_warsaw_cest', () => {
      const date = new Date('2026-07-25T17:05:06Z');
      expect(formatTimestampForFileName(date)).toBe('2026-07-25_19-05-06');
    });

    it('test_buildMapFileName_when_date_given_should_start_with_mapa_and_end_with_html', () => {
      const date = new Date('2026-02-25T17:05:06Z');
      const filename = buildMapFileName(date);
      expect(filename).toBe('mapa_2026-02-25_18-05-06.html');
    });

    it('test_formatGeneratedAtLabel_when_winter_utc_should_use_europe_warsaw', () => {
      expect(formatGeneratedAtLabel(new Date('2026-02-25T17:05:06Z'))).toBe('25.02.2026, 18:05:06');
    });
  });

  describe('buildMapHtml', () => {
    it('test_buildMapHtml_when_geocoded_data_given_should_embed_leaflet_and_geojson_url', () => {
      const html = buildMapHtml(sampleGeocoded(), sampleUncertainGeocoded(), 'https://example.com/woj.json');
      expect(html).toContain('rel="icon" href="./favicon.svg"');
      expect(html).not.toContain('generatedAt.addTo(map)');
      expect(html).toContain('leaflet@1.9.4');
      expect(html).toContain('leaflet.markercluster@1.5.3');
      expect(html).toContain('L.markerClusterGroup');
      expect(html).toContain('dm-cluster-inner');
      expect(html).toContain('setMarkerVisible');
      expect(html).toContain('map-cluster-toggle');
      expect(html).toContain('Grupuj nachodzące punkty');
      expect(html).toContain('applyClusteringMode');
      expect(html).toContain('isClusteringEnabled');
      expect(html).toContain('maxClusterRadius: 16');
      expect(html).toContain('disableClusteringAtZoom: 16');
      expect(html).toContain('dominantPinKolor');
      expect(html).toContain('pinKolor');
      expect(html).toContain('https://example.com/woj.json');
      expect(html).toContain('const adresy =');
      expect(html).toContain('Liczba wystąpień');
      expect(html).toContain('map-address-search');
      expect(html).toContain('applyAddressSearch');
      expect(html).toContain('mapPointMatchesSearchMap');
      expect(html).toContain('wojBoundsByKey');
      expect(html).toContain('scheduleSearchViewport');
      expect(html).toContain('map.setView([one.markerLat, one.markerLng]');
      expect(html).toContain(String(MAP_SEARCH_SINGLE_MATCH_ZOOM));
      expect(html).toContain(JSON.stringify(MAP_SEARCH_FIT_PADDING));
      expect(html).toContain('zoomControl: false');
      expect(html).toContain('map-zoom-in');
      expect(html).toContain('map-search-input-row');
      expect(html).toContain('tile.openstreetmap.org/{z}/{x}/{y}.png');
    });

    it('test_buildMapHtml_when_zbiorka_data_present_should_embed_zbiorka_filter_controls', () => {
      const geo: GeocodedAddress[] = [
        {
          address: 'Adres obie',
          count: 1,
          lat: 52.1,
          lng: 21.0,
          wojewodztwo: 'Mazowieckie',
          zbiorka: 'Ręczna / Maszyna',
          rows: [],
        },
        {
          address: 'Adres reczna',
          count: 1,
          lat: 52.2,
          lng: 21.1,
          wojewodztwo: 'Mazowieckie',
          zbiorka: 'Ręczna',
          rows: [],
        },
      ];
      const html = buildMapHtml(geo, [], 'https://example.com/woj.json');
      expect(html).toContain('map-zbiorka-filter');
      expect(html).toContain('mapPointMatchesZbiorkaFilterMap');
      expect(html).toContain('setMarkerClickable');
      expect(html).toContain("pointerEvents = clickable ? '' : 'none'");
      expect(html).toContain('value="wszystkie" checked');
      expect(html).toContain('Wszystkie punkty');
      expect(html).toContain('Tylko ręczna');
      expect(html).toContain('Tylko maszynowa');
    });

    it('test_buildMapHtml_when_points_given_should_embed_filter_point_count_below_filters', () => {
      const html = buildMapHtml(sampleGeocoded(), [], 'https://example.com/woj.json');
      expect(html).toContain('map-clear-all-filters');
      expect(html).toContain('Wyczyść wszystkie filtry');
      expect(html).toContain('clearAllMapFilters');
      expect(html).toMatch(
        /clusterToggleHtml \+\s*'<button type="button" id="map-clear-all-filters" class="map-clear-all-filters">Wyczyść wszystkie filtry<\/button>' \+\s*'<div id="map-filter-count" class="map-filter-count" role="status" aria-live="polite">Widoczne: 0 szt\.<\/div>'/,
      );
      expect(html).toContain('var filterCount = 0');
      expect(html).toContain('filterCount++');
      expect(html).toContain("countEl.textContent = 'Widoczne: ' + filterCount + ' szt.'");
      expect(html).not.toContain("position: 'bottomleft'");
    });

    it('test_buildMapHtml_when_two_close_points_should_embed_markerLat_markerLng', () => {
      const close: GeocodedAddress[] = [
        {
          address: 'Adres A',
          count: 1,
          lat: 52.1,
          lng: 21.0,
          wojewodztwo: 'Mazowieckie',
          rows: [],
        },
        {
          address: 'Adres B',
          count: 1,
          lat: 52.1,
          lng: 21.0,
          wojewodztwo: 'Mazowieckie',
          rows: [],
        },
      ];
      const html = buildMapHtml(close, [], 'https://example.com/woj.json');
      expect(html).toContain('"markerLat"');
      expect(html).toContain('"markerLng"');
      expect(html).toContain('p.markerLat, p.markerLng');
    });

    it('test_buildMapHtml_when_geocoded_data_given_should_embed_addresses_and_counts', () => {
      const html = buildMapHtml(sampleGeocoded(), sampleUncertainGeocoded(), 'https://example.com/woj.json');
      expect(html).toContain('62-320 Miłosław os. Władysława Łokietka 18');
      expect(html).toContain('"count":5');
      expect(html).toContain('"woj":"Wielkopolskie"');
      expect(html).toContain('"confidence":"uncertain"');
      expect(html).toContain('Wynik niepewny');
      expect(html).not.toContain('#D40418');
    });

    it('test_buildMapHtml_when_rows_have_podmiot_and_sklep_should_embed_searchLabels', () => {
      const geo: GeocodedAddress[] = [
        {
          address: '00-001 Warszawa Przykładowa 1',
          count: 1,
          lat: 52.1,
          lng: 21.0,
          wojewodztwo: 'Mazowieckie',
          rows: [
            makeSheetRow({
              podmiotHandlowy: 'ACME Sp. z o.o.',
              sklep: 'Sklep przy dworcu',
            }),
          ],
        },
      ];
      const html = buildMapHtml(geo, [], 'https://example.com/woj.json');
      expect(html).toContain('"searchLabels"');
      expect(html).toContain('"podmiotyHandlowe"');
      expect(html).toContain('"podmiotyHandlowe":["ACME Sp. z o.o."]');
      expect(html).toContain('ACME Sp. z o.o.');
      expect(html).toContain('Sklep przy dworcu');
      expect(html).toContain('popup-podmiot');
      expect(html).toContain('p.podmiotyHandlowe.join');
    });

    it('test_buildMapHtml_when_ok_confidence_should_use_green_pin', () => {
      const html = buildMapHtml(sampleGeocoded(), [], 'https://example.com/woj.json');
      expect(html).toContain('"confidence":"ok"');
      expect(html).toContain('function kolorPinezki(count)');
      expect(html).toContain('#198754');
      expect(html).toContain('palettePin');
    });

    it('test_buildMapHtml_when_zero_bags_should_embed_light_blue_pin_color_and_legend', () => {
      const html = buildMapHtml(sampleGeocoded(), [], 'https://example.com/woj.json');
      expect(html).toContain('if (count <= 0) return colorZeroBags');
      expect(html).toContain('#cce5ff');
      expect(html).toContain("style=\"background:' + colorZeroBags + '\"></span> 0</li>");
    });

    it('test_buildMapHtml_when_ok_no_postcode_given_should_use_green_pin_and_status_in_popup', () => {
      const noPostcode = [
        {
          address: '62-320 Miłosław Leśna 10',
          count: 1,
          lat: 52.2,
          lng: 17.5,
          wojewodztwo: 'Wielkopolskie',
          rows: [],
        },
      ];
      const html = buildMapHtml([], [], 'https://example.com/woj.json', [], noPostcode);
      expect(html).toContain('"confidence":"ok_no_postcode"');
      expect(html).toContain('#97F0C7');
      expect(html).toContain('Bez kodu w wyniku');
    });

    it('test_buildMapHtml_when_city_only_geocoded_given_should_use_green_pin_and_status_in_popup', () => {
      const cityOnly = [
        {
          address: '00-001 Warszawa',
          count: 1,
          lat: 52.23,
          lng: 21.01,
          wojewodztwo: 'Mazowieckie',
          rows: [],
        },
      ];
      const html = buildMapHtml([], [], 'https://example.com/woj.json', cityOnly);
      expect(html).toContain('"confidence":"city_only"');
      expect(html).toContain("p.confidence === 'city_only'");
      expect(html).toContain('Tylko kod+miasto');
      expect(html).toContain('#97F0C7');
      expect(html).not.toContain('paletteUncertain');
    });

    it('test_buildMapHtml_when_no_points_should_embed_no_count_legend', () => {
      const html = buildMapHtml([], [], 'https://example.com/woj.json');
      expect(html).not.toContain('Jakość adresu');
      expect(html).toContain('const hasCountLegend = false');
    });

    it('test_buildMapHtml_when_points_present_should_not_embed_address_quality_legend', () => {
      const html = buildMapHtml(sampleGeocoded(), [], 'https://example.com/woj.json');
      expect(html).not.toContain('Jakość adresu');
      expect(html).toContain('const hasCountLegend = true');
    });

    it('test_buildMapHtml_when_word_embed_given_should_include_generuj_and_docxtemplater', () => {
      const html = buildMapHtml(sampleGeocoded(), [], 'https://example.com/woj.json', [], [], {
        templateBase64: 'UEsDBA==',
        podwykoOptions: [
          { label: 'Janex', dane: 'Janex — pełne dane' },
          { label: 'Trans-Pol', dane: 'TRANS-POL Sp. z o.o.' },
        ],
      });
      expect(html).toContain('docxtemplater@3.50.0');
      expect(html).toContain('ensureDocxLibrariesLoaded');
      expect(html).toContain('prewarmDocxTemplateCache');
      expect(html).toContain('rebuildDocPreparedLists');
      expect(html).toContain('Generuj dokument');
      expect(html).toContain('PODWYKOLISTA');
      expect(html).toContain('Janex');
      expect(html).toContain('pełne dane');
      expect(html).toContain('buildDocxDownloadName');
      expect(html).toContain('dzPlik');
      expect(html).toContain('doc-combobox-input');
      expect(html).toContain('id="doc-val-przewoznik"');
      expect(html).toContain('podwykoOptionMatchesQuery');
      expect(html).toContain('placeholder="Wpisz fragment nazwy lub danych…"');
      expect(html).toContain('id="doc-inp-data-zaladunku"');
      expect(html).toContain('id="doc-inp-numer-zlecenia"');
      expect(html).toContain('id="doc-inp-komentarz-1"');
      expect(html).toContain('id="doc-inp-komentarz-2"');
      expect(html).toContain('id="doc-chk-bez-listy-plomb"');
      expect(html).toContain('Bez listy plomb');
      expect(html).toContain('buildListaPlombPlaceholderLines');
      expect(html).toContain('isDocBezListyPlombChecked');
      expect(html).toContain('komentarz1');
      expect(html).toContain('komentarz2');
      expect(html).toContain('numer_zlecenia_transportowego');
      expect(html).toContain('defaultDateZaladunkuYmd');
      expect(html).toContain('loadDocModalData');
      expect(html).toContain('loadBulkDocModalData');
      expect(html).toContain('runBulkDocGenerate');
      expect(html).toContain('openBulkDocModal');
      expect(html).toContain('map-bulk-panel');
      expect(html).toContain('map-bulk-bags');
      expect(html).toContain('sumBulkBagsToCollect');
      expect(html).toContain('Worki do odebrania: 0');
      expect(html).toContain('colorBulkSelected');
      expect(html).toContain('markerDisplayIcon');
      expect(html).toContain('Zaznaczenie zbiorcze');
      expect(html).toContain('Zaznacz do zbiorczego protokołu');
      expect(html).toContain('map-auto-bulk-toggle');
      expect(html).toContain('Automatyczne zbiorcze zaznaczanie');
      expect(html).toContain('handleMarkerPrimaryClick');
      expect(html).toContain('setAutoBulkMode');
      expect(html).toContain('openBulkRatesModal');
      expect(html).toContain('runBulkRatesSave');
      expect(html).toContain('closeBulkRatesModal');
      expect(html).toContain("alert('Zapisano stawki dla ' + savedCount + ' sklepów.')");
      expect(html).toContain("mode: target === 'harmonogram' ? 'saveRateHarmonogram' : 'saveRate'");
      expect(html).toContain('appendTransportRow');
      expect(html).toContain('filterSealRowsByMinDate');
      expect(html).toContain('buildDocListsFromSealRows');
      expect(html).toContain('function aggregateRodzajZbiorkiFromSealRows');
      expect(html).toContain("rodzaj_zbiorki: rodzajZbiorki ? (' ' + rodzajZbiorki) : ''");
      expect(html).toContain('rodzajZbiorki: aggregateRodzajZbiorkiFromSealRows(job.filteredSeals)');
      expect(html).toContain('rodzajZbiorki: aggregateRodzajZbiorkiFromSealRows(filteredSeals)');
      expect(html).not.toContain('rodzaj_zbiorki: p.rodzaj_zbiorki');
      expect(html).not.toContain('rodzajZbiorki: p.rodzaj_zbiorki');
      expect(html).toContain('doc-filter-info');
      expect(html).toContain('transportApiEnabled');
      expect(html).toContain('var dayOffset = hour >= 0 && hour < 4 ? 0 : 1;');
    });

    it('test_buildMapHtml_when_word_embed_given_should_inject_proposeRouteName', () => {
      const html = buildMapHtml(sampleGeocoded(), [], 'https://example.com/woj.json', [], [], {
        templateBase64: 'UEsDBA==',
        podwykoOptions: [],
      });
      expect(html).toContain(routeNameBrowserScript().trim());
      expect(html).toContain('function proposeRouteName');
    });

    it('test_buildMapHtml_when_word_embed_given_should_not_inject_esbuild_keepNames_helper', () => {
      // Regresja: puste pole „Nazwa trasy” bo `ReferenceError: __name is not defined`.
      const html = buildMapHtml(sampleGeocoded(), [], 'https://example.com/woj.json', [], [], {
        templateBase64: 'UEsDBA==',
        podwykoOptions: [{ label: 'GPW', dane: 'GPW' }],
      }, 'https://script.google.com/macros/s/test/exec');
      expect(html).not.toMatch(/__name\s*\(/);
      expect(html).not.toContain('add=__name');
    });

    it('test_buildMapHtml_when_word_embed_given_should_eval_injected_route_name_proposal', () => {
      const html = buildMapHtml(sampleGeocoded(), [], 'https://example.com/woj.json', [], [], {
        templateBase64: 'UEsDBA==',
        podwykoOptions: [{ label: 'GPW', dane: 'GPW' }],
      }, 'https://script.google.com/macros/s/test/exec');
      const start = html.indexOf('function namesBlockingNewRoute');
      const end = html.indexOf("var lastRouteName = ''");
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      const injected = html.slice(start, end);
      const context: { result?: unknown } = {};
      runInNewContext(
        `${injected}
result = proposeRouteName(
  namesBlockingNewRoute(['Papirus-21.09.26-01', 'Geodis - 23.09.2026'], ''),
  'GPW',
  '2026-09-23'
);`,
        context,
      );
      expect(context.result).toBe('GPW-23.09.26-01');
    });

    it('test_buildMapHtml_when_route_name_fetch_fails_should_still_clear_loading_indicator', () => {
      const html = buildMapHtml(sampleGeocoded(), [], 'https://example.com/woj.json', [], [], {
        templateBase64: 'UEsDBA==',
        podwykoOptions: [{ label: 'GPW', dane: 'GPW' }],
      }, 'https://script.google.com/macros/s/test/exec');
      const refresh = html.slice(
        html.indexOf('function refreshRouteNameField('),
        html.indexOf('function onRouteCheckboxChange('),
      );
      const loadingOn = refresh.indexOf('setRouteNameFieldLoading(true)');
      const catchEmpty = refresh.indexOf('.catch(function () {\n        return [];\n      })');
      const loadingOff = refresh.indexOf('setRouteNameFieldLoading(false)');
      expect(loadingOn).toBeGreaterThan(-1);
      expect(catchEmpty).toBeGreaterThan(loadingOn);
      expect(loadingOff).toBeGreaterThan(catchEmpty);
      // try/catch wokół namesBlocking/propose — wyjątek nie zostawia pustego pola w ciszy.
      expect(refresh).toContain('catch (eOcc)');
      expect(refresh).toContain('catch (eProp)');
    });

    it('test_buildMapHtml_when_route_name_loading_should_use_own_depth_not_shared_map_loader', () => {
      const html = buildMapHtml(sampleGeocoded(), [], 'https://example.com/woj.json', [], [], {
        templateBase64: 'UEsDBA==',
        podwykoOptions: [],
      }, 'https://script.google.com/macros/s/test/exec');
      const sync = html.slice(
        html.indexOf('function syncMapLoaderUi('),
        html.indexOf('function setTransportDatesLoading('),
      );
      expect(sync).toContain('mapLoaderDepth > 0 || routeNameFieldLoadDepth > 0');
      expect(sync).toContain('Ładowanie nazwy trasy…');
      const refresh = html.slice(
        html.indexOf('function refreshRouteNameField('),
        html.indexOf('function onRouteCheckboxChange('),
      );
      expect(refresh).not.toContain('setTransportDatesLoading');
      expect(refresh).toContain('setRouteNameFieldLoading(true)');
    });

    it('test_buildMapHtml_when_word_embed_missing_should_omit_proposeRouteName', () => {
      const html = buildMapHtml(sampleGeocoded(), [], 'https://example.com/woj.json');
      expect(html).not.toContain('function proposeRouteName');
      expect(html).not.toContain('function routeBodyFields');
      expect(html).not.toContain('id="doc-chk-odbior-z-trasy"');
      expect(html).not.toContain("var lastRouteName = ''");
    });

    it('test_buildMapHtml_when_word_embed_given_should_add_route_fields_without_touching_word', () => {
      const html = buildMapHtml(sampleGeocoded(), [], 'https://example.com/woj.json', [], [], {
        templateBase64: 'UEsDBA==',
        podwykoOptions: [{ label: 'gpw', dane: 'GPW dane do Worda' }],
      }, 'https://script.google.com/macros/s/test/exec');
      expect(html).toContain(routeProtocolBrowserScript().trim());
      expect(html).toContain('id="doc-chk-odbior-z-trasy"');
      expect(html).toContain('Odbiór z trasy');
      expect(html).toContain('id="doc-route-fields" hidden');
      expect(html).toContain('id="doc-inp-trasa"');
      expect(html).toContain('id="doc-btn-nowa-trasa"');
      expect(html).toContain('id="doc-route-continue-hint"');
      expect(html).toContain('id="doc-inp-stawka-trasy"');
      expect(html).toContain('map-bulk-rates');
      expect(html).toContain('Ustaw stawki');
      expect(html).toContain('id="bulk-rates-modal"');
      expect(html).toContain('id="bulk-rates-podwykonawca"');
      expect(html).toContain('id="bulk-rates-podjazd"');
      expect(html).toContain('id="bulk-rates-worek"');
      expect(html).toContain('id="bulk-rates-od-kiedy"');
      expect(html).toContain('name="bulk-rates-target"');
      expect(html).toContain('value="harmonogram"');
      expect(html).toContain('id="bulk-rates-dni"');
      expect(html).toContain("mode: target === 'harmonogram' ? 'saveRateHarmonogram' : 'saveRate'");
      expect(html).toContain('dniOdbiorow');
      expect(html).toContain("var lastRouteName = ''");
      expect(html).toContain("var routeNameMode = 'continue'");
      expect(html).toContain("var routeRateBaseline = ''");
      expect(html).toContain('function routeRateConflictsWithExisting');
      const rateGuardHits = html.split('resolveRouteFieldsBeforeSave(form.routeFields)').length - 1;
      expect(rateGuardHits).toBe(2);
      expect(html).toContain("var lastRouteRate = ''");
      expect(html).not.toContain("localStorage.setItem('lastRouteName'");
      expect(html).not.toContain('localStorage.getItem(\'lastRouteName\'');

      const checkbox = html.slice(
        html.indexOf('function onRouteCheckboxChange('),
        html.indexOf('function onRouteNameInput('),
      );
      expect(checkbox).not.toContain('appendTransportRow');
      expect(checkbox).not.toContain('localStorage');

      const contractor = html.slice(
        html.indexOf('function contractorShortNameForRoute('),
        html.indexOf('function pickupDateForRoute('),
      );
      expect(contractor).toContain('opt.label');
      expect(contractor).toContain('findPodwykoIdxByLabel');
      expect(contractor).not.toContain('.dane');

      const refresh = html.slice(
        html.indexOf('function refreshRouteNameField('),
        html.indexOf('function onRouteCheckboxChange('),
      );
      expect(refresh.indexOf('lastRouteName')).toBeGreaterThan(-1);
      expect(refresh.indexOf('lastRouteName')).toBeLessThan(refresh.indexOf('proposeRouteName'));
      expect(refresh).toContain("routeNameMode !== 'new'");
      expect(refresh).toContain('namesBlockingNewRoute');
      expect(refresh).toContain('routeNameMissingDepsHint');
      expect(html).toContain('Najpierw wybierz kto odbiera');
      expect(html).toContain('Uzupełnij datę załadunku');
      expect(refresh).toContain("action: 'routeNameProposal'");
      expect(refresh).toContain('setRouteNameFieldLoading(true)');
      expect(refresh).toContain('routeNameProposeTicket');
      expect(refresh).toContain('setRouteNameFieldLoading(false)');
      expect(refresh).not.toContain('setTransportDatesLoading');
      expect(html).toContain('function syncMapLoaderUi');
      expect(html).toContain('routeNameFieldLoadDepth');
      expect(html).toContain('Ładowanie nazwy trasy…');
      expect(html).toContain("action: 'routeRateByName'");
      expect(html).toContain('routeNameProposeTicket');
      const routeNameLoading = html.slice(
        html.indexOf('function setRouteNameFieldLoading('),
        html.indexOf('function refreshRouteNameField('),
      );
      expect(routeNameLoading).toContain('syncMapLoaderUi');
      const applyShown = html.slice(
        html.indexOf('function applyShownRouteName('),
        html.indexOf('function updateRouteSessionUi('),
      );
      expect(applyShown).toContain("!next.trim() && String(nameEl.value || '').trim()");
      const lookupNow = html.slice(
        html.indexOf('function lookupRouteRateNow('),
        html.indexOf('function applyShownRouteName('),
      );
      expect(lookupNow).toContain('routeRateToKeep');
      expect(lookupNow).not.toContain("rateEl.value = ''");

      const payloadHits = html.split('assignRouteBody(transportPayload, form.routeFields)').length - 1;
      expect(payloadHits).toBe(2);
      expect(html).toContain('rememberRouteAfterSuccessfulSave(form.routeFields)');
      const bulk = html.slice(html.indexOf('function runBulkDocGenerate('), html.indexOf('function runDocGenerate('));
      expect(bulk).toContain("numer: ''");
      expect(bulk).toContain('assignRouteBody(transportPayload, form.routeFields)');
      expect(bulk).toContain('appendTransportRow(transportPayload)');

      const renderStart = html.indexOf('doc.render({');
      const renderBlock = html.slice(renderStart, html.indexOf('});', renderStart));
      expect(renderBlock).not.toContain('trasa');
      expect(renderBlock).not.toContain('stawka');

      const docxPath = join(dirname(fileURLToPath(import.meta.url)), '../docs/pusty.docx');
      const hash = createHash('sha256').update(readFileSync(docxPath)).digest('hex');
      expect(hash).toBe('e0189d70ce3c1c90f52f74c487549872b094a23bab7a6ce02f491dde5be8e16d');
    });

    it('test_buildTransportShopKey_when_podmiot_and_adres_given_should_normalize_like_transport_sheet', () => {
      expect(buildTransportShopKey('Firma SA', '00-001 Warszawa ul. Testowa 1')).toBe(
        'firma sa\u000000-001 warszawa ul. testowa 1',
      );
      expect(buildTransportShopKey('Żabka', 'Kraków')).toBe('zabka\u0000krakow');
    });

    it('test_resolveTransportCutoffMsForPoint_when_podmiot_mismatch_should_return_null', () => {
      const adres = '62-320 Miłosław ul. Leśna 1';
      const byKey = {
        [buildTransportShopKey('Inny Podmiot', adres)]: Date.UTC(2026, 5, 10),
      };
      expect(
        resolveTransportCutoffMsForPoint({ podmiotHandlowy: 'PH SA', adres }, byKey),
      ).toBeNull();
    });

    it('test_resolveTransportCutoffMsForPoint_when_multiple_podmioty_should_use_latest_transport', () => {
      const adres = '00-001 Warszawa ul. Testowa 1';
      const byKey = {
        [buildTransportShopKey('Firma A', adres)]: Date.UTC(2026, 5, 1),
        [buildTransportShopKey('Firma B', adres)]: Date.UTC(2026, 5, 10),
      };
      expect(
        resolveTransportCutoffMsForPoint(
          { podmiotHandlowy: 'Firma A', podmiotyHandlowe: ['Firma B'], adres },
          byKey,
        ),
      ).toBe(Date.UTC(2026, 5, 10));
    });

    it('test_filterSealRows_when_last_transport_june10_should_keep_june10_and_later_dmy', () => {
      const cutoff = Date.UTC(2026, 5, 10);
      const rows = [
        { numerPlomby: 'old1', dataZamknieciaWorka: '01.06.2026', zbiorka: '' },
        { numerPlomby: 'old2', dataZamknieciaWorka: '05.06.2026', zbiorka: '' },
        { numerPlomby: 'same', dataZamknieciaWorka: '10.06.2026', zbiorka: '' },
        { numerPlomby: 'new', dataZamknieciaWorka: '15.06.2026', zbiorka: '' },
      ];
      const filtered = filterSealRowsByMinClosureDate(rows, cutoff);
      expect(filtered.map((r) => r.numerPlomby)).toEqual(['same', 'new']);
    });

    it('test_buildMapHtml_when_transport_url_given_should_embed_bulk_dates_loader', () => {
      const html = buildMapHtml(
        sampleGeocoded(),
        [],
        'https://example.com/woj.json',
        [],
        [],
        { templateBase64: 'UEsDBA==', podwykoOptions: [] },
        'https://script.google.com/macros/s/test/exec',
      );
      expect(html).toContain('loadBulkTransportDates');
      expect(html).toContain('bulkLastTransportDates');
      expect(html).toContain('map-transport-loader');
      expect(html).toContain('map-transport-loader-logo');
      expect(html).toContain('src="./favicon.svg"');
      expect(html).toContain('map-logo-pulse');
      expect(html).toContain('Pobieranie danych transportu');
      expect(html).toContain('Ładowanie danych dokumentu');
      expect(html).toContain('Ładowanie nazwy trasy');
      expect(html).toContain('setRouteNameFieldLoading');
      expect(html).toContain('Generowanie dokumentu');
      expect(html).toContain('setTransportDatesLoading');
      expect(html).toContain('refreshAllMarkerDisplaysAfterTransport');
      expect(html).toContain('applyMarkerTransportIcon');
      expect(html).toContain('applyMarkerTransportDisplay');
      expect(html).toContain('return refreshAllMarkerDisplaysAfterTransport()');
      expect(html).toContain('applyMarkerTransportIcon(markerEntries[i])');
      expect(html).toContain(".bindPopup('')");
      expect(html).toContain('!map.hasLayer(markersCluster)');
      expect(html).toContain('markersCluster.refreshClusters()');
      expect(html).toContain('Worki do odebrania');
      expect(html).toContain('Ostatni transport');
      expect(html).toContain('Ostatni odbiór');
      expect(html).toContain('lastKtoOdbiera');
      expect(html).toContain('__transportKtoOdbieraByKey');
      expect(html).toContain('getPointTransportLastInfo');
      expect(html).toContain('Wszystkie worki');
      expect(html).not.toContain('Nie odebrane');
      expect(html).toContain('btn-gen-doc:disabled');
      expect(html).toContain('wirePopupControls');
    });

    it('test_buildMapHtml_when_transport_url_given_should_embed_api_and_enable_flag', () => {
      const html = buildMapHtml(
        sampleGeocoded(),
        [],
        'https://example.com/woj.json',
        [],
        [],
        { templateBase64: 'UEsDBA==', podwykoOptions: [] },
        'https://script.google.com/macros/s/test/exec',
      );
      expect(html).toContain('const transportApiEnabled = true');
      expect(html).toContain('https://script.google.com/macros/s/test/exec');
      expect(html).toContain('TRANSPORT_WEBAPP_URL');
    });

    it('test_buildMapHtml_when_no_transport_url_should_not_embed_transport_loader', () => {
      const html = buildMapHtml(
        sampleGeocoded(),
        [],
        'https://example.com/woj.json',
        [],
        [],
        { templateBase64: 'UEsDBA==', podwykoOptions: [] },
      );
      expect(html).not.toContain('id="map-transport-loader"');
      expect(html).toContain('const transportApiEnabled = false');
    });

    it('test_buildMapHtml_when_geocoded_has_rows_should_embed_sealRows_and_podmiot', () => {
      const geocoded: GeocodedAddress[] = [
        {
          address: '62-320 Miłosław Leśna 1',
          count: 2,
          lat: 52.2,
          lng: 17.4,
          wojewodztwo: 'Wielkopolskie',
          rows: [
            makeSheetRow({
              podmiotHandlowy: 'PH Sp.',
              sklep: 'Sklep A',
              numerPlomby: '7001',
              dataZamknieciaWorka: '2026-06-10',
            }),
          ],
        },
      ];
      const html = buildMapHtml(geocoded, [], 'https://example.com/woj.json');
      expect(html).toContain('"podmiotHandlowy":"PH Sp."');
      expect(html).toContain('"sklep":"Sklep A"');
      expect(html).toContain('"sealRows"');
      expect(html).toContain('"numerPlomby":"7001"');
    });
  });

  describe('route orchestration VM', () => {
    type FakeEl = {
      value: string;
      checked: boolean;
      hidden: boolean;
      placeholder: string;
      textContent: string;
      attrs: Record<string, string>;
      setAttribute: (name: string, value: string) => void;
      removeAttribute: (name: string) => void;
      getAttribute: (name: string) => string | null;
    };

    type OrchestrationApi = {
      syncMapLoaderUi: (messageForTransport: string | null) => void;
      setTransportDatesLoading: (loading: boolean, message?: string) => void;
      setRouteNameFieldLoading: (on: boolean) => void;
      applyShownRouteName: (shown: string) => void;
      resetRouteFormForOpen: () => void;
      refreshRouteNameField: () => void;
      getState: () => {
        mapLoaderDepth: number;
        routeNameFieldLoadDepth: number;
        mapLoaderLastMessage: string;
        routeNameProposeTicket: number;
        routeNameTouched: boolean;
      };
      setRouteNameTouched: (value: boolean) => void;
      setRouteNameMode: (mode: string) => void;
      lookupRouteRateCalls: string[];
      pendingFetches: Array<(resp: { ok?: boolean; names?: string[] }) => void>;
    };

    function sliceHtml(html: string, start: string, end: string): string {
      const a = html.indexOf(start);
      const b = html.indexOf(end);
      if (a < 0 || b < 0 || b <= a) {
        throw new Error(`Nie znaleziono wycinka: ${start} … ${end}`);
      }
      return html.slice(a, b);
    }

    function fakeEl(init: Partial<FakeEl> = {}): FakeEl {
      const attrs: Record<string, string> = { ...(init.attrs ?? {}) };
      const el: FakeEl = {
        value: init.value ?? '',
        checked: init.checked ?? false,
        hidden: init.hidden ?? false,
        placeholder: init.placeholder ?? '',
        textContent: init.textContent ?? '',
        attrs,
        setAttribute(name: string, value: string) {
          attrs[name] = value;
          if (name === 'hidden') el.hidden = true;
          if (name === 'aria-busy') attrs['aria-busy'] = value;
        },
        removeAttribute(name: string) {
          delete attrs[name];
          if (name === 'hidden') el.hidden = false;
        },
        getAttribute(name: string) {
          return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
        },
      };
      return el;
    }

    function loadOrchestration(): { api: OrchestrationApi; els: Record<string, FakeEl> } {
      const html = buildMapHtml(sampleGeocoded(), [], 'https://example.com/woj.json', [], [], {
        templateBase64: 'UEsDBA==',
        podwykoOptions: [{ label: 'GPW', dane: 'GPW dane' }],
      }, 'https://script.google.com/macros/s/test/exec');

      const els: Record<string, FakeEl> = {
        'map-transport-loader': fakeEl({ hidden: true, attrs: { 'aria-busy': 'false' } }),
        'map-transport-loader-label': fakeEl({ textContent: 'Pobieranie danych transportu…' }),
        'doc-chk-odbior-z-trasy': fakeEl({ checked: true }),
        'doc-route-fields': fakeEl({ hidden: true, attrs: { hidden: '' } }),
        'doc-inp-trasa': fakeEl({ value: '', placeholder: '' }),
        'doc-inp-stawka-trasy': fakeEl({ value: '' }),
        'doc-btn-nowa-trasa': fakeEl({ hidden: true }),
        'doc-route-continue-hint': fakeEl({ hidden: true, textContent: '' }),
      };

      const pendingFetches: Array<(resp: { ok?: boolean; names?: string[] }) => void> = [];
      const lookupRouteRateCalls: string[] = [];

      const sandbox: Record<string, unknown> = {
        Promise,
        document: {
          getElementById(id: string) {
            return els[id] ?? null;
          },
        },
        window: {
          clearTimeout() {},
          setTimeout(fn: () => void) {
            fn();
            return 1;
          },
        },
        fetchTransportGet() {
          return new Promise<{ ok?: boolean; names?: string[] }>((resolve) => {
            pendingFetches.push(resolve);
          });
        },
        __api: null,
      };

      const script = `
${routeNameBrowserScript()}
${routeProtocolBrowserScript()}
var mapLoaderDepth = 0;
var routeNameFieldLoadDepth = 0;
var mapLoaderLastMessage = 'Pobieranie danych transportu…';
var lastRouteName = '';
var lastRouteRate = '';
var routeNameMode = 'continue';
var routeRateBaseline = '';
var routeRateBaselineName = '';
var routeNameTouched = false;
var routeRateTouched = false;
var routeRateRequest = 0;
var routeRateTimer = 0;
var routeNameProposeTicket = 0;
var transportApiEnabled = true;
var lookupRouteRateCalls = [];
function lookupRouteRate(name) {
  lookupRouteRateCalls.push(String(name == null ? '' : name));
}
function updateRouteSessionUi() {}
function contractorShortNameForRoute() { return 'GPW'; }
function pickupDateForRoute() { return '2026-09-23'; }
function isRouteChecked() {
  var el = document.getElementById('doc-chk-odbior-z-trasy');
  return !!(el && el.checked);
}
${sliceHtml(html, 'function syncMapLoaderUi(', 'function setTransportDatesLoading(')}
${sliceHtml(html, 'function setTransportDatesLoading(', 'function loadBulkTransportDates(')}
${sliceHtml(html, 'function setRouteFieldsVisible(', 'function readRouteNameInput(')}
${sliceHtml(html, 'function readRouteNameInput(', 'function readRouteRateInput(')}
${sliceHtml(html, 'function readRouteRateInput(', 'function contractorShortNameForRoute(')}
${sliceHtml(html, 'function routeNameMissingDepsHint(', 'function resetRouteFormForOpen(')}
${sliceHtml(html, 'function resetRouteFormForOpen(', 'function lookupRouteRate(')}
${sliceHtml(html, 'function applyShownRouteName(', 'function updateRouteSessionUi(')}
${sliceHtml(html, 'function setRouteNameFieldLoading(', 'function refreshRouteNameField(')}
${sliceHtml(html, 'function refreshRouteNameField(', 'function onNowaTrasaClick(')}
__api = {
  syncMapLoaderUi: syncMapLoaderUi,
  setTransportDatesLoading: setTransportDatesLoading,
  setRouteNameFieldLoading: setRouteNameFieldLoading,
  applyShownRouteName: applyShownRouteName,
  resetRouteFormForOpen: resetRouteFormForOpen,
  refreshRouteNameField: refreshRouteNameField,
  getState: function () {
    return {
      mapLoaderDepth: mapLoaderDepth,
      routeNameFieldLoadDepth: routeNameFieldLoadDepth,
      mapLoaderLastMessage: mapLoaderLastMessage,
      routeNameProposeTicket: routeNameProposeTicket,
      routeNameTouched: routeNameTouched
    };
  },
  setRouteNameTouched: function (value) { routeNameTouched = !!value; },
  setRouteNameMode: function (mode) { routeNameMode = String(mode); },
  lookupRouteRateCalls: lookupRouteRateCalls
};
`;
      runInNewContext(script, sandbox);
      const api = sandbox.__api as Omit<OrchestrationApi, 'pendingFetches'> | null;
      if (!api) {
        throw new Error('Harness nie wystawił API orkiestracji trasy');
      }
      return {
        api: { ...api, pendingFetches, lookupRouteRateCalls: api.lookupRouteRateCalls },
        els,
      };
    }

    async function flushFetch(): Promise<void> {
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    it('test_syncMapLoaderUi_when_route_load_ends_should_restore_transport_message', () => {
      const { api, els } = loadOrchestration();
      const loader = els['map-transport-loader'];
      const label = els['map-transport-loader-label'];

      api.setTransportDatesLoading(true, 'Pobieranie danych transportu…');
      expect(loader.hidden).toBe(false);
      expect(label.textContent).toBe('Pobieranie danych transportu…');

      api.setRouteNameFieldLoading(true);
      expect(api.getState().routeNameFieldLoadDepth).toBe(1);
      expect(label.textContent).toBe('Ładowanie nazwy trasy…');
      expect(loader.hidden).toBe(false);

      api.setRouteNameFieldLoading(false);
      expect(api.getState().routeNameFieldLoadDepth).toBe(0);
      expect(api.getState().mapLoaderDepth).toBe(1);
      expect(label.textContent).toBe('Pobieranie danych transportu…');
      expect(loader.hidden).toBe(false);
    });

    it('test_applyShownRouteName_when_empty_proposal_should_not_overwrite_existing_name', () => {
      const { api, els } = loadOrchestration();
      const nameEl = els['doc-inp-trasa'];
      nameEl.value = 'GPW-23.09.26-01';

      api.applyShownRouteName('');
      expect(nameEl.value).toBe('GPW-23.09.26-01');

      api.applyShownRouteName('   ');
      expect(nameEl.value).toBe('GPW-23.09.26-01');

      api.applyShownRouteName('GPW-23.09.26-02');
      expect(nameEl.value).toBe('GPW-23.09.26-02');
    });

    it('test_applyShownRouteName_when_touched_should_leave_input', () => {
      const { api, els } = loadOrchestration();
      const nameEl = els['doc-inp-trasa'];
      nameEl.value = 'reczna';
      api.setRouteNameTouched(true);

      api.applyShownRouteName('GPW-23.09.26-01');
      expect(nameEl.value).toBe('reczna');
    });

    it('test_resetRouteFormForOpen_when_route_loader_active_should_clear_depth_and_hide_overlay', () => {
      const { api, els } = loadOrchestration();
      const loader = els['map-transport-loader'];
      const nameEl = els['doc-inp-trasa'];
      const rateEl = els['doc-inp-stawka-trasy'];
      const chk = els['doc-chk-odbior-z-trasy'];

      api.setRouteNameFieldLoading(true);
      api.setRouteNameFieldLoading(true);
      nameEl.value = 'GPW-01';
      nameEl.placeholder = 'Ładowanie nazwy trasy…';
      rateEl.value = '150';
      chk.checked = true;
      expect(loader.hidden).toBe(false);
      expect(api.getState().routeNameFieldLoadDepth).toBe(2);
      const ticketBefore = api.getState().routeNameProposeTicket;

      api.resetRouteFormForOpen();

      expect(api.getState().routeNameFieldLoadDepth).toBe(0);
      expect(api.getState().routeNameProposeTicket).toBe(ticketBefore + 1);
      expect(loader.hidden).toBe(true);
      expect(loader.getAttribute('aria-busy')).toBe('false');
      expect(nameEl.value).toBe('');
      expect(nameEl.placeholder).toBe('');
      expect(nameEl.getAttribute('aria-busy')).toBeNull();
      expect(rateEl.value).toBe('');
      expect(chk.checked).toBe(false);
      expect(els['doc-route-fields'].getAttribute('hidden')).toBe('');
    });

    it('test_refreshRouteNameField_when_stale_ticket_should_not_apply_proposal', async () => {
      const { api, els } = loadOrchestration();
      const nameEl = els['doc-inp-trasa'];
      api.setRouteNameMode('new');

      api.refreshRouteNameField();
      expect(api.pendingFetches).toHaveLength(1);
      expect(api.getState().routeNameFieldLoadDepth).toBe(1);

      api.refreshRouteNameField();
      expect(api.pendingFetches).toHaveLength(2);
      expect(api.getState().routeNameFieldLoadDepth).toBe(2);

      // Starszy fetch: gdyby się zastosował, zaproponowałby -02; ticket musi go odrzucić.
      api.pendingFetches[0]({ ok: true, names: ['GPW-23.09.26-01'] });
      await flushFetch();
      expect(nameEl.value).toBe('');
      expect(api.getState().routeNameFieldLoadDepth).toBe(1);

      api.pendingFetches[1]({ ok: true, names: [] });
      await flushFetch();
      expect(nameEl.value).toBe('GPW-23.09.26-01');
      expect(api.getState().routeNameFieldLoadDepth).toBe(0);
    });

    it('test_refreshRouteNameField_when_reset_invalidates_ticket_should_keep_cleared_name', async () => {
      const { api, els } = loadOrchestration();
      const nameEl = els['doc-inp-trasa'];
      api.setRouteNameMode('new');

      api.refreshRouteNameField();
      expect(api.pendingFetches).toHaveLength(1);

      api.resetRouteFormForOpen();
      expect(nameEl.value).toBe('');
      expect(api.getState().routeNameFieldLoadDepth).toBe(0);

      api.pendingFetches[0]({ ok: true, names: [] });
      await flushFetch();
      expect(nameEl.value).toBe('');
    });
  });

  describe('contractorShortNameForRoute VM', () => {
    type FakeEl = {
      value: string;
      setAttribute?: (name: string, value: string) => void;
      removeAttribute?: (name: string) => void;
      getAttribute?: (name: string) => string | null;
    };

    type ContractorApi = {
      contractorShortNameForRoute: () => string;
      proposeRouteName: (occupied: string[], contractor: string, date: string) => string;
    };

    function sliceHtml(html: string, start: string, end: string): string {
      const a = html.indexOf(start);
      const b = html.indexOf(end);
      if (a < 0 || b < 0 || b <= a) {
        throw new Error(`Nie znaleziono wycinka: ${start} … ${end}`);
      }
      return html.slice(a, b);
    }

    function fakeEl(value = ''): FakeEl {
      return { value };
    }

    function loadContractorShortName(): {
      api: ContractorApi;
      els: Record<string, FakeEl>;
    } {
      const html = buildMapHtml(sampleGeocoded(), [], 'https://example.com/woj.json', [], [], {
        templateBase64: 'UEsDBA==',
        podwykoOptions: [
          { label: 'GPW', dane: 'GPW Transport Sp. z o.o.' },
          { label: 'BLUECARGO', dane: 'BLUECARGO Sp. ul. Rajska 1' },
          { label: 'REDCARGO', dane: 'REDCARGO Sp. ul. Portowa 2' },
          { label: 'Geodis', dane: 'Geodis Poland' },
        ],
      }, 'https://script.google.com/macros/s/test/exec');

      const els: Record<string, FakeEl> = {
        'doc-val-przewoznik': fakeEl(''),
        'doc-sel-przewoznik': fakeEl(''),
      };

      const sandbox: Record<string, unknown> = {
        document: {
          getElementById(id: string) {
            return els[id] ?? null;
          },
        },
        __api: null,
      };

      const podwykoStart = html.indexOf('const PODWYKOLISTA = ');
      const podwykoEnd = html.indexOf(';', podwykoStart) + 1;
      if (podwykoStart < 0 || podwykoEnd <= podwykoStart) {
        throw new Error('Nie znaleziono PODWYKOLISTA w HTML');
      }

      const script = `
${html.slice(podwykoStart, podwykoEnd)}
${routeNameBrowserScript()}
${sliceHtml(html, 'function normalizeForAddressSearchMap(', 'function foldLocalityMap(')}
${sliceHtml(html, 'function podwykoOptionMatchesQuery(', 'var docComboboxInited = false;')}
${sliceHtml(html, 'function findPodwykoIdxByLabel(', 'function selectDocComboboxOption(')}
${sliceHtml(html, 'function contractorShortNameForRoute(', 'function pickupDateForRoute(')}
__api = {
  contractorShortNameForRoute: contractorShortNameForRoute,
  proposeRouteName: proposeRouteName
};
`;
      runInNewContext(script, sandbox);
      const api = sandbox.__api as ContractorApi | null;
      if (!api) {
        throw new Error('Harness nie wystawił API contractorShortNameForRoute');
      }
      return { api, els };
    }

    it('test_contractorShortNameForRoute_when_valid_index_should_return_label', () => {
      const { api, els } = loadContractorShortName();
      els['doc-val-przewoznik'].value = '0';
      els['doc-sel-przewoznik'].value = '';

      expect(api.contractorShortNameForRoute()).toBe('GPW');
    });

    it('test_contractorShortNameForRoute_when_index_set_should_ignore_visible_text', () => {
      const { api, els } = loadContractorShortName();
      // Ukryty indeks Geodis (3), widoczny tekst sugeruje GPW — indeks wygrywa.
      els['doc-val-przewoznik'].value = '3';
      els['doc-sel-przewoznik'].value = 'GPW';

      expect(api.contractorShortNameForRoute()).toBe('Geodis');
    });

    it('test_contractorShortNameForRoute_when_visible_label_exact_should_resolve_and_set_index', () => {
      const { api, els } = loadContractorShortName();
      els['doc-val-przewoznik'].value = '';
      els['doc-sel-przewoznik'].value = 'BLUECARGO';

      expect(api.contractorShortNameForRoute()).toBe('BLUECARGO');
      expect(els['doc-val-przewoznik'].value).toBe('1');
    });

    it('test_contractorShortNameForRoute_when_normalized_label_should_resolve', () => {
      const { api, els } = loadContractorShortName();
      els['doc-val-przewoznik'].value = '';
      els['doc-sel-przewoznik'].value = 'gpw';

      expect(api.contractorShortNameForRoute()).toBe('GPW');
      expect(els['doc-val-przewoznik'].value).toBe('0');
    });

    it('test_contractorShortNameForRoute_when_unique_partial_match_should_resolve', () => {
      const { api, els } = loadContractorShortName();
      els['doc-val-przewoznik'].value = '';
      els['doc-sel-przewoznik'].value = 'blue';

      expect(api.contractorShortNameForRoute()).toBe('BLUECARGO');
      expect(els['doc-val-przewoznik'].value).toBe('1');
    });

    it('test_contractorShortNameForRoute_when_ambiguous_match_should_return_empty', () => {
      const { api, els } = loadContractorShortName();
      els['doc-val-przewoznik'].value = '';
      // „cargo” pasuje do BLUECARGO i REDCARGO — bez jednoznaczności.
      els['doc-sel-przewoznik'].value = 'cargo';

      expect(api.contractorShortNameForRoute()).toBe('');
      expect(els['doc-val-przewoznik'].value).toBe('');
    });

    it('test_contractorShortNameForRoute_when_unknown_text_should_return_empty', () => {
      const { api, els } = loadContractorShortName();
      els['doc-val-przewoznik'].value = '';
      els['doc-sel-przewoznik'].value = 'NieistniejacyPrzewoznik';

      expect(api.contractorShortNameForRoute()).toBe('');
    });

    it('test_contractorShortNameForRoute_when_wrong_short_name_should_propose_wrong_route_name', () => {
      const { api, els } = loadContractorShortName();
      const date = '2026-09-23';

      els['doc-val-przewoznik'].value = '0';
      els['doc-sel-przewoznik'].value = 'GPW';
      const correct = api.contractorShortNameForRoute();
      expect(correct).toBe('GPW');
      expect(api.proposeRouteName([], correct, date)).toBe('GPW-23.09.26-01');

      // Zły indeks / skrót → prefiks nazwy trasy od innego przewoźnika.
      els['doc-val-przewoznik'].value = '3';
      els['doc-sel-przewoznik'].value = 'GPW';
      const wrong = api.contractorShortNameForRoute();
      expect(wrong).toBe('Geodis');
      expect(api.proposeRouteName([], wrong, date)).toBe('Geodis-23.09.26-01');
      expect(api.proposeRouteName([], wrong, date)).not.toBe(
        api.proposeRouteName([], 'GPW', date),
      );
    });
  });

  describe('resolveRouteFieldsBeforeSave VM', () => {
    type FakeEl = { value: string };

    type ResolveApi = {
      resolveRouteFieldsBeforeSave: (
        fields: { trasa: string; stawkaTrasy: string } | null,
      ) => Promise<{ trasa: string; stawkaTrasy: string } | null>;
      getState: () => {
        routeNameMode: string;
        routeRateBaseline: string;
        routeRateBaselineName: string;
      };
      setExistingRate: (name: string, rate: string) => void;
      setConfirmAnswers: (answers: boolean[]) => void;
      pendingFetches: Array<(resp: { ok?: boolean; names?: string[] }) => void>;
    };

    function sliceHtml(html: string, start: string, end: string): string {
      const a = html.indexOf(start);
      const b = html.indexOf(end);
      if (a < 0 || b < 0 || b <= a) {
        throw new Error(`Nie znaleziono wycinka: ${start} … ${end}`);
      }
      return html.slice(a, b);
    }

    function loadResolveRouteFields(): {
      api: ResolveApi;
      els: Record<string, FakeEl>;
      alerts: string[];
    } {
      const html = buildMapHtml(sampleGeocoded(), [], 'https://example.com/woj.json', [], [], {
        templateBase64: 'UEsDBA==',
        podwykoOptions: [{ label: 'GPW', dane: 'GPW' }],
      }, 'https://script.google.com/macros/s/test/exec');

      const els: Record<string, FakeEl> = {
        'doc-inp-trasa': { value: 'GPW-23.09.26-01' },
      };
      const alerts: string[] = [];
      const confirmAnswers: boolean[] = [];
      const pendingFetches: Array<(resp: { ok?: boolean; names?: string[] }) => void> = [];

      const sandbox: Record<string, unknown> = {
        Promise,
        confirmAnswers,
        document: {
          getElementById(id: string) {
            return els[id] ?? null;
          },
        },
        window: {
          confirm() {
            return confirmAnswers.length > 0 ? !!confirmAnswers.shift() : false;
          },
          setTimeout(fn: () => void) {
            fn();
            return 1;
          },
        },
        alert(msg: string) {
          alerts.push(String(msg));
        },
        fetchTransportGet() {
          return new Promise<{ ok?: boolean; names?: string[] }>((resolve) => {
            pendingFetches.push(resolve);
          });
        },
        __api: null,
      };

      const script = `
${routeNameBrowserScript()}
${routeProtocolBrowserScript()}
var lastRouteName = '';
var lastRouteRate = '';
var routeNameMode = 'continue';
var routeRateBaseline = '';
var routeRateBaselineName = '';
var transportApiEnabled = true;
function contractorShortNameForRoute() { return 'GPW'; }
function pickupDateForRoute() { return '2026-09-23'; }
${sliceHtml(html, 'function existingRouteRateFor(', 'function askDifferentRouteRate(')}
${sliceHtml(html, 'function askDifferentRouteRate(', 'function proposeFreshRouteName(')}
${sliceHtml(html, 'function proposeFreshRouteName(', 'function resolveRouteFieldsBeforeSave(')}
${sliceHtml(html, 'function resolveRouteFieldsBeforeSave(', 'function runBulkDocGenerate(')}
__api = {
  resolveRouteFieldsBeforeSave: resolveRouteFieldsBeforeSave,
  getState: function () {
    return {
      routeNameMode: routeNameMode,
      routeRateBaseline: routeRateBaseline,
      routeRateBaselineName: routeRateBaselineName
    };
  },
  setExistingRate: function (name, rate) {
    routeRateBaselineName = String(name || '');
    routeRateBaseline = String(rate || '');
  },
  setConfirmAnswers: function (answers) {
    confirmAnswers.length = 0;
    for (var i = 0; i < answers.length; i++) confirmAnswers.push(!!answers[i]);
  }
};
`;
      runInNewContext(script, sandbox);
      const api = sandbox.__api as Omit<ResolveApi, 'pendingFetches'> | null;
      if (!api) {
        throw new Error('Harness nie wystawił API resolveRouteFieldsBeforeSave');
      }
      return {
        api: { ...api, pendingFetches },
        els,
        alerts,
      };
    }

    async function flushMicrotasks(): Promise<void> {
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    it('test_resolveRouteFieldsBeforeSave_when_no_conflict_should_return_same_fields', async () => {
      const { api } = loadResolveRouteFields();
      api.setExistingRate('GPW-23.09.26-01', '750');
      const fields = { trasa: 'GPW-23.09.26-01', stawkaTrasy: '750' };

      const result = await api.resolveRouteFieldsBeforeSave(fields);
      expect(result).toEqual(fields);
      expect(api.getState().routeNameMode).toBe('continue');
      expect(api.pendingFetches).toHaveLength(0);
    });

    it('test_resolveRouteFieldsBeforeSave_when_null_fields_should_passthrough', async () => {
      const { api } = loadResolveRouteFields();
      expect(await api.resolveRouteFieldsBeforeSave(null)).toBeNull();
    });

    it('test_resolveRouteFieldsBeforeSave_when_cancel_should_return_null', async () => {
      const { api } = loadResolveRouteFields();
      api.setExistingRate('GPW-23.09.26-01', '750');
      api.setConfirmAnswers([false, false]);

      const result = await api.resolveRouteFieldsBeforeSave({
        trasa: 'GPW-23.09.26-01',
        stawkaTrasy: '1010',
      });
      expect(result).toBeNull();
      expect(api.getState().routeNameMode).toBe('continue');
    });

    it('test_resolveRouteFieldsBeforeSave_when_update_all_should_keep_fields', async () => {
      const { api } = loadResolveRouteFields();
      api.setExistingRate('GPW-23.09.26-01', '750');
      api.setConfirmAnswers([false, true]);
      const fields = { trasa: 'GPW-23.09.26-01', stawkaTrasy: '1010' };

      const result = await api.resolveRouteFieldsBeforeSave(fields);
      expect(result).toEqual(fields);
      expect(api.getState().routeNameMode).toBe('continue');
    });

    it('test_resolveRouteFieldsBeforeSave_when_new_route_should_propose_next_name_and_keep_rate', async () => {
      const { api, els } = loadResolveRouteFields();
      api.setExistingRate('GPW-23.09.26-01', '750');
      api.setConfirmAnswers([true]);
      els['doc-inp-trasa'].value = 'GPW-23.09.26-01';

      const pending = api.resolveRouteFieldsBeforeSave({
        trasa: 'GPW-23.09.26-01',
        stawkaTrasy: '1010',
      });
      await flushMicrotasks();
      expect(api.pendingFetches).toHaveLength(1);
      api.pendingFetches[0]({ ok: true, names: ['GPW-23.09.26-01'] });

      const result = await pending;
      expect(result).toEqual({ trasa: 'GPW-23.09.26-02', stawkaTrasy: '1010' });
      expect(els['doc-inp-trasa'].value).toBe('GPW-23.09.26-02');
      expect(api.getState()).toEqual({
        routeNameMode: 'new',
        routeRateBaseline: '',
        routeRateBaselineName: '',
      });
    });

    it('test_resolveRouteFieldsBeforeSave_when_new_route_no_free_number_should_abort', async () => {
      const { api, alerts } = loadResolveRouteFields();
      api.setExistingRate('GPW-23.09.26-01', '750');
      api.setConfirmAnswers([true]);

      const occupied = Array.from({ length: 99 }, (_, i) => {
        const n = String(i + 1).padStart(2, '0');
        return `GPW-23.09.26-${n}`;
      });

      const pending = api.resolveRouteFieldsBeforeSave({
        trasa: 'GPW-23.09.26-01',
        stawkaTrasy: '1010',
      });
      await flushMicrotasks();
      api.pendingFetches[0]({ ok: true, names: occupied });

      const result = await pending;
      expect(result).toBeNull();
      expect(alerts.some((m) => m.includes('Brak wolnego numeru'))).toBe(true);
      expect(api.getState().routeNameMode).toBe('continue');
    });
  });

  describe('lookupRouteRateNow race VM', () => {
    type FakeEl = { value: string };

    type LookupApi = {
      lookupRouteRateNow: (name: string) => void;
      bumpRequest: () => void;
      setRouteRateTouched: (value: boolean) => void;
      getState: () => {
        routeRateRequest: number;
        routeRateBaseline: string;
        routeRateBaselineName: string;
      };
      pendingFetches: Array<(resp: { ok?: boolean; stawka?: string }) => void>;
    };

    function sliceHtml(html: string, start: string, end: string): string {
      const a = html.indexOf(start);
      const b = html.indexOf(end);
      if (a < 0 || b < 0 || b <= a) {
        throw new Error(`Nie znaleziono wycinka: ${start} … ${end}`);
      }
      return html.slice(a, b);
    }

    function loadLookupRouteRate(): {
      api: LookupApi;
      els: Record<string, FakeEl>;
    } {
      const html = buildMapHtml(sampleGeocoded(), [], 'https://example.com/woj.json', [], [], {
        templateBase64: 'UEsDBA==',
        podwykoOptions: [{ label: 'GPW', dane: 'GPW' }],
      }, 'https://script.google.com/macros/s/test/exec');

      const els: Record<string, FakeEl> = {
        'doc-inp-trasa': { value: 'GPW-23.09.26-01' },
        'doc-inp-stawka-trasy': { value: '' },
      };
      const pendingFetches: Array<(resp: { ok?: boolean; stawka?: string }) => void> = [];

      const sandbox: Record<string, unknown> = {
        Promise,
        document: {
          getElementById(id: string) {
            return els[id] ?? null;
          },
        },
        fetchTransportGet() {
          return new Promise<{ ok?: boolean; stawka?: string }>((resolve) => {
            pendingFetches.push(resolve);
          });
        },
        __api: null,
      };

      const script = `
${routeProtocolBrowserScript()}
var routeRateRequest = 0;
var routeRateTouched = false;
var routeRateBaseline = '';
var routeRateBaselineName = '';
var transportApiEnabled = true;
${sliceHtml(html, 'function lookupRouteRateNow(', 'function applyShownRouteName(')}
__api = {
  lookupRouteRateNow: lookupRouteRateNow,
  bumpRequest: function () { routeRateRequest += 1; },
  setRouteRateTouched: function (value) { routeRateTouched = !!value; },
  getState: function () {
    return {
      routeRateRequest: routeRateRequest,
      routeRateBaseline: routeRateBaseline,
      routeRateBaselineName: routeRateBaselineName
    };
  }
};
`;
      runInNewContext(script, sandbox);
      const api = sandbox.__api as Omit<LookupApi, 'pendingFetches'> | null;
      if (!api) {
        throw new Error('Harness nie wystawił API lookupRouteRateNow');
      }
      return { api: { ...api, pendingFetches }, els };
    }

    async function flushMicrotasks(): Promise<void> {
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    it('test_lookupRouteRateNow_when_response_arrives_should_fill_rate_and_baseline', async () => {
      const { api, els } = loadLookupRouteRate();
      els['doc-inp-trasa'].value = 'GPW-23.09.26-01';

      api.lookupRouteRateNow('GPW-23.09.26-01');
      expect(api.pendingFetches).toHaveLength(1);
      expect(api.getState().routeRateRequest).toBe(1);

      api.pendingFetches[0]({ ok: true, stawka: '750' });
      await flushMicrotasks();

      expect(els['doc-inp-stawka-trasy'].value).toBe('750');
      expect(api.getState().routeRateBaseline).toBe('750');
      expect(api.getState().routeRateBaselineName).toBe('GPW-23.09.26-01');
    });

    it('test_lookupRouteRateNow_when_stale_ticket_should_not_overwrite_newer_rate', async () => {
      const { api, els } = loadLookupRouteRate();
      els['doc-inp-trasa'].value = 'GPW-23.09.26-01';
      api.lookupRouteRateNow('GPW-23.09.26-01');

      els['doc-inp-trasa'].value = 'GPW-23.09.26-02';
      api.lookupRouteRateNow('GPW-23.09.26-02');
      expect(api.pendingFetches).toHaveLength(2);
      expect(api.getState().routeRateRequest).toBe(2);

      // Starszy fetch kończy się później — ticket 1 ≠ routeRateRequest 2.
      api.pendingFetches[0]({ ok: true, stawka: '111' });
      await flushMicrotasks();
      expect(els['doc-inp-stawka-trasy'].value).toBe('');

      api.pendingFetches[1]({ ok: true, stawka: '222' });
      await flushMicrotasks();
      expect(els['doc-inp-stawka-trasy'].value).toBe('222');
      expect(api.getState().routeRateBaseline).toBe('222');
      expect(api.getState().routeRateBaselineName).toBe('GPW-23.09.26-02');
    });

    it('test_lookupRouteRateNow_when_name_changed_during_flight_should_ignore_response', async () => {
      const { api, els } = loadLookupRouteRate();
      els['doc-inp-trasa'].value = 'GPW-23.09.26-01';
      api.lookupRouteRateNow('GPW-23.09.26-01');
      expect(api.pendingFetches).toHaveLength(1);

      els['doc-inp-trasa'].value = 'inna-trasa';
      // Ticket nadal aktualny (jeden request), ale nazwa w polu już inna.
      api.pendingFetches[0]({ ok: true, stawka: '999' });
      await flushMicrotasks();

      expect(els['doc-inp-stawka-trasy'].value).toBe('');
      expect(api.getState().routeRateBaseline).toBe('');
    });

    it('test_lookupRouteRateNow_when_request_bumped_externally_should_drop_inflight', async () => {
      const { api, els } = loadLookupRouteRate();
      els['doc-inp-trasa'].value = 'GPW-23.09.26-01';
      api.lookupRouteRateNow('GPW-23.09.26-01');
      // resetRouteFormForOpen / nowa sesja inkrementuje ticket bez nowego fetcha.
      api.bumpRequest();
      expect(api.getState().routeRateRequest).toBe(2);

      api.pendingFetches[0]({ ok: true, stawka: '750' });
      await flushMicrotasks();
      expect(els['doc-inp-stawka-trasy'].value).toBe('');
    });

    it('test_lookupRouteRateNow_when_user_edited_rate_should_keep_current_value', async () => {
      const { api, els } = loadLookupRouteRate();
      els['doc-inp-trasa'].value = 'GPW-23.09.26-01';
      els['doc-inp-stawka-trasy'].value = '500';
      api.setRouteRateTouched(true);

      api.lookupRouteRateNow('GPW-23.09.26-01');
      api.pendingFetches[0]({ ok: true, stawka: '750' });
      await flushMicrotasks();

      expect(els['doc-inp-stawka-trasy'].value).toBe('500');
      // Baseline z lookupu nadal zapamiętany (do konfliktu przy zapisie).
      expect(api.getState().routeRateBaseline).toBe('750');
      expect(api.getState().routeRateBaselineName).toBe('GPW-23.09.26-01');
    });
  });

  describe('executePhase6', () => {
    it('test_executePhase6_when_called_should_create_directory_and_write_html_file', async () => {
      const mkdirFn = vi.fn().mockResolvedValue(undefined);
      const writeFileFn = vi.fn().mockResolvedValue(undefined);

      const result = await executePhase6({
        outputDir: '/tmp/maps',
        geocoded: sampleGeocoded(),
        uncertainGeocoded: sampleUncertainGeocoded(),
        geoJsonUrl: 'https://example.com/woj.json',
        now: () => new Date('2026-02-25T17:05:06Z'),
        mkdirFn,
        writeFileFn,
        wordMapPaths: {
          templatePath: '/__arkusz_mapa_test__/missing.docx',
          podwykoPath: '/__arkusz_mapa_test__/missing.ods',
        },
      });

      expect(mkdirFn).toHaveBeenCalledWith('/tmp/maps', { recursive: true });
      expect(writeFileFn).toHaveBeenCalledTimes(1);
      expect(result.fileName).toBe('mapa_2026-02-25_18-05-06.html');
      expect(result.filePath).toContain('/tmp/maps/');
      expect(result.htmlContent).toContain('Wygenerowano: 25.02.2026, 18:05:06');
      expect(result.htmlContent).toContain('map-generated-at');
      expect(result.htmlContent.indexOf('generatedAt.addTo(map)')).toBeLessThan(
        result.htmlContent.indexOf('legend.addTo(map)'),
      );
    });
  });
});
