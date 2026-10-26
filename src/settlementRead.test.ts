/**
 * Odczyt settlementSearch / settlementStats z transport-log.gs.
 * Na zgłoszenie nic nie zapisuje. Harmonogram zapisuje kolumny 12–13 pod lockiem.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';

type Cell = string | number | null | Date;

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

  setValue(value: Cell): void {
    this.setValues([[value]]);
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
  constructor(readonly name = 'Arkusz1') {}

  getName(): string {
    return this.name;
  }

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

  getLastColumn(): number {
    let max = 0;
    for (const [key, value] of this.cells) {
      if (value == null || value === '') {
        continue;
      }
      const col = Number(key.split(',')[1]);
      if (col > max) {
        max = col;
      }
    }
    return max;
  }

  getRange(row: number, col: number, numRows?: number, numCols?: number): FakeRange {
    return new FakeRange(this, row, col, numRows ?? 1, numCols ?? 1);
  }
}

type SettlementOk = {
  ok: true;
  rows: Record<string, unknown>[];
  rates: Record<string, unknown>[];
};

type SettlementErr = { ok: false; error: string };
type SettlementResult = SettlementOk | SettlementErr;

type GasFns = {
  settlementSearch_: (query: Record<string, unknown>) => SettlementResult;
  settlementInvoices_: (query: Record<string, unknown>) => SettlementResult;
  settlementStats_: (query: Record<string, unknown>) => SettlementResult;
  doGet: (e: { parameter: Record<string, string> }) => unknown;
  buildSettlementRead_: (
    query: Record<string, unknown>,
    register: { sheetRow: number; cells: Cell[] }[],
    rates: { sheetRow: number; cells: Cell[] }[],
  ) => SettlementResult;
  buildSettlementStats_: (
    query: Record<string, unknown>,
    register: { sheetRow: number; cells: Cell[] }[],
    rates: { sheetRow: number; cells: Cell[] }[],
    odebrane?: { headers: string[]; rows: Cell[][] },
  ) => SettlementResult;
  buildSettlementHarmonogramRead_: (
    query: Record<string, unknown>,
    register: { sheetRow: number; cells: Cell[] }[],
    bazaCen: { sheetRow: number; cells: Cell[] }[],
  ) => SettlementResult;
  buildScheduleSyncExpected_: (
    dataOd: string,
    dataDo: string,
    bazaCen: { sheetRow: number; cells: Cell[] }[],
    odebrane: { headers: string[]; rows: Cell[][] },
  ) => Record<string, unknown>[];
  planOffScheduleCleanup_: (
    bazaCen: { sheetRow: number; cells: Cell[] }[],
    existingRows: Record<string, unknown>[],
    scheduledByKey: Record<string, { bagCount: number; rodzajZbiorki: string }>,
  ) => {
    absorb: Array<{ bagCount: number; rodzajZbiorki: string; sheetRow: number }>;
    remove: Array<{ sheetRow: number }>;
    skippedSettled: number;
    skippedTargetSettled: number;
  };
  resolveHarmonogramSnapshot_: (
    rates: Record<string, unknown>[],
    shop: string,
    contractor: string,
    pickupDate: string,
  ) => { routeName: string; route: unknown; pickup: unknown; bag: unknown };
  writeHarmonogramSearchRates_: (rows: Record<string, unknown>[]) => void;
  approveZlotyFromGrosze_: (grosze: number) => number;
  harmonogramSearchRateWrites_: (
    rows: Record<string, unknown>[],
    fresh: Array<{ sheetName: string; startRow: number; values: Cell[][] }>,
  ) => Array<{ sheetName: string; sheetRow: number; values: Array<number | string> }>;
  harmonogramSearchRateRanges_: (
    writes: Array<{ sheetName: string; sheetRow: number; values: Array<number | string> }>,
  ) => Array<{ range: string; values: Array<Array<number | string>> }>;
};

const gsPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../google-apps-script/transport-log.gs',
);
const gs = readFileSync(gsPath, 'utf8');

const holder: {
  register: FakeSheet;
  rates: FakeSheet | null;
  odebrane: FakeSheet | null;
  schedule: FakeSheet | null;
  bazaCen: FakeSheet | null;
  extra: FakeSheet[];
  batchCode: number;
  batchThrow: boolean;
  lastBatch: {
    url: string;
    headers: Record<string, string>;
    body: {
      valueInputOption?: string;
      data?: Array<{ range: string; values: Cell[][] }>;
    };
  } | null;
} = {
  register: new FakeSheet('Arkusz1'),
  rates: null,
  odebrane: null,
  schedule: null,
  bazaCen: null,
  extra: [],
  batchCode: 200,
  batchThrow: false,
  lastBatch: null,
};

function findHolderSheet(name: string): FakeSheet | null {
  if (name === holder.register.name) {
    return holder.register;
  }
  if (name === 'Baza stawek') {
    return holder.rates;
  }
  if (name === 'Baza cen harmonogram') {
    return holder.bazaCen;
  }
  if (name === 'odebrane z harmonogramu') {
    return holder.odebrane;
  }
  if (holder.schedule && name === holder.schedule.name) {
    return holder.schedule;
  }
  return holder.extra.find((sheet) => sheet.name === name) ?? null;
}

function columnNumber(letters: string): number {
  let n = 0;
  for (const ch of letters) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

function applyHarmonogramBatch(data: Array<{ range: string; values: Cell[][] }> | undefined): void {
  for (const item of data ?? []) {
    const match = /^'((?:[^']|'')*)'!([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(item.range);
    if (!match) {
      return;
    }
    const sheet = findHolderSheet(match[1].replace(/''/g, "'"));
    if (!sheet) {
      return;
    }
    const row = Number(match[3]);
    const col = columnNumber(match[2]);
    for (let r = 0; r < item.values.length; r += 1) {
      for (let c = 0; c < item.values[r].length; c += 1) {
        sheet.put(row + r, col + c, item.values[r][c]);
      }
    }
  }
}

let lastBody = '';
let gas: GasFns;
const TEST_GAS_SECRET = 'test-gas-secret';

beforeAll(() => {
  const props = new Map<string, string>([['GAS_SHARED_SECRET', TEST_GAS_SECRET]]);
  const context: Record<string, unknown> = {
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return {
          getId() {
            return 'ss-test';
          },
          getSheets() {
            const out: FakeSheet[] = [holder.register];
            if (holder.schedule) {
              out.push(holder.schedule);
            }
            for (const sheet of holder.extra) {
              out.push(sheet);
            }
            return out;
          },
          getSheetByName(name: string) {
            return findHolderSheet(name);
          },
        };
      },
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key: string) {
            return props.has(key) ? props.get(key)! : null;
          },
          setProperty(key: string, value: string) {
            props.set(key, String(value));
          },
          deleteProperty(key: string) {
            props.delete(key);
          },
        };
      },
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(text: string) {
        lastBody = text;
        return {
          setMimeType() {
            return this;
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
    ScriptApp: {
      getOAuthToken() {
        return 'oauth-test';
      },
    },
    UrlFetchApp: {
      fetch(url: string, options: { payload?: string; headers?: Record<string, string> }) {
        if (holder.batchThrow) {
          throw new Error('batch-down');
        }
        const body = JSON.parse(String(options.payload ?? '{}')) as {
          valueInputOption?: string;
          data?: Array<{ range: string; values: Cell[][] }>;
        };
        holder.lastBatch = {
          url: String(url),
          headers: options.headers ?? {},
          body,
        };
        const code = holder.batchCode;
        if (code >= 200 && code < 300) {
          applyHarmonogramBatch(body.data);
        }
        return {
          getResponseCode() {
            return code;
          },
          getContentText() {
            return '';
          },
        };
      },
    },
  };
  runInNewContext(gs, context);
  const search = context.settlementSearch_;
  const invoices = context.settlementInvoices_;
  const stats = context.settlementStats_;
  const doGet = context.doGet;
  const buildRead = context.buildSettlementRead_;
  const buildStats = context.buildSettlementStats_;
  const buildHarm = context.buildSettlementHarmonogramRead_;
  const buildSync = context.buildScheduleSyncExpected_;
  const planCleanup = context.planOffScheduleCleanup_;
  const resolveSnap = context.resolveHarmonogramSnapshot_;
  const writeRates = context.writeHarmonogramSearchRates_;
  const zloty = context.approveZlotyFromGrosze_;
  const rateWrites = context.harmonogramSearchRateWrites_;
  const rateRanges = context.harmonogramSearchRateRanges_;
  if (
    typeof search !== 'function' ||
    typeof invoices !== 'function' ||
    typeof stats !== 'function' ||
    typeof doGet !== 'function' ||
    typeof buildRead !== 'function' ||
    typeof buildStats !== 'function' ||
    typeof buildHarm !== 'function' ||
    typeof buildSync !== 'function' ||
    typeof planCleanup !== 'function' ||
    typeof resolveSnap !== 'function' ||
    typeof writeRates !== 'function' ||
    typeof zloty !== 'function' ||
    typeof rateWrites !== 'function' ||
    typeof rateRanges !== 'function'
  ) {
    throw new Error('transport-log.gs nie wystawił settlementSearch/settlementStats');
  }
  gas = {
    settlementSearch_: search as GasFns['settlementSearch_'],
    settlementInvoices_: invoices as GasFns['settlementInvoices_'],
    settlementStats_: stats as GasFns['settlementStats_'],
    doGet: doGet as GasFns['doGet'],
    buildSettlementRead_: buildRead as GasFns['buildSettlementRead_'],
    buildSettlementStats_: buildStats as GasFns['buildSettlementStats_'],
    buildSettlementHarmonogramRead_: buildHarm as GasFns['buildSettlementHarmonogramRead_'],
    buildScheduleSyncExpected_: buildSync as GasFns['buildScheduleSyncExpected_'],
    planOffScheduleCleanup_: planCleanup as GasFns['planOffScheduleCleanup_'],
    resolveHarmonogramSnapshot_: resolveSnap as GasFns['resolveHarmonogramSnapshot_'],
    writeHarmonogramSearchRates_: writeRates as GasFns['writeHarmonogramSearchRates_'],
    approveZlotyFromGrosze_: zloty as GasFns['approveZlotyFromGrosze_'],
    harmonogramSearchRateWrites_: rateWrites as GasFns['harmonogramSearchRateWrites_'],
    harmonogramSearchRateRanges_: rateRanges as GasFns['harmonogramSearchRateRanges_'],
  };
});

function fresh(withRates = true): { register: FakeSheet; rates: FakeSheet | null; odebrane: FakeSheet } {
  const register = new FakeSheet('Arkusz1');
  const rates = withRates ? new FakeSheet('Baza stawek') : null;
  const odebrane = new FakeSheet('odebrane z harmonogramu');
  holder.register = register;
  holder.rates = rates;
  holder.odebrane = odebrane;
  holder.schedule = new FakeSheet('zestawienie z harmonogramu');
  holder.bazaCen = null;
  holder.extra = [];
  holder.batchCode = 200;
  holder.batchThrow = false;
  holder.lastBatch = null;
  return { register, rates, odebrane };
}

/** Kolumny 1–18 rejestru (indeksy jak w mapSettlementRegisterRow_). */
function seedRegister(
  sheet: FakeSheet,
  row: number,
  over: Partial<Record<number, Cell>> = {},
): void {
  const cols: Cell[] = [
    10,
    'Ul. Sklepowa 1',
    'Firma',
    'Sklep A',
    '15.09.2026',
    'gpw',
    '',
    '',
    3,
    '',
    'trasa-1',
    100,
    50,
    20,
    '',
    '',
    '',
    '',
  ];
  for (let i = 0; i < cols.length; i += 1) {
    sheet.put(row, i + 1, cols[i]);
  }
  for (const [key, value] of Object.entries(over)) {
    sheet.put(row, Number(key), value as Cell);
  }
}

