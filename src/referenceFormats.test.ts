import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { formatPodwykoForWord, referenceFormatsBrowserScript } from './referenceFormats.js';

describe('formatPodwykoForWord', () => {
  it('test_formatPodwykoForWord_joins_fields_in_order', () => {
    const s = formatPodwykoForWord({
      nazwa: 'BLUECARGO',
      nazwaDoProtokolu: 'BLUECARGO Sp. z o.o.',
      adres: 'Rajska 3, 54-028 Wrocław',
      nip: '8943261149',
      bdo: '000710623',
    });
    expect(s).toContain('BLUECARGO Sp. z o.o.');
    expect(s).toContain('Rajska 3');
    expect(s).toContain('BDO 000710623');
    expect(s).toContain('NIP 8943261149');
  });

  it('test_formatPodwykoForWord_omits_empty_parts', () => {
    expect(
      formatPodwykoForWord({
        nazwa: 'Firma',
        nazwaDoProtokolu: 'Firma Sp. z o.o.',
        adres: '',
        nip: '',
        bdo: '',
      }),
    ).toBe('Firma Sp. z o.o.');
  });
});

describe('referenceFormatsBrowserScript VM', () => {
  it('test_referenceFormatsBrowserScript_formatPodwykoForWord_should_match_ts', () => {
    const record = { nazwa: 'X', nazwaDoProtokolu: ' Trans  Pol ', adres: 'ul. A 1', nip: '123', bdo: 'BDO 9' };
    const sandbox: Record<string, unknown> = {};
    runInNewContext(`${referenceFormatsBrowserScript()}\n__api = formatPodwykoForWord;`, sandbox);
    const format = sandbox.__api as (r: typeof record) => string;
    expect(format(record)).toBe(formatPodwykoForWord(record));
  });
});
