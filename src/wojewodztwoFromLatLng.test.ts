import { describe, it, expect } from 'vitest';
import {
  enrichWojewodztwoIfMissing,
  isUnknownWojewodztwo,
  normalizeWojewodztwoGeoJsonName,
  parseWojewodztwaGeoJson,
  resolveWojewodztwoFromLatLng,
  type WojewodztwoGeoJsonFeature,
} from './wojewodztwoFromLatLng';

/** Prostokąt obejmujący Gdańsk (przybliżony). */
function pomorskieFeature(): WojewodztwoGeoJsonFeature {
  return {
    type: 'Feature',
    properties: { name: 'Pomorskie' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [18.0, 54.0],
          [19.5, 54.0],
          [19.5, 54.9],
          [18.0, 54.9],
          [18.0, 54.0],
        ],
      ],
    },
  };
}

function wielkopolskieFeature(): WojewodztwoGeoJsonFeature {
  return {
    type: 'Feature',
    properties: { name: 'Wielkopolskie' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [16.0, 51.5],
          [18.5, 51.5],
          [18.5, 53.5],
          [16.0, 53.5],
          [16.0, 51.5],
        ],
      ],
    },
  };
}

describe('wojewodztwoFromLatLng', () => {
  it('test_isUnknownWojewodztwo_when_empty_or_nieznane_should_return_true', () => {
    expect(isUnknownWojewodztwo(undefined)).toBe(true);
    expect(isUnknownWojewodztwo('')).toBe(true);
    expect(isUnknownWojewodztwo('  ')).toBe(true);
    expect(isUnknownWojewodztwo('Nieznane')).toBe(true);
    expect(isUnknownWojewodztwo('Pomorskie')).toBe(false);
  });

  it('test_normalizeWojewodztwoGeoJsonName_when_prefix_should_strip', () => {
    expect(normalizeWojewodztwoGeoJsonName('województwo małopolskie')).toBe('Małopolskie');
    expect(normalizeWojewodztwoGeoJsonName('Pomorskie')).toBe('Pomorskie');
  });

  it('test_resolveWojewodztwoFromLatLng_when_point_in_polygon_should_return_name', () => {
    const features = [pomorskieFeature(), wielkopolskieFeature()];
    expect(resolveWojewodztwoFromLatLng(54.35, 18.64, features)).toBe('Pomorskie');
    expect(resolveWojewodztwoFromLatLng(52.2, 17.5, features)).toBe('Wielkopolskie');
  });

  it('test_resolveWojewodztwoFromLatLng_when_outside_should_return_empty', () => {
    expect(resolveWojewodztwoFromLatLng(0, 0, [pomorskieFeature()])).toBe('');
  });

  it('test_enrichWojewodztwoIfMissing_when_nieznane_should_fill_from_lat_lng', () => {
    const enriched = enrichWojewodztwoIfMissing(
      { lat: 54.35, lng: 18.64, wojewodztwo: 'Nieznane' },
      [pomorskieFeature()],
    );
    expect(enriched.wojewodztwo).toBe('Pomorskie');
  });

  it('test_enrichWojewodztwoIfMissing_when_already_set_should_keep', () => {
    const enriched = enrichWojewodztwoIfMissing(
      { lat: 54.35, lng: 18.64, wojewodztwo: 'Mazowieckie' },
      [pomorskieFeature()],
    );
    expect(enriched.wojewodztwo).toBe('Mazowieckie');
  });

  it('test_parseWojewodztwaGeoJson_when_feature_collection_should_return_features', () => {
    const features = parseWojewodztwaGeoJson({
      type: 'FeatureCollection',
      features: [pomorskieFeature()],
    });
    expect(features).toHaveLength(1);
    expect(resolveWojewodztwoFromLatLng(54.35, 18.64, features)).toBe('Pomorskie');
  });
});
