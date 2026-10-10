import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  buildHarmonogramList,
  canonicalHarmonogramDays,
  harmonogramProposalDates,
  isBolecinPlace,
  joinHarmonogramLabels,
  nextHarmonogramId,
  selectedShopsForGroup,
  type HarmonogramHead,
  type HarmonogramShopRow,
} from './harmonogramGroup.js';

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
  'cellStr_',
  'collapseText_',
  'settlementText_',
  'settlementNormalizeDayToken_',
  'settlementParseWeekdays_',
  'normalizeRateShopKey_',
  'canonicalHarmonogramDays_',
  'nextHarmonogramId_',
  'isBolecinPlace_',
  'formatDotDate_',
  'harmonogramProposalDates_',
  'joinHarmonogramLabels_',
  'bolecinRowIdentity_',
  'wantsProtocolBolecin_',
  'protocolBolecinFields_',
  'harmonogramBucketKey_',
  'harmonogramSiblingKey_',
  'memberMatchesHarmonogram_',
  'collapseHarmonogramShops_',
  'buildHarmonogramList_',
  'selectedShopsForGroup_',
] as const;

type GasRules = {
  canonicalHarmonogramDays_: (raw: string) => string;
  nextHarmonogramId_: (ids: string[]) => string;
  isBolecinPlace_: (text: string) => boolean;
  harmonogramProposalDates_: (days: string, today: Date) => string[];
  joinHarmonogramLabels_: (values: string[]) => string;
  buildHarmonogramList_: (
    shops: HarmonogramShopRow[],
    groups: HarmonogramHead[],
    today: Date,
  ) => ReturnType<typeof buildHarmonogramList>;
  selectedShopsForGroup_: (
    shops: HarmonogramShopRow[],
    rows: number[],
  ) => ReturnType<typeof selectedShopsForGroup>;
  wantsProtocolBolecin_: (body: Record<string, unknown> | null) => boolean;
  protocolBolecinFields_: (body: Record<string, unknown>) => {
    awizacja: string;
    oknoAwizacji: string;
    rodzajTransportu: string;
    adres: string;
    worki: string;
  };
};

function loadGas(): GasRules {
  const source = readFileSync(gasPath, 'utf8');
  const script = [
    'var INCLUDE_NEXT_MONTH_FROM_DAY = 22;',
    ...NAMES.map((name) => functionBody(source, name)),
    `rules = { ${NAMES.filter((name) =>
      [
        'canonicalHarmonogramDays_',
        'nextHarmonogramId_',
        'isBolecinPlace_',
        'harmonogramProposalDates_',
        'joinHarmonogramLabels_',
        'buildHarmonogramList_',
        'selectedShopsForGroup_',
        'wantsProtocolBolecin_',
        'protocolBolecinFields_',
      ].includes(name),
    )
      .map((name) => `${name}`)
      .join(', ')} };`,
  ].join('\n');
  const context: { rules?: GasRules } = {};
  runInNewContext(script, context);
  if (!context.rules) {
    throw new Error('gas rules did not load');
  }
  return context.rules;
}

describe('harmonogramGroup gas parity', () => {
  const gas = loadGas();
  const today = new Date(2026, 9, 22);
  const shops: HarmonogramShopRow[] = [
    { sheetRow: 2, adres: 'Adres A', podwykonawca: 'Interzero', dni: 'pn, cz', harmonogramId: '' },
    { sheetRow: 8, adres: 'Adres A', podwykonawca: 'Interzero', dni: 'cz, pn', harmonogramId: '' },
    { sheetRow: 3, adres: 'Adres B', podwykonawca: 'Interzero', dni: 'pn, cz', harmonogramId: '' },
    { sheetRow: 4, adres: 'Adres C', podwykonawca: 'Inny', dni: 'pn', harmonogramId: 'H0001' },
  ];
  const groups: HarmonogramHead[] = [
    {
      id: 'H0001',
      podwykonawca: 'Inny',
      dni: 'pn',
      cenaTrasy: '100',
      miejsceZrzutu: 'Bolęcin',
      oknoAwizacji: '8-12',
      awizacja: 'WX',
      rodzajZbiorki: '',
      rodzajTransportu: '',
      spodziewaneWorki: '',
    },
  ];

  it('test_gasHarmonogram_when_same_fixture_should_match_typescript', () => {
    expect(gas.canonicalHarmonogramDays_('cz, pn')).toBe(canonicalHarmonogramDays('cz, pn'));
    expect(gas.nextHarmonogramId_(['H0003'])).toBe(nextHarmonogramId(['H0003']));
    expect(gas.isBolecinPlace_('BIOSYSTEM Bolęcin')).toBe(isBolecinPlace('BIOSYSTEM Bolęcin'));
    expect(gas.harmonogramProposalDates_('pn', today)).toEqual(harmonogramProposalDates('pn', today));
    expect(gas.joinHarmonogramLabels_([' Sklep B ', 'Sklep A', 'sklep a'])).toBe(
      joinHarmonogramLabels([' Sklep B ', 'Sklep A', 'sklep a']),
    );
    expect(gas.buildHarmonogramList_(shops, groups, today)).toEqual(
      buildHarmonogramList(shops, groups, today),
    );
    expect(gas.selectedShopsForGroup_(shops, [2, 3])).toEqual(selectedShopsForGroup(shops, [2, 3]));
  });

  it('test_protocolBolecinFields_when_flag_and_bolecin_should_map_registration_to_awizacja', () => {
    expect(gas.wantsProtocolBolecin_(null)).toBe(false);
    expect(gas.wantsProtocolBolecin_({ awizujBolecin: true, miejsceZrzutu: 'Magazyn' })).toBe(false);
    expect(gas.wantsProtocolBolecin_({ awizujBolecin: true, miejsceZrzutu: 'Biosystem Bolęcin' })).toBe(
      true,
    );
    expect(
      gas.protocolBolecinFields_({
        oknoAwizacji: ' 8:00–12:00 ',
        adresSklepu: 'ul. Testowa 1',
        podmiotHandlowy: 'Firma',
        dataOdbioru: '10.10.2026',
        ktoOdbiera: 'Janex',
        miejsceZrzutu: 'Bolęcin',
        rodzajZbiorki: 'ręczna',
        iloscWorkow: 4,
        rodzajTransportu: 'bus',
        awizacja: 'WX12345',
      }),
    ).toMatchObject({
      oknoAwizacji: '8:00–12:00',
      adres: 'ul. Testowa 1',
      nazwa: 'Firma',
      data: '10.10.2026',
      kto: 'Janex',
      miejsce: 'Bolęcin',
      rodzajZbiorki: 'ręczna',
      worki: '4',
      rodzajTransportu: 'bus',
      awizacja: 'WX12345',
    });
  });
});
