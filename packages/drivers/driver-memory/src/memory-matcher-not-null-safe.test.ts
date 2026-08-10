// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5146] `$not` and absent values — the answers this matcher gives, pinned.
 *
 * This backend needed no change for #5146: it already evaluates a negation in
 * ordinary two-valued JS, so `{ $not: { stage: 'won' } }` matches a record whose
 * `stage` is null or missing (`undefined !== 'won'`). `driver-sql` used to
 * DISAGREE — SQL's `NOT (stage = 'won')` is UNKNOWN for a NULL column and a
 * `WHERE` drops it — which meant one CEL `!expr` permission rule admitted a
 * different set of rows depending on which driver ran it. #5146 ruled this
 * backend's answer canonical (it is the 2:1 majority with `formula`) and
 * `driver-sql` was rewritten to match.
 *
 * So these cases are a PIN, not a change: they are the reference the SQL
 * compiler was aligned to, and `sql-driver-not-null-safe.test.ts` asserts the
 * same ids over the same fixture. Changing an expectation here silently
 * re-opens the divergence — the point of writing them down is that the next
 * edit has to move both files, deliberately.
 *
 * Where this matcher and `formula`'s `matchesFilterCondition` disagree, the case
 * says so and pins what each actually answers rather than pretending to a
 * consensus; those disagreements are filed separately and are NOT what #5146
 * ruled on.
 *
 * Home for these eventually: `FILTER_LOGIC_CASES` in `@objectstack/spec/data`,
 * so all five backends are held to one table (spec lane, with #5239).
 */

import { describe, it, expect } from 'vitest';
import { match } from './memory-matcher.js';

/** Fields present but null — how a SQL NULL round-trips into a record. */
const NULLED: Array<Record<string, unknown>> = [
  { id: '1', stage: 'won', owner: 'u1', amount: 10 },
  { id: '2', stage: 'lost', owner: 'u2', amount: 20 },
  { id: '3', stage: null, owner: 'u1', amount: null },
  { id: '4', stage: null, owner: null, amount: 40 },
];

/** The same rows with the null fields ABSENT — the shape a partial write leaves. */
const MISSING: Array<Record<string, unknown>> = [
  { id: '1', stage: 'won', owner: 'u1', amount: 10 },
  { id: '2', stage: 'lost', owner: 'u2', amount: 20 },
  { id: '3', owner: 'u1' },
  { id: '4', amount: 40 },
];

const ALL = ['1', '2', '3', '4'];

const ids = (rows: Array<Record<string, unknown>>, filter: unknown): string[] =>
  rows.filter((r) => match(r, filter)).map((r) => String(r.id));

/** Both readings of "no value" must give the same answer unless noted. */
const matched = (filter: unknown): string[] => {
  const nulled = ids(NULLED, filter);
  expect(ids(MISSING, filter), 'a null field and an absent field must match alike').toEqual(nulled);
  return nulled;
};

describe('[#5146] memory-matcher — $not over records with no value', () => {
  describe('a record with no value does not satisfy the negated condition', () => {
    it('$not on an implicit equality matches the value-less records', () => {
      expect(matched({ $not: { stage: 'won' } })).toEqual(['2', '3', '4']);
    });

    it('$not over multiple keys matches a record missing EITHER', () => {
      expect(matched({ $not: { stage: 'won', owner: 'u1' } })).toEqual(['2', '3', '4']);
    });

    it('the RLS shape: a CEL `!(stage == "won")` scope keeps stage-less records', () => {
      expect(matched({ $not: { stage: 'won' } })).toHaveLength(3);
    });
  });

  describe('nesting', () => {
    it('$not of a $or rejects a value-less record whose OTHER branch matches', () => {
      // Record 3 has no stage but owner = 'u1', so the $or holds and the
      // negation must reject it. This is the case that forced `driver-sql` to
      // compile its NULL guard onto each leaf instead of beside the `NOT`.
      expect(matched({ $not: { $or: [{ stage: 'won' }, { owner: 'u1' }] } })).toEqual(['2', '4']);
    });

    it('$not of a $and matches every record failing either conjunct', () => {
      expect(matched({ $not: { $and: [{ stage: 'won' }, { owner: 'u1' }] } })).toEqual(['2', '3', '4']);
    });

    it('a double negation is the positive filter again', () => {
      expect(matched({ $not: { $not: { stage: 'won' } } })).toEqual(['1']);
      expect(matched({ $not: { $not: { stage: 'won' } } })).toEqual(matched({ stage: 'won' }));
    });

    it('$not ANDs with its sibling keys', () => {
      expect(matched({ $not: { stage: 'won' }, owner: 'u1' })).toEqual(['3']);
    });
  });

  describe('operator polarity — a negation is not a blanket "and also the empty ones"', () => {
    it('$not of $ne still means "the field IS that value"', () => {
      expect(matched({ $not: { stage: { $ne: 'won' } } })).toEqual(['1']);
    });

    it('$not of $in matches the value-less records', () => {
      expect(matched({ $not: { stage: { $in: ['won'] } } })).toEqual(['2', '3', '4']);
    });

    it('$not of an ordering comparison matches the value-less records', () => {
      expect(matched({ $not: { amount: { $gt: 15 } } })).toEqual(['1', '3']);
    });

    it('$not of $contains matches the value-less records', () => {
      expect(matched({ $not: { stage: { $contains: 'w' } } })).toEqual(['2', '3', '4']);
    });

    it('$not of a null predicate', () => {
      expect(matched({ $not: { stage: { $null: true } } })).toEqual(['1', '2']);
      expect(matched({ $not: { stage: { $null: false } } })).toEqual(['3', '4']);
    });
  });

  describe('the boolean identities still hold here too (#5134)', () => {
    it('$not: {} matches nothing — NOT TRUE ≡ FALSE', () => {
      expect(matched({ $not: {} })).toEqual([]);
    });

    it('$not of an empty $or matches everything', () => {
      expect(matched({ $not: { $or: [] } })).toEqual(ALL);
    });
  });

  // ── The three cells #5299 ruled on — behaviour FROZEN, annotation current ──

  /**
   * [#5299, ruled 2026-08-10] These three cells were filed as "known
   * disagreements with `formula`, not ruled on by #5146". They are ruled now:
   * SQL's native three-valued logic is the common denominator, so **negative
   * operators never match no-value rows; the only ways to select "no value" are
   * `$exists: false` / `$null: true`.**
   *
   * ⛔ Nothing below is flipped, and the reason is not inertia. This package is
   * inside the #5499 investment freeze, and the ruling itself says
   * `checkCondition`'s early-exit guard STAYS AS IT IS. What the ruling changed
   * is the annotation: the section is no longer "a divergence nobody has ruled
   * on", it is "a ruled target, with this matcher's distance from it measured".
   *
   * Re-measured on `60f0dd8`, because the old wording had gone stale in a way
   * that mattered — it named `formula` as the key-presence reader on `$exists`,
   * and `formula` stopped being that in PR #5962 (#5298 ③ / #5369). Where each
   * cell actually stands:
   *
   *   `$exists`      CONVERGED, and this matcher was already right. Both
   *                  evaluators read "has a value"; the formula-side assertion
   *                  lives in `matches-filter-not-null-safe.test.ts`. Kept here
   *                  because the two OTHER faces of this package — the live
   *                  mingo query path and the analytics face — still read
   *                  key-presence, so the package disagrees with itself and this
   *                  test is the face that is correct.
   *   `$notContains` This matcher ALREADY answers the ruled semantics; every
   *                  other surface in the repo (including all four SQL
   *                  compilers, deliberately, via #5298's `nullSafeNegative`)
   *                  answers the opposite. Here the gap is theirs, not ours.
   *   `$nin`         HALF right: a missing key already does not match, a
   *                  present-but-null value still does. The ruled answer is "no"
   *                  for both. Frozen at this state.
   */
  describe('[#5299] the ruled no-value cells — target recorded, behaviour frozen (#5499)', () => {
    it('$nin: an ABSENT field is treated differently from a null one', () => {
      // The early `value === undefined` guard in `checkCondition` exempts only
      // `$exists` / `$ne` / `$null`, so an absent field fails `$nin` outright
      // while a null field passes it. The ruling keeps this guard; the NULL half
      // is the part still short of the ruled answer, and it is frozen.
      expect(ids(NULLED, { $not: { stage: { $nin: ['won'] } } })).toEqual(['1']);
      expect(ids(MISSING, { $not: { stage: { $nin: ['won'] } } })).toEqual(['1', '3', '4']);
    });

    it('$notContains: a value-less field does NOT satisfy it here — the RULED answer', () => {
      // `typeof null !== 'string'` → false, so the negation matches. This is
      // what #5299 ruled canonical. `formula` and all four SQL compilers answer
      // the opposite today; moving them is a cross-backend programme, not a
      // change to this file.
      expect(matched({ $not: { stage: { $notContains: 'w' } } })).toEqual(['1', '3', '4']);
    });

    it('$exists: a present-but-null field counts as NOT existing here — CONVERGED', () => {
      // Both readings of "no value" answer alike, and `formula` now agrees:
      // "has a value", the strict mirror of `$null` (#5298 ③ / #5369, PR #5962).
      // No longer a disagreement — the assertion is kept because this package's
      // other two filter faces still read key-presence.
      expect(ids(NULLED, { $not: { stage: { $exists: true } } })).toEqual(['3', '4']);
      expect(ids(MISSING, { $not: { stage: { $exists: true } } })).toEqual(['3', '4']);
      expect(ids(NULLED, { stage: { $exists: true } })).toEqual(['1', '2']);
      expect(ids(NULLED, { stage: { $exists: true } })).toEqual(ids(NULLED, { stage: { $null: false } }));
    });
  });
});
