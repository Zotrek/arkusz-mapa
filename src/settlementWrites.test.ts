import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";

type Cell = string | number | null;

type Write = {
  row: number;
  col: number;
  numRows: number;
  numCols: number;
};

class FakeRange {
  constructor(
    readonly sheet: FakeSheet,
    readonly row: number,
    readonly col: number,
    readonly numRows: number,
    readonly numCols: number,
  ) {}

  getValue(): Cell {
    return this.getValues()[0][0];
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
    this.setValues([[value]]);
  }

  setValues(values: Cell[][]): void {
    if (lockDepth < 1) {
      throw new Error("zapis poza lockiem");
    }
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
}

class FakeSheet {
  private readonly cells = new Map<string, Cell>();
  readonly writes: Write[] = [];
  readonly deletes: number[] = [];

  cell(row: number, col: number): Cell {
    const value = this.cells.get(`${row},${col}`);
    return value == null ? "" : value;
  }

  put(row: number, col: number, value: Cell): void {
    this.cells.set(`${row},${col}`, value);
  }

  getLastRow(): number {
    let max = 0;
    for (const [key, value] of this.cells) {
      if (value == null || value === "") {
        continue;
      }
      const row = Number(key.split(",")[0]);
      if (row > max) {
        max = row;
      }
    }
    return max;
  }

  getRange(row: number, col: number, numRows?: number, numCols?: number): FakeRange {
    return new FakeRange(this, row, col, numRows ?? 1, numCols ?? 1);
  }

  deleteRow(row: number): void {
    if (lockDepth < 1) {
      throw new Error("zapis poza lockiem");
    }
    this.deletes.push(row);
    const next = new Map<string, Cell>();
    for (const [key, value] of this.cells) {
      const comma = key.indexOf(",");
      const current = Number(key.slice(0, comma));
      const col = key.slice(comma + 1);
      if (current === row) {
        continue;
      }
      const shifted = current > row ? current - 1 : current;
      next.set(`${shifted},${col}`, value);
    }
    this.cells.clear();
    for (const [key, value] of next) {
      this.cells.set(key, value);
    }
  }
}

const gsPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../google-apps-script/transport-log.gs',
);
const gs = readFileSync(gsPath, "utf8");

let lockDepth = 0;
let maxLock = 0;
let lastBody = "";

const holder: { register: FakeSheet; rates: FakeSheet | null } = {
  register: new FakeSheet(),
  rates: null,
};

type PostResult = {
  ok: boolean;
  error?: string;
  zapisane?: { sheetRow: number; transportNumber: string }[];
  pominiete?: { sheetRow: number | null; transportNumber: string; reason: string }[];
};

let postToSheet: (body: Record<string, unknown>) => PostResult;

beforeAll(() => {
  const context: Record<string, unknown> = {
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return {
          getSheets() {
            return [holder.register];
          },
          getSheetByName(name: string) {
            if (name === "Arkusz1") {
              return holder.register;
            }
            if (name === "Baza stawek") {
              return holder.rates;
            }
            return null;
          },
        };
      },
    },
    LockService: {
      getScriptLock() {
        return {
          waitLock() {
            lockDepth += 1;
            if (lockDepth > maxLock) {
              maxLock = lockDepth;
            }
          },
          releaseLock() {
            lockDepth -= 1;
          },
        };
      },
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput(text: string) {
        lastBody = text;
        return {
          setMimeType() {
            return this;
          },
        };
      },
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key: string) {
            return key === "GAS_SHARED_SECRET" ? "test-gas-secret" : null;
          },
          setProperty() {},
          deleteProperty() {},
        };
      },
    },
  };
  runInNewContext(gs, context);
  const doPost = context.doPost;
  if (typeof doPost !== "function") {
    throw new Error("transport-log.gs nie wystawił doPost");
  }
  postToSheet = (body) => {
    maxLock = 0;
    doPost({
      postData: { contents: JSON.stringify({ ...body, secret: "test-gas-secret" }) },
    });
    expect(lockDepth).toBe(0);
    expect(maxLock).toBe(1);
    return JSON.parse(lastBody) as PostResult;
  };
});

function fresh(): { register: FakeSheet; rates: FakeSheet } {
  const register = new FakeSheet();
  const rates = new FakeSheet();
  holder.register = register;
  holder.rates = rates;
  return { register, rates };
}

