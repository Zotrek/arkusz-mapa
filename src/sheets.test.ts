/**
 * Testy TDD dla Fazy 2 – odczyt i parsowanie danych z Google Sheets.
 *
 * Wymagania:
 *   REQ-2.2: Pobranie danych z pierwszej zakładki, zakres A:Z.
 *   REQ-2.3: Parsowanie do struktury SheetRow.
 *   REQ-2.4: Budowanie adresu z C+D+E+F, z pominięciem ulicy gdy "brak"/pusta.
 */

import { describe, it, expect, vi } from 'vitest';
import https from 'node:https';
import {
  applyAddressAliases,
  buildAddress,
  stripTrailingHouseNumberFromStreet,
  correctKnownPostcodeTypo,
  mapRawRowToSheetRow,
  parseSheetRows,
  resolveSheetColumnMap,
  getFirstSheetTitle,
  buildSheetRange,
  fetchSourceSheetValues,
  loadSourceRows,
  googleAuthNoKeepAliveAgent,
} from './sheets';
import {
  COL_KOD_POCZTOWY,
  COL_MIASTO,
  COL_NUMER_PLOMBY,
  COL_DATA_ZAMKNIECIA_WORKA,
  COL_ZBIORKA,
} from './config';

const CURRENT_HEADERS = [
  'NIP',
  'Podmiot handlowy',
  'Sklep',
  'Kod pocztowy',
  'Miasto',
  'Ulica',
  'Numer budynku',
  'Gmina',
  'Województwo',
  'Numer plomby',
  'Status worka',
  'Status TMS worka',
  'Data zamknięcia worka',
  'Tryb zbiórki',
];

