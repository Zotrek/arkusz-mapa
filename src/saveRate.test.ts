import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  normalizeRateShopKey,
  RATE_HEADERS,
  RATE_SHEET_NAME,
  saveRateRulesSource,
} from './saveRate.js';

const gasPath = join(dirname(fileURLToPath(import.meta.url)), '../google-apps-script/transport-log.gs');

type RateAmount = { empty: true } | { empty: false; value: number };
type RateKeyRow = { row: number; shop: string; contractor: string; validFrom: string };
type SaveRateDecision =
  | { action: 'overwrite'; row: number; rows: number[] }
  | { action: 'append' };

type SaveRateRules = {
  normalizeRateDate_: (text: unknown) => string | null;
  parseRateAmount_: (text: unknown) => RateAmount | null;
  rateAmountCell_: (amount: RateAmount) => '' | number;
  normalizeRateShopKey_: (text: unknown) => string;
  decideSaveRate_: (
    rows: readonly RateKeyRow[],
    shop: string,
    contractor: string,
    validFrom: string,
  ) => SaveRateDecision;
  rateCellDateKey_: (value: unknown) => string | null;
};

function loadRules(): SaveRateRules {
  const context: { rules?: SaveRateRules } = {};
  runInNewContext(
    `${saveRateRulesSource}\nrules = { normalizeRateDate_, parseRateAmount_, rateAmountCell_, normalizeRateShopKey_, decideSaveRate_, rateCellDateKey_ };`,
    context,
  );
  if (!context.rules) {
    throw new Error('saveRate rules did not load');
  }
  return context.rules;
}

function gasSource(): string {
  return readFileSync(gasPath, 'utf8');
}

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

