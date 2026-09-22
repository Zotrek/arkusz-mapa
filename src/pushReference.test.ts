import { describe, expect, it, vi } from 'vitest';
import { runPushReferenceCli } from './pushReference';

describe('runPushReferenceCli', () => {
  const baseConfig = {
    sheetsId: 'src',
    credentialsPath: '/tmp/creds.json',
    outputDir: '/tmp/out',
  };
  const paths = {
    podwykoPath: '/tmp/podwyko.xlsx',
    templatePath: '/tmp/t.docx',
    faviconPath: '/tmp/f.svg',
  };

  it('test_runPushReferenceCli_when_xlsx_empty_should_exit_1_without_write', async () => {
    const writeSheet = vi.fn();
    const createClient = vi.fn();
    const exitFn = vi.fn();
    const logger = { log: vi.fn(), error: vi.fn() };

    await runPushReferenceCli({
      getConfig: () => baseConfig,
      getPaths: () => paths,
      getSpreadsheetId: () => 'sheet-id',
      loadFromXlsx: async () => [],
      createClient,
      writeSheet,
      logger,
      exitFn,
    });

    expect(logger.error).toHaveBeenCalledWith(
      '[arkusz-mapa] push:reference — brak wpisów w pliku XLSX',
    );
    expect(exitFn).toHaveBeenCalledWith(1);
    expect(createClient).not.toHaveBeenCalled();
    expect(writeSheet).not.toHaveBeenCalled();
  });

  it('test_runPushReferenceCli_when_ok_should_merge_and_write_sheet', async () => {
    const client = { sheets: true };
    const writeSheet = vi.fn(async () => {});
    const exitFn = vi.fn();
    const logger = { log: vi.fn(), error: vi.fn() };

    await runPushReferenceCli({
      getConfig: () => baseConfig,
      getPaths: () => paths,
      getSpreadsheetId: () => 'sheet-id',
      loadFromXlsx: async () => [{ label: 'GPW', dane: 'GPW xlsx' }],
      createClient: () => client,
      loadExisting: async () => ({
        podwykoLista: [{ label: 'Stary', dane: 'stary' }],
        poprawAdres: [],
        poprawAdresIndex: new Map(),
      }),
      writeSheet,
      logger,
      exitFn,
    });

    expect(writeSheet).toHaveBeenCalledTimes(1);
    expect(writeSheet.mock.calls[0][0]).toBe(client);
    expect(writeSheet.mock.calls[0][1]).toBe('sheet-id');
    const written = writeSheet.mock.calls[0][2] as Array<{ label: string; dane: string }>;
    expect(written.map((item) => item.label).sort()).toEqual(['GPW', 'Stary']);
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('xlsx entries: 1'));
    expect(exitFn).not.toHaveBeenCalled();
  });

  it('test_runPushReferenceCli_when_throws_should_exit_1', async () => {
    const exitFn = vi.fn();
    const logger = { log: vi.fn(), error: vi.fn() };
    const boom = new Error('sheets down');

    await runPushReferenceCli({
      getConfig: () => baseConfig,
      getPaths: () => paths,
      getSpreadsheetId: () => 'sheet-id',
      loadFromXlsx: async () => [{ label: 'GPW', dane: 'GPW' }],
      createClient: () => ({}),
      loadExisting: async () => {
        throw boom;
      },
      writeSheet: vi.fn(),
      logger,
      exitFn,
    });

    expect(logger.error).toHaveBeenCalledWith(boom);
    expect(exitFn).toHaveBeenCalledWith(1);
  });
});
