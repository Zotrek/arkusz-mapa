import { describe, expect, it, vi } from 'vitest';
import {
  BAZA_CEN_HEADERS,
  bazaCenRowValues,
  parseBazaCenRows,
  planBazaCenSync,
  shopsFromOdebraneRows,
  syncBazaCenHarmonogram,
} from './bazaCenHarmonogram.js';
import { SHEET_NAME_BAZA_CEN_HARMONOGRAM, SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU } from './config.js';

const ODEBRANE_HEADERS = [
  'Podmiot handlowy',
  'Sklep',
  'Wg harmonogramu',
  'Dni harmonogramu',
  'Firma transportowa',
  'Kod pocztowy',
  'Miasto',
  'Ulica',
  'Numer budynku',
];

function odebraneRow(overrides: Record<string, string> = {}): string[] {
  const byHeader: Record<string, string> = {
    'Podmiot handlowy': 'AD-SYSTEM',
    Sklep: 'CHS',
    'Wg harmonogramu': 'tak',
    'Dni harmonogramu': 'pn, cz',
    'Firma transportowa': 'Interzero',
    'Kod pocztowy': '32-100',
    Miasto: 'Proszowice',
    Ulica: '3 Maja',
    'Numer budynku': '10',
    ...overrides,
  };
  return ODEBRANE_HEADERS.map((header) => byHeader[header] ?? '');
}

describe('shopsFromOdebraneRows', () => {
  it('test_shopsFromOdebraneRows_when_two_bags_same_shop_should_keep_one', () => {
    const shops = shopsFromOdebraneRows(ODEBRANE_HEADERS, [
      odebraneRow(),
      odebraneRow({ Sklep: 'inny worek' }),
    ]);
    expect(shops).toEqual([
      {
        adres: '32-100 Proszowice 3 Maja 10',
        podwykonawca: 'Interzero',
        dni: 'pn, cz',
      },
    ]);
  });

  it('test_shopsFromOdebraneRows_when_address_or_firma_empty_should_skip', () => {
    const shops = shopsFromOdebraneRows(ODEBRANE_HEADERS, [
      odebraneRow({ 'Kod pocztowy': '', Miasto: '', Ulica: '', 'Numer budynku': '' }),
      odebraneRow({ 'Firma transportowa': '  ' }),
    ]);
    expect(shops).toEqual([]);
  });

  it('test_shopsFromOdebraneRows_when_days_differ_should_keep_first_non_empty', () => {
    const shops = shopsFromOdebraneRows(ODEBRANE_HEADERS, [
      odebraneRow({ 'Dni harmonogramu': '' }),
      odebraneRow({ 'Dni harmonogramu': 'pn' }),
      odebraneRow({ 'Dni harmonogramu': 'cz' }),
    ]);
    expect(shops).toEqual([
      {
        adres: '32-100 Proszowice 3 Maja 10',
        podwykonawca: 'Interzero',
        dni: 'pn',
      },
    ]);
  });
});

describe('planBazaCenSync', () => {
  const shop = {
    adres: '32-100 Proszowice 3 Maja 10',
    podwykonawca: 'Interzero',
    dni: 'pn, cz',
  };

  it('test_planBazaCenSync_when_shop_missing_should_append_without_touching_prices', () => {
    const plan = planBazaCenSync([shop], []);
    expect(plan.dayUpdates).toEqual([]);
    expect(plan.append).toEqual([shop]);
    expect(bazaCenRowValues(shop, [...BAZA_CEN_HEADERS])).toEqual([
      shop.adres,
      shop.podwykonawca,
      '',
      '',
      '',
      '',
      '',
      shop.dni,
    ]);
  });

  it('test_planBazaCenSync_when_shop_exists_should_update_days_on_every_price_row', () => {
    const plan = planBazaCenSync(
      [{ ...shop, dni: 'pn' }],
      [
        { sheetRow: 2, adres: shop.adres, podwykonawca: shop.podwykonawca, dni: 'pn, cz' },
        { sheetRow: 4, adres: shop.adres, podwykonawca: shop.podwykonawca, dni: 'pn' },
      ],
    );
    expect(plan.append).toEqual([]);
    expect(plan.dayUpdates).toEqual([{ sheetRow: 2, dni: 'pn' }]);
  });

  it('test_parseBazaCenRows_when_header_and_blank_row_should_keep_sheet_row_numbers', () => {
    const rows = parseBazaCenRows(
      [...BAZA_CEN_HEADERS],
      [
        [shop.adres, shop.podwykonawca, 'Trasa A', '20', '2', '100', '01.01.2026', 'pn'],
        ['', '', '', '', '', '', '', ''],
      ],
    );
    expect(rows).toEqual([
      { sheetRow: 2, adres: shop.adres, podwykonawca: shop.podwykonawca, dni: 'pn' },
    ]);
  });
});

