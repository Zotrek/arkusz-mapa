import { describe, expect, it } from 'vitest';
import {
  allowedWojewodztwaForPostcode,
  extractPostcodeFromAddress,
  findPostcodeZoneMismatches,
  haversineKm,
  parsePostcodeExceptions,
  wojewodztwaMatch,
} from './postcodeZoneCheck.js';

describe('postcodeZoneCheck', () => {
  it('test_extractPostcodeFromAddress_when_leading_postcode_should_return_it', () => {
    expect(extractPostcodeFromAddress('21-080 Bogucin Bogucin 59A')).toBe('21-080');
  });

  it('test_extractPostcodeFromAddress_when_missing_should_return_null', () => {
    expect(extractPostcodeFromAddress('Bogucin 59A')).toBeNull();
  });

  it('test_wojewodztwaMatch_when_diacritics_differ_should_match', () => {
    expect(wojewodztwaMatch('Małopolskie', 'Malopolskie')).toBe(true);
    expect(wojewodztwaMatch('Łódzkie', 'Lodzkie')).toBe(true);
  });

  it('test_haversineKm_when_same_point_should_be_zero', () => {
    expect(haversineKm(52.0, 21.0, 52.0, 21.0)).toBe(0);
  });

  it('test_findPostcodeZoneMismatches_when_bogucin_wrong_pin_should_flag', () => {
    const result = findPostcodeZoneMismatches([
      {
        address: '21-080 Bogucin Bogucin 59A',
        count: 2,
        lat: 52.7419216,
        lng: 20.0739355,
        wojewodztwo: 'Mazowieckie',
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      address: '21-080 Bogucin Bogucin 59A',
      postcode: '21-080',
      liczbaWystapien: 2,
      wojewodztwo: 'Mazowieckie',
      oczekiwaneWojewodztwo: 'Lubelskie',
    });
    expect(result[0]!.odlegloscKm).toBeGreaterThan(50);
  });

  it('test_findPostcodeZoneMismatches_when_radom_26xxx_mazowieckie_should_not_flag', () => {
    const result = findPostcodeZoneMismatches([
      {
        address: '26-900 Kozienice Przemysłowa 3',
        count: 1,
        lat: 51.58,
        lng: 21.55,
        wojewodztwo: 'Mazowieckie',
      },
    ]);
    expect(result).toHaveLength(0);
  });

  it('test_findPostcodeZoneMismatches_when_opoczno_26xxx_lodzkie_should_not_flag', () => {
    const result = findPostcodeZoneMismatches([
      {
        address: '26-300 opoczno Bukowiec Opoczyński 7A',
        count: 1,
        lat: 51.36,
        lng: 20.28,
        wojewodztwo: 'Łódzkie',
      },
    ]);
    expect(result).toHaveLength(0);
  });

  it('test_findPostcodeZoneMismatches_when_gorlice_38xxx_malopolskie_should_not_flag', () => {
    const result = findPostcodeZoneMismatches([
      {
        address: '38-350 Bobowa Grunwaldzka 69',
        count: 1,
        lat: 49.7,
        lng: 20.95,
        wojewodztwo: 'Małopolskie',
      },
    ]);
    expect(result).toHaveLength(0);
  });

  it('test_allowedWojewodztwaForPostcode_when_26_should_include_mazowieckie_and_lodzkie', () => {
    expect(allowedWojewodztwaForPostcode('26-600')).toEqual([
      'Świętokrzyskie',
      'Mazowieckie',
      'Łódzkie',
    ]);
  });

  it('test_findPostcodeZoneMismatches_when_corrected_bogucin_should_not_flag', () => {
    const result = findPostcodeZoneMismatches([
      {
        address: '21-080 Bogucin Bogucin 59A',
        count: 1,
        lat: 51.33898411856679,
        lng: 22.355721499720907,
        wojewodztwo: 'Lubelskie',
      },
    ]);

    expect(result).toHaveLength(0);
  });

  it('test_findPostcodeZoneMismatches_when_far_but_same_wojewodztwo_should_not_flag', () => {
    // Leszno: daleko od centroidu 64-xxx, ale nadal Wielkopolskie
    const result = findPostcodeZoneMismatches([
      {
        address: '64-100 Leszno Geodetów 4',
        count: 1,
        lat: 51.820897,
        lng: 16.5964055,
        wojewodztwo: 'Wielkopolskie',
      },
    ]);

    expect(result).toHaveLength(0);
  });

  it('test_findPostcodeZoneMismatches_when_near_centroid_wrong_woj_label_should_not_flag', () => {
    const result = findPostcodeZoneMismatches([
      {
        address: '21-080 Somewhere 1',
        count: 1,
        lat: 51.7,
        lng: 22.5,
        wojewodztwo: 'Mazowieckie',
      },
    ]);

    expect(result).toHaveLength(0);
  });

  it('test_findPostcodeZoneMismatches_should_sort_by_distance_desc', () => {
    const result = findPostcodeZoneMismatches([
      {
        address: '97-890 Lubraniec 3-Go Maja 4',
        count: 1,
        lat: 52.54077865802163,
        lng: 18.830826627751545,
        wojewodztwo: 'Kujawsko-Pomorskie',
      },
      {
        address: '57-500 Rypin Piłsudskiego 49',
        count: 1,
        lat: 53.072388395656965,
        lng: 19.411325543071058,
        wojewodztwo: 'Kujawsko-Pomorskie',
      },
    ]);

    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]!.odlegloscKm).toBeGreaterThanOrEqual(result[1]!.odlegloscKm);
    expect(result[0]!.address).toContain('Rypin');
  });

  it('test_findPostcodeZoneMismatches_when_excluded_should_skip_known_false_alarms', () => {
    const result = findPostcodeZoneMismatches(
      [
        {
          address: '57-500 Rypin Piłsudskiego 49',
          count: 1,
          lat: 53.072388395656965,
          lng: 19.411325543071058,
          wojewodztwo: 'Kujawsko-Pomorskie',
        },
        {
          address: '21-080 Bogucin Bogucin 59A',
          count: 1,
          lat: 52.7419216,
          lng: 20.0739355,
          wojewodztwo: 'Mazowieckie',
        },
      ],
      {
        excludedAddresses: new Set(['57-500 Rypin Piłsudskiego 49']),
      },
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.address).toContain('Bogucin');
  });

  it('test_parsePostcodeExceptions_when_object_or_array_should_collect_addresses', () => {
    expect(
      parsePostcodeExceptions({
        '57-500 Rypin Piłsudskiego 49': 'note',
        '97-890 Lubraniec 3-Go Maja 4': 'note',
      }),
    ).toEqual(new Set(['57-500 Rypin Piłsudskiego 49', '97-890 Lubraniec 3-Go Maja 4']));
    expect(parsePostcodeExceptions(['57-500 Rypin Piłsudskiego 49'])).toEqual(
      new Set(['57-500 Rypin Piłsudskiego 49']),
    );
  });
});
