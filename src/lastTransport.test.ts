import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

type Cell = string | number | null;

class FakeRange {
  constructor(
    readonly sheet: FakeSheet,
    readonly row: number,
    readonly col: number,
    readonly numRows: number,
    readonly numCols: number,
  ) {}

  getValues(): Cell[][] {
    const out: Cell[][] = [];
    for (let r = 0; r < this.numRows; r += 1) {
      const line: Cell[] = [];
      for (let c = 0; c < this.numCols; c += 1) {
        line.push(this.sheet.cell(this.row + r, this.col + c));
      }
      out.push(line);
    }
    return out;
  }
}

class FakeSheet {
  private readonly cells = new Map<string, Cell>();

  cell(row: number, col: number): Cell {
    const value = this.cells.get(`${row},${col}`);
    return value == null ? '' : value;
  }

  put(row: number, col: number, value: Cell): void {
    this.cells.set(`${row},${col}`, value);
  }

  getLastRow(): number {
    let max = 0;
    for (const [key, value] of this.cells) {
      if (value == null || value === '') {
        continue;
      }
      const row = Number(key.split(',')[0]);
      if (row > max) {
        max = row;
      }
    }
    return max;
  }

  getRange(row: number, col: number, numRows?: number, numCols?: number): FakeRange {
    return new FakeRange(this, row, col, numRows ?? 1, numCols ?? 1);
  }
}

type Pickup = { ms: number; ktoOdbiera: string };

type GasFns = {
  buildBulkLastTransportDatesMap_: () => Record<string, Pickup>;
  findLastTransportInfo_: (podmiot: string, adres: string) => Pickup | null;
  transportDidNotHappen_: (row: unknown) => boolean;
};

const gsPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../google-apps-script/transport-log.gs',
);

const PODMIOT = 'Firma';
const ADRES = 'Test 1';
const KEY = 'firma\0test 1';
const OLDER = Date.UTC(2026, 5, 10);
const NEWER = Date.UTC(2026, 5, 20);

function loadGas(sheet: FakeSheet, otherFirst?: FakeSheet): GasFns {
  const context: Record<string, unknown> = {
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return {
          getSheets() {
            return otherFirst ? [otherFirst, sheet] : [sheet];
          },
          getSheetByName(name: string) {
            if (name === 'Arkusz1') {
              return sheet;
            }
            return null;
          },
        };
      },
    },
  };
  runInNewContext(readFileSync(gsPath, 'utf8'), context);
  const bulk = context.buildBulkLastTransportDatesMap_;
  const find = context.findLastTransportInfo_;
  const skipped = context.transportDidNotHappen_;
  if (typeof bulk !== 'function' || typeof find !== 'function' || typeof skipped !== 'function') {
    throw new Error('transport-log.gs nie wystawił odczytu ostatniego transportu');
  }
  return {
    buildBulkLastTransportDatesMap_: bulk as GasFns['buildBulkLastTransportDatesMap_'],
    findLastTransportInfo_: find as GasFns['findLastTransportInfo_'],
    transportDidNotHappen_: skipped as GasFns['transportDidNotHappen_'],
  };
}

function seed(
  sheet: FakeSheet,
  row: number,
  data: string,
  kto: string,
  flag?: string,
  adres = ADRES,
  podmiot = PODMIOT,
): void {
  sheet.put(row, 2, adres);
  sheet.put(row, 3, podmiot);
  sheet.put(row, 5, data);
  sheet.put(row, 6, kto);
  if (flag !== undefined) {
    sheet.put(row, 18, flag);
  }
}

describe('transportDidNotHappen_', () => {
  it('test_transportDidNotHappen_when_column_missing_should_count_as_happened', () => {
    const skipped = loadGas(new FakeSheet()).transportDidNotHappen_;
    expect(skipped([])).toBe(false);
    expect(skipped(undefined)).toBe(false);
  });

  it('test_transportDidNotHappen_when_nie_with_case_or_space_should_skip', () => {
    const skipped = loadGas(new FakeSheet()).transportDidNotHappen_;
    const row = new Array(16).fill('');
    row.push('nie');
    expect(skipped(row)).toBe(true);
    row[16] = 'NIE';
    expect(skipped(row)).toBe(true);
    row[16] = ' nie ';
    expect(skipped(row)).toBe(true);
  });

  it('test_transportDidNotHappen_when_other_value_should_count_as_happened', () => {
    const skipped = loadGas(new FakeSheet()).transportDidNotHappen_;
    const row = new Array(16).fill('');
    row.push('');
    expect(skipped(row)).toBe(false);
    row[16] = 'tak';
    expect(skipped(row)).toBe(false);
    row[16] = 'xyz';
    expect(skipped(row)).toBe(false);
  });
});

