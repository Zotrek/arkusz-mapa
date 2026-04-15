/**
 * Testy TDD dla Fazy 5 – geokodowanie (Nominatim) i błędne adresy.
 *
 * Wymagania:
 *   REQ-5.1: zapytanie do Nominatim (q + format=json + limit=1 + countrycodes=pl)
 *   REQ-5.2: adresy bez ulicy (ulica pusta/brak) – query bez ulicy
 *   REQ-5.3: brak wyniku/błąd -> adres trafia do "Błędne adresy"
 *   REQ-5.4: odczyt lat/lon i województwa
 */

import { describe, it, expect, vi } from 'vitest';
import type { SheetRow } from './sheets';
import type { AddressGroup } from './phase3';
import {
  buildGeocodingQuery,
  buildGeocodingQueries,
  buildNominatimUrl,
  executePhase5,
  extractVoivodeship,
  stripStreetPrefix,
  stripAfterSlash,
} from './phase5';

function makeRow(params: Partial<SheetRow> = {}): SheetRow {
  return {
    sourceRowIndex: params.sourceRowIndex ?? 2,
    podmiotHandlowy: params.podmiotHandlowy ?? 'A',
    sklep: params.sklep ?? 'B',
    kodPocztowy: params.kodPocztowy ?? '62-320',
    miasto: params.miasto ?? 'Miłosław',
    ulica: params.ulica ?? 'os. Władysława Łokietka',
    numerBudynku: params.numerBudynku ?? '18',
    gmina: params.gmina ?? 'Września',
    numerPlomby: params.numerPlomby ?? '111',
    dataZamknieciaWorka: params.dataZamknieciaWorka ?? '',
    zbiorka: params.zbiorka ?? '',
    raw: params.raw ?? ['A', 'B'],
    address: params.address ?? '62-320 Miłosław os. Władysława Łokietka 18',
  };
}

function asGrouped(rows: SheetRow[]): Map<string, AddressGroup> {
  const grouped = new Map<string, AddressGroup>();
  rows.forEach((row) => {
    const current = grouped.get(row.address);
    if (!current) {
      grouped.set(row.address, { count: 1, rows: [row] });
      return;
    }
    current.count += 1;
    current.rows.push(row);
  });
  return grouped;
}

