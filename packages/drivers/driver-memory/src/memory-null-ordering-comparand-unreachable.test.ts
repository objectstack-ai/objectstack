// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14080] Ruling point 4's NEGATIVE pin, matcher side: a refused null
 * ORDERING comparand cannot reach this package's reference matcher.
 *
 * # What was ruled (2026-09-01, option A)
 *
 * #14080 measured, on this package's two faces and the card's numeric
 * fixture, that `{n: {$gt: null}}` / `{$gte: null}` / `{$lte: null}` answer
 * DIFFERENTLY: the live (mingo) path reads two absences as EQUAL, so
 * `$gte: null` admits the no-value row and `$gt: null` does not, while the
 * reference matcher compares through JS coercion, so `5 > null` is `5 > 0`.
 * It was the last null-comparand position the contract neither ruled on
 * (`$eq: null` / `$ne: null` ARE the null predicate, #5332) nor refused (the
 * 2026-08-31 ruling refused the `$in` / `$nin` members and the `$between`
 * bounds, #13357). The ruling REFUSES the shape at the contract's validation
 * entrance (`@objectstack/spec`, `assertListComparandShapes`, run inside
 * `parseFilterAST` and at the engine seam) instead of defining the semantics:
 * the divergence becomes constructively unreachable, ⛔ deliberately not
 * repaired (「⛔ 不单独修 matcher(死代码)」) and ⛔ no ordering-vs-null rule is
 * stated anywhere (「B(定义语义)排除」), so NOTHING in this file asserts what
 * either face would have answered. `memory-matcher-null-value-and-comparand.test.ts`
 * keeps those cells deliberately absent for the same reason.
 *
 * # What this file pins, and its honest boundary
 *
 * The same pipeline and the same boundary as
 * `memory-null-list-member-unreachable.test.ts`: a direct caller of this
 * driver compiles its filter with `parseFilterAST` and hands the result over,
 * and this file drives that pipeline end to end, pinning that for every
 * refused shape it ABORTS at the compile face, on BOTH readings of "no value",
 * before any row is consulted. The engine half (every verb, driver-call
 * witness) is pinned in `@objectstack/objectql`'s
 * `engine-filter-array-lowering.test.ts`; the wire/protocol face runs the same
 * `parseFilterAST`. `match()` and `InMemoryDriver.find()` remain plain library
 * functions — a caller that skips the compile face meets only this package's
 * own `assertFilterConditionShape`, which is deliberately NOT extended to the
 * null-ordering rule (⛔ 不做跨后端对齐工程). Same boundary as every #5869
 * refusal since #9228; not widened here.
 */

import { describe, it, expect } from 'vitest';
import { parseFilterAST } from '@objectstack/spec/data';

import { match } from './memory-matcher.js';

type Refusal = Error & { code?: string; status?: number };

/**
 * The card's own NUMERIC fixture, in both readings of "no value" — numeric
 * because `null` coerces to `0` under a relational comparison, which is the
 * coercion that split the two faces; a string fixture hides it (#13553).
 */
const NULLED_ROWS: Array<Record<string, unknown>> = [
  { id: '1', n: 5 },
  { id: '2', n: 0 },
  { id: '3', n: null },
];
const MISSING_ROWS: Array<Record<string, unknown>> = [
  { id: '1', n: 5 },
  { id: '2', n: 0 },
  { id: '4' },
];

/**
 * The direct-caller pipeline: compile first, evaluate second. The refusal has
 * to land in step one — if compile returns, the matcher HAS been reached and
 * the pin below fails on the sentinel rather than on a missing throw.
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

describe('[#14080] a refused null ordering comparand cannot reach the matcher (ruled 2026-09-01)', () => {
  it.each([
    ['$gt: null', { n: { $gt: null } }],
    ['$gte: null', { n: { $gte: null } }],
    ['$lt: null', { n: { $lt: null } }],
    ['$lte: null', { n: { $lte: null } }],
    ['lowered array form, ">="', [['n', '>=', null]]],
    ['lowered array form, "before"', [['n', 'before', null]]],
  ])('%s aborts at the compile face on BOTH readings of "no value"', (_label, where) => {
    // Record-independent by construction — the compile face never sees a row —
    // so the two readings that split the faces (the card's table) cannot even
    // be posed. Driving both anyway is the point of the pin: neither fixture
    // gets an answer, so there is no divergence left to observe.
    for (const rows of [NULLED_ROWS, MISSING_ROWS]) {
      const err = refusalOf(() => compileThenMatch(rows, where));
      expect(err.code, _label).toBe('INVALID_FILTER');
      expect(err.status, _label).toBe(400);
    }
  });

  it('the pipeline itself is real — a legal ordering comparand compiles and the matcher answers', () => {
    // Positive control: without it, the refusals above would also "pass" if
    // compileThenMatch were broken outright. `0` is the discriminator the
    // numeric fixture exists for — a VALUE, kept in, on every arm.
    expect(compileThenMatch(NULLED_ROWS, { n: { $gt: 0 } })).toEqual(['1']);
    expect(compileThenMatch(NULLED_ROWS, { n: { $gte: 0 } })).toEqual(['1', '2']);
    expect(compileThenMatch(MISSING_ROWS, { n: { $lt: 5 } })).toEqual(['2']);
    expect(compileThenMatch(MISSING_ROWS, [['n', '<=', 0]])).toEqual(['2']);
  });

  it('the null PREDICATE still passes the same face — the refusal is ordering-shaped, not null-shaped', () => {
    // `$eq: null` IS the null predicate on both readings (#13494) and is the
    // spelling the refusal prescribes; the carve-out must not catch it.
    expect(compileThenMatch(NULLED_ROWS, { n: { $eq: null } })).toEqual(['3']);
    expect(compileThenMatch(MISSING_ROWS, { n: { $eq: null } })).toEqual(['4']);
    expect(compileThenMatch(NULLED_ROWS, { n: { $ne: null } })).toEqual(['1', '2']);
  });
});
