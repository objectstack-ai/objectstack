/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A TRUE disjunct no longer hides a refused sibling — objectui#10789, item 4.
 *
 * ## What was wrong
 *
 * `lowerLogicalGroup` returned `undefined` (the TRUE identity, objectui#5322)
 * the moment an `$or` member lowered to nothing, so every member AFTER it was
 * never read. The refusal of a malformed member therefore depended on MEMBER
 * ORDER: `{ $or: [{ a: {} }, {}] }` was refused (objectui#9164), while
 * `{ $or: [{}, { a: {} }] }` answered TRUE — every row — for the same two
 * members. One authored filter, two fates, decided by the order the author
 * happened to write the disjuncts in.
 *
 * ## What the assertions are
 *
 * - §1 — both member orders are refused, on the ENVELOPE (`code`,
 *   `httpStatus`, the `field` subject), never on `toThrow()` alone.
 * - §2 — the absorption itself is unchanged: a TRUE disjunct beside members
 *   that lower still answers TRUE, in both orders.
 */

import { describe, it, expect } from 'vitest';
import { convertFiltersToAST, FilterOperatorError } from '../filter-converter';

function refusalOf(call: () => unknown): { thrown: unknown; returned: unknown } {
  try {
    return { thrown: undefined, returned: call() };
  } catch (error) {
    return { thrown: error, returned: undefined };
  }
}

describe('objectui#10789 — a refused `$or` member is refused in EITHER member order', () => {
  it.each([
    ['TRUE disjunct first', { $or: [{}, { a: {} }] }],
    ['TRUE disjunct last', { $or: [{ a: {} }, {}] }],
    ['TRUE-identity group first', { $or: [{ $and: [] }, { a: {} }] }],
  ])('%s — refused with the INVALID_FILTER envelope naming the field', (_label, filter) => {
    const { thrown, returned } = refusalOf(() => convertFiltersToAST(filter));
    expect(returned).toBeUndefined();
    expect(thrown).toBeInstanceOf(FilterOperatorError);
    const error = thrown as FilterOperatorError;
    expect(error.code).toBe('INVALID_FILTER');
    expect(error.httpStatus).toBe(400);
    expect(error.field).toBe('a');
  });

  it('a non-object member after a TRUE disjunct is refused too', () => {
    // The member-shape check sits in the same loop the early return cut short.
    const { thrown } = refusalOf(() => convertFiltersToAST({ $or: [{}, 5] as unknown[] }));
    expect(thrown).toBeInstanceOf(FilterOperatorError);
    expect((thrown as FilterOperatorError).code).toBe('INVALID_FILTER');
    expect((thrown as FilterOperatorError).operator).toBe('$or');
  });
});

describe('objectui#10789 — CONTROL: a TRUE disjunct still absorbs its `$or`', () => {
  it.each([
    ['TRUE disjunct first', { $or: [{}, { status: 'open' }] }],
    ['TRUE disjunct last', { $or: [{ status: 'open' }, {}] }],
  ])('%s — lowers to the TRUE identity', (_label, filter) => {
    expect(convertFiltersToAST(filter)).toBeUndefined();
  });
});
