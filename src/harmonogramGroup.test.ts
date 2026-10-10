import { describe, expect, it } from 'vitest';
import {
  bolecinRowIdentity,
  buildBolecinRow,
  buildHarmonogramList,
  canonicalHarmonogramDays,
  harmonogramProposalDates,
  isBolecinPlace,
  joinHarmonogramLabels,
  nextHarmonogramId,
  selectedShopsForGroup,
  type HarmonogramHead,
  type HarmonogramShopRow,
} from './harmonogramGroup.js';

function shop(overrides: Partial<HarmonogramShopRow> & Pick<HarmonogramShopRow, 'sheetRow' | 'adres'>): HarmonogramShopRow {
  return {
    podwykonawca: 'Interzero',
    dni: 'pn, cz',
    harmonogramId: '',
    ...overrides,
  };
}

function head(overrides: Partial<HarmonogramHead> = {}): HarmonogramHead {
  return {
    id: 'H0001',
    podwykonawca: 'Interzero',
    dni: 'pn, cz',
    cenaTrasy: '',
    miejsceZrzutu: '',
    oknoAwizacji: '',
    awizacja: '',
    rodzajZbiorki: '',
    rodzajTransportu: '',
    spodziewaneWorki: '',
    ...overrides,
  };
}

describe('harmonogramGroup', () => {
  it('test_canonicalHarmonogramDays_when_order_differs_should_match', () => {
    expect(canonicalHarmonogramDays('cz, pn')).toBe('pn, cz');
    expect(canonicalHarmonogramDays('pn, cz')).toBe(canonicalHarmonogramDays('cz, pn'));
  });

  it('test_nextHarmonogramId_when_ids_exist_should_take_next_padded', () => {
    expect(nextHarmonogramId([])).toBe('H0001');
    expect(nextHarmonogramId(['H0001', 'H0003'])).toBe('H0004');
    expect(nextHarmonogramId(['H12', 'not-an-id'])).toBe('H0013');
  });

  it('test_isBolecinPlace_when_bolecin_or_biosystem_should_match', () => {
    expect(isBolecinPlace('BIOSYSTEM Bolęcin')).toBe(true);
    expect(isBolecinPlace('Bolecin')).toBe(true);
    expect(isBolecinPlace('Warszawa')).toBe(false);
    expect(isBolecinPlace('')).toBe(false);
  });

  it('test_harmonogramProposalDates_when_before_22_should_stay_in_current_month', () => {
    expect(harmonogramProposalDates('pn, cz', new Date(2026, 9, 10))).toEqual([
      '12.10.2026',
      '15.10.2026',
      '19.10.2026',
      '22.10.2026',
      '26.10.2026',
      '29.10.2026',
    ]);
  });

  it('test_harmonogramProposalDates_when_from_22_should_include_next_month', () => {
    expect(harmonogramProposalDates('pn', new Date(2026, 9, 22))).toEqual([
      '26.10.2026',
      '02.11.2026',
      '09.11.2026',
      '16.11.2026',
      '23.11.2026',
      '30.11.2026',
    ]);
  });

  it('test_harmonogramProposalDates_when_december_22_should_cross_year', () => {
    expect(harmonogramProposalDates('pn', new Date(2026, 11, 22))).toEqual([
      '28.12.2026',
      '04.01.2027',
      '11.01.2027',
      '18.01.2027',
      '25.01.2027',
    ]);
  });

  it('test_harmonogramProposalDates_when_days_empty_should_return_empty', () => {
    expect(harmonogramProposalDates('', new Date(2026, 9, 10))).toEqual([]);
  });

  it('test_joinHarmonogramLabels_when_duplicates_should_sort_and_unique', () => {
    expect(joinHarmonogramLabels([' Sklep B ', 'Sklep A', 'sklep a'])).toBe('Sklep A; Sklep B');
  });

  it('test_bolecinRowIdentity_when_same_trip_should_match_ignoring_case', () => {
    const row = buildBolecinRow({
      oknoAwizacji: '8:00–12:00',
      adres: 'A; B',
      nazwa: 'Sklep A; Sklep B',
      data: '12.10.2026',
      kto: 'Interzero',
      miejsce: 'Bolęcin',
      rodzajZbiorki: 'ręczna',
      worki: '',
      rodzajTransportu: 'bus',
      awizacja: 'WX1',
    });
    expect(row[7]).toBe('');
    expect(bolecinRowIdentity('A; B', '12.10.2026', 'Interzero')).toBe(
      bolecinRowIdentity('a; b', '12.10.2026', ' interzero '),
    );
  });

  it('test_buildHarmonogramList_when_same_days_and_contractor_should_bucket_together', () => {
    const view = buildHarmonogramList(
      [
        shop({ sheetRow: 2, adres: 'Adres B' }),
        shop({ sheetRow: 3, adres: 'Adres A', dni: 'cz, pn' }),
        shop({ sheetRow: 4, adres: 'Adres C', podwykonawca: 'Inny' }),
        shop({ sheetRow: 5, adres: 'Adres D', harmonogramId: 'H0001' }),
        shop({ sheetRow: 6, adres: 'Adres D' }),
        shop({ sheetRow: 9, adres: 'Adres D', harmonogramId: 'H0001', dni: 'wt' }),
      ],
      [head()],
      new Date(2026, 9, 10),
    );

    expect(view.harmonogramy).toHaveLength(1);
    expect(view.harmonogramy[0]?.sklepy).toEqual([{ adres: 'Adres D', rows: [5, 6] }]);
    expect(view.harmonogramy[0]?.bolecin).toBe(false);
    expect(view.doZgrupowania.map((bucket) => bucket.sklepy.map((item) => item.adres))).toEqual([
      ['Adres C'],
      ['Adres A', 'Adres B'],
      ['Adres D'],
    ]);
  });

  it('test_buildHarmonogramList_when_place_is_bolecin_should_flag_and_list_dates', () => {
    const view = buildHarmonogramList(
      [],
      [head({ miejsceZrzutu: 'BIOSYSTEM Bolęcin', spodziewaneWorki: '40' })],
      new Date(2026, 9, 22),
    );
    expect(view.harmonogramy[0]?.bolecin).toBe(true);
    expect(view.harmonogramy[0]?.daty[0]).toBe('22.10.2026');
    expect(view.harmonogramy[0]?.spodziewaneWorki).toBe('40');
  });

  it('test_selectedShopsForGroup_when_two_shops_same_bucket_should_include_price_twins', () => {
    const shops = [
      shop({ sheetRow: 2, adres: 'Adres A' }),
      shop({ sheetRow: 8, adres: 'Adres A' }),
      shop({ sheetRow: 3, adres: 'Adres B', dni: 'cz, pn' }),
      shop({ sheetRow: 4, adres: 'Adres C', podwykonawca: 'Inny' }),
    ];
    expect(selectedShopsForGroup(shops, [2, 3])).toEqual({
      ok: true,
      dni: 'pn, cz',
      podwykonawca: 'Interzero',
      sheetRows: [2, 3, 8],
    });
  });

  it('test_selectedShopsForGroup_when_contractors_differ_should_reject', () => {
    const shops = [
      shop({ sheetRow: 2, adres: 'Adres A' }),
      shop({ sheetRow: 3, adres: 'Adres B', podwykonawca: 'Inny' }),
    ];
    expect(selectedShopsForGroup(shops, [2, 3])).toEqual({ ok: false, error: 'rozne' });
  });

  it('test_selectedShopsForGroup_when_none_should_reject', () => {
    expect(selectedShopsForGroup([], [])).toEqual({ ok: false, error: 'zaznacz' });
  });
});
