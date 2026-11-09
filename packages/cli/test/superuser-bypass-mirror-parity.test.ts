// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The author-time copy of the super-user bypass answers exactly as the
 * runtime's own reading does, over one case matrix.
 *
 * `holdsSuperuserBypass` (`@objectstack/core`, `security/effective-object-permissions.ts`)
 * is the ONE reading of "does this set hold View All / Modify All on this
 * object": the row bypass and both field merges ask it (ADR-0066 D2, ruling
 * of record 6573563853 letter A). `@objectstack/lint` depends on
 * `@objectstack/spec` alone, so its `security-superuser-field-mask-inert`
 * rule reads the bypass through a verbatim COPY exported under the same name.
 * A copy is a second reading the day the two drift, and a drifted lint either
 * warns about a mask the runtime enforces or stays silent about one it
 * ignores. This package depends on both, so the parity is pinned here: a
 * change to either function reds this file until the other follows.
 *
 * The matrix is the cartesian product of what the lookup reads: the set's own
 * entry for the object and its `'*'` entry, each absent, `null`, empty, or
 * carrying View All, Modify All, both, or a non-boolean truthy / falsy bit
 * (the reading is `Boolean(...)`, not `=== true`); the object asked about; and
 * the bit. Plus the sets with no usable `objects` at all.
 */

import { describe, expect, it } from 'vitest';
import { holdsSuperuserBypass as runtimeReading } from '@objectstack/core';
import { holdsSuperuserBypass as authoringCopy } from '@objectstack/lint';

const ENTRIES: ReadonlyArray<[string, unknown]> = [
  ['absent', undefined],
  ['null', null],
  ['empty', {}],
  ['view', { allowRead: true, viewAllRecords: true }],
  ['modify', { allowRead: true, allowEdit: true, modifyAllRecords: true }],
  ['both', { viewAllRecords: true, modifyAllRecords: true }],
  ['neither, spelled false', { viewAllRecords: false, modifyAllRecords: false }],
  ['view, truthy non-boolean', { viewAllRecords: 1 }],
  ['modify, truthy non-boolean', { modifyAllRecords: 'yes' }],
  ['modify, falsy non-boolean', { modifyAllRecords: 0 }],
];
const OBJECTS = ['deal', '*'] as const;
const BITS = ['view', 'modify'] as const;

type Case = { label: string; set: unknown; objectName: string; bit: 'view' | 'modify' };

function matrix(): Case[] {
  const cases: Case[] = [];
  for (const [ownLabel, own] of ENTRIES) {
    for (const [wildLabel, wild] of ENTRIES) {
      const objects: Record<string, unknown> = {};
      if (own !== undefined) objects.deal = own;
      if (wild !== undefined) objects['*'] = wild;
      for (const objectName of OBJECTS) {
        for (const bit of BITS) {
          cases.push({ label: `deal: ${ownLabel} · '*': ${wildLabel} · ask ${objectName} for ${bit}`, set: { objects }, objectName, bit });
        }
      }
    }
  }
  for (const set of [null, undefined, {}, { objects: null }, { objects: 'deal' }]) {
    for (const bit of BITS) cases.push({ label: `set ${JSON.stringify(set) ?? 'undefined'} · ${bit}`, set, objectName: 'deal', bit });
  }
  return cases;
}

const CASES = matrix();
type Reading = (set: never, objectName: string, bit: 'view' | 'modify') => boolean;
const ask = (fn: Reading, c: Case) => fn(c.set as never, c.objectName, c.bit);

describe('holdsSuperuserBypass — the lint copy and the runtime reading agree', () => {
  it('the matrix is the product it claims, and it exercises both answers', () => {
    // 10 own entries x 10 wildcard entries x 2 objects x 2 bits, plus 5 sets x 2 bits.
    expect(CASES).toHaveLength(410);
    const answers = CASES.map((c) => ask(runtimeReading as Reading, c));
    expect(answers.filter(Boolean).length).toBeGreaterThan(0);
    expect(answers.filter((a) => !a).length).toBeGreaterThan(0);
  });

  it('answers every case of the matrix alike', () => {
    const diverging = CASES.filter((c) => ask(authoringCopy as Reading, c) !== ask(runtimeReading as Reading, c)).map(
      (c) => `${c.label}: runtime ${ask(runtimeReading as Reading, c)}, lint ${ask(authoringCopy as Reading, c)}`,
    );
    expect(diverging).toEqual([]);
  });

  it('a few readings the rule depends on, spelled out', () => {
    for (const fn of [runtimeReading, authoringCopy] as Reading[]) {
      const read = (set: unknown, bit: 'view' | 'modify') => fn(set as never, 'deal', bit);
      // Modify All implies View All; View All never implies Modify All.
      expect(read({ objects: { deal: { modifyAllRecords: true } } }, 'view')).toBe(true);
      expect(read({ objects: { deal: { viewAllRecords: true } } }, 'modify')).toBe(false);
      // The wildcard answers for an object the set does not name ...
      expect(read({ objects: { '*': { modifyAllRecords: true } } }, 'modify')).toBe(true);
      // ... and an entry that names the object answers alone: a lookup, never a merge.
      expect(read({ objects: { '*': { modifyAllRecords: true }, deal: { allowRead: true } } }, 'modify')).toBe(false);
    }
  });
});
