import { describe, expect, it, vi } from 'vitest';
import { BAZA_CEN_HEADERS } from './bazaCenHarmonogram.js';
import { SHEET_NAME_ZESTAWIENIE_HARMONOGRAM } from './config.js';
import {
  buildScheduleSyncExpected,
  defaultSyncWindow,
  planScheduleSync,
  syncZestawienieHarmonogram,
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

  it('test_buildScheduleSyncExpected_aggregates_rodzaj_from_tryb_zbiorki', () => {
    const rows = buildScheduleSyncExpected(
      '15.09.2026',
      '15.09.2026',
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
});

describe('planScheduleSync', () => {
  it('test_planScheduleSync_skips_settled_never_deletes', () => {
    const expected = buildScheduleSyncExpected(
      '15.09.2026',
      '15.09.2026',
      [...BAZA_CEN_HEADERS],
      [['31-342 Kraków Radzikowskiego 138', 'THOR', '', '50', '10', '', '', 'wt']],
      ODEBRANE_HEADERS,
      [odebraneRow()],
    );
    const plan = planScheduleSync(expected, [
      { sheetRow: 2, key: expected[0]!.key, settled: true },
    ]);
    expect(plan.skippedSettled).toBe(1);
    expect(plan.create).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
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
      dataDo: '15.09.2026',
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