describe('phase5', () => {
  describe('buildGeocodingQuery', () => {
    it('test_buildGeocodingQuery_when_street_exists_should_include_street_without_prefix', () => {
      const row = makeRow({
        kodPocztowy: '62-320',
        miasto: 'Miłosław',
        ulica: 'os. Władysława Łokietka',
        numerBudynku: '18',
      });

      const query = buildGeocodingQuery(row);
      expect(query).toBe('62-320 Miłosław Władysława Łokietka 18, Polska');
    });

    it('test_buildGeocodingQuery_when_street_is_brak_should_skip_street', () => {
      const row = makeRow({
        kodPocztowy: '26-660',
        miasto: 'Wierzchowiny',
        ulica: 'brak',
        numerBudynku: '29',
      });

      const query = buildGeocodingQuery(row);
      expect(query).toBe('26-660 Wierzchowiny 29, Polska');
    });

    it('test_buildGeocodingQuery_when_city_is_wroclaw_fabryczna_should_normalize_to_wroclaw', () => {
      const row = makeRow({
        kodPocztowy: '54-049',
        miasto: 'WROCŁAW-FABRYCZNA',
        ulica: 'Fieldorfa',
        numerBudynku: '2',
      });

      const query = buildGeocodingQuery(row);
      expect(query).toBe('54-049 Wrocław Fieldorfa 2, Polska');
    });

    it('test_buildGeocodingQuery_when_number_has_slash_should_use_part_before_slash', () => {
      const row = makeRow({
        kodPocztowy: '62-320',
        miasto: 'Miasto',
        ulica: 'Leśna',
        numerBudynku: '10/10',
      });
      expect(buildGeocodingQuery(row)).toBe('62-320 Miasto Leśna 10, Polska');
    });
  });

  describe('buildGeocodingQueries', () => {
    it('test_buildGeocodingQueries_when_street_exists_should_return_fallback_variants', () => {
      const row = makeRow({
        kodPocztowy: '62-320',
        miasto: 'Miłosław',
        ulica: 'os. Władysława Łokietka',
        numerBudynku: '18',
      });

      const queries = buildGeocodingQueries(row);
      expect(queries.length).toBeGreaterThan(1);
      expect(queries.some((q) => q.includes('Miłosław Władysława Łokietka 18'))).toBe(true);
    });
  });

  describe('stripStreetPrefix', () => {
    it('test_stripStreetPrefix_when_os_prefix_should_remove_it', () => {
      expect(stripStreetPrefix('os. Władysława Łokietka')).toBe('Władysława Łokietka');
    });
    it('test_stripStreetPrefix_when_ul_prefix_should_remove_it', () => {
      expect(stripStreetPrefix('ul. Marszałkowska')).toBe('Marszałkowska');
    });
    it('test_stripStreetPrefix_when_al_prefix_should_remove_it', () => {
      expect(stripStreetPrefix('al. Niepodległości')).toBe('Niepodległości');
    });
    it('test_stripStreetPrefix_when_no_prefix_should_return_unchanged', () => {
      expect(stripStreetPrefix('Marszałkowska')).toBe('Marszałkowska');
    });
  });

  describe('stripAfterSlash', () => {
    it('test_stripAfterSlash_when_slash_present_should_return_part_before', () => {
      expect(stripAfterSlash('10/10')).toBe('10');
    });
    it('test_stripAfterSlash_when_no_slash_should_return_unchanged', () => {
      expect(stripAfterSlash('10')).toBe('10');
    });
    it('test_stripAfterSlash_when_empty_should_return_empty', () => {
      expect(stripAfterSlash('')).toBe('');
    });
  });

  describe('buildNominatimUrl', () => {
    it('test_buildNominatimUrl_when_query_given_should_include_required_params', () => {
      const url = buildNominatimUrl('62-320 Miłosław 18, Polska');
      expect(url).toContain('https://nominatim.openstreetmap.org/search');
      expect(url).toContain('format=json');
      expect(url).toContain('limit=15');
      expect(url).toContain('addressdetails=1');
      expect(url).toContain('countrycodes=pl');
      expect(url).toContain('q=');
    });
  });

  describe('extractVoivodeship', () => {
    it('test_extractVoivodeship_when_state_exists_should_return_state', () => {
      const woj = extractVoivodeship({ address: { state: 'Wielkopolskie' } });
      expect(woj).toBe('Wielkopolskie');
    });

    it('test_extractVoivodeship_when_state_missing_should_return_unknown', () => {
      const woj = extractVoivodeship({});
      expect(woj).toBe('Nieznane');
    });

    it('test_extractVoivodeship_when_state_has_prefix_should_normalize_name', () => {
      const woj = extractVoivodeship({ address: { state: 'województwo małopolskie' } });
      expect(woj).toBe('Małopolskie');
    });
  });

  describe('executePhase5', () => {
    it('test_executePhase5_when_nominatim_returns_result_should_return_geocoded_item', async () => {
      const row = makeRow();
      const grouped = asGrouped([row]);

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            lat: '52.206',
            lon: '17.489',
            address: {
              state: 'Wielkopolskie',
              postcode: '62-320',
              city: 'Miłosław',
              road: 'os. Władysława Łokietka',
              house_number: '18',
            },
          },
        ],
      });
      const sleepFn = vi.fn().mockResolvedValue(undefined);

      const result = await executePhase5(grouped, {
        fetchFn,
        sleepFn,
        userAgent: 'arkusz-mapa-test',
        rateLimitMs: 1,
      });

      expect(result.geocoded).toHaveLength(1);
      expect(result.geocoded[0].address).toBe(row.address);
      expect(result.geocoded[0].count).toBe(1);
      expect(result.geocoded[0].lat).toBe(52.206);
      expect(result.geocoded[0].lng).toBe(17.489);
      expect(result.geocoded[0].wojewodztwo).toBe('Wielkopolskie');
      expect(result.uncertainGeocoded).toEqual([]);
      expect(result.rowsBledneAdresy).toEqual([]);
      expect(result.rowsNiepewneWyniki).toEqual([]);
      expect(result.groupedNiepewneAdresy).toEqual([]);
      expect(result.groupedBledneAdresy).toEqual([]);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(sleepFn).toHaveBeenCalledTimes(1);
    });

    it('test_executePhase5_when_nominatim_returns_empty_should_mark_rows_as_bad_addresses', async () => {
      const row1 = makeRow({ sourceRowIndex: 2, numerPlomby: '111' });
      const row2 = makeRow({ sourceRowIndex: 3, numerPlomby: '222' });
      const grouped = asGrouped([row1, row2]);

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      });
      const sleepFn = vi.fn().mockResolvedValue(undefined);

      const result = await executePhase5(grouped, {
        fetchFn,
        sleepFn,
        userAgent: 'arkusz-mapa-test',
        rateLimitMs: 1,
      });

      expect(result.geocoded).toEqual([]);
      expect(result.uncertainGeocoded).toEqual([]);
      expect(result.rowsBledneAdresy).toHaveLength(2);
      expect(result.rowsBledneAdresy.map((r) => r.sourceRowIndex)).toEqual([2, 3]);
      expect(result.rowsNiepewneWyniki).toEqual([]);
      expect(result.groupedNiepewneAdresy).toEqual([]);
      expect(result.groupedBledneAdresy).toEqual([
        {
          address: row1.address,
          liczbaWystapien: 2,
        },
      ]);
    });

    it('test_executePhase5_when_first_query_fails_and_second_succeeds_should_use_fallback_query', async () => {
      const row = makeRow({
        kodPocztowy: '62-320',
        miasto: 'Miłosław',
        ulica: 'os. Władysława Łokietka',
        numerBudynku: '18',
      });
      const grouped = asGrouped([row]);

      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              lat: '52.206',
              lon: '17.489',
              address: {
                state: 'Wielkopolskie',
                postcode: '62-320',
                city: 'Miłosław',
                road: 'os. Władysława Łokietka',
                house_number: '18',
              },
            },
          ],
        });

      const sleepFn = vi.fn().mockResolvedValue(undefined);

      const result = await executePhase5(grouped, {
        fetchFn,
        sleepFn,
        userAgent: 'arkusz-mapa-test',
        rateLimitMs: 1,
      });

      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(result.geocoded).toHaveLength(1);
      expect(result.uncertainGeocoded).toHaveLength(0);
      expect(result.rowsBledneAdresy).toHaveLength(0);
    });

    it('test_executePhase5_when_only_postcode_and_city_match_should_classify_as_city_only', async () => {
      const row = makeRow({
        kodPocztowy: '34-700',
        miasto: 'Rabka',
        ulica: 'Chopina',
        numerBudynku: '16',
        address: '34-700 Rabka Chopina 16',
      });
      const grouped = asGrouped([row]);

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            lat: '49.609',
            lon: '19.966',
            address: {
              postcode: '34-700',
              city: 'Rabka',
              road: 'Inna Ulica',
              house_number: '999',
              state: 'Małopolskie',
            },
          },
        ],
      });
      const sleepFn = vi.fn().mockResolvedValue(undefined);

      const result = await executePhase5(grouped, {
        fetchFn,
        sleepFn,
        userAgent: 'arkusz-mapa-test',
        rateLimitMs: 1,
      });

      expect(result.geocoded).toEqual([]);
      expect(result.uncertainGeocoded).toEqual([]);
      expect(result.cityOnlyGeocoded).toHaveLength(1);
      expect(result.cityOnlyGeocoded[0].address).toBe(row.address);
      expect(result.cityOnlyGeocoded[0].wojewodztwo).toBe('Małopolskie');
      expect(result.rowsNiepewneWyniki).toHaveLength(0);
      expect(result.groupedNiepewneAdresy).toEqual([]);
      expect(result.rowsBledneAdresy).toEqual([]);
    });

    it('test_executePhase5_when_nominatim_returns_no_postcode_but_city_and_street_match_should_accept', async () => {
      const row = makeRow({
        kodPocztowy: '62-320',
        miasto: 'Miłosław',
        ulica: 'Leśna',
        numerBudynku: '10',
        address: '62-320 Miłosław Leśna 10',
      });
      const grouped = asGrouped([row]);

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            lat: '52.2',
            lon: '17.5',
            address: {
              city: 'Miłosław',
              road: 'Leśna',
              house_number: '10',
              state: 'Wielkopolskie',
            },
          },
        ],
      });
      const sleepFn = vi.fn().mockResolvedValue(undefined);

      const result = await executePhase5(grouped, {
        fetchFn,
        sleepFn,
        userAgent: 'arkusz-mapa-test',
        rateLimitMs: 1,
      });

      expect(result.geocodedNoPostcode).toHaveLength(1);
      expect(result.geocoded).toHaveLength(0);
      expect(result.rowsBledneAdresy).toHaveLength(0);
    });

    it('test_executePhase5_when_nominatim_returns_postcode_without_dash_should_still_match', async () => {
      const row = makeRow({
        kodPocztowy: '62-320',
        miasto: 'Miłosław',
        ulica: 'Leśna',
        numerBudynku: '10',
        address: '62-320 Miłosław Leśna 10',
      });
      const grouped = asGrouped([row]);

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            lat: '52.2',
            lon: '17.5',
            address: {
              postcode: '62320',
              city: 'Miłosław',
              road: 'Leśna',
              house_number: '10',
              state: 'Wielkopolskie',
            },
          },
        ],
      });
      const sleepFn = vi.fn().mockResolvedValue(undefined);

      const result = await executePhase5(grouped, {
        fetchFn,
        sleepFn,
        userAgent: 'arkusz-mapa-test',
        rateLimitMs: 1,
      });

      expect(result.geocoded).toHaveLength(1);
      expect(result.rowsBledneAdresy).toHaveLength(0);
    });

    it('test_executePhase5_when_sheet_city_has_parenthesis_and_nominatim_returns_base_name_should_match', async () => {
      const row = makeRow({
        kodPocztowy: '00-001',
        miasto: 'Warszawa (Śródmieście)',
        ulica: 'Marszałkowska',
        numerBudynku: '1',
        address: '00-001 Warszawa (Śródmieście) Marszałkowska 1',
      });
      const grouped = asGrouped([row]);

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            lat: '52.23',
            lon: '21.01',
            address: {
              postcode: '00-001',
              city: 'Warszawa',
              road: 'Marszałkowska',
              house_number: '1',
              state: 'Mazowieckie',
            },
          },
        ],
      });
      const sleepFn = vi.fn().mockResolvedValue(undefined);

      const result = await executePhase5(grouped, {
        fetchFn,
        sleepFn,
        userAgent: 'arkusz-mapa-test',
        rateLimitMs: 1,
      });

      expect(result.geocoded).toHaveLength(1);
      expect(result.geocoded[0].wojewodztwo).toBe('Mazowieckie');
      expect(result.rowsBledneAdresy).toHaveLength(0);
    });

    it('test_executePhase5_when_sheet_has_number_with_slash_and_nominatim_returns_base_number_should_classify_as_ok', async () => {
      const row = makeRow({
        kodPocztowy: '62-320',
        miasto: 'Miłosław',
        ulica: 'Leśna',
        numerBudynku: '10/10',
        address: '62-320 Miłosław Leśna 10/10',
      });
      const grouped = asGrouped([row]);

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            lat: '52.2',
            lon: '17.5',
            address: {
              postcode: '62-320',
              city: 'Miłosław',
              road: 'Leśna',
              house_number: '10',
              state: 'Wielkopolskie',
            },
          },
        ],
      });
      const sleepFn = vi.fn().mockResolvedValue(undefined);

      const result = await executePhase5(grouped, {
        fetchFn,
        sleepFn,
        userAgent: 'arkusz-mapa-test',
        rateLimitMs: 1,
      });

      expect(result.geocoded).toHaveLength(1);
      expect(result.geocoded[0].address).toBe(row.address);
      expect(result.rowsBledneAdresy).toHaveLength(0);
    });

    it('test_executePhase5_when_nominatim_returns_short_street_name_contained_in_sheet_should_classify_as_ok', async () => {
      const row = makeRow({
        kodPocztowy: '62-320',
        miasto: 'Miłosław',
        ulica: 'Władysława Łokietka',
        numerBudynku: '18',
        address: '62-320 Miłosław Władysława Łokietka 18',
      });
      const grouped = asGrouped([row]);

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            lat: '52.2',
            lon: '17.5',
            address: {
              postcode: '62-320',
              city: 'Miłosław',
              road: 'Łokietka',
              house_number: '18',
              state: 'Wielkopolskie',
            },
          },
        ],
      });
      const sleepFn = vi.fn().mockResolvedValue(undefined);

      const result = await executePhase5(grouped, {
        fetchFn,
        sleepFn,
        userAgent: 'arkusz-mapa-test',
        rateLimitMs: 1,
      });

      expect(result.geocoded).toHaveLength(1);
      expect(result.rowsBledneAdresy).toHaveLength(0);
    });

    it('test_executePhase5_when_street_names_differ_only_by_suffix_should_not_match', async () => {
      const row = makeRow({
        kodPocztowy: '00-001',
        miasto: 'Warszawa',
        ulica: 'Park',
        numerBudynku: '1',
        address: '00-001 Warszawa Park 1',
      });
      const grouped = asGrouped([row]);

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            lat: '52.23',
            lon: '21.01',
            address: {
              postcode: '00-001',
              city: 'Warszawa',
              road: 'Parkowa',
              house_number: '1',
              state: 'Mazowieckie',
            },
          },
        ],
      });
      const sleepFn = vi.fn().mockResolvedValue(undefined);

      const result = await executePhase5(grouped, {
        fetchFn,
        sleepFn,
        userAgent: 'arkusz-mapa-test',
        rateLimitMs: 1,
      });

      expect(result.geocoded).toHaveLength(0);
      expect(result.uncertainGeocoded).toHaveLength(1);
    });

    it('test_executePhase5_when_sheet_has_ul_prefix_and_nominatim_returns_street_without_prefix_should_classify_as_ok', async () => {
      const row = makeRow({
        kodPocztowy: '00-001',
        miasto: 'Warszawa',
        ulica: 'ul. Marszałkowska',
        numerBudynku: '1',
        address: '00-001 Warszawa ul. Marszałkowska 1',
      });
      const grouped = asGrouped([row]);

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            lat: '52.23',
            lon: '21.01',
            address: {
              postcode: '00-001',
              city: 'Warszawa',
              road: 'Marszałkowska',
              house_number: '1',
              state: 'Mazowieckie',
            },
          },
        ],
      });
      const sleepFn = vi.fn().mockResolvedValue(undefined);

      const result = await executePhase5(grouped, {
        fetchFn,
        sleepFn,
        userAgent: 'arkusz-mapa-test',
        rateLimitMs: 1,
      });

      expect(result.geocoded).toHaveLength(1);
      expect(result.geocoded[0].address).toBe(row.address);
      expect(result.uncertainGeocoded).toHaveLength(0);
      expect(result.rowsBledneAdresy).toHaveLength(0);
    });

    it('test_executePhase5_when_postcode_first3_digits_and_city_and_street_match_should_classify_as_ok', async () => {
      const row = makeRow({
        kodPocztowy: '34-700',
        miasto: 'Rabka',
        ulica: 'Chopina',
        numerBudynku: '16',
        address: '34-700 Rabka Chopina 16',
      });
      const grouped = asGrouped([row]);

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            lat: '49.609',
            lon: '19.966',
            address: {
              postcode: '34-701',
              city: 'Rabka',
              road: 'Chopina',
              house_number: '16',
              state: 'Małopolskie',
            },
          },
        ],
      });
      const sleepFn = vi.fn().mockResolvedValue(undefined);

      const result = await executePhase5(grouped, {
        fetchFn,
        sleepFn,
        userAgent: 'arkusz-mapa-test',
        rateLimitMs: 1,
      });

      expect(result.geocoded).toHaveLength(1);
      expect(result.geocoded[0].address).toBe(row.address);
      expect(result.geocoded[0].wojewodztwo).toBe('Małopolskie');
      expect(result.uncertainGeocoded).toHaveLength(0);
      expect(result.cityOnlyGeocoded).toHaveLength(0);
      expect(result.rowsBledneAdresy).toHaveLength(0);
    });

    it('test_executePhase5_when_first_candidate_is_wrong_city_should_pick_better_matching_candidate', async () => {
      const row = makeRow({
        kodPocztowy: '34-700',
        miasto: 'Rabka',
        ulica: 'Chopina',
        numerBudynku: '16',
        address: '34-700 Rabka Chopina 16',
      });
      const grouped = asGrouped([row]);

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            lat: '53.000',
            lon: '19.000',
            address: {
              postcode: '34-700',
              city: 'InneMiasto',
              road: 'Chopina',
              house_number: '16',
              state: 'Mazowieckie',
            },
          },
          {
            lat: '49.609',
            lon: '19.966',
            address: {
              postcode: '34-700',
              city: 'Rabka',
              road: 'Chopina',
              house_number: '16',
              state: 'Małopolskie',
            },
          },
        ],
      });
      const sleepFn = vi.fn().mockResolvedValue(undefined);

      const result = await executePhase5(grouped, {
        fetchFn,
        sleepFn,
        userAgent: 'arkusz-mapa-test',
        rateLimitMs: 1,
      });

      expect(result.geocoded).toHaveLength(1);
      expect(result.geocoded[0].lat).toBe(49.609);
      expect(result.geocoded[0].lng).toBe(19.966);
      expect(result.geocoded[0].wojewodztwo).toBe('Małopolskie');
    });

    it('test_executePhase5_when_fetch_fails_once_then_succeeds_should_retry_and_geocode', async () => {
      const row = makeRow();
      const grouped = asGrouped([row]);

      const fetchFn = vi
        .fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              lat: '52.206',
              lon: '17.489',
              address: {
                state: 'Wielkopolskie',
                postcode: '62-320',
                city: 'Miłosław',
                road: 'os. Władysława Łokietka',
                house_number: '18',
              },
            },
          ],
        });
      const sleepFn = vi.fn().mockResolvedValue(undefined);

      const result = await executePhase5(grouped, {
        fetchFn,
        sleepFn,
        userAgent: 'arkusz-mapa-test',
        rateLimitMs: 1,
        requestRetries: 2,
      });

      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(result.geocoded).toHaveLength(1);
      expect(result.rowsBledneAdresy).toHaveLength(0);
    });

    it('test_executePhase5_when_fetch_fails_should_mark_rows_as_bad_addresses', async () => {
      const row = makeRow();
      const grouped = asGrouped([row]);

      const fetchFn = vi.fn().mockRejectedValue(new Error('network failed'));
      const sleepFn = vi.fn().mockResolvedValue(undefined);

      const result = await executePhase5(grouped, {
        fetchFn,
        sleepFn,
        userAgent: 'arkusz-mapa-test',
        rateLimitMs: 1,
      });

      expect(result.geocoded).toEqual([]);
      expect(result.rowsBledneAdresy).toHaveLength(1);
      expect(result.groupedBledneAdresy).toEqual([
        {
          address: row.address,
          liczbaWystapien: 1,
        },
      ]);
    });

    it('test_executePhase5_when_cache_has_suspicious_ok_should_retry_and_replace_coordinates', async () => {
      const row = makeRow({
        kodPocztowy: '34-400',
        miasto: 'Nowy Targ',
        ulica: 'Waksmundzka',
        numerBudynku: '4',
        address: '34-400 Nowy Targ Waksmundzka 4',
      });
      const grouped = asGrouped([row]);

      const readFileFn = vi.fn().mockResolvedValue(
        JSON.stringify({
          version: 2,
          entries: {
            [row.address]: {
              status: 'ok',
              lat: 53.9003502,
              lng: 19.1825854,
              wojewodztwo: 'powiat sztumski',
              updatedAt: '2026-02-25T20:15:53.899Z',
            },
          },
        }),
      );
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            lat: '49.4850902',
            lon: '20.0481726',
            address: {
              state: 'województwo małopolskie',
              postcode: '34-400',
              city: 'Nowy Targ',
              road: 'Waksmundzka',
              house_number: '4',
            },
          },
        ],
      });
      const sleepFn = vi.fn().mockResolvedValue(undefined);

      const result = await executePhase5(grouped, {
        fetchFn,
        sleepFn,
        userAgent: 'arkusz-mapa-test',
        rateLimitMs: 1,
        cacheFilePath: '/tmp/phase5-cache.json',
        readFileFn,
        writeFileFn: vi.fn().mockResolvedValue(undefined),
        mkdirFn: vi.fn().mockResolvedValue(undefined),
      });

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(result.geocoded).toHaveLength(1);
      expect(result.geocoded[0].lat).toBe(49.4850902);
      expect(result.geocoded[0].lng).toBe(20.0481726);
      expect(result.geocoded[0].wojewodztwo).toBe('Małopolskie');
      expect(result.groupedBledneAdresy).toEqual([]);
    });
  });
});
