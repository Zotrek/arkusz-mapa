import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

type Cell = string | number | null;

type Write = {
  row: number;
  col: number;
  numRows: number;
  numCols: number;
};

type Validation = {
  list: string[];
  allowInvalid: boolean;
  showDropdown: boolean;
  getCriteriaValues: () => string[][];
};

type ValidationSpan = {
  row: number;
  col: number;
  numRows: number;
  numCols: number;
  validation: Validation;
};

type StrikeRange = {
  row: number;
  col: number;
  numRows: number;
  numCols: number;
};

type StrikeRule = {
  formula: string;
  strikethrough: boolean;
  ranges: StrikeRange[];
  getBooleanCondition: () => { getCriteriaValues: () => string[] };
};

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

  setValues(values: Cell[][]): void {
    this.sheet.writes.push({
      row: this.row,
      col: this.col,
      numRows: values.length,
      numCols: values[0] ? values[0].length : 0,
    });
    for (let r = 0; r < values.length; r += 1) {
      for (let c = 0; c < values[r].length; c += 1) {
        this.sheet.put(this.row + r, this.col + c, values[r][c]);
      }
    }
  }

  setValue(value: Cell): void {
    this.setValues([[value]]);
  }

  getDataValidation(): Validation | null {
    return this.sheet.validationAt(this.row, this.col);
  }

  setDataValidation(validation: Validation): void {
    this.sheet.validations.push({
      row: this.row,
      col: this.col,
      numRows: this.numRows,
      numCols: this.numCols,
      validation,
    });
  }
}

class FakeSheet {
  private readonly cells = new Map<string, Cell>();
  readonly writes: Write[] = [];
  readonly validations: ValidationSpan[] = [];
  rules: StrikeRule[] = [];
  readonly maxRows = 100;

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

  getMaxRows(): number {
    return this.maxRows;
  }

  getRange(row: number, col: number, numRows?: number, numCols?: number): FakeRange {
    return new FakeRange(this, row, col, numRows ?? 1, numCols ?? 1);
  }

  appendRow(values: Cell[]): void {
    const row = this.getLastRow() + 1;
    for (let i = 0; i < values.length; i += 1) {
      this.put(row, i + 1, values[i]);
    }
  }

  getConditionalFormatRules(): StrikeRule[] {
    return this.rules.slice();
  }

  setConditionalFormatRules(rules: StrikeRule[]): void {
    this.rules = rules.slice();
  }

  validationAt(row: number, col: number): Validation | null {
    let found: Validation | null = null;
    for (const span of this.validations) {
      if (
        row >= span.row &&
        row < span.row + span.numRows &&
        col >= span.col &&
        col < span.col + span.numCols
      ) {
        found = span.validation;
      }
    }
    return found;
  }
}

type GasFns = {
  appendTransportRow_: (numer: string, body: Record<string, unknown>) => void;
};

const gsPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../google-apps-script/transport-log.gs',
);
const sheetDocPath = join(dirname(fileURLToPath(import.meta.url)), '../docs/TRANSPORT_SHEET.md');

