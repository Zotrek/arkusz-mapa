import { describe, expect, it, vi } from 'vitest';
import {
  fetchReferenceDataFromWebApp,
  loadPodwykoOptionsWithReferenceFallback,
  loadReferenceDataFromSheets,
  mergePodwykoEntries,
  podwykoOptionsToSheetRows,
  writePodwykoListaToSheets,
  writeReferencePodwykoJsonFile,
} from './referenceData.js';

describe('mergePodwykoEntries', () => {
  it('test_mergePodwykoEntries_dedupes_same_label_and_dane', () => {
    const merged = mergePodwykoEntries([
      [{ baseLabel: 'Firma A', dane: 'Dane A' }],
      [{ baseLabel: 'Firma A', dane: 'Dane A' }],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({ label: 'Firma A', dane: 'Dane A' });
  });

  it('test_mergePodwykoEntries_preserves_order_primary_first', () => {
    const merged = mergePodwykoEntries([
      [{ baseLabel: 'Pierwszy', dane: 'D1' }],
      [{ baseLabel: 'Drugi', dane: 'D2' }],
    ]);
    expect(merged.map((item) => item.label)).toEqual(['Pierwszy', 'Drugi']);
  });

  it('test_mergePodwykoEntries_allows_same_label_different_dane', () => {
    const merged = mergePodwykoEntries([
      [{ baseLabel: 'Firma', dane: 'Wariant 1' }],
      [{ baseLabel: 'Firma', dane: 'Wariant 2' }],
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe('podwykoOptionsToSheetRows', () => {
  it('test_podwykoOptionsToSheetRows_maps_label_and_dane', () => {
    expect(
      podwykoOptionsToSheetRows([
        { label: 'BLUECARGO', dane: 'BLUECARGO Sp. z o.o.' },
      ]),
    ).toEqual([['BLUECARGO', 'BLUECARGO Sp. z o.o.']]);
  });
});

describe('writePodwykoListaToSheets', () => {
  it('test_writePodwykoListaToSheets_when_called_should_clear_and_update_sheet', async () => {
    const clear = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn().mockResolvedValue({
      data: { sheets: [{ properties: { title: 'Lista podwykonawców' } }] },
    });
    const batchUpdate = vi.fn().mockResolvedValue(undefined);

    await writePodwykoListaToSheets(
      {
        spreadsheets: {
          get,
          batchUpdate,
          values: { clear, update },
        },
      },
      'sheet-id',
      [{ label: 'Firma', dane: 'Dane' }],
    );

    expect(clear).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id',
      range: "'Lista podwykonawców'!A:Z",
    });
    expect(update).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id',
      range: "'Lista podwykonawców'!A1",
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          ['Nazwa', 'Dane do Worda'],
          ['Firma', 'Dane'],
        ],
      },
    });
  });
});

describe('writeReferencePodwykoJsonFile', () => {
  it('test_writeReferencePodwykoJsonFile_when_called_should_write_pretty_json', async () => {
    const writeFileFn = vi.fn(async () => {});

    await writeReferencePodwykoJsonFile([{ label: 'GPW', dane: 'GPW Sp.' }], writeFileFn);

    expect(writeFileFn).toHaveBeenCalledTimes(1);
    const [path, content] = writeFileFn.mock.calls[0] as [string, string];
    expect(path).toContain('reference-podwyko-lista.json');
    expect(JSON.parse(content)).toEqual([{ label: 'GPW', dane: 'GPW Sp.' }]);
    expect(content.endsWith('\n')).toBe(true);
  });
});

describe('fetchReferenceDataFromWebApp', () => {
  it('test_fetchReferenceDataFromWebApp_when_ok_should_map_podwyko_lista', async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({
        ok: true,
        data: {
          podwykoLista: [{ nazwa: 'GPW', dane: 'GPW dane' }],
          poprawAdres: [
            {
              podmiotHandlowy: 'PH',
              sklep: 'S',
              adres: 'Adres 1',
              lat: 1,
              lng: 2,
            },
          ],
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const data = await fetchReferenceDataFromWebApp('https://example.com/exec');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/exec?action=listReferenceData',
    );
    expect(data.podwykoLista?.[0]).toEqual({ label: 'GPW', dane: 'GPW dane' });
    expect(data.poprawAdres).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it('test_fetchReferenceDataFromWebApp_when_not_ok_should_return_empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        json: async () => ({ ok: false }),
      })),
    );

    await expect(fetchReferenceDataFromWebApp('https://example.com/exec?x=1')).resolves.toEqual(
      {},
    );
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'https://example.com/exec?x=1&action=listReferenceData',
    );
    vi.unstubAllGlobals();
  });
});

describe('loadReferenceDataFromSheets', () => {
  it('test_loadReferenceDataFromSheets_when_lista_sheet_should_merge_podwyko', async () => {
    const get = vi.fn(async (args: { range: string }) => {
      if (args.range.includes('Lista podwykonawców')) {
        return {
          data: {
            values: [
              ['Nazwa', 'Dane do Worda'],
              ['Firma', 'Dane F'],
            ],
          },
        };
      }
      return { data: { values: [] } };
    });

    const bundle = await loadReferenceDataFromSheets(
      { spreadsheets: { values: { get } } },
      'sid',
    );

    expect(bundle.podwykoLista).toEqual([{ label: 'Firma', dane: 'Dane F' }]);
    expect(bundle.poprawAdres).toEqual([]);
    expect(get).toHaveBeenCalled();
  });
});

describe('loadPodwykoOptionsWithReferenceFallback', () => {
  it('test_loadPodwykoOptionsWithReferenceFallback_when_json_empty_should_use_xlsx', async () => {
    const loadFromXlsx = vi.fn(async () => [{ label: 'X', dane: 'Y' }]);

    const result = await loadPodwykoOptionsWithReferenceFallback('/tmp/x.xlsx', loadFromXlsx);

    // Brak lokalnego JSON w CI → fallback do XLSX.
    expect(result).toEqual([{ label: 'X', dane: 'Y' }]);
    expect(loadFromXlsx).toHaveBeenCalledWith('/tmp/x.xlsx');
  });

  it('test_loadPodwykoOptionsWithReferenceFallback_when_xlsx_throws_should_return_empty', async () => {
    const result = await loadPodwykoOptionsWithReferenceFallback('/tmp/missing.xlsx', async () => {
      throw new Error('no file');
    });
    expect(result).toEqual([]);
  });
});
