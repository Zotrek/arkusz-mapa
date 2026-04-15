/**
 * Testy TDD dla Fazy 4 – zapis do Sheets:
 * - zakładki Zgrupowane niepewne/błędne adresy, Adresy pewne (4 typy)
 * - tworzenie zakładki jeśli nie istnieje
 * - idempotentny zapis (clear + update)
 */

import { describe, it, expect, vi } from 'vitest';
import type { SheetRow } from './sheets';
import {
  ensureSheetExists,
  overwriteSheetRows,
  executePhase4,
} from './phase4';

function makeRow(raw: string[]): SheetRow {
  return {
    sourceRowIndex: 2,
    podmiotHandlowy: '',
    sklep: '',
    kodPocztowy: '',
    miasto: '',
    ulica: '',
    numerBudynku: '',
    gmina: '',
    numerPlomby: '',
    dataZamknieciaWorka: '',
    zbiorka: '',
    raw,
    address: '',
  };
}

describe('phase4', () => {
  describe('ensureSheetExists', () => {
    it('test_ensureSheetExists_when_sheet_exists_should_not_create_sheet', async () => {
      const getMock = vi.fn().mockResolvedValue({
        data: {
          sheets: [
            { properties: { title: 'Arkusz1' } },
            { properties: { title: 'Zgrupowane niepewne adresy' } },
          ],
        },
      });
      const batchUpdateMock = vi.fn();

      const api = {
        spreadsheets: {
          get: getMock,
          batchUpdate: batchUpdateMock,
        },
      };

      await ensureSheetExists(api, 'sheet-id', 'Zgrupowane niepewne adresy');

      expect(getMock).toHaveBeenCalledWith({ spreadsheetId: 'sheet-id' });
      expect(batchUpdateMock).not.toHaveBeenCalled();
    });

    it('test_ensureSheetExists_when_sheet_missing_should_create_sheet', async () => {
      const getMock = vi.fn().mockResolvedValue({
        data: {
          sheets: [{ properties: { title: 'Arkusz1' } }],
        },
      });
      const batchUpdateMock = vi.fn().mockResolvedValue({});

      const api = {
        spreadsheets: {
          get: getMock,
          batchUpdate: batchUpdateMock,
        },
      };

      await ensureSheetExists(api, 'sheet-id', 'Zgrupowane niepewne adresy');

      expect(batchUpdateMock).toHaveBeenCalledWith({
        spreadsheetId: 'sheet-id',
        requestBody: {
          requests: [{ addSheet: { properties: { title: 'Zgrupowane niepewne adresy' } } }],
        },
      });
    });
  });

  describe('overwriteSheetRows', () => {
    it('test_overwriteSheetRows_when_called_should_clear_then_update_with_headers_and_rows', async () => {
      const clearMock = vi.fn().mockResolvedValue({});
      const updateMock = vi.fn().mockResolvedValue({});

      const api = {
        spreadsheets: {
          values: {
            clear: clearMock,
            update: updateMock,
          },
        },
      };

      const headers = ['A', 'B', 'C'];
      const rows = [makeRow(['1', '2', '3']), makeRow(['4', '5', '6'])];

      await overwriteSheetRows(api, 'sheet-id', 'Zgrupowane niepewne adresy', headers, rows);

      expect(clearMock).toHaveBeenCalledWith({
        spreadsheetId: 'sheet-id',
        range: "'Zgrupowane niepewne adresy'!A:Z",
      });
      expect(updateMock).toHaveBeenCalledWith({
        spreadsheetId: 'sheet-id',
        range: "'Zgrupowane niepewne adresy'!A1",
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [headers, ['1', '2', '3'], ['4', '5', '6']],
        },
      });
    });
  });

  describe('executePhase4', () => {
    it('test_executePhase4_when_called_should_save_grouped_and_adresy_tabs', async () => {
      const api = {
        spreadsheets: {
          get: vi.fn().mockResolvedValue({
            data: {
              sheets: [{ properties: { title: 'Arkusz1' } }],
            },
          }),
          batchUpdate: vi.fn().mockResolvedValue({}),
          values: {
            clear: vi.fn().mockResolvedValue({}),
            update: vi.fn().mockResolvedValue({}),
          },
        },
      };

      await executePhase4(api, {
        spreadsheetId: 'sheet-id',
        headers: ['A', 'B'],
        rowsDuplikatyPlomb: [],
        rowsNiepewneWyniki: [makeRow(['n1', 'n2'])],
        groupedNiepewneAdresy: [
          {
            address: '62-320 Miłosław os. Władysława Łokietka 18',
            liczbaWystapien: 2,
            przykladoweLat: 52.206,
            przykladoweLng: 17.489,
            wojewodztwo: 'Wielkopolskie',
          },
        ],
        groupedBledneAdresy: [
          {
            address: '34-300 Żywiec Bracka 1',
            liczbaWystapien: 3,
          },
        ],
      });

      expect(api.spreadsheets.get).toHaveBeenCalled();
      // 2 zakładki: Zgrupowane niepewne adresy, Zgrupowane błędne adresy (brak duplikatów plomb)
      expect(api.spreadsheets.batchUpdate).toHaveBeenCalledTimes(2);
      expect(api.spreadsheets.values.clear).toHaveBeenCalledTimes(2);
      expect(api.spreadsheets.values.update).toHaveBeenCalledTimes(2);
      expect(api.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          range: "'Zgrupowane niepewne adresy'!A1",
          requestBody: {
            values: [
              [
                'adres',
                'liczba_wystapien',
                'przykladowe_lat',
                'przykladowe_lng',
                'wojewodztwo',
              ],
              [
                '62-320 Miłosław os. Władysława Łokietka 18',
                '2',
                '52.206',
                '17.489',
                'Wielkopolskie',
              ],
            ],
          },
        }),
      );
      expect(api.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          range: "'Zgrupowane błędne adresy'!A1",
          requestBody: {
            values: [
              ['adres', 'liczba_wystapien'],
              ['34-300 Żywiec Bracka 1', '3'],
            ],
          },
        }),
      );
    });

    it('test_executePhase4_when_geocoded_lists_given_should_write_single_adresy_pewne_sheet', async () => {
      const api = {
        spreadsheets: {
          get: vi.fn().mockResolvedValue({
            data: {
              sheets: [{ properties: { title: 'Arkusz1' } }],
            },
          }),
          batchUpdate: vi.fn().mockResolvedValue({}),
          values: {
            clear: vi.fn().mockResolvedValue({}),
            update: vi.fn().mockResolvedValue({}),
          },
        },
      };

      const geocoded = [
        { address: '62-320 Miłosław Leśna 10', count: 2, lat: 52.2, lng: 17.5, wojewodztwo: 'Wielkopolskie', rows: [] },
      ];
      const geocodedNoPostcode = [
        { address: '00-001 Warszawa Marszałkowska 1', count: 1, lat: 52.23, lng: 21.01, wojewodztwo: 'Mazowieckie', rows: [] },
      ];

      await executePhase4(api, {
        spreadsheetId: 'sheet-id',
        headers: ['A', 'B'],
        rowsDuplikatyPlomb: [],
        rowsNiepewneWyniki: [],
        groupedNiepewneAdresy: [],
        groupedBledneAdresy: [],
        geocoded,
        geocodedNoPostcode,
        uncertainGeocoded: [],
        cityOnlyGeocoded: [],
      });

      // Przy pustych grouped nie tworzymy tych zakładek; tylko Adresy pewne i Adresy pewne bez kodu
      expect(api.spreadsheets.batchUpdate).toHaveBeenCalledTimes(2);
      expect(api.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          range: "'Adresy pewne'!A1",
          requestBody: {
            values: [
              ['adres', 'liczba_wystapien'],
              ['62-320 Miłosław Leśna 10', '2'],
            ],
          },
        }),
      );
      expect(api.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          range: "'Adresy pewne bez kodu'!A1",
          requestBody: {
            values: [
              ['adres', 'liczba_wystapien'],
              ['00-001 Warszawa Marszałkowska 1', '1'],
            ],
          },
        }),
      );
    });

    it('test_executePhase4_when_rowsDuplikatyPlomb_non_empty_should_create_duplikaty_plomb_tab_with_full_rows', async () => {
      const api = {
        spreadsheets: {
          get: vi.fn().mockResolvedValue({
            data: { sheets: [{ properties: { title: 'Arkusz1' } }] },
          }),
          batchUpdate: vi.fn().mockResolvedValue({}),
          values: {
            clear: vi.fn().mockResolvedValue({}),
            update: vi.fn().mockResolvedValue({}),
          },
        },
      };

      const headers = ['Kolumna A', 'Kolumna B', 'Numer plomby'];
      const dupRow1 = makeRow(['val1', 'val2', 'PLOMBA-1']);
      const dupRow2 = makeRow(['val3', 'val4', 'PLOMBA-1']);

      await executePhase4(api, {
        spreadsheetId: 'sheet-id',
        headers,
        rowsDuplikatyPlomb: [dupRow1, dupRow2],
        rowsNiepewneWyniki: [],
        groupedNiepewneAdresy: [],
        groupedBledneAdresy: [],
      });

      expect(api.spreadsheets.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'sheet-id',
        requestBody: {
          requests: [{ addSheet: { properties: { title: 'Duplikaty plomb' } } }],
        },
      });
      expect(api.spreadsheets.values.clear).toHaveBeenCalledWith({
        spreadsheetId: 'sheet-id',
        range: "'Duplikaty plomb'!A:Z",
      });
      expect(api.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          spreadsheetId: 'sheet-id',
          range: "'Duplikaty plomb'!A1",
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [headers, dupRow1.raw, dupRow2.raw],
          },
        }),
      );
    });

    it('test_executePhase4_when_no_data_should_not_create_any_sheet', async () => {
      const api = {
        spreadsheets: {
          get: vi.fn().mockResolvedValue({
            data: { sheets: [{ properties: { title: 'Arkusz1' } }] },
          }),
          batchUpdate: vi.fn().mockResolvedValue({}),
          values: {
            clear: vi.fn().mockResolvedValue({}),
            update: vi.fn().mockResolvedValue({}),
          },
        },
      };

      await executePhase4(api, {
        spreadsheetId: 'sheet-id',
        headers: ['A', 'B'],
        rowsDuplikatyPlomb: [],
        rowsNiepewneWyniki: [],
        groupedNiepewneAdresy: [],
        groupedBledneAdresy: [],
        geocoded: [],
        geocodedNoPostcode: [],
        uncertainGeocoded: [],
        cityOnlyGeocoded: [],
      });

      expect(api.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      expect(api.spreadsheets.values.clear).not.toHaveBeenCalled();
      expect(api.spreadsheets.values.update).not.toHaveBeenCalled();
    });
  });
});
