import { describe, expect, it } from 'vitest';
import { isPolishVoivodeship, POLISH_VOIVODESHIPS } from './polishVoivodeships.js';

describe('isPolishVoivodeship', () => {
  it('test_isPolishVoivodeship_when_official_name_should_return_true', () => {
    expect(isPolishVoivodeship('Mazowieckie')).toBe(true);
    expect(isPolishVoivodeship(' Dolnośląskie ')).toBe(true);
    expect(POLISH_VOIVODESHIPS).toHaveLength(16);
  });

  it('test_isPolishVoivodeship_when_invalid_should_return_false', () => {
    expect(isPolishVoivodeship(undefined)).toBe(false);
    expect(isPolishVoivodeship('')).toBe(false);
    expect(isPolishVoivodeship('mazowieckie')).toBe(false);
    expect(isPolishVoivodeship('Warszawskie')).toBe(false);
  });
});
