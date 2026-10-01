import { describe, expect, it, vi } from 'vitest';
import { BAZA_CEN_HEADERS } from './bazaCenHarmonogram.js';
import { SHEET_NAME_ZESTAWIENIE_HARMONOGRAM } from './config.js';
import {
  buildScheduleSyncExpected,
  defaultSyncWindow,
  planScheduleSync,
  sheetRateWriteValue,
  syncZestawienieHarmonogram,
  zestawienieRowValues,
  ZESTAWIENIE_HARMONOGRAM_HEADERS,
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
    expect(rows.every((r) => r.rodzajZbiorki === '')).toBe(true);
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
      { sheetRow: 2, key: expected[0]!.key, settled: true, bagCount: 1 },
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
      { sheetRow: 2, key: expected[0]!.key, settled: false, bagCount: 5 },
    ]);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]!.row.bagCount).toBe(5);
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
      { sheetRow: 2, key: expected[0]!.key, settled: false, bagCount: 1 },
    ]);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]!.row.bagCount).toBe(3);
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
});

describe('syncZestawienieHarmonogram', () => {
  it('test_syncZestawienieHarmonogram_creates_sheet_and_appends_without_clear', async () => {
    const sheets = new Map<string, string[][]>();
    sheets.set('odebrane z harmonogramu', [ODEBRANE_HEADERS, odebraneRow(), odebraneRow({ 'Numer plomby': 'P2' })]);
    sheets.set('Baza cen harmonogram', [
      [...BAZA_CEN_HEADERS],
      ['31-342 Kraków Radzikowskiego 138', 'THOR', '', '50', '10', '', '', 'wt'],
    ]);

    const api = {
      spreadsheets: {
        get: vi.fn(async () => ({
          data: {
            sheets: [...sheets.keys()].map((title, i) => ({
              properties: { title, sheetId: i + 1, gridProperties: { rowCount: 1000 } },
            })),
          },
        })),
        batchUpdate: vi.fn(async (args: {
          requestBody: { requests: Array<{ addSheet?: { properties: { title: string } } }> };
        }) => {
          for (const req of args.requestBody.requests) {
            if (req.addSheet?.properties.title) {
              sheets.set(req.addSheet.properties.title, []);
            }
          }
        }),
        values: {
          get: vi.fn(async (args: { range: string }) => {
            const title = [...sheets.keys()].find((name) => args.range.startsWith(`'${name}'`));
            return { data: { values: title ? sheets.get(title) : [] } };
          }),
          update: vi.fn(async (args: { requestBody: { values: string[][] } }) => {
            sheets.set(SHEET_NAME_ZESTAWIENIE_HARMONOGRAM, args.requestBody.values);
          }),
          append: vi.fn(async (args: { requestBody: { values: string[][] } }) => {
            const current = sheets.get(SHEET_NAME_ZESTAWIENIE_HARMONOGRAM) ?? [
              [...ZESTAWIENIE_HARMONOGRAM_HEADERS],
            ];
            sheets.set(SHEET_NAME_ZESTAWIENIE_HARMONOGRAM, [...current, ...args.requestBody.values]);
          }),
          batchUpdate: vi.fn(async () => ({})),
          clear: vi.fn(),
        },
      },
    };

    const result = await syncZestawienieHarmonogram(api, {
      spreadsheetId: 'ewid-id',
      dataOd: '15.09.2026',
      dataDo: '16.09.2026',
    });

    expect(result.sheetCreated).toBe(true);
    expect(result.createdCount).toBe(1);
    expect(api.spreadsheets.values.clear).not.toHaveBeenCalled();
    expect(api.spreadsheets.values.append).toHaveBeenCalled();
    const validationCalls = api.spreadsheets.batchUpdate.mock.calls.filter((c) =>
      JSON.stringify(c[0]).includes('setDataValidation'),
    );
    expect(validationCalls.length).toBeGreaterThan(0);
  });
});
