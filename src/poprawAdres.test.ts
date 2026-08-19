import { describe, it, expect } from 'vitest';
import type { AddressGroup } from './phase3';
import {
  buildPoprawAdresIndex,
  buildPoprawAdresLookupKey,
  findPoprawAdresMatch,
  parsePoprawAdresSheetRows,
} from './poprawAdres';

function makeGroup(address: string, podmiot = 'PH', sklep = 'Sklep A'): AddressGroup {
  return {
    address,
    count: 1,
    rows: [
      {
        sourceRowIndex: 2,
        podmiotHandlowy: podmiot,
        sklep,
        kodPocztowy: '',
        miasto: '',
        ulica: '',
        ulicaRaw: '',
        numerBudynku: '',
        gmina: '',
        numerPlomby: '1',
        dataZamknieciaWorka: '',
        zbiorka: '',
        wgHarmonogramu: '',
        dniHarmonogramu: '',
        raw: [],
        address,
      },
    ],
  };
}

describe('poprawAdres', () => {
  it('test_parsePoprawAdresSheetRows_when_valid_rows_should_parse_coords', () => {
    const rows = parsePoprawAdresSheetRows([
      ['Podmiot', 'Sklep', 'Adres', 'Lat', 'Lon', 'Uwagi', 'UpdatedAt', 'Author'],
      ['A', 'B', '62-320 Miłosław Test 1', '52.1', '17.4', '', '', ''],
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lat).toBe(52.1);
    expect(rows[0]?.lng).toBe(17.4);
  });

  it('test_findPoprawAdresMatch_when_full_key_should_match', () => {
    const index = buildPoprawAdresIndex([
      {
        podmiotHandlowy: 'PH',
        sklep: 'Sklep A',
        adres: '62-320 Miłosław Test 1',
        lat: 52.1,
        lng: 17.4,
      },
    ]);
    const hit = findPoprawAdresMatch(
      index,
      '62-320 Miłosław Test 1',
      makeGroup('62-320 Miłosław Test 1'),
    );
    expect(hit?.lat).toBe(52.1);
  });

  it('test_findPoprawAdresMatch_when_address_only_entry_should_match_any_podmiot', () => {
    const adres = '06-500 Mława J. Piłsudskiego 39';
    const index = buildPoprawAdresIndex([
      { podmiotHandlowy: '', sklep: '', adres, lat: 53.12, lng: 20.36 },
    ]);
    const hit = findPoprawAdresMatch(index, adres, makeGroup(adres, 'Inny', 'Inny sklep'));
    expect(hit?.lng).toBe(20.36);
  });

  it('test_buildPoprawAdresLookupKey_should_normalize_whitespace', () => {
    const key = buildPoprawAdresLookupKey('  Adres   1  ', ' PH ', ' sklep ');
    expect(key).toContain('adres 1');
  });
});
