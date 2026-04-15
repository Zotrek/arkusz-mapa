/**
 * Testy TDD dla Fazy 7 – pełny pipeline + CLI.
 *
 * Wymagania:
 *   REQ-7.1: Jedna komenda uruchamia pełny pipeline.
 *   REQ-7.3: Obsługa błędów i czytelne logowanie.
 */

import { describe, it, expect, vi } from 'vitest';
import type { SheetRow } from './sheets';
import type { Phase7Deps } from './phase7';
import { runPhase7Pipeline, runPhase7Cli } from './phase7';

function makeRow(overrides: Partial<SheetRow> = {}): SheetRow {
  return {
    sourceRowIndex: overrides.sourceRowIndex ?? 2,
    podmiotHandlowy: overrides.podmiotHandlowy ?? 'A',
    sklep: overrides.sklep ?? 'B',
    kodPocztowy: overrides.kodPocztowy ?? '62-320',
    miasto: overrides.miasto ?? 'Miłosław',
    ulica: overrides.ulica ?? 'os. Władysława Łokietka',
    numerBudynku: overrides.numerBudynku ?? '18',
    gmina: overrides.gmina ?? 'Września',
    numerPlomby: overrides.numerPlomby ?? '111',
    dataZamknieciaWorka: overrides.dataZamknieciaWorka ?? '',
    zbiorka: overrides.zbiorka ?? '',
    raw: overrides.raw ?? ['A', 'B'],
    address: overrides.address ?? '62-320 Miłosław os. Władysława Łokietka 18',
  };
}

describe('phase7 pipeline', () => {
  it('test_runPhase7Pipeline_when_happy_path_should_execute_all_steps_in_order', async () => {
    const order: string[] = [];

    const rows = [makeRow(), makeRow({ sourceRowIndex: 3, numerPlomby: '222' })];
    const rowsDuplikatyPlomb = [makeRow({ sourceRowIndex: 4, numerPlomby: '333' })];
    const rowsBezDuplikatow = rows;
    const grouped = new Map<string, { count: number; rows: SheetRow[] }>();
    grouped.set(rows[0].address, { count: 2, rows });

    const geocoded = [
      {
        address: rows[0].address,
        count: 2,
        lat: 52.2,
        lng: 17.4,
        wojewodztwo: 'Wielkopolskie',
        rows,
      },
    ];
    const uncertainGeocoded = [
      {
        address: '34-700 Rabka Chopina 16',
        count: 1,
        lat: 49.609,
        lng: 19.966,
        wojewodztwo: 'Małopolskie',
        rows: [makeRow({ sourceRowIndex: 6, numerPlomby: '555' })],
      },
    ];
    const rowsNiepewneWyniki = [makeRow({ sourceRowIndex: 6, numerPlomby: '555' })];
    const groupedNiepewneAdresy = [
      {
        address: '34-700 Rabka Chopina 16',
        liczbaWystapien: 1,
        przykladoweLat: 49.609,
        przykladoweLng: 19.966,
        wojewodztwo: 'Małopolskie',
      },
    ];
    const rowsBledneAdresy = [makeRow({ sourceRowIndex: 5, numerPlomby: '444' })];
    const groupedBledneAdresy = [{ address: rows[0].address, liczbaWystapien: 1 }];

    const deps = {
      getConfig: vi.fn(() => {
        order.push('getConfig');
        return {
          sheetsId: 'sheet-id',
          credentialsPath: '/tmp/sa.json',
          outputDir: '/tmp/out',
          geoJsonUrl: 'https://example.com/woj.json',
        };
      }),
      createSheetsClient: vi.fn(() => {
        order.push('createSheetsClient');
        return { client: true };
      }),
      loadSourceRows: vi.fn(async () => {
        order.push('loadSourceRows');
        return {
          sheetTitle: 'Arkusz1',
          headers: ['A', 'B'],
          rows,
        };
      }),
      executePhase3: vi.fn(() => {
        order.push('executePhase3');
        return { rowsDuplikatyPlomb, rowsBezDuplikatow, groupedByAddress: grouped };
      }),
      executePhase5: vi.fn(async () => {
        order.push('executePhase5');
        return {
          geocoded,
          geocodedNoPostcode: [],
          uncertainGeocoded,
          cityOnlyGeocoded: [],
          rowsBledneAdresy,
          rowsNiepewneWyniki,
          groupedNiepewneAdresy,
          groupedBledneAdresy,
          totalBatches: 1,
          geocodedUniqueAddresses: 1,
          geocodedNoPostcodeUniqueAddresses: 0,
          uncertainUniqueAddresses: 1,
          cityOnlyUniqueAddresses: 0,
          badUniqueAddresses: 0,
        };
      }),
      executePhase4: vi.fn(async () => {
        order.push('executePhase4');
      }),
      executePhase6: vi.fn(async () => {
        order.push('executePhase6');
        return {
          fileName: 'mapa_2026-02-25_17-00-00.html',
          filePath: '/tmp/out/mapa_2026-02-25_17-00-00.html',
          htmlContent: '<!doctype html>',
        };
      }),
      logger: {
        info: vi.fn(),
        error: vi.fn(),
      },
    };

    const result = await runPhase7Pipeline(deps as unknown as Partial<Phase7Deps>);

    expect(order).toEqual([
      'getConfig',
      'createSheetsClient',
      'loadSourceRows',
      'executePhase3',
      'executePhase5',
      'executePhase4',
      'executePhase6',
    ]);
    expect(deps.executePhase4).toHaveBeenCalledWith(
      { client: true },
      expect.objectContaining({
        spreadsheetId: 'sheet-id',
        headers: ['A', 'B'],
        rowsDuplikatyPlomb,
      }),
    );
    expect(result.mapFilePath).toContain('/tmp/out/');
  });

  it('test_runPhase7Pipeline_when_step_fails_should_throw_error', async () => {
    const deps = {
      getConfig: vi.fn(() => ({
        sheetsId: 'sheet-id',
        credentialsPath: '/tmp/sa.json',
        outputDir: '/tmp/out',
        geoJsonUrl: 'https://example.com/woj.json',
      })),
      createSheetsClient: vi.fn(() => ({})),
      loadSourceRows: vi.fn(async () => {
        throw new Error('load failed');
      }),
      executePhase3: vi.fn(),
      executePhase5: vi.fn(),
      executePhase4: vi.fn(),
      executePhase6: vi.fn(),
      logger: {
        info: vi.fn(),
        error: vi.fn(),
      },
    };

    await expect(runPhase7Pipeline(deps as unknown as Partial<Phase7Deps>)).rejects.toThrow('load failed');
  });
});

describe('phase7 cli', () => {
  it('test_runPhase7Cli_when_pipeline_throws_should_log_error_and_exit_with_code_1', async () => {
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    const exitFn = vi.fn();
    const pipelineFn = vi.fn(async () => {
      throw new Error('boom');
    });

    await runPhase7Cli({
      pipelineFn,
      logger,
      exitFn,
    });

    expect(logger.error).toHaveBeenCalledWith('Pipeline failed: %s', 'boom');
    expect(exitFn).toHaveBeenCalledWith(1);
  });
});
