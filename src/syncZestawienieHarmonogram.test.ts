import { describe, expect, it, vi } from 'vitest';
import { BAZA_CEN_HEADERS } from './bazaCenHarmonogram.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { filterExpandRequests, tableExpandRequests } from './sheetTables.js';
import {
  buildScheduleSyncExpected,
  compareDdMmYyyy,
  datesMatchingWeekdays,
  defaultSyncWindow,
  planOffScheduleCleanup,
  scheduleDateOnOrAfter,
  planScheduleSync,
  scheduleMonthSheetName,
  scheduleRowKey,
  sheetRateWriteValue,
  syncZestawienieHarmonogram,
  zestawienieRowValues,
  ZESTAWIENIE_HARMONOGRAM_HEADERS,
  type ScheduleCleanupSourceRow,
} from './syncZestawienieHarmonogram.js';

const ODEBRANE_HEADERS = [
  'Podmiot handlowy',
  'Sklep',
  'Firma transportowa',
  'Kod pocztowy',
  'Miasto',
  'Ulica',
  'Numer budynku',
  'Data zamknięcia worka',
  'Tryb zbiórki',
  'Numer plomby',
];

function odebraneRow(overrides: Record<string, string> = {}): string[] {
  const byHeader: Record<string, string> = {
    'Podmiot handlowy': 'Firma X',
    Sklep: 'Sklep A',
    'Firma transportowa': 'THOR',
    'Kod pocztowy': '31-342',
    Miasto: 'Kraków',
    Ulica: 'Radzikowskiego',
    'Numer budynku': '138',
    'Data zamknięcia worka': '15.09.2026',
    'Tryb zbiórki': 'Ręczna',
    'Numer plomby': 'P1',
    ...overrides,
  };
  return ODEBRANE_HEADERS.map((h) => byHeader[h] ?? '');
}

