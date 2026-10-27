import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const gasPath = join(dirname(fileURLToPath(import.meta.url)), '../google-apps-script/transport-log.gs');

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) {
    throw new Error(`missing ${name}`);
  }
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  throw new Error(`unclosed ${name}`);
}

const NAMES = [
  'settlementText_',
  'settlementFlag_',
  'settlementAmountToGrosze_',
  'settlementBagCount_',
  'approveRoundInteger_',
  'approveRoundReal_',
  'approvePerBagGrosze_',
  'approveZlotyFromGrosze_',
  'harmonogramBagFeeGrosze_',
  'receptionCostCellEmpty_',
  'receptionCostCell_',
  'receptionRouteHeadcount_',
  'emptyReceptionCostForRow_',
  'receptionCostEditTouches_',
] as const;

type Cost = { zloty: number; perZloty: number } | null;

type Gas = {
  emptyReceptionCostForRow_: (
    values: unknown[][],
    index: number,
    layout: Layout,
  ) => Cost;
  receptionCostEditTouches_: (layout: Layout, startCol: number, endCol: number) => boolean;
};

type Layout = {
  kto: number;
  worki: number;
  transport: number;
  trasa: number;
  stawkaTrasy: number;
  stawkaPodjazdu: number;
  stawkaWorka: number;
  rozliczony: number;
  faktura: number;
  koszt: number;
  perWorek: number;
};

const layout: Layout = {
  kto: 1,
  worki: 2,
  transport: 3,
  trasa: 4,
  stawkaTrasy: 5,
  stawkaPodjazdu: 6,
  stawkaWorka: 7,
  rozliczony: 8,
  faktura: 9,
  koszt: 10,
  perWorek: 11,
};

function loadGas(): Gas {
  const source = readFileSync(gasPath, 'utf8');
  const sandbox: { gas?: Gas } = {};
  runInNewContext(
    [...NAMES.map((name) => functionBody(source, name)), `gas = { emptyReceptionCostForRow_, receptionCostEditTouches_ };`].join(
      '\n',
    ),
    sandbox,
  );
  if (!sandbox.gas) {
    throw new Error('gas');
  }
  return sandbox.gas;
}

/** kto, worki, transport, trasa, stawka trasy, podjazd, worek, rozliczony, faktura, koszt, per worek */
function row(
  partial: Partial<{
    kto: string;
    worki: number | '';
    transport: string;
    trasa: string;
    stawkaTrasy: number | '';
    podjazd: number | '';
    worek: number | '';
    rozliczony: string;
    faktura: string;
    koszt: number | '';
    per: number | '';
  }>,
): unknown[] {
  return [
    partial.kto ?? 'RPM',
    partial.worki ?? '',
    partial.transport ?? 'tak',
    partial.trasa ?? '',
    partial.stawkaTrasy ?? '',
    partial.podjazd ?? '',
    partial.worek ?? '',
    partial.rozliczony ?? 'tak',
    partial.faktura ?? '37/10/2026/VA',
    partial.koszt ?? '',
    partial.per ?? '',
  ];
}

describe('emptyReceptionCostForRow_', () => {
  const gas = loadGas();

  it('test_emptyReceptionCost_route_share_splits_rate_across_same_invoice', () => {
    const values = [
      row({ worki: 5, trasa: 'RPM-14.10.26-01_2', stawkaTrasy: 1200 }),
      row({ worki: 4, trasa: 'RPM-14.10.26-01_2', stawkaTrasy: 1050, koszt: 130, per: 2.6 }),
    ];
    expect(gas.emptyReceptionCostForRow_(values, 0, layout)).toEqual({ zloty: 600, perZloty: 120 });
    expect(gas.emptyReceptionCostForRow_(values, 1, layout)).toBeNull();
  });

  it('test_emptyReceptionCost_other_invoice_and_missed_transport_stay_out_of_headcount', () => {
    const values = [
      row({ worki: 1, trasa: 'Trasa', stawkaTrasy: 90 }),
      row({ worki: 1, trasa: 'Trasa', stawkaTrasy: 90, faktura: 'INNA' }),
      row({ worki: 1, trasa: 'Trasa', stawkaTrasy: 90, transport: 'nie' }),
    ];
    expect(gas.emptyReceptionCostForRow_(values, 0, layout)).toEqual({ zloty: 90, perZloty: 90 });
  });

  it('test_emptyReceptionCost_plain_pickup_adds_bag_fee_and_skips_open_row', () => {
    const values = [
      row({ worki: 4, podjazd: 20, worek: 2.5 }),
      row({ worki: 4, podjazd: 20, worek: 2.5, rozliczony: '' }),
    ];
    expect(gas.emptyReceptionCostForRow_(values, 0, layout)).toEqual({ zloty: 30, perZloty: 7.5 });
    expect(gas.emptyReceptionCostForRow_(values, 1, layout)).toBeNull();
  });

  it('test_emptyReceptionCost_did_not_happen_writes_zero', () => {
    const values = [row({ transport: 'nie', trasa: 'Trasa', stawkaTrasy: 1200, worki: 5 })];
    expect(gas.emptyReceptionCostForRow_(values, 0, layout)).toEqual({ zloty: 0, perZloty: 0 });
  });

  it('test_emptyReceptionCost_zero_on_settled_route_is_recalculated', () => {
    const values = [
      row({
        worki: 5,
        trasa: 'RPM-05.10.26-01_2',
        stawkaTrasy: 1200,
        faktura: '37/10/2026/FVA',
        koszt: 0,
        per: 0,
      }),
    ];
    expect(gas.emptyReceptionCostForRow_(values, 0, layout)).toEqual({ zloty: 1200, perZloty: 240 });
  });

  it('test_emptyReceptionCost_zero_already_matching_stays', () => {
    const values = [row({ transport: 'nie', trasa: 'Trasa', stawkaTrasy: 1200, koszt: 0, per: 0 })];
    expect(gas.emptyReceptionCostForRow_(values, 0, layout)).toBeNull();
  });

  it('test_receptionCostEditTouches_rate_column_only', () => {
    expect(gas.receptionCostEditTouches_(layout, layout.stawkaTrasy, layout.stawkaTrasy)).toBe(true);
    expect(gas.receptionCostEditTouches_(layout, layout.koszt, layout.perWorek)).toBe(false);
  });
});
