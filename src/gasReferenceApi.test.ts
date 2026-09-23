/**
 * Brakujące odczyty doGet + zapisy referencji (addPoprawAdres / addReference*) w transport-log.gs.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';

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

  getDisplayValues(): string[][] {
    return this.getValues().map((row) => row.map((v) => (v == null ? '' : String(v))));
  }

  getValue(): Cell {
    return this.sheet.cell(this.row, this.col);
  }

  setValues(values: Cell[][]): void {
    for (let r = 0; r < values.length; r += 1) {
      for (let c = 0; c < values[r].length; c += 1) {
        this.sheet.put(this.row + r, this.col + c, values[r][c]);
      }
    }
  }

  setValue(value: Cell): FakeRange {
    this.sheet.put(this.row, this.col, value);
    return this;
  }

  setNumberFormat(_format: string): FakeRange {
    return this;
  }
}

class FakeSheet {
  private readonly cells = new Map<string, Cell>();
  readonly name: string;
  readonly maxRows = 100;

  constructor(name: string) {
    this.name = name;
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
}

type Json = Record<string, unknown>;

const gsPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../google-apps-script/transport-log.gs',
);
const gs = readFileSync(gsPath, 'utf8');

const sheets = new Map<string, FakeSheet>();
const props = new Map<string, string>();
const TEST_GAS_SECRET = 'test-gas-secret';
let lastBody = '';
let lockDepth = 0;

type GasApi = {
  doGet: (e: { parameter: Record<string, string> }) => unknown;
  doPost: (e: { postData: { contents: string } }) => unknown;
};

let api: GasApi;

function ensureSheet(name: string, headers?: string[]): FakeSheet {
  let sheet = sheets.get(name);
  if (!sheet) {
    sheet = new FakeSheet(name);
    sheets.set(name, sheet);
    if (headers) {
      for (let i = 0; i < headers.length; i += 1) {
        sheet.put(1, i + 1, headers[i]);
      }
    }
  }
  return sheet;
}

beforeAll(() => {
  const context: Record<string, unknown> = {
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return {
          getSheets() {
            return Array.from(sheets.values());
          },
          getSheetByName(name: string) {
            return sheets.get(name) ?? null;
          },
          insertSheet(name: string) {
            const sheet = new FakeSheet(name);
            sheets.set(name, sheet);
            return sheet;
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
    LockService: {
      getScriptLock() {
        return {
          waitLock() {
            lockDepth += 1;
          },
          releaseLock() {
            lockDepth -= 1;
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
    Session: {
      getActiveUser() {
        return {
          getEmail() {
            return 'tester@example.com';
          },
        };
      },
    },
  };
  runInNewContext(gs, context);
  const doGet = context.doGet;
  const doPost = context.doPost;
  if (typeof doGet !== 'function' || typeof doPost !== 'function') {
    throw new Error('transport-log.gs nie wystawił doGet/doPost');
  }
  api = {
    doGet: doGet as GasApi['doGet'],
    doPost: doPost as GasApi['doPost'],
  };
});

function reset(): void {
  sheets.clear();
  props.clear();
  props.set('GAS_SHARED_SECRET', TEST_GAS_SECRET);
  lastBody = '';
  lockDepth = 0;
  ensureSheet('Arkusz1');
}

function body(): Json {
  return JSON.parse(lastBody) as Json;
}

function get(action: string, params: Record<string, string> = {}): Json {
  api.doGet({ parameter: { action, secret: TEST_GAS_SECRET, ...params } });
  return body();
}

function post(payload: Record<string, unknown>): Json {
  lockDepth = 0;
  api.doPost({
    postData: { contents: JSON.stringify({ ...payload, secret: TEST_GAS_SECRET }) },
  });
  expect(lockDepth).toBe(0);
  return body();
}

function seedRegisterRow(row: number, over: Partial<Record<number, Cell>> = {}): void {
  const sheet = ensureSheet('Arkusz1');
  const cols: Cell[] = [
    row - 1,
    'Adres ' + row,
    'Firma',
    'Sklep ' + row,
    '15.09.2026',
    'gpw',
    '',
    '',
    1,
    '',
    '',
    '',
    '',
    '',
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

describe('doGet reference and list actions', () => {
  it('test_doGet_unknown_action_returns_error', () => {
    reset();
    expect(get('nope')).toEqual({ ok: false, error: 'unknown action' });
  });

  it('test_listReferenceData_merges_podwyko_legacy_sheets_and_popraw', () => {
    reset();
    const podwyko = ensureSheet('Lista podwykonawców', ['Nazwa', 'Dane do Worda']);
    podwyko.put(2, 1, 'Alpha');
    podwyko.put(2, 2, 'Alpha Dane');
    const prz = ensureSheet('Przewoźnicy', [
      'Nazwa wyświetlana',
      'Nazwa do protokołu',
      'Adres',
      'NIP',
      'nr BDO',
    ]);
    prz.put(2, 1, 'Beta');
    prz.put(2, 2, 'Beta Proto');
    const dos = ensureSheet('Miejsca dostawy', ['Nazwa', 'Dane do Worda']);
    dos.put(2, 1, 'Alpha');
    dos.put(2, 2, 'Alpha Dane');
    dos.put(3, 1, 'Gamma');
    dos.put(3, 2, 'Gamma Dane');
    const popraw = ensureSheet('Popraw adres', [
      'Podmiot handlowy',
      'Sklep',
      'Adres',
      'Lat',
      'Lon',
      'Uwagi',
      'UpdatedAt',
      'Author',
      'Województwo',
    ]);
    popraw.put(2, 1, 'PH');
    popraw.put(2, 2, 'S1');
    popraw.put(2, 3, 'Ulica 1');
    popraw.put(2, 4, 52.1);
    popraw.put(2, 5, 21.0);
    popraw.put(2, 6, 'ok');
    popraw.put(2, 9, 'mazowieckie');

    const result = get('listReferenceData');
    expect(result.ok).toBe(true);
    const data = result.data as {
      podwykoLista: { nazwa: string; dane: string }[];
      poprawAdres: { adres: string; lat: number; lon: number }[];
    };
    expect(data.podwykoLista.map((e) => e.nazwa).sort()).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(data.poprawAdres).toEqual([
      expect.objectContaining({
        podmiotHandlowy: 'PH',
        sklep: 'S1',
        adres: 'Ulica 1',
        lat: 52.1,
        lon: 21.0,
        uwagi: 'ok',
        wojewodztwo: 'mazowieckie',
      }),
    ]);
  });

  it('test_listContractors_matches_merged_podwyko_lista', () => {
    reset();
    const podwyko = ensureSheet('Lista podwykonawców', ['Nazwa', 'Dane do Worda']);
    podwyko.put(2, 1, 'Jeden');
    podwyko.put(2, 2, 'Dane');
    expect(get('listContractors')).toEqual({
      ok: true,
      data: [{ nazwa: 'Jeden', dane: 'Dane' }],
    });
  });

  it('test_listStoreAddresses_dedupes_by_address_and_sorts', () => {
    reset();
    seedRegisterRow(2, { 2: 'B Adres', 4: '' });
    seedRegisterRow(3, { 2: 'A Adres', 4: 'Sklep A' });
    seedRegisterRow(4, { 2: 'B Adres', 4: 'Sklep B' });
    seedRegisterRow(5, { 2: '', 4: 'Pusty' });

    const result = get('listStoreAddresses');
    expect(result).toEqual({
      ok: true,
      data: [
        { adres: 'A Adres', sklep: 'Sklep A' },
        { adres: 'B Adres', sklep: 'Sklep B' },
      ],
    });
  });

  it('test_routeNameProposal_lists_occupied_route_names', () => {
    reset();
    seedRegisterRow(2, { 10: 'trasa-z' });
    seedRegisterRow(3, { 10: 'trasa-a' });
    seedRegisterRow(4, { 10: 'trasa-z' });
    seedRegisterRow(5, { 10: '' });
    expect(get('routeNameProposal')).toEqual({
      ok: true,
      names: ['trasa-z', 'trasa-a'],
    });
  });

  it('test_modalData_returns_preview_number_and_last_pickup', () => {
    reset();
    seedRegisterRow(2, {
      1: 7,
      2: 'Test 1',
      3: 'Firma',
      5: '10.06.2026',
      6: 'gpw',
    });
    props.set('transportMaxNum', '7');
    props.set('transportLastRow', '2');

    const result = get('modalData', { podmiot: 'Firma', adres: 'Test 1' });
    expect(result.ok).toBe(true);
    expect(result.numer).toBe('8');
    expect(result.lastKtoOdbiera).toBe('gpw');
    expect(typeof result.lastTransportDateMs).toBe('number');
    expect(result.lastTransportDateYmd).toBe('2026-06-10');
  });

  it('test_previewNumber_and_lastTransportDate_actions', () => {
    reset();
    seedRegisterRow(2, {
      1: 3,
      2: 'Ul. X 1',
      3: 'PH',
      5: '01.05.2026',
      6: 'abc',
    });
    props.set('transportMaxNum', '3');
    props.set('transportLastRow', '2');

    expect(get('previewNumber')).toEqual({ ok: true, numer: '4' });
    const last = get('lastTransportDate', { podmiot: 'PH', adres: 'Ul. X 1' });
    expect(last.ok).toBe(true);
    expect(last.lastKtoOdbiera).toBe('abc');
    expect(last.lastTransportDateYmd).toBe('2026-05-01');
  });

  it('test_bulkLastTransportDates_returns_shops_payload', () => {
    reset();
    seedRegisterRow(2, {
      2: 'Adres 1',
      3: 'Firma',
      5: '01.06.2026',
      6: 'gpw',
    });
    const result = get('bulkLastTransportDates');
    expect(result.ok).toBe(true);
    const shops = result.shops as { lastKtoOdbiera: string; lastTransportDateYmd: string }[];
    expect(shops.length).toBeGreaterThanOrEqual(1);
    expect(shops[0].lastKtoOdbiera).toBe('gpw');
    expect(shops[0].lastTransportDateYmd).toBe('2026-06-01');
  });

  it('test_routeRateByName_via_doGet', () => {
    reset();
    seedRegisterRow(2, { 10: 't1', 11: 55, 14: '' });
    seedRegisterRow(3, { 10: 't1', 11: 99, 14: 'tak' });
    expect(get('routeRateByName', { name: 't1' })).toEqual({ ok: true, stawka: '55' });
  });
});

describe('doPost reference writes', () => {
  it('test_addReferencePodwyko_appends_and_rejects_duplicate', () => {
    reset();
    ensureSheet('Lista podwykonawców', ['Nazwa', 'Dane do Worda']);

    const first = post({
      mode: 'addReferencePodwyko',
      nazwa: 'Nova',
      dane: 'Nova Dane',
    });
    expect(first).toEqual({
      ok: true,
      entry: { nazwa: 'Nova', dane: 'Nova Dane' },
    });
    const sheet = sheets.get('Lista podwykonawców')!;
    expect(sheet.cell(2, 1)).toBe('Nova');
    expect(sheet.cell(2, 2)).toBe('Nova Dane');

    expect(
      post({ mode: 'addReferencePodwyko', nazwa: 'Nova', dane: 'Nova Dane' }),
    ).toEqual({ ok: false, error: 'duplicate' });
  });

  it('test_addReferencePodwyko_creates_sheet_when_missing', () => {
    reset();
    expect(sheets.has('Lista podwykonawców')).toBe(false);
    const result = post({
      mode: 'addReferencePodwyko',
      label: 'TylkoLabel',
    });
    expect(result.ok).toBe(true);
    expect(sheets.has('Lista podwykonawców')).toBe(true);
    expect(sheets.get('Lista podwykonawców')!.cell(1, 1)).toBe('Nazwa');
    expect(sheets.get('Lista podwykonawców')!.cell(2, 1)).toBe('TylkoLabel');
  });

  it('test_addReferencePodwyko_missing_name_and_dane_returns_500', () => {
    reset();
    const result = post({ mode: 'addReferencePodwyko' });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain('nazwa or dane required');
  });

  it('test_legacy_addReferencePrzewoznik_writes_to_podwyko_lista', () => {
    reset();
    const result = post({
      mode: 'addReferencePrzewoznik',
      nazwaWyswietlana: 'Przew',
      nazwaDoProtokolu: 'Przew Proto',
      adres: 'ul. 1',
      nip: '1234567890',
      bdo: '000123456',
    });
    expect(result.ok).toBe(true);
    const entry = (result as { entry: { nazwa: string; dane: string } }).entry;
    expect(entry.nazwa).toBe('Przew');
    expect(entry.dane).toContain('Przew Proto');
    expect(entry.dane).toMatch(/NIP/i);
    expect(entry.dane).toMatch(/BDO/i);
  });

  it('test_legacy_addReferenceDostawa_writes_to_podwyko_lista', () => {
    reset();
    const result = post({
      mode: 'addReferenceDostawa',
      nazwa: 'Magazyn',
      dane: 'Magazyn Dane',
    });
    expect(result).toEqual({
      ok: true,
      entry: { nazwa: 'Magazyn', dane: 'Magazyn Dane' },
    });
  });

  it('test_addPoprawAdres_appends_new_row', () => {
    reset();
    const result = post({
      mode: 'addPoprawAdres',
      podmiotHandlowy: 'PH',
      sklep: 'S1',
      adres: 'Nowa 5',
      lat: 52.2297,
      lon: 21.0122,
      uwagi: 'poprawka',
      wojewodztwo: 'mazowieckie',
    });
    expect(result.ok).toBe(true);
    const entry = result.entry as Record<string, unknown>;
    expect(entry).toMatchObject({
      podmiotHandlowy: 'PH',
      sklep: 'S1',
      adres: 'Nowa 5',
      lat: 52.2297,
      lon: 21.0122,
      uwagi: 'poprawka',
      author: 'tester@example.com',
      wojewodztwo: 'mazowieckie',
    });
    expect(String(entry.updatedAt)).toMatch(/^\d{4}-/);
    const sheet = sheets.get('Popraw adres')!;
    expect(sheet.cell(2, 3)).toBe('Nowa 5');
    expect(sheet.cell(2, 4)).toBe(52.2297);
  });

  it('test_addPoprawAdres_overwrites_existing_key', () => {
    reset();
    const sheet = ensureSheet('Popraw adres', [
      'Podmiot handlowy',
      'Sklep',
      'Adres',
      'Lat',
      'Lon',
      'Uwagi',
      'UpdatedAt',
      'Author',
      'Województwo',
    ]);
    sheet.put(2, 1, 'PH');
    sheet.put(2, 2, 'S1');
    sheet.put(2, 3, 'Nowa 5');
    sheet.put(2, 4, 1);
    sheet.put(2, 5, 2);
    sheet.put(2, 6, 'stare');

    const result = post({
      mode: 'addPoprawAdres',
      podmiotHandlowy: 'PH',
      sklep: 'S1',
      adres: 'Nowa 5',
      lat: 50,
      lng: 19,
      uwagi: 'nowe',
    });
    expect(result.ok).toBe(true);
    expect(sheet.cell(2, 4)).toBe(50);
    expect(sheet.cell(2, 5)).toBe(19);
    expect(sheet.cell(2, 6)).toBe('nowe');
    expect(sheet.getLastRow()).toBe(2);
  });

  it('test_addPoprawAdres_missing_adres_or_coords_returns_error', () => {
    reset();
    expect(post({ mode: 'addPoprawAdres', lat: 1, lon: 2 })).toMatchObject({
      ok: false,
    });
    expect(
      post({ mode: 'addPoprawAdres', adres: 'X', lat: 999, lon: 0 }),
    ).toMatchObject({ ok: false });
  });
});
