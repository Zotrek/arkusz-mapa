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
import {
  formatTimestampForFileName,
  buildMapFileName,
  buildMapHtml,
  executePhase6,
  normalizeForAddressSearch,
  addressMatchesSearch,
} from './phase6';

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
      expect(html).toContain('addressMatchesSearchMap');
      expect(html).toContain('wojBoundsByKey');
      expect(html).toContain('scheduleSearchViewport');
      expect(html).toContain('zoomControl: false');
      expect(html).toContain('map-zoom-in');
      expect(html).toContain('map-search-input-row');
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
      expect(html).toContain('Generuj dokument');
      expect(html).toContain('PODWYKOLISTA');
      expect(html).toContain('Janex');
      expect(html).toContain('pełne dane');
      expect(html).toContain('buildDocxDownloadName');
      expect(html).toContain('dzPlik');
      expect(html).toContain('id="doc-inp-data-zaladunku"');
      expect(html).toContain('id="doc-inp-numer-zlecenia"');
      expect(html).toContain('numer_zlecenia_transportowego');
      expect(html).toContain('defaultDateZaladunkuYmd');
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