describe('sheets phase 2', () => {
  describe('correctKnownPostcodeTypo', () => {
    it('test_correctKnownPostcodeTypo_when_srem_with_62_100_should_return_63_100', () => {
      expect(correctKnownPostcodeTypo('62-100', 'Śrem')).toBe('63-100');
      expect(correctKnownPostcodeTypo('62-100', 'ŚREM')).toBe('63-100');
    });

    it('test_correctKnownPostcodeTypo_when_witkowo_with_62_100_should_leave_unchanged', () => {
      expect(correctKnownPostcodeTypo('62-100', 'Witkowo')).toBe('62-100');
    });

    it('test_correctKnownPostcodeTypo_when_srem_with_63_100_should_leave_unchanged', () => {
      expect(correctKnownPostcodeTypo('63-100', 'Śrem')).toBe('63-100');
    });
  });

  describe('stripTrailingHouseNumberFromStreet', () => {
    it('test_stripTrailingHouseNumberFromStreet_when_number_duplicated_at_end_should_remove_from_street', () => {
      expect(stripTrailingHouseNumberFromStreet('Winne-Podbukowina 11', '11')).toBe('Winne-Podbukowina');
      expect(stripTrailingHouseNumberFromStreet('OSIEDLE RYBACKIE 113A', '113A')).toBe('OSIEDLE RYBACKIE');
      expect(stripTrailingHouseNumberFromStreet('Tokarnia 853', '853')).toBe('Tokarnia');
      expect(stripTrailingHouseNumberFromStreet('Muszaki 13', '13')).toBe('Muszaki');
    });

    it('test_stripTrailingHouseNumberFromStreet_when_number_differs_should_leave_street_unchanged', () => {
      expect(stripTrailingHouseNumberFromStreet('11 listopada', '76')).toBe('11 listopada');
      expect(stripTrailingHouseNumberFromStreet('Przybyszewskiego', '75')).toBe('Przybyszewskiego');
      expect(stripTrailingHouseNumberFromStreet('Hoża 1-3', '1/3')).toBe('Hoża 1-3');
    });

    it('test_stripTrailingHouseNumberFromStreet_when_glued_number_should_split_street', () => {
      expect(stripTrailingHouseNumberFromStreet('Dworcowa17', '17')).toBe('Dworcowa');
    });
  });

  describe('REQ-2.4: buildAddress', () => {
    it('test_buildAddress_when_street_is_present_should_include_street', () => {
      const address = buildAddress({
        kodPocztowy: '62-320',
        miasto: 'Miłosław',
        ulica: 'os. Władysławs Łokietka',
        numerBudynku: '18',
      });

      expect(address).toBe('62-320 Miłosław os. Władysławs Łokietka 18');
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

  describe('resolveSheetColumnMap', () => {
    it('test_resolveSheetColumnMap_when_current_headers_should_map_nip_shifted_columns', () => {
      const map = resolveSheetColumnMap(CURRENT_HEADERS);

      expect(map.kodPocztowy).toBe(3);
      expect(map.miasto).toBe(4);
      expect(map.numerPlomby).toBe(9);
      expect(map.dataZamknieciaWorka).toBe(12);
      expect(map.zbiorka).toBe(13);
    });

    it('test_resolveSheetColumnMap_when_no_headers_should_use_defaults', () => {
      const map = resolveSheetColumnMap([]);

      expect(map.kodPocztowy).toBe(COL_KOD_POCZTOWY);
      expect(map.numerPlomby).toBe(COL_NUMER_PLOMBY);
      expect(map.zbiorka).toBe(COL_ZBIORKA);
    });
  });

  describe('applyAddressAliases', () => {
    const canonical = '37-200 Przeworsk 11 listopada 76';
    const typo = '37-200 Przeworsk 11-listopada 76';

    it('test_applyAddressAliases_when_przeworsk_typo_should_map_to_canonical', () => {
      const row = mapRawRowToSheetRow(
        ['', '', '', '37-200', 'Przeworsk', '11-listopada', '76', '', '', 'P1'],
        2,
      );
      expect(row.address).toBe(typo);
      const out = applyAddressAliases([row], { [typo]: canonical });
      expect(out[0]!.address).toBe(canonical);
    });

    it('test_applyAddressAliases_when_tomaszow_hoza_typo_should_map_to_slash_form', () => {
      const row = mapRawRowToSheetRow(
        ['', '', '', '97-200', 'Tomaszów Mazowiecki', 'Hoża', '1-3', '', '', 'P3'],
        4,
      );
      const canonical = '97-200 Tomaszów Mazowiecki Hoża 1/3';
      expect(row.address).toBe('97-200 Tomaszów Mazowiecki Hoża 1-3');
      const out = applyAddressAliases([row], { [row.address]: canonical });
      expect(out[0]!.address).toBe(canonical);
    });

    it('test_applyAddressAliases_when_no_alias_should_leave_unchanged', () => {
      const row = mapRawRowToSheetRow(
        ['', '', '', '62-320', 'Miłosław', 'Leśna', '1', '', '', 'P2'],
        3,
      );
      const out = applyAddressAliases([row], {});
      expect(out[0]!.address).toBe(row.address);
    });
  });

  describe('REQ-2.3: mapRawRowToSheetRow', () => {
    it('test_mapRawRowToSheetRow_when_valid_row_should_map_columns_correctly', () => {
      const raw = [
        '7790000000',
        'PHUP GNIEZNO SPK',
        '16087-15 Sklep Polski Miłosław',
        '62-320',
        'Miłosław',
        'os. Władysławs Łokietka',
        '18',
        'Września (pow.wrzesiński,gm.miej.-wiej.)',
        'Wielkopolskie',
        '700000000349130',
        '',
        '',
        '15.04.2026',
        'Maszyna',
      ];

      const row = mapRawRowToSheetRow(raw, 2);

      expect(row.dataZamknieciaWorka).toBe('15.04.2026');
      expect(row.kodPocztowy).toBe('62-320');
      expect(row.miasto).toBe('Miłosław');
      expect(row.ulica).toBe('os. Władysławs Łokietka');
      expect(row.numerBudynku).toBe('18');
      expect(row.numerPlomby).toBe('700000000349130');
      expect(row.zbiorka).toBe('Maszyna');
      expect(row.address).toBe('62-320 Miłosław os. Władysławs Łokietka 18');
      expect(row.sourceRowIndex).toBe(2);
    });

    it('test_mapRawRowToSheetRow_when_srem_has_wrong_postcode_should_correct_to_63_100', () => {
      const raw = [
        '',
        'Chata Polska Śrem',
        'Sklep',
        '62-100',
        'Śrem',
        'Chopina',
        '1D',
        '',
        'Wielkopolskie',
        '700000008275797',
      ];

      const row = mapRawRowToSheetRow(raw, 5);

      expect(row.kodPocztowy).toBe('63-100');
      expect(row.address).toBe('63-100 Śrem Chopina 1D');
    });

    it('test_mapRawRowToSheetRow_when_number_duplicated_in_ulica_should_build_address_without_duplicate', () => {
      const raw = [
        '',
        'Agnieszka Daraż',
        'Sklep',
        '37-750',
        'Dubiecko',
        'Winne-Podbukowina 11',
        '11',
        '',
        'Podkarpackie',
        '700000000000001',
      ];

      const row = mapRawRowToSheetRow(raw, 6);

      expect(row.ulica).toBe('Winne-Podbukowina');
      expect(row.numerBudynku).toBe('11');
      expect(row.address).toBe('37-750 Dubiecko Winne-Podbukowina 11');
    });

    it('test_mapRawRowToSheetRow_when_street_has_prefix_or_abbreviation_should_normalize_ulica', () => {
      const lodz = mapRawRowToSheetRow(
        ['', 'FAV', 'Sklep', '91-718', 'Łódź', 'al.Chryzantem', '8', '', 'Łódzkie', '1'],
        7,
      );
      expect(lodz.ulica).toBe('Chryzantem');
      expect(lodz.address).toBe('91-718 Łódź Chryzantem 8');

      const gdansk = mapRawRowToSheetRow(
        ['', 'Sklep', 'Sklep', '80-843', 'Gdansk', 'Olejarna', '3', '', 'Pomorskie', '10'],
        10,
      );
      expect(gdansk.miasto).toBe('Gdańsk');
      expect(gdansk.address).toBe('80-843 Gdańsk Olejarna 3');

      const gen = mapRawRowToSheetRow(
        ['', 'Sklep', 'Sklep', '04-247', 'Warszawa', 'Gen. Chruściela', '25', '', '', '12'],
        12,
      );
      expect(gen.ulica).toBe('Generała Chruściela');
      expect(gen.ulicaRaw).toBe('Gen. Chruściela');

      const lodzTypo = mapRawRowToSheetRow(
        ['', 'Sklep', 'Sklep', '90-339', 'Łódż', 'Wilcza', '4', '', 'Łódzkie', '11'],
        11,
      );
      expect(lodzTypo.miasto).toBe('Łódź');
      expect(lodzTypo.address).toBe('90-339 Łódź Wilcza 4');

      const naleczow = mapRawRowToSheetRow(
        ['', 'Sanatorium', 'Sklep', '24-140', 'Nałęczów', 'B. Głowackiego', '12', '', 'Lubelskie', '2'],
        8,
      );
      expect(naleczow.ulica).toBe('Barbary Głowackiego');
      expect(naleczow.address).toBe('24-140 Nałęczów Barbary Głowackiego 12');

      const dynow = mapRawRowToSheetRow(
        ['', 'Delikatesy', 'Sklep', '36-065', 'DYNÓW', 'K. WIELKIEGO', '1/1', '', 'Podkarpackie', '3'],
        9,
      );
      expect(dynow.ulica).toBe('Króla Wielkiego');
      expect(dynow.address).toBe('36-065 DYNÓW Króla Wielkiego 1/1');

      const chelm = mapRawRowToSheetRow(
        ['', 'Sklep', 'Sklep', '22-100', 'Chełm', 'Ramba Brzeska', '14A', '', 'Lubelskie', '4'],
        10,
      );
      expect(chelm.ulica).toBe('Rampa Brzeska');
      expect(chelm.address).toBe('22-100 Chełm Rampa Brzeska 14A');
    });
  });

  describe('REQ-2.3: parseSheetRows', () => {
    it('test_parseSheetRows_when_header_and_data_exist_should_return_rows_without_header', () => {
      const values = [
        CURRENT_HEADERS,
        [
          '',
          'A',
          'B',
          '62-320',
          'Miłosław',
          'os. Władysławs Łokietka',
          '18',
          'Września',
          'Wielkopolskie',
          '111',
        ],
        ['', 'C', 'D', '26-660', 'Wierzchowiny', 'brak', '29', 'Jedlińsk', 'Mazowieckie', '221'],
      ];

      const parsed = parseSheetRows(values);

      expect(parsed.headers).toEqual(values[0]);
      expect(parsed.rows).toHaveLength(2);
      expect(parsed.rows[0].sourceRowIndex).toBe(2);
      expect(parsed.rows[1].sourceRowIndex).toBe(3);
      expect(parsed.rows[1].address).toBe('26-660 Wierzchowiny 29');
      expect(parsed.columnMap.numerPlomby).toBe(9);
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
                  CURRENT_HEADERS,
                  [
                    '',
                    'A',
                    'B',
                    '62-320',
                    'Miłosław',
                    'os. Władysławs Łokietka',
                    '18',
                    'Września',
                    'Wielkopolskie',
                    '111',
                  ],
                ],
              },
            }),
          },
        },
      };

      const result = await loadSourceRows(api, 'sheet-id');

      expect(result.sheetTitle).toBe('Arkusz1');
      expect(result.headers).toHaveLength(CURRENT_HEADERS.length);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].address).toBe('62-320 Miłosław os. Władysławs Łokietka 18');
      expect(result.columnMap.kodPocztowy).toBe(COL_KOD_POCZTOWY);
      expect(result.columnMap.dataZamknieciaWorka).toBe(COL_DATA_ZAMKNIECIA_WORKA);
    });
  });

  describe('googleAuthNoKeepAliveAgent', () => {
    it('test_googleAuthNoKeepAliveAgent_should_return_https_agent_for_oauth_token_url', () => {
      const agent = googleAuthNoKeepAliveAgent(new URL('https://oauth2.googleapis.com/token'));
      expect(agent).toBeDefined();
      expect((agent as https.Agent).keepAlive).toBe(false);
    });
  });
});