describe('buildScheduleSyncExpected', () => {
  it('test_buildScheduleSyncExpected_pickup_days_even_without_bags', () => {
    const rows = buildScheduleSyncExpected(
      '14.09.2026',
      '23.09.2026',
      [...BAZA_CEN_HEADERS],
      [
        ['31-342 Kraków Radzikowskiego 138', 'THOR', '', '100', '0', '', '01.01.2026', 'wt'],
        ['30-045 Kraków ul. Królewska 52', 'THOR', '', '100', '0', '', '01.01.2026', 'wt'],
      ],
      ODEBRANE_HEADERS,
      [],
    );
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.bagCount === 0)).toBe(true);
    expect(rows.every((r) => r.rodzajZbiorki === 'brak worków')).toBe(true);
  });

  it('test_buildScheduleSyncExpected_when_zero_bags_should_fill_names_from_any_odebrane_row', () => {
    const rows = buildScheduleSyncExpected(
      '14.09.2026',
      '16.09.2026',
      [...BAZA_CEN_HEADERS],
      [['31-342 Kraków Radzikowskiego 138', 'THOR', '', '100', '0', '', '01.01.2026', 'wt']],
      ODEBRANE_HEADERS,
      [odebraneRow({ 'Data zamknięcia worka': '08.09.2026' })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      bagCount: 0,
      pickupDate: '15.09.2026',
      podmiot: 'Firma X',
      shopName: 'Sklep A',
      rodzajZbiorki: 'brak worków',
    });
  });

  it('test_buildScheduleSyncExpected_aggregates_rodzaj_from_tryb_zbiorki', () => {
    const rows = buildScheduleSyncExpected(
      '15.09.2026',
      '16.09.2026',
      [...BAZA_CEN_HEADERS],
      [['31-342 Kraków Radzikowskiego 138', 'THOR', '', '50', '10', '', '', 'wt']],
      ODEBRANE_HEADERS,
      [
        odebraneRow({ 'Numer plomby': 'P1', 'Tryb zbiórki': 'Ręczna' }),
        odebraneRow({ 'Numer plomby': 'P2', 'Tryb zbiórki': 'Maszyna' }),
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      bagCount: 2,
      rodzajZbiorki: 'ręczna i automatyczna',
    });
  });

  it('test_buildScheduleSyncExpected_joins_bags_when_baza_healed_odebrane_has_al', () => {
    const rows = buildScheduleSyncExpected(
      '15.09.2026',
      '16.09.2026',
      [...BAZA_CEN_HEADERS],
      [['51-602 Wrocław Kochanowskiego 33', 'THOR', 'T1', '40', '5', '100', '', 'wt']],
      ODEBRANE_HEADERS,
      [
        odebraneRow({
          'Kod pocztowy': '51-602',
          Miasto: 'Wrocław',
          Ulica: 'al. Kochanowskiego',
          'Numer budynku': '33',
          'Numer plomby': 'P1',
        }),
        odebraneRow({
          'Kod pocztowy': '51-602',
          Miasto: 'Wrocław',
          Ulica: 'al. Kochanowskiego',
          'Numer budynku': '33',
          'Numer plomby': 'P2',
        }),
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      address: '51-602 Wrocław Kochanowskiego 33',
      bagCount: 2,
      pickupRate: '40',
      bagRate: '5',
      routeName: 'T1',
    });
  });

  it('test_buildScheduleSyncExpected_when_as_of_pickup_day_should_omit_row', () => {
    const rows = buildScheduleSyncExpected(
      '15.09.2026',
      '15.09.2026',
      [...BAZA_CEN_HEADERS],
      [['31-342 Kraków Radzikowskiego 138', 'THOR', '', '50', '10', '', '', 'wt']],
      ODEBRANE_HEADERS,
      [odebraneRow()],
    );
    expect(rows).toHaveLength(0);
  });

  it('test_buildScheduleSyncExpected_when_day_after_pickup_should_include_theoretical_date', () => {
    const rows = buildScheduleSyncExpected(
      '01.10.2026',
      '02.10.2026',
      [...BAZA_CEN_HEADERS],
      [['31-342 Kraków Radzikowskiego 138', 'THOR', '', '50', '10', '', '', 'cz']],
      ODEBRANE_HEADERS,
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      pickupDate: '01.10.2026',
      bagCount: 0,
    });
  });

  it('test_scheduleDateOnOrAfter_when_friday_only_should_keep_friday_or_move_forward', () => {
    expect(scheduleDateOnOrAfter('09.10.2026', [5])).toBe('09.10.2026');
    expect(scheduleDateOnOrAfter('03.10.2026', [5])).toBe('09.10.2026');
    expect(scheduleDateOnOrAfter('15.10.2026', [5])).toBe('16.10.2026');
  });

  it('test_buildScheduleSyncExpected_when_bags_closed_off_schedule_day_should_roll_to_next_pickup', () => {
    const rows = buildScheduleSyncExpected(
      '01.10.2026',
      '17.10.2026',
      [...BAZA_CEN_HEADERS],
      [['38-242 Skołyszyn Skołyszyn 11B', 'Zagroda', '', '50', '10', '', '', 'pt']],
      ODEBRANE_HEADERS,
      [
        odebraneRow({
          'Kod pocztowy': '38-242',
          Miasto: 'Skołyszyn',
          Ulica: 'Skołyszyn',
          'Numer budynku': '11B',
          'Firma transportowa': 'Zagroda',
          Sklep: 'Delikatesy Szubryt Nr 005',
          'Podmiot handlowy': 'SZUBRYT DELIKATESY',
          'Data zamknięcia worka': '03.10.2026',
          'Tryb zbiórki': 'Ręczna',
          'Numer plomby': 'P1',
        }),
        odebraneRow({
          'Kod pocztowy': '38-242',
          Miasto: 'Skołyszyn',
          Ulica: 'Skołyszyn',
          'Numer budynku': '11B',
          'Firma transportowa': 'Zagroda',
          'Data zamknięcia worka': '09.10.2026',
          'Tryb zbiórki': 'Maszyna',
          'Numer plomby': 'P2',
        }),
        odebraneRow({
          'Kod pocztowy': '38-242',
          Miasto: 'Skołyszyn',
          Ulica: 'Skołyszyn',
          'Numer budynku': '11B',
          'Firma transportowa': 'Zagroda',
          'Data zamknięcia worka': '15.10.2026',
          'Tryb zbiórki': 'Ręczna',
          'Numer plomby': 'P3',
        }),
      ],
    );
    expect(rows.map((r) => r.pickupDate)).toEqual(['02.10.2026', '09.10.2026', '16.10.2026']);
    expect(rows.map((r) => r.bagCount)).toEqual([0, 2, 1]);
    expect(rows[1]).toMatchObject({ rodzajZbiorki: 'ręczna i automatyczna' });
    expect(rows[2]).toMatchObject({ rodzajZbiorki: 'ręczna' });
  });

  it('test_buildScheduleSyncExpected_when_next_pickup_is_after_window_should_omit_off_day_row', () => {
    const rows = buildScheduleSyncExpected(
      '01.10.2026',
      '04.10.2026',
      [...BAZA_CEN_HEADERS],
      [['38-242 Skołyszyn Skołyszyn 11B', 'Zagroda', '', '50', '10', '', '', 'pt']],
      ODEBRANE_HEADERS,
      [
        odebraneRow({
          'Kod pocztowy': '38-242',
          Miasto: 'Skołyszyn',
          Ulica: 'Skołyszyn',
          'Numer budynku': '11B',
          'Firma transportowa': 'Zagroda',
          'Data zamknięcia worka': '03.10.2026',
          'Numer plomby': 'P1',
        }),
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ pickupDate: '02.10.2026', bagCount: 0 });
  });

  function expectRawBagOnCanonicalFriday(canonical: string, raw: Record<string, string>): void {
    const rows = buildScheduleSyncExpected(
      '01.10.2026',
      '10.10.2026',
      [...BAZA_CEN_HEADERS],
      [[canonical, 'THOR', '', '50', '10', '', '', 'pt']],
      ODEBRANE_HEADERS,
      [
        odebraneRow({
          'Firma transportowa': 'THOR',
          'Data zamknięcia worka': '03.10.2026',
          'Numer plomby': 'P1',
          ...raw,
        }),
      ],
    );
    expect(rows.map((r) => `${r.pickupDate}|${r.bagCount}|${r.address}`)).toEqual([
      `02.10.2026|0|${canonical}`,
      `09.10.2026|1|${canonical}`,
    ]);
  }

  it('test_buildScheduleSyncExpected_when_city_gdanska_should_join_gdansk_friday', () => {
    expectRawBagOnCanonicalFriday('80-001 Gdańsk Chmielna 1', {
      'Kod pocztowy': '80-001',
      Miasto: 'Gdańska',
      Ulica: 'Chmielna',
      'Numer budynku': '1',
    });
  });

  it('test_buildScheduleSyncExpected_when_wroclaw_fabryczna_should_join_wroclaw_friday', () => {
    expectRawBagOnCanonicalFriday('51-602 Wrocław Kochanowskiego 33', {
      'Kod pocztowy': '51-602',
      Miasto: 'WROCŁAW-FABRYCZNA',
      Ulica: 'Kochanowskiego',
      'Numer budynku': '33',
    });
  });

  it('test_buildScheduleSyncExpected_when_city_parenthetical_should_join_city_without_note', () => {
    expectRawBagOnCanonicalFriday('31-342 Kraków Radzikowskiego 138', {
      Miasto: 'Kraków (Nowa Huta)',
    });
  });

  it('test_buildScheduleSyncExpected_when_glued_al_prefix_should_join_street_without_prefix', () => {
    expectRawBagOnCanonicalFriday('90-001 Łódź Chryzantem 12', {
      'Kod pocztowy': '90-001',
      Miasto: 'Łódź',
      Ulica: 'al.Chryzantem',
      'Numer budynku': '12',
    });
  });

  it('test_scheduleDateOnOrAfter_when_friday_is_public_holiday_should_use_next_working_friday', () => {
    expect(scheduleDateOnOrAfter('30.04.2026', [5])).toBe('08.05.2026');
    expect(scheduleDateOnOrAfter('24.12.2026', [5])).toBe('08.01.2027');
    expect(scheduleDateOnOrAfter('26.12.2026', [5])).toBe('08.01.2027');
    expect(scheduleDateOnOrAfter('01.01.2027', [5])).toBe('08.01.2027');
  });

  it('test_datesMatchingWeekdays_when_public_holiday_should_skip_that_friday', () => {
    expect(datesMatchingWeekdays('24.04.2026', '08.05.2026', [5])).toEqual(['24.04.2026', '08.05.2026']);
    expect(datesMatchingWeekdays('01.05.2026', '01.05.2026', [5])).toEqual([]);
    expect(datesMatchingWeekdays('18.12.2026', '08.01.2027', [5])).toEqual(['18.12.2026', '08.01.2027']);
  });

  it('test_buildScheduleSyncExpected_when_friday_holiday_should_roll_bag_to_next_working_friday', () => {
    const rows = buildScheduleSyncExpected(
      '24.04.2026',
      '09.05.2026',
      [...BAZA_CEN_HEADERS],
      [['31-342 Kraków Radzikowskiego 138', 'THOR', '', '50', '10', '', '', 'pt']],
      ODEBRANE_HEADERS,
      [odebraneRow({ 'Data zamknięcia worka': '30.04.2026', 'Numer plomby': 'P1' })],
    );
    expect(rows.map((r) => r.pickupDate)).toEqual(['24.04.2026', '08.05.2026']);
    expect(rows.map((r) => r.bagCount)).toEqual([0, 1]);
  });

  it('test_buildScheduleSyncExpected_when_christmas_and_new_year_fridays_should_land_on_8_01', () => {
    const rows = buildScheduleSyncExpected(
      '18.12.2026',
      '09.01.2027',
      [...BAZA_CEN_HEADERS],
      [['31-342 Kraków Radzikowskiego 138', 'THOR', '', '50', '10', '', '', 'pt']],
      ODEBRANE_HEADERS,
      [odebraneRow({ 'Data zamknięcia worka': '24.12.2026', 'Numer plomby': 'P1' })],
    );
    expect(rows.map((r) => r.pickupDate)).toEqual(['18.12.2026', '08.01.2027']);
    expect(rows.map((r) => r.bagCount)).toEqual([0, 1]);
  });
});

