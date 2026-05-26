/**
 * Faza 3: logika duplikatów plomb i grupowania po adresie.
 */

import type { SheetRow } from './sheets.js';

export interface AddressGroup {
  address: string;
  count: number;
  rows: SheetRow[];
}

export interface Phase3Result {
  rowsDuplikatyPlomb: SheetRow[];
  rowsBezDuplikatow: SheetRow[];
  groupedByAddress: Map<string, AddressGroup>;
}

function countSeals(rows: SheetRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const current = counts.get(row.numerPlomby) ?? 0;
    counts.set(row.numerPlomby, current + 1);
  });
  return counts;
}

export function partitionRowsBySealDuplicates(rows: SheetRow[]): {
  rowsDuplikatyPlomb: SheetRow[];
  rowsBezDuplikatow: SheetRow[];
} {
  const sealCounts = countSeals(rows);

  const rowsDuplikatyPlomb: SheetRow[] = [];
  const rowsBezDuplikatow: SheetRow[] = [];

  rows.forEach((row) => {
    const count = sealCounts.get(row.numerPlomby) ?? 0;
    if (count > 1) {
      rowsDuplikatyPlomb.push(row);
      return;
    }
    rowsBezDuplikatow.push(row);
  });

  return { rowsDuplikatyPlomb, rowsBezDuplikatow };
}

export function groupRowsByAddress(rows: SheetRow[]): Map<string, AddressGroup> {
  const grouped = new Map<string, AddressGroup>();

  rows.forEach((row) => {
    const sklepKey = row.sklep.trim().replace(/\s+/g, ' ').toLowerCase();
    const groupingKey = sklepKey.length > 0 ? `${row.address}\u0000${sklepKey}` : row.address;
    const existing = grouped.get(groupingKey);
    if (!existing) {
      grouped.set(groupingKey, {
        address: row.address,
        count: 1,
        rows: [row],
      });
      return;
    }

    existing.count += 1;
    existing.rows.push(row);
  });

  return grouped;
}

export function executePhase3(rows: SheetRow[]): Phase3Result {
  const { rowsDuplikatyPlomb, rowsBezDuplikatow } = partitionRowsBySealDuplicates(rows);
  const groupedByAddress = groupRowsByAddress(rowsBezDuplikatow);

  return {
    rowsDuplikatyPlomb,
    rowsBezDuplikatow,
    groupedByAddress,
  };
}
