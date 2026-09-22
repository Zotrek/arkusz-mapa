import { describe, expect, it } from 'vitest';
import {
  classifyMapPointZbiorka,
  normalizeWgHarmonogramu,
  parseZbiorkaFlags,
} from './zbiorkaClassify.js';

describe('parseZbiorkaFlags', () => {
  it('test_parseZbiorkaFlags_when_empty_should_return_false_flags', () => {
    expect(parseZbiorkaFlags(undefined)).toEqual({ hasReczna: false, hasMaszyna: false });
    expect(parseZbiorkaFlags('')).toEqual({ hasReczna: false, hasMaszyna: false });
    expect(parseZbiorkaFlags('   ')).toEqual({ hasReczna: false, hasMaszyna: false });
  });

  it('test_parseZbiorkaFlags_when_short_tokens_r_m_should_set_flags', () => {
    expect(parseZbiorkaFlags('R')).toEqual({ hasReczna: true, hasMaszyna: false });
    expect(parseZbiorkaFlags('m')).toEqual({ hasReczna: false, hasMaszyna: true });
    expect(parseZbiorkaFlags('r / m')).toEqual({ hasReczna: true, hasMaszyna: true });
  });

  it('test_parseZbiorkaFlags_when_automat_should_count_as_maszyna', () => {
    expect(parseZbiorkaFlags('automat')).toEqual({ hasReczna: false, hasMaszyna: true });
    expect(parseZbiorkaFlags('Ręczna / Automat')).toEqual({ hasReczna: true, hasMaszyna: true });
  });
});

describe('classifyMapPointZbiorka via flags', () => {
  it('test_classifyMapPointZbiorka_when_unknown_text_should_return_unknown', () => {
    expect(classifyMapPointZbiorka('coś innego')).toBe('unknown');
  });
});

describe('normalizeWgHarmonogramu', () => {
  it('test_normalizeWgHarmonogramu_when_garbage_should_return_empty', () => {
    expect(normalizeWgHarmonogramu('może')).toBe('');
    expect(normalizeWgHarmonogramu(undefined)).toBe('');
  });
});
