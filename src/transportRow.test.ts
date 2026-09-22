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

  getValue(): Cell {
    return this.sheet.cell(this.row, this.col);
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

type SettlementResult = { ok: boolean; error?: string };

type GasFns = {
  appendTransportRow_: (numer: string, body: Record<string, unknown>) => void;
  listOccupiedRouteNames_: () => string[];
  routeRateByName_: (name: string) => string;
  patchRouteRate_: (body: Record<string, unknown>) => SettlementResult;
  detachRoute_: (body: Record<string, unknown>) => SettlementResult;
  attachRoute_: (body: Record<string, unknown>) => SettlementResult;
};

const gsPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../google-apps-script/transport-log.gs',
);
const sheetDocPath = join(dirname(fileURLToPath(import.meta.url)), '../docs/TRANSPORT_SHEET.md');

function loadGas(sheet: FakeSheet, rateSheet: FakeSheet | null = null): GasFns {
  const store = new Map<string, string>();
  const context: Record<string, unknown> = {
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return {
          getSheets() {
            return [sheet];
          },
          getSheetByName(name: string) {
            if (name === 'Arkusz1') {
              return sheet;
            }
            if (name === 'Baza stawek') {
              return rateSheet;
            }
            return null;
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
    LockService: {
      getScriptLock() {
        return {
          waitLock() {},
          releaseLock() {},
        };
      },
    },
  };
  runInNewContext(readFileSync(gsPath, 'utf8'), context);
  const append = context.appendTransportRow_;
  const occupied = context.listOccupiedRouteNames_;
  const rateByName = context.routeRateByName_;
  const patchRouteRate = context.patchRouteRate_;
  const detachRoute = context.detachRoute_;
  const attachRoute = context.attachRoute_;
  if (typeof append !== 'function') {
    throw new Error('transport-log.gs nie wystawił appendTransportRow_');
  }
  if (typeof occupied !== 'function') {
    throw new Error('transport-log.gs nie wystawił listOccupiedRouteNames_');
  }
  if (typeof rateByName !== 'function') {
    throw new Error('transport-log.gs nie wystawił routeRateByName_');
  }
  if (typeof patchRouteRate !== 'function') {
    throw new Error('transport-log.gs nie wystawił patchRouteRate_');
  }
  if (typeof detachRoute !== 'function') {
    throw new Error('transport-log.gs nie wystawił detachRoute_');
  }
  if (typeof attachRoute !== 'function') {
    throw new Error('transport-log.gs nie wystawił attachRoute_');
  }
  return {
    appendTransportRow_: append as GasFns['appendTransportRow_'],
    listOccupiedRouteNames_: occupied as GasFns['listOccupiedRouteNames_'],
    routeRateByName_: rateByName as GasFns['routeRateByName_'],
    patchRouteRate_: patchRouteRate as GasFns['patchRouteRate_'],
    detachRoute_: detachRoute as GasFns['detachRoute_'],
    attachRoute_: attachRoute as GasFns['attachRoute_'],
  };
}

/** Wiersz danych: kolumna 10 = trasa, 11 = stawka, 14 = rozliczony. */
function seedRouteRow(
  sheet: FakeSheet,
  row: number,
  name: Cell,
  rate: Cell = '',
  settled: Cell = '',
): void {
  sheet.put(row, 1, String(row - 1));
  sheet.put(row, 10, name);
  sheet.put(row, 11, rate);
  sheet.put(row, 14, settled);
}

/**
 * Pełniejszy wiersz rejestru pod zapisy settlement (klucz: sheetRow + numer kol. 1).
 * Kolumny 16–17 = koszt — settlement write nie może ich ruszyć.
 */
function seedSettlementRow(
  sheet: FakeSheet,
  row: number,
  over: Partial<Record<number, Cell>> = {},
): void {
  const cols: Cell[] = [
    15,
    'Sklepowa 1',
    'Firma',
    'Sklep',
    '18.09.2026',
    'gpw',
    '',
    '',
    2,
    'trasa-a',
    '150',
    '',
    '',
    '',
    '',
    '999',
    '111',
    '',
  ];
  for (let i = 0; i < cols.length; i += 1) {
    sheet.put(row, i + 1, cols[i]);
  }
  for (const [key, value] of Object.entries(over)) {
    sheet.put(row, Number(key), value);
  }
}

function expectCostsUntouched(sheet: FakeSheet, rows: number[]): void {
  for (const row of rows) {
    expect(sheet.cell(row, 16)).toBe('999');
    expect(sheet.cell(row, 17)).toBe('111');
  }
  for (const write of sheet.writes) {
    const end = write.col + write.numCols - 1;
    expect(end < 16 || write.col > 17).toBe(true);
  }
}

const HEADERS_10_20 = [
  'Trasa',
  'Stawka za trasę',
  'Stawka za podjazd',
  'Stawka za worek',
  'Rozliczony',
  'Numer faktury',
  'Koszt odbioru',
  'Koszt odbioru per worek',
  'transport się odbył',
  'Komentarz 1',
  'Komentarz 2',
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

function seedColumns1to9(sheet: FakeSheet): void {
  for (let col = 1; col <= 9; col += 1) {
    sheet.put(1, col, `H${col}`);
  }
}

function seedRate(
  sheet: FakeSheet,
  row: number,
  shop: string,
  contractor: string,
  pickup: Cell,
  bag: Cell,
  from = '',
): void {
  sheet.put(1, 1, 'Sklep');
  sheet.put(row, 1, shop);
  sheet.put(row, 2, contractor);
  sheet.put(row, 3, pickup);
  sheet.put(row, 4, bag);
  sheet.put(row, 5, from);
}

describe('appendTransportRow_', () => {
  it('test_appendTransportRow_when_headers_empty_should_write_texts_10_to_20', () => {
    const sheet = new FakeSheet();
    seedColumns1to9(sheet);
    loadGas(sheet).appendTransportRow_('10', protocolBody());

    for (let i = 0; i < HEADERS_10_20.length; i += 1) {
      expect(sheet.cell(1, 10 + i)).toBe(HEADERS_10_20[i]);
    }
    for (let col = 1; col <= 9; col += 1) {
      expect(sheet.cell(1, col)).toBe(`H${col}`);
    }
    for (const write of sheet.writes) {
      expect(write.col).toBeGreaterThanOrEqual(10);
    }
    expect(sheet.cell(2, 1)).toBe('10');
    expect(sheet.cell(2, 20)).toBe('k2');
  });

  it('test_appendTransportRow_when_headers_filled_should_leave_them', () => {
    const sheet = new FakeSheet();
    seedColumns1to9(sheet);
    sheet.put(1, 10, 'Zostaw');
    for (let i = 1; i < HEADERS_10_20.length; i += 1) {
      sheet.put(1, 10 + i, HEADERS_10_20[i]);
    }
    loadGas(sheet).appendTransportRow_('11', protocolBody());

    expect(sheet.cell(1, 10)).toBe('Zostaw');
    expect(sheet.writes.filter((write) => write.row === 1)).toHaveLength(0);
  });

  it('test_appendTransportRow_when_some_headers_empty_should_fill_only_those', () => {
    const sheet = new FakeSheet();
    sheet.put(1, 10, 'Zostaw');
    loadGas(sheet).appendTransportRow_('12', protocolBody());

    expect(sheet.cell(1, 10)).toBe('Zostaw');
    expect(sheet.cell(1, 11)).toBe('Stawka za trasę');
    expect(sheet.cell(1, 12)).toBe('Stawka za podjazd');
    expect(sheet.cell(1, 18)).toBe('transport się odbył');
    expect(sheet.cell(1, 20)).toBe('Komentarz 2');
  });

  it('test_appendTransportRow_when_body_without_route_should_leave_route_empty_and_put_comments_at_end', () => {
    const sheet = new FakeSheet();
    loadGas(sheet).appendTransportRow_('13', protocolBody());

    expect(sheet.cell(1, 10)).toBe('Trasa');
    expect(sheet.cell(2, 10)).toBe('');
    expect(sheet.cell(2, 11)).toBe('');
    expect(sheet.cell(2, 12)).toBe('');
    expect(sheet.cell(2, 13)).toBe('');
    expect(sheet.cell(2, 20)).toBe('k2');
  });

  it('test_appendTransportRow_when_body_with_route_should_append_name_and_rate', () => {
    const sheet = new FakeSheet();
    loadGas(sheet).appendTransportRow_(
      '14',
      protocolBody({ trasa: '  gpw-18.09.26-01  ', stawkaTrasy: '  150  ' }),
    );

    expect(sheet.cell(2, 10)).toBe('gpw-18.09.26-01');
    expect(sheet.cell(2, 11)).toBe('150');
  });

  it('test_appendTransportRow_when_rate_is_zero_should_keep_zero', () => {
    const sheet = new FakeSheet();
    loadGas(sheet).appendTransportRow_('15', protocolBody({ trasa: 'trasa', stawkaTrasy: '0' }));

    expect(sheet.cell(2, 10)).toBe('trasa');
    expect(sheet.cell(2, 11)).toBe('0');
  });

  it('test_appendTransportRow_when_rate_empty_should_keep_column_11_empty', () => {
    const sheet = new FakeSheet();
    loadGas(sheet).appendTransportRow_(
      '16',
      protocolBody({ trasa: 'trasa', stawkaTrasy: '   ' }),
    );

    expect(sheet.cell(2, 10)).toBe('trasa');
    expect(sheet.cell(2, 11)).toBe('');
  });

  it('test_appendTransportRow_snapshots_pickup_and_bag_from_baza_stawek', () => {
    const sheet = new FakeSheet();
    const rates = new FakeSheet();
    seedRate(rates, 2, 'ul. Testowa 1', 'Janex', 20, '1,5', '');
    loadGas(sheet, rates).appendTransportRow_('16c', protocolBody());

    expect(sheet.cell(2, 12)).toBe(20);
    expect(sheet.cell(2, 13)).toBe('1,5');
  });

  it('test_appendTransportRow_when_rate_tie_leaves_snapshot_empty', () => {
    const sheet = new FakeSheet();
    const rates = new FakeSheet();
    seedRate(rates, 2, 'ul. Testowa 1', 'Janex', 20, 10, '');
    seedRate(rates, 3, 'ul. Testowa 1', 'Janex', 30, 15, '');
    loadGas(sheet, rates).appendTransportRow_('16d', protocolBody());

    expect(sheet.cell(2, 12)).toBe('');
    expect(sheet.cell(2, 13)).toBe('');
  });

  it('test_appendTransportRow_when_rate_empty_should_not_clear_same_route', () => {
    const sheet = new FakeSheet();
    for (let col = 1; col <= 20; col += 1) {
      sheet.put(1, col, 'h');
    }
    sheet.put(2, 10, 'GPW Iława-22.09.26-01');
    sheet.put(2, 11, '150');
    sheet.put(2, 14, '');

    loadGas(sheet).appendTransportRow_(
      '16b',
      protocolBody({ trasa: 'GPW Iława-22.09.26-01', stawkaTrasy: '' }),
    );

    expect(sheet.cell(2, 11)).toBe('150');
    expect(sheet.cell(3, 10)).toBe('GPW Iława-22.09.26-01');
    expect(sheet.cell(3, 11)).toBe('');
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
    for (let col = 1; col <= 9; col += 1) {
      sheet.put(1, col, `H${col}`);
    }
    for (let i = 0; i < HEADERS_10_20.length; i += 1) {
      sheet.put(1, 10 + i, HEADERS_10_20[i]);
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
      sheet.put(item.row, 10, item.name);
      sheet.put(item.row, 11, item.rate);
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

    expect(sheet.cell(2, 11)).toBe('150');
    expect(sheet.cell(3, 11)).toBe('10');
    expect(sheet.cell(4, 11)).toBe('150');
    expect(sheet.cell(5, 11)).toBe('99');
    expect(sheet.cell(6, 10)).toBe('trasa-a');
    expect(sheet.cell(6, 11)).toBe('150');
    expect(sheet.cell(2, 16)).toBe('KEEP16');
    expect(sheet.cell(2, 17)).toBe('KEEP17');
    expect(sheet.cell(3, 16)).toBe('S16');
    expect(sheet.cell(4, 17)).toBe('T17');
    expect(sheet.cell(5, 16)).toBe('I16');
    const dataWrites = sheet.writes.filter((write) => write.row >= 2);
    for (const write of dataWrites) {
      expect(write.col).toBe(11);
      expect(write.numCols).toBe(1);
    }
    expect(dataWrites.map((write) => write.row).sort()).toEqual([2, 4, 6]);
  });

  it('test_applyRouteRateToUnsettled_when_name_empty_should_not_touch_other_blank_names', () => {
    const sheet = new FakeSheet();
    for (let col = 1; col <= 20; col += 1) {
      sheet.put(1, col, 'h');
    }
    sheet.put(2, 10, '');
    sheet.put(2, 11, '10');
    sheet.put(2, 1, '1');

    loadGas(sheet).appendTransportRow_(
      '21',
      protocolBody({ trasa: '   ', stawkaTrasy: '5' }),
    );

    expect(sheet.cell(2, 11)).toBe('10');
    expect(sheet.cell(3, 10)).toBe('');
    expect(sheet.cell(3, 11)).toBe('5');
  });

  it('test_TRANSPORT_SHEET_should_describe_columns_10_to_20_and_body_fields', () => {
    const doc = readFileSync(sheetDocPath, 'utf8');
    for (const header of HEADERS_10_20) {
      expect(doc).toContain(header);
    }
    expect(doc).toContain('10. Trasa');
    expect(doc).toContain('12. Stawka za podjazd');
    expect(doc).toContain('18. transport się odbył');
    expect(doc).toContain('19. Komentarz 1');
    expect(doc).toContain('"trasa"');
    expect(doc).toContain('"stawkaTrasy"');
    expect(doc).toContain('tak');
    expect(doc).toContain('nie');
  });
});

describe('listOccupiedRouteNames_', () => {
  it('test_listOccupiedRouteNames_when_no_data_rows_should_return_empty', () => {
    const sheet = new FakeSheet();
    sheet.put(1, 10, 'Trasa');

    expect(loadGas(sheet).listOccupiedRouteNames_()).toEqual([]);
  });

  it('test_listOccupiedRouteNames_when_names_in_column_10_should_return_unique_in_order', () => {
    const sheet = new FakeSheet();
    seedRouteRow(sheet, 2, 'gpw-18.09.26-01');
    seedRouteRow(sheet, 3, '  gpw-18.09.26-02  ');
    seedRouteRow(sheet, 4, 'gpw-18.09.26-01');
    seedRouteRow(sheet, 5, '');
    seedRouteRow(sheet, 6, '   ');
    seedRouteRow(sheet, 7, 'inna');
    // Fałszywa „trasa” w innej kolumnie — odczyt musi brać tylko kolumnę 10
    sheet.put(2, 9, 'nie-ta-kolumna');
    sheet.put(2, 11, 'nie-ta-kolumna');

    expect(loadGas(sheet).listOccupiedRouteNames_()).toEqual([
      'gpw-18.09.26-01',
      'gpw-18.09.26-02',
      'inna',
    ]);
  });

  it('test_listOccupiedRouteNames_when_duplicate_with_spaces_should_dedupe_after_trim', () => {
    const sheet = new FakeSheet();
    seedRouteRow(sheet, 2, 'Papirus-21.09.26-01');
    seedRouteRow(sheet, 3, '  Papirus-21.09.26-01  ');

    expect(loadGas(sheet).listOccupiedRouteNames_()).toEqual(['Papirus-21.09.26-01']);
  });
});

describe('routeRateByName_', () => {
  it('test_routeRateByName_when_name_blank_or_sheet_empty_should_return_empty', () => {
    const sheet = new FakeSheet();
    sheet.put(1, 10, 'Trasa');
    const gas = loadGas(sheet);

    expect(gas.routeRateByName_('')).toBe('');
    expect(gas.routeRateByName_('   ')).toBe('');
    expect(gas.routeRateByName_('brak')).toBe('');
  });

  it('test_routeRateByName_when_last_unsettled_match_should_win', () => {
    const sheet = new FakeSheet();
    seedRouteRow(sheet, 2, 'trasa-a', '10', '');
    seedRouteRow(sheet, 3, 'trasa-a', '20', '');
    seedRouteRow(sheet, 4, 'inna', '99', '');

    expect(loadGas(sheet).routeRateByName_('trasa-a')).toBe('20');
  });

  it('test_routeRateByName_when_settled_tak_should_skip_and_keep_earlier_unsettled', () => {
    const sheet = new FakeSheet();
    seedRouteRow(sheet, 2, 'trasa-a', '10', '');
    seedRouteRow(sheet, 3, 'trasa-a', '999', 'TAK');
    seedRouteRow(sheet, 4, 'trasa-a', '30', ' tak ');

    expect(loadGas(sheet).routeRateByName_('  trasa-a  ')).toBe('10');
  });

  it('test_routeRateByName_when_all_matches_settled_should_return_empty', () => {
    const sheet = new FakeSheet();
    seedRouteRow(sheet, 2, 'trasa-a', '10', 'tak');
    seedRouteRow(sheet, 3, 'trasa-a', '20', 'TAK');

    expect(loadGas(sheet).routeRateByName_('trasa-a')).toBe('');
  });

  it('test_routeRateByName_when_rate_zero_should_keep_zero_and_empty_rate_stays_empty', () => {
    const sheet = new FakeSheet();
    seedRouteRow(sheet, 2, 'zero', 0, '');
    seedRouteRow(sheet, 3, 'pusta', '', '');
    seedRouteRow(sheet, 4, 'pusta', null, '');

    const gas = loadGas(sheet);
    expect(gas.routeRateByName_('zero')).toBe('0');
    expect(gas.routeRateByName_('pusta')).toBe('');
  });

  it('test_routeRateByName_when_nie_or_blank_settled_should_not_skip', () => {
    const sheet = new FakeSheet();
    seedRouteRow(sheet, 2, 'trasa-a', '10', 'nie');
    seedRouteRow(sheet, 3, 'trasa-a', '20', '');

    expect(loadGas(sheet).routeRateByName_('trasa-a')).toBe('20');
  });

  it('test_routeRateByName_reads_rate_from_column_11_not_neighbors', () => {
    const sheet = new FakeSheet();
    seedRouteRow(sheet, 2, 'trasa-a', '150', '');
    sheet.put(2, 10, 'trasa-a');
    sheet.put(2, 9, 'WRONG9');
    sheet.put(2, 12, 'WRONG12');
    sheet.put(2, 14, '');

    expect(loadGas(sheet).routeRateByName_('trasa-a')).toBe('150');
  });
});

describe('patchRouteRate_', () => {
  it('test_patchRouteRate_when_same_name_should_update_unsettled_skip_settled', () => {
    const sheet = new FakeSheet();
    seedSettlementRow(sheet, 2);
    seedSettlementRow(sheet, 3, { 1: 16, 5: '01.01.2026', 6: 'inny', 11: '10' });
    seedSettlementRow(sheet, 4, { 1: 17, 11: '77', 14: 'tak' });
    seedSettlementRow(sheet, 5, { 1: 18, 10: 'inna', 11: '5' });

    const result = loadGas(sheet).patchRouteRate_({
      sheetRow: 2,
      transportNumber: '15',
      trasa: 'trasa-a',
      stawkaTrasy: '200',
    });

    expect(result).toEqual({ ok: true });
    expect(sheet.cell(2, 11)).toBe('200');
    expect(sheet.cell(3, 11)).toBe('200');
    expect(sheet.cell(4, 11)).toBe('77');
    expect(sheet.cell(5, 11)).toBe('5');
    expect(sheet.cell(2, 10)).toBe('trasa-a');
    expectCostsUntouched(sheet, [2, 3, 4, 5]);
  });

  it('test_patchRouteRate_when_zero_or_empty_should_write_zero_or_clear', () => {
    const sheet = new FakeSheet();
    seedSettlementRow(sheet, 2);
    const gas = loadGas(sheet);

    expect(
      gas.patchRouteRate_({
        sheetRow: 2,
        transportNumber: '15',
        trasa: 'trasa-a',
        stawkaTrasy: 0,
      }),
    ).toEqual({ ok: true });
    expect(sheet.cell(2, 11)).toBe('0');

    expect(
      gas.patchRouteRate_({
        sheetRow: 2,
        transportNumber: '15',
        trasa: 'trasa-a',
        stawkaTrasy: '',
      }),
    ).toEqual({ ok: true });
    expect(sheet.cell(2, 11)).toBe('');
    expectCostsUntouched(sheet, [2]);
  });

  it('test_patchRouteRate_when_key_mismatch_or_settled_should_write_nothing', () => {
    const sheet = new FakeSheet();
    seedSettlementRow(sheet, 2);
    seedSettlementRow(sheet, 3, { 1: 16, 11: '10' });
    seedSettlementRow(sheet, 4, { 1: 17, 14: 'tak' });
    const gas = loadGas(sheet);

    expect(
      gas.patchRouteRate_({
        sheetRow: 2,
        transportNumber: '16',
        trasa: 'trasa-a',
        stawkaTrasy: '200',
      }),
    ).toEqual({ ok: false, error: 'key' });
    expect(
      gas.patchRouteRate_({
        sheetRow: 4,
        transportNumber: '17',
        trasa: 'trasa-a',
        stawkaTrasy: '200',
      }),
    ).toEqual({ ok: false, error: 'settled' });
    expect(sheet.writes).toEqual([]);
    expect(sheet.cell(2, 11)).toBe('150');
    expect(sheet.cell(3, 11)).toBe('10');
  });
});

describe('detachRoute_', () => {
  it('test_detachRoute_when_ok_should_clear_one_row_and_leave_rest_of_route', () => {
    const sheet = new FakeSheet();
    seedSettlementRow(sheet, 2);
    seedSettlementRow(sheet, 3, { 1: 16 });

    expect(
      loadGas(sheet).detachRoute_({ sheetRow: 2, transportNumber: '15' }),
    ).toEqual({ ok: true });
    expect(sheet.cell(2, 10)).toBe('');
    expect(sheet.cell(2, 11)).toBe('');
    expect(sheet.cell(3, 10)).toBe('trasa-a');
    expect(sheet.cell(3, 11)).toBe('150');
    expect(sheet.cell(2, 9)).toBe(2);
    expectCostsUntouched(sheet, [2, 3]);
  });

  it('test_detachRoute_when_key_mismatch_should_write_nothing', () => {
    const sheet = new FakeSheet();
    seedSettlementRow(sheet, 2);

    expect(
      loadGas(sheet).detachRoute_({ sheetRow: 9, transportNumber: '15' }),
    ).toEqual({ ok: false, error: 'key' });
    expect(sheet.writes).toEqual([]);
    expect(sheet.cell(2, 10)).toBe('trasa-a');
    expectCostsUntouched(sheet, [2]);
  });
});

describe('attachRoute_', () => {
  it('test_attachRoute_when_zero_rate_should_write_and_propagate_by_name', () => {
    const sheet = new FakeSheet();
    seedSettlementRow(sheet, 2, { 10: '', 11: '' });
    seedSettlementRow(sheet, 3, { 1: 16, 6: 'inny', 10: 'nowa', 11: '10' });
    seedSettlementRow(sheet, 4, { 1: 17, 10: 'nowa', 11: '77', 14: 'tak' });

    const result = loadGas(sheet).attachRoute_({
      sheetRow: 2,
      transportNumber: '15',
      trasa: '  nowa  ',
      stawkaTrasy: '0',
    });

    expect(result).toEqual({ ok: true });
    expect(sheet.cell(2, 10)).toBe('nowa');
    expect(sheet.cell(2, 11)).toBe('0');
    expect(sheet.cell(3, 10)).toBe('nowa');
    expect(sheet.cell(3, 11)).toBe('0');
    expect(sheet.cell(4, 11)).toBe('77');
    expectCostsUntouched(sheet, [2, 3, 4]);
  });

  it('test_attachRoute_when_empty_rate_or_name_should_write_nothing', () => {
    const sheet = new FakeSheet();
    seedSettlementRow(sheet, 2, { 10: '', 11: '' });
    const gas = loadGas(sheet);

    expect(
      gas.attachRoute_({
        sheetRow: 2,
        transportNumber: '15',
        trasa: 'nowa',
        stawkaTrasy: '',
      }),
    ).toEqual({ ok: false, error: 'rate' });
    expect(
      gas.attachRoute_({
        sheetRow: 2,
        transportNumber: '15',
        trasa: ' ',
        stawkaTrasy: '0',
      }),
    ).toEqual({ ok: false, error: 'name' });
    expect(sheet.writes).toEqual([]);
    expect(sheet.cell(2, 10)).toBe('');
    expect(sheet.cell(2, 11)).toBe('');
    expectCostsUntouched(sheet, [2]);
  });

  it('test_attachRoute_when_key_mismatch_should_write_nothing', () => {
    const sheet = new FakeSheet();
    seedSettlementRow(sheet, 2, { 10: '', 11: '' });

    expect(
      loadGas(sheet).attachRoute_({
        sheetRow: 2,
        transportNumber: '99',
        trasa: 'nowa',
        stawkaTrasy: '0',
      }),
    ).toEqual({ ok: false, error: 'key' });
    expect(sheet.writes).toEqual([]);
    expect(sheet.cell(2, 10)).toBe('');
  });
});