function seedRegister(sheet: FakeSheet, row: number, over: Partial<Record<number, Cell>> = {}): void {
  const cols: Cell[] = [
    15,
    "Sklepowa 1",
    "Firma",
    "Sklep",
    "18.09.2026",
    "gpw",
    "",
    "",
    2,
    "trasa-a",
    "150",
    "",
    "",
    "",
    "",
    "999",
    "111",
    "",
  ];
  for (let i = 0; i < cols.length; i += 1) {
    sheet.put(row, i + 1, cols[i]);
  }
  for (const [key, value] of Object.entries(over)) {
    sheet.put(row, Number(key), value as Cell);
  }
}

function expectCostsUntouched(sheet: FakeSheet, rows: number[]): void {
  for (const row of rows) {
    expect(sheet.cell(row, 16)).toBe("999");
    expect(sheet.cell(row, 17)).toBe("111");
  }
  for (const write of sheet.writes) {
    const end = write.col + write.numCols - 1;
    expect(end < 16 || write.col > 17).toBe(true);
  }
}

function functionSource(name: string): string {
  const marker = `function ${name}(`;
  const start = gs.indexOf(marker);
  if (start < 0) {
    throw new Error(`brak funkcji ${name}`);
  }
  const brace = gs.indexOf("{", start);
  let depth = 0;
  for (let i = brace; i < gs.length; i += 1) {
    const ch = gs[i];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return gs.slice(start, i + 1);
      }
    }
  }
  throw new Error(`niezamknięta funkcja ${name}`);
}

describe("patchBags", () => {
  it("test_patchBags_matching_key_writes_bag_count_and_leaves_cost_columns", () => {
    const { register } = fresh();
    seedRegister(register, 2);
    seedRegister(register, 3, { 1: 16 });

    const result = postToSheet({
      action: "patchBags",
      sheetRow: 2,
      transportNumber: "15",
      iloscWorkow: 4,
    });

    expect(result).toEqual({ ok: true });
    expect(register.cell(2, 9)).toBe(4);
    expect(register.cell(2, 10)).toBe("trasa-a");
    expect(register.cell(3, 9)).toBe(2);
    expectCostsUntouched(register, [2, 3]);
  });

  it("test_patchBags_zero_stays_zero", () => {
    const { register } = fresh();
    seedRegister(register, 2);

    expect(
      postToSheet({ action: "patchBags", sheetRow: "2", transportNumber: 15, iloscWorkow: 0 }),
    ).toEqual({ ok: true });
    expect(register.cell(2, 9)).toBe(0);
    expectCostsUntouched(register, [2]);
  });

  it("test_patchBags_empty_clears_column_9", () => {
    const { register } = fresh();
    seedRegister(register, 2);

    expect(
      postToSheet({ action: "patchBags", sheetRow: 2, transportNumber: "15", iloscWorkow: "" }),
    ).toEqual({ ok: true });
    expect(register.cell(2, 9)).toBe("");
    expectCostsUntouched(register, [2]);
  });

  it("test_patchBags_key_mismatch_writes_nothing", () => {
    const { register } = fresh();
    seedRegister(register, 2);
    seedRegister(register, 3, { 1: 16 });

    expect(
      postToSheet({ action: "patchBags", sheetRow: 2, transportNumber: "16", iloscWorkow: 9 }),
    ).toEqual({ ok: false, error: "key" });
    expect(register.writes).toEqual([]);
    expect(register.cell(2, 9)).toBe(2);
    expect(register.cell(3, 9)).toBe(2);
  });

  it("test_patchBags_settled_or_bad_count_writes_nothing", () => {
    const { register } = fresh();
    seedRegister(register, 2, { 14: " TAK " });

    expect(
      postToSheet({ action: "patchBags", sheetRow: 2, transportNumber: "15", iloscWorkow: 3 }),
    ).toEqual({ ok: false, error: "settled" });
    expect(
      postToSheet({ action: "patchBags", sheetRow: 2, transportNumber: "15", iloscWorkow: "x" }),
    ).toEqual({ ok: false, error: "settled" });
    expect(register.writes).toEqual([]);
    expect(register.cell(2, 9)).toBe(2);
  });

  it("test_patchBags_bad_count_on_open_row_writes_nothing", () => {
    const { register } = fresh();
    seedRegister(register, 2);

    expect(
      postToSheet({ action: "patchBags", sheetRow: 2, transportNumber: "15", iloscWorkow: -1 }),
    ).toEqual({ ok: false, error: "bags" });
    expect(register.writes).toEqual([]);
    expectCostsUntouched(register, [2]);
  });
});

