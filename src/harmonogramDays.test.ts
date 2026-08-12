import { describe, expect, it } from 'vitest';
import {
  easterSundayUtc,
  hasPastScheduleDayAfterClosure,
  isCopyOdebraneZHarmonogramuEnabled,
  isPolishPublicHolidayUtc,
  parseWeekdaysFromDniHarmonogramu,
  shouldCopyToOdebraneZHarmonogramu,
} from './harmonogramDays.js';

describe('parseWeekdaysFromDniHarmonogramu', () => {
  it('test_parseWeekdaysFromDniHarmonogramu_when_pn_should_return_monday', () => {
    expect(parseWeekdaysFromDniHarmonogramu('pn')).toEqual([1]);
  });

  it('test_parseWeekdaysFromDniHarmonogramu_when_comma_list_should_return_sorted_days', () => {
    expect(parseWeekdaysFromDniHarmonogramu('pn, śr')).toEqual([1, 3]);
    expect(parseWeekdaysFromDniHarmonogramu('cz,pn')).toEqual([1, 4]);
  });

  it('test_parseWeekdaysFromDniHarmonogramu_when_empty_should_return_empty', () => {
    expect(parseWeekdaysFromDniHarmonogramu('')).toEqual([]);
    expect(parseWeekdaysFromDniHarmonogramu('  ')).toEqual([]);
  });
});

describe('polish holidays', () => {
  it('test_easterSundayUtc_when_2026_should_be_april_5', () => {
    expect(easterSundayUtc(2026)).toBe(Date.UTC(2026, 3, 5));
  });

  it('test_isPolishPublicHolidayUtc_when_new_year_or_easter_monday_should_be_true', () => {
    expect(isPolishPublicHolidayUtc(Date.UTC(2026, 0, 1))).toBe(true);
    expect(isPolishPublicHolidayUtc(Date.UTC(2026, 3, 6))).toBe(true);
    expect(isPolishPublicHolidayUtc(Date.UTC(2026, 0, 2))).toBe(false);
  });
});

describe('hasPastScheduleDayAfterClosure', () => {
  it('test_hasPastScheduleDay_when_closed_friday_monday_passed_should_true', () => {
    // 07.08.2026 = piątek, pn=10.08, dziś=12.08
    expect(
      hasPastScheduleDayAfterClosure([1], Date.UTC(2026, 7, 7), Date.UTC(2026, 7, 12)),
    ).toBe(true);
  });

  it('test_hasPastScheduleDay_when_closed_on_monday_before_next_monday_should_false', () => {
    // 10.08.2026 = pn — nie liczy się; kolejny pn=17.08; dziś=12.08
    expect(
      hasPastScheduleDayAfterClosure([1], Date.UTC(2026, 7, 10), Date.UTC(2026, 7, 12)),
    ).toBe(false);
  });

  it('test_hasPastScheduleDay_when_closed_on_monday_after_next_monday_should_true', () => {
    expect(
      hasPastScheduleDayAfterClosure([1], Date.UTC(2026, 7, 10), Date.UTC(2026, 7, 18)),
    ).toBe(true);
  });

  it('test_hasPastScheduleDay_when_today_is_schedule_day_should_false', () => {
    // zamknięcie 05.08 (śr), dziś=12.08 (śr) — D=12 nie jest < dziś
    expect(
      hasPastScheduleDayAfterClosure([3], Date.UTC(2026, 7, 5), Date.UTC(2026, 7, 12)),
    ).toBe(false);
  });

  it('test_hasPastScheduleDay_when_first_wednesday_is_new_year_holiday_should_wait', () => {
    // 2025-01-01 = środa (święto). Zamknięcie 2024-12-30. Dziś=2025-01-02 → jeszcze nie.
    expect(
      hasPastScheduleDayAfterClosure([3], Date.UTC(2024, 11, 30), Date.UTC(2025, 0, 2)),
    ).toBe(false);
    // Kolejna środa = 08.01; dziś=09.01 → tak
    expect(
      hasPastScheduleDayAfterClosure([3], Date.UTC(2024, 11, 30), Date.UTC(2025, 0, 9)),
    ).toBe(true);
  });
});

describe('shouldCopyToOdebraneZHarmonogramu', () => {
  const base = {
    zbiorka: 'Maszyna',
    wgHarmonogramu: 'tak',
    dniHarmonogramu: 'pn',
  };

  it('test_shouldCopy_when_closed_07_08_generate_12_08_should_true', () => {
    expect(
      shouldCopyToOdebraneZHarmonogramu({
        ...base,
        dataZamknieciaWorka: '07.08.2026',
        todayUtc: Date.UTC(2026, 7, 12),
      }),
    ).toBe(true);
  });

  it('test_shouldCopy_when_closed_10_08_generate_12_08_should_false', () => {
    expect(
      shouldCopyToOdebraneZHarmonogramu({
        ...base,
        dataZamknieciaWorka: '10.08.2026',
        todayUtc: Date.UTC(2026, 7, 12),
      }),
    ).toBe(false);
  });

  it('test_shouldCopy_when_not_maszyna_or_not_tak_should_false', () => {
    expect(
      shouldCopyToOdebraneZHarmonogramu({
        ...base,
        zbiorka: 'Ręczna',
        dataZamknieciaWorka: '07.08.2026',
        todayUtc: Date.UTC(2026, 7, 12),
      }),
    ).toBe(false);
    expect(
      shouldCopyToOdebraneZHarmonogramu({
        ...base,
        wgHarmonogramu: 'nie',
        dataZamknieciaWorka: '07.08.2026',
        todayUtc: Date.UTC(2026, 7, 12),
      }),
    ).toBe(false);
    expect(
      shouldCopyToOdebraneZHarmonogramu({
        ...base,
        zbiorka: 'Ręczna / Maszyna',
        dataZamknieciaWorka: '07.08.2026',
        todayUtc: Date.UTC(2026, 7, 12),
      }),
    ).toBe(false);
  });

  it('test_isCopyOdebraneZHarmonogramuEnabled_when_env_should_parse', () => {
    expect(isCopyOdebraneZHarmonogramuEnabled({})).toBe(false);
    expect(isCopyOdebraneZHarmonogramuEnabled({ COPY_ODEBRANE_Z_HARMONOGRAMU: '1' })).toBe(true);
    expect(isCopyOdebraneZHarmonogramuEnabled({ COPY_ODEBRANE_Z_HARMONOGRAMU: 'true' })).toBe(true);
    expect(isCopyOdebraneZHarmonogramuEnabled({ COPY_ODEBRANE_Z_HARMONOGRAMU: '0' })).toBe(false);
  });
});
