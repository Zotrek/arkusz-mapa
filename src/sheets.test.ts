/**
 * Testy TDD dla Fazy 2 – odczyt i parsowanie danych z Google Sheets.
 *
 * Wymagania:
 *   REQ-2.2: Pobranie danych z pierwszej zakładki, zakres A:Z.
 *   REQ-2.3: Parsowanie do struktury SheetRow.
 *   REQ-2.4: Budowanie adresu z C+D+E+F, z pominięciem ulicy gdy "brak"/pusta.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildAddress,
  mapRawRowToSheetRow,
  parseSheetRows,
  getFirstSheetTitle,
  buildSheetRange,
  fetchSourceSheetValues,
  loadSourceRows,
} from './sheets';

describe('sheets phase 2', () => {
  describe('REQ-2.4: buildAddress', () => {
    it('test_buildAddress_when_street_is_present_should_include_street', () => {
      const address = buildAddress({
        kodPocztowy: '62-320',
        miasto: 'Miłosław',
        ulica: 'os. Władysława Łokietka',
        numerBudynku: '18',
      });

      expect(address).toBe('62-320 Miłosław os. Władysława Łokietka 18');
    });

    it('test_buildAddress_when_street_is_brak_should_skip_street', () => {
      const address = buildAddress({
        kodPocztowy: '26-660',
        miasto: 'Wierzchowiny',
        ulica: 'brak',
        numerBudynku: '29',
      });

      expect(address).toBe('26-660 Wierzchowiny 29');
    });

    it('test_buildAddress_when_street_is_empty_should_skip_street', () => {
      const address = buildAddress({
        kodPocztowy: '26-660',
        miasto: 'Wierzchowiny',
        ulica: '   ',
        numerBudynku: '29',
      });

      expect(address).toBe('26-660 Wierzchowiny 29');
    });
  });

  describe('REQ-2.3: mapRawRowToSheetRow', () => {
    it('test_mapRawRowToSheetRow_when_valid_row_should_map_columns_correctly', () => {
      const raw = [
        'PHUP GNIEZNO SPK',
        '16087-15 Sklep Polski Miłosław',
        '62-320',
        'Miłosław',
        'os. Władysława Łokietka',
        '18',
        'Września (pow.wrzesiński,gm.miej.-wiej.)',
        'Wielkopolskie',
        '700000000349130',
        '',
        '',
        '15.04.2026',
      ];

      const row = mapRawRowToSheetRow(raw, 2);

      expect(row.dataZamknieciaWorka).toBe('15.04.2026');
      expect(row.kodPocztowy).toBe('62-320');
      expect(row.miasto).toBe('Miłosław');
      expect(row.ulica).toBe('os. Władysława Łokietka');
      expect(row.numerBudynku).toBe('18');
      expect(row.numerPlomby).toBe('700000000349130');
      expect(row.address).toBe('62-320 Miłosław os. Władysława Łokietka 18');
      expect(row.sourceRowIndex).toBe(2);
    });
  });

  describe('REQ-2.3: parseSheetRows', () => {
    it('test_parseSheetRows_when_header_and_data_exist_should_return_rows_without_header', () => {
      const values = [
        [
          'Podmiot handlowy',
          'Sklep',
          'Kod pocztowy',
          'Miasto',
          'Ulica',
          'Numer budynku',
          'Gmina',
          'Województwo',
          'Numer plomby',
        ],
        ['A', 'B', '62-320', 'Miłosław', 'os. Władysława Łokietka', '18', 'Września', 'Wielkopolskie', '111'],
        ['C', 'D', '26-660', 'Wierzchowiny', 'brak', '29', 'Jedlińsk', 'Mazowieckie', '222'],
      ];

      const parsed = parseSheetRows(values);

      expect(parsed.headers).toEqual(values[0]);
      expect(parsed.rows).toHaveLength(2);
      expect(parsed.rows[0].sourceRowIndex).toBe(2);
      expect(parsed.rows[1].sourceRowIndex).toBe(3);
      expect(parsed.rows[1].address).toBe('26-660 Wierzchowiny 29');
    });

    it('test_parseSheetRows_when_values_are_empty_should_return_empty_result', () => {
      const parsed = parseSheetRows([]);

      expect(parsed.headers).toEqual([]);
      expect(parsed.rows).toEqual([]);
    });
  });

  describe('REQ-2.2: sheet title and range', () => {
    it('test_getFirstSheetTitle_when_metadata_contains_sheets_should_return_first_title', () => {
      const title = getFirstSheetTitle({
        sheets: [{ properties: { title: 'Arkusz1' } }, { properties: { title: 'Inna' } }],
      });

      expect(title).toBe('Arkusz1');
    });

    it('test_getFirstSheetTitle_when_metadata_is_missing_should_return_default_arkusz1', () => {
      const title = getFirstSheetTitle({});
      expect(title).toBe('Arkusz1');
    });

    it('test_buildSheetRange_when_title_is_given_should_return_a_to_z_range', () => {
      const range = buildSheetRange('Arkusz1');
      expect(range).toBe("'Arkusz1'!A:Z");
    });
  });

  describe('REQ-2.2: fetchSourceSheetValues', () => {
    it('test_fetchSourceSheetValues_when_called_should_query_values_get_with_proper_range', async () => {
      const valuesGet = vi.fn().mockResolvedValue({
        data: { values: [['h1'], ['d1']] },
      });
      const api = {
        spreadsheets: {
          values: {
            get: valuesGet,
          },
        },
      };

      const values = await fetchSourceSheetValues(api, 'sheet-id', 'Arkusz1');

      expect(valuesGet).toHaveBeenCalledWith({
        spreadsheetId: 'sheet-id',
        range: "'Arkusz1'!A:Z",
      });
      expect(values).toEqual([['h1'], ['d1']]);
    });

    it('test_loadSourceRows_when_api_returns_metadata_and_values_should_return_parsed_rows', async () => {
      const api = {
        spreadsheets: {
          get: vi.fn().mockResolvedValue({
            data: {
              sheets: [{ properties: { title: 'Arkusz1' } }],
            },
          }),
          values: {
            get: vi.fn().mockResolvedValue({
              data: {
                values: [
                  [
                    'Podmiot handlowy',
                    'Sklep',
                    'Kod pocztowy',
                    'Miasto',
                    'Ulica',
                    'Numer budynku',
                    'Gmina',
                    'Województwo',
                    'Numer plomby',
                  ],
                  ['A', 'B', '62-320', 'Miłosław', 'os. Władysława Łokietka', '18', 'Września', 'Wielkopolskie', '111'],
                ],
              },
            }),
          },
        },
      };

      const result = await loadSourceRows(api, 'sheet-id');

      expect(result.sheetTitle).toBe('Arkusz1');
      expect(result.headers).toHaveLength(9);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].address).toBe('62-320 Miłosław os. Władysława Łokietka 18');
    });
  });
});