describe("patchRouteRate", () => {
  it("test_patchRouteRate_same_text_updates_other_contractor_and_date_skips_settled", () => {
    const { register } = fresh();
    seedRegister(register, 2);
    seedRegister(register, 3, { 1: 16, 5: "01.01.2026", 6: "inny", 11: "10" });
    seedRegister(register, 4, { 1: 17, 11: "77", 14: "tak" });
    seedRegister(register, 5, { 1: 18, 10: "inna", 11: "5" });

    const result = postToSheet({
      action: "patchRouteRate",
      sheetRow: 2,
      transportNumber: "15",
      trasa: "trasa-a",
      stawkaTrasy: "200",
    });

    expect(result).toEqual({ ok: true });
    expect(register.cell(2, 11)).toBe("200");
    expect(register.cell(3, 11)).toBe("200");
    expect(register.cell(4, 11)).toBe("77");
    expect(register.cell(5, 11)).toBe("5");
    expect(register.cell(2, 10)).toBe("trasa-a");
    expectCostsUntouched(register, [2, 3, 4, 5]);
  });

  it("test_patchRouteRate_zero_writes_zero_and_empty_clears", () => {
    const { register } = fresh();
    seedRegister(register, 2);

    expect(
      postToSheet({
        action: "patchRouteRate",
        sheetRow: 2,
        transportNumber: "15",
        trasa: "trasa-a",
        stawkaTrasy: 0,
      }),
    ).toEqual({ ok: true });
    expect(register.cell(2, 11)).toBe("0");

    expect(
      postToSheet({
        action: "patchRouteRate",
        sheetRow: 2,
        transportNumber: "15",
        trasa: "trasa-a",
        stawkaTrasy: "",
      }),
    ).toEqual({ ok: true });
    expect(register.cell(2, 11)).toBe("");
    expectCostsUntouched(register, [2]);
  });

  it("test_patchRouteRate_key_mismatch_or_settled_writes_nothing", () => {
    const { register } = fresh();
    seedRegister(register, 2);
    seedRegister(register, 3, { 1: 16, 11: "10" });
    seedRegister(register, 4, { 1: 17, 14: "tak" });

    expect(
      postToSheet({
        action: "patchRouteRate",
        sheetRow: 2,
        transportNumber: "16",
        trasa: "trasa-a",
        stawkaTrasy: "200",
      }),
    ).toEqual({ ok: false, error: "key" });
    expect(
      postToSheet({
        action: "patchRouteRate",
        sheetRow: 4,
        transportNumber: "17",
        trasa: "trasa-a",
        stawkaTrasy: "200",
      }),
    ).toEqual({ ok: false, error: "settled" });
    expect(register.writes).toEqual([]);
    expect(register.cell(2, 11)).toBe("150");
    expect(register.cell(3, 11)).toBe("10");
  });
});

describe("detachRoute", () => {
  it("test_detachRoute_clears_one_row_and_leaves_the_rest_of_the_route", () => {
    const { register } = fresh();
    seedRegister(register, 2);
    seedRegister(register, 3, { 1: 16 });

    expect(
      postToSheet({ action: "detachRoute", sheetRow: 2, transportNumber: "15" }),
    ).toEqual({ ok: true });
    expect(register.cell(2, 10)).toBe("");
    expect(register.cell(2, 11)).toBe("");
    expect(register.cell(3, 10)).toBe("trasa-a");
    expect(register.cell(3, 11)).toBe("150");
    expect(register.cell(2, 9)).toBe(2);
    expectCostsUntouched(register, [2, 3]);
  });

  it("test_detachRoute_key_mismatch_writes_nothing", () => {
    const { register } = fresh();
    seedRegister(register, 2);

    expect(
      postToSheet({ action: "detachRoute", sheetRow: 9, transportNumber: "15" }),
    ).toEqual({ ok: false, error: "key" });
    expect(register.writes).toEqual([]);
    expect(register.cell(2, 10)).toBe("trasa-a");
    expectCostsUntouched(register, [2]);
  });
});

