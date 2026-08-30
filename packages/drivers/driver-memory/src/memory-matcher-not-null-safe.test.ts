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

  // ── The three #5299 cells — two CONVERGED (#13166), one still open ─────────

  /**
   * [#5299, settled 2026-08-10; the `$nin` / `$notContains` cells closed by
   * #13166] These three cells were filed as "known disagreements with
   * `formula`, not ruled on by #5146". They are settled, and the settled
   * direction is INCLUDE: `$ne` / `$nin` / `$notContains` MATCH a no-value row
   * (#5146, extended by #5298, shipped across eleven surfaces), and `$exists`
   * means "has a value" (#5298 ③ / #5369, PR #5962).
   *
   * A ruling on 2026-08-10 07:33Z briefly went the other way — SQL's native
   * three-valued logic as the common denominator, negative operators never
   * matching no-value rows — which would have made this matcher's FORMER
   * answers the canonical ones. Cells 1 and 3 of it were WITHDRAWN the same
   * day, once the reversal's cross-backend cost had been measured, and include
   * was re-affirmed. `$exists` = has-value is the leg that stands.
   *
   * ⚠️ The `$nin` and `$notContains` assertions below are INVERTED as of
   * #13166, and what stood here before was the stated reason they had not been:
   * "⛔ Nothing below is flipped, and the reason is not inertia: this package is
   * inside the #5499 investment freeze, and both rulings leave
   * `checkCondition`'s early-exit guard exactly as it is." That reason expired.
   * The freeze dissolved on 2026-08-11 (head note of `@objectstack/spec`'s
   * `aggregation-conformance.ts`), which left the divergence unexcused AND
   * untracked — the DEBT ledger in `scripts/check-driver-conformance.mjs` never
   * carried it, its granularity being per (driver × case-set). That is what
   * #13166 was raised on, and it moved the guard rather than the ruling.
   *
   * ⛔ These lines were NOT re-baselined to whatever the matcher started
   * printing. They are inverted deliberately, ONTO the answer `formula` and all
   * four SQL compilers already gave — which is this file's whole point: it is
   * the reference `driver-sql` was aligned to, so an edit here has to be a
   * decision. `sql-driver-not-null-safe.test.ts` is unchanged by #13166 and
   * still asserts `['1']` for both filters below; the two files agree again
   * because this one moved TO the SQL family, not the family to it.
   *
   * Where each cell stands against the affirmed include direction:
   *
   *   `$exists`      CONVERGED, and this matcher was already right. Both
   *                  evaluators read "has a value"; the formula-side assertion
   *                  lives in `matches-filter-not-null-safe.test.ts`. Kept here
   *                  because the two OTHER faces of this package — the live
   *                  mingo query path and the analytics face — still read
   *                  key-presence, so the package disagrees with itself and this
   *                  test is the face that is correct. ⛔ That remaining gap is
   *                  the neighbouring cell (#13195), not this one: it has a
   *                  different backend list and was deliberately left alone.
   *   `$notContains` CONVERGED by #13166. The arm's `typeof value !== 'string'`
   *                  test rejected a `null` on its TYPE rather than on the
   *                  predicate, so a value-less field failed a negation it
   *                  should satisfy. The arm now answers the no-value readings
   *                  from `noValueSatisfiesNegation` first.
   *   `$nin`         CONVERGED by #13166. A present-but-null value already
   *                  matched; a MISSING key did not, because the early-exit
   *                  guard's allowlist named `$ne` and not `$nin`. A SECOND and
   *                  independent cause from the one above, reachable only from
   *                  the other reading of "no value" — which is why the fixture
   *                  carries both columns and why one cause could be fixed
   *                  while the other stood.
   */
  describe('[#5299] the settled no-value cells — $nin / $notContains converged (#13166)', () => {
    it('$nin: an ABSENT field and a null one are now treated ALIKE', () => {
      // Was: NULLED answered `['1']` and MISSING answered `['1', '3', '4']`.
      // The divergence was never in the null column — it was the guard turning
      // an absent key into "no match" before the `$nin` arm ran. Both columns
      // are asserted separately rather than only through `matched()`, because
      // the whole content of this cell is that the two readings agree.
      expect(ids(NULLED, { $not: { stage: { $nin: ['won'] } } })).toEqual(['1']);
      expect(ids(MISSING, { $not: { stage: { $nin: ['won'] } } })).toEqual(['1']);
      expect(matched({ $not: { stage: { $nin: ['won'] } } })).toEqual(['1']);
    });

    it('$notContains: a value-less field DOES satisfy it — converged', () => {
      // Was `['1', '3', '4']`: `typeof null !== 'string'` answered false, so the
      // negation readmitted the value-less rows. `formula` and all four SQL
      // compilers answer `['1']` — this matcher was the odd one out among the
      // eleven surfaces, and is not any more.
      expect(matched({ $not: { stage: { $notContains: 'w' } } })).toEqual(['1']);
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