describe('syncBazaCenHarmonogram', () => {
  it('test_syncBazaCenHarmonogram_when_new_sheet_should_write_headers_and_one_shop', async () => {
    const values = new Map<string, string[][]>([
      [SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU, [ODEBRANE_HEADERS, odebraneRow(), odebraneRow()]],
    ]);
    const append = vi.fn(async (args: { range: string; requestBody: { values: string[][] } }) => {
      const title = SHEET_NAME_BAZA_CEN_HARMONOGRAM;
      const current = values.get(title) ?? [];
      values.set(title, [...current, ...args.requestBody.values]);
    });
    const api = {
      spreadsheets: {
        get: vi.fn(async () => ({
          data: {
            sheets: [...values.keys()].map((title) => ({ properties: { title } })),
          },
        })),
        batchUpdate: vi.fn(async (args: { requestBody: { requests: Array<{ addSheet: { properties: { title: string } } }> } }) => {
          const title = args.requestBody.requests[0]?.addSheet.properties.title;
          if (title) {
            values.set(title, []);
          }
        }),
        values: {
          get: vi.fn(async (args: { range: string }) => {
            const title = [...values.keys()].find((name) => args.range.startsWith(`'${name}'`));
            return { data: { values: title ? values.get(title) : [] } };
          }),
          update: vi.fn(async (args: { range: string; requestBody: { values: string[][] } }) => {
            values.set(SHEET_NAME_BAZA_CEN_HARMONOGRAM, args.requestBody.values);
          }),
          append,
          batchUpdate: vi.fn(),
        },
      },
    };

    const result = await syncBazaCenHarmonogram(api, { spreadsheetId: 'ewidencja' });

    expect(result).toEqual({
      shopCount: 1,
      appendedCount: 1,
      daysUpdatedCount: 0,
      sheetCreated: true,
    });
    expect(values.get(SHEET_NAME_BAZA_CEN_HARMONOGRAM)).toEqual([
      [...BAZA_CEN_HEADERS],
      ['32-100 Proszowice 3 Maja 10', 'Interzero', '', '', '', '', '', 'pn, cz'],
    ]);
    expect(api.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
  });

  it('test_syncBazaCenHarmonogram_when_price_exists_should_update_only_days', async () => {
    const priced = [
      '32-100 Proszowice 3 Maja 10',
      'Interzero',
      'Trasa A',
      '20',
      '2',
      '100',
      '01.01.2026',
      'pn',
    ];
    const values = new Map<string, string[][]>([
      [SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU, [ODEBRANE_HEADERS, odebraneRow()]],
      [SHEET_NAME_BAZA_CEN_HARMONOGRAM, [[...BAZA_CEN_HEADERS], priced]],
    ]);
    const api = {
      spreadsheets: {
        get: vi.fn(async () => ({
          data: {
            sheets: [...values.keys()].map((title) => ({ properties: { title } })),
          },
        })),
        batchUpdate: vi.fn(),
        values: {
          get: vi.fn(async (args: { range: string }) => {
            const title = [...values.keys()].find((name) => args.range.startsWith(`'${name}'`));
            return { data: { values: title ? values.get(title) : [] } };
          }),
          update: vi.fn(),
          append: vi.fn(),
          batchUpdate: vi.fn(async (args: { requestBody: { data: Array<{ range: string; values: string[][] }> } }) => {
            const update = args.requestBody.data[0];
            expect(update?.range).toBe(`'${SHEET_NAME_BAZA_CEN_HARMONOGRAM}'!H2`);
            expect(update?.values).toEqual([['pn, cz']]);
          }),
        },
      },
    };

    const result = await syncBazaCenHarmonogram(api, { spreadsheetId: 'ewidencja' });

    expect(result.appendedCount).toBe(0);
    expect(result.daysUpdatedCount).toBe(1);
    expect(api.spreadsheets.values.append).not.toHaveBeenCalled();
    expect(api.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    expect(values.get(SHEET_NAME_BAZA_CEN_HARMONOGRAM)?.[1]?.slice(2, 7)).toEqual(priced.slice(2, 7));
  });
});
