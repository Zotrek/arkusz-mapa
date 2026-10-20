import { describe, expect, it } from 'vitest';
import { mergePhase5CacheEntries } from './merge-phase5-cache.mjs';

const ok = (lat: number) => ({ status: 'ok', lat, lng: 17, wojewodztwo: 'Wielkopolskie', updatedAt: '2026-10-01T00:00:00.000Z' });

describe('merge-phase5-cache', () => {
  it('test_mergePhase5CacheEntries_when_same_key_in_both_should_prefer_data', () => {
    const { entries } = mergePhase5CacheEntries({ A: ok(1) }, { A: ok(2) }, null);
    expect(entries.A.lat).toBe(1);
  });

  it('test_mergePhase5CacheEntries_when_key_only_in_actions_should_keep_it', () => {
    const { entries, removed } = mergePhase5CacheEntries({ A: ok(1) }, { A: ok(1), B: ok(2) }, ['A']);
    expect(entries.B.lat).toBe(2);
    expect(removed).toEqual([]);
  });

  it('test_mergePhase5CacheEntries_when_key_removed_from_data_should_drop_it_from_actions', () => {
    const { entries, removed } = mergePhase5CacheEntries({}, { A: ok(1), B: ok(2) }, ['A']);
    expect(entries).not.toHaveProperty('A');
    expect(entries.B.lat).toBe(2);
    expect(removed).toEqual(['A']);
  });

  it('test_mergePhase5CacheEntries_when_no_previous_data_keys_should_keep_all_actions_entries', () => {
    const { entries, removed } = mergePhase5CacheEntries({}, { A: ok(1) }, null);
    expect(entries.A.lat).toBe(1);
    expect(removed).toEqual([]);
  });
});
