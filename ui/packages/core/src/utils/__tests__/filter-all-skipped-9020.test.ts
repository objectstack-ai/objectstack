/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An all-skipped filter constrains nothing, and says so — objectui#9020.
 *
 * ## What was wrong
 *
 * `convertFiltersToAST` skips a key whose value is `null` / `undefined`. That is
 * long-standing, pinned, and NOT what this card changed — the first control
 * below is that pin, restated where a reader of this file will see it. What
 * changed is the answer when the skip leaves nothing behind: the general tail
 * used to hand back the CALLER'S ORIGINAL OBJECT, which is neither an AST node
 * nor "no filter", and the two `find()` routes of `@object-ui/data-objectstack`
 * read it as two different questions. That two-route disagreement is measured in
 * `packages/data-objectstack/src/filter-all-skipped-two-routes-9020.test.ts`;
 * this file pins the converter and the two sinks that sit on top of it.
 *
 * ## Why `undefined` and not something else
 *
 * There is no other spelling. This dialect expresses "no constraint" as the
 * ABSENCE of the slot — `lowerLogicalGroup` says so for the TRUE identity, and
 * `['and']` (the "obvious" empty group) is `isFilterAST` FALSE. The two
 * candidate repairs were: make a null-valued key mean a predicate (which breaks
 * the skip pin and moves every caller's row set), or carry the skip's own
 * answer to the wire. The second is this card. An author who MEANT the
 * predicate has always been able to spell it `{ a: { $null: true } }`, and the
 * last case here pins that they still can.
 *
 * ⚠️ The same answer as objectui#8770's fold, deliberately NOT the same state.
 * That fold is objectstack#5322's ruled TRUE identity; this is this file's own
 * tolerance made self-consistent. They are counted apart in the tail, and the
 * boundary section below is what proves they were not merged.
 */

import { describe, it, expect } from 'vitest';
import { isFilterAST } from '@objectstack/spec/data';
import { convertFiltersToAST, toFilterNode, mergeFilterNodes, FilterOperatorError } from '../filter-converter';
import { ValueDataSource } from '../../adapters/ValueDataSource';

const ROWS = [
  { id: '1', a: 'x', s: 1 },
  { id: '2', a: null, s: 1 },
  { id: '3', a: 'y', s: 2 },
  { id: '4', a: 'z', s: 2 },
];
const ALL_IDS = ['1', '2', '3', '4'];

async function selectedIds(filter: unknown): Promise<string[]> {
  const ds = new ValueDataSource({ items: ROWS as never });
  const result = await ds.find('rows', (filter === undefined ? {} : { $filter: filter }) as never);
  return (result.data as Array<{ id: string }>).map((r) => String(r.id));
}

const ALL_SKIPPED: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['{ a: null }', { a: null }],
  ['{ b: undefined }', { b: undefined }],
  ['{ a: null, b: undefined }', { a: null, b: undefined }],
];

describe('objectui#9020 — harness', () => {
  it('every row and the `a = null` subset are distinguishable answers here', async () => {
    expect(await selectedIds(undefined)).toEqual(ALL_IDS);
    // The predicate the object used to become one route further along.
    expect(await selectedIds({ a: null })).toEqual(['2']);
  });
});

describe('objectui#9020 — the converter', () => {
  it.each(ALL_SKIPPED)('%s lowers to "no constraint"', (_label, filter) => {
    expect(convertFiltersToAST(filter)).toBeUndefined();
  });

  it.each(ALL_SKIPPED)('%s is no longer the caller\'s own object', (_label, filter) => {
    // The property the tail broke, stated as identity rather than shape: what
    // came back WAS the input, so a caller could not tell "lowered" from
    // "handed back untouched" — and the two wire routes did not tell it either.
    expect(convertFiltersToAST(filter)).not.toBe(filter);
  });

  it('nothing unreadable is handed back', () => {
    // The same property objectui#8770 stated for the combinators: a value this
    // function returns is either `undefined` — no filter — or something the
    // spec's own door accepts. A plain object is neither.
    for (const [, filter] of ALL_SKIPPED) {
      const out = convertFiltersToAST(filter);
      expect(out === undefined || isFilterAST(out)).toBe(true);
    }
  });
});

describe('objectui#9020 — the sinks', () => {
  it.each(ALL_SKIPPED)('%s contributes nothing to the merged `and`', async (_label, filter) => {
    // What `plugin-list`'s `buildEffectiveFilter` and `plugin-view`'s ObjectView
    // build. Before the fix the object landed in AST CHILD position —
    // `['and', { a: null }, ['s', '=', 1]]` — which `isFilterAST` refuses, so a
    // list whose filter narrowed nothing failed to load outright.
    const merged = mergeFilterNodes(filter, ['s', '=', 1]);
    expect(merged).toEqual(['s', '=', 1]);
    expect(isFilterAST(merged)).toBe(true);
    expect(await selectedIds(merged)).toEqual(['1', '2']);
  });

  it.each(ALL_SKIPPED)('%s is skipped outright by `toFilterNode`', (_label, filter) => {
    expect(toFilterNode(filter)).toBeUndefined();
  });

  it.each(ALL_SKIPPED)('%s selects EVERY row through a real matcher', async (_label, filter) => {
    expect(await selectedIds(toFilterNode(filter))).toEqual(ALL_IDS);
  });
});