const SKOLYSZYN = '38-242 Skołyszyn Skołyszyn 11B';

function cleanupRow(overrides: Partial<ScheduleCleanupSourceRow> = {}): ScheduleCleanupSourceRow {
  return {
    sheetName: 'Harmonogram Październik 2026',
    sheetRow: 2,
    address: SKOLYSZYN,
    shopName: 'Delikatesy Szubryt Nr 005',
    podmiot: 'SZUBRYT DELIKATESY',
    contractor: 'Zagroda',
    pickupDate: '02.10.2026',
    bagCount: 0,
    rodzajZbiorki: '',
    settled: false,
    transport: '',
    invoice: '',
    routeName: '',
    routeRate: '',
    pickupRate: '',
    bagRate: '',
    ...overrides,
  };
}

describe('planOffScheduleCleanup', () => {
  const baza = [['38-242 Skołyszyn Skołyszyn 11B', 'Zagroda', 'Z1', '50', '10', '', '', 'pt']];

  it('test_planOffScheduleCleanup_when_bags_closed_off_schedule_day_should_add_them_to_pickup_and_drop_row', () => {
    const friday = cleanupRow({
      sheetRow: 5,
      pickupDate: '09.10.2026',
      bagCount: 1,
      rodzajZbiorki: 'automatyczna',
    });
    const plan = planOffScheduleCleanup(
      [...BAZA_CEN_HEADERS],
      baza,
      [
        friday,
        cleanupRow({ sheetRow: 3, pickupDate: '03.10.2026', bagCount: 4, rodzajZbiorki: 'ręczna' }),
        cleanupRow({ sheetRow: 4, pickupDate: '06.10.2026', bagCount: 3, rodzajZbiorki: 'ręczna' }),
      ],
      new Map([
        [
          scheduleRowKey(friday.address, friday.pickupDate, friday.contractor),
          { bagCount: 1, rodzajZbiorki: 'automatyczna' },
        ],
      ]),
    );
    expect(plan.absorb).toEqual([
      expect.objectContaining({
        bagCount: 8,
        rodzajZbiorki: 'ręczna i automatyczna',
        existing: { sheetName: 'Harmonogram Październik 2026', sheetRow: 5 },
      }),
    ]);
    expect(plan.remove.map((row) => row.sheetRow).sort()).toEqual([3, 4]);
    expect(plan.skippedSettled).toBe(0);
  });

  it('test_planOffScheduleCleanup_when_off_day_row_is_settled_should_leave_it', () => {
    const plan = planOffScheduleCleanup(
      [...BAZA_CEN_HEADERS],
      baza,
      [cleanupRow({ sheetRow: 7, pickupDate: '08.10.2026', bagCount: 2, settled: true, invoice: 'FV/1' })],
      new Map(),
    );
    expect(plan.remove).toHaveLength(0);
    expect(plan.absorb).toHaveLength(0);
    expect(plan.skippedSettled).toBe(1);
  });

  it('test_planOffScheduleCleanup_when_pickup_day_is_settled_should_keep_off_day_row', () => {
    const plan = planOffScheduleCleanup(
      [...BAZA_CEN_HEADERS],
      baza,
      [
        cleanupRow({ sheetRow: 5, pickupDate: '09.10.2026', bagCount: 1, settled: true }),
        cleanupRow({ sheetRow: 3, pickupDate: '03.10.2026', bagCount: 4, rodzajZbiorki: 'ręczna' }),
      ],
      new Map(),
    );
    expect(plan.remove).toHaveLength(0);
    expect(plan.absorb).toHaveLength(0);
    expect(plan.skippedTargetSettled).toBe(1);
  });

  it('test_planOffScheduleCleanup_when_raw_address_should_absorb_into_normalized_friday', () => {
    const canonical = '80-001 Gdańsk Chmielna 1';
    const friday = cleanupRow({
      address: canonical,
      contractor: 'THOR',
      pickupDate: '09.10.2026',
      bagCount: 0,
      sheetRow: 5,
    });
    const plan = planOffScheduleCleanup(
      [...BAZA_CEN_HEADERS],
      [[canonical, 'THOR', '', '50', '10', '', '', 'pt']],
      [
        friday,
        cleanupRow({
          address: '80-001 Gdańska Chmielna 1',
          contractor: 'THOR',
          pickupDate: '03.10.2026',
          bagCount: 2,
          rodzajZbiorki: 'ręczna',
          sheetRow: 3,
        }),
      ],
      new Map([
        [scheduleRowKey(canonical, '09.10.2026', 'THOR'), { bagCount: 0, rodzajZbiorki: 'brak worków' }],
      ]),
    );
    expect(plan.remove.map((row) => row.sheetRow)).toEqual([3]);
    expect(plan.absorb).toEqual([
      expect.objectContaining({
        bagCount: 2,
        existing: { sheetName: friday.sheetName, sheetRow: 5 },
        targetKey: scheduleRowKey(canonical, '09.10.2026', 'THOR'),
      }),
    ]);
  });

  it('test_planOffScheduleCleanup_when_shop_has_no_pickup_days_should_leave_close_date', () => {
    const plan = planOffScheduleCleanup(
      [...BAZA_CEN_HEADERS],
      baza,
      [
        cleanupRow({
          sheetRow: 9,
          address: '30-001 Testowa 1',
          contractor: 'INNY',
          pickupDate: '03.10.2026',
          bagCount: 2,
        }),
      ],
      new Map(),
    );
    expect(plan.remove).toHaveLength(0);
    expect(plan.absorb).toHaveLength(0);
  });

  it('test_planOffScheduleCleanup_when_transport_did_not_happen_should_drop_row_without_bags', () => {
    const friday = cleanupRow({ sheetRow: 2, pickupDate: '02.10.2026', bagCount: 0 });
    const plan = planOffScheduleCleanup(
      [...BAZA_CEN_HEADERS],
      baza,
      [friday, cleanupRow({ sheetRow: 8, pickupDate: '01.10.2026', bagCount: 14, transport: 'nie' })],
      new Map([
        [scheduleRowKey(friday.address, friday.pickupDate, friday.contractor), { bagCount: 0, rodzajZbiorki: '' }],
      ]),
    );
    expect(plan.absorb).toHaveLength(0);
    expect(plan.remove.map((row) => row.sheetRow)).toEqual([8]);
  });
});

