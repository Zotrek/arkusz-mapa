import { describe, it, expect } from 'vitest';
import {
  buildCanonicalCacheKey,
  canonicalCacheKeyFromLegacyAddress,
  legacyStreetAbbrevCacheKeyVariants,
  parseCacheAddressKey,
} from './cacheKeyNormalize';

describe('cacheKeyNormalize', () => {
  it('test_canonicalCacheKeyFromLegacyAddress_when_gdansk_should_normalize_city', () => {
    expect(canonicalCacheKeyFromLegacyAddress('80-843 Gdansk Olejarna 3')).toBe(
      '80-843 Gdańsk Olejarna 3',
    );
  });

  it('test_canonicalCacheKeyFromLegacyAddress_when_gen_abbrev_should_expand_street', () => {
    expect(canonicalCacheKeyFromLegacyAddress('04-247 Warszawa Gen. Chruściela 25')).toBe(
      '04-247 Warszawa Generała Chruściela 25',
    );
  });

  it('test_canonicalCacheKeyFromLegacyAddress_when_sw_abbrev_should_expand_street', () => {
    expect(canonicalCacheKeyFromLegacyAddress('71-516 SZCZECIN ŚW. BARBARY 1 A')).toBe(
      '71-516 SZCZECIN Świętego BARBARY 1 A',
    );
  });

  it('test_canonicalCacheKeyFromLegacyAddress_when_duplicate_number_in_street_should_strip', () => {
    expect(canonicalCacheKeyFromLegacyAddress('37-750 Dubiecko Winne-Podbukowina 11 11')).toBe(
      '37-750 Dubiecko Winne-Podbukowina 11',
    );
  });

  it('test_buildCanonicalCacheKey_when_already_canonical_should_return_same', () => {
    const key = '80-843 Gdańsk Olejarna 3';
    expect(buildCanonicalCacheKey(key)).toBe(key);
  });

  it('test_legacyStreetAbbrevCacheKeyVariants_when_generala_should_include_gen', () => {
    const canonical = '04-247 Warszawa Generała Chruściela 25';
    const variants = legacyStreetAbbrevCacheKeyVariants(canonical);
    expect(variants).toContain('04-247 Warszawa Gen. Chruściela 25');
    expect(variants).toContain('04-247 Warszawa GEN. Chruściela 25');
  });

  it('test_parseCacheAddressKey_when_multiword_city_should_split_correctly', () => {
    const parts = parseCacheAddressKey('21-500 BIAŁA PODLASKA POROSIUKI 130');
    expect(parts?.miasto).toBe('BIAŁA PODLASKA');
    expect(parts?.ulica).toBe('POROSIUKI');
    expect(parts?.numerBudynku).toBe('130');
  });
});
