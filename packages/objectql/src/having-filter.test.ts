// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * HAVING evaluator (#4286 step 3) — semantics over AGGREGATED rows.
 *
 * The namespace is the aggregated row's own columns (aggregation aliases +
 * groupBy projections); operator semantics follow the Filter Protocol, with two
 * deliberate divergences from driver-memory's matcher: an unknown operator
 * throws — ignoring one would silently return unfiltered aggregates, the exact
 * silently-inert failure (#4286, ADR-0078) enforcement exists to end — and the
 * negation-carrying operators are NULL-safe per #5298 (see the grid at the
 * bottom of this file, #5905).
 */

import { describe, it, expect } from 'vitest';
import { RETIRED_FILTER_OPERATORS } from '@objectstack/spec/data';
import { applyHaving, matchesHaving } from './having-filter.js';

const ROWS = [
  { customer_id: 'c1', order_count: 2, total: 500 },
  { customer_id: 'c2', order_count: 6, total: 1200 },
  { customer_id: 'c3', order_count: 9, total: 800, region: null },
];

describe('applyHaving', () => {
  it('returns rows unchanged for an absent or empty condition', () => {
    expect(applyHaving(ROWS, undefined)).toBe(ROWS);
    expect(applyHaving(ROWS, null)).toBe(ROWS);
    expect(applyHaving(ROWS, {})).toBe(ROWS);
  });

  it('filters on an aggregation alias with a comparison operator', () => {
    expect(applyHaving(ROWS, { order_count: { $gt: 5 } }).map((r) => r.customer_id))
      .toEqual(['c2', 'c3']);
    expect(applyHaving(ROWS, { total: { $lte: 800 } }).map((r) => r.customer_id))
      .toEqual(['c1', 'c3']);
  });

  it('filters on a groupBy projection with implicit equality', () => {
    expect(applyHaving(ROWS, { customer_id: 'c2' })).toHaveLength(1);
  });

  it('composes with $and / $or / $not', () => {
    expect(applyHaving(ROWS, {
      $and: [{ order_count: { $gt: 1 } }, { total: { $gt: 1000 } }],
    }).map((r) => r.customer_id)).toEqual(['c2']);

    expect(applyHaving(ROWS, {
      $or: [{ total: { $gt: 1000 } }, { order_count: { $gte: 9 } }],
    }).map((r) => r.customer_id)).toEqual(['c2', 'c3']);

    expect(applyHaving(ROWS, { $not: { customer_id: 'c1' } })).toHaveLength(2);
  });

  it('supports set, range, and null operators', () => {
    expect(applyHaving(ROWS, { customer_id: { $in: ['c1', 'c3'] } })).toHaveLength(2);
    expect(applyHaving(ROWS, { total: { $between: [600, 1300] } }).map((r) => r.customer_id))
      .toEqual(['c2', 'c3']);
    expect(applyHaving(ROWS, { region: { $null: true } }).map((r) => r.customer_id))
      .toEqual(['c1', 'c2', 'c3']); // absent folds into null, like the memory matcher
  });

  it('multiple keys on one condition AND together, like `where`', () => {
    expect(applyHaving(ROWS, { order_count: { $gte: 2 }, total: { $lt: 900 } })
      .map((r) => r.customer_id)).toEqual(['c1', 'c3']);
  });
});

/**
 * [#7047] The refusal's ENVELOPE, asserted separately from its message.
 *
 * Every assertion in this describe block used to be `toThrow(/message/)` alone,
 * and that is precisely why the defect survived: a throw-only assertion is green
 * whether or not the thrown error carries `code` and `status` (#6142/#6050
 * measured this shape of hole). Both `unknownOperator()` returns were bare
 * `new Error`, so a 400-class author mistake reached the client 500-shaped
 * through `rest`'s unclassified-fault branch — the only one of the five refusal
 * faces that did (#6993's execution census; the four driver faces all answered
 * `INVALID_FILTER` / 400).
 *
 * `code` and `status` are checked on BOTH branches — retired and unknown — and
 * on BOTH positions — a field condition and a node-level logical key — because
 * they are four independent `return`/`throw` sites and enveloping some of them
 * leaves the same 500 one operator name away.
 */
function expectInvalidFilterEnvelope(fn: () => unknown): Error & { code?: string; status?: number } {
  let err: (Error & { code?: string; status?: number }) | undefined;
  try {
    fn();
  } catch (e) {
    err = e as Error & { code?: string; status?: number };
  }
  expect(err, 'expected `having` to REFUSE this filter').toBeInstanceOf(Error);
  // The ADR-0112 envelope the four driver faces already speak. Not a new code:
  // a caller swapping HAVING for a driver-side `where` catches one shape.
  expect(err!.code).toBe('INVALID_FILTER');
  expect(err!.status).toBe(400);
  return err!;
}

describe('matchesHaving — the unknown-operator refusal', () => {
  it('THROWS on an unknown condition operator instead of ignoring it', () => {
    const err = expectInvalidFilterEnvelope(() => matchesHaving(ROWS[0], { order_count: { $median: 3 } }));
    expect(err.message).toMatch(/Unsupported operator '\$median' in `having`.*\$gte.*unfiltered aggregates/s);
  });

  it('THROWS on an unknown logical operator', () => {
    const err = expectInvalidFilterEnvelope(() => matchesHaving(ROWS[0], { $nand: [{ order_count: 2 }] }));
    expect(err.message).toMatch(/Unsupported operator '\$nand'/);
  });

  /**
   * [#7047] The unknown branch is reachable from `applyHaving` too, which is the
   * entry point `engine.aggregate()` actually calls — the envelope has to be on
   * the error that leaves the module, not only on the one `matchesHaving`
   * raises directly.
   */
  it('carries the envelope out through applyHaving, the engine-facing entry point', () => {
    expectInvalidFilterEnvelope(() => applyHaving(ROWS, { order_count: { $median: 3 } }));
    expectInvalidFilterEnvelope(() => applyHaving(ROWS, { $nand: [{ order_count: 2 }] }));
  });

  /**
   * [#5702] REPLACED. This case read `accepts $regex with $options as its
   * sibling, not an operator` and asserted `matchesHaving({ k: 'Alpha' },
   * { k: { $regex: '^alp', $options: 'i' } }) === true` — HAVING running a real
   * `RegExp`, with `$options` skipped as its flags.
   *
   * #4706 retired both spellings and #5710 flipped their last producer, so
   * there is no true/false answer left to assert: HAVING is the fifth of the
   * five refusal sites `RETIRED_FILTER_OPERATORS` names, and it now refuses.
   * The old arm also answered an ILLEGAL pattern with `return false` — "this
   * row does not match" for a filter that could not run at all — which is the
   * silent wrong answer the retirement is about, on the one evaluation face no
   * conformance table drives.
   */
  for (const [label, condition, mustMention] of [
    ['a bare $regex', { k: { $regex: '^alp' } }, ["'$regex'", '$icontains']],
    ['a bare $options', { k: { $options: 'i' } }, ["'$options'", '$icontains']],
    [
      '$regex with $options — one mistake, one fix',
      { k: { $regex: '^alp', $options: 'i' } },
      ["'$regex'", "'$options'", '$icontains'],
    ],
  ] as const) {
    it(`REFUSES the retired ${label}, naming the replacement, in the ADR-0112 envelope`, () => {
      // [#7047] `code` + `status` + message. The message half already passed
      // before this card; the envelope half is what was missing.
      const err = expectInvalidFilterEnvelope(() => matchesHaving({ k: 'Alpha' }, condition));
      expect(err.message).toContain('RETIRED');
      for (const mention of mustMention) expect(err.message).toContain(mention);
      // [#7047] The prescription VERBATIM, not a paraphrase of it. The spec
      // table exists so the five refusal sites stop each writing their own
      // sentence about one retirement (#5701); a substring check on '$icontains'
      // alone would stay green if this face started rewording it.
      const first = Object.keys(condition.k)[0]!;
      expect(err.message).toContain(RETIRED_FILTER_OPERATORS[first]!.why);
    });
  }
});

/**
 * [#5905] The no-value grid for the negation-carrying operators.
 *
 * #5298 ruled (option A, 2026-08-06) that "the column has no value" SATISFIES a
 * test for "not this value", and PR #5962 landed it on driver-sql, formula,
 * service-analytics and the `FILTER_LOGIC_*` conformance table. HAVING is the
 * fifth evaluation face of the same vocabulary and was not in that PR's
 * inventory, so it stayed the lone holdout — and no conformance table would
 * have caught it, because `FILTER_LOGIC_CASES` does not drive the HAVING path
 * (verified: `packages/objectql` imports it nowhere). This grid IS that
 * coverage.
 *
 * Two no-value shapes, deliberately separated, because on this face they did
 * NOT arrive at the old answer by the same route:
 *
 * - NULLED — the key is present with `null`. The early-exit guard tests
 *   `=== undefined`, so it never fired here; `$nin` was already NULL-safe and
 *   `$notContains` was not (`typeof null !== 'string'` ⇒ judged false).
 * - MISSING — the key is absent, so the aggregated row reads `undefined`. The
 *   early-exit guard fired first and answered false for BOTH operators, before
 *   either arm was reached.
 *
 * The positive-operator rows are the control: `$in` / `$contains` must keep
 * REJECTING both no-value shapes. Widening the exemption list too far would
 * turn them green, which is the failure this pair is here to catch.
 */
describe('no-value rows and the negation-carrying operators (#5905 / #5298 option A)', () => {
  const NULLED = { customer_id: 'nulled', tag: null, total: 100 };
  const MISSING = { customer_id: 'missing', total: 100 };
  const VALUED_OUT = { customer_id: 'valued_out', tag: 'gamma', total: 100 };
  const VALUED_IN = { customer_id: 'valued_in', tag: 'alpha', total: 100 };
  const GRID = [NULLED, MISSING, VALUED_OUT, VALUED_IN];

  describe('$nin', () => {
    it('a NULLED column satisfies $nin', () => {
      expect(matchesHaving(NULLED, { tag: { $nin: ['alpha', 'beta'] } })).toBe(true);
    });

    it('a MISSING column satisfies $nin', () => {
      expect(matchesHaving(MISSING, { tag: { $nin: ['alpha', 'beta'] } })).toBe(true);
    });

    it('a present value OUTSIDE the list still satisfies $nin (unchanged)', () => {
      expect(matchesHaving(VALUED_OUT, { tag: { $nin: ['alpha', 'beta'] } })).toBe(true);
    });

    it('a present value INSIDE the list still fails $nin (unchanged)', () => {
      expect(matchesHaving(VALUED_IN, { tag: { $nin: ['alpha', 'beta'] } })).toBe(false);
    });

    it('applyHaving keeps both no-value rows and drops only the listed value', () => {
      expect(applyHaving(GRID, { tag: { $nin: ['alpha', 'beta'] } }).map((r) => r.customer_id))
        .toEqual(['nulled', 'missing', 'valued_out']);
    });
  });

  describe('$notContains', () => {
    it('a NULLED column satisfies $notContains', () => {
      expect(matchesHaving(NULLED, { tag: { $notContains: 'lph' } })).toBe(true);
    });

    it('a MISSING column satisfies $notContains', () => {
      expect(matchesHaving(MISSING, { tag: { $notContains: 'lph' } })).toBe(true);
    });

    it('a present value WITHOUT the substring still satisfies $notContains (unchanged)', () => {
      expect(matchesHaving(VALUED_OUT, { tag: { $notContains: 'lph' } })).toBe(true);
    });

    it('a present value WITH the substring still fails $notContains (unchanged)', () => {
      expect(matchesHaving(VALUED_IN, { tag: { $notContains: 'lph' } })).toBe(false);
    });

    it('applyHaving keeps both no-value rows and drops only the containing value', () => {
      expect(applyHaving(GRID, { tag: { $notContains: 'lph' } }).map((r) => r.customer_id))
        .toEqual(['nulled', 'missing', 'valued_out']);
    });
  });

  describe('the control: positive operators still reject a no-value column', () => {
    it('$in rejects NULLED and MISSING', () => {
      expect(matchesHaving(NULLED, { tag: { $in: ['alpha', 'beta'] } })).toBe(false);
      expect(matchesHaving(MISSING, { tag: { $in: ['alpha', 'beta'] } })).toBe(false);
    });

    it('$contains rejects NULLED and MISSING', () => {
      expect(matchesHaving(NULLED, { tag: { $contains: 'lph' } })).toBe(false);
      expect(matchesHaving(MISSING, { tag: { $contains: 'lph' } })).toBe(false);
    });

    it('$ne — already exempt before #5905 — is unchanged for both shapes', () => {
      expect(matchesHaving(NULLED, { tag: { $ne: 'alpha' } })).toBe(true);
      expect(matchesHaving(MISSING, { tag: { $ne: 'alpha' } })).toBe(true);
      expect(matchesHaving(VALUED_IN, { tag: { $ne: 'alpha' } })).toBe(false);
    });
  });

  /**
   * [#6518] The `$contains` family is case-SENSITIVE by contract (#4706 Q2 = A).
   *
   * This face already was, by the same mechanism `formula`'s evaluator is —
   * `String.prototype.includes` / `startsWith` / `endsWith` compare exactly — so
   * #6518, which moved the SQL family onto that answer, changed nothing here.
   * It is pinned for the reason #5905 gave for pinning this file at all:
   * `having` is the one text-operator face with NO conformance-table coverage
   * (`check-driver-conformance` scopes itself to `packages/drivers/*`, and
   * `packages/objectql` imports no case-set), so a fold added here to make some
   * backend agree would go red nowhere.
   */
  describe('[#6518] the $contains family is case-SENSITIVE', () => {
    it('$contains, $startsWith and $endsWith do not fold case', () => {
      expect(matchesHaving(VALUED_IN, { tag: { $contains: 'LPH' } })).toBe(false);
      expect(matchesHaving(VALUED_IN, { tag: { $contains: 'lph' } })).toBe(true);
      expect(matchesHaving(VALUED_IN, { tag: { $startsWith: 'ALP' } })).toBe(false);
      expect(matchesHaving(VALUED_IN, { tag: { $startsWith: 'alp' } })).toBe(true);
      expect(matchesHaving(VALUED_IN, { tag: { $endsWith: 'HA' } })).toBe(false);
      expect(matchesHaving(VALUED_IN, { tag: { $endsWith: 'ha' } })).toBe(true);
    });

    it('$notContains carries the mirror: a case-only difference SATISFIES it', () => {
      expect(matchesHaving(VALUED_IN, { tag: { $notContains: 'LPH' } })).toBe(true);
      expect(matchesHaving(VALUED_IN, { tag: { $notContains: 'lph' } })).toBe(false);
    });
  });

  /**
   * The NULL-safety lives at the LEAF, so `$not` inverts it rather than
   * inheriting it — the same design driver-sql writes down for its own
   * `$not` rewrite (a nested negation totalises its own operand). A no-value
   * row satisfies `$nin`, therefore it does NOT satisfy `$not: { $nin }`.
   */
  it('$not inverts the leaf answer instead of re-applying the guard', () => {
    expect(matchesHaving(MISSING, { $not: { tag: { $nin: ['alpha'] } } })).toBe(false);
    expect(matchesHaving(NULLED, { $not: { tag: { $notContains: 'lph' } } })).toBe(false);
    expect(matchesHaving(VALUED_IN, { $not: { tag: { $nin: ['alpha'] } } })).toBe(true);
  });
});
