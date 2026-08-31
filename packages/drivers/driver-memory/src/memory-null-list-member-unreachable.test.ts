// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13357] Ruling point 3's NEGATIVE pin, matcher side: a refused null list
 * member cannot reach this package's reference matcher.
 *
 * # What was ruled (2026-08-31, option C)
 *
 * #13357 measured that the reference matcher answers `$in: [null]` /
 * `$nin: [null]` differently across the two readings of "no value" (a stored
 * `null` vs an absent key) while `$null` / `$ne: null` agree — and that the
 * SQL family answers the same filters a third way. The ruling REFUSES the
 * shape at the contract's validation entrance (`@objectstack/spec`,
 * `assertListComparandShapes`, run inside `parseFilterAST` and at the engine
 * seam) instead of aligning the backends: the divergence becomes
 * constructively unreachable, ⛔ deliberately not repaired (「⛔ 不单独修一个
 * 到不了的路径」), so NOTHING in this file asserts what the matcher would
 * have answered. `memory-matcher-null-value-and-comparand.test.ts` keeps
 * those arms deliberately absent for the same reason.
 *
 * # What this file pins, and its honest boundary
 *
 * A direct caller of this driver — this repo's own conformance suites, an
 * embedder — compiles its filter with `parseFilterAST` and hands the result
 * over (`filter-comparand-shape.ts`'s #9228 section is the ruling that put
 * the gate on that face for exactly this caller). This file drives that
 * pipeline end to end and pins that for every refused shape it ABORTS at the
 * compile face, on BOTH fixture readings, before any row is consulted: the
 * evaluation step is provably never reached because the compile step throws.
 * The engine half (every verb, driver-call witness) is pinned in
 * `@objectstack/objectql`'s `engine-filter-array-lowering.test.ts`; the
 * wire/protocol face runs the same `parseFilterAST`.
 *
 * The boundary, stated rather than hidden: `match()` and
 * `InMemoryDriver.find()` remain plain library functions — a caller that
 * skips the compile face meets only this package's own
 * `assertFilterConditionShape`, which is deliberately NOT extended to the
 * null-member rule (⛔ 不做跨后端对齐工程). That boundary is the same one
 * every #5869 refusal has had since #9228, and it is not widened here.
 */

import { describe, it, expect } from 'vitest';
import { parseFilterAST } from '@objectstack/spec/data';

import { match } from './memory-matcher.js';

type Refusal = Error & { code?: string; status?: number };

/** The card's own fixture, in both readings of "no value" (#13357). */
const NULLED_ROWS: Array<Record<string, unknown>> = [
  { id: '1', name: 'a' },
  { id: '3', name: null },
];
const MISSING_ROWS: Array<Record<string, unknown>> = [
  { id: '1', name: 'a' },
  { id: '3' },
];

/**
 * The direct-caller pipeline, exactly as the module note describes it: compile
 * first, evaluate second. The refusal has to land in step one — if compile
 * returns, the matcher HAS been reached and the pin below fails on the
 * sentinel rather than on a missing throw.
 */
function compileThenMatch(rows: Array<Record<string, unknown>>, where: unknown): string[] {
  const condition = parseFilterAST(where);
  return rows.filter((row) => match(row, condition)).map((row) => String(row.id));
}

const refusalOf = (run: () => unknown): Refusal => {
  try {
    run();
  } catch (e) {
    return e as Refusal;
  }
  throw new Error('expected the compile face to refuse this filter, but it returned');
};

describe('[#13357] a refused null list member cannot reach the matcher (ruled 2026-08-31)', () => {
  it.each([
    ['$in: [null]', { name: { $in: [null] } }],
    ['$nin: [null]', { name: { $nin: [null] } }],
    ['$between: [null, null]', { name: { $between: [null, null] } }],
    ['$between: [null, max]', { name: { $between: [null, 'z'] } }],
    ['$between: [min, null]', { name: { $between: ['a', null] } }],
  ])('%s aborts at the compile face on BOTH readings of "no value"', (_label, where) => {
    // Record-independent by construction — the compile face never sees a row —
    // so the two readings that split the matcher (#13357's table) cannot even
    // be posed. Driving both anyway is the point of the pin: neither fixture
    // gets an answer, so there is no divergence left to observe.
    for (const rows of [NULLED_ROWS, MISSING_ROWS]) {
      const err = refusalOf(() => compileThenMatch(rows, where));
      expect(err.code, _label).toBe('INVALID_FILTER');
      expect(err.status, _label).toBe(400);
    }
  });

  it('the pipeline itself is real — a legal list compiles and the matcher answers', () => {
    // Positive control: without it, the refusals above would also "pass" if
    // compileThenMatch were broken outright.
    expect(compileThenMatch(NULLED_ROWS, { name: { $in: ['a'] } })).toEqual(['1']);
    expect(compileThenMatch(MISSING_ROWS, { name: { $nin: ['a'] } })).toEqual(['3']);
  });

  it('an EMPTY list still passes the same face — the refusal is null-shaped, not list-shaped', () => {
    // `$in: []` / `$nin: []` are declared predicates ("matches nothing" /
    // "matches everything") and PR #13630 pins them downstream; the carve-out
    // must not catch them.
    expect(compileThenMatch(NULLED_ROWS, { name: { $in: [] } })).toEqual([]);
    expect(compileThenMatch(NULLED_ROWS, { name: { $nin: [] } })).toEqual(['1', '3']);
  });
});