describe("attachRoute", () => {
  it("test_attachRoute_zero_rate_writes_and_propagates_by_name", () => {
    const { register } = fresh();
    seedRegister(register, 2, { 10: "", 11: "" });
    seedRegister(register, 3, { 1: 16, 6: "inny", 10: "nowa", 11: "10" });
    seedRegister(register, 4, { 1: 17, 10: "nowa", 11: "77", 14: "tak" });

    const result = postToSheet({
      action: "attachRoute",
      sheetRow: 2,
      transportNumber: "15",
      trasa: "  nowa  ",
      stawkaTrasy: "0",
    });

    expect(result).toEqual({ ok: true });
    expect(register.cell(2, 10)).toBe("nowa");
    expect(register.cell(2, 11)).toBe("0");
    expect(register.cell(3, 10)).toBe("nowa");
    expect(register.cell(3, 11)).toBe("0");
    expect(register.cell(4, 11)).toBe("77");
    expectCostsUntouched(register, [2, 3, 4]);
  });

  it("test_attachRoute_empty_rate_or_name_writes_nothing", () => {
    const { register } = fresh();
    seedRegister(register, 2, { 10: "", 11: "" });

    expect(
      postToSheet({
        action: "attachRoute",
        sheetRow: 2,
        transportNumber: "15",
        trasa: "nowa",
        stawkaTrasy: "",
      }),
    ).toEqual({ ok: false, error: "rate" });
    expect(
      postToSheet({
        action: "attachRoute",
        sheetRow: 2,
        transportNumber: "15",
        trasa: " ",
        stawkaTrasy: "0",
      }),
    ).toEqual({ ok: false, error: "name" });
    expect(register.writes).toEqual([]);
    expect(register.cell(2, 10)).toBe("");
    expect(register.cell(2, 11)).toBe("");
    expectCostsUntouched(register, [2]);
  });

  it("test_attachRoute_key_mismatch_writes_nothing", () => {
    const { register } = fresh();
    seedRegister(register, 2, { 10: "", 11: "" });

    expect(
      postToSheet({
        action: "attachRoute",
        sheetRow: 2,
        transportNumber: "99",
        trasa: "nowa",
        stawkaTrasy: "0",
      }),
    ).toEqual({ ok: false, error: "key" });
    expect(register.writes).toEqual([]);
    expect(register.cell(2, 10)).toBe("");
  });
});

describe("resolveRateTie", () => {
  it("test_resolveRateTie_keeps_row_deletes_same_pair_and_date_leaves_register", () => {
    const { register, rates } = fresh();
    seedRegister(register, 2);
    rates.put(1, 1, "Sklep");
    rates.put(2, 1, "Sklepowa 1");
    rates.put(2, 2, "gpw");
    rates.put(2, 3, 20);
    rates.put(2, 4, 10);
    rates.put(2, 5, "");
    rates.put(3, 1, "Sklepowa 1");
    rates.put(3, 2, "gpw");
    rates.put(3, 3, 30);
    rates.put(3, 4, 12);
    rates.put(3, 5, "");
    rates.put(4, 1, "Sklepowa 1");
    rates.put(4, 2, "gpw");
    rates.put(4, 3, 40);
    rates.put(4, 4, 10);
    rates.put(4, 5, "10.10.2026");
    rates.put(5, 1, "Inna 9");
    rates.put(5, 2, "gpw");
    rates.put(5, 3, 1);
    rates.put(5, 4, 1);
    rates.put(5, 5, "");
    rates.put(6, 1, "Sklepowa 1");
    rates.put(6, 2, "gpw");
    rates.put(6, 3, 50);
    rates.put(6, 4, 10);
    rates.put(6, 5, "");

    const result = postToSheet({ action: "resolveRateTie", sheetRow: 2 });

    expect(result).toEqual({ ok: true });
    expect(rates.deletes).toEqual([6, 3]);
    expect(rates.cell(2, 3)).toBe(20);
    expect(rates.cell(3, 5)).toBe("10.10.2026");
    expect(rates.cell(4, 1)).toBe("Inna 9");
    expect(rates.getLastRow()).toBe(4);
    expect(register.writes).toEqual([]);
    expect(register.deletes).toEqual([]);
    expect(register.cell(2, 16)).toBe("999");
    expect(register.cell(2, 17)).toBe("111");
  });

  it("test_resolveRateTie_missing_row_or_sheet_deletes_nothing", () => {
    const { rates } = fresh();
    rates.put(2, 1, "Sklepowa 1");
    rates.put(2, 2, "gpw");
    rates.put(2, 5, "32.13.2026");

    expect(postToSheet({ action: "resolveRateTie", sheetRow: 2 })).toEqual({
      ok: false,
      error: "key",
    });
    expect(rates.deletes).toEqual([]);

    holder.rates = null;
    expect(postToSheet({ action: "resolveRateTie", sheetRow: 2 })).toEqual({
      ok: false,
      error: "key",
    });
  });
});

