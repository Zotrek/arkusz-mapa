/**
 * Odczyt settlementSearch / settlementStats z transport-log.gs (bez zapisu, bez locka).
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
} = {
  register: new FakeSheet('Arkusz1'),
  rates: null,
  odebrane: null,
  schedule: null,
};

let lastBody = '';
let gas: GasFns;
const TEST_GAS_SECRET = 'test-gas-secret';

beforeAll(() => {
  const props = new Map<string, string>([['GAS_SHARED_SECRET', TEST_GAS_SECRET]]);
  const context: Record<string, unknown> = {
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return {
          getSheets() {
            const out: FakeSheet[] = [holder.register];
            if (holder.schedule) {
              out.push(holder.schedule);
            }
            return out;
          },
          getSheetByName(name: string) {
            if (name === holder.register.name) {
              return holder.register;
            }
            if (name === 'Baza stawek') {
              return holder.rates;
            }
            if (name === 'odebrane z harmonogramu') {
              return holder.odebrane;
            }
            if (holder.schedule && name === holder.schedule.name) {
              return holder.schedule;
            }
            return null;
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
  };
  runInNewContext(gs, context);
  const search = context.settlementSearch_;
  const stats = context.settlementStats_;
  const doGet = context.doGet;
  const buildRead = context.buildSettlementRead_;
  const buildStats = context.buildSettlementStats_;
  const buildHarm = context.buildSettlementHarmonogramRead_;
  const buildSync = context.buildScheduleSyncExpected_;
  if (
    typeof search !== 'function' ||
    typeof stats !== 'function' ||
    typeof doGet !== 'function' ||
    typeof buildRead !== 'function' ||
    typeof buildStats !== 'function' ||
    typeof buildHarm !== 'function' ||
    typeof buildSync !== 'function'
  ) {
    throw new Error('transport-log.gs nie wystawił settlementSearch/settlementStats');
  }
  gas = {
    settlementSearch_: search as GasFns['settlementSearch_'],
    settlementStats_: stats as GasFns['settlementStats_'],
    doGet: doGet as GasFns['doGet'],
    buildSettlementRead_: buildRead as GasFns['buildSettlementRead_'],
    buildSettlementStats_: buildStats as GasFns['buildSettlementStats_'],
    buildSettlementHarmonogramRead_: buildHarm as GasFns['buildSettlementHarmonogramRead_'],
    buildScheduleSyncExpected_: buildSync as GasFns['buildScheduleSyncExpected_'],
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
    seedRegister(register, 2, { 1: 20, 5: '15.09.2026', 15: 'tak', 17: 200, 18: 50 });
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
    });
    expect(result.rows.some((r) => r.mode === 'report' && r.transportNumber === '40')).toBe(true);
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
      pickupRate: 10000,
      bagRate: 1000,
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
});