function loadGas(sheet: FakeSheet): GasFns {
  const store = new Map<string, string>();
  const context: Record<string, unknown> = {
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return {
          getSheets() {
            return [sheet];
          },
        };
      },
      newDataValidation() {
        const state = { list: [] as string[], showDropdown: false, allowInvalid: true };
        const builder = {
          requireValueInList(list: string[], showDropdown: boolean) {
            state.list = list.slice();
            state.showDropdown = showDropdown;
            return builder;
          },
          setAllowInvalid(allowInvalid: boolean) {
            state.allowInvalid = allowInvalid;
            return builder;
          },
          build(): Validation {
            const list = state.list.slice();
            const allowInvalid = state.allowInvalid;
            const showDropdown = state.showDropdown;
            return {
              list,
              allowInvalid,
              showDropdown,
              getCriteriaValues() {
                return [list.slice()];
              },
            };
          },
        };
        return builder;
      },
      newConditionalFormatRule() {
        const state = {
          formula: '',
          strikethrough: false,
          ranges: [] as StrikeRange[],
        };
        const builder = {
          whenFormulaSatisfied(formula: string) {
            state.formula = formula;
            return builder;
          },
          setStrikethrough(value: boolean) {
            state.strikethrough = value;
            return builder;
          },
          setRanges(ranges: FakeRange[]) {
            state.ranges = ranges.map((range) => ({
              row: range.row,
              col: range.col,
              numRows: range.numRows,
              numCols: range.numCols,
            }));
            return builder;
          },
          build(): StrikeRule {
            const formula = state.formula;
            const strikethrough = state.strikethrough;
            const ranges = state.ranges.slice();
            return {
              formula,
              strikethrough,
              ranges,
              getBooleanCondition() {
                return {
                  getCriteriaValues() {
                    return [formula];
                  },
                };
              },
            };
          },
        };
        return builder;
      },
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key: string) {
            return store.has(key) ? store.get(key) : null;
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
  };
  runInNewContext(readFileSync(gsPath, 'utf8'), context);
  const append = context.appendTransportRow_;
  if (typeof append !== 'function') {
    throw new Error('transport-log.gs nie wystawił appendTransportRow_');
  }
  return { appendTransportRow_: append as GasFns['appendTransportRow_'] };
}

const HEADERS_12_18 = [
  'Trasa',
  'Stawka za trasę',
  'Rozliczony',
  'Numer faktury',
  'Koszt odbioru',
  'Koszt odbioru per worek',
  'transport się odbył',
];

function protocolBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    adresSklepu: 'ul. Testowa 1',
    podmiotHandlowy: 'Firma',
    sklep: 'Sklep',
    dataOdbioru: '19.09.2026',
    ktoOdbiera: 'Janex',
    miejsceZrzutu: 'Magazyn',
    rodzajZbiorki: 'ręczna',
    iloscWorkow: 2,
    komentarz1: '',
    komentarz2: 'k2',
    ...extra,
  };
}

function seedColumns1to11(sheet: FakeSheet): void {
  for (let col = 1; col <= 11; col += 1) {
    sheet.put(1, col, `H${col}`);
  }
}

