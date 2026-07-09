import { describe, it, expect } from 'vitest';
import {
  canonicalCacheKeyFromLegacy,
  canonicalCacheKeyFromCityTypo,
  legacyDuplicateNumberCacheKey,
  mergeCacheEntry,
  migrateCacheEntries,
  purgeLegacyAbbreviationCacheKeys,
  legacyCacheKeyAliases,
  resolveCacheEntry,
} from './cacheMigrate';

describe('cacheMigrate', () => {
  it('test_canonicalCacheKeyFromLegacy_when_duplicate_number_should_return_canonical', () => {
    expect(canonicalCacheKeyFromLegacy('32-420 GDÓW KLĘCZANA 33 33')).toBe('32-420 GDÓW KLĘCZANA 33');
    expect(canonicalCacheKeyFromLegacy('32-420 GDÓW KLĘCZANA 33')).toBeNull();
  });

  it('test_canonicalCacheKeyFromCityTypo_when_gdansk_should_return_gdansk_with_ogon', () => {
    expect(canonicalCacheKeyFromCityTypo('80-843 Gdansk Olejarna 3')).toBe('80-843 Gdańsk Olejarna 3');
    expect(canonicalCacheKeyFromCityTypo('90-339 Łódż Wilcza 4')).toBe('90-339 Łódź Wilcza 4');
  });

  it('test_migrateCacheEntries_when_city_typo_uncertain_should_move_to_canonical_key', () => {
    const entries = {
      '80-843 Gdansk Olejarna 3': {
        status: 'uncertain' as const,
        lat: 54.3544635,
        lng: 18.6546215,
        updatedAt: '2026-06-30T00:00:00.000Z',
      },
    };
    const { entries: migrated, migrated: count } = migrateCacheEntries(entries);
    expect(migrated['80-843 Gdańsk Olejarna 3']?.status).toBe('uncertain');
    expect(migrated['80-843 Gdansk Olejarna 3']).toBeUndefined();
    expect(count).toBe(1);
  });

  it('test_legacyDuplicateNumberCacheKey_when_canonical_should_return_legacy_alias', () => {
    expect(legacyDuplicateNumberCacheKey('32-420 GDÓW KLĘCZANA 33')).toBe(
      '32-420 GDÓW KLĘCZANA 33 33',
    );
  });

  it('test_mergeCacheEntry_when_ok_beats_uncertain_should_prefer_ok', () => {
    const uncertain = {
      status: 'uncertain' as const,
      lat: 1,
      lng: 2,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const ok = {
      status: 'ok' as const,
      lat: 3,
      lng: 4,
      updatedAt: '2026-01-02T00:00:00.000Z',
    };
    expect(mergeCacheEntry(uncertain, ok)).toEqual(ok);
    expect(mergeCacheEntry(ok, uncertain)).toEqual(ok);
  });

  it('test_migrateCacheEntries_when_legacy_ok_and_canonical_uncertain_should_promote_ok', () => {
    const entries = {
      '32-420 GDÓW KLĘCZANA 33': {
        status: 'uncertain' as const,
        lat: 49.1,
        lng: 20.1,
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
      '32-420 GDÓW KLĘCZANA 33 33': {
        status: 'ok' as const,
        lat: 49.8967,
        lng: 20.2567,
        wojewodztwo: 'Małopolskie',
        updatedAt: '2026-06-02T00:00:00.000Z',
      },
    };

    const { entries: migrated, removedLegacyKeys } = migrateCacheEntries(entries);
    expect(migrated['32-420 GDÓW KLĘCZANA 33']?.status).toBe('ok');
    expect(migrated['32-420 GDÓW KLĘCZANA 33 33']).toBeUndefined();
    expect(removedLegacyKeys).toContain('32-420 GDÓW KLĘCZANA 33 33');
  });

  it('test_resolveCacheEntry_when_only_legacy_exists_should_return_legacy_entry', () => {
    const entries = {
      '21-500 BIAŁA PODLASKA POROSIUKI 130 130': {
        status: 'ok' as const,
        lat: 52.02,
        lng: 23.12,
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    };
    expect(resolveCacheEntry(entries, '21-500 BIAŁA PODLASKA POROSIUKI 130')?.status).toBe('ok');
  });

  it('test_resolveCacheEntry_when_sheet_has_duplicate_number_should_find_canonical_entry', () => {
    const ok = {
      status: 'ok' as const,
      lat: 49.3874,
      lng: 19.86947,
      wojewodztwo: 'Małopolskie',
      updatedAt: '2026-07-01T00:00:00.000Z',
    };
    const entries = {
      '34-407 Ciche 170': ok,
      '21-302 Brzozowica Duża 119c': ok,
      '56-321 Pakoslawsko 48A': ok,
    };
    expect(resolveCacheEntry(entries, '34-407 Ciche 170 170')).toEqual(ok);
    expect(resolveCacheEntry(entries, '21-302 Brzozowica Duża 119c 119c')).toEqual(ok);
    expect(resolveCacheEntry(entries, '56-321 Pakoslawsko 48A 48A')).toEqual(ok);
  });

  it('test_resolveCacheEntry_after_migrateCacheEntries_should_find_duplicate_sheet_key', () => {
    const { entries: migrated } = migrateCacheEntries({
      '34-407 Ciche 170 170': {
        status: 'ok' as const,
        lat: 49.3874,
        lng: 19.86947,
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    });
    expect(migrated['34-407 Ciche 170 170']).toBeUndefined();
    expect(resolveCacheEntry(migrated, '34-407 Ciche 170 170')?.status).toBe('ok');
  });

  it('test_resolveCacheEntry_when_legacy_swietoszow_key_should_return_ok_entry', () => {
    const entries = {
      '59-726 Swietoszow Husarska 1 1': {
        status: 'ok' as const,
        lat: 51.47,
        lng: 15.72,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    };
    expect(
      resolveCacheEntry(entries, '59-726 Świętyszów Husarska 1')?.status,
    ).toBe('ok');
  });

  it('test_migrateCacheEntries_when_legacy_gen_ok_should_promote_to_generala_key', () => {
    const entries = {
      '04-247 Warszawa Gen. Chruściela 25': {
        status: 'ok' as const,
        lat: 52.18,
        lng: 21.14,
        wojewodztwo: 'Mazowieckie',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    };
    const { entries: migrated, removedLegacyKeys } = migrateCacheEntries(entries);
    expect(migrated['04-247 Warszawa Generała Chruściela 25']?.status).toBe('ok');
    expect(migrated['04-247 Warszawa Generała Chruściela 25']?.lat).toBe(52.18);
    expect(migrated['04-247 Warszawa Gen. Chruściela 25']).toBeUndefined();
    expect(removedLegacyKeys).toContain('04-247 Warszawa Gen. Chruściela 25');
  });

  it('test_resolveCacheEntry_when_legacy_gen_key_should_return_ok_on_canonical_lookup', () => {
    const entries = {
      '04-247 Warszawa Gen. Chruściela 25': {
        status: 'ok' as const,
        lat: 52.18,
        lng: 21.14,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    };
    expect(
      resolveCacheEntry(entries, '04-247 Warszawa Generała Chruściela 25')?.status,
    ).toBe('ok');
  });

  it('test_purgeLegacyAbbreviationCacheKeys_when_canonical_ok_should_remove_legacy_gen', () => {
    const entries = {
      '39-451 Skopanie Gen. Sikorskiego 11': {
        status: 'uncertain' as const,
        lat: 1,
        lng: 2,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      '39-451 Skopanie Aleja Generała Sikorskiego 11': {
        status: 'ok' as const,
        lat: 3,
        lng: 4,
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    };
    const { entries: purged, removed } = purgeLegacyAbbreviationCacheKeys(entries);
    expect(purged['39-451 Skopanie Gen. Sikorskiego 11']).toBeUndefined();
    expect(purged['39-451 Skopanie Aleja Generała Sikorskiego 11']?.status).toBe('ok');
    expect(removed).toContain('39-451 Skopanie Gen. Sikorskiego 11');
  });

  it('test_legacyCacheKeyAliases_when_generala_should_include_gen_and_gdansk_variants', () => {
    const aliases = legacyCacheKeyAliases('04-247 Warszawa Generała Chruściela 25');
    expect(aliases).toContain('04-247 Warszawa Gen. Chruściela 25');
    expect(aliases).toContain('04-247 Warszawa GEN. Chruściela 25');
  });
});