describe('planScheduleSync', () => {
  it('test_planScheduleSync_skips_settled_never_deletes', () => {
    const expected = buildScheduleSyncExpected(
      '15.09.2026',
      '16.09.2026',
      [...BAZA_CEN_HEADERS],
      [['31-342 Kraków Radzikowskiego 138', 'THOR', '', '50', '10', '', '', 'wt']],
      ODEBRANE_HEADERS,
      [odebraneRow()],
    );
    const plan = planScheduleSync(expected, [
      {
        sheetName: 'Harmonogram Wrzesień 2026',
        sheetRow: 2,
        key: expected[0]!.key,
        settled: true,
        bagCount: 1,
      },
    ]);
    expect(plan.skippedSettled).toBe(1);
    expect(plan.create).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
  });

  it('test_planScheduleSync_when_odebrane_bags_drop_should_keep_existing_count', () => {
    const expected = buildScheduleSyncExpected(
      '15.09.2026',
      '16.09.2026',
      [...BAZA_CEN_HEADERS],
      [['31-342 Kraków Radzikowskiego 138', 'THOR', '', '50', '10', '', '', 'wt']],
      ODEBRANE_HEADERS,
      [odebraneRow({ 'Numer plomby': 'P1' })],
    );
    expect(expected[0]!.bagCount).toBe(1);
    const plan = planScheduleSync(expected, [
      {
        sheetName: 'Harmonogram Wrzesień 2026',
        sheetRow: 2,
        key: expected[0]!.key,
        settled: false,
        bagCount: 5,
      },
    ]);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]!.row.bagCount).toBe(5);
    expect(plan.update[0]!.sheetName).toBe('Harmonogram Wrzesień 2026');
  });

  it('test_planScheduleSync_when_odebrane_bags_rise_should_increase_count', () => {
    const expected = buildScheduleSyncExpected(
      '15.09.2026',
      '16.09.2026',
      [...BAZA_CEN_HEADERS],
      [['31-342 Kraków Radzikowskiego 138', 'THOR', '', '50', '10', '', '', 'wt']],
      ODEBRANE_HEADERS,
      [
        odebraneRow({ 'Numer plomby': 'P1' }),
        odebraneRow({ 'Numer plomby': 'P2' }),
        odebraneRow({ 'Numer plomby': 'P3' }),
      ],
    );
    expect(expected[0]!.bagCount).toBe(3);
    const plan = planScheduleSync(expected, [
      {
        sheetName: 'Harmonogram Wrzesień 2026',
        sheetRow: 2,
        key: expected[0]!.key,
        settled: false,
        bagCount: 1,
      },
    ]);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]!.row.bagCount).toBe(3);
  });

  it('test_planScheduleSync_when_duplicate_keys_should_report_shadowed_rows', () => {
    const existing = [
      { sheetName: 'zestawienie z harmonogramu', sheetRow: 5, key: 'k', settled: false, bagCount: 1 },
      { sheetName: 'Harmonogram Wrzesień 2026', sheetRow: 2, key: 'k', settled: false, bagCount: 1 },
    ];
    const plan = planScheduleSync([], existing);
    expect(plan.duplicates).toEqual([existing[0]]);
  });
});

describe('sheetRateWriteValue', () => {
  it('test_sheetRateWriteValue_when_numeric_string_should_return_number', () => {
    expect(sheetRateWriteValue('175')).toBe(175);
    expect(sheetRateWriteValue('20,5')).toBe(20.5);
    expect(sheetRateWriteValue(' 40 ')).toBe(40);
    expect(sheetRateWriteValue(0)).toBe(0);
    expect(sheetRateWriteValue('0')).toBe(0);
  });

  it('test_sheetRateWriteValue_when_empty_should_stay_empty_string', () => {
    expect(sheetRateWriteValue('')).toBe('');
    expect(sheetRateWriteValue('   ')).toBe('');
    expect(sheetRateWriteValue(null)).toBe('');
    expect(sheetRateWriteValue(undefined)).toBe('');
  });
});

describe('zestawienieRowValues', () => {
  it('test_zestawienieRowValues_writes_rate_columns_as_numbers_not_text', () => {
    const values = zestawienieRowValues(
      {
        key: 'k',
        address: 'A',
        shopName: 'S',
        podmiot: 'P',
        contractor: 'THOR',
        pickupDate: '15.09.2026',
        bagCount: 2,
        rodzajZbiorki: 'ręczna',
        routeName: 'T1',
        routeRate: '100',
        pickupRate: '175',
        bagRate: '5',
      },
      [...ZESTAWIENIE_HARMONOGRAM_HEADERS],
    );
    const ixRoute = ZESTAWIENIE_HARMONOGRAM_HEADERS.indexOf('Stawka za trasę');
    const ixPickup = ZESTAWIENIE_HARMONOGRAM_HEADERS.indexOf('Stawka za podjazd');
    const ixBag = ZESTAWIENIE_HARMONOGRAM_HEADERS.indexOf('Stawka za worek');
    expect(values[ixRoute]).toBe(100);
    expect(values[ixPickup]).toBe(175);
    expect(values[ixBag]).toBe(5);
    expect(typeof values[ixPickup]).toBe('number');
  });
});

