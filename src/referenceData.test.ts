import { describe, expect, it } from 'vitest';
import { mergePodwykoEntries } from './referenceData.js';

describe('mergePodwykoEntries', () => {
  it('test_mergePodwykoEntries_dedupes_same_label_and_dane', () => {
    const merged = mergePodwykoEntries([
      [{ baseLabel: 'Firma A', dane: 'Dane A' }],
      [{ baseLabel: 'Firma A', dane: 'Dane A' }],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({ label: 'Firma A', dane: 'Dane A' });
  });

  it('test_mergePodwykoEntries_preserves_order_primary_first', () => {
    const merged = mergePodwykoEntries([
      [{ baseLabel: 'Pierwszy', dane: 'D1' }],
      [{ baseLabel: 'Drugi', dane: 'D2' }],
    ]);
    expect(merged.map((item) => item.label)).toEqual(['Pierwszy', 'Drugi']);
  });

  it('test_mergePodwykoEntries_allows_same_label_different_dane', () => {
    const merged = mergePodwykoEntries([
      [{ baseLabel: 'Firma', dane: 'Wariant 1' }],
      [{ baseLabel: 'Firma', dane: 'Wariant 2' }],
    ]);
    expect(merged).toHaveLength(2);
  });
});
