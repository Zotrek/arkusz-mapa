import { describe, it, expect } from 'vitest';
import type { AddressGroup } from './phase3';
import {
  buildActionsOnlyCacheEntries,
  resolveCoordinateFromLadder,
  type CacheEntry,
} from './phase5';
import { buildPoprawAdresIndex } from './poprawAdres';

function makeGroup(address: string): AddressGroup {
  return {
    address,
    count: 1,
    rows: [
      {
        sourceRowIndex: 2,
        podmiotHandlowy: 'A',
        sklep: 'B',
        kodPocztowy: '',
        miasto: '',
        ulica: '',
        ulicaRaw: '',
        numerBudynku: '',
        gmina: '',
        numerPlomby: '1',
        dataZamknieciaWorka: '',
        zbiorka: '',
        wgHarmonogramu: '',
        dniHarmonogramu: '',
        firmaTransportowa: '',
        raw: [],
        address,
      },
    ],
  };
}

describe('phase5 coordinate ladder', () => {
  it('test_resolveCoordinateFromLadder_when_popraw_adres_should_win_over_cache', () => {
    const address = '62-320 Miłosław Test 18';
    const poprawIndex = buildPoprawAdresIndex([
      { podmiotHandlowy: '', sklep: '', adres: address, lat: 1.1, lng: 2.2 },
    ]);
    const dataCache: Record<string, CacheEntry> = {
      [address]: {
        status: 'ok',
        lat: 9,
        lng: 9,
        wojewodztwo: 'X',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    };
    const hit = resolveCoordinateFromLadder(
      address,
      makeGroup(address),
      poprawIndex,
      dataCache,
      {},
    );
    expect(hit?.source).toMatch(/^popraw_adres/);
    expect(hit?.entry.lat).toBe(1.1);
  });

  it('test_resolveCoordinateFromLadder_when_no_popraw_should_use_data_cache', () => {
    const address = '62-320 Miłosław Test 18';
    const dataCache: Record<string, CacheEntry> = {
      [address]: {
        status: 'ok',
        lat: 52.2,
        lng: 17.5,
        wojewodztwo: 'Wielkopolskie',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    };
    const hit = resolveCoordinateFromLadder(address, makeGroup(address), new Map(), dataCache, {
      [address]: {
        status: 'ok',
        lat: 0,
        lng: 0,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    expect(hit?.source).toBe('data_cache');
    expect(hit?.entry.lat).toBe(52.2);
  });

  it('test_resolveCoordinateFromLadder_when_only_actions_cache_should_use_it', () => {
    const address = '97-200 Tomaszów Hoża 1/3';
    const hit = resolveCoordinateFromLadder(address, makeGroup(address), new Map(), {}, {
      [address]: {
        status: 'uncertain',
        lat: 51.5,
        lng: 20.0,
        wojewodztwo: 'Łódzkie',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    expect(hit?.source).toBe('actions_cache');
  });

  it('test_buildActionsOnlyCacheEntries_should_exclude_data_keys', () => {
    const merged = {
      a: { status: 'ok' as const, lat: 1, lng: 1, updatedAt: 't' },
      b: { status: 'ok' as const, lat: 2, lng: 2, updatedAt: 't' },
    };
    const data = { a: merged.a };
    const only = buildActionsOnlyCacheEntries(merged, data);
    expect(Object.keys(only)).toEqual(['b']);
  });
});
