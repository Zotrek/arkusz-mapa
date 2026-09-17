import { describe, expect, it, vi } from 'vitest';
import { SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU } from './config.js';
import {
  dedupeCandidatesBySeal,
  executeOdebraneZHarmonogramu,
  filterRowsForOdebraneZHarmonogramu,
  findNumerPlombyColumnIndex,
  remapRawRowToTargetHeaders,
} from './odebraneZHarmonogramu.js';
import type { SheetRow } from './sheets.js';
import { DEFAULT_SHEET_COLUMN_MAP } from './config.js';

/** Nagłówki trasówek (kolejność źródłowa). */
const SOURCE_HEADERS = [
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
  'Waga',
  'Frakcja',
  'Typ worka',
  'Wg harmonogramu',
  'Dni harmonogramu',
  'Firma transportowa',
];

/** Nagłówki ewidencji (inna kolejność + skrócone nazwy). */
const EWIDENCJA_HEADERS = [
  'NIP',
  'Podmiot handlowy',
  'Sklep',
  'Wg harmonogramu',
  'Dni harmonogramu',
  'Firma transportowa',
  'Kod pocztowy',
  'Miasto',
  'Ulica',
  'Numer budynku',
  'Gmina',
  'Województwo',
  'Numer plomby',
  'Stan worka',
  'Status TMS',
  'Data zamknięcia',
  'Tryb zbiórki',
  'Waga',
];

function makeSourceRaw(overrides: Record<string, string> = {}): string[] {
  const byHeader: Record<string, string> = {
    NIP: '6762115928',
    'Podmiot handlowy': 'AD-SYSTEM',
    Sklep: 'CHS',
    'Kod pocztowy': '32-100',
    Miasto: 'Proszowice',
    Ulica: '3 Maja',
    'Numer budynku': '10',
    Gmina: 'Proszowice',
    Województwo: 'małopolskie',
    'Numer plomby': 'P-100',
    'Status worka': 'Zamknięty',
    'Status TMS worka': 'OK',
    'Data zamknięcia worka': '07.08.2026',
    'Tryb zbiórki': 'Maszyna',
    Waga: '12',
    Frakcja: '',
    'Typ worka': '',
    'Wg harmonogramu': 'Tak',
    'Dni harmonogramu': 'pn, wt',
    'Firma transportowa': 'Interzero',
    ...overrides,
  };
  return SOURCE_HEADERS.map((h) => byHeader[h] ?? '');
}

function makeRow(overrides: Partial<SheetRow> = {}): SheetRow {
  const numerPlomby = overrides.numerPlomby ?? 'P1';
  const raw = overrides.raw ?? makeSourceRaw({ 'Numer plomby': numerPlomby });
  return {
    sourceRowIndex: overrides.sourceRowIndex ?? 2,
    podmiotHandlowy: overrides.podmiotHandlowy ?? 'PH',
    sklep: overrides.sklep ?? 'S',
    kodPocztowy: overrides.kodPocztowy ?? '62-320',
    miasto: overrides.miasto ?? 'Miłosław',
    ulica: overrides.ulica ?? 'Leśna',
    ulicaRaw: overrides.ulicaRaw ?? 'Leśna',
    numerBudynku: overrides.numerBudynku ?? '1',
    gmina: overrides.gmina ?? '',
    numerPlomby,
    dataZamknieciaWorka: overrides.dataZamknieciaWorka ?? '07.08.2026',
    zbiorka: overrides.zbiorka ?? 'Maszyna',
    wgHarmonogramu: overrides.wgHarmonogramu ?? 'tak',
    dniHarmonogramu: overrides.dniHarmonogramu ?? 'pn',
    firmaTransportowa: overrides.firmaTransportowa ?? '',
    raw,
    address: overrides.address ?? '62-320 Miłosław Leśna 1',
  };
}