function seedRate(
  sheet: FakeSheet,
  row: number,
  shop: string,
  contractor: string,
  from: string,
): void {
  sheet.put(row, 1, shop);
  sheet.put(row, 2, contractor);
  sheet.put(row, 3, 20);
  sheet.put(row, 4, 10);
  sheet.put(row, 5, from);
}

describe("approve", () => {
  it("test_approve_blank_invoice_writes_nothing", () => {
    const { register } = fresh();
    seedRegister(register, 2);

    expect(
      postToSheet({
        action: "approve",
        numerFaktury: "  ",
        wiersze: [{ sheetRow: 2, transportNumber: "15", koszt: 3000 }],
      }),
    ).toEqual({ ok: false, error: "invoice" });
    expect(
      postToSheet({
        action: "approve",
        wiersze: [{ sheetRow: 2, transportNumber: "15", koszt: 3000 }],
      }),
    ).toEqual({ ok: false, error: "invoice" });
    expect(register.writes).toEqual([]);
    expect(register.cell(2, 14)).toBe("");
    expect(register.cell(2, 16)).toBe("999");
    expect(register.cell(2, 18)).toBe("");
  });

  it("test_approve_empty_selection_writes_nothing", () => {
    const { register } = fresh();
    seedRegister(register, 2);

    expect(postToSheet({ action: "approve", numerFaktury: "FV/1", wiersze: [] })).toEqual({
      ok: false,
      error: "selection",
    });
    expect(postToSheet({ action: "approve", numerFaktury: "FV/1" })).toEqual({
      ok: false,
      error: "selection",
    });
    expect(register.writes).toEqual([]);
    expect(register.cell(2, 14)).toBe("");
  });

  it("test_approve_happened_writes_status_invoice_and_both_cost_columns", () => {
    const { register } = fresh();
    seedRegister(register, 2);
    seedRegister(register, 3, { 1: 16 });

    const result = postToSheet({
      action: "approve",
      numerFaktury: " FV/12 ",
      wiersze: [{ sheetRow: 2, transportNumber: "15", koszt: 3000, tylkoWorki: false }],
    });

    expect(result).toEqual({
      ok: true,
      zapisane: [{ sheetRow: 2, transportNumber: "15" }],
      pominiete: [],
    });
    expect(register.cell(2, 14)).toBe("tak");
    expect(register.cell(2, 15)).toBe("FV/12");
    expect(register.cell(2, 16)).toBe(30);
    expect(register.cell(2, 17)).toBe(15);
    expect(register.cell(2, 18)).toBe("");
    expect(register.cell(2, 9)).toBe(2);
    expect(register.cell(2, 10)).toBe("trasa-a");
    expect(register.cell(2, 11)).toBe("150");
    expect(register.cell(3, 14)).toBe("");
    expect(register.cell(3, 15)).toBe("");
    expect(register.cell(3, 16)).toBe("999");
    expect(register.cell(3, 17)).toBe("111");
    expect(register.cell(3, 18)).toBe("");
    expect(register.writes).toEqual([{ row: 2, col: 14, numRows: 1, numCols: 4 }]);
  });

  it("test_approve_zero_cost_stays_and_empty_or_zero_bags_divide_by_one", () => {
    const { register } = fresh();
    seedRegister(register, 2);
    seedRegister(register, 3, { 1: 16, 9: "" });
    seedRegister(register, 4, { 1: 17, 9: 0 });

    const result = postToSheet({
      action: "approve",
      numerFaktury: 0,
      wiersze: [
        { sheetRow: 2, transportNumber: "15", koszt: 0 },
        { sheetRow: 3, transportNumber: "16", koszt: 1000 },
        { sheetRow: 4, transportNumber: "17", koszt: 1000 },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.pominiete).toEqual([]);
    expect(register.cell(2, 14)).toBe("tak");
    expect(register.cell(2, 15)).toBe("0");
    expect(register.cell(2, 16)).toBe(0);
    expect(register.cell(2, 17)).toBe(0);
    expect(register.cell(3, 16)).toBe(10);
    expect(register.cell(3, 17)).toBe(10);
    expect(register.cell(4, 16)).toBe(10);
    expect(register.cell(4, 17)).toBe(10);
  });

  it("test_approve_per_bag_rounds_half_up", () => {
    const { register } = fresh();
    seedRegister(register, 2, { 9: 3 });
    seedRegister(register, 3, { 1: 16, 9: 2 });

    postToSheet({
      action: "approve",
      numerFaktury: "FV/1",
      wiersze: [
        { sheetRow: 2, transportNumber: "15", koszt: 10000 },
        { sheetRow: 3, transportNumber: "16", koszt: 1 },
      ],
    });

    expect(register.cell(2, 16)).toBe(100);
    expect(register.cell(2, 17)).toBe(33.33);
    expect(register.cell(3, 16)).toBe(0.01);
    expect(register.cell(3, 17)).toBe(0.01);
  });

  it("test_approve_did_not_happen_writes_only_column_18", () => {
    const { register } = fresh();
    seedRegister(register, 2);
    seedRegister(register, 3, { 1: 16 });

    const result = postToSheet({
      action: "approve",
      numerFaktury: "FV/1",
      wiersze: [
        { sheetRow: 2, transportNumber: "15", nieOdbył: true, koszt: 3000 },
        { sheetRow: 3, transportNumber: "16", nieOdbył: " NIE " },
      ],
    });

    expect(result.zapisane).toEqual([
      { sheetRow: 2, transportNumber: "15" },
      { sheetRow: 3, transportNumber: "16" },
    ]);
    expect(register.cell(2, 18)).toBe("nie");
    expect(register.cell(2, 14)).toBe("");
    expect(register.cell(2, 15)).toBe("");
    expect(register.cell(2, 16)).toBe("999");
    expect(register.cell(2, 17)).toBe("111");
    expect(register.cell(3, 18)).toBe("nie");
    expect(register.cell(3, 14)).toBe("");
    expect(register.writes).toEqual([
      { row: 2, col: 18, numRows: 1, numCols: 1 },
      { row: 3, col: 18, numRows: 1, numCols: 1 },
    ]);
  });

  it("test_approve_route_writes_each_selected_shop_and_leaves_the_rest", () => {
    const { register } = fresh();
    seedRegister(register, 2, { 9: 1 });
    seedRegister(register, 3, { 1: 16, 9: 1 });
    seedRegister(register, 4, { 1: 17, 9: 1 });

    const result = postToSheet({
      action: "approve",
      numerFaktury: "FV/9",
      wiersze: [
        { sheetRow: 2, transportNumber: "15", koszt: 7500 },
        { sheetRow: 3, transportNumber: "16", nieOdbył: true },
      ],
    });

    expect(result.zapisane).toEqual([
      { sheetRow: 2, transportNumber: "15" },
      { sheetRow: 3, transportNumber: "16" },
    ]);
    expect(register.cell(2, 14)).toBe("tak");
    expect(register.cell(2, 15)).toBe("FV/9");
    expect(register.cell(2, 16)).toBe(75);
    expect(register.cell(2, 17)).toBe(75);
    expect(register.cell(2, 18)).toBe("");
    expect(register.cell(3, 18)).toBe("nie");
    expect(register.cell(3, 14)).toBe("");
    expect(register.cell(3, 16)).toBe("999");
    expect(register.cell(4, 14)).toBe("");
    expect(register.cell(4, 15)).toBe("");
    expect(register.cell(4, 16)).toBe("999");
    expect(register.cell(4, 18)).toBe("");
    expect(register.cell(4, 10)).toBe("trasa-a");
  });

  it("test_approve_skips_bad_key_settled_and_writes_open_rows_including_former_tie", () => {
    const { register, rates } = fresh();
    seedRegister(register, 2);
    seedRegister(register, 3, { 1: 16, 2: "Inna 2" });
    seedRegister(register, 4, { 1: 17, 14: " TAK ", 15: "STARY", 16: "1", 17: "2" });
    seedRegister(register, 5, { 1: 18, 2: "Remisowa 3" });
    seedRate(rates, 2, "Remisowa 3", "gpw", "10.09.2026");
    seedRate(rates, 3, "Remisowa 3", "gpw", "10.09.2026");
    seedRate(rates, 4, "Remisowa 3", "gpw", "");
    seedRate(rates, 5, "Sklep", "gpw", "");
    seedRate(rates, 6, "Sklep", "gpw", "");

    const result = postToSheet({
      action: "approve",
      numerFaktury: "FV/2",
      wiersze: [
        { sheetRow: 2, transportNumber: "99", koszt: 3000 },
        { sheetRow: 4, transportNumber: "17", koszt: 3000 },
        { sheetRow: 5, transportNumber: "18", koszt: 3000 },
        { sheetRow: 3, transportNumber: "16", koszt: 2000 },
      ],
    });

    expect(result).toEqual({
      ok: true,
      zapisane: [
        { sheetRow: 5, transportNumber: "18" },
        { sheetRow: 3, transportNumber: "16" },
      ],
      pominiete: [
        { sheetRow: 2, transportNumber: "99", reason: "key" },
        { sheetRow: 4, transportNumber: "17", reason: "settled" },
      ],
    });
    expect(register.cell(2, 14)).toBe("");
    expect(register.cell(2, 16)).toBe("999");
    expect(register.cell(4, 14)).toBe(" TAK ");
    expect(register.cell(4, 15)).toBe("STARY");
    expect(register.cell(4, 16)).toBe("1");
    expect(register.cell(5, 14)).toBe("tak");
    expect(register.cell(5, 15)).toBe("FV/2");
    expect(register.cell(5, 16)).toBe(30);
    expect(register.cell(3, 14)).toBe("tak");
    expect(register.cell(3, 15)).toBe("FV/2");
    expect(register.cell(3, 16)).toBe(20);
    expect(register.cell(3, 17)).toBe(10);
    expect(rates.deletes).toEqual([]);
    expect(rates.writes).toEqual([]);
  });

  it("test_approve_older_rate_duplicate_does_not_block", () => {
    const { register, rates } = fresh();
    seedRegister(register, 2);
    seedRate(rates, 2, "Sklepowa 1", "gpw", "");
    seedRate(rates, 3, "Sklepowa 1", "gpw", "");
    seedRate(rates, 4, "Sklepowa 1", "gpw", "10.09.2026");

    const result = postToSheet({
      action: "approve",
      numerFaktury: "FV/3",
      wiersze: [{ sheetRow: 2, transportNumber: "15", koszt: 3000 }],
    });

    expect(result.pominiete).toEqual([]);
    expect(register.cell(2, 14)).toBe("tak");
    expect(register.cell(2, 16)).toBe(30);
  });

  it("test_approve_writes_payload_cost_and_ignores_screen_rates", () => {
    const { register, rates } = fresh();
    seedRegister(register, 2, { 10: "", 11: "" });
    seedRate(rates, 2, "Sklepowa 1", "gpw", "");

    postToSheet({
      action: "approve",
      numerFaktury: "FV/4",
      wiersze: [
        {
          sheetRow: 2,
          transportNumber: "15",
          koszt: 1000,
          tylkoWorki: true,
          kwotaPodjazd: 2000,
          kwotaWorek: 1000,
        },
      ],
    });

    expect(register.cell(2, 16)).toBe(10);
    expect(register.cell(2, 17)).toBe(5);
    expect(rates.writes).toEqual([]);
    expect(functionSource("approve_")).not.toContain("kwotaPodjazd");
    expect(functionSource("approve_")).not.toContain("tylkoWorki");
  });

  it("test_approve_rate_sheet_tie_does_not_block_did_not_happen", () => {
    const { register, rates } = fresh();
    seedRegister(register, 2);
    seedRate(rates, 2, "Sklepowa 1", "gpw", "");
    seedRate(rates, 3, "Sklepowa 1", "gpw", "");

    const result = postToSheet({
      action: "approve",
      numerFaktury: "FV/5",
      wiersze: [{ sheetRow: 2, transportNumber: "15", nieOdbył: true, koszt: 0 }],
    });

    expect(result).toEqual({
      ok: true,
      zapisane: [{ sheetRow: 2, transportNumber: "15" }],
      pominiete: [],
    });
    expect(register.cell(2, 18)).toBe("nie");
    expect(register.cell(2, 14)).toBe("");
  });

  it("test_approve_sheet_nie_does_not_receive_cost_columns", () => {
    const { register } = fresh();
    seedRegister(register, 2, { 18: "nie" });

    const result = postToSheet({
      action: "approve",
      numerFaktury: "FV/6",
      wiersze: [{ sheetRow: 2, transportNumber: "15", koszt: 3000 }],
    });

    expect(result.pominiete).toEqual([{ sheetRow: 2, transportNumber: "15", reason: "nie" }]);
    expect(register.writes).toEqual([]);
    expect(register.cell(2, 14)).toBe("");
    expect(register.cell(2, 16)).toBe("999");
    expect(register.cell(2, 18)).toBe("nie");
  });

  it("test_approve_unreadable_pickup_date_is_skipped", () => {
    const { register } = fresh();
    seedRegister(register, 2, { 5: "nie-data" });
    seedRegister(register, 3, { 1: 16 });

    const result = postToSheet({
      action: "approve",
      numerFaktury: "FV/8",
      wiersze: [
        { sheetRow: 2, transportNumber: "15", koszt: 3000 },
        { sheetRow: 3, transportNumber: "16", koszt: 1000 },
      ],
    });

    expect(result.pominiete).toEqual([{ sheetRow: 2, transportNumber: "15", reason: "date" }]);
    expect(register.cell(2, 14)).toBe("");
    expect(register.cell(3, 14)).toBe("tak");
    expect(register.cell(3, 16)).toBe(10);
  });

  it("test_approve_iso_pickup_date_is_accepted", () => {
    const { register } = fresh();
    seedRegister(register, 2, { 5: "2026-09-18" });

    const result = postToSheet({
      action: "approve",
      numerFaktury: "FV/8b",
      wiersze: [{ sheetRow: 2, transportNumber: "15", koszt: 3000 }],
    });

    expect(result.pominiete).toEqual([]);
    expect(register.cell(2, 14)).toBe("tak");
    expect(register.cell(2, 16)).toBe(30);
  });

  it("test_approve_bad_cost_skips_row_and_missing_rate_sheet_still_writes", () => {
    const { register } = fresh();
    seedRegister(register, 2);
    seedRegister(register, 3, { 1: 16 });
    holder.rates = null;

    const result = postToSheet({
      action: "approve",
      numerFaktury: "FV/7",
      wiersze: [
        { sheetRow: 2, transportNumber: "15", koszt: 30.5 },
        { sheetRow: 3, transportNumber: "16", koszt: "2000" },
      ],
    });

    expect(result.zapisane).toEqual([{ sheetRow: 3, transportNumber: "16" }]);
    expect(result.pominiete).toEqual([{ sheetRow: 2, transportNumber: "15", reason: "cost" }]);
    expect(register.cell(2, 14)).toBe("");
    expect(register.cell(3, 16)).toBe(20);
    expect(register.cell(3, 17)).toBe(10);
  });
});

describe("zapis w transport-log.gs", () => {
  it("test_settlement_writes_stay_behind_lock_and_saveRate_is_not_copied", () => {
    const postFn = functionSource("doPost");
    const lockAt = postFn.indexOf("waitLock");
    expect(postFn.indexOf("isSettlementWriteAction_")).toBeGreaterThan(lockAt);
    expect(postFn.indexOf("settlementSearch")).toBeLessThan(lockAt);
    expect(postFn).not.toContain("settlementStats");
    expect(functionSource("doGet")).toContain("action === 'settlementStats'");
    expect(functionSource("settlementStats_")).not.toMatch(
      /setValue|setValues|appendRow|insertSheet|deleteRow|deleteRows|getOrCreate|setFormula/,
    );
    const gate = functionSource("isSettlementWriteAction_");
    const run = functionSource("runSettlementWrite_");
    for (const action of [
      "patchBags",
      "patchRouteRate",
      "detachRoute",
      "attachRoute",
      "resolveRateTie",
      "approve",
    ]) {
      expect(gate).toContain(action);
      expect(run).toContain(action);
    }
    expect(gs.split("function handleSaveRatePost_").length - 1).toBe(1);
    expect(run).not.toContain("saveRate");
    expect(functionSource("resolveRateTie_")).not.toContain("getDataSheet_");
    expect(functionSource("resolveRateTie_")).not.toContain("getOrCreateRateSheet_");
    for (const name of ["patchBags_", "patchRouteRate_", "detachRoute_", "attachRoute_"]) {
      const src = functionSource(name);
      expect(src).not.toContain("kosztOdbioru");
      expect(src).not.toContain("kosztPerWorek");
      expect(src).not.toContain("ensureTransportRegisterColumns_");
    }
    const approve = functionSource("approve_");
    expect(approve).not.toContain("ensureTransportRegisterColumns_");
    expect(approve).not.toContain("getOrCreateRateSheet_");
    expect(approve).not.toContain("REGISTER_HEADERS");
  });
});
