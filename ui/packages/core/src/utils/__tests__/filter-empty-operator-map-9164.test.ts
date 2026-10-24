/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An empty operator map that is all a filter says is REFUSED — objectui#9164.
 *
 * ## What was wrong
 *
 * `{ a: {} }` names a field and no operator. The loop enters the key and the
 * operator loop runs zero times, so when nothing else produced a condition the
 * general tail handed back the CALLER'S ORIGINAL OBJECT — the one input left in
 * that tail after objectui#8770, objectui#9020 and objectui#9030 each removed
 * their own member. The adapter then sent it as `?a=[object Object]` on the
 * plain route and as `filter={"a":{}}`, a shape `@objectstack/spec` ruled
 * REJECTED (objectstack#5240), on the `$expand` / `$search` route.
 *
 * ## What the assertions are
 *
 * - §1 — the three ruled inputs are refused, asserted on the ENVELOPE (`code`,
 *   `httpStatus`, the `field` subject) rather than on `toThrow()` alone, which
 *   a bare `Error` would also satisfy. The message is not pinned: nothing
 *   parses it.
 * - §2 — the refusal reaches `toFilterNodeSafely` as a VALUE, which is how the
 *   render-time callers turn it into the named malformed-filter state.
 * - §3 — the two controls the ruling names keep their answers: `{}` (no
 *   filter) and `{ a: 'x' }` (an AST).
 * - §4 — a consequence of refusing in the shared tail: a combinator child that
 *   is an empty operator map is refused too, instead of being read as the TRUE
 *   identity (which widened an `$or` to every row).
 *
 * The boundary objectui#9164 did NOT move — an empty operator map BESIDE a key
 * that lowers was still dropped — was pinned where it was ruled:
 * filter-date-comparand-8555.test.ts and filter-exotic-comparand-8567.test.ts.
 *
 * ⚠️ UPDATED by objectui#10788: that boundary is now refused too, and the
 * refusal moved from the tail into the operator-map arm, so one throw site
 * answers both cases. The three inputs above keep the envelope asserted here;
 * the beside-a-key case is pinned in
 * filter-empty-operator-map-beside-key-10788.test.ts, and both boundary rows
 * above now pin the refusal.
 */

import { describe, it, expect } from 'vitest';
import { isFilterAST } from '@objectstack/spec/data';
import {
  convertFiltersToAST,
  toFilterNode,
  toFilterNodeSafely,
  filterRefusalSubject,
  FilterOperatorError,
} from '../filter-converter';

function refusalOf(call: () => unknown): { thrown: unknown; returned: unknown } {
  try {
    return { thrown: undefined, returned: call() };
  } catch (error) {
    return { thrown: error, returned: undefined };
  }
}

/** The three inputs the ruling names, each an empty operator map on field `a`. */
const REFUSED: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['{ a: {} }', { a: {} }],
  ['{ a: {}, b: undefined }', { a: {}, b: undefined }],
  ['{ $and: [], a: {} }', { $and: [], a: {} }],
];

// ---------------------------------------------------------------------------
// 1. The refusal
// ---------------------------------------------------------------------------

describe('objectui#9164 — an empty operator map that is all the filter says is refused', () => {
  it.each(REFUSED)('%s is refused with the INVALID_FILTER envelope naming the field', (_label, filter) => {
    const { thrown, returned } = refusalOf(() => convertFiltersToAST(filter));
    expect(returned).toBeUndefined();
    expect(thrown).toBeInstanceOf(FilterOperatorError);
    const error = thrown as FilterOperatorError;
    expect(error.code).toBe('INVALID_FILTER');
    expect(error.httpStatus).toBe(400);
    expect(error.field).toBe('a');
    // The author wrote no operator, so none is named.
    expect(error.operator).toBeUndefined();
    expect(filterRefusalSubject(error)).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// 2. The safe entry turns it into a value
// ---------------------------------------------------------------------------

describe('objectui#9164 — toFilterNodeSafely carries the refusal as a value', () => {
  it('{ a: {} } is { ok: false } with the same refusal, never a throw', () => {
    const result = toFilterNodeSafely({ a: {} });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toBeInstanceOf(FilterOperatorError);
    expect(result.refusal.code).toBe('INVALID_FILTER');
    expect(filterRefusalSubject(result.refusal)).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// 3. The controls the ruling names
// ---------------------------------------------------------------------------

describe('objectui#9164 — the controls keep their answers', () => {
  it('{} (no filter) is unchanged: the object here, no filter one level up', () => {
    expect(convertFiltersToAST({})).toEqual({});
    expect(toFilterNode({})).toBeUndefined();
  });

  it("{ a: 'x' } still lowers to an AST", () => {
    const node = convertFiltersToAST({ a: 'x' });
    expect(node).toEqual(['a', '=', 'x']);
    expect(isFilterAST(node)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. A combinator child that is an empty operator map
// ---------------------------------------------------------------------------

describe('objectui#9164 — a combinator child that is an empty operator map is refused', () => {
  it.each([
    ['{ $or: [{ a: {} }, { b: 2 }] }', { $or: [{ a: {} }, { b: 2 }] }],
    ['{ $and: [{ a: {} }] }', { $and: [{ a: {} }] }],
  ])('%s is refused rather than read as the TRUE identity', (_label, filter) => {
    // The child used to come back as its own object, which `lowerLogicalGroup`
    // reads as a TRUE disjunct — so the `$or` above lowered to `undefined`,
    // every row, and the `$and` dropped its only conjunct.
    const { thrown } = refusalOf(() => convertFiltersToAST(filter));
    expect(thrown).toBeInstanceOf(FilterOperatorError);
    expect((thrown as FilterOperatorError).code).toBe('INVALID_FILTER');
    expect((thrown as FilterOperatorError).field).toBe('a');
  });
});