describe('odebraneZHarmonogramu', () => {
  const todayUtc = Date.UTC(2026, 7, 12);

  it('test_filterRowsForOdebraneZHarmonogramu_when_eligible_should_include', () => {
    const rows = [
      makeRow({ numerPlomby: 'OK' }),
      makeRow({ numerPlomby: 'NO', dataZamknieciaWorka: '10.08.2026' }),
      makeRow({ numerPlomby: 'REC', zbiorka: 'Ręczna' }),
    ];
    const out = filterRowsForOdebraneZHarmonogramu(rows, todayUtc);
    expect(out.map((r) => r.numerPlomby)).toEqual(['OK']);
  });

  it('test_findNumerPlombyColumnIndex_when_ewidencja_headers_should_use_column_m', () => {
    expect(findNumerPlombyColumnIndex(EWIDENCJA_HEADERS)).toBe(12);
  });

  it('test_dedupeCandidatesBySeal_when_duplicate_seals_should_keep_first', () => {
    const { unique, skippedDuplicateCount } = dedupeCandidatesBySeal([
      makeRow({ numerPlomby: 'A' }),
      makeRow({ numerPlomby: 'A' }),
      makeRow({ numerPlomby: 'B' }),
      makeRow({ numerPlomby: '' }),
    ]);
    expect(unique.map((r) => r.numerPlomby)).toEqual(['A', 'B']);
    expect(skippedDuplicateCount).toBe(2);
  });

  it('test_remapRawRowToTargetHeaders_when_ewidencja_order_should_fill_address_and_seal', () => {
    const sourceRaw = makeSourceRaw({ 'Numer plomby': 'SEAL-9' });
    const mapped = remapRawRowToTargetHeaders(SOURCE_HEADERS, sourceRaw, EWIDENCJA_HEADERS);

    expect(mapped[0]).toBe('6762115928');
    expect(mapped[3]).toBe('Tak');
    expect(mapped[6]).toBe('32-100');
    expect(mapped[7]).toBe('Proszowice');
    expect(mapped[12]).toBe('SEAL-9');
    expect(mapped[13]).toBe('Zamknięty');
  });

  it('test_executeOdebrane_when_no_candidates_and_no_sheet_should_noop', async () => {
    const getMock = vi.fn().mockResolvedValue({
      data: { sheets: [{ properties: { title: 'Arkusz1' } }] },
    });
    const clearMock = vi.fn();
    const updateMock = vi.fn();
    const api = {
      spreadsheets: {
        get: getMock,
        batchUpdate: vi.fn(),
        values: { get: vi.fn(), clear: clearMock, update: updateMock, append: vi.fn() },
      },
    };

    const result = await executeOdebraneZHarmonogramu(api, {
      targetSpreadsheetId: 'id',
      headers: SOURCE_HEADERS,
      rows: [makeRow({ zbiorka: 'Ręczna' })],
      columnMap: { ...DEFAULT_SHEET_COLUMN_MAP },
      todayUtc,
    });

    expect(result.appendedCount).toBe(0);
    expect(result.sheetCleared).toBe(false);
    expect(clearMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('test_executeOdebrane_when_new_sheet_should_create_and_overwrite', async () => {
    const getMock = vi.fn().mockResolvedValue({
      data: { sheets: [{ properties: { title: 'Arkusz1' } }] },
    });
    const batchUpdateMock = vi.fn().mockResolvedValue({});
    const clearMock = vi.fn().mockResolvedValue({});
    const updateMock = vi.fn().mockResolvedValue({});
    const api = {
      spreadsheets: {
        get: getMock,
        batchUpdate: batchUpdateMock,
        values: { get: vi.fn(), clear: clearMock, update: updateMock, append: vi.fn() },
      },
    };

    const row = makeRow({ numerPlomby: 'NEW1', raw: makeSourceRaw({ 'Numer plomby': 'NEW1' }) });
    const result = await executeOdebraneZHarmonogramu(api, {
      targetSpreadsheetId: 'ewidencja-id',
      headers: SOURCE_HEADERS,
      rows: [row],
      columnMap: { ...DEFAULT_SHEET_COLUMN_MAP },
      todayUtc,
    });

    expect(result.sheetCreated).toBe(true);
    expect(result.sheetCleared).toBe(true);
    expect(result.appendedCount).toBe(1);
    expect(batchUpdateMock).toHaveBeenCalled();
    expect(clearMock).toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: 'ewidencja-id',
        range: `'${SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU}'!A1`,
        requestBody: {
          values: [SOURCE_HEADERS, makeSourceRaw({ 'Numer plomby': 'NEW1' })],
        },
      }),
    );
  });

  it('test_executeOdebrane_when_existing_sheet_should_clear_and_rewrite_all_remapped', async () => {
    const getMock = vi.fn().mockResolvedValue({
      data: {
        sheets: [
          { properties: { title: 'Arkusz1' } },
          { properties: { title: SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU } },
        ],
      },
    });
    const clearMock = vi.fn().mockResolvedValue({});
    const updateMock = vi.fn().mockResolvedValue({});
    const valuesGetMock = vi.fn().mockResolvedValue({
      data: { values: [EWIDENCJA_HEADERS] },
    });
    const api = {
      spreadsheets: {
        get: getMock,
        batchUpdate: vi.fn(),
        values: { get: valuesGetMock, clear: clearMock, update: updateMock, append: vi.fn() },
      },
    };

    const result = await executeOdebraneZHarmonogramu(api, {
      targetSpreadsheetId: 'ewidencja-id',
      headers: SOURCE_HEADERS,
      rows: [
        makeRow({ numerPlomby: 'EXIST', raw: makeSourceRaw({ 'Numer plomby': 'EXIST' }) }),
        makeRow({ numerPlomby: 'NEW2', raw: makeSourceRaw({ 'Numer plomby': 'NEW2' }) }),
      ],
      columnMap: { ...DEFAULT_SHEET_COLUMN_MAP },
      todayUtc,
    });

    expect(result.appendedCount).toBe(2);
    expect(result.skippedExistingCount).toBe(0);
    expect(result.sheetCleared).toBe(true);
    expect(clearMock).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: 'ewidencja-id',
        range: `'${SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU}'!A:Z`,
      }),
    );

    const expected = [
      remapRawRowToTargetHeaders(SOURCE_HEADERS, makeSourceRaw({ 'Numer plomby': 'EXIST' }), EWIDENCJA_HEADERS),
      remapRawRowToTargetHeaders(SOURCE_HEADERS, makeSourceRaw({ 'Numer plomby': 'NEW2' }), EWIDENCJA_HEADERS),
    ];
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: { values: [EWIDENCJA_HEADERS, ...expected] },
      }),
    );
  });

  it('test_executeOdebrane_when_no_candidates_but_sheet_exists_should_clear_to_headers_only', async () => {
    const getMock = vi.fn().mockResolvedValue({
      data: {
        sheets: [{ properties: { title: SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU } }],
      },
    });
    const clearMock = vi.fn().mockResolvedValue({});
    const updateMock = vi.fn().mockResolvedValue({});
    const valuesGetMock = vi.fn().mockResolvedValue({
      data: { values: [EWIDENCJA_HEADERS, ['old']] },
    });
    const api = {
      spreadsheets: {
        get: getMock,
        batchUpdate: vi.fn(),
        values: { get: valuesGetMock, clear: clearMock, update: updateMock, append: vi.fn() },
      },
    };

    const result = await executeOdebraneZHarmonogramu(api, {
      targetSpreadsheetId: 'ewidencja-id',
      headers: SOURCE_HEADERS,
      rows: [makeRow({ zbiorka: 'Ręczna' })],
      columnMap: { ...DEFAULT_SHEET_COLUMN_MAP },
      todayUtc,
    });

    expect(result.appendedCount).toBe(0);
    expect(result.sheetCleared).toBe(true);
    expect(clearMock).toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: { values: [EWIDENCJA_HEADERS] },
      }),
    );
  });
});
