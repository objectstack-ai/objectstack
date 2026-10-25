/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A bare ARRAY in comparand position through the repo's ONE lowering —
 * objectui#8530.
 *
 * ## The defect
 *
 * `convertFiltersToAST` ended its per-field loop with a simple-equality `else`
 * that was reached for every non-object value — arrays included. So
 * `{ tags: ['a', 'b'] }` became `['tags', '=', ['a', 'b']]`: an array sitting
 * in a scalar-equality slot. Nothing answers that node with a row.
 *
 * MEASURED (this file, section 1) — the spec's own doors do not catch it:
 * `isFilterAST` is `true` and `parseFilterAST` hands back `{ tags: [...] }`
 * unjudged, because `assertListComparandShapes` rules only on `$in` / `$nin` /
 * `$between`. The refusal therefore arrived two layers away — `driver-sql`'s
 * `400 INVALID_FILTER` from the wire, or an empty list from every in-memory
 * matcher — and the author learned nothing at lowering time.
 * (That was `@objectstack/spec` through 17.4.0. Since 17.5.0 `parseFilterAST`
 * refuses the node itself, naming the field — section 1 was re-pinned to that
 * sibling refusal by objectui#11073, and the producer arm stays.)
 *
 * ## The ruling (objectui#8530, PM comment 5583351371)
 *
 * Throw `FilterOperatorError`, matching the file's two existing refusals of
 * shapes it cannot lower (`$regex`, `$not`). ⛔ NOT lowered to `in`:
 * `{ tags: [...] }` and `{ tags: { $in: [...] } }` are different statements,
 * the second is already spellable, and rewriting one into the other is the
 * lenient second contract objectui#8514 was resolved against on this same data
 * shape one layer down.
 *
 * ## What carries the weight here — the NON-regression axis
 *
 * The caricature of this fix throws on everything array-shaped. It passes every
 * "the bare array is now refused" assertion in section 1 and breaks `$in` /
 * `$nin` / `$between` members, `$and` / `$or` groups and stored `ViewFilterRule`
 * values with `in` / `between` — all legitimately arrays. Section 2 is what
 * discriminates the fix from the caricature, and it asserts PRODUCED values put
 * through the spec's own doors, not the absence of a throw: a lowering that
 * emits nothing would pass "does not throw" and still be the caricature's
 * silent twin.
 *
 * Section 1's refusals assert the envelope (`code` + `httpStatus`, ADR-0112 /
 * objectui#3066) on a CAPTURED error, so the message-quality assertions run
 * unconditionally in the leg they were written for rather than sitting inside
 * a `catch` that a non-throwing lowering never enters.
 */

import { describe, it, expect } from 'vitest';
import { isFilterAST, parseFilterAST } from '@objectstack/spec/data';
import {
  convertFiltersToAST,
  toFilterNode,
  mergeFilterNodes,
  FilterOperatorError,
} from '../filter-converter';

/**
 * Run the lowering and hand back the refusal it raised. Fails the test — on
 * the FIRST line, with the produced value in the message — when it did not
 * refuse, so no later assertion is silently skipped.
 */
function captureRefusal(run: () => unknown): FilterOperatorError {
  let caught: unknown;
  let produced: unknown;
  try {
    produced = run();
  } catch (e) {
    caught = e;
  }
  expect(
    caught,
    `expected the lowering to refuse, it produced ${JSON.stringify(produced)}`,
  ).toBeInstanceOf(FilterOperatorError);
  return caught as FilterOperatorError;
}

// ---------------------------------------------------------------------------
// 1. The bare array is refused — with the envelope and an actionable message
// ---------------------------------------------------------------------------

describe('objectui#8530 — a bare array in comparand position is refused', () => {
  it('records that the spec door now refuses the old node too — a SIBLING refusal, not a licence to drop this one', () => {
    // The pre-fix emission. Through `@objectstack/spec` 17.4.0 both spec doors
    // accepted it, so nothing between this file and the driver would have said
    // a word. This pin was written to redden the day the spec started refusing
    // it, and it did at 17.5.0 (objectui#11073): the shape check still passes,
    // and the lowering now throws `INVALID_FILTER` naming the field. The
    // reader's lesson is the one this comment always gave — the refusal gained
    // a sibling; the producer arm below still refuses FIRST, at authoring.
    const preFixNode = ['tags', '=', ['a', 'b']];
    expect(isFilterAST(preFixNode)).toBe(true);
    let thrown: unknown;
    try {
      parseFilterAST(preFixNode);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { code?: string } | undefined)?.code).toBe('INVALID_FILTER');
    expect((thrown as Error).message).toMatch(
      /^The implicit-equality comparand on field "tags" requires a single comparable value, but received an array/,
    );
  });

  it('refuses { tags: [...] } with the INVALID_FILTER / 400 envelope', () => {
    const err = captureRefusal(() => convertFiltersToAST({ tags: ['a', 'b'] }));
    // A bare `Error` classifies as a network fault in the list error panel
    // (objectui#3066); the data API's own code and status are what make it
    // render as "the filter is malformed".
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.httpStatus).toBe(400);
    expect(err.name).toBe('FilterOperatorError');
  });

  it('names the field, prints the comparand, and prescribes $in / $nin', () => {
    const err = captureRefusal(() => convertFiltersToAST({ tags: ['a', 'b'] }));
    // The first sentence is the contract a reader acts on without opening the
    // source: which field, what value.
    expect(err.message).toMatch(
      /^\[ObjectUI\] The filter on field 'tags' carries a bare ARRAY as its equality comparand: \["a","b"\]\./,
    );
    // The door that works, spelled for THIS field — and its negation.
    expect(err.message).toContain('{ tags: { $in: [...] } }');
    expect(err.message).toContain('{ tags: { $nin: [...] } }');
    // Says out loud that it was not rewritten to membership, and why, so a
    // reader who wants `in` knows that door exists and is a separate decision.
    expect(err.message).toMatch(/NOT read as membership/);
    expect(err.message).toContain('objectui#8530');
    // Not the sibling diagnostics: this is neither an unknown operator nor a
    // combinator problem, and it must not be reported as one.
    expect(err.message).not.toMatch(/Unknown filter operator/);
    expect(err.message).not.toMatch(/combinator/);
  });

  it('prints the comparand it was given, not a placeholder', () => {
    const err = captureRefusal(() => convertFiltersToAST({ owner_id: [42, null, 'x'] }));
    expect(err.message).toContain("field 'owner_id'");
    expect(err.message).toContain('[42,null,"x"]');
  });

  it('refuses the empty array too — it is not "no constraint"', () => {
    // `['tags', '=', []]` is exactly as unanswerable as the two-member one, and
    // reading `[]` as TRUE would silently widen the result set — the one
    // failure direction this file exists to avoid.
    const err = captureRefusal(() => convertFiltersToAST({ tags: [] }));
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.message).toContain('comparand: []');
  });

  it('refuses the array wherever it sits: beside other fields and inside $and / $or', () => {
    // Beside a scalar condition — the array must not hide behind a sibling
    // that lowers fine.
    expect(captureRefusal(() => convertFiltersToAST({ status: 'active', tags: ['a'] })).message)
      .toContain("field 'tags'");
    // As a member condition of a combinator — children lower recursively, so
    // the refusal propagates from the child.
    expect(captureRefusal(
      () => convertFiltersToAST({ $or: [{ status: 'open' }, { tags: ['a'] }] }),
    ).message).toContain("field 'tags'");
    expect(captureRefusal(
      () => convertFiltersToAST({ $and: [{ status: 'open' }, { tags: ['a', 'b'] }] }),
    ).message).toContain("field 'tags'");
  });

  it('is refused by the sink the same way — toFilterNode and mergeFilterNodes delegate', () => {
    // `toFilterNode` is the last hop before the wire for an OBJECT source, and
    // `mergeFilterNodes` is what every renderer calls; both route the object
    // through `convertFiltersToAST`, so the refusal reaches them unchanged.
    const viaSink = captureRefusal(() => toFilterNode({ tags: ['a', 'b'] }));
    expect(viaSink.code).toBe('INVALID_FILTER');
    const viaMerge = captureRefusal(() => mergeFilterNodes({ status: 'x' }, { tags: ['a'] }));
    expect(viaMerge.code).toBe('INVALID_FILTER');
    expect(viaMerge.message).toContain("field 'tags'");
  });
});

