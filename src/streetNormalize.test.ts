import { describe, it, expect } from 'vitest';
import {
  normalizeStreetFromSheet,
  normalizeStreetForCompare,
  needsStreetPrefixQueryVariants,
  streetAbbreviationQueryVariant,
  streetTitleAbbreviationQueryVariants,
  stripStreetPrefix,
  isHamletPlaceStreet,
} from './streetNormalize';

describe('streetNormalize', () => {
  describe('stripStreetPrefix', () => {
    it('test_stripStreetPrefix_when_glued_al_prefix_should_remove_it', () => {
      expect(stripStreetPrefix('al.Chryzantem')).toBe('Chryzantem');
      expect(stripStreetPrefix('ul.Marszałkowska')).toBe('Marszałkowska');
    });

    it('test_stripStreetPrefix_when_spaced_prefix_should_remove_it', () => {
      expect(stripStreetPrefix('al. Niepodległości')).toBe('Niepodległości');
    });

    it('test_stripStreetPrefix_when_osiedle_prefix_should_keep_it', () => {
      expect(stripStreetPrefix('os. Władysława Łokietka')).toBe('os. Władysława Łokietka');
      expect(stripStreetPrefix('os. Wysokie')).toBe('os. Wysokie');
    });
  });

  describe('normalizeStreetFromSheet', () => {
    it('test_normalizeStreetFromSheet_when_lodz_chryzantem_should_strip_al_prefix', () => {
      expect(normalizeStreetFromSheet('al.Chryzantem', 'Łódź')).toBe('Chryzantem');
    });

    it('test_normalizeStreetFromSheet_when_naleczow_b_glowackiego_should_expand_abbreviation', () => {
      expect(normalizeStreetFromSheet('B. Głowackiego', 'Nałęczów')).toBe('Barbary Głowackiego');
    });

    it('test_normalizeStreetFromSheet_when_dynow_k_wielkiego_should_expand_abbreviation', () => {
      expect(normalizeStreetFromSheet('K. WIELKIEGO', 'DYNÓW')).toBe('Króla Wielkiego');
    });

    it('test_normalizeStreetFromSheet_when_chelm_ramba_brzeska_should_fix_typo_to_rampa', () => {
      expect(normalizeStreetFromSheet('Ramba Brzeska', 'Chełm')).toBe('Rampa Brzeska');
    });

    it('test_normalizeStreetFromSheet_when_normal_street_should_leave_unchanged', () => {
      expect(normalizeStreetFromSheet('Przybyszewskiego', 'Kraków')).toBe('Przybyszewskiego');
    });

    it('test_normalizeStreetFromSheet_when_krakow_amii_typo_should_expand_to_armii', () => {
      expect(normalizeStreetFromSheet('Amii Kraków', 'Kraków')).toBe('Armii Kraków');
      expect(normalizeStreetFromSheet('ul. Amii Kraków', 'Kraków')).toBe('Armii Kraków');
    });

    it('test_normalizeStreetFromSheet_when_krakow_solidarosci_typo_should_fix_spelling', () => {
      expect(normalizeStreetFromSheet('Solidarości', 'Kraków')).toBe('Solidarności');
      expect(normalizeStreetFromSheet('Al. Solidarości', 'KRAKÓW')).toBe('Solidarności');
    });

    it('test_normalizeStreetFromSheet_when_krakow_wizawi_prefix_should_strip_shop_name', () => {
      expect(normalizeStreetFromSheet('wizawi Podgórska', 'Kraków')).toBe('Podgórska');
    });

    it('test_normalizeStreetFromSheet_when_title_abbreviations_should_expand', () => {
      expect(normalizeStreetFromSheet('Gen. Sikorskiego', 'Skopanie')).toBe(
        'Aleja Generała Sikorskiego',
      );
      expect(normalizeStreetFromSheet('Gen.Sikorskiego', 'Skopanie')).toBe(
        'Aleja Generała Sikorskiego',
      );
      expect(normalizeStreetFromSheet('ks. Kubowicza', 'Blachownia')).toBe('Księdza Kubowicza');
      expect(normalizeStreetFromSheet('św. Jana z Dukli', 'Jasło')).toBe('Świętego Jana z Dukli');
      expect(normalizeStreetFromSheet('kard. Stefana Wyszyńskiego', 'Góra Kalwaria')).toBe(
        'Kardynała Stefana Wyszyńskiego',
      );
    });

    it('test_normalizeStreetFromSheet_when_pila_powstancow_should_add_aleja_prefix', () => {
      expect(normalizeStreetFromSheet('POWSTAŃCÓW WLKP.', 'Piła')).toBe('Aleja Powstańców Wlkp');
    });

    it('test_normalizeStreetFromSheet_when_embedded_ul_should_extract_street', () => {
      expect(
        normalizeStreetFromSheet('JAKUBOWICE KONIŃSKIE JAKUBOWICE KONIŃSKIE UL.LUBELSKA', 'JAKUBOWICE KONIŃSKIE'),
      ).toBe('Lubelska');
    });

    it('test_normalizeStreetFromSheet_when_gdansk_gdanska_typo_should_strip_city_prefix', () => {
      expect(normalizeStreetFromSheet('Gdańska Chmielna', 'Gdańsk')).toBe('Chmielna');
    });

    it('test_normalizeStreetFromSheet_when_city_street_rules_should_apply', () => {
      expect(normalizeStreetFromSheet('Armii Poznań', 'ŚRODA WLKP.')).toBe('Plac Armii Poznań');
      expect(normalizeStreetFromSheet('Trzech Państw', 'Porajów')).toBe('Aleja Trzech Państw');
      expect(normalizeStreetFromSheet('INZYNIERSKA', 'OSTRÓW WLKP.')).toBe('Inżynierska');
    });
  });

  describe('normalizeStreetForCompare', () => {
    it('test_normalizeStreetForCompare_when_aleja_prefix_should_match_core_name', () => {
      expect(normalizeStreetForCompare('Aleja Trzech Państw', 'Porajów')).toBe(
        normalizeStreetForCompare('Trzech Państw', 'Porajów'),
      );
    });

    it('test_normalizeStreetForCompare_when_gen_abbrev_in_sheet_should_match_osm_full_form', () => {
      expect(normalizeStreetForCompare('Gen. Sikorskiego', 'Skopanie')).toBe(
        normalizeStreetForCompare('Aleja Generała Sikorskiego', 'Skopanie'),
      );
    });

    it('test_normalizeStreetForCompare_when_polish_diacritics_should_fold', () => {
      expect(normalizeStreetForCompare('Generała Chruściela')).toBe(
        normalizeStreetForCompare('Generala Chrusciela'),
      );
    });
  });

  describe('streetTitleAbbreviationQueryVariants', () => {
    it('test_streetTitleAbbreviationQueryVariants_when_generala_should_include_gen_forms', () => {
      const variants = streetTitleAbbreviationQueryVariants('Generała Chruściela');
      expect(variants).toContain('Gen. Chruściela');
      expect(variants).toContain('GEN. Chruściela');
      expect(variants).toContain('Gen.Chruściela');
    });

    it('test_streetTitleAbbreviationQueryVariants_when_raw_gen_dot_should_include_both_forms', () => {
      const variants = streetTitleAbbreviationQueryVariants(
        'Generała J.HALLERA',
        'GEN.J.HALLERA',
      );
      expect(variants).toContain('Gen. J.HALLERA');
      expect(variants).toContain('GEN.J.HALLERA');
      expect(variants).toContain('GEN. J.HALLERA');
    });

    it('test_streetTitleAbbreviationQueryVariants_when_swietego_should_include_sw_forms', () => {
      const variants = streetTitleAbbreviationQueryVariants('Świętego BARBARY', 'ŚW. BARBARY');
      expect(variants).toContain('Św. BARBARY');
      expect(variants).toContain('SW. BARBARY');
      expect(variants).toContain('ŚW. BARBARY');
    });

    it('test_streetTitleAbbreviationQueryVariants_when_aleja_generala_should_include_abbrev_variants', () => {
      const variants = streetTitleAbbreviationQueryVariants('Aleja Generała Sikorskiego');
      expect(variants).toContain('Aleja Gen. Sikorskiego');
      expect(variants).toContain('Gen. Sikorskiego');
    });
  });

  describe('streetAbbreviationQueryVariant', () => {
    it('test_streetAbbreviationQueryVariant_when_generala_should_return_gen', () => {
      expect(streetAbbreviationQueryVariant('Generała Chruściela')).toBe('Gen. Chruściela');
      expect(streetAbbreviationQueryVariant('Księdza Kubowicza')).toBe('ks. Kubowicza');
    });
  });

  describe('needsStreetPrefixQueryVariants', () => {
    it('test_needsStreetPrefixQueryVariants_when_targowa_without_ul_should_return_true', () => {
      expect(needsStreetPrefixQueryVariants('Targowa', 'Kalwaria Zabrzydowska')).toBe(true);
    });

    it('test_needsStreetPrefixQueryVariants_when_already_has_ul_should_return_false', () => {
      expect(needsStreetPrefixQueryVariants('ul. Targowa', 'Kalwaria Zabrzydowska')).toBe(false);
    });

    it('test_needsStreetPrefixQueryVariants_when_aleja_full_word_should_return_true', () => {
      expect(needsStreetPrefixQueryVariants('Aleja Generała Sikorskiego', 'Skopanie')).toBe(true);
    });
  });

  describe('isHamletPlaceStreet', () => {
    it('test_isHamletPlaceStreet_when_all_caps_hamlet_should_return_true', () => {
      expect(isHamletPlaceStreet('KLĘCZANA', 'GDÓW')).toBe(true);
      expect(isHamletPlaceStreet('POROSIUKI', 'BIAŁA PODLASKA')).toBe(true);
    });

    it('test_isHamletPlaceStreet_when_real_street_should_return_false', () => {
      expect(isHamletPlaceStreet('Targowa', 'Kalwaria Zabrzydowska')).toBe(false);
      expect(isHamletPlaceStreet('Bema', 'Brzozów')).toBe(false);
    });
  });
});