describe('saveRate', () => {
  const rules = loadRules();

  it('test_normalizeRateDate_when_empty_or_padded_should_keep_calendar_key', () => {
    expect(rules.normalizeRateDate_('')).toBe('');
    expect(rules.normalizeRateDate_('   ')).toBe('');
    expect(rules.normalizeRateDate_(null)).toBe('');
    expect(rules.normalizeRateDate_('1.9.2026')).toBe('01.09.2026');
    expect(rules.normalizeRateDate_('10.09.2026')).toBe('10.09.2026');
    expect(rules.normalizeRateDate_('29.02.2024')).toBe('29.02.2024');
  });

  it('test_normalizeRateDate_when_invalid_should_return_null', () => {
    expect(rules.normalizeRateDate_('10.09.26')).toBeNull();
    expect(rules.normalizeRateDate_('2026-09-10')).toBeNull();
    expect(rules.normalizeRateDate_('31.04.2026')).toBeNull();
    expect(rules.normalizeRateDate_('29.02.2025')).toBeNull();
    expect(rules.normalizeRateDate_('00.01.2026')).toBeNull();
  });

  it('test_parseRateAmount_when_empty_or_zero_should_stay_distinct', () => {
    expect(rules.parseRateAmount_(null)).toEqual({ empty: true });
    expect(rules.parseRateAmount_('')).toEqual({ empty: true });
    expect(rules.parseRateAmount_('  ')).toEqual({ empty: true });
    expect(rules.parseRateAmount_('0')).toEqual({ empty: false, value: 0 });
    expect(rules.parseRateAmount_('0,00')).toEqual({ empty: false, value: 0 });
    expect(rules.parseRateAmount_('20,5')).toEqual({ empty: false, value: 20.5 });
    expect(rules.rateAmountCell_({ empty: true })).toBe('');
    expect(rules.rateAmountCell_({ empty: false, value: 0 })).toBe(0);
  });

  it('test_parseRateAmount_when_not_a_kwota_should_return_null', () => {
    expect(rules.parseRateAmount_('-1')).toBeNull();
    expect(rules.parseRateAmount_('20.555')).toBeNull();
    expect(rules.parseRateAmount_('abc')).toBeNull();
    expect(rules.parseRateAmount_('20.')).toBeNull();
  });

  it('test_normalizeRateShopKey_when_al_pl_sw_should_match_map_form', () => {
    expect(rules.normalizeRateShopKey_('51-602 Wrocław al. Kochanowskiego 33')).toBe(
      rules.normalizeRateShopKey_('51-602 Wrocław Kochanowskiego 33'),
    );
    expect(rules.normalizeRateShopKey_('50-363 Wrocław pl. Grunwaldzki 22')).toBe(
      rules.normalizeRateShopKey_('50-363 Wrocław Grunwaldzki 22'),
    );
    expect(rules.normalizeRateShopKey_('50-252 Wrocław Św. Wincentego 1')).toBe(
      rules.normalizeRateShopKey_('50-252 Wrocław Świętego Wincentego 1'),
    );
    expect(normalizeRateShopKey('51-146 Wrocław al. Kasprowicza 85')).toBe(
      rules.normalizeRateShopKey_('51-146 Wrocław Kasprowicza 85'),
    );
  });

  it('test_decideSaveRate_when_one_row_should_overwrite', () => {
    const rows: RateKeyRow[] = [
      { row: 4, shop: 'Sklepowa 1', contractor: 'gpw', validFrom: '10.09.2026' },
    ];
    expect(rules.decideSaveRate_(rows, 'Sklepowa 1', 'gpw', '10.09.2026')).toEqual({
      action: 'overwrite',
      row: 4,
      rows: [4],
    });
  });

  it('test_decideSaveRate_when_al_variant_should_overwrite_existing', () => {
    const rows: RateKeyRow[] = [
      { row: 3, shop: '51-602 Wrocław al. Kochanowskiego 33', contractor: 'GPW', validFrom: '' },
    ];
    expect(rules.decideSaveRate_(rows, '51-602 Wrocław Kochanowskiego 33', 'GPW', '')).toEqual({
      action: 'overwrite',
      row: 3,
      rows: [3],
    });
  });

  it('test_decideSaveRate_when_two_normalized_rows_should_overwrite_all', () => {
    const rows: RateKeyRow[] = [
      { row: 2, shop: '51-602 Wrocław al. Kochanowskiego 33', contractor: 'GPW', validFrom: '' },
      { row: 5, shop: '51-602 Wrocław Kochanowskiego 33', contractor: 'GPW', validFrom: '' },
    ];
    expect(rules.decideSaveRate_(rows, '51-602 Wrocław Kochanowskiego 33', 'GPW', '')).toEqual({
      action: 'overwrite',
      row: 2,
      rows: [2, 5],
    });
  });

  it('test_decideSaveRate_when_other_date_should_append', () => {
    const rows: RateKeyRow[] = [
      { row: 2, shop: 'Sklepowa 1', contractor: 'gpw', validFrom: '' },
    ];
    expect(rules.decideSaveRate_(rows, 'Sklepowa 1', 'gpw', '10.10.2026')).toEqual({ action: 'append' });
    expect(rules.decideSaveRate_(rows, 'Inna 2', 'gpw', '')).toEqual({ action: 'append' });
    expect(rules.decideSaveRate_(rows, 'Sklepowa 1', 'inna', '')).toEqual({ action: 'append' });
    expect(rules.decideSaveRate_([], 'Sklepowa 1', 'gpw', '')).toEqual({ action: 'append' });
  });

  it('test_rateCellDateKey_when_sheet_date_should_match_text_key', () => {
    expect(rules.rateCellDateKey_(new Date(2026, 8, 10))).toBe('10.09.2026');
    expect(rules.rateCellDateKey_('')).toBe('');
    expect(rules.rateCellDateKey_('nie-data')).toBeNull();
  });

  it('test_transportLog_when_saveRate_should_use_the_same_rules_and_leave_register_alone', () => {
    const gas = gasSource();
    expect(gas).toContain(saveRateRulesSource);
    expect(gas).toContain(RATE_SHEET_NAME);
    for (const header of RATE_HEADERS) {
      expect(gas).toContain(header);
    }
    const postStart = gas.indexOf('function doPost');
    const saveIdx = gas.indexOf("mode === 'saveRate'", postStart);
    const appendIdx = gas.indexOf('resolveTransportNumber_', postStart);
    expect(saveIdx).toBeGreaterThan(postStart);
    expect(saveIdx).toBeLessThan(appendIdx);

    const handler = functionBody(gas, 'handleSaveRatePost_');
    expect(handler).toContain('saveRateTargetRows_');
    expect(handler).toContain('getRange(rowNum, 1).setValue(shop)');
    expect(handler).toContain('getRange(rowNum, 3, 1, 2)');
    expect(handler).not.toContain("error: 'tie'");
    expect(handler).not.toContain('getDataSheet_');
    expect(handler).not.toContain('deleteRow');
    expect(handler).not.toContain('COL.');

    const creator = functionBody(gas, 'getOrCreateRateSheet_');
    expect(creator).toContain('getOrCreateRefSheet_');
    expect(creator).toContain('if (!existed)');
    expect(creator).not.toContain('getDataSheet_');
  });

  it('test_transportLog_when_saveRateHarmonogram_should_update_days_only_when_changed', () => {
    const gas = gasSource();
    const postStart = gas.indexOf('function doPost');
    const harmIdx = gas.indexOf("mode === 'saveRateHarmonogram'", postStart);
    const appendIdx = gas.indexOf('resolveTransportNumber_', postStart);
    expect(harmIdx).toBeGreaterThan(postStart);
    expect(harmIdx).toBeLessThan(appendIdx);

    const handler = functionBody(gas, 'handleSaveRateHarmonogramPost_');
    expect(handler).toContain('updateHarmonogramDaysIfChanged_');
    expect(handler).toContain('saveRateTargetRows_');
    expect(handler).toContain('getRange(rowNum, 3, 1, 4)');
    expect(handler).toContain('getRange(rowNum, 4, 1, 2)');
    expect(handler).toContain('body.nazwaTrasy');
    expect(handler).toContain('body.kwotaTrasy');
    expect(handler).toContain("error: 'route'");
    expect(handler).toContain('writeRoute');
    expect(handler).not.toContain("error: 'tie'");
    expect(handler).not.toContain('getRange(decision.row, 8)');

    const daysUpdate = functionBody(gas, 'updateHarmonogramDaysIfChanged_');
    expect(daysUpdate).toContain('normalizeRateShopKey_');
    expect(daysUpdate).toContain('row.days === days');
    expect(daysUpdate).toContain('getRange(row.row, 8)');
  });
});