function seedRate(
  sheet: FakeSheet,
  row: number,
  shop: string,
  contractor: string,
  pickup: Cell,
  bag: Cell,
  from: Cell,
): void {
  sheet.put(row, 1, shop);
  sheet.put(row, 2, contractor);
  sheet.put(row, 3, pickup);
  sheet.put(row, 4, bag);
  sheet.put(row, 5, from);
}

function getJson(): SettlementResult {
  return JSON.parse(lastBody) as SettlementResult;
}

describe('settlementSearch_', () => {
  it('test_settlementSearch_missing_podwykonawca_returns_error', () => {
    fresh();
    expect(gas.settlementSearch_({ dataDo: '20.09.2026' })).toEqual({
      ok: false,
      error: 'podwykonawca required',
    });
  });

  it('test_settlementSearch_missing_dataDo_returns_error', () => {
    fresh();
    expect(gas.settlementSearch_({ podwykonawca: 'gpw' })).toEqual({
      ok: false,
      error: 'dataDo required',
    });
  });

  it('test_settlementSearch_bad_date_format_returns_error', () => {
    fresh();
    expect(gas.settlementSearch_({ podwykonawca: 'gpw', dataDo: 'nie-data' })).toEqual({
      ok: false,
      error: 'dataDo is not dd.mm.yyyy',
    });
  });

  it('test_settlementSearch_accepts_iso_dataDo', () => {
    const { register } = fresh(false);
    seedRegister(register, 2, { 5: '20.09.2026' });
    const result = gas.settlementSearch_({
      podwykonawca: 'gpw',
      dataOd: '2026-09-01',
      dataDo: '2026-09-30',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rows).toHaveLength(1);
  });

  it('test_settlementSearch_dataOd_after_dataDo_returns_error', () => {
    fresh();
    expect(
      gas.settlementSearch_({
        podwykonawca: 'gpw',
        dataOd: '21.09.2026',
        dataDo: '20.09.2026',
      }),
    ).toEqual({ ok: false, error: 'dataOd after dataDo' });
  });

  it('test_settlementSearch_filters_open_rows_by_contractor_and_date_range', () => {
    const { register, rates } = fresh();
    seedRegister(register, 2);
    seedRegister(register, 3, { 1: 11, 5: '10.09.2026' });
    seedRegister(register, 4, { 1: 12, 6: 'inny' });
    seedRegister(register, 5, { 1: 13, 5: '25.09.2026' });
    seedRegister(register, 6, { 1: 14, 15: 'tak' });
    seedRegister(register, 7, { 1: 15, 10: 'nie' });
    seedRate(rates!, 2, 'Ul. Sklepowa 1', 'gpw', 40, 10, '01.09.2026');
    seedRate(rates!, 3, 'Ul. Sklepowa 1', 'inny', 1, 1, '01.09.2026');

    const result = gas.settlementSearch_({
      podwykonawca: 'gpw',
      dataOd: '12.09.2026',
      dataDo: '20.09.2026',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rows.map((r) => r.transportNumber)).toEqual(['10']);
    expect(result.rows[0]).toMatchObject({
      sheetRow: 2,
      address: 'Ul. Sklepowa 1',
      shopName: 'Sklep A',
      pickupDate: '15.09.2026',
      contractor: 'gpw',
      bagCount: 3,
      routeName: 'trasa-1',
      routeRate: 10000,
      pickupRate: 5000,
      bagRate: 2000,
    });
    expect(result.rates).toEqual([
      {
        sheetRow: 2,
        shop: 'Ul. Sklepowa 1',
        contractor: 'gpw',
        pickupAmount: 4000,
        bagAmount: 1000,
        validFrom: '01.09.2026',
      },
    ]);
  });

  it('test_settlementSearch_missing_rate_sheet_returns_empty_rates', () => {
    const { register } = fresh(false);
    seedRegister(register, 2);

    const result = gas.settlementSearch_({
      podwykonawca: 'gpw',
      dataDo: '20.09.2026',
    });

    expect(result).toEqual({
      ok: true,
      rows: [
        expect.objectContaining({
          sheetRow: 2,
          transportNumber: '10',
        }),
      ],
      rates: [],
    });
  });

  it('test_settlementSearch_via_doGet_returns_same_payload', () => {
    const { register } = fresh(false);
    seedRegister(register, 2);
    gas.doGet({
      parameter: {
        action: 'settlementSearch',
        podwykonawca: 'gpw',
        dataDo: '20.09.2026',
        secret: TEST_GAS_SECRET,
      },
    });
    const body = getJson();
    expect(body.ok).toBe(true);
    if (!body.ok) {
      return;
    }
    expect(body.rows).toHaveLength(1);
    expect(body.rates).toEqual([]);
  });
});

describe('settlementInvoices_', () => {
  it('test_settlementInvoices_returns_settled_rows_with_invoice_and_sheet_cost', () => {
    const { register } = fresh(false);
    seedRegister(register, 2, { 1: 10, 15: 'tak', 16: ' FV/1 ', 17: 150, 18: 50 });
    seedRegister(register, 3, { 1: 11, 5: '10.09.2026', 15: 'tak', 16: 'FV/9', 17: 20 });
    seedRegister(register, 4, { 1: 12 });
    seedRegister(register, 5, { 1: 13, 6: 'inny', 15: 'tak', 16: 'FV/2', 17: 10 });
    seedRegister(register, 6, { 1: 14, 10: 'nie', 15: 'tak', 16: '', 17: 5, 18: 5 });

    expect(gas.settlementInvoices_({ dataDo: '20.09.2026' })).toEqual({
      ok: false,
      error: 'podwykonawca required',
    });

    const result = gas.settlementInvoices_({
      podwykonawca: 'gpw',
      dataOd: '12.09.2026',
      dataDo: '20.09.2026',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rows.map((row) => row.transportNumber)).toEqual(['10', '14']);
    expect(result.rows[0]).toMatchObject({
      sheetRow: 2,
      invoice: 'FV/1',
      receptionCost: 15000,
      costPerBag: 5000,
      shopName: 'Sklep A',
      pickupDate: '15.09.2026',
    });
    expect(result.rows[1]).toMatchObject({
      transportNumber: '14',
      invoice: '',
      receptionCost: 500,
    });
    expect(result.rows[0]).not.toHaveProperty('routeRate');
  });

  it('test_settlementInvoices_harmonogram_reads_invoice_and_does_not_write_rates', () => {
    fresh();
    const schedule = holder.schedule!;
    seedScheduleRow(schedule, 2, { 14: 'tak', 15: 'FV/H', 16: 80, 17: 40 });
    seedScheduleRow(schedule, 3, { 4: '16.09.2026' });
    const pickupBefore = schedule.cell(3, 12);
    const bagBefore = schedule.cell(3, 13);

    const result = gas.settlementInvoices_({
      tryb: 'harmonogram',
      podwykonawca: 'thor',
      dataDo: '20.09.2026',
    });

    expect(schedule.cell(3, 12)).toBe(pickupBefore);
    expect(schedule.cell(3, 13)).toBe(bagBefore);
    expect(schedule.cell(2, 12)).toBe(11);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rows).toEqual([
      expect.objectContaining({
        sheetRow: 2,
        transportNumber: '',
        contractor: 'THOR',
        invoice: 'FV/H',
        receptionCost: 8000,
        costPerBag: 4000,
        routeName: 'trasa-z-arkusza',
      }),
    ]);
  });

  it('test_settlementInvoices_via_doGet_returns_same_payload', () => {
    const { register } = fresh(false);
    seedRegister(register, 2, { 15: 'tak', 16: 'FV/1', 17: 10 });
    gas.doGet({
      parameter: {
        action: 'settlementInvoices',
        podwykonawca: 'gpw',
        dataDo: '20.09.2026',
        secret: TEST_GAS_SECRET,
      },
    });
    const body = getJson();
    expect(body.ok).toBe(true);
    if (!body.ok) {
      return;
    }
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ invoice: 'FV/1', receptionCost: 1000 });
  });
});