describe('findLastTransportInfo_', () => {
  it('test_findLastTransportInfo_when_newer_row_is_nie_should_keep_older_pickup', () => {
    const sheet = new FakeSheet();
    seed(sheet, 2, '10.06.2026', 'Janex');
    seed(sheet, 3, '20.06.2026', 'Inny', 'nie');

    expect(loadGas(sheet).findLastTransportInfo_(PODMIOT, ADRES)).toEqual({
      ms: OLDER,
      ktoOdbiera: 'Janex',
    });
  });

  it('test_findLastTransportInfo_when_column18_empty_should_keep_newer_pickup', () => {
    const sheet = new FakeSheet();
    seed(sheet, 2, '10.06.2026', 'Janex');
    seed(sheet, 3, '20.06.2026', 'Nowy', '');

    expect(loadGas(sheet).findLastTransportInfo_(PODMIOT, ADRES)).toEqual({
      ms: NEWER,
      ktoOdbiera: 'Nowy',
    });
  });

  it('test_findLastTransportInfo_when_column18_missing_should_keep_newer_pickup', () => {
    const sheet = new FakeSheet();
    seed(sheet, 2, '10.06.2026', 'Janex', 'tak');
    seed(sheet, 3, '20.06.2026', 'Nowy');

    expect(loadGas(sheet).findLastTransportInfo_(PODMIOT, ADRES)).toEqual({
      ms: NEWER,
      ktoOdbiera: 'Nowy',
    });
  });

  it('test_findLastTransportInfo_when_column18_is_tak_or_other_should_keep_newer_pickup', () => {
    const sheet = new FakeSheet();
    seed(sheet, 2, '10.06.2026', 'Janex', 'nie');
    seed(sheet, 3, '20.06.2026', 'Tak', 'tak');
    seed(sheet, 4, '20.06.2026', 'Inny', 'xyz');

    expect(loadGas(sheet).findLastTransportInfo_(PODMIOT, ADRES)).toEqual({
      ms: NEWER,
      ktoOdbiera: 'Inny',
    });
  });

  it('test_findLastTransportInfo_when_only_nie_should_return_null', () => {
    const sheet = new FakeSheet();
    seed(sheet, 2, '20.06.2026', 'Inny', 'nie');

    expect(loadGas(sheet).findLastTransportInfo_(PODMIOT, ADRES)).toBeNull();
  });
});

describe('buildBulkLastTransportDatesMap_', () => {
  it('test_buildBulkLastTransportDatesMap_when_only_nie_should_omit_shop', () => {
    const sheet = new FakeSheet();
    seed(sheet, 2, '20.06.2026', 'Inny', 'nie');

    expect(loadGas(sheet).buildBulkLastTransportDatesMap_()).toEqual({});
  });

  it('test_buildBulkLastTransportDatesMap_when_register_not_first_tab_should_still_find_by_name', () => {
    const register = new FakeSheet();
    const other = new FakeSheet();
    seed(register, 2, '20.06.2026', 'Nowy', '');
    other.put(2, 2, 'nie-adres');
    other.put(2, 3, 'nie-podmiot');
    other.put(2, 5, '01.01.2000');
    other.put(2, 6, 'Zła zakładka');

    expect(loadGas(register, other).buildBulkLastTransportDatesMap_()).toEqual({
      [KEY]: { ms: NEWER, ktoOdbiera: 'Nowy' },
    });
  });

  it('test_buildBulkLastTransportDatesMap_when_newer_row_is_nie_should_keep_older_cutoff', () => {
    const sheet = new FakeSheet();
    seed(sheet, 2, '10.06.2026', 'Janex', 'tak');
    seed(sheet, 3, '20.06.2026', 'Inny', 'NIE');

    expect(loadGas(sheet).buildBulkLastTransportDatesMap_()).toEqual({
      [KEY]: { ms: OLDER, ktoOdbiera: 'Janex' },
    });
  });

  it('test_buildBulkLastTransportDatesMap_when_column18_empty_should_set_cutoff', () => {
    const sheet = new FakeSheet();
    seed(sheet, 2, '20.06.2026', 'Nowy', '  ');
    seed(sheet, 3, '10.06.2026', 'Inny', 'nie', 'Inny adres', 'Inna');

    const map = loadGas(sheet).buildBulkLastTransportDatesMap_();
    expect(map[KEY]).toEqual({ ms: NEWER, ktoOdbiera: 'Nowy' });
    expect(map['inna\0inny adres']).toBeUndefined();
  });
});