describe('appendTransportRow_', () => {
  it('test_appendTransportRow_when_headers_empty_should_write_texts_12_to_18', () => {
    const sheet = new FakeSheet();
    seedColumns1to11(sheet);
    loadGas(sheet).appendTransportRow_('10', protocolBody());

    for (let i = 0; i < HEADERS_12_18.length; i += 1) {
      expect(sheet.cell(1, 12 + i)).toBe(HEADERS_12_18[i]);
    }
    for (let col = 1; col <= 11; col += 1) {
      expect(sheet.cell(1, col)).toBe(`H${col}`);
    }
    for (const write of sheet.writes) {
      expect(write.col).toBeGreaterThanOrEqual(12);
    }
    expect(sheet.cell(2, 1)).toBe('10');
    expect(sheet.cell(2, 11)).toBe('k2');
  });

  it('test_appendTransportRow_when_headers_filled_should_leave_them', () => {
    const sheet = new FakeSheet();
    seedColumns1to11(sheet);
    sheet.put(1, 12, 'Zostaw');
    for (let i = 1; i < HEADERS_12_18.length; i += 1) {
      sheet.put(1, 12 + i, HEADERS_12_18[i]);
    }
    loadGas(sheet).appendTransportRow_('11', protocolBody());

    expect(sheet.cell(1, 12)).toBe('Zostaw');
    expect(sheet.writes.filter((write) => write.row === 1)).toHaveLength(0);
  });

  it('test_appendTransportRow_when_some_headers_empty_should_fill_only_those', () => {
    const sheet = new FakeSheet();
    sheet.put(1, 12, 'Zostaw');
    loadGas(sheet).appendTransportRow_('12', protocolBody());

    expect(sheet.cell(1, 12)).toBe('Zostaw');
    expect(sheet.cell(1, 13)).toBe('Stawka za trasę');
    expect(sheet.cell(1, 18)).toBe('transport się odbył');
  });

  it('test_appendTransportRow_when_body_without_route_should_leave_columns_12_and_13_empty', () => {
    const sheet = new FakeSheet();
    loadGas(sheet).appendTransportRow_('13', protocolBody());

    expect(sheet.cell(1, 12)).toBe('Trasa');
    expect(sheet.cell(2, 12)).toBe('');
    expect(sheet.cell(2, 13)).toBe('');
    expect(sheet.cell(2, 11)).toBe('k2');
  });

  it('test_appendTransportRow_when_body_with_route_should_append_name_and_rate', () => {
    const sheet = new FakeSheet();
    loadGas(sheet).appendTransportRow_(
      '14',
      protocolBody({ trasa: '  gpw-18.09.26-01  ', stawkaTrasy: '  150  ' }),
    );

    expect(sheet.cell(2, 12)).toBe('gpw-18.09.26-01');
    expect(sheet.cell(2, 13)).toBe('150');
  });

  it('test_appendTransportRow_when_rate_is_zero_should_keep_zero', () => {
    const sheet = new FakeSheet();
    loadGas(sheet).appendTransportRow_('15', protocolBody({ trasa: 'trasa', stawkaTrasy: '0' }));

    expect(sheet.cell(2, 12)).toBe('trasa');
    expect(sheet.cell(2, 13)).toBe('0');
  });

  it('test_appendTransportRow_when_rate_empty_should_keep_column_13_empty', () => {
    const sheet = new FakeSheet();
    loadGas(sheet).appendTransportRow_(
      '16',
      protocolBody({ trasa: 'trasa', stawkaTrasy: '   ' }),
    );

    expect(sheet.cell(2, 12)).toBe('trasa');
    expect(sheet.cell(2, 13)).toBe('');
  });

  it('test_appendTransportRow_when_rate_empty_should_not_clear_same_route', () => {
    const sheet = new FakeSheet();
    for (let col = 1; col <= 18; col += 1) {
      sheet.put(1, col, 'h');
    }
    sheet.put(2, 12, 'GPW Iława-22.09.26-01');
    sheet.put(2, 13, '150');
    sheet.put(2, 14, '');

    loadGas(sheet).appendTransportRow_(
      '16b',
      protocolBody({ trasa: 'GPW Iława-22.09.26-01', stawkaTrasy: '' }),
    );

    expect(sheet.cell(2, 13)).toBe('150');
    expect(sheet.cell(3, 12)).toBe('GPW Iława-22.09.26-01');
    expect(sheet.cell(3, 13)).toBe('');
  });

  it('test_appendTransportRow_when_first_protocol_should_add_tak_nie_list_and_row_strike_once', () => {
    const sheet = new FakeSheet();
    const gas = loadGas(sheet);
    gas.appendTransportRow_('17', protocolBody());
    gas.appendTransportRow_('18', protocolBody());

    expect(sheet.validations).toHaveLength(1);
    const list = sheet.validations[0];
    expect(list.col).toBe(18);
    expect(list.numCols).toBe(1);
    expect(list.row).toBe(2);
    expect(list.validation.list).toEqual(['tak', 'nie']);
    expect(list.validation.showDropdown).toBe(true);
    expect(list.validation.allowInvalid).toBe(true);

    expect(sheet.rules).toHaveLength(1);
    const rule = sheet.rules[0];
    expect(rule.formula).toBe('=$R2="nie"');
    expect(rule.strikethrough).toBe(true);
    expect(rule.ranges[0]?.col).toBe(1);
    expect(rule.ranges[0]?.numCols).toBe(18);
    expect(rule.ranges[0]?.row).toBe(2);
  });

  it('test_appendTransportRow_when_rules_already_present_should_not_add_them_again', () => {
    const sheet = new FakeSheet();
    sheet.validations.push({
      row: 2,
      col: 18,
      numRows: 99,
      numCols: 1,
      validation: {
        list: ['tak', 'nie'],
        allowInvalid: true,
        showDropdown: true,
        getCriteriaValues() {
          return [['tak', 'nie']];
        },
      },
    });
    sheet.rules.push({
      formula: '=$R2="nie"',
      strikethrough: true,
      ranges: [],
      getBooleanCondition() {
        return {
          getCriteriaValues() {
            return ['=$R2="nie"'];
          },
        };
      },
    });
    loadGas(sheet).appendTransportRow_('19', protocolBody());

    expect(sheet.validations).toHaveLength(1);
    expect(sheet.rules).toHaveLength(1);
  });

  it('test_applyRouteRateToUnsettled_when_same_name_should_update_open_rows_only', () => {
    const sheet = new FakeSheet();
    for (let col = 1; col <= 18; col += 1) {
      sheet.put(1, col, col <= 11 ? `H${col}` : HEADERS_12_18[col - 12]);
    }
    const rows = [
      { row: 2, date: '01.01.2026', who: 'Janex', name: 'trasa-a', rate: '10', settled: '', c16: 'KEEP16', c17: 'KEEP17' },
      { row: 3, date: '02.02.2026', who: 'Inny', name: 'trasa-a', rate: '10', settled: 'TAK', c16: 'S16', c17: 'S17' },
      { row: 4, date: '03.03.2026', who: 'Trzeci', name: 'trasa-a', rate: '10', settled: '', c16: 'T16', c17: 'T17' },
      { row: 5, date: '01.01.2026', who: 'Janex', name: 'inna', rate: '99', settled: '', c16: 'I16', c17: 'I17' },
    ];
    for (const item of rows) {
      sheet.put(item.row, 5, item.date);
      sheet.put(item.row, 6, item.who);
      sheet.put(item.row, 12, item.name);
      sheet.put(item.row, 13, item.rate);
      sheet.put(item.row, 14, item.settled);
      sheet.put(item.row, 16, item.c16);
      sheet.put(item.row, 17, item.c17);
    }

    loadGas(sheet).appendTransportRow_(
      '20',
      protocolBody({
        ktoOdbiera: 'Ktoś inny',
        dataOdbioru: '19.09.2026',
        trasa: 'trasa-a',
        stawkaTrasy: '150',
      }),
    );

    expect(sheet.cell(2, 13)).toBe('150');
    expect(sheet.cell(3, 13)).toBe('10');
    expect(sheet.cell(4, 13)).toBe('150');
    expect(sheet.cell(5, 13)).toBe('99');
    expect(sheet.cell(6, 12)).toBe('trasa-a');
    expect(sheet.cell(6, 13)).toBe('150');
    expect(sheet.cell(2, 16)).toBe('KEEP16');
    expect(sheet.cell(2, 17)).toBe('KEEP17');
    expect(sheet.cell(3, 16)).toBe('S16');
    expect(sheet.cell(4, 17)).toBe('T17');
    expect(sheet.cell(5, 16)).toBe('I16');
    const dataWrites = sheet.writes.filter((write) => write.row >= 2);
    for (const write of dataWrites) {
      expect(write.col).toBe(13);
      expect(write.numCols).toBe(1);
    }
    expect(dataWrites.map((write) => write.row).sort()).toEqual([2, 4, 6]);
  });

  it('test_applyRouteRateToUnsettled_when_name_empty_should_not_touch_other_blank_names', () => {
    const sheet = new FakeSheet();
    for (let col = 1; col <= 18; col += 1) {
      sheet.put(1, col, 'h');
    }
    sheet.put(2, 12, '');
    sheet.put(2, 13, '10');
    sheet.put(2, 1, '1');

    loadGas(sheet).appendTransportRow_(
      '21',
      protocolBody({ trasa: '   ', stawkaTrasy: '5' }),
    );

    expect(sheet.cell(2, 13)).toBe('10');
    expect(sheet.cell(3, 12)).toBe('');
    expect(sheet.cell(3, 13)).toBe('5');
  });

  it('test_TRANSPORT_SHEET_should_describe_columns_12_to_18_and_body_fields', () => {
    const doc = readFileSync(sheetDocPath, 'utf8');
    for (const header of HEADERS_12_18) {
      expect(doc).toContain(header);
    }
    expect(doc).toContain('12. Trasa');
    expect(doc).toContain('18. transport się odbył');
    expect(doc).toContain('"trasa"');
    expect(doc).toContain('"stawkaTrasy"');
    expect(doc).toContain('tak');
    expect(doc).toContain('nie');
  });
});
