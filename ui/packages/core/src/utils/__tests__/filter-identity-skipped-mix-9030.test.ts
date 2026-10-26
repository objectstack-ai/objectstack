/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The TRUE-identity fold counts only the keys the loop PROCESSED — objectui#9030.
 *
 * ## What was wrong
 *
 * `convertFiltersToAST` folds a filter that is nothing but TRUE-identity
 * combinators to `undefined` (objectui#8770), and folds a filter whose every key
 * the loop SKIPPED for a `null` / `undefined` value to `undefined` too
 * (objectui#9020). Each fold was keyed on its own count compared with
 * `Object.keys(filter).length`.
 *
 * But the loop's first statement skips the null/undefined keys without
 * incrementing anything the identity fold counts, while that denominator counted
 * them anyway. So a filter carrying one identity group beside one skipped key
 * read `1 === 2`, the fold declined, and the CALLER'S ORIGINAL OBJECT came back:
 *
 * ```
 * { $and: [] }                =>  undefined            folds
 * { b: undefined }            =>  undefined            folds
 * { $and: [], b: undefined }  =>  { $and: [], … }      did NOT fold
 * ```
 *
 * ⭐ Each key folds ALONE and the two together did not — behaviour decided by a
 * sibling, the hazard objectui#8555 named on this same function. Read the other
 * way round: adding an always-TRUE `$and: []` to a filter that folded could stop
 * it folding.
 *
 * ## Why BOTH skipped classes come along, and why that is not a new ruling
 *
 * The loop skips `null` and `undefined` with ONE statement, and objectui#9020
 * already ruled what that skip means when it is all that is left: the key
 * contributes no condition, so the filter constrains nothing and says so. That
 * ruling is what this card carries into the mixed case; it does not re-decide
 * it, and it does not touch the skip — `{ a: null, s: 1 }` still lowers to
 * `['s', '=', 1]`, pinned in the controls below.
 *
 * ⚠️ The card that filed this proposed admitting `undefined` while keeping
 * `null` out, on the reasoning that a null-valued key rides the `$expand` route
 * as a real `a IS NULL` predicate. That reasoning was measured before
 * objectui#9020 landed and no longer holds: `{ a: null }` no longer reaches
 * either route as a predicate. Keeping `null` out would ALSO have meant reading
 * the two spellings apart for the first time anywhere in this file, and would
 * have left `{ $and: [], a: null }` as the one member of the family that still
 * 400s on the plain route — the very defect objectui#8770 exists to end. The
 * two-route measurement is in
 * `filter-identity-skipped-mix-two-routes-9030.test.ts`.
 *
 * ## Why the assertions are shaped the way they are
 *
 * Two halves, the shape taken from objectui#8770's own file, because either
 * alone passes on something worse than the bug:
 *
 *   - a SHAPE assertion (`toBeUndefined`) alone passes on a converter that has
 *     stopped emitting anything at all;
 *   - a ROW-SET assertion alone cannot tell "honoured" from "dropped" — a filter
 *     whose ruled answer is every row and an absent filter select the same rows.
 *
 * So §0 proves the fixture distinguishes every-row from a real subset before any
 * of it is read that way, the shape half is asserted against the spec's own door
 * (`isFilterAST`) rather than a literal, and the FALSE identity `{ $or: [] }` is
 * carried as a control that must keep selecting NO rows.
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

/**
 * The census, enumerated rather than exemplified — a repair aimed at the card's
 * one literal would be re-touched immediately.
 *
 * The family is stated as a rule, not a list: a filter that produces NO
 * condition and whose every key was either a TRUE-identity group or a key the
 * loop skipped. The rows below walk that rule's degrees of freedom — which
 * identity spelling, which skipped spelling, key ORDER, more than one of each,
 * and an identity group that only becomes one because ITS child folded.
 */
const MIXED_FAMILY: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['{ $and: [], b: undefined }', { $and: [], b: undefined }],
  ['{ $and: [], a: null }', { $and: [], a: null }],
  ['{ $or: [{}], b: undefined }', { $or: [{}], b: undefined }],
  ['{ $and: [{}], a: null }', { $and: [{}], a: null }],
  ['{ b: undefined, $and: [] }', { b: undefined, $and: [] }],
  [
    '{ $and: [], $or: [{}], a: null, b: undefined }',
    { $and: [], $or: [{}], a: null, b: undefined },
  ],
  ['{ $and: [{ a: null }], b: undefined }', { $and: [{ a: null }], b: undefined }],
];

// ---------------------------------------------------------------------------
// 0. The harness has to be able to fail
// ---------------------------------------------------------------------------

describe('objectui#9030 — harness', () => {
  it('every row, the `a = null` subset and a real predicate are three answers here', async () => {
    expect(await selectedIds(undefined)).toEqual(ALL_IDS);
    // The predicate the object became on one route. It is NOT "every row".
    expect(await selectedIds({ a: null })).toEqual(['2']);
    // A filter that really constrains lands strictly between the two, so "every
    // row" below is a measurement and not this fixture's only answer.
    expect(await selectedIds(['s', '=', 1])).toEqual(['1', '2']);
  });
});

// ---------------------------------------------------------------------------
// 1. The family folds
// ---------------------------------------------------------------------------

describe('objectui#9030 — an identity group beside a skipped key folds', () => {
  it.each(MIXED_FAMILY)('%s lowers to "no constraint"', (_label, filter) => {
    expect(convertFiltersToAST(filter)).toBeUndefined();
  });

  it.each(MIXED_FAMILY)('%s is no longer the caller\'s own object', (_label, filter) => {
    // Stated as identity rather than shape: what came back WAS the input, so a
    // caller could not tell "lowered" from "handed back untouched".
    expect(convertFiltersToAST(filter)).not.toBe(filter);
  });

  it('nothing unreadable is handed back', () => {
    // The property objectui#8770 and objectui#9020 each stated for their own
    // member: a value this function returns is either `undefined` — no filter —
    // or something the spec's own door accepts. A plain object is neither.
    for (const [, filter] of MIXED_FAMILY) {
      const out = convertFiltersToAST(filter);
      expect(out === undefined || isFilterAST(out)).toBe(true);
    }
  });

  it('⭐ the property the counting broke — each key alone, and the two together', () => {
    // The defect in one assertion, and the reason this is a counting fix rather
    // than a new member: both halves already folded, so their conjunction had
    // no third answer available to it.
    expect(convertFiltersToAST({ $and: [] })).toBeUndefined();
    expect(convertFiltersToAST({ b: undefined })).toBeUndefined();
    expect(convertFiltersToAST({ $and: [], b: undefined })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. The sinks
// ---------------------------------------------------------------------------

describe('objectui#9030 — the sinks', () => {
  it.each(MIXED_FAMILY)('%s is skipped outright by `toFilterNode`', (_label, filter) => {
    expect(toFilterNode(filter)).toBeUndefined();
  });

  it.each(MIXED_FAMILY)('%s contributes nothing to the merged `and`', async (_label, filter) => {
    // What `plugin-list`'s `buildEffectiveFilter` and `plugin-view`'s
    // `ObjectView` build. Before the fix the object landed in AST CHILD
    // position — `['and', { $and: [] }, ['s', '=', 1]]` — which `isFilterAST`
    // refuses, so a list whose filter narrowed nothing failed to load outright.
    const merged = mergeFilterNodes(filter, ['s', '=', 1]);
    expect(merged).toEqual(['s', '=', 1]);
    expect(isFilterAST(merged)).toBe(true);
    expect(await selectedIds(merged)).toEqual(['1', '2']);
  });

  it.each(MIXED_FAMILY)('%s selects EVERY row through a real matcher', async (_label, filter) => {
    expect(await selectedIds(toFilterNode(filter))).toEqual(ALL_IDS);
  });
});

// ---------------------------------------------------------------------------
// 3. Controls — everything that must NOT have moved
// ---------------------------------------------------------------------------

describe('objectui#9030 — controls', () => {
  it('⭐ the skip pin itself is untouched', async () => {
    // ⛔ The one repair this card was forbidden: making a null-valued key
    // meaningful. If this reddens, every caller's row set moved.
    const node = convertFiltersToAST({ a: null, s: 1 });
    expect(node).toEqual(['s', '=', 1]);
    expect(await selectedIds(node)).toEqual(['1', '2']);
  });

  it('⭐ a plain filter lowers to exactly the AST it always did', async () => {
    expect(convertFiltersToAST({ a: 'x' })).toEqual(['a', '=', 'x']);
    expect(convertFiltersToAST({ a: { $null: true } })).toEqual(['a', 'is_null', true]);
    expect(convertFiltersToAST({ a: 'x', s: 1 })).toEqual([
      'and',
      ['a', '=', 'x'],
      ['s', '=', 1],
    ]);
    expect(await selectedIds(convertFiltersToAST({ a: 'x' }))).toEqual(['1']);
  });

  it('⭐ an identity group beside a key that DOES lower still lets the sibling carry it', async () => {
    // The fold must not start swallowing a live sibling now that its
    // denominator is smaller.
    const node = convertFiltersToAST({ $and: [], a: 'x' });
    expect(node).toEqual(['a', '=', 'x']);
    expect(await selectedIds(node)).toEqual(['1']);
  });

  it('⭐ the FALSE identity `{ $or: [] }` still selects NO row', async () => {
    // FALSE is not "no constraint", and the AST has no contradiction literal, so
    // the pre-existing leaf is still the emission. A fold that swept the
    // identities together would take this control with it.
    const node = convertFiltersToAST({ $or: [] });
    expect(node).toEqual(['$or', '=', []]);
    expect(await selectedIds(node)).toEqual([]);
    // …and it survives a skipped key and a TRUE identity beside it.
    expect(convertFiltersToAST({ $or: [], a: null })).toEqual(['$or', '=', []]);
    expect(convertFiltersToAST({ $and: [], $or: [] })).toEqual(['$or', '=', []]);
  });

  it('⛔ an empty operator map is not a member — refused since objectui#9164', () => {
    // NOT a member. Its key was PROCESSED — the loop entered it and the operator
    // loop ran zero times — so it is counted in the denominator and no fold
    // claims it. objectui#8770 measured this boundary and this card does not
    // move it.
    //
    // ⚠️ UPDATED. This used to pin the original object coming back; since
    // objectui#9164 it is refused (envelope pinned in
    // filter-empty-operator-map-9164.test.ts).
    expect(() => convertFiltersToAST({ a: {} })).toThrow(FilterOperatorError);
  });

  it('⛔ an empty operator map beside a SKIPPED key is not folded', () => {
    // ⭐ The sharpest boundary case, and the one that says what "processed"
    // means: subtracting the skipped key leaves one processed key that produced
    // no condition and is not an identity group, so neither fold fires. A repair
    // that had folded on "no conditions were produced" instead would swallow
    // this.
    //
    // ⚠️ UPDATED. These used to pin the original object coming back; since
    // objectui#9164 they are refused (envelope pinned in
    // filter-empty-operator-map-9164.test.ts). A fold would answer `undefined`
    // rather than throw, so the fence still holds.
    expect(() => convertFiltersToAST({ a: {}, b: undefined })).toThrow(FilterOperatorError);
    expect(() => convertFiltersToAST({ $and: [], a: {} })).toThrow(FilterOperatorError);
  });

  it('⛔ an empty filter still returns the original object', () => {
    // `trueIdentityGroups > 0` and `skippedNullKeys > 0` both exclude it: there
    // is no key of either kind. `toFilterNode` already folds `{}` one level up.
    expect(convertFiltersToAST({})).toEqual({});
  });

  it('⭐ objectui#8770 and objectui#9020 keep their own answers', () => {
    // The two pure members, restated where a reader of this file will see them:
    // this card widened the denominator of one arm, it did not merge the arms.
    expect(convertFiltersToAST({ $and: [] })).toBeUndefined();
    expect(convertFiltersToAST({ $or: [{}] })).toBeUndefined();
    expect(convertFiltersToAST({ $and: [{}] })).toBeUndefined();
    expect(convertFiltersToAST({ a: null })).toBeUndefined();
    expect(convertFiltersToAST({ b: undefined })).toBeUndefined();
    expect(convertFiltersToAST({ a: null, b: undefined })).toBeUndefined();
  });
});
