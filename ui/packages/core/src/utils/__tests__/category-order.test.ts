/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * framework#3588 — a picklist's declared option order is the domain order, and
 * ordered-sequence charts (funnel/pyramid) must render along it rather than
 * alphabetically or by value.
 */

import { describe, it, expect } from 'vitest';
import { buildCategoryOrder, buildCategoryRank } from '../chart-series';

const STAGES = [
  { value: 'qualification', label: 'Qualification' },
  { value: 'needs_analysis', label: 'Needs Analysis' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'negotiation', label: 'Negotiation' },
];

describe('buildCategoryOrder', () => {
  it('keeps the declared order and keys by BOTH value and label', () => {
    expect(buildCategoryOrder(STAGES)).toEqual([
      'qualification', 'Qualification',
      'needs_analysis', 'Needs Analysis',
      'proposal', 'Proposal',
      'negotiation', 'Negotiation',
    ]);
  });

  it('accepts bare string options', () => {
    expect(buildCategoryOrder(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('does not duplicate a label identical to its value', () => {
    expect(buildCategoryOrder([{ value: 'open', label: 'open' }])).toEqual(['open']);
  });

  it('returns null for a field with no options, so callers keep their default', () => {
    expect(buildCategoryOrder(undefined)).toBeNull();
    expect(buildCategoryOrder([])).toBeNull();
    expect(buildCategoryOrder('nope')).toBeNull();
  });
});

describe('buildCategoryRank', () => {
  it('ranks value and label of the same option identically enough to sort together', () => {
    const rank = buildCategoryRank(buildCategoryOrder(STAGES))!;
    // A row keyed by the stored value and one keyed by the display label both
    // sort into the same slot relative to the other stages.
    expect(rank.get('qualification')).toBeLessThan(rank.get('Needs Analysis')!);
    expect(rank.get('Proposal')).toBeLessThan(rank.get('negotiation')!);
  });

  it('sorts the real pipeline out of alphabetical order', () => {
    const rank = buildCategoryRank(buildCategoryOrder(STAGES))!;
    // Alphabetical is the order analytics returns; the declared order is not it.
    const alphabetical = ['Needs Analysis', 'Negotiation', 'Proposal', 'Qualification'];
    const sorted = [...alphabetical].sort(
      (a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity),
    );
    expect(sorted).toEqual(['Qualification', 'Needs Analysis', 'Proposal', 'Negotiation']);
  });

  it('first occurrence wins for a repeated key', () => {
    const rank = buildCategoryRank(['a', 'b', 'a'])!;
    expect(rank.get('a')).toBe(0);
  });

  it('returns null for an empty/absent order', () => {
    expect(buildCategoryRank(null)).toBeNull();
    expect(buildCategoryRank([])).toBeNull();
  });
});