describe('defaultSyncWindow', () => {
  it('test_defaultSyncWindow_from_first_of_month', () => {
    expect(defaultSyncWindow(new Date(2026, 8, 28))).toEqual({
      dataOd: '01.09.2026',
      dataDo: '28.09.2026',
    });
  });

  it('test_defaultSyncWindow_first_of_month_reaches_back_a_week', () => {
    expect(defaultSyncWindow(new Date(2026, 9, 1))).toEqual({
      dataOd: '24.09.2026',
      dataDo: '01.10.2026',
    });
  });

  it('test_defaultSyncWindow_when_utc_evening_before_warsaw_midnight_should_use_warsaw_date', () => {
    expect(defaultSyncWindow(new Date('2026-09-30T22:30:00Z'))).toEqual({
      dataOd: '24.09.2026',
      dataDo: '01.10.2026',
    });
  });

  it('test_defaultSyncWindow_last_day_of_previous_month_is_ready_on_first', () => {
    const window = defaultSyncWindow(new Date(2026, 9, 1));
    const rows = buildScheduleSyncExpected(
      window.dataOd,
      window.dataDo,
      [...BAZA_CEN_HEADERS],
      [],
      ODEBRANE_HEADERS,
      [odebraneRow({ 'Data zamknięcia worka': '30.09.2026' })],
    );
    expect(rows.map((r) => r.pickupDate)).toEqual(['30.09.2026']);
  });

  it('test_defaultSyncWindow_when_run_after_day_7_should_keep_bag_closed_before_month', () => {
    const window = defaultSyncWindow(new Date('2026-11-09T12:00:00Z'));
    const rows = buildScheduleSyncExpected(
      window.dataOd,
      window.dataDo,
      [...BAZA_CEN_HEADERS],
      [['31-342 Kraków Radzikowskiego 138', 'THOR', '', '50', '10', '', '', 'pt']],
      ODEBRANE_HEADERS,
      [odebraneRow({ 'Data zamknięcia worka': '31.10.2026', 'Numer plomby': 'P1' })],
    );
    expect(rows.find((r) => r.pickupDate === '06.11.2026')?.bagCount).toBe(1);
    expect(rows.some((r) => r.pickupDate === '31.10.2026')).toBe(false);
  });

  it('test_defaultSyncWindow_when_january_after_holiday_fridays_should_put_december_bag_on_8_01', () => {
    const window = defaultSyncWindow(new Date('2027-01-09T12:00:00Z'));
    const rows = buildScheduleSyncExpected(
      window.dataOd,
      window.dataDo,
      [...BAZA_CEN_HEADERS],
      [['31-342 Kraków Radzikowskiego 138', 'THOR', '', '50', '10', '', '', 'pt']],
      ODEBRANE_HEADERS,
      [odebraneRow({ 'Data zamknięcia worka': '24.12.2026', 'Numer plomby': 'P1' })],
    );
    expect(rows.find((r) => r.pickupDate === '08.01.2027')?.bagCount).toBe(1);
    expect(rows.some((r) => r.pickupDate === '25.12.2026' || r.pickupDate === '01.01.2027')).toBe(false);
  });
});

const gasPath = join(dirname(fileURLToPath(import.meta.url)), '../google-apps-script/transport-log.gs');

function gasFunctionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) {
    throw new Error(`missing ${name}`);
  }
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  throw new Error(`unclosed ${name}`);
}

/** Okno ręcznego syncu ze skryptu arkusza, z podmienioną „dzisiejszą” datą. */
function sheetSyncWindow(nowIso: string): { dataOd: string; dataDo: string } {
  const source = readFileSync(gasPath, 'utf8');
  const code = [
    gasFunctionBody(source, 'settlementPad2_'),
    gasFunctionBody(source, 'settlementFormatDate_'),
    gasFunctionBody(source, 'scheduleSyncDefaultWindow_'),
  ].join('\n');
  const sandbox: { __api?: { dataOd: string; dataDo: string } } = {};
  runInNewContext(
    `var __fixed = ${JSON.stringify(nowIso)};
var __RealDate = Date;
Date = class extends __RealDate {
  constructor(...args) {
    if (args.length === 0) super(__fixed);
    else super(...args);
  }
};
${code}
__api = scheduleSyncDefaultWindow_();`,
    sandbox,
  );
  return sandbox.__api!;
}

describe('scheduleSyncDefaultWindow_ sheet script', () => {
  it('test_scheduleSyncDefaultWindow_when_first_of_month_should_reach_back_a_week', () => {
    expect(sheetSyncWindow('2026-11-01T12:00:00Z')).toEqual({
      dataOd: '25.10.2026',
      dataDo: '01.11.2026',
    });
  });

  it('test_scheduleSyncDefaultWindow_when_after_first_week_should_still_include_pre_month_close', () => {
    const window = sheetSyncWindow('2026-11-09T12:00:00Z');
    expect(compareDdMmYyyy(window.dataOd, '31.10.2026') <= 0).toBe(true);
    expect(window.dataDo).toBe('09.11.2026');
  });

  it('test_scheduleSyncDefaultWindow_when_9_january_should_include_bag_closed_before_christmas', () => {
    const window = sheetSyncWindow('2027-01-09T12:00:00Z');
    expect(compareDdMmYyyy(window.dataOd, '24.12.2026') <= 0).toBe(true);
    expect(window.dataDo).toBe('09.01.2027');
  });
});

