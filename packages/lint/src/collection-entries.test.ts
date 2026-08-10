// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The shared stack-collection enumeration (#6662).
 *
 * Three rules had their own copy of this helper — `validate-form-layout`,
 * `validate-translatable-sections`, `validate-visibility-predicates` — and two
 * of the three were byte-identical while the third open-coded its record
 * predicate inline. This file pins the behaviour ONCE, where it now lives, and
 * then asserts the property the convergence buys: all three consumers report
 * the same paths for the same collection.
 */

import { describe, expect, it } from 'vitest';

import { collectionEntries } from './collection-entries.js';
import { validateFormLayout } from './validate-form-layout.js';
import { validateTranslatableSections } from './validate-translatable-sections.js';
import { validateVisibilityPredicates } from './validate-visibility-predicates.js';

type AnyRec = Record<string, unknown>;

describe('collectionEntries — the array shape', () => {
  it('yields each record at its index path', () => {
    const a = { name: 'a' };
    const b = { name: 'b' };
    expect(collectionEntries([a, b], 'views')).toEqual([
      { rec: a, path: 'views[0]' },
      { rec: b, path: 'views[1]' },
    ]);
  });

  it('hands back the caller’s own record, not a copy', () => {
    // Consumers mutate nothing, but they DO compare identity against the sites
    // `view-walk.ts` yields, so a defensive copy here would break that.
    const rec = { name: 'a' };
    expect(collectionEntries([rec], 'views')[0].rec).toBe(rec);
  });

  it('skips non-records but keeps the index of the records it keeps', () => {
    // The index is the AUTHORED position, so a skipped entry must not shift the
    // ones after it — the path has to be one the author can look up.
    const rec = { name: 'real' };
    expect(collectionEntries([null, 'str', 42, rec], 'views')).toEqual([
      { rec, path: 'views[3]' },
    ]);
  });

  it('skips a NESTED array — an array is not a record', () => {
    expect(collectionEntries([[{ name: 'a' }]], 'views')).toEqual([]);
  });
});

describe('collectionEntries — the name-keyed map shape', () => {
  it('yields each record at its key path, with the key spread in as `name`', () => {
    // The map key IS the entry's name on this shape. Reporting `views[0]` for
    // it would name a position that does not exist in the author's file.
    expect(collectionEntries({ case_views: { object: 'crm_case' } }, 'views')).toEqual([
      { rec: { name: 'case_views', object: 'crm_case' }, path: 'views.case_views' },
    ]);
  });

  it('lets an entry’s OWN `name` win over the map key', () => {
    // `{ name, ...def }` — key first, so the spread overwrites it.
    expect(collectionEntries({ keyed: { name: 'declared' } }, 'views')[0].rec).toEqual({
      name: 'declared',
    });
  });

  it('skips non-record values', () => {
    const entries = collectionEntries({ a: null, b: 'str', c: 42, d: [], e: { ok: true } }, 'views');
    expect(entries).toEqual([{ rec: { name: 'e', ok: true }, path: 'views.e' }]);
  });
});

describe('collectionEntries — what is not a collection', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'views'],
    ['a number', 42],
    ['a boolean', true],
  ])('returns nothing for %s', (_label, v) => {
    expect(collectionEntries(v, 'views')).toEqual([]);
  });

  it('returns nothing for an empty collection of either shape', () => {
    expect(collectionEntries([], 'views')).toEqual([]);
    expect(collectionEntries({}, 'views')).toEqual([]);
  });
});

/**
 * The one textual divergence between the copies this file converged (#6662).
 *
 * `validate-visibility-predicates` open-coded its record predicate inline, and
 * its MAP-branch guard read `v && typeof v === 'object'` with no
 * `!Array.isArray(v)` — where the other two copies called `isRec`, which has
 * that third clause. The two are the same function because the ARRAY branch
 * returns unconditionally, so the map guard is only ever evaluated on a value
 * that is already not an array. This asserts that domination directly: an array
 * must never be enumerated as a map, however it is decorated.
 */
describe('collectionEntries — an array is never enumerated as a map', () => {
  it('reads only index entries, never an array’s other own keys', () => {
    const arr: unknown[] & { extra?: AnyRec } = [{ name: 'indexed' }];
    arr.extra = { name: 'not_an_entry' };

    expect(collectionEntries(arr, 'views')).toEqual([
      { rec: { name: 'indexed' }, path: 'views[0]' },
    ]);
  });

  it('yields index paths for an empty-but-decorated array, not key paths', () => {
    const arr: unknown[] & { case_views?: AnyRec } = [];
    arr.case_views = { object: 'crm_case' };

    expect(collectionEntries(arr, 'views')).toEqual([]);
  });
});

/**
 * The property the convergence buys: ONE coercion, THREE consumers.
 *
 * Before #6662 each of these rules decided on its own what path to print for a
 * map-shaped collection. Break the coercion now and all three columns go red
 * together, which is the whole point — the failure this class of duplication
 * produces is the next author fixing one copy and leaving two behind (#6381's
 * own history: #6128 / #6248, then #6251).
 */
describe('one coercion, three consumers (#6662)', () => {
  const objects = [{ name: 'crm_case', fields: { subject: {}, status: {} } }];
  const translations = [{ 'zh-CN': { objects: { crm_case: { label: '个案' } } } }];

  /** A form body that trips all three rules at once, at one site. */
  const body = () => ({
    sections: [
      {
        label: 'Basics', //                        → translatable-sections
        fields: [
          'ghost_field', //                        → form-layout (unknown field)
          { field: 'subject', visibleWhen: 'status == "open"' }, // → visibility
        ],
      },
    ],
  });

  const view = () => ({ object: 'crm_case', ...body() });

  it('all three report the ARRAY path for an array-shaped `views`', () => {
    const stack = { objects, views: [view()], translations };

    expect(validateVisibilityPredicates(stack).map((f) => f.path)).toEqual([
      'views[0].sections[0].fields[1]',
    ]);
    expect(validateFormLayout(stack).map((f) => f.path)).toEqual([
      'views[0].sections[0].fields[0]',
    ]);
    expect(validateTranslatableSections(stack).map((f) => f.path)).toEqual([
      'views[0].sections[0]',
    ]);
  });

  it('all three report the KEY path for a map-shaped `views`', () => {
    const stack = { objects, views: { case_views: view() }, translations };

    expect(validateVisibilityPredicates(stack).map((f) => f.path)).toEqual([
      'views.case_views.sections[0].fields[1]',
    ]);
    expect(validateFormLayout(stack).map((f) => f.path)).toEqual([
      'views.case_views.sections[0].fields[0]',
    ]);
    expect(validateTranslatableSections(stack).map((f) => f.path)).toEqual([
      'views.case_views.sections[0]',
    ]);
  });

  it('all three take the map KEY as the entry’s name in the `where` line', () => {
    // The unnamed-but-keyed entry: nothing declares `name`, so the key is the
    // only thing that can locate it for the author.
    const stack = { objects, views: { case_views: view() }, translations };

    expect(validateVisibilityPredicates(stack)[0].where).toContain('case_views');
    expect(validateFormLayout(stack)[0].where).toContain('case_views');
    expect(validateTranslatableSections(stack)[0].where).toContain('case_views');
  });
});
