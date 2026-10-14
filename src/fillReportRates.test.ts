import { describe, expect, it, vi } from 'vitest';
import { RATE_HEADERS, RATE_SHEET_NAME } from './saveRate.js';
import {
  fillMissingReportRates,
  LEGACY_REPORT_SHEET_NAME,
  parseReportRateRows,
  planReportRateFills,
  reportRateDateKey,
  reportRegisterSheetNamesFromTitles,
  resolveReportRateSnapshot,
  type ReportRateRow,
  type ReportRegisterSheet,
} from './fillReportRates.js';

const REPORT_HEADERS = [
  'Numer transportowy',
  'Adres sklepu',
  'Podmiot handlowy',
  'Sklep',
  'Data odbioru',
  'Kto odbiera',
  'Miejsce zrzutu',
  'Rodzaj zbiórki',
  'Ilość worków',
  'transport się odbył',
  'Trasa',
  'Stawka za trasę',
  'Stawka za podjazd',
  'Stawka za worek',
  'Rozliczony',
  'Numer faktury',
  'Koszt odbioru',
  'Koszt odbioru per worek',
  'Komentarz 1',
  'Komentarz 2',
];

function reportRow(overrides: Record<string, string | number> = {}): Array<string | number> {
  const byHeader: Record<string, string | number> = {
    'Numer transportowy': '15',
    'Adres sklepu': '51-602 Wrocław Kochanowskiego 33',
    'Data odbioru': '02.10.2026',
    'Kto odbiera': 'Interzero',
    'Stawka za podjazd': '',
    'Stawka za worek': '',
    Rozliczony: '',
    ...overrides,
  };
  return REPORT_HEADERS.map((header) => byHeader[header] ?? '');
}

function rate(overrides: Partial<ReportRateRow> = {}): ReportRateRow {
  return {
    shop: '51-602 Wrocław Kochanowskiego 33',
    contractor: 'Interzero',
    pickup: 80,
    bag: 12,
    validFrom: '01.10.2026',
    ...overrides,
  };
}

describe('resolveReportRateSnapshot', () => {
  it('test_resolveReportRateSnapshot_when_al_prefix_should_match_canonical_address', () => {
    const snap = resolveReportRateSnapshot(
      [rate({ shop: '51-602 Wrocław al. Kochanowskiego 33' })],
      '51-602 Wrocław Kochanowskiego 33',
      'Interzero',
      '02.10.2026',
    );
    expect(snap).toEqual({ pickup: 80, bag: 12 });
  });

  it('test_resolveReportRateSnapshot_when_later_date_should_win', () => {
    const snap = resolveReportRateSnapshot(
      [rate({ pickup: 10, bag: 1, validFrom: '' }), rate({ pickup: 80, bag: 12, validFrom: '01.09.2026' })],
      '51-602 Wrocław Kochanowskiego 33',
      'Interzero',
      '02.10.2026',
    );
    expect(snap).toEqual({ pickup: 80, bag: 12 });
  });

  it('test_resolveReportRateSnapshot_when_same_valid_from_should_stay_empty', () => {
    const snap = resolveReportRateSnapshot(
      [rate({ pickup: 80 }), rate({ pickup: 90, bag: 15 })],
      '51-602 Wrocław Kochanowskiego 33',
      'Interzero',
      '02.10.2026',
    );
    expect(snap).toEqual({ pickup: '', bag: '' });
  });

  it('test_resolveReportRateSnapshot_when_rate_starts_after_pickup_should_skip_it', () => {
    const snap = resolveReportRateSnapshot(
      [rate({ validFrom: '15.10.2026' })],
      '51-602 Wrocław Kochanowskiego 33',
      'Interzero',
      '02.10.2026',
    );
    expect(snap).toEqual({ pickup: '', bag: '' });
  });

  it('test_resolveReportRateSnapshot_when_contractor_differs_should_stay_empty', () => {
    const snap = resolveReportRateSnapshot(
      [rate()],
      '51-602 Wrocław Kochanowskiego 33',
      'Inna firma',
      '02.10.2026',
    );
    expect(snap).toEqual({ pickup: '', bag: '' });
  });

  it('test_reportRateDateKey_when_sheet_serial_should_return_dd_mm_yyyy', () => {
    expect(reportRateDateKey(46296)).toBe('01.10.2026');
  });
});

describe('planReportRateFills', () => {
  const sheet = 'Na zgłoszenie Październik 2026';

  function register(rows: unknown[][]): ReportRegisterSheet {
    return { sheetName: sheet, headers: REPORT_HEADERS, rows };
  }

  it('test_planReportRateFills_when_both_empty_should_fill_pickup_and_bag', () => {
    const fills = planReportRateFills([rate()], [register([reportRow()])]);
    expect(fills).toEqual([
      { sheetName: sheet, sheetRow: 2, columnIndex: 12, value: 80 },
      { sheetName: sheet, sheetRow: 2, columnIndex: 13, value: 12 },
    ]);
  });

  it('test_planReportRateFills_when_settled_should_skip_row', () => {
    const fills = planReportRateFills([rate()], [register([reportRow({ Rozliczony: 'tak' })])]);
    expect(fills).toEqual([]);
  });

  it('test_planReportRateFills_when_pickup_present_should_fill_only_bag', () => {
    const fills = planReportRateFills([rate()], [register([reportRow({ 'Stawka za podjazd': 40 })])]);
    expect(fills).toEqual([{ sheetName: sheet, sheetRow: 2, columnIndex: 13, value: 12 }]);
  });

  it('test_planReportRateFills_when_zero_rate_should_write_zero', () => {
    const fills = planReportRateFills(
      [rate({ pickup: 0, bag: 0 })],
      [register([reportRow()])],
    );
    expect(fills).toEqual([
      { sheetName: sheet, sheetRow: 2, columnIndex: 12, value: 0 },
      { sheetName: sheet, sheetRow: 2, columnIndex: 13, value: 0 },
    ]);
  });

  it('test_planReportRateFills_when_tie_should_leave_cells_empty', () => {
    const fills = planReportRateFills([rate(), rate({ pickup: 1 })], [register([reportRow()])]);
    expect(fills).toEqual([]);
  });
});

