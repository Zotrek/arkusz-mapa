import { describe, it, expect } from 'vitest';
import {
  hasPolishDiacritics,
  nominatimAsciiQueryVariant,
  polishAsciiFold,
  polishAsciiLower,
  stripPolishDiacritics,
} from './polishText';

describe('polishText', () => {
  it('test_polishAsciiLower_when_lodz_variants_should_fold_to_lodz', () => {
    expect(polishAsciiLower('Łódź')).toBe('lodz');
    expect(polishAsciiLower('Łódż')).toBe('lodz');
    expect(polishAsciiLower('Lodz')).toBe('lodz');
  });

  it('test_polishAsciiLower_when_gdansk_should_fold_ogonki', () => {
    expect(polishAsciiLower('Gdańsk')).toBe('gdansk');
    expect(polishAsciiLower('Gdansk')).toBe('gdansk');
  });

  it('test_polishAsciiFold_when_street_with_l_should_normalize', () => {
    expect(polishAsciiFold('Generała Chruściela')).toBe('generala chrusciela');
    expect(polishAsciiFold('ŚW. BARBARY')).toBe('sw barbary');
  });

  it('test_stripPolishDiacritics_when_swietoszow_should_strip_ogonki', () => {
    expect(stripPolishDiacritics('Świętyszów')).toBe('Swietyszow');
    expect(stripPolishDiacritics('Gdańsk Olejarna 3, Polska')).toBe('Gdansk Olejarna 3, Polska');
  });

  it('test_nominatimAsciiQueryVariant_when_no_diacritics_should_return_null', () => {
    expect(nominatimAsciiQueryVariant('Krakow Chopina 1')).toBeNull();
    expect(nominatimAsciiQueryVariant('Gdańsk Olejarna 3, Polska')).toBe(
      'Gdansk Olejarna 3, Polska',
    );
  });

  it('test_hasPolishDiacritics_when_ascii_only_should_return_false', () => {
    expect(hasPolishDiacritics('Gdansk')).toBe(false);
    expect(hasPolishDiacritics('Gdańsk')).toBe(true);
  });
});
