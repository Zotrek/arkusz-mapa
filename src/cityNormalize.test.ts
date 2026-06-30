import { describe, it, expect } from 'vitest';
import { normalizeCityForCompare, normalizeCityFromSheet, legacyCityNameVariants } from './cityNormalize';

describe('cityNormalize', () => {
  it('test_normalizeCityFromSheet_when_gdanska_typo_should_return_gdansk', () => {
    expect(normalizeCityFromSheet('Gdańska')).toBe('Gdańsk');
    expect(normalizeCityFromSheet('Gdansk')).toBe('Gdańsk');
  });

  it('test_normalizeCityFromSheet_when_normal_city_should_leave_unchanged', () => {
    expect(normalizeCityFromSheet('Kraków')).toBe('Kraków');
    expect(normalizeCityFromSheet('ŚRODA WLKP.')).toBe('ŚRODA WLKP.');
  });

  it('test_normalizeCityFromSheet_when_lodz_typo_should_return_lodz_with_ogon', () => {
    expect(normalizeCityFromSheet('Łódż')).toBe('Łódź');
  });

  it('test_normalizeCityForCompare_when_lodz_typo_should_match_canonical', () => {
    expect(normalizeCityForCompare('Łódż')).toBe(normalizeCityForCompare('Łódź'));
    expect(normalizeCityForCompare('Gdansk')).toBe(normalizeCityForCompare('Gdańsk'));
  });

  it('test_legacyCityNameVariants_when_swietoszow_should_include_ascii', () => {
    expect(legacyCityNameVariants('Świętyszów')).toContain('Swietoszow');
    expect(legacyCityNameVariants('Gdańsk')).toContain('Gdansk');
  });
});