describe('settlementStats_', () => {
  it('test_settlementStats_requires_both_date_ends', () => {
    fresh();
    expect(gas.settlementStats_({ dataDo: '20.09.2026' })).toEqual({
      ok: false,
      error: 'dataOd required',
    });
    expect(gas.settlementStats_({ dataOd: '01.09.2026' })).toEqual({
      ok: false,
      error: 'dataDo required',
    });
  });

  it('test_settlementStats_includes_settled_in_range_and_open_backlog', () => {
    const { register, rates } = fresh();
    seedRegister(register, 2, { 1: 20, 5: '15.09.2026', 15: 'tak', 16: 'FV/1', 17: 200, 18: 50 });
    seedRegister(register, 3, { 1: 21, 5: '01.08.2026' });
    seedRegister(register, 4, { 1: 22, 5: '10.09.2026', 15: 'tak' });
    seedRegister(register, 5, { 1: 23, 5: '15.09.2026', 10: 'nie' });
    seedRegister(register, 6, { 1: 24, 5: '15.09.2026', 6: 'inny', 15: 'tak', 17: 1, 18: 1 });
    seedRate(rates!, 2, 'Ul. Sklepowa 1', 'gpw', 40, 10, '01.09.2026');

    const result = gas.settlementStats_({
      podwykonawca: 'gpw',
      dataOd: '12.09.2026',
      dataDo: '20.09.2026',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rows.map((r) => r.transportNumber).sort()).toEqual(['20', '21']);
    const settled = result.rows.find((r) => r.transportNumber === '20');
    expect(settled).toMatchObject({
      settled: true,
      happened: true,
      invoice: 'FV/1',
      receptionCost: 20000,
      costPerBag: 5000,
    });
    const backlog = result.rows.find((r) => r.transportNumber === '21');
    expect(backlog).toMatchObject({
      settled: false,
      happened: true,
      pickupDate: '01.08.2026',
    });
    expect(result.rates).toHaveLength(1);
  });

  it('test_settlementStats_empty_podwykonawca_includes_all_contractors', () => {
    const { register } = fresh(false);
    seedRegister(register, 2, { 1: 30, 6: 'gpw', 15: 'tak', 5: '15.09.2026' });
    seedRegister(register, 3, { 1: 31, 6: 'inny', 15: 'tak', 5: '15.09.2026' });

    const result = gas.settlementStats_({
      dataOd: '01.09.2026',
      dataDo: '30.09.2026',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rows.map((r) => r.contractor).sort()).toEqual(['gpw', 'inny']);
  });

  it('test_settlementStats_includes_odebrane_schedule_bags', () => {
    const { register, odebrane } = fresh(false);
    seedRegister(register, 2, { 1: 40, 6: 'gpw', 15: 'tak', 5: '15.09.2026', 9: 1 });
    const headers = [
      'NIP',
      'Podmiot',
      'Sklep',
      'Wg',
      'Dni',
      'Firma transportowa',
      'Kod pocztowy',
      'Miasto',
      'Ulica',
      'Numer budynku',
      'Gmina',
      'Woj',
      'Plomba',
      'Stan',
      'TMS',
      'Data zamknięcia worka',
    ];
    headers.forEach((h, i) => odebrane.put(1, i + 1, h));
    const putBag = (row: number, plomba: string) => {
      odebrane.put(row, 3, 'Sklep H');
      odebrane.put(row, 6, 'gpw');
      odebrane.put(row, 7, '30-001');
      odebrane.put(row, 8, 'Kraków');
      odebrane.put(row, 9, 'Testowa');
      odebrane.put(row, 10, '1');
      odebrane.put(row, 13, plomba);
      odebrane.put(row, 16, '16.09.2026');
    };
    putBag(2, 'p1');
    putBag(3, 'p2');

    const result = gas.settlementStats_({
      podwykonawca: 'gpw',
      dataOd: '01.09.2026',
      dataDo: '30.09.2026',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const schedule = result.rows.filter((r) => r.mode === 'schedule');
    expect(schedule).toHaveLength(1);
    expect(schedule[0]).toMatchObject({
      mode: 'schedule',
      bagCount: 2,
      contractor: 'gpw',
      pickupDate: '16.09.2026',
      happened: true,
      settled: false,
      invoice: '',
    });
    expect(result.rows.some((r) => r.mode === 'report' && r.transportNumber === '40')).toBe(true);
  });

  it('test_settlementStats_odebrane_width_stops_after_close_date', () => {
    const { odebrane } = fresh(false);
    const headers = [
      'NIP',
      'Podmiot',
      'Sklep',
      'Wg',
      'Dni',
      'Firma transportowa',
      'Kod pocztowy',
      'Miasto',
      'Ulica',
      'Numer budynku',
      'Gmina',
      'Woj',
      'Plomba',
      'Stan',
      'TMS',
      'Data zamknięcia worka',
      'Waga',
    ];
    headers.forEach((h, i) => odebrane.put(1, i + 1, h));
    odebrane.put(2, 3, 'Sklep H');
    odebrane.put(2, 6, 'gpw');
    odebrane.put(2, 7, '30-001');
    odebrane.put(2, 8, 'Kraków');
    odebrane.put(2, 9, 'Testowa');
    odebrane.put(2, 10, '1');
    odebrane.put(2, 16, '16.09.2026');
    odebrane.put(2, 17, '12');
    const dataWidths: number[] = [];
    const original = odebrane.getRange.bind(odebrane);
    odebrane.getRange = (row, col, numRows, numCols) => {
      if (row >= 2) {
        dataWidths.push(numCols ?? 1);
      }
      return original(row, col, numRows, numCols);
    };

    const result = gas.settlementStats_({
      podwykonawca: 'gpw',
      dataOd: '01.09.2026',
      dataDo: '30.09.2026',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(dataWidths).toEqual([headers.indexOf('Data zamknięcia worka') + 1]);
    expect(result.rows.filter((row) => row.mode === 'schedule')).toHaveLength(1);
  });

  it('test_settlementStats_missing_firma_returns_empty_works', () => {
    const { odebrane } = fresh(false);
    const headers = [
      'NIP',
      'Sklep',
      'Kod pocztowy',
      'Miasto',
      'Ulica',
      'Numer budynku',
      'Data zamknięcia worka',
    ];
    headers.forEach((h, i) => odebrane.put(1, i + 1, h));
    odebrane.put(2, 2, 'Sklep H');
    odebrane.put(2, 7, '16.09.2026');

    const result = gas.settlementStats_({
      podwykonawca: 'gpw',
      dataOd: '01.09.2026',
      dataDo: '30.09.2026',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rows.filter((row) => row.mode === 'schedule')).toEqual([]);
  });

  it('test_settlementStats_via_doGet_returns_json', () => {
    const { register } = fresh(false);
    seedRegister(register, 2, { 15: 'tak', 5: '15.09.2026' });
    gas.doGet({
      parameter: {
        action: 'settlementStats',
        dataOd: '01.09.2026',
        dataDo: '30.09.2026',
        podwykonawca: 'gpw',
        secret: TEST_GAS_SECRET,
      },
    });
    const body = getJson();
    expect(body.ok).toBe(true);
    if (!body.ok) {
      return;
    }
    expect(body.rows).toHaveLength(1);
  });
});

describe('buildSettlementRead_ pure amounts', () => {
  it('test_buildSettlementRead_parses_polish_amount_text_to_grosze', () => {
    const result = gas.buildSettlementRead_(
      { podwykonawca: 'gpw', dataDo: '20.09.2026' },
      [
        {
          sheetRow: 2,
          cells: [
            1,
            'A',
            '',
            'S',
            '15.09.2026',
            'gpw',
            '',
            '',
            '2,5',
            '',
            '',
            '1,50 zł',
            '',
            '',
            '',
            '',
            '',
            '',
          ],
        },
      ],
      [],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rows[0]).toMatchObject({
      bagCount: 2.5,
      routeRate: 150,
    });
  });
});

describe('buildSettlementHarmonogramRead_', () => {
  it('test_buildSettlementHarmonogramRead_reads_schedule_register_like_arkusz1', () => {
    const result = gas.buildSettlementHarmonogramRead_(
      { podwykonawca: 'THOR', dataOd: '14.09.2026', dataDo: '23.09.2026' },
      [
        {
          sheetRow: 2,
          cells: [
            '31-342 Kraków Radzikowskiego 138',
            '',
            'Radzikowskiego',
            '15.09.2026',
            'THOR',
            '',
            '',
            0,
            '',
            '',
            '',
            100,
            0,
            '',
            '',
            '',
            '',
          ],
        },
        {
          sheetRow: 3,
          cells: [
            '30-045 Kraków ul. Królewska 52',
            '',
            '',
            '22.09.2026',
            'THOR',
            '',
            'ręczna',
            2,
            '',
            '',
            '',
            100,
            10,
            '',
            '',
            '',
            '',
          ],
        },
        {
          sheetRow: 4,
          cells: [
            'inny',
            '',
            '',
            '15.09.2026',
            'INNY',
            '',
            '',
            1,
            '',
            '',
            '',
            50,
            0,
            '',
            '',
            '',
            '',
          ],
        },
      ],
      [
        {
          sheetRow: 2,
          cells: ['31-342 Kraków Radzikowskiego 138', 'THOR', '', 100, 0, '', '01.01.2026', 'wt'],
        },
      ],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      transportNumber: '',
      bagCount: 0,
      pickupRate: 10000,
      pickupDate: '15.09.2026',
    });
    expect(result.rows[1]).toMatchObject({
      bagCount: 2,
      pickupRate: null,
      bagRate: null,
    });
    expect(result.rates).toHaveLength(1);
  });

  it('test_buildSettlementHarmonogramRead_skips_settled_and_nie', () => {
    const result = gas.buildSettlementHarmonogramRead_(
      { podwykonawca: 'THOR', dataOd: '15.09.2026', dataDo: '15.09.2026' },
      [
        {
          sheetRow: 2,
          cells: [
            'Adres A',
            '',
            '',
            '15.09.2026',
            'THOR',
            '',
            '',
            1,
            '',
            '',
            '',
            50,
            0,
            'tak',
            'FV/1',
            50,
            50,
          ],
        },
        {
          sheetRow: 3,
          cells: [
            'Adres B',
            '',
            '',
            '15.09.2026',
            'THOR',
            '',
            '',
            1,
            'nie',
            '',
            '',
            50,
            0,
            '',
            '',
            '',
            '',
          ],
        },
      ],
      [],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rows).toHaveLength(0);
  });
});

function seedScheduleRow(sheet: FakeSheet, row: number, over: Partial<Record<number, Cell>> = {}): void {
  const cols: Cell[] = [
    'Adres A',
    'Firma',
    'Sklep',
    '15.09.2026',
    'THOR',
    '',
    '',
    2,
    '',
    'trasa-z-arkusza',
    80,
    11,
    4,
    '',
    '',
    '',
    '',
  ];
  for (let i = 0; i < cols.length; i += 1) {
    sheet.put(row, i + 1, cols[i]);
  }
  for (const [key, value] of Object.entries(over)) {
    sheet.put(row, Number(key), value as Cell);
  }
}

function seedBazaCen(
  sheet: FakeSheet,
  row: number,
  shop: string,
  contractor: string,
  pickup: Cell,
  bag: Cell,
  from: Cell,
): void {
  sheet.put(row, 1, shop);
  sheet.put(row, 2, contractor);
  sheet.put(row, 3, 'trasa-z-bazy');
  sheet.put(row, 4, pickup);
  sheet.put(row, 5, bag);
  sheet.put(row, 6, 40);
  sheet.put(row, 7, from);
  sheet.put(row, 8, 'wt');
}

describe('settlementSearch_ harmonogram stawki', () => {
  function openSearch(): { schedule: FakeSheet; baza: FakeSheet; month: FakeSheet } {
    fresh();
    const schedule = holder.schedule!;
    const baza = new FakeSheet('Baza cen harmonogram');
    const month = new FakeSheet('Harmonogram Wrzesień 2026');
    holder.bazaCen = baza;
    holder.extra = [month];
    return { schedule, baza, month };
  }

  it('test_settlementSearchHarmonogram_writes_rates_only_inside_this_statement', () => {
    const { schedule, baza, month } = openSearch();
    seedScheduleRow(schedule, 2);
    seedScheduleRow(schedule, 3, { 1: 'Adres B', 5: 'INNY' });
    seedScheduleRow(schedule, 4, { 1: 'Adres C', 4: '01.08.2026' });
    seedScheduleRow(month, 2, { 1: 'Adres D', 4: '16.09.2026' });
    seedBazaCen(baza, 2, 'Adres A', 'THOR', 30, 3, '01.06.2026');
    seedBazaCen(baza, 3, 'Adres B', 'INNY', 70, 7, '01.01.2026');
    seedBazaCen(baza, 4, 'Adres C', 'THOR', 90, 9, '01.01.2026');
    seedBazaCen(baza, 5, 'Adres D', 'THOR', 15, 1, '01.01.2026');

    const result = gas.settlementSearch_({
      tryb: 'harmonogram',
      podwykonawca: 'THOR',
      dataOd: '01.09.2026',
      dataDo: '30.09.2026',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rows.map((row) => row.address)).toEqual(['Adres A', 'Adres D']);
    expect(result.rows[0]).toMatchObject({ pickupRate: 3000, bagRate: 300 });
    expect(result.rows[1]).toMatchObject({ pickupRate: 1500, bagRate: 100 });
    expect(schedule.cell(2, 12)).toBe(30);
    expect(schedule.cell(2, 13)).toBe(3);
    expect(schedule.cell(3, 12)).toBe(11);
    expect(schedule.cell(3, 13)).toBe(4);
    expect(schedule.cell(4, 12)).toBe(11);
    expect(schedule.cell(4, 13)).toBe(4);
    expect(month.cell(2, 12)).toBe(15);
    expect(month.cell(2, 13)).toBe(1);
    expect(holder.lastBatch?.url).toBe(
      'https://sheets.googleapis.com/v4/spreadsheets/ss-test/values:batchUpdate',
    );
    expect(holder.lastBatch?.headers.Authorization).toBe('Bearer oauth-test');
    expect(holder.lastBatch?.body.valueInputOption).toBe('RAW');
    expect(holder.lastBatch?.body.data?.map((item) => item.range)).toEqual([
      "'zestawienie z harmonogramu'!L2:M2",
      "'Harmonogram Wrzesień 2026'!L2:M2",
    ]);
    expect(holder.lastBatch?.body.data?.map((item) => item.values)).toEqual([
      [[30, 3]],
      [[15, 1]],
    ]);
  });

  it('test_settlementSearchHarmonogram_clears_rates_when_pair_missing_or_only_later', () => {
    const { schedule, baza } = openSearch();
    seedScheduleRow(schedule, 2, { 1: 'Bez pary' });
    seedScheduleRow(schedule, 3, { 1: 'Tylko pozniej' });
    seedBazaCen(baza, 2, 'Tylko pozniej', 'THOR', 90, 9, '01.12.2026');
    seedBazaCen(baza, 3, 'Tylko pozniej', 'THOR', 80, 8, '20.09.2026');

    const result = gas.settlementSearch_({
      tryb: 'harmonogram',
      podwykonawca: 'THOR',
      dataOd: '01.09.2026',
      dataDo: '30.09.2026',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((row) => row.pickupRate === null && row.bagRate === null)).toBe(true);
    expect(schedule.cell(2, 12)).toBe('');
    expect(schedule.cell(2, 13)).toBe('');
    expect(schedule.cell(3, 12)).toBe('');
    expect(schedule.cell(3, 13)).toBe('');
  });

  it('test_settlementSearchHarmonogram_empty_date_is_oldest_and_tie_keeps_first_row', () => {
    const { schedule, baza } = openSearch();
    seedScheduleRow(schedule, 2, { 1: 'Pusta data' });
    seedScheduleRow(schedule, 3, { 1: 'Remis' });
    seedBazaCen(baza, 2, 'Pusta data', 'THOR', 5, 1, '');
    seedBazaCen(baza, 3, 'Pusta data', 'THOR', 30, 3, '01.06.2026');
    seedBazaCen(baza, 4, 'Pusta data', 'THOR', 90, 9, '01.12.2026');
    seedBazaCen(baza, 5, 'Remis', 'THOR', 10, 1, '01.06.2026');
    seedBazaCen(baza, 6, 'Remis', 'THOR', 99, 9, '01.06.2026');

    const result = gas.settlementSearch_({
      tryb: 'harmonogram',
      podwykonawca: 'THOR',
      dataOd: '01.09.2026',
      dataDo: '30.09.2026',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const emptyDate = result.rows.find((row) => row.address === 'Pusta data');
    const tie = result.rows.find((row) => row.address === 'Remis');
    expect(emptyDate).toMatchObject({ pickupRate: 3000, bagRate: 300 });
    expect(tie).toMatchObject({ pickupRate: 1000, bagRate: 100 });
    expect(schedule.cell(2, 12)).toBe(30);
    expect(schedule.cell(2, 13)).toBe(3);
    expect(schedule.cell(3, 12)).toBe(10);
    expect(schedule.cell(3, 13)).toBe(1);
  });

  it('test_settlementSearchHarmonogram_skips_nie_and_settled_and_leaves_route_columns', () => {
    const { schedule, baza } = openSearch();
    seedScheduleRow(schedule, 2);
    seedScheduleRow(schedule, 3, { 1: 'Odbyte nie', 9: 'nie' });
    seedScheduleRow(schedule, 4, { 1: 'Juz tak', 14: 'tak', 15: 'FV/1', 16: 50, 17: 25 });
    seedBazaCen(baza, 2, 'Adres A', 'THOR', 30, 3, '01.01.2026');
    seedBazaCen(baza, 3, 'Odbyte nie', 'THOR', 70, 7, '01.01.2026');
    seedBazaCen(baza, 4, 'Juz tak', 'THOR', 70, 7, '01.01.2026');

    const result = gas.settlementSearch_({
      tryb: 'harmonogram',
      podwykonawca: 'THOR',
      dataOd: '01.09.2026',
      dataDo: '30.09.2026',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ address: 'Adres A', pickupRate: 3000, bagRate: 300 });
    expect(schedule.cell(2, 10)).toBe('trasa-z-arkusza');
    expect(schedule.cell(2, 11)).toBe(80);
    expect(schedule.cell(2, 12)).toBe(30);
    expect(schedule.cell(2, 13)).toBe(3);
    expect(schedule.cell(3, 12)).toBe(11);
    expect(schedule.cell(3, 13)).toBe(4);
    expect(schedule.cell(4, 12)).toBe(11);
    expect(schedule.cell(4, 13)).toBe(4);
    expect(schedule.cell(4, 14)).toBe('tak');
    expect(baza.cell(2, 3)).toBe('trasa-z-bazy');
    expect(baza.cell(2, 4)).toBe(30);
  });

  it('test_writeHarmonogramSearchRates_skips_row_closed_or_moved_after_read', () => {
    const { schedule } = openSearch();
    seedScheduleRow(schedule, 2, { 9: 'nie' });
    seedScheduleRow(schedule, 3, { 1: 'Juz tak', 14: 'tak' });
    seedScheduleRow(schedule, 4, { 1: 'Inny adres' });
    const stale = {
      sheetName: schedule.name,
      address: 'Adres A',
      pickupDate: '15.09.2026',
      contractor: 'THOR',
      pickupRate: 3000,
      bagRate: 300,
    };

    gas.writeHarmonogramSearchRates_([
      { ...stale, sheetRow: 2 },
      { ...stale, sheetRow: 3, address: 'Juz tak' },
      { ...stale, sheetRow: 4 },
    ]);

    expect(schedule.cell(2, 12)).toBe(11);
    expect(schedule.cell(2, 13)).toBe(4);
    expect(schedule.cell(3, 12)).toBe(11);
    expect(schedule.cell(3, 13)).toBe(4);
    expect(schedule.cell(3, 14)).toBe('tak');
    expect(schedule.cell(4, 12)).toBe(11);
    expect(schedule.cell(4, 13)).toBe(4);
  });

  it('test_settlementSearchHarmonogram_returns_row_when_rates_already_match', () => {
    const { schedule, baza } = openSearch();
    seedScheduleRow(schedule, 2, { 12: 30, 13: 3 });
    seedBazaCen(baza, 2, 'Adres A', 'THOR', 30, 3, '01.01.2026');

    const result = gas.settlementSearch_({
      tryb: 'harmonogram',
      podwykonawca: 'THOR',
      dataOd: '01.09.2026',
      dataDo: '30.09.2026',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ address: 'Adres A', pickupRate: 3000, bagRate: 300 });
    expect(schedule.cell(2, 12)).toBe(30);
    expect(schedule.cell(2, 13)).toBe(3);
    expect(holder.lastBatch).toBeNull();
  });

  it('test_settlementSearchHarmonogram_setValues_when_batch_is_not_2xx', () => {
    const { schedule, baza } = openSearch();
    seedScheduleRow(schedule, 2);
    seedBazaCen(baza, 2, 'Adres A', 'THOR', 30, 3, '01.01.2026');
    holder.batchCode = 500;

    const result = gas.settlementSearch_({
      tryb: 'harmonogram',
      podwykonawca: 'THOR',
      dataOd: '01.09.2026',
      dataDo: '30.09.2026',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rows[0]).toMatchObject({ pickupRate: 3000, bagRate: 300 });
    expect(schedule.cell(2, 12)).toBe(30);
    expect(schedule.cell(2, 13)).toBe(3);
    expect(schedule.cell(2, 10)).toBe('trasa-z-arkusza');
    expect(holder.lastBatch?.body.valueInputOption).toBe('RAW');
  });

  it('test_settlementSearchHarmonogram_setValues_when_batch_throws', () => {
    const { schedule, baza } = openSearch();
    seedScheduleRow(schedule, 2);
    seedBazaCen(baza, 2, 'Adres A', 'THOR', 30, 3, '01.01.2026');
    holder.batchThrow = true;

    const result = gas.settlementSearch_({
      tryb: 'harmonogram',
      podwykonawca: 'THOR',
      dataOd: '01.09.2026',
      dataDo: '30.09.2026',
    });

    expect(result.ok).toBe(true);
    expect(schedule.cell(2, 12)).toBe(30);
    expect(schedule.cell(2, 13)).toBe(3);
  });
});

function freshScheduleCells(over: Partial<Record<number, Cell>> = {}): Cell[] {
  const cells: Cell[] = [
    'Adres A',
    'Firma',
    'Sklep',
    '15.09.2026',
    'THOR',
    '',
    '',
    2,
    '',
    'trasa-z-arkusza',
    80,
    11,
    4,
    '',
  ];
  for (const [key, value] of Object.entries(over)) {
    cells[Number(key) - 1] = value as Cell;
  }
  return cells;
}

function harmonogramResultRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sheetName: 'zestawienie z harmonogramu',
    sheetRow: 2,
    address: 'Adres A',
    pickupDate: '15.09.2026',
    contractor: 'THOR',
    pickupRate: 1250,
    bagRate: 300,
    ...over,
  };
}

describe('harmonogramSearchRateWrites_', () => {
  function freshBlock(
    sheetName: string,
    startRow: number,
    values: Cell[][],
  ): { sheetName: string; startRow: number; values: Cell[][] } {
    return { sheetName, startRow, values };
  }

  it('test_harmonogramSearchRateWrites_skips_same_number_and_rewrites_text', () => {
    const pickup = gas.approveZlotyFromGrosze_(1250);
    const bag = gas.approveZlotyFromGrosze_(300);
    expect(pickup).toBe(12.5);
    expect(bag).toBe(3);
    const sheetName = 'zestawienie z harmonogramu';
    const open = harmonogramResultRow();
    const changed = gas.harmonogramSearchRateWrites_(
      [open],
      [freshBlock(sheetName, 2, [freshScheduleCells({ 12: 11, 13: bag })])],
    );
    expect(changed).toEqual([{ sheetName, sheetRow: 2, values: [pickup, bag] }]);

    const held = gas.harmonogramSearchRateWrites_(
      [open],
      [freshBlock(sheetName, 2, [freshScheduleCells({ 12: pickup, 13: bag })])],
    );
    expect(held).toEqual([]);

    const text = gas.harmonogramSearchRateWrites_(
      [open],
      [freshBlock(sheetName, 2, [freshScheduleCells({ 12: '12.5', 13: bag })])],
    );
    expect(text).toEqual([{ sheetName, sheetRow: 2, values: [pickup, bag] }]);
  });

  it('test_harmonogramSearchRateWrites_null_skips_empty_and_clears_old_number', () => {
    const sheetName = 'zestawienie z harmonogramu';
    const row = harmonogramResultRow({ pickupRate: null, bagRate: null });
    const empty = gas.harmonogramSearchRateWrites_(
      [row],
      [freshBlock(sheetName, 2, [freshScheduleCells({ 12: '', 13: '' })])],
    );
    expect(empty).toEqual([]);

    const stale = gas.harmonogramSearchRateWrites_(
      [row],
      [freshBlock(sheetName, 2, [freshScheduleCells({ 12: 11, 13: 4 })])],
    );
    expect(stale).toEqual([{ sheetName, sheetRow: 2, values: ['', ''] }]);
  });

  it('test_harmonogramSearchRateWrites_skips_closed_moved_or_other_transport', () => {
    const sheetName = 'zestawienie z harmonogramu';
    const row = harmonogramResultRow();
    const cases: Cell[][] = [
      freshScheduleCells({ 14: 'tak' }),
      freshScheduleCells({ 9: 'nie' }),
      freshScheduleCells({ 1: 'Inny adres' }),
      freshScheduleCells({ 4: '16.09.2026' }),
      freshScheduleCells({ 5: 'INNY' }),
    ];
    for (const cells of cases) {
      expect(gas.harmonogramSearchRateWrites_([row], [freshBlock(sheetName, 2, [cells])])).toEqual([]);
    }
  });

  it('test_harmonogramSearchRateRanges_two_sheets_do_not_cover_the_row_between', () => {
    const september = 'Harmonogram Wrzesień 2026';
    const october = 'Harmonogram Październik 2026';
    const writes = gas.harmonogramSearchRateWrites_(
      [
        harmonogramResultRow({ sheetName: september, sheetRow: 2 }),
        harmonogramResultRow({
          sheetName: october,
          sheetRow: 4,
          pickupRate: 1500,
          bagRate: 100,
        }),
      ],
      [
        freshBlock(september, 2, [
          freshScheduleCells(),
          freshScheduleCells({ 1: 'Pomiędzy' }),
          freshScheduleCells(),
        ]),
        freshBlock(october, 2, [
          freshScheduleCells(),
          freshScheduleCells({ 1: 'Pomiędzy' }),
          freshScheduleCells(),
        ]),
      ],
    );
    const ranges = gas.harmonogramSearchRateRanges_(writes);
    expect(ranges.map((item) => item.range)).toEqual([
      `'${september}'!L2:M2`,
      `'${october}'!L4:M4`,
    ]);
    expect(ranges.map((item) => item.values)).toEqual([
      [[gas.approveZlotyFromGrosze_(1250), gas.approveZlotyFromGrosze_(300)]],
      [[gas.approveZlotyFromGrosze_(1500), gas.approveZlotyFromGrosze_(100)]],
    ]);
    for (const item of ranges) {
      const match = /!([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(item.range);
      expect(match).not.toBeNull();
      const from = Number(match?.[2]);
      const to = Number(match?.[4]);
      expect(from).toBe(to);
      expect(from < 3 && to > 3).toBe(false);
    }
  });
});

describe('resolveHarmonogramSnapshot_', () => {
  it('test_resolveHarmonogramSnapshot_skips_empty_date', () => {
    const onlyEmpty = gas.resolveHarmonogramSnapshot_(
      [
        {
          shop: 'Adres A',
          contractor: 'THOR',
          routeName: 'pusta',
          routeAmount: 40,
          pickup: 50,
          bag: 5,
          validFrom: '\u0000',
        },
      ],
      'Adres A',
      'THOR',
      '15.09.2026',
    );
    expect(onlyEmpty).toEqual({ routeName: '', route: '', pickup: '', bag: '' });

    const datedWins = gas.resolveHarmonogramSnapshot_(
      [
        {
          shop: 'Adres A',
          contractor: 'THOR',
          routeName: 'pusta',
          routeAmount: 1,
          pickup: 1,
          bag: 1,
          validFrom: '\u0000',
        },
        {
          shop: 'Adres A',
          contractor: 'THOR',
          routeName: 'obowiazuje',
          routeAmount: 7,
          pickup: 20,
          bag: 2,
          validFrom: '01.01.2026',
        },
      ],
      'Adres A',
      'THOR',
      '15.09.2026',
    );
    expect(datedWins).toMatchObject({ routeName: 'obowiazuje', pickup: 20, bag: 2 });
  });
});

describe('buildScheduleSyncExpected_', () => {
  const odebraneHeaders = [
    'NIP',
    'Podmiot handlowy',
    'Sklep',
    'Wg harmonogramu',
    'Dni harmonogramu',
    'Firma transportowa',
    'Kod pocztowy',
    'Miasto',
    'Ulica',
    'Numer budynku',
    'Gmina',
    'Województwo',
    'Numer plomby',
    'Stan worka',
    'Status TMS worka',
    'Data zamknięcia worka',
  ];

  it('test_buildScheduleSyncExpected_pickup_days_even_without_bags', () => {
    const rows = gas.buildScheduleSyncExpected_(
      '14.09.2026',
      '23.09.2026',
      [
        {
          sheetRow: 2,
          cells: ['31-342 Kraków Radzikowskiego 138', 'THOR', '', 100, 0, '', '01.01.2026', 'wt'],
        },
        {
          sheetRow: 3,
          cells: ['30-045 Kraków ul. Królewska 52', 'THOR', '', 100, 0, '', '01.01.2026', 'wt'],
        },
        {
          sheetRow: 4,
          cells: ['32-353 Trzyciąż Krakowska 8a', 'THOR', '', 100, 0, '', '01.01.2026', 'wt'],
        },
      ],
      { headers: odebraneHeaders, rows: [] },
    );
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.bagCount === 0)).toBe(true);
    expect(rows.filter((r) => r.pickupDate === '15.09.2026')).toHaveLength(3);
    expect(rows.filter((r) => r.pickupDate === '22.09.2026')).toHaveLength(3);
  });

  it('test_buildScheduleSyncExpected_when_zero_bags_should_fill_names_from_any_odebrane_row', () => {
    const rows = gas.buildScheduleSyncExpected_(
      '14.09.2026',
      '16.09.2026',
      [
        {
          sheetRow: 2,
          cells: ['31-342 Kraków Radzikowskiego 138', 'THOR', '', 100, 0, '', '01.01.2026', 'wt'],
        },
      ],
      {
        headers: odebraneHeaders,
        rows: [
          [
            '',
            'Firma X',
            'Sklep A',
            'Tak',
            'wt',
            'THOR',
            '31-342',
            'Kraków',
            'Radzikowskiego',
            '138',
            '',
            '',
            '1',
            '',
            '',
            '08.09.2026',
          ],
        ],
      },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      bagCount: 0,
      pickupDate: '15.09.2026',
      podmiot: 'Firma X',
      shopName: 'Sklep A',
    });
  });

  it('test_buildScheduleSyncExpected_counts_odebrane_bags_on_matching_day', () => {
    const rows = gas.buildScheduleSyncExpected_(
      '15.09.2026',
      '16.09.2026',
      [
        {
          sheetRow: 2,
          cells: ['31-342 Kraków Radzikowskiego 138', 'THOR', '', 50, 10, '', '', 'wt'],
        },
      ],
      {
        headers: odebraneHeaders,
        rows: [
          [
            '',
            '',
            'Radzikowskiego',
            'Tak',
            'wt',
            'THOR',
            '31-342',
            'Kraków',
            'Radzikowskiego',
            '138',
            '',
            '',
            '1',
            '',
            '',
            '15.09.2026',
          ],
          [
            '',
            '',
            'Radzikowskiego',
            'Tak',
            'wt',
            'THOR',
            '31-342',
            'Kraków',
            'Radzikowskiego',
            '138',
            '',
            '',
            '2',
            '',
            '',
            '15.09.2026',
          ],
        ],
      },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      bagCount: 2,
      pickupDate: '15.09.2026',
      contractor: 'THOR',
    });
  });

  it('test_buildScheduleSyncExpected_joins_bags_when_baza_healed_odebrane_has_al', () => {
    const rows = gas.buildScheduleSyncExpected_(
      '15.09.2026',
      '16.09.2026',
      [
        {
          sheetRow: 2,
          cells: ['51-602 Wrocław Kochanowskiego 33', 'THOR', 'T1', 40, 5, 100, '', 'wt'],
        },
      ],
      {
        headers: odebraneHeaders,
        rows: [
          [
            '',
            '',
            'Kochanowskiego',
            'Tak',
            'wt',
            'THOR',
            '51-602',
            'Wrocław',
            'al. Kochanowskiego',
            '33',
            '',
            '',
            '1',
            '',
            '',
            '15.09.2026',
          ],
          [
            '',
            '',
            'Kochanowskiego',
            'Tak',
            'wt',
            'THOR',
            '51-602',
            'Wrocław',
            'al. Kochanowskiego',
            '33',
            '',
            '',
            '2',
            '',
            '',
            '15.09.2026',
          ],
        ],
      },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      address: '51-602 Wrocław Kochanowskiego 33',
      bagCount: 2,
      pickupRate: 40,
      bagRate: 5,
      routeName: 'T1',
    });
  });

  it('test_buildScheduleSyncExpected_includes_shops_only_in_odebrane', () => {
    const rows = gas.buildScheduleSyncExpected_(
      '15.09.2026',
      '16.09.2026',
      [],
      {
        headers: odebraneHeaders,
        rows: [
          [
            '',
            'Firma X',
            'Sklep X',
            'Tak',
            'wt',
            'THOR',
            '31-342',
            'Kraków',
            'Radzikowskiego',
            '138',
            '',
            '',
            '1',
            '',
            '',
            '15.09.2026',
          ],
        ],
      },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      bagCount: 1,
      shopName: 'Sklep X',
      contractor: 'THOR',
    });
  });

  it('test_buildScheduleSyncExpected_when_as_of_pickup_day_should_omit_row', () => {
    const rows = gas.buildScheduleSyncExpected_(
      '15.09.2026',
      '15.09.2026',
      [
        {
          sheetRow: 2,
          cells: ['31-342 Kraków Radzikowskiego 138', 'THOR', '', 50, 10, '', '', 'wt'],
        },
      ],
      {
        headers: odebraneHeaders,
        rows: [
          [
            '',
            '',
            'Radzikowskiego',
            'Tak',
            'wt',
            'THOR',
            '31-342',
            'Kraków',
            'Radzikowskiego',
            '138',
            '',
            '',
            '1',
            '',
            '',
            '15.09.2026',
          ],
        ],
      },
    );
    expect(rows).toHaveLength(0);
  });

  it('test_buildScheduleSyncExpected_when_bags_closed_off_schedule_day_should_roll_to_next_pickup', () => {
    function bag(closeDate: string, plomba: string): string[] {
      return [
        '',
        'SZUBRYT DELIKATESY',
        'Delikatesy Szubryt Nr 005',
        'Tak',
        'pt',
        'Zagroda',
        '38-242',
        'Skołyszyn',
        'Skołyszyn',
        '11B',
        '',
        '',
        plomba,
        '',
        '',
        closeDate,
      ];
    }
    const rows = gas.buildScheduleSyncExpected_(
      '01.10.2026',
      '17.10.2026',
      [
        {
          sheetRow: 2,
          cells: ['38-242 Skołyszyn Skołyszyn 11B', 'Zagroda', '', 50, 10, '', '', 'pt'],
        },
      ],
      { headers: odebraneHeaders, rows: [bag('03.10.2026', 'P1'), bag('09.10.2026', 'P2'), bag('15.10.2026', 'P3')] },
    );
    expect(rows.map((r) => r.pickupDate)).toEqual(['02.10.2026', '09.10.2026', '16.10.2026']);
    expect(rows.map((r) => r.bagCount)).toEqual([0, 2, 1]);
  });
});

describe('planOffScheduleCleanup_', () => {
  it('test_planOffScheduleCleanup_when_bags_closed_off_schedule_day_should_add_them_to_pickup_and_drop_row', () => {
    const address = '38-242 Skołyszyn Skołyszyn 11B';
    const plan = gas.planOffScheduleCleanup_(
      [{ sheetRow: 2, cells: [address, 'Zagroda', '', 50, 10, '', '', 'pt'] }],
      [
        {
          sheetName: 'Harmonogram Październik 2026',
          sheetRow: 5,
          address,
          shopName: 'Delikatesy Szubryt Nr 005',
          podmiot: 'SZUBRYT DELIKATESY',
          contractor: 'Zagroda',
          pickupDate: '09.10.2026',
          bagCount: 1,
          rodzajZbiorki: 'automatyczna',
          settled: false,
          transport: '',
          invoice: '',
        },
        {
          sheetName: 'Harmonogram Październik 2026',
          sheetRow: 3,
          address,
          contractor: 'Zagroda',
          pickupDate: '03.10.2026',
          bagCount: 4,
          rodzajZbiorki: 'ręczna',
          settled: false,
          transport: '',
          invoice: '',
        },
        {
          sheetName: 'Harmonogram Październik 2026',
          sheetRow: 4,
          address,
          contractor: 'Zagroda',
          pickupDate: '06.10.2026',
          bagCount: 3,
          rodzajZbiorki: 'ręczna',
          settled: false,
          transport: '',
          invoice: '',
        },
      ],
      {},
    );
    expect(plan.absorb).toEqual([
      expect.objectContaining({ bagCount: 8, rodzajZbiorki: 'ręczna i automatyczna', sheetRow: 5 }),
    ]);
    expect(plan.remove.map((row) => row.sheetRow).sort()).toEqual([3, 4]);
    expect(plan.skippedSettled).toBe(0);
  });
});
