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
  isLargeCity,
  isHamletPlaceAddress,
  isVillagePlaceAddress,
  isNumericDuplicateStreetNumber,
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
    ulicaRaw: params.ulicaRaw ?? params.ulica ?? 'os. Władysława Łokietka',
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
    const sklepKey = row.sklep.trim().replace(/\s+/g, ' ').toLowerCase();
    const groupingKey = sklepKey.length > 0 ? `${row.address}\u0000${sklepKey}` : row.address;
    const current = grouped.get(groupingKey);
    if (!current) {
      grouped.set(groupingKey, { address: row.address, count: 1, rows: [row] });
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
      expect(query).toBe('62-320 Miłosław os. Władysława Łokietka 18, Polska');
    });

    it('test_buildGeocodingQuery_when_street_is_brak_should_skip_street', () => {
      const row = makeRow({
        kodPocztowy: '26-660',
        miasto: 'Wierzchowiny',
        ulica: 'brak',
        numerBudynku: '29',
      });

      const query = buildGeocodingQuery(row);
      expect(query).toBe('Wierzchowiny 29, 26-660, Polska');
    });

    it('test_buildGeocodingQuery_when_village_place_should_skip_duplicate_street', () => {
      const row = makeRow({
        kodPocztowy: '33-390',
        miasto: 'ŁĄCKO',
        ulica: 'ŁĄCKO',
        numerBudynku: '106A',
        address: '33-390 ŁĄCKO ŁĄCKO 106A',
      });

      expect(buildGeocodingQuery(row)).toBe('ŁĄCKO 106A, 33-390, Polska');
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
      expect(queries.some((q) => q.includes('Miłosław os. Władysława Łokietka 18'))).toBe(true);
    });

    it('test_buildGeocodingQueries_when_village_place_address_should_query_without_street_name', () => {
      const row = makeRow({
        kodPocztowy: '21-080',
        miasto: 'Bogucin',
        ulica: 'Bogucin',
        numerBudynku: '59A',
        address: '21-080 Bogucin Bogucin 59A',
      });

      const queries = buildGeocodingQueries(row);

      expect(queries[0]).toBe('Bogucin 59A, 21-080, Polska');
      expect(queries.slice(0, 5).some((q) => q.match(/Bogucin Bogucin/))).toBe(false);
    });

    it('test_buildGeocodingQueries_when_numeric_duplicate_in_ulica_should_query_place_and_number', () => {
      const cases = [
        {
          row: makeRow({
            kodPocztowy: '34-407',
            miasto: 'Ciche',
            ulica: '170',
            numerBudynku: '170',
            address: '34-407 Ciche 170 170',
          }),
          expectedFirst: 'Ciche 170, 34-407, Polska',
        },
        {
          row: makeRow({
            kodPocztowy: '21-302',
            miasto: 'Brzozowica Duża',
            ulica: '119c',
            numerBudynku: '119c',
            address: '21-302 Brzozowica Duża 119c 119c',
          }),
          expectedFirst: 'Brzozowica Duża 119c, 21-302, Polska',
        },
        {
          row: makeRow({
            kodPocztowy: '56-321',
            miasto: 'Pakoslawsko',
            ulica: '48A',
            numerBudynku: '48A',
            address: '56-321 Pakoslawsko 48A 48A',
          }),
          expectedFirst: 'Pakoslawsko 48A, 56-321, Polska',
        },
      ];

      for (const { row, expectedFirst } of cases) {
        const queries = buildGeocodingQueries(row);
        expect(queries[0]).toBe(expectedFirst);
        expect(queries.slice(0, 5).some((q) => q.endsWith(', Polska') && !q.includes(row.kodPocztowy))).toBe(
          false,
        );
        expect(queries.slice(0, 5).some((q) => q.includes(`${row.ulica} ${row.numerBudynku}`))).toBe(
          false,
        );
      }
    });

    it('test_buildGeocodingQueries_when_osiedle_street_should_include_osiedle_variants', () => {
      const row = makeRow({
        kodPocztowy: '31-818',
        miasto: 'Kraków',
        ulica: 'os. Wysokie',
        numerBudynku: '19',
        address: '31-818 Kraków os. Wysokie 19',
      });

      const queries = buildGeocodingQueries(row);

      expect(queries.some((q) => q.includes('osiedle Wysokie 19'))).toBe(true);
      expect(queries.some((q) => q.includes('os. Wysokie 19'))).toBe(true);
    });

    it('test_buildGeocodingQueries_when_street_without_ul_prefix_should_include_ul_and_al_variants', () => {
      const row = makeRow({
        kodPocztowy: '34-130',
        miasto: 'Kalwaria Zabrzydowska',
        ulica: 'Targowa',
        numerBudynku: '3',
        address: '34-130 Kalwaria Zabrzydowska Targowa 3',
      });

      const queries = buildGeocodingQueries(row);

      expect(queries.some((q) => q.includes('ul. Targowa 3'))).toBe(true);
      expect(queries.some((q) => q.includes('al. Targowa 3'))).toBe(true);
    });

    it('test_buildGeocodingQueries_when_skopanie_gen_sikorskiego_should_include_aleja_variants', () => {
      const row = makeRow({
        kodPocztowy: '39-451',
        miasto: 'Skopanie',
        ulica: 'Aleja Generała Sikorskiego',
        numerBudynku: '11',
        address: '39-451 Skopanie Aleja Generała Sikorskiego 11',
      });

      const queries = buildGeocodingQueries(row);

      expect(queries.some((q) => q.includes('al. Generała Sikorskiego 11'))).toBe(true);
      expect(queries.some((q) => q.includes('Generała Sikorskiego 11'))).toBe(true);
    });

    it('test_buildGeocodingQueries_when_gdansk_with_diacritics_should_include_ascii_variant', () => {
      const row = makeRow({
        kodPocztowy: '80-843',
        miasto: 'Gdańsk',
        ulica: 'Olejarna',
        numerBudynku: '3',
        address: '80-843 Gdańsk Olejarna 3',
      });

      const queries = buildGeocodingQueries(row);

      expect(queries.some((q) => q.includes('Gdańsk Olejarna 3'))).toBe(true);
      expect(queries.some((q) => q.includes('Gdansk Olejarna 3'))).toBe(true);
    });

    it('test_buildGeocodingQueries_when_generala_street_should_include_abbrev_variant', () => {
      const row = makeRow({
        kodPocztowy: '04-247',
        miasto: 'Warszawa',
        ulica: 'Generała Chruściela',
        ulicaRaw: 'Gen. Chruściela',
        numerBudynku: '25',
        address: '04-247 Warszawa Generała Chruściela 25',
      });

      const queries = buildGeocodingQueries(row);

      expect(queries.some((q) => q.includes('Gen. Chruściela 25'))).toBe(true);
      expect(queries.some((q) => q.includes('GEN. Chruściela 25'))).toBe(true);
      expect(queries.some((q) => q.includes('Generała Chruściela 25'))).toBe(true);
    });

    it('test_buildGeocodingQueries_when_raw_gen_j_haller_should_include_legacy_forms', () => {
      const row = makeRow({
        kodPocztowy: '41-214',
        miasto: 'Sosnowiec',
        ulica: 'Generała J.HALLERA',
        ulicaRaw: 'GEN.J.HALLERA',
        numerBudynku: '16',
        address: '41-214 Sosnowiec Generała J.HALLERA 16',
      });

      const queries = buildGeocodingQueries(row);

      expect(queries.some((q) => q.includes('GEN.J.HALLERA 16'))).toBe(true);
      expect(queries.some((q) => q.includes('GEN. J.HALLERA 16'))).toBe(true);
    });
  });

  describe('isVillagePlaceAddress', () => {
    it('test_isVillagePlaceAddress_when_ulica_equals_miasto_should_return_true', () => {
      expect(
        isVillagePlaceAddress({ miasto: 'Bogucin', ulica: 'Bogucin', numerBudynku: '59A' }),
      ).toBe(true);
      expect(
        isVillagePlaceAddress({ miasto: 'ŁĄCKO', ulica: 'ŁĄCKO', numerBudynku: '106A' }),
      ).toBe(true);
    });

    it('test_isVillagePlaceAddress_when_ulica_is_miasto_and_number_should_return_true', () => {
      expect(
        isVillagePlaceAddress({ miasto: 'Tokarnia', ulica: 'Tokarnia 853', numerBudynku: '853' }),
      ).toBe(true);
    });

    it('test_isVillagePlaceAddress_when_real_street_should_return_false', () => {
      expect(
        isVillagePlaceAddress({ miasto: 'Kraków', ulica: 'Przybyszewskiego', numerBudynku: '75' }),
      ).toBe(false);
    });

    it('test_isVillagePlaceAddress_when_brak_street_should_return_false', () => {
      expect(isVillagePlaceAddress({ miasto: 'Wierzchowiny', ulica: 'brak', numerBudynku: '29' })).toBe(
        false,
      );
    });
  });

  describe('isNumericDuplicateStreetNumber', () => {
    it('test_isNumericDuplicateStreetNumber_when_ulica_equals_numer_should_return_true', () => {
      expect(isNumericDuplicateStreetNumber({ ulica: '170', numerBudynku: '170' })).toBe(true);
      expect(isNumericDuplicateStreetNumber({ ulica: '119c', numerBudynku: '119c' })).toBe(true);
      expect(isNumericDuplicateStreetNumber({ ulica: '48A', numerBudynku: '48A' })).toBe(true);
    });

    it('test_isNumericDuplicateStreetNumber_when_real_street_should_return_false', () => {
      expect(
        isNumericDuplicateStreetNumber({ ulica: 'Winne-Podbukowina', numerBudynku: '11' }),
      ).toBe(false);
      expect(isNumericDuplicateStreetNumber({ ulica: 'brak', numerBudynku: '29' })).toBe(false);
    });
  });

  describe('isHamletPlaceAddress', () => {
    it('test_isHamletPlaceAddress_when_all_caps_hamlet_in_city_should_return_true', () => {
      expect(
        isHamletPlaceAddress({ miasto: 'GDÓW', ulica: 'KLĘCZANA', numerBudynku: '33' }),
      ).toBe(true);
    });

    it('test_isHamletPlaceAddress_when_real_street_should_return_false', () => {
      expect(
        isHamletPlaceAddress({ miasto: 'Brzozów', ulica: 'Bema', numerBudynku: '12' }),
      ).toBe(false);
    });
  });

  describe('isLargeCity', () => {
    it('test_isLargeCity_when_krakow_should_return_true', () => {
      expect(isLargeCity('Kraków')).toBe(true);
      expect(isLargeCity('KRAKÓW')).toBe(true);
    });

    it('test_isLargeCity_when_small_town_should_return_false', () => {
      expect(isLargeCity('Rabka')).toBe(false);
      expect(isLargeCity('Miłosław')).toBe(false);
    });
  });

  describe('stripStreetPrefix', () => {
    it('test_stripStreetPrefix_when_os_prefix_should_keep_osiedle_name', () => {
      expect(stripStreetPrefix('os. Władysława Łokietka')).toBe('os. Władysława Łokietka');
    });
    it('test_stripStreetPrefix_when_ul_prefix_should_remove_it', () => {
      expect(stripStreetPrefix('ul. Marszałkowska')).toBe('Marszałkowska');
    });
    it('test_stripStreetPrefix_when_al_prefix_should_remove_it', () => {
      expect(stripStreetPrefix('al. Niepodległości')).toBe('Niepodległości');
      expect(stripStreetPrefix('al.Chryzantem')).toBe('Chryzantem');
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

    it('test_executePhase5_when_same_address_has_different_shops_should_keep_separate_counts_but_same_geocoded_address', async () => {
      const row1 = makeRow({ sourceRowIndex: 2, numerPlomby: '111', sklep: 'Sklep 1' });
      const row2 = makeRow({ sourceRowIndex: 3, numerPlomby: '222', sklep: 'Sklep 2' });
      const grouped = asGrouped([row1, row2]);

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

      expect(result.geocoded).toHaveLength(2);
      expect(result.geocoded.map((item) => item.address)).toEqual([row1.address, row2.address]);
      expect(result.geocoded.map((item) => item.count)).toEqual([1, 1]);
      expect(fetchFn).toHaveBeenCalledTimes(1);
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

    it('test_executePhase5_when_village_place_and_number_match_should_classify_as_ok', async () => {
      const row = makeRow({
        kodPocztowy: '21-080',
        miasto: 'Bogucin',
        ulica: 'Bogucin',
        numerBudynku: '59A',
        address: '21-080 Bogucin Bogucin 59A',
      });
      const grouped = asGrouped([row]);

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            lat: '51.3309728',
            lon: '22.386442',
            address: {
              postcode: '21-080',
              village: 'Bogucin',
              house_number: '59A',
              state: 'Lubelskie',
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
      expect(result.cityOnlyGeocoded).toEqual([]);
      expect(result.uncertainGeocoded).toEqual([]);
    });

    it('test_executePhase5_when_village_only_postcode_and_place_match_should_classify_as_ok', async () => {
      const row = makeRow({
        kodPocztowy: '33-390',
        miasto: 'ŁĄCKO',
        ulica: 'ŁĄCKO',
        numerBudynku: '106A',
        address: '33-390 ŁĄCKO ŁĄCKO 106A',
      });
      const grouped = asGrouped([row]);

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            lat: '49.5630584',
            lon: '20.4297326',
            address: {
              postcode: '33-390',
              village: 'gmina Łącko',
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
      expect(result.cityOnlyGeocoded).toEqual([]);
    });

    it('test_executePhase5_when_krakow_osiedle_and_neighbourhood_match_should_classify_as_ok', async () => {
      const row = makeRow({
        kodPocztowy: '31-818',
        miasto: 'Kraków',
        ulica: 'os. Wysokie',
        numerBudynku: '19',
        address: '31-818 Kraków os. Wysokie 19',
      });
      const grouped = asGrouped([row]);

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            lat: '50.0905274',
            lon: '20.0169256',
            address: {
              postcode: '31-820',
              city: 'Kraków',
              neighbourhood: 'Osiedle Wysokie',
              house_number: '19',
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
      expect(result.uncertainGeocoded).toEqual([]);
      expect(result.cityOnlyGeocoded).toEqual([]);
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

    it('test_executePhase5_when_large_city_wrong_postcode_but_street_matches_should_classify_as_ok', async () => {
      const row = makeRow({
        kodPocztowy: '30-382',
        miasto: 'Kraków',
        ulica: 'PRZYBYSZEWSKIEGO',
        numerBudynku: '75',
        gmina: 'Kraków',
        address: '30-382 Kraków PRZYBYSZEWSKIEGO 75',
      });
      const grouped = asGrouped([row]);

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            lat: '50.061',
            lon: '19.937',
            address: {
              postcode: '30-382',
              city: 'Kraków',
              state: 'Małopolskie',
            },
          },
          {
            lat: '50.016',
            lon: '19.902',
            address: {
              postcode: '30-091',
              city: 'Kraków',
              road: 'Przybyszewskiego',
              house_number: '75',
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
      expect(result.geocoded[0].lat).toBe(50.016);
      expect(result.geocoded[0].lng).toBe(19.902);
      expect(result.cityOnlyGeocoded).toHaveLength(0);
      expect(result.rowsBledneAdresy).toHaveLength(0);
    });

    it('test_executePhase5_when_gdansk_typo_and_wrong_postcode_should_classify_as_ok', async () => {
      const row = makeRow({
        kodPocztowy: '80-000',
        miasto: 'Gdansk',
        ulica: 'Olejarna',
        numerBudynku: '3',
        address: '80-000 Gdańsk Olejarna 3',
      });
      const grouped = asGrouped([row]);

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            lat: '54.3544635',
            lon: '18.6546215',
            type: 'retail',
            address: {
              postcode: '80-843',
              city: 'Gdańsk',
              road: 'Olejarna',
              house_number: '3',
              state: 'województwo pomorskie',
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
      expect(result.uncertainGeocoded).toHaveLength(0);
    });

    it('test_executePhase5_when_lodz_typo_and_city_match_should_classify_as_ok', async () => {
      const row = makeRow({
        kodPocztowy: '90-339',
        miasto: 'Łódż',
        ulica: 'Wilcza',
        numerBudynku: '4',
        address: '90-339 Łódź Wilcza 4',
      });
      const grouped = asGrouped([row]);

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            lat: '51.7560029',
            lon: '19.4847904',
            type: 'retail',
            address: {
              postcode: '90-339',
              city: 'Łódź',
              road: 'Wilcza',
              house_number: '4',
              state: 'województwo łódzkie',
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
      expect(result.uncertainGeocoded).toHaveLength(0);
    });

    it('test_executePhase5_when_small_city_wrong_postcode_should_not_ignore_postcode_mismatch', async () => {
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
              postcode: '00-001',
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

      expect(result.geocoded).toHaveLength(0);
      expect(result.rowsBledneAdresy).toHaveLength(1);
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

    it('test_executePhase5_when_cache_has_suspicious_ok_should_use_cached_coordinates', async () => {
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

      expect(fetchFn).not.toHaveBeenCalled();
      expect(result.geocoded).toHaveLength(1);
      expect(result.geocoded[0].lat).toBe(53.9003502);
      expect(result.geocoded[0].lng).toBe(19.1825854);
      expect(result.geocoded[0].wojewodztwo).toBe('powiat sztumski');
      expect(result.groupedBledneAdresy).toEqual([]);
    });

    it('test_executePhase5_when_village_building_match_without_village_name_should_classify_as_ok', async () => {
      const row = makeRow({
        kodPocztowy: '68-343',
        miasto: 'Biecz',
        ulica: 'Biecz',
        numerBudynku: '61',
        address: '68-343 Biecz Biecz 61',
      });
      const grouped = asGrouped([row]);

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            lat: '51.7595',
            lon: '14.7170',
            type: 'house',
            class: 'building',
            address: {
              postcode: '68-343',
              house_number: '61',
              state: 'Lubuskie',
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
      expect(result.uncertainGeocoded).toHaveLength(0);
    });

    it('test_executePhase5_when_street_address_and_postcode_centroid_should_ignore_postcode_result', async () => {
      const row = makeRow({
        kodPocztowy: '42-200',
        miasto: 'Częstochowa',
        ulica: 'Jasnogórska',
        numerBudynku: '61',
        address: '42-200 Częstochowa Jasnogórska 61',
      });
      const grouped = asGrouped([row]);

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            lat: '50.796',
            lon: '19.124',
            type: 'postcode',
            address: {
              postcode: '42-200',
              city: 'Częstochowa',
              state: 'Śląskie',
            },
          },
          {
            lat: '50.814',
            lon: '19.108',
            type: 'house',
            address: {
              postcode: '42-200',
              city: 'Częstochowa',
              road: 'Jasnogórska',
              house_number: '61',
              state: 'Śląskie',
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
      expect(result.geocoded[0].lat).toBe(50.814);
      expect(result.cityOnlyGeocoded).toHaveLength(0);
    });

    it('test_executePhase5_when_first_query_uncertain_and_later_ok_should_pick_ok', async () => {
      const row = makeRow({
        kodPocztowy: '32-420',
        miasto: 'GDÓW',
        ulica: 'KLĘCZANA',
        numerBudynku: '33',
        address: '32-420 GDÓW KLĘCZANA 33',
      });
      const grouped = asGrouped([row]);

      const uncertainPayload = [
        {
          lat: '49.89',
          lon: '20.25',
          type: 'postcode',
          address: { postcode: '32-420', city: 'Gdów', state: 'Małopolskie' },
        },
      ];
      const okPayload = [
        {
          lat: '49.8967',
          lon: '20.2567',
          type: 'house',
          class: 'building',
          address: {
            postcode: '32-420',
            village: 'Kłęczana',
            house_number: '33',
            state: 'Małopolskie',
          },
        },
      ];

      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => uncertainPayload })
        .mockResolvedValueOnce({ ok: true, json: async () => uncertainPayload })
        .mockResolvedValueOnce({ ok: true, json: async () => uncertainPayload })
        .mockResolvedValueOnce({ ok: true, json: async () => okPayload });

      const sleepFn = vi.fn().mockResolvedValue(undefined);

      const result = await executePhase5(grouped, {
        fetchFn,
        sleepFn,
        userAgent: 'arkusz-mapa-test',
        rateLimitMs: 1,
      });

      expect(result.geocoded).toHaveLength(1);
      expect(result.geocoded[0].lat).toBe(49.8967);
      expect(result.uncertainGeocoded).toHaveLength(0);
    });
  });
});
