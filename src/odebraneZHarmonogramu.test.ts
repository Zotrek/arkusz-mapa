import { describe, expect, it, vi } from 'vitest';
import { SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU } from './config.js';
import {
  executeOdebraneZHarmonogramu,
  filterRowsForOdebraneZHarmonogramu,
} from './odebraneZHarmonogramu.js';
import type { SheetRow } from './sheets.js';
import { DEFAULT_SHEET_COLUMN_MAP } from './config.js';

function makeRow(overrides: Partial<SheetRow> = {}): SheetRow {
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
    numerPlomby: overrides.numerPlomby ?? 'P1',
    dataZamknieciaWorka: overrides.dataZamknieciaWorka ?? '07.08.2026',
    zbiorka: overrides.zbiorka ?? 'Maszyna',
    wgHarmonogramu: overrides.wgHarmonogramu ?? 'tak',
    dniHarmonogramu: overrides.dniHarmonogramu ?? 'pn',
    firmaTransportowa: overrides.firmaTransportowa ?? '',
    raw: overrides.raw ?? ['raw', overrides.numerPlomby ?? 'P1'],
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

  it('test_executeOdebrane_when_no_candidates_should_not_create_sheet', async () => {
    const getMock = vi.fn();
    const batchUpdateMock = vi.fn();
    const updateMock = vi.fn();
    const appendMock = vi.fn();
    const api = {
      spreadsheets: {
        get: getMock,
        batchUpdate: batchUpdateMock,
        values: { get: vi.fn(), update: updateMock, append: appendMock },
      },
    };

    const result = await executeOdebraneZHarmonogramu(api, {
      targetSpreadsheetId: 'id',
      headers: ['A'],
      rows: [makeRow({ zbiorka: 'Ręczna' })],
      columnMap: { ...DEFAULT_SHEET_COLUMN_MAP },
      todayUtc,
    });

    expect(result.appendedCount).toBe(0);
    expect(getMock).not.toHaveBeenCalled();
    expect(batchUpdateMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(appendMock).not.toHaveBeenCalled();
  });

  it('test_executeOdebrane_when_new_candidates_should_create_sheet_with_headers', async () => {
    const getMock = vi.fn().mockResolvedValue({
      data: { sheets: [{ properties: { title: 'Arkusz1' } }] },
    });
    const batchUpdateMock = vi.fn().mockResolvedValue({});
    const updateMock = vi.fn().mockResolvedValue({});
    const appendMock = vi.fn();
    const valuesGetMock = vi.fn();
    const api = {
      spreadsheets: {
        get: getMock,
        batchUpdate: batchUpdateMock,
        values: { get: valuesGetMock, update: updateMock, append: appendMock },
      },
    };

    const row = makeRow({ numerPlomby: 'NEW1', raw: ['x', 'NEW1'] });
    const result = await executeOdebraneZHarmonogramu(api, {
      targetSpreadsheetId: 'ewidencja-id',
      headers: ['H1', 'H2'],
      rows: [row],
      columnMap: { ...DEFAULT_SHEET_COLUMN_MAP },
      todayUtc,
    });

    expect(result.sheetCreated).toBe(true);
    expect(result.appendedCount).toBe(1);
    expect(batchUpdateMock).toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: 'ewidencja-id',
        range: `'${SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU}'!A1`,
        requestBody: { values: [['H1', 'H2'], ['x', 'NEW1']] },
      }),
    );
    expect(appendMock).not.toHaveBeenCalled();
  });

  it('test_executeOdebrane_when_existing_sheet_should_append_only_missing', async () => {
    const getMock = vi.fn().mockResolvedValue({
      data: {
        sheets: [
          { properties: { title: 'Arkusz1' } },
          { properties: { title: SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU } },
        ],
      },
    });
    const batchUpdateMock = vi.fn();
    const updateMock = vi.fn();
    const appendMock = vi.fn().mockResolvedValue({});
    const valuesGetMock = vi.fn().mockResolvedValue({
      data: {
        values: [
          ['Numer plomby'],
          // numerPlomby default col index 9 — pad row
          ['', '', '', '', '', '', '', '', '', 'EXIST'],
        ],
      },
    });
    const api = {
      spreadsheets: {
        get: getMock,
        batchUpdate: batchUpdateMock,
        values: { get: valuesGetMock, update: updateMock, append: appendMock },
      },
    };

    const result = await executeOdebraneZHarmonogramu(api, {
      targetSpreadsheetId: 'ewidencja-id',
      headers: ['H'],
      rows: [
        makeRow({ numerPlomby: 'EXIST', raw: ['EXIST'] }),
        makeRow({ numerPlomby: 'NEW2', raw: ['NEW2'] }),
      ],
      columnMap: { ...DEFAULT_SHEET_COLUMN_MAP },
      todayUtc,
    });

    expect(result.appendedCount).toBe(1);
    expect(result.skippedExistingCount).toBe(1);
    expect(batchUpdateMock).not.toHaveBeenCalled();
    expect(appendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: { values: [['NEW2']] },
      }),
    );
  });
});
