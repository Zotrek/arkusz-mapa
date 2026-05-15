/**
 * Testy TDD dla Fazy 3 – logika duplikatów plomb i grupowania adresów.
 *
 * Wymagania:
 *   REQ-3.1: Wykrycie duplikatów w kolumnie H (numerPlomby), podział na 2 zbiory.
 *   REQ-3.2: Grupowanie po adresie dla rekordów bez duplikatów.
 */

import { describe, it, expect } from 'vitest';
import type { SheetRow } from './sheets';
import {
  partitionRowsBySealDuplicates,
  groupRowsByAddress,
  executePhase3,
} from './phase3';

function makeRow(params: Partial<SheetRow> = {}): SheetRow {
  return {
    sourceRowIndex: params.sourceRowIndex ?? 2,
    podmiotHandlowy: params.podmiotHandlowy ?? 'A',
    sklep: params.sklep ?? 'B',
    kodPocztowy: params.kodPocztowy ?? '62-320',
    miasto: params.miasto ?? 'Miłosław',
    ulica: params.ulica ?? 'os. Władysława Łokietka',
    numerBudynku: params.numerBudynku ?? '18',
    gmina: params.gmina ?? 'Września',
    numerPlomby: params.numerPlomby ?? '111',
    dataZamknieciaWorka: params.dataZamknieciaWorka ?? '',
    zbiorka: params.zbiorka ?? '',
    raw: params.raw ?? [],
    address: params.address ?? '62-320 Miłosław os. Władysława Łokietka 18',
  };
}

describe('phase3', () => {
  describe('REQ-3.1: partitionRowsBySealDuplicates', () => {
    it('test_partitionRowsBySealDuplicates_when_seal_is_duplicated_should_put_rows_in_duplicates', () => {
      const rows: SheetRow[] = [
        makeRow({ sourceRowIndex: 2, numerPlomby: '111', address: 'A' }),
        makeRow({ sourceRowIndex: 3, numerPlomby: '111', address: 'B' }),
        makeRow({ sourceRowIndex: 4, numerPlomby: '222', address: 'C' }),
      ];

      const result = partitionRowsBySealDuplicates(rows);

      expect(result.rowsDuplikatyPlomb).toHaveLength(2);
      expect(result.rowsDuplikatyPlomb.map((r) => r.sourceRowIndex)).toEqual([2, 3]);
      expect(result.rowsBezDuplikatow).toHaveLength(1);
      expect(result.rowsBezDuplikatow[0].sourceRowIndex).toBe(4);
    });

    it('test_partitionRowsBySealDuplicates_when_no_duplicates_should_return_all_rows_as_unique', () => {
      const rows: SheetRow[] = [
        makeRow({ sourceRowIndex: 2, numerPlomby: '111' }),
        makeRow({ sourceRowIndex: 3, numerPlomby: '222' }),
      ];

      const result = partitionRowsBySealDuplicates(rows);

      expect(result.rowsDuplikatyPlomb).toEqual([]);
      expect(result.rowsBezDuplikatow).toHaveLength(2);
    });
  });

  describe('REQ-3.2: groupRowsByAddress', () => {
    it('test_groupRowsByAddress_when_same_address_occurs_many_times_should_count_occurrences', () => {
      const rows: SheetRow[] = [
        makeRow({ sourceRowIndex: 2, numerPlomby: '111', address: 'X' }),
        makeRow({ sourceRowIndex: 3, numerPlomby: '222', address: 'X' }),
        makeRow({ sourceRowIndex: 4, numerPlomby: '333', address: 'Y' }),
      ];

      const grouped = groupRowsByAddress(rows);

      expect(grouped.size).toBe(2);
      expect(grouped.get('X')?.count).toBe(2);
      expect(grouped.get('X')?.rows.map((r) => r.sourceRowIndex)).toEqual([2, 3]);
      expect(grouped.get('Y')?.count).toBe(1);
    });
  });

  describe('REQ-3.1 + REQ-3.2: executePhase3', () => {
    it('test_executePhase3_when_input_has_duplicates_and_repeated_addresses_should_return_complete_result', () => {
      const rows: SheetRow[] = [
        makeRow({ sourceRowIndex: 2, numerPlomby: '111', address: 'A' }),
        makeRow({ sourceRowIndex: 3, numerPlomby: '111', address: 'A' }), // duplicate seal
        makeRow({ sourceRowIndex: 4, numerPlomby: '222', address: 'A' }),
        makeRow({ sourceRowIndex: 5, numerPlomby: '333', address: 'B' }),
      ];

      const result = executePhase3(rows);

      expect(result.rowsDuplikatyPlomb.map((r) => r.sourceRowIndex)).toEqual([2, 3]);
      expect(result.rowsBezDuplikatow.map((r) => r.sourceRowIndex)).toEqual([4, 5]);
      expect(result.groupedByAddress.get('A')?.count).toBe(1);
      expect(result.groupedByAddress.get('B')?.count).toBe(1);
    });
  });
});
