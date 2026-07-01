/**
 * Testy TDD dla Fazy 6 – generowanie mapy HTML.
 *
 * Wymagania:
 *   REQ-6.1: szablon Leaflet + granice województw (GeoJSON)
 *   REQ-6.2: dane geokodowane wstrzyknięte do mapy (adres, count, lat, lng, woj)
 *   REQ-6.3: nazwa pliku mapa_YYYY-MM-DD_HH-mm-ss.html (czas w strefie Europe/Warsaw)
 *   REQ-6.4: zapis pliku do OUTPUT_DIR
 */

import { describe, it, expect, vi } from 'vitest';
import type { GeocodedAddress } from './phase5';
import type { SheetRow } from './sheets';
import {
  formatTimestampForFileName,
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
  haversineMeters,
  spreadCloseMarkerPositions,
  findCloseMapPointPairs,
  buildCloseGeocodedAddressPairs,
  buildTransportShopKey,
  MAP_MARKER_CLUSTER_MAX_M,
  MAP_SEARCH_SINGLE_MATCH_ZOOM,
  MAP_SEARCH_FIT_PADDING,
} from './phase6';

function makeSheetRow(overrides: Partial<SheetRow> = {}): SheetRow {
  return {
    sourceRowIndex: overrides.sourceRowIndex ?? 2,
    podmiotHandlowy: overrides.podmiotHandlowy ?? '',
    sklep: overrides.sklep ?? '',
    gmina: overrides.gmina ?? '',
    numerPlomby: overrides.numerPlomby ?? '',
    dataZamknieciaWorka: overrides.dataZamknieciaWorka ?? '',
    zbiorka: overrides.zbiorka ?? '',
    raw: overrides.raw ?? [],
    address: overrides.address ?? '62-320 Miłosław Leśna 1',
    kodPocztowy: overrides.kodPocztowy ?? '62-320',
    miasto: overrides.miasto ?? 'Miłosław',
    ulica: overrides.ulica ?? 'Leśna',
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
  });

  describe('buildMapHtml', () => {
    it('test_buildMapHtml_when_geocoded_data_given_should_embed_leaflet_and_geojson_url', () => {
      const html = buildMapHtml(sampleGeocoded(), sampleUncertainGeocoded(), 'https://example.com/woj.json');
      expect(html).toContain('leaflet@1.9.4');
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
      expect(html).toContain('basemaps.cartocdn.com/light_all');
      expect(html).toContain('activateCartoFallback');
      expect(html).toContain('CARTO_FALLBACK_MIN_ERRORS');
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
      expect(html).toContain('#D40418');
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
      expect(html).toContain("confidence === 'ok'");
      expect(html).toContain('#198754');
      expect(html).toContain('paletteOk');
    });

    it('test_buildMapHtml_when_ok_no_postcode_given_should_use_yellow_pin_and_label', () => {
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
      expect(html).toContain('#ffc107');
      expect(html).toContain('Bez kodu w wyniku');
    });

    it('test_buildMapHtml_when_city_only_geocoded_given_should_use_blue_pin_and_label', () => {
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
      expect(html).toContain('#0d6efd');
    });

    it('test_buildMapHtml_when_no_points_should_embed_empty_legend_quality_and_no_count_legend', () => {
      const html = buildMapHtml([], [], 'https://example.com/woj.json');
      expect(html).toContain('const legendQualityItems = []');
      expect(html).toContain('const hasCountLegend = false');
    });

    it('test_buildMapHtml_when_only_ok_points_should_embed_single_legend_quality_item', () => {
      const html = buildMapHtml(sampleGeocoded(), [], 'https://example.com/woj.json');
      expect(html).toContain('const legendQualityItems = [{"label":"Adres OK","color":"#198754"}]');
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
      expect(html).toContain('numer_zlecenia_transportowego');
      expect(html).toContain('defaultDateZaladunkuYmd');
      expect(html).toContain('loadDocModalData');
      expect(html).toContain('appendTransportRow');
      expect(html).toContain('filterSealRowsByMinDate');
      expect(html).toContain('buildDocListsFromSealRows');
      expect(html).toContain('doc-filter-info');
      expect(html).toContain('transportApiEnabled');
      expect(html).toContain('var dayOffset = hour >= 0 && hour < 4 ? 0 : 1;');
    });

    it('test_buildTransportShopKey_when_podmiot_and_adres_given_should_normalize_like_transport_sheet', () => {
      expect(buildTransportShopKey('Firma SA', '00-001 Warszawa ul. Testowa 1')).toBe(
        'firma sa\u000000-001 warszawa ul. testowa 1',
      );
      expect(buildTransportShopKey('Żabka', 'Kraków')).toBe('zabka\u0000krakow');
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
      expect(html).toContain('Worki do odebrania');
      expect(html).toContain('Nie odebrane');
      expect(html).toContain('Wszystkie worki');
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
      expect(result.fileName).toMatch(/^mapa_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.html$/);
      expect(result.filePath).toContain('/tmp/maps/');
      expect(result.htmlContent).toContain('<!DOCTYPE html>');
    });
  });
});
