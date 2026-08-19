import { describe, expect, it, vi } from 'vitest';
import {
  mergePodwykoEntries,
  podwykoOptionsToSheetRows,
  writePodwykoListaToSheets,
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