describe('objectui#9020 — controls', () => {
  it('⭐ the skip pin itself is untouched', async () => {
    // ⛔ The one repair this card was forbidden: making a null-valued key
    // meaningful. If this reddens, every caller's row set moved.
    const node = convertFiltersToAST({ a: null, s: 1 });
    expect(node).toEqual(['s', '=', 1]);
    expect(await selectedIds(node)).toEqual(['1', '2']);
  });

  it('⭐ objectui#8770\'s TRUE identity keeps its own answer', () => {
    expect(convertFiltersToAST({ $and: [] })).toBeUndefined();
    expect(convertFiltersToAST({ $or: [{}] })).toBeUndefined();
    expect(convertFiltersToAST({ $and: [{}] })).toBeUndefined();
  });

  it('⭐ the FALSE identity `{ $or: [] }` still selects NO row', async () => {
    const node = convertFiltersToAST({ $or: [] });
    expect(node).toEqual(['$or', '=', []]);
    expect(await selectedIds(node)).toEqual([]);
  });

  it('an empty operator map is claimed by neither guard — refused since objectui#9164', () => {
    // A third "no condition was produced" shape, and NOT this card's: no key was
    // skipped, so neither guard fires. objectui#8770 measured this boundary and
    // objectui#9020 did not move it.
    //
    // ⚠️ UPDATED. This used to pin the original object coming back. objectui#9164
    // refuses it instead; the envelope is pinned in
    // filter-empty-operator-map-9164.test.ts. It is still NOT folded, which is
    // what this case is here to say.
    expect(() => convertFiltersToAST({ a: {} })).toThrow(FilterOperatorError);
  });

  it('an empty filter still returns the original object', () => {
    // `skippedNullKeys > 0` excludes it: there is no key to skip. `toFilterNode`
    // already folds `{}` one level up, so nothing downstream sees this.
    expect(convertFiltersToAST({})).toEqual({});
  });

  it('an author who MEANT `a IS NULL` still gets it', async () => {
    const node = convertFiltersToAST({ a: { $null: true } });
    expect(node).toEqual(['a', 'is_null', true]);
    expect(await selectedIds(node)).toEqual(['2']);
  });
});

describe('objectui#9020 — the boundary that proves the two folds were told apart', () => {
  it.each([
    ['{ $and: [], a: null }', { $and: [], a: null }],
    ['{ $and: [], b: undefined }', { $and: [], b: undefined }],
  ])('%s folds — answered by objectui#9030, not by a merged counter', (_label, filter) => {
    // ⚠️ UPDATED. These used to pin the object coming back: each guard was keyed
    // on "EVERY key was of MY kind", so one identity group beside one skipped
    // key satisfied neither — even though each key ALONE folds.
    //
    // objectui#9030 answered it, and NOT by merging the counters. The identity
    // fold's denominator became the count of keys the loop actually PROCESSED,
    // which is every key minus the ones its own first statement skipped; this
    // card's guard still has its own count and its own arm. The control for
    // "not merged" is the case below, where a PROCESSED key produced no
    // condition and neither arm fires.
    expect(convertFiltersToAST(filter)).toBeUndefined();
  });

  it('⭐ a PROCESSED key that produced nothing still satisfies neither guard', () => {
    // Where the arms are still told apart. `{ a: {} }` is entered by the loop
    // and pushes no condition; it is neither an identity group nor a skipped
    // key, so it stays in the denominator and no fold claims it. A repair
    // that had keyed the fold on "no conditions were produced" would swallow
    // these — which is the accidental merge this card was fenced against.
    //
    // ⚠️ UPDATED. These used to pin the original object coming back; since
    // objectui#9164 they are refused (envelope pinned in
    // filter-empty-operator-map-9164.test.ts). A merged fold would answer
    // `undefined` instead of throwing, so the fence still holds.
    expect(() => convertFiltersToAST({ a: {}, b: undefined })).toThrow(FilterOperatorError);
    expect(() => convertFiltersToAST({ $and: [], a: {} })).toThrow(FilterOperatorError);
  });

  it('a nested all-skipped child was already handled and is unchanged', async () => {
    // `lowerLogicalGroup` tests `Array.isArray(lowered)`, so it read the old
    // object and the new `undefined` the same way from the day objectui#8770
    // wrote that test. Pinned so a later reader does not "simplify" it back to a
    // comparison against one spelling.
    expect(convertFiltersToAST({ $and: [{ a: null }] })).toBeUndefined();
    expect(convertFiltersToAST({ $or: [{ a: null }] })).toBeUndefined();
    const node = convertFiltersToAST({ $and: [{ a: null }, { s: 1 }] });
    expect(node).toEqual(['and', ['s', '=', 1]]);
    expect(await selectedIds(node)).toEqual(['1', '2']);
  });
});
