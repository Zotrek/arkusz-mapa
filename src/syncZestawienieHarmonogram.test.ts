import { describe, expect, it, vi } from 'vitest';
import { BAZA_CEN_HEADERS } from './bazaCenHarmonogram.js';
import {
  buildScheduleSyncExpected,
  defaultSyncWindow,
  planScheduleSync,
  scheduleMonthSheetName,
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
    expect(sheets.has(monthSheet)).toBe(true);
    const validationCalls = api.spreadsheets.batchUpdate.mock.calls.filter((c) =>
      JSON.stringify(c[0]).includes('setDataValidation'),
    );
    expect(validationCalls.length).toBeGreaterThan(0);
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
