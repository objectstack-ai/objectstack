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

  // ── The three #5299 cells — behaviour FROZEN, annotation current ───────────

  /**
   * [#5299, settled 2026-08-10] These three cells were filed as "known
   * disagreements with `formula`, not ruled on by #5146". They are settled now,
   * and the settled direction is INCLUDE: `$ne` / `$nin` / `$notContains` MATCH
   * a no-value row (#5146, extended by #5298, shipped across eleven surfaces),
   * and `$exists` means "has a value" (#5298 ③ / #5369, PR #5962).
   *
   * A ruling on 2026-08-10 07:33Z briefly went the other way — SQL's native
   * three-valued logic as the common denominator, negative operators never
   * matching no-value rows — which would have made this matcher's answers below
   * the canonical ones. Cells 1 and 3 of it were WITHDRAWN the same day, once
   * the reversal's cross-backend cost had been measured, and include was
   * re-affirmed. `$exists` = has-value is the leg that stands.
   *
   * ⛔ Nothing below is flipped, and the reason is not inertia: this package is
   * inside the #5499 investment freeze, and both rulings leave `checkCondition`'s
   * early-exit guard exactly as it is. So this section is what it always was — a
   * measured divergence from the platform answer, pinned rather than harmonised
   * — with its wording brought current.
   *
   * Re-measured on `60f0dd8`, because the old wording had gone stale in a way
   * that mattered — it named `formula` as the key-presence reader on `$exists`,
   * and `formula` stopped being that in PR #5962. Where each cell stands against
   * the affirmed include direction:
   *
   *   `$exists`      CONVERGED, and this matcher was already right. Both
   *                  evaluators read "has a value"; the formula-side assertion
   *                  lives in `matches-filter-not-null-safe.test.ts`. Kept here
   *                  because the two OTHER faces of this package — the live
   *                  mingo query path and the analytics face — still read
   *                  key-presence, so the package disagrees with itself and this
   *                  test is the face that is correct.
   *   `$notContains` DIVERGES: a value-less field does not satisfy it here,
   *                  while `formula` and all four SQL compilers say it does —
   *                  deliberately, via #5298's `nullSafeNegative`. This matcher
   *                  is the odd one out among the eleven surfaces, and frozen.
   *   `$nin`         HALF converged: a present-but-null value already matches,
   *                  as the affirmed direction requires; a MISSING key still
   *                  does not, because the early-exit guard does not exempt
   *                  `$nin`. Frozen at this state.
   */
  describe('[#5299] the settled no-value cells — divergence measured, behaviour frozen (#5499)', () => {
    it('$nin: an ABSENT field is treated differently from a null one', () => {
      // The early `value === undefined` guard in `checkCondition` exempts only
      // `$exists` / `$ne` / `$null`, so an absent field fails `$nin` outright
      // while a null field passes it. The guard stays; the MISSING half is the
      // part still short of the affirmed include answer, and it is frozen.
      expect(ids(NULLED, { $not: { stage: { $nin: ['won'] } } })).toEqual(['1']);
      expect(ids(MISSING, { $not: { stage: { $nin: ['won'] } } })).toEqual(['1', '3', '4']);
    });

    it('$notContains: a value-less field does NOT satisfy it here — DIVERGENT', () => {
      // `typeof null !== 'string'` → false, so the negation matches. The
      // affirmed direction is the opposite: `formula` and all four SQL compilers
      // say a value-less field DOES satisfy `$notContains`, and #5299 re-affirmed
      // that on 2026-08-10. This matcher stays where it is under #5499.
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