function fakeSheetsApi(sheets: Map<string, string[][]>) {
  return {
    spreadsheets: {
      get: vi.fn(async () => ({
        data: {
          sheets: [...sheets.keys()].map((title, i) => ({
            properties: { title, sheetId: i + 1, gridProperties: { rowCount: 1000 } },
          })),
        },
      })),
      batchUpdate: vi.fn(async (args: {
        requestBody: {
          requests: Array<{
            addSheet?: { properties: { title: string } };
            moveDimension?: {
              source: { sheetId: number; startIndex: number; endIndex: number };
              destinationIndex: number;
            };
          }>;
        };
      }) => {
        for (const req of args.requestBody.requests) {
          if (req.addSheet?.properties.title) {
            sheets.set(req.addSheet.properties.title, []);
          }
          const move = req.moveDimension;
          if (move) {
            const title = [...sheets.keys()][move.source.sheetId - 1]!;
            const { startIndex, endIndex } = move.source;
            sheets.set(
              title,
              sheets.get(title)!.map((row) => {
                const r = [...row];
                while (r.length < endIndex) r.push('');
                const moved = r.splice(startIndex, endIndex - startIndex);
                r.splice(move.destinationIndex, 0, ...moved);
                return r;
              }),
            );
          }
        }
      }),
      values: {
        get: vi.fn(async (args: { range: string }) => {
          const title = [...sheets.keys()].find((name) => args.range.startsWith(`'${name}'`));
          return { data: { values: title ? sheets.get(title) : [] } };
        }),
        update: vi.fn(async (args: { range: string; requestBody: { values: string[][] } }) => {
          const title =
            [...sheets.keys()].find((name) => args.range.startsWith(`'${name}'`)) ??
            scheduleMonthSheetName('15.09.2026');
          const startRow = Number(/!A(\d+)$/.exec(args.range)?.[1] ?? '1');
          const current = [...(sheets.get(title) ?? [])];
          current.splice(startRow - 1, args.requestBody.values.length, ...args.requestBody.values);
          sheets.set(title, current);
        }),
        append: vi.fn(async (args: { range: string; requestBody: { values: string[][] } }) => {
          const title =
            [...sheets.keys()].find((name) => args.range.startsWith(`'${name}'`)) ??
            scheduleMonthSheetName('15.09.2026');
          const current = sheets.get(title) ?? [[...ZESTAWIENIE_HARMONOGRAM_HEADERS]];
          sheets.set(title, [...current, ...args.requestBody.values]);
        }),
        batchUpdate: vi.fn(async (_args: {
          requestBody: { data: Array<{ range: string; values: unknown[][] }> };
        }) => ({})),
        clear: vi.fn(),
      },
    },
  };
}

describe('filterExpandRequests', () => {
  it('test_filterExpandRequests_when_filter_shorter_than_data_should_keep_criteria', () => {
    const criteria = { '0': { hiddenValues: ['inny adres'] } };
    const requests = filterExpandRequests(
      4,
      2973,
      {
        range: { startRowIndex: 0, endRowIndex: 2944, startColumnIndex: 0, endColumnIndex: 11 },
        criteria,
      },
      [{ filterViewId: 9, title: 'adres', range: { startRowIndex: 0, endRowIndex: 2944, startColumnIndex: 0, endColumnIndex: 11 } }],
    );
    expect(requests).toEqual([
      {
        setBasicFilter: {
          filter: {
            range: { sheetId: 4, startRowIndex: 0, endRowIndex: 2973, startColumnIndex: 0, endColumnIndex: 11 },
            criteria,
          },
        },
      },
      {
        updateFilterView: {
          filter: {
            filterViewId: 9,
            range: { sheetId: 4, startRowIndex: 0, endRowIndex: 2973, startColumnIndex: 0, endColumnIndex: 11 },
          },
          fields: 'range',
        },
      },
    ]);
  });
});

describe('tableExpandRequests', () => {
  it('test_tableExpandRequests_when_table_shorter_than_data_should_extend_rows_only', () => {
    const requests = tableExpandRequests(
      [
        {
          sheetId: 7,
          title: 'Harmonogram Październik 2026',
          tables: [
            {
              tableId: 't-short',
              range: { startRowIndex: 0, endRowIndex: 589, startColumnIndex: 0, endColumnIndex: 11 },
            },
            {
              tableId: 't-side',
              range: { startRowIndex: 0, endRowIndex: 3, startColumnIndex: 2, endColumnIndex: 4 },
            },
            {
              tableId: 't-full',
              range: { startRowIndex: 0, endRowIndex: 3000, startColumnIndex: 0, endColumnIndex: 11 },
            },
          ],
        },
      ],
      new Map([['Harmonogram Październik 2026', 2946]]),
    );
    expect(requests).toEqual([
      {
        updateTable: {
          table: {
            tableId: 't-short',
            range: {
              sheetId: 7,
              startRowIndex: 0,
              endRowIndex: 2946,
              startColumnIndex: 0,
              endColumnIndex: 11,
            },
          },
          fields: 'range',
        },
      },
    ]);
  });
});

