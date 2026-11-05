// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SEED_APPLIED_LANDED_IDS_CAP, SeedAppliedLandedSchema } from '@objectstack/spec/api';
import { seedAppliedLanded, type SeedLandingResult } from './seed-applied-landed.js';

/**
 * [#30348] `seedAppliedLanded` — the one projection both `seedApplied`
 * producers fold the loader's per-dataset results through, pinned on its own,
 * without an engine: the junk it skips, the empty answer, the cap boundary, and
 * the cross-dataset merge that keeps a row this batch created out of
 * `matched`. The publish doors' pins (`@objectstack/objectql`'s
 * `publish-seed-receipt-landed-ids.test.ts`) read the same answer off a real
 * engine; these pin the cases a door cannot stage cleanly.
 */

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const list = (xs: string[], total = xs.length) => ({ ids: xs, total, truncated: total > xs.length });
const NONE = list([]);

describe('seedAppliedLanded (#30348)', () => {
  it('no results: an empty list, never undefined', () => {
    expect(seedAppliedLanded([])).toEqual([]);
  });

  it('skips junk entries — a null, a missing or non-string object — and keeps the real ones', () => {
    const junk = [
      null,
      undefined,
      {},
      { object: 42, landedIds: ['x'] },
      { landedIds: ['y'], insertedIds: ['y'] },
      { object: 'account', landedIds: ['a1'], insertedIds: ['a1'] },
    ] as unknown as SeedLandingResult[];

    expect(seedAppliedLanded(junk)).toEqual([{ object: 'account', inserted: list(['a1']), matched: NONE }]);
  });

  it('a dataset that landed nothing still reports its object, with two empty lists', () => {
    expect(seedAppliedLanded([{ object: 'account', landedIds: [], insertedIds: [] }]))
      .toEqual([{ object: 'account', inserted: NONE, matched: NONE }]);
    // A result predating `insertedIds` (both keys absent) reads the same.
    expect(seedAppliedLanded([{ object: 'account' }])).toEqual([{ object: 'account', inserted: NONE, matched: NONE }]);
  });

  it('splits one dataset: inserted ids under `inserted`, every other landed id under `matched`', () => {
    expect(seedAppliedLanded([{ object: 'account', landedIds: ['c9', 'a1', 'a2'], insertedIds: ['a1', 'a2'] }]))
      .toEqual([{ object: 'account', inserted: list(['a1', 'a2']), matched: list(['c9']) }]);
  });

  it('the cap: exactly 200 is carried whole and not truncated; 201 carries the first 200 and says so', () => {
    expect(SEED_APPLIED_LANDED_IDS_CAP).toBe(200);
    const exact = ids('r', SEED_APPLIED_LANDED_IDS_CAP);
    const over = ids('r', SEED_APPLIED_LANDED_IDS_CAP + 1);

    const [atCap] = seedAppliedLanded([{ object: 'account', landedIds: exact, insertedIds: exact }]);
    expect(atCap.inserted).toEqual({ ids: exact, total: 200, truncated: false });

    const [cut] = seedAppliedLanded([{ object: 'account', landedIds: over, insertedIds: [] }]);
    expect(cut.matched).toEqual({ ids: over.slice(0, 200), total: 201, truncated: true });
    expect(cut.inserted).toEqual(NONE);

    // What the projection emits is what the spec schema carries.
    expect(SeedAppliedLandedSchema.parse(cut)).toEqual(cut);
    expect(SeedAppliedLandedSchema.parse(atCap)).toEqual(atCap);
  });

  it('the cap is per list: 201 inserted and 201 matched cut each list on its own', () => {
    const ins = ids('i', 201);
    const mat = ids('m', 201);
    const [entry] = seedAppliedLanded([{ object: 'account', landedIds: [...ins, ...mat], insertedIds: ins }]);
    expect(entry.inserted).toEqual({ ids: ins.slice(0, 200), total: 201, truncated: true });
    expect(entry.matched).toEqual({ ids: mat.slice(0, 200), total: 201, truncated: true });
  });

  it('two datasets of one object: a row the first inserted and the second matched stays `inserted` only', () => {
    const results: SeedLandingResult[] = [
      { object: 'account', landedIds: ['a1', 'a2'], insertedIds: ['a1', 'a2'] },
      // Its key matched `a1`, the row the first dataset just created, and a customer row `c9`.
      { object: 'account', landedIds: ['a1', 'c9', 'a3'], insertedIds: ['a3'] },
    ];

    expect(seedAppliedLanded(results)).toEqual([
      { object: 'account', inserted: list(['a1', 'a2', 'a3']), matched: list(['c9']) },
    ]);
  });

  it('a row an EARLIER dataset matched and a later one inserted is `inserted`, never both', () => {
    // The rule is order-free: membership in any dataset's `insertedIds` decides.
    const [entry] = seedAppliedLanded([
      { object: 'account', landedIds: ['x'], insertedIds: [] },
      { object: 'account', landedIds: ['x'], insertedIds: ['x'] },
    ]);
    expect(entry).toEqual({ object: 'account', inserted: list(['x']), matched: NONE });
  });

  it('objects keep the order they first loaded in; ids dedupe, first occurrence kept', () => {
    const out = seedAppliedLanded([
      { object: 'contact', landedIds: ['k1'], insertedIds: ['k1'] },
      { object: 'account', landedIds: ['a1', 'a1'], insertedIds: ['a1', 'a1'] },
      { object: 'contact', landedIds: ['k2', 'k1'], insertedIds: ['k2'] },
    ]);
    expect(out.map((e) => e.object)).toEqual(['contact', 'account']);
    expect(out[0]).toEqual({ object: 'contact', inserted: list(['k1', 'k2']), matched: NONE });
    expect(out[1]).toEqual({ object: 'account', inserted: list(['a1']), matched: NONE });
  });
});