// ---------------------------------------------------------------------------
// 2. NON-regression — arrays that are LEGITIMATELY arrays keep lowering.
//    This is the axis that separates the fix from "throw on anything array-
//    shaped". Every case asserts the PRODUCED node and puts it through the
//    spec's own doors; none of them is "does not throw".
// ---------------------------------------------------------------------------

describe('objectui#8530 — legitimate array positions are untouched', () => {
  it('$in still lowers to `in` with its member array intact', () => {
    const node = convertFiltersToAST({ status: { $in: ['active', 'pending'] } });
    expect(node).toEqual(['status', 'in', ['active', 'pending']]);
    expect(isFilterAST(node)).toBe(true);
    // Round trip through the spec's shape door: `$in` with an array member is
    // exactly what `assertListComparandShapes` accepts.
    expect(parseFilterAST(node)).toEqual({ status: { $in: ['active', 'pending'] } });
  });

  it('$nin still lowers to `nin`', () => {
    expect(convertFiltersToAST({ status: { $nin: ['archived'] } }))
      .toEqual(['status', 'nin', ['archived']]);
    expect(convertFiltersToAST({ status: { $nin: ['archived', 'deleted'] } }))
      .toEqual(['status', 'nin', ['archived', 'deleted']]);
    expect(parseFilterAST(['status', 'nin', ['archived']])).toEqual({ status: { $nin: ['archived'] } });
  });

  // The `$notin` alias this case used to carry alongside `$nin` was RETIRED by
  // objectui#8568 — it is now refused by name. Asserted here so the retirement
  // is visible from the array-comparand axis too: a refusal is not the silent
  // "condition dropped" this file exists to rule out, and the array member
  // survives into the message rather than into a widened result set.
  it('the retired $notin alias is refused, not lowered (objectui#8568)', () => {
    expect(() => convertFiltersToAST({ status: { $notin: ['archived', 'deleted'] } }))
      .toThrow(/\$nin/);
    try {
      convertFiltersToAST({ status: { $notin: ['archived'] } });
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_FILTER', httpStatus: 400 });
    }
  });

  it('$between still lowers with its [min, max] pair', () => {
    const node = convertFiltersToAST({ age: { $between: [18, 65] } });
    expect(node).toEqual(['age', 'between', [18, 65]]);
    expect(isFilterAST(node)).toBe(true);
    expect(parseFilterAST(node)).toEqual({ age: { $between: [18, 65] } });
  });

  it('$in / $nin members inside $and / $or still lower', () => {
    const node = convertFiltersToAST({
      $or: [{ status: { $in: ['open', 'blocked'] } }, { tags: { $nin: ['x'] } }],
    });
    expect(node).toEqual([
      'or',
      ['status', 'in', ['open', 'blocked']],
      ['tags', 'nin', ['x']],
    ]);
    expect(isFilterAST(node)).toBe(true);
  });

  it('$and / $or themselves — arrays OF conditions — still lower to groups', () => {
    // The combinator's VALUE is an array. The caricature ("throw on any array")
    // placed ahead of the combinator arm would refuse it as a field called
    // `$or` carrying an array comparand.
    const node = convertFiltersToAST({ $or: [{ status: 'open' }, { status: 'blocked' }] });
    expect(node).toEqual(['or', ['status', '=', 'open'], ['status', '=', 'blocked']]);
    expect(parseFilterAST(node)).toEqual({ $or: [{ status: 'open' }, { status: 'blocked' }] });
    const conj = convertFiltersToAST({ $and: [{ a: 1 }, { b: 2 }] });
    expect(conj).toEqual(['and', ['a', '=', 1], ['b', '=', 2]]);
  });

  it('a stored ViewFilterRule whose operator is `in` / `between` keeps its array value', () => {
    // The card asked for this path to be checked before choosing: a saved view
    // rule legitimately carries an array on these operators and lowers through
    // `viewFilterRuleToNode`, not through the object arm. It must keep working.
    const inRule = toFilterNode([{ field: 'status', operator: 'in', value: ['a', 'b'] }]);
    expect(inRule).toEqual([['status', 'in', ['a', 'b']]]);
    expect(isFilterAST(inRule)).toBe(true);
    const betweenRule = toFilterNode([{ field: 'amount', operator: 'between', value: [1, 10] }]);
    expect(betweenRule).toEqual([['amount', 'between', [1, 10]]]);
    expect(isFilterAST(betweenRule)).toBe(true);
  });

  it('an object source with $in merges beside a rule array under one `and`', () => {
    const merged = mergeFilterNodes(
      { status: { $in: ['open', 'blocked'] } },
      [{ field: 'amount', operator: 'between', value: [1, 10] }],
    );
    expect(merged).toEqual([
      'and',
      ['status', 'in', ['open', 'blocked']],
      [['amount', 'between', [1, 10]]],
    ]);
  });

  it('scalar equality is exactly what it was', () => {
    expect(convertFiltersToAST({ status: 'active' })).toEqual(['status', '=', 'active']);
    expect(convertFiltersToAST({ count: 0, ok: false })).toEqual([
      'and',
      ['count', '=', 0],
      ['ok', '=', false],
    ]);
  });
});