describe('syncZestawienieHarmonogram', () => {
  it('test_syncZestawienieHarmonogram_creates_sheet_and_appends_without_clear', async () => {
    const sheets = new Map<string, string[][]>();
    sheets.set('odebrane z harmonogramu', [ODEBRANE_HEADERS, odebraneRow(), odebraneRow({ 'Numer plomby': 'P2' })]);
    sheets.set('Baza cen harmonogram', [
      [...BAZA_CEN_HEADERS],
      ['31-342 Kraków Radzikowskiego 138', 'THOR', '', '50', '10', '', '', 'wt'],
    ]);
    const api = fakeSheetsApi(sheets);

    const result = await syncZestawienieHarmonogram(api, {
      spreadsheetId: 'ewid-id',
      dataOd: '15.09.2026',
      dataDo: '16.09.2026',
    });

    const monthSheet = scheduleMonthSheetName('15.09.2026');
    expect(monthSheet).toBe('Harmonogram Wrzesień 2026');
    expect(result.sheetCreated).toBe(true);
    expect(result.createdCount).toBe(1);
    expect(api.spreadsheets.values.clear).not.toHaveBeenCalled();
    expect(api.spreadsheets.values.append).toHaveBeenCalled();
    expect(result.tablesExpanded).toBe(0);
    expect(sheets.has(monthSheet)).toBe(true);
    const validationCalls = api.spreadsheets.batchUpdate.mock.calls.filter((c) =>
      JSON.stringify(c[0]).includes('setDataValidation'),
    );
    expect(validationCalls.length).toBeGreaterThan(0);
  });

  it('test_syncZestawienieHarmonogram_when_table_is_short_should_extend_it_over_new_rows', async () => {
    const sheets = new Map<string, string[][]>();
    sheets.set('odebrane z harmonogramu', [ODEBRANE_HEADERS, odebraneRow(), odebraneRow({ 'Numer plomby': 'P2' })]);
    sheets.set('Baza cen harmonogram', [
      [...BAZA_CEN_HEADERS],
      ['31-342 Kraków Radzikowskiego 138', 'THOR', '', '50', '10', '', '', 'wt'],
    ]);
    const api = fakeSheetsApi(sheets);
    const monthSheet = scheduleMonthSheetName('15.09.2026');
    const originalGet = api.spreadsheets.get.getMockImplementation()!;
    api.spreadsheets.get.mockImplementation(async () => {
      const base = await originalGet();
      const data = base.data as {
        sheets: Array<{ properties: { title: string }; tables?: unknown[] }>;
      };
      for (const sheet of data.sheets) {
        if (sheet.properties.title === monthSheet || sheet.properties.title === 'Baza cen harmonogram') {
          sheet.tables = [
            {
              tableId: sheet.properties.title === monthSheet ? 't-harmonogram' : 't-baza',
              range: { startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 11 },
            },
          ];
        }
      }
      return base;
    });

    const result = await syncZestawienieHarmonogram(api, {
      spreadsheetId: 'ewid-id',
      dataOd: '15.09.2026',
      dataDo: '16.09.2026',
    });

    expect(result.createdCount).toBe(1);
    expect(result.tablesExpanded).toBe(2);
    const updates = api.spreadsheets.batchUpdate.mock.calls
      .map((c) => c[0].requestBody.requests)
      .flat()
      .filter((req) => 'updateTable' in req) as Array<{
      updateTable: { table: { tableId: string; range: { endRowIndex: number; endColumnIndex: number } } };
    }>;
    expect(updates.map((req) => req.updateTable.table.tableId).sort()).toEqual(['t-baza', 't-harmonogram']);
    for (const req of updates) {
      expect(req.updateTable.table.range.endRowIndex).toBe(2);
      expect(req.updateTable.table.range.endColumnIndex).toBe(11);
    }
  });

  it('test_syncZestawienieHarmonogram_missing_rate_in_baza_keeps_manual_rates', async () => {
    const monthSheet = scheduleMonthSheetName('15.09.2026');
    const existing = ZESTAWIENIE_HARMONOGRAM_HEADERS.map((h) => {
      const byHeader: Record<string, string> = {
        'Adres odbioru': '31-342 Kraków Radzikowskiego 138',
        'Data odbioru': '15.09.2026',
        'Kto odbiera': 'THOR',
        'Ilość worków': '1',
        Trasa: 'THOR 1',
        'Stawka za trasę': '300',
        'Stawka za podjazd': '50',
        'Stawka za worek': '10',
      };
      return byHeader[h] ?? '';
    });
    const sheets = new Map<string, string[][]>();
    sheets.set('odebrane z harmonogramu', [ODEBRANE_HEADERS, odebraneRow(), odebraneRow({ 'Numer plomby': 'P2' })]);
    sheets.set('Baza cen harmonogram', [
      [...BAZA_CEN_HEADERS],
      ['31-342 Kraków Radzikowskiego 138', 'THOR', '', '', '', '', '', 'wt'],
    ]);
    sheets.set(monthSheet, [[...ZESTAWIENIE_HARMONOGRAM_HEADERS], existing]);
    const api = fakeSheetsApi(sheets);

    const result = await syncZestawienieHarmonogram(api, {
      spreadsheetId: 'ewid-id',
      dataOd: '15.09.2026',
      dataDo: '16.09.2026',
    });

    expect(result.updatedCount).toBe(1);
    const written = api.spreadsheets.values.batchUpdate.mock.calls.flatMap((c) => c[0].requestBody.data);
    const writtenColumns = written.map((d) => /!([A-Z]+)\d+$/.exec(d.range)?.[1]);
    const col = (name: string) => String.fromCharCode(65 + ZESTAWIENIE_HARMONOGRAM_HEADERS.indexOf(name as never));
    expect(writtenColumns).toContain(col('Ilość worków'));
    for (const name of ['Trasa', 'Stawka za trasę', 'Stawka za podjazd', 'Stawka za worek']) {
      expect(writtenColumns).not.toContain(col(name));
    }
  });

  it('test_syncZestawienieHarmonogram_when_row_moved_before_write_should_skip_update', async () => {
    const monthSheet = scheduleMonthSheetName('15.09.2026');
    const sheets = syncSourceSheets();
    sheets.set(monthSheet, [[...ZESTAWIENIE_HARMONOGRAM_HEADERS], registerRow()]);
    const api = fakeSheetsApi(sheets);
    const originalGet = api.spreadsheets.values.get.getMockImplementation()!;
    let monthReads = 0;
    api.spreadsheets.values.get.mockImplementation(async (args: { range: string }) => {
      if (args.range.startsWith(`'${monthSheet}'`) && ++monthReads === 2) {
        sheets.set(monthSheet, [
          [...ZESTAWIENIE_HARMONOGRAM_HEADERS],
          registerRow({ 'Adres odbioru': '30-045 Kraków Królewska 52' }),
          registerRow(),
        ]);
      }
      return originalGet(args);
    });

    const result = await syncZestawienieHarmonogram(api, {
      spreadsheetId: 'ewid-id',
      dataOd: '15.09.2026',
      dataDo: '16.09.2026',
    });

    expect(result.updatedCount).toBe(0);
    expect(result.skippedChanged).toBe(1);
    expect(api.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
  });

  it('test_syncZestawienieHarmonogram_when_row_settled_before_write_should_skip_update', async () => {
    const monthSheet = scheduleMonthSheetName('15.09.2026');
    const sheets = syncSourceSheets();
    sheets.set(monthSheet, [[...ZESTAWIENIE_HARMONOGRAM_HEADERS], registerRow()]);
    const api = fakeSheetsApi(sheets);
    const originalGet = api.spreadsheets.values.get.getMockImplementation()!;
    let monthReads = 0;
    api.spreadsheets.values.get.mockImplementation(async (args: { range: string }) => {
      if (args.range.startsWith(`'${monthSheet}'`) && ++monthReads === 2) {
        sheets.set(monthSheet, [[...ZESTAWIENIE_HARMONOGRAM_HEADERS], registerRow({ Rozliczony: 'tak' })]);
      }
      return originalGet(args);
    });

    const result = await syncZestawienieHarmonogram(api, {
      spreadsheetId: 'ewid-id',
      dataOd: '15.09.2026',
      dataDo: '16.09.2026',
    });

    expect(result.skippedChanged).toBe(1);
    expect(api.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
  });

  it('test_syncZestawienieHarmonogram_when_month_sheet_empty_should_write_header_before_append', async () => {
    const monthSheet = scheduleMonthSheetName('15.09.2026');
    const sheets = syncSourceSheets();
    sheets.set(monthSheet, []);
    const api = fakeSheetsApi(sheets);

    const result = await syncZestawienieHarmonogram(api, {
      spreadsheetId: 'ewid-id',
      dataOd: '15.09.2026',
      dataDo: '16.09.2026',
    });

    expect(result.createdCount).toBe(1);
    const values = sheets.get(monthSheet)!;
    expect(values[0]).toEqual([...ZESTAWIENIE_HARMONOGRAM_HEADERS]);
    expect(values).toHaveLength(2);
    expect(values[1]![0]).toBe('31-342 Kraków Radzikowskiego 138');
  });

  it('test_syncZestawienieHarmonogram_when_first_row_is_data_should_throw_without_writes', async () => {
    const monthSheet = scheduleMonthSheetName('15.09.2026');
    const sheets = syncSourceSheets();
    sheets.set(monthSheet, [registerRow({ 'Adres odbioru': '30-045 Kraków Królewska 52' })]);
    const api = fakeSheetsApi(sheets);

    await expect(
      syncZestawienieHarmonogram(api, {
        spreadsheetId: 'ewid-id',
        dataOd: '15.09.2026',
        dataDo: '16.09.2026',
      }),
    ).rejects.toThrow(/nagłówk/);
    expect(api.spreadsheets.values.append).not.toHaveBeenCalled();
    expect(api.spreadsheets.values.update).not.toHaveBeenCalled();
  });

  it('test_syncZestawienieHarmonogram_when_v2_layout_should_move_column_keeping_cell_values', async () => {
    const monthSheet = scheduleMonthSheetName('15.09.2026');
    const v2Headers = [
      ...ZESTAWIENIE_HARMONOGRAM_HEADERS.slice(0, 8),
      ...ZESTAWIENIE_HARMONOGRAM_HEADERS.slice(9, 17),
      'transport się odbył',
      ...ZESTAWIENIE_HARMONOGRAM_HEADERS.slice(17),
    ];
    const v2Row: unknown[] = v2Headers.map(() => '');
    v2Row[0] = '30-045 Kraków Królewska 52';
    v2Row[3] = '10.09.2026';
    v2Row[4] = 'THOR';
    v2Row[7] = 3;
    v2Row[10] = 175;
    v2Row[16] = 'nie';
    const sheets = syncSourceSheets();
    sheets.set(monthSheet, [v2Headers, v2Row as string[]]);
    const api = fakeSheetsApi(sheets);

    await syncZestawienieHarmonogram(api, {
      spreadsheetId: 'ewid-id',
      dataOd: '15.09.2026',
      dataDo: '16.09.2026',
    });

    const moves = api.spreadsheets.batchUpdate.mock.calls.filter((c) =>
      JSON.stringify(c[0]).includes('moveDimension'),
    );
    expect(moves).toHaveLength(1);
    const values = sheets.get(monthSheet)!;
    expect(values[0]!.slice(0, 19)).toEqual([...ZESTAWIENIE_HARMONOGRAM_HEADERS]);
    const ix = (name: string) => ZESTAWIENIE_HARMONOGRAM_HEADERS.indexOf(name as never);
    expect(values[1]![ix('transport się odbył')]).toBe('nie');
    expect(values[1]![ix('Stawka za podjazd')]).toBe(175);
    expect(values[1]![ix('Ilość worków')]).toBe(3);
  });

  it('test_syncZestawienieHarmonogram_when_off_schedule_rows_should_move_bags_and_delete_rows', async () => {
    const monthSheet = 'Harmonogram Październik 2026';
    const sheets = new Map<string, string[][]>();
    sheets.set('odebrane z harmonogramu', [ODEBRANE_HEADERS]);
    sheets.set('Baza cen harmonogram', [
      [...BAZA_CEN_HEADERS],
      ['38-242 Skołyszyn Skołyszyn 11B', 'Zagroda', 'Z1', '50', '10', '', '', 'pt'],
    ]);
    sheets.set(monthSheet, [
      [...ZESTAWIENIE_HARMONOGRAM_HEADERS],
      registerRow({
        'Adres odbioru': SKOLYSZYN,
        'Data odbioru': '02.10.2026',
        'Kto odbiera': 'Zagroda',
        'Ilość worków': '0',
        'Rodzaj zbiórki': 'brak worków',
      }),
      registerRow({
        'Adres odbioru': SKOLYSZYN,
        'Data odbioru': '03.10.2026',
        'Kto odbiera': 'Zagroda',
        'Ilość worków': '4',
        'Rodzaj zbiórki': 'ręczna',
      }),
      registerRow({
        'Adres odbioru': SKOLYSZYN,
        'Data odbioru': '09.10.2026',
        'Kto odbiera': 'Zagroda',
        'Ilość worków': '1',
        'Rodzaj zbiórki': 'automatyczna',
      }),
    ]);
    const api = fakeSheetsApi(sheets);

    const result = await syncZestawienieHarmonogram(api, {
      spreadsheetId: 'ewid-id',
      dataOd: '01.10.2026',
      dataDo: '10.10.2026',
    });

    expect(result.removedCount).toBe(1);
    const bagWrites = api.spreadsheets.values.batchUpdate.mock.calls.flatMap(
      (call) => call[0].requestBody.data as Array<{ range: string; values: unknown[][] }>,
    );
    const fridayBags = bagWrites.find((item) => item.range === `'${monthSheet}'!H4`);
    expect(fridayBags?.values).toEqual([[5]]);
    const deletes = api.spreadsheets.batchUpdate.mock.calls.flatMap(
      (call) =>
        (call[0].requestBody.requests as Array<{ deleteDimension?: { range: { startIndex: number } } }>) ??
        [],
    );
    expect(deletes.some((request) => request.deleteDimension?.range.startIndex === 2)).toBe(true);
  });
});

function syncSourceSheets(): Map<string, string[][]> {
  const sheets = new Map<string, string[][]>();
  sheets.set('odebrane z harmonogramu', [ODEBRANE_HEADERS, odebraneRow()]);
  sheets.set('Baza cen harmonogram', [
    [...BAZA_CEN_HEADERS],
    ['31-342 Kraków Radzikowskiego 138', 'THOR', 'T1', '50', '10', '100', '', 'wt'],
  ]);
  return sheets;
}

function registerRow(overrides: Record<string, string> = {}): string[] {
  const byHeader: Record<string, string> = {
    'Adres odbioru': '31-342 Kraków Radzikowskiego 138',
    'Data odbioru': '15.09.2026',
    'Kto odbiera': 'THOR',
    'Ilość worków': '1',
    ...overrides,
  };
  return ZESTAWIENIE_HARMONOGRAM_HEADERS.map((h) => byHeader[h] ?? '');
}
