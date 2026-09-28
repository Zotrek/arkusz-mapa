import { describe, expect, it, vi } from 'vitest';
import {
  BAZA_CEN_HEADERS,
  bazaCenRowValues,
  parseBazaCenRows,
  planBazaCenDuplicateDeletes,
  planBazaCenSync,
  shopsFromOdebraneRows,
  syncBazaCenHarmonogram,
  type BazaCenExistingRow,
} from './bazaCenHarmonogram.js';
import { SHEET_NAME_BAZA_CEN_HARMONOGRAM, SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU } from './config.js';

function existingRow(
  sheetRow: number,
  overrides: Partial<BazaCenExistingRow> & Pick<BazaCenExistingRow, 'adres' | 'podwykonawca'>,
): BazaCenExistingRow {
  return {
    sheetRow,
    dni: '',
    validFrom: '',
    routeName: '',
    hasPrices: false,
    ...overrides,
  };
}

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

  it('test_shopsFromOdebraneRows_when_al_pl_sw_should_match_map_normalization', () => {
    const shops = shopsFromOdebraneRows(ODEBRANE_HEADERS, [
      odebraneRow({
        'Kod pocztowy': '51-602',
        Miasto: 'Wrocław',
        Ulica: 'al. Kochanowskiego',
        'Numer budynku': '33',
        'Firma transportowa': 'GPW',
      }),
      odebraneRow({
        'Kod pocztowy': '50-252',
        Miasto: 'Wrocław',
        Ulica: 'Św. Wincentego',
        'Numer budynku': '1',
        'Firma transportowa': 'GPW',
        'Dni harmonogramu': 'śr, sb',
      }),
      odebraneRow({
        'Kod pocztowy': '50-363',
        Miasto: 'Wrocław',
        Ulica: 'pl. Grunwaldzki',
        'Numer budynku': '22',
        'Firma transportowa': 'GPW',
      }),
    ]);
    expect(shops.map((s) => s.adres).sort()).toEqual([
      '50-252 Wrocław Świętego Wincentego 1',
      '50-363 Wrocław Grunwaldzki 22',
      '51-602 Wrocław Kochanowskiego 33',
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
    expect(plan.addressHeals).toEqual([]);
    expect(plan.duplicateDeletes).toEqual([]);
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
        existingRow(2, {
          adres: shop.adres,
          podwykonawca: shop.podwykonawca,
          dni: 'pn, cz',
          validFrom: '01.01.2026',
          hasPrices: true,
        }),
        existingRow(4, {
          adres: shop.adres,
          podwykonawca: shop.podwykonawca,
          dni: 'pn',
          validFrom: '10.09.2026',
          hasPrices: true,
        }),
      ],
    );
    expect(plan.append).toEqual([]);
    expect(plan.duplicateDeletes).toEqual([]);
    expect(plan.dayUpdates).toEqual([{ sheetRow: 2, dni: 'pn' }]);
    expect(plan.addressHeals).toEqual([]);
  });

  it('test_planBazaCenSync_when_raw_al_address_should_heal_not_append', () => {
    const canonical = {
      adres: '51-602 Wrocław Kochanowskiego 33',
      podwykonawca: 'GPW',
      dni: 'śr, sb',
    };
    const plan = planBazaCenSync(
      [canonical],
      [
        existingRow(3, {
          adres: '51-602 Wrocław al. Kochanowskiego 33',
          podwykonawca: 'GPW',
          dni: 'śr, sb',
        }),
      ],
    );
    expect(plan.append).toEqual([]);
    expect(plan.dayUpdates).toEqual([]);
    expect(plan.duplicateDeletes).toEqual([]);
    expect(plan.addressHeals).toEqual([{ sheetRow: 3, adres: canonical.adres }]);
  });

  it('test_planBazaCenSync_when_sw_twin_should_delete_duplicate_keep_priced', () => {
    const canonical = '50-252 Wrocław Świętego Wincentego 1';
    const plan = planBazaCenSync(
      [{ adres: canonical, podwykonawca: 'GPW', dni: 'śr, sb' }],
      [
        existingRow(5, {
          adres: '50-252 Wrocław Św. Wincentego 1',
          podwykonawca: 'GPW',
          dni: 'śr, sb',
        }),
        existingRow(12, {
          adres: canonical,
          podwykonawca: 'GPW',
          dni: 'śr, sb',
          routeName: 'Trasa W',
          hasPrices: true,
          validFrom: '01.01.2026',
        }),
      ],
    );
    expect(plan.append).toEqual([]);
    expect(plan.duplicateDeletes).toEqual([5]);
    expect(plan.addressHeals).toEqual([]);
    expect(plan.dayUpdates).toEqual([]);
  });

  it('test_planBazaCenDuplicateDeletes_when_same_date_twins_should_keep_one', () => {
    const adres = '50-252 Wrocław Świętego Wincentego 1';
    expect(
      planBazaCenDuplicateDeletes([
        existingRow(3, { adres, podwykonawca: 'GPW', dni: 'pn' }),
        existingRow(8, { adres, podwykonawca: 'GPW', dni: 'pn', hasPrices: true }),
      ]),
    ).toEqual([3]);
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
      {
        sheetRow: 2,
        adres: shop.adres,
        podwykonawca: shop.podwykonawca,
        dni: 'pn',
        validFrom: '01.01.2026',
        routeName: 'Trasa A',
        hasPrices: true,
      },
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
      addressHealedCount: 0,
      duplicatesRemovedCount: 0,
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
    expect(result.addressHealedCount).toBe(0);
    expect(result.duplicatesRemovedCount).toBe(0);
    expect(api.spreadsheets.values.append).not.toHaveBeenCalled();
    expect(api.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    expect(values.get(SHEET_NAME_BAZA_CEN_HARMONOGRAM)?.[1]?.slice(2, 7)).toEqual(priced.slice(2, 7));
  });

  it('test_syncBazaCenHarmonogram_when_normalization_twins_should_delete_seed_row', async () => {
    const values = new Map<string, string[][]>([
      [SHEET_NAME_ODEBRANE_Z_HARMONOGRAMU, [ODEBRANE_HEADERS, odebraneRow({
        'Kod pocztowy': '50-252',
        Miasto: 'Wrocław',
        Ulica: 'Św. Wincentego',
        'Numer budynku': '1',
        'Firma transportowa': 'GPW',
        'Dni harmonogramu': 'śr, sb',
      })]],
      [
        SHEET_NAME_BAZA_CEN_HARMONOGRAM,
        [
          [...BAZA_CEN_HEADERS],
          ['50-252 Wrocław Św. Wincentego 1', 'GPW', '', '', '', '', '', 'śr, sb'],
          [
            '50-252 Wrocław Świętego Wincentego 1',
            'GPW',
            'Trasa',
            '10',
            '2',
            '50',
            '01.01.2026',
            'śr, sb',
          ],
        ],
      ],
    ]);
    const api = {
      spreadsheets: {
        get: vi.fn(async () => ({
          data: {
            sheets: [...values.keys()].map((title, i) => ({
              properties: { title, sheetId: i + 1 },
            })),
          },
        })),
        batchUpdate: vi.fn(async (args: {
          requestBody: { requests: Array<{ deleteDimension?: { range: { startIndex: number } } }> };
        }) => {
          const start = args.requestBody.requests[0]?.deleteDimension?.range.startIndex;
          expect(start).toBe(1);
          const sheet = values.get(SHEET_NAME_BAZA_CEN_HARMONOGRAM)!;
          sheet.splice(1, 1);
        }),
        values: {
          get: vi.fn(async (args: { range: string }) => {
            const title = [...values.keys()].find((name) => args.range.startsWith(`'${name}'`));
            return { data: { values: title ? values.get(title) : [] } };
          }),
          update: vi.fn(),
          append: vi.fn(),
          batchUpdate: vi.fn(),
        },
      },
    };

    const result = await syncBazaCenHarmonogram(api, { spreadsheetId: 'ewidencja' });

    expect(result.duplicatesRemovedCount).toBe(1);
    expect(result.appendedCount).toBe(0);
    expect(api.spreadsheets.batchUpdate).toHaveBeenCalled();
    expect(values.get(SHEET_NAME_BAZA_CEN_HARMONOGRAM)).toEqual([
      [...BAZA_CEN_HEADERS],
      [
        '50-252 Wrocław Świętego Wincentego 1',
        'GPW',
        'Trasa',
        '10',
        '2',
        '50',
        '01.01.2026',
        'śr, sb',
      ],
    ]);
  });
});
