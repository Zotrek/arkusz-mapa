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

  getValue(): Cell {
    return this.sheet.cell(this.row, this.col);
  }

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

  setValue(value: Cell): void {
    this.sheet.put(this.row, this.col, value);
  }

  setValues(values: Cell[][]): void {
    for (let r = 0; r < values.length; r += 1) {
      for (let c = 0; c < values[r].length; c += 1) {
        this.sheet.put(this.row + r, this.col + c, values[r][c]);
      }
    }
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

type GasNumberFns = {
  computeNextNumber: () => number;
  allocateNextNumber_: () => number;
  resolveTransportNumber_: (body: Record<string, unknown>) => string | number;
};

/** Jak appendTransportRow_: po allocate numer ląduje w kolumnie 1. */
function commitNumber(sheet: FakeSheet, n: number): void {
  const row = Math.max(2, sheet.getLastRow() + 1);
  sheet.put(row, 1, n);
}

function loadGas(sheet: FakeSheet): GasNumberFns {
  const store = new Map<string, string>();
  const context: Record<string, unknown> = {
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return {
          getSheets() {
            return [sheet];
          },
          getSheetByName(name: string) {
            return name === 'Arkusz1' ? sheet : null;
          },
        };
      },
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key: string) {
            return store.has(key) ? store.get(key)! : null;
          },
          setProperty(key: string, value: string) {
            store.set(key, String(value));
          },
          deleteProperty(key: string) {
            store.delete(key);
          },
        };
      },
    },
    LockService: {
      getScriptLock() {
        return {
          waitLock() {},
          releaseLock() {},
        };
      },
    },
  };
  const gsPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '../google-apps-script/transport-log.gs',
  );
  runInNewContext(readFileSync(gsPath, 'utf8'), context);
  const compute = context.computeNextNumber;
  const allocate = context.allocateNextNumber_;
  const resolve = context.resolveTransportNumber_;
  if (typeof compute !== 'function' || typeof allocate !== 'function' || typeof resolve !== 'function') {
    throw new Error('transport-log.gs nie wystawił funkcji numeracji');
  }
  return {
    computeNextNumber: compute as GasNumberFns['computeNextNumber'],
    allocateNextNumber_: allocate as GasNumberFns['allocateNextNumber_'],
    resolveTransportNumber_: resolve as GasNumberFns['resolveTransportNumber_'],
  };
}

describe('transport number allocation', () => {
  it('test_computeNextNumber_when_empty_sheet_should_preview_1_without_advancing', () => {
    const sheet = new FakeSheet();
    const gas = loadGas(sheet);

    expect(gas.computeNextNumber()).toBe(1);
    expect(gas.computeNextNumber()).toBe(1);
  });

  it('test_allocateNextNumber_when_committed_should_return_1_then_2', () => {
    const sheet = new FakeSheet();
    const gas = loadGas(sheet);

    const first = gas.allocateNextNumber_();
    expect(first).toBe(1);
    commitNumber(sheet, first);

    const second = gas.allocateNextNumber_();
    expect(second).toBe(2);
    commitNumber(sheet, second);

    expect(gas.computeNextNumber()).toBe(3);
  });

  it('test_allocateNextNumber_when_sheet_has_max_should_continue_after_max', () => {
    const sheet = new FakeSheet();
    sheet.put(2, 1, 10);
    sheet.put(3, 1, 42);
    sheet.put(4, 1, 7);
    const gas = loadGas(sheet);

    expect(gas.computeNextNumber()).toBe(43);
    const next = gas.allocateNextNumber_();
    expect(next).toBe(43);
    commitNumber(sheet, next);
    expect(gas.allocateNextNumber_()).toBe(44);
  });

  it('test_allocateNextNumber_when_last_number_deleted_should_resync_from_sheet', () => {
    const sheet = new FakeSheet();
    sheet.put(2, 1, 5);
    sheet.put(3, 1, 10);
    const gas = loadGas(sheet);

    const allocated = gas.allocateNextNumber_();
    expect(allocated).toBe(11);
    commitNumber(sheet, allocated);
    expect(sheet.getLastRow()).toBe(4);
    sheet.put(4, 1, '');
    expect(gas.allocateNextNumber_()).toBe(11);
  });

  it('test_resolveTransportNumber_when_manual_higher_should_raise_stored_max', () => {
    const sheet = new FakeSheet();
    sheet.put(2, 1, 5);
    const gas = loadGas(sheet);

    expect(gas.resolveTransportNumber_({ numer: '20' })).toBe('20');
    commitNumber(sheet, 20);
    expect(gas.allocateNextNumber_()).toBe(21);
  });

  it('test_resolveTransportNumber_when_empty_manual_should_allocate', () => {
    const sheet = new FakeSheet();
    const gas = loadGas(sheet);

    const first = gas.resolveTransportNumber_({});
    expect(first).toBe(1);
    commitNumber(sheet, Number(first));

    expect(gas.resolveTransportNumber_({ numer: '  ' })).toBe(2);
  });
});
