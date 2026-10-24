/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An empty operator map BESIDE a key that lowers is REFUSED — objectui#10788.
 *
 * ## What was wrong
 *
 * `{ status: 'a', created: {} }` names `created` and no operator. The loop
 * enters the key and the operator loop runs zero times, so no condition is
 * pushed for `created`. objectui#9164 refused that map in the general tail —
 * but the tail is entered only when NOTHING produced a condition, and here
 * `status` did. So the converter returned `['status', '=', 'a']`: the
 * `created` constraint vanished, the result was WIDER than the author wrote,
 * and both `find()` routes of `@object-ui/data-objectstack` sent a request
 * byte-identical to the control `{ status: 'a' }` (measured on the base; the
 * route pins are in that package's
 * `filter-empty-operator-map-beside-key-two-routes-10788.test.ts`).
 *
 * `@objectstack/spec` records `{ field: {} }` as REJECTED by objectstack#5240
 * (`FilterConditionSchema`), in every position. objectui#8555 and
 * objectui#8567 had pinned the drop as a boundary; both rows are flipped on
 * purpose, with notes.
 *
 * ## What the assertions are
 *
 * - §1 — the card's input and its neighbours are refused, asserted on the
 *   ENVELOPE (`code`, `httpStatus`, the `field` subject, no `operator`) rather
 *   than on `toThrow()` alone. The message is not pinned: nothing parses it.
 * - §2 — the refusal reaches `toFilterNodeSafely` as a VALUE naming the field.
 * - §3 — ONE refusal answers the alone case (objectui#9164) and the beside
 *   case: the two errors are compared with each other, so a second, drifting
 *   throw site would show here without any wording being pinned.
 * - §4 — the controls: `{ status: 'a' }` (the card's), a real operator beside
 *   the key, a skipped `null` beside the key, and `{}`.
 */

import { describe, it, expect } from 'vitest';
import { isFilterAST } from '@objectstack/spec/data';
import {
  convertFiltersToAST,
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

function expectEmptyMapRefusal(call: () => unknown, field: string): FilterOperatorError {
  const { thrown, returned } = refusalOf(call);
  expect(returned).toBeUndefined();
  expect(thrown).toBeInstanceOf(FilterOperatorError);
  const error = thrown as FilterOperatorError;
  expect(error.code).toBe('INVALID_FILTER');
  expect(error.httpStatus).toBe(400);
  expect(error.field).toBe(field);
  // The author wrote no operator, so none is named.
  expect(error.operator).toBeUndefined();
  expect(filterRefusalSubject(error)).toBe(field);
  return error;
}

const D = new Date('2026-01-01T00:00:00.000Z');

// ---------------------------------------------------------------------------
// 1. The refusal
// ---------------------------------------------------------------------------

describe('objectui#10788 — an empty operator map beside a key that lowers is refused', () => {
  it("{ status: 'a', created: {} } is refused naming 'created', not lowered to ['status', '=', 'a']", () => {
    expectEmptyMapRefusal(() => convertFiltersToAST({ status: 'a', created: {} }), 'created');
  });

  it.each([
    ["key order reversed: { created: {}, status: 'a' }", { created: {}, status: 'a' }],
    ["beside an operator: { status: { $in: ['a', 'b'] }, created: {} }", { status: { $in: ['a', 'b'] }, created: {} }],
    ['beside a Date comparand: { updated: D, created: {} }', { updated: D, created: {} }],
    ['beside two keys: { a: 1, b: 2, created: {} }', { a: 1, b: 2, created: {} }],
    ['beside a group that lowers: { $or: [{ a: 1 }], created: {} }', { $or: [{ a: 1 }], created: {} }],
  ])('%s', (_label, filter) => {
    expectEmptyMapRefusal(() => convertFiltersToAST(filter as Record<string, unknown>), 'created');
  });

  it.each([
    ["{ $and: [{ status: 'a', created: {} }] }", { $and: [{ status: 'a', created: {} }] }],
    ["{ $or: [{ b: 2 }, { status: 'a', created: {} }] }", { $or: [{ b: 2 }, { status: 'a', created: {} }] }],
  ])('inside a combinator member, beside a key: %s', (_label, filter) => {
    // A member is converted by the same function, so the same arm answers it.
    expectEmptyMapRefusal(() => convertFiltersToAST(filter as Record<string, unknown>), 'created');
  });
});

// ---------------------------------------------------------------------------
// 2. The safe entry turns it into a value
// ---------------------------------------------------------------------------

describe('objectui#10788 — toFilterNodeSafely carries the refusal as a value', () => {
  it("{ status: 'a', created: {} } is { ok: false } naming 'created', never a throw", () => {
    const result = toFilterNodeSafely({ status: 'a', created: {} });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toBeInstanceOf(FilterOperatorError);
    expect(result.refusal.code).toBe('INVALID_FILTER');
    expect(filterRefusalSubject(result.refusal)).toBe('created');
  });
});

// ---------------------------------------------------------------------------
// 3. One refusal for both cases
// ---------------------------------------------------------------------------

describe('objectui#10788 — the alone case and the beside case are ONE refusal', () => {
  it('the objectui#9164 input and the beside-a-key input raise the same error for the same field', () => {
    const alone = expectEmptyMapRefusal(() => convertFiltersToAST({ created: {} }), 'created');
    const beside = expectEmptyMapRefusal(() => convertFiltersToAST({ status: 'a', created: {} }), 'created');
    // Compared with each other, not with a literal: a second throw site for
    // the beside case would have to agree with the first byte for byte.
    expect(beside.message).toBe(alone.message);
    expect(beside.name).toBe(alone.name);
  });
});

// ---------------------------------------------------------------------------
// 4. The controls
// ---------------------------------------------------------------------------

describe('objectui#10788 — the controls keep their answers', () => {
  it("{ status: 'a' } (the card's control) still lowers to an AST", () => {
    const node = convertFiltersToAST({ status: 'a' });
    expect(node).toEqual(['status', '=', 'a']);
    expect(isFilterAST(node)).toBe(true);
  });

  it('a real operator beside the key still lowers', () => {
    expect(convertFiltersToAST({ status: 'a', created: { $gte: D } }))
      .toEqual(['and', ['status', '=', 'a'], ['created', '>=', D]]);
  });

  it('a SKIPPED null beside the key is not an empty operator map', () => {
    expect(convertFiltersToAST({ status: 'a', created: null })).toEqual(['status', '=', 'a']);
  });

  it('{} (no filter) is unchanged', () => {
    expect(convertFiltersToAST({})).toEqual({});
  });
});