describe('reportRegisterSheetNamesFromTitles', () => {
  it('test_reportRegisterSheetNamesFromTitles_when_mixed_titles_should_keep_report_only', () => {
    expect(
      reportRegisterSheetNamesFromTitles([
        'Harmonogram Październik 2026',
        LEGACY_REPORT_SHEET_NAME,
        'Na zgłoszenie Październik 2026',
        'Baza stawek',
        'odebrane z harmonogramu',
      ]),
    ).toEqual([LEGACY_REPORT_SHEET_NAME, 'Na zgłoszenie Październik 2026']);
  });
});

describe('parseReportRateRows', () => {
  it('test_parseReportRateRows_when_blank_valid_from_should_apply_from_always', () => {
    const rows = parseReportRateRows([...RATE_HEADERS], [
      ['51-602 Wrocław Kochanowskiego 33', 'Interzero', 80, 12, ''],
    ]);
    expect(rows).toEqual([
      {
        shop: '51-602 Wrocław Kochanowskiego 33',
        contractor: 'Interzero',
        pickup: 80,
        bag: 12,
        validFrom: '',
      },
    ]);
  });
});

describe('parseReportRateRows live headers', () => {
  it('test_parseReportRateRows_when_cena_headers_should_read_address_and_bag', () => {
    const rows = parseReportRateRows(
      ['Adres sklepu', 'Podwykonawca', 'Cena za podjazd', 'Cena za worek', 'Od kiedy obowiązuje cena'],
      [['51-602 Wrocław Kochanowskiego 33', 'Interzero', '', '18,5', '']],
    );
    expect(rows).toEqual([
      {
        shop: '51-602 Wrocław Kochanowskiego 33',
        contractor: 'Interzero',
        pickup: '',
        bag: '18,5',
        validFrom: '',
      },
    ]);
  });

  it('test_planReportRateFills_when_cena_headers_should_fill_only_present_bag_rate', () => {
    const rates = parseReportRateRows(
      ['Adres sklepu', 'Podwykonawca', 'Cena za podjazd', 'Cena za worek', 'Od kiedy obowiązuje cena'],
      [['51-602 Wrocław al. Kochanowskiego 33', 'Interzero', '', '18,5', '']],
    );
    const fills = planReportRateFills(rates, [
      {
        sheetName: 'Na zgłoszenie Październik 2026',
        headers: REPORT_HEADERS,
        rows: [reportRow()],
      },
    ]);
    expect(fills).toEqual([
      { sheetName: 'Na zgłoszenie Październik 2026', sheetRow: 2, columnIndex: 13, value: 18.5 },
    ]);
  });
});

describe('fillMissingReportRates', () => {
  it('test_fillMissingReportRates_when_rate_added_later_should_write_empty_cells', async () => {
    const month = 'Na zgłoszenie Październik 2026';
    const sheets: Record<string, unknown[][]> = {
      [RATE_SHEET_NAME]: [[...RATE_HEADERS], ['51-602 Wrocław al. Kochanowskiego 33', 'Interzero', 80, 12, '01.10.2026']],
      [month]: [REPORT_HEADERS, reportRow()],
      'Harmonogram Październik 2026': [['Adres odbioru']],
    };
    const written: Array<{ range?: string; values?: unknown[][] }> = [];
    const api = {
      spreadsheets: {
        get: vi.fn(async () => ({
          data: {
            sheets: Object.keys(sheets).map((title) => ({ properties: { title } })),
          },
        })),
        values: {
          get: vi.fn(async ({ range }: { range: string }) => {
            const raw = range.split('!')[0] ?? '';
            const name = raw.startsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : raw;
            return { data: { values: sheets[name] ?? [] } };
          }),
          batchUpdate: vi.fn(async (args: { requestBody: { data: typeof written } }) => {
            written.push(...args.requestBody.data);
          }),
        },
      },
    };
    const logger = { info: vi.fn() };
    const result = await fillMissingReportRates(api, { spreadsheetId: 'ewidencja' }, logger);
    expect(result.filledCells).toBe(2);
    expect(written).toEqual([
      { range: `'${month}'!M2`, values: [[80]] },
      { range: `'${month}'!N2`, values: [[12]] },
    ]);
    expect(logger.info).toHaveBeenCalledWith('Na zgłoszenie: uzupełniono %d pustych stawek', 2);
  });

  it('test_fillMissingReportRates_when_rate_sheet_missing_should_write_nothing', async () => {
    const api = {
      spreadsheets: {
        get: vi.fn(async () => ({
          data: { sheets: [{ properties: { title: 'Na zgłoszenie Październik 2026' } }] },
        })),
        values: {
          get: vi.fn(),
          batchUpdate: vi.fn(),
        },
      },
    };
    const result = await fillMissingReportRates(api, { spreadsheetId: 'ewidencja' }, { info: vi.fn() });
    expect(result).toEqual({ filledCells: 0, skippedSheets: 0 });
    expect(api.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
  });
});
