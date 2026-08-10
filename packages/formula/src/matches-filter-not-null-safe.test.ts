// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5146] `$not` and absent values — the answers this evaluator gives, pinned.
 *
 * `matchesFilterCondition` needed no change for #5146: it already negates in
 * ordinary two-valued JS, so `{ $not: { stage: 'won' } }` matches a record whose
 * `stage` is null or missing. `driver-sql` used to disagree (SQL's
 * `NOT (stage = 'won')` is UNKNOWN for a NULL column, and a `WHERE` drops it),
 * so the SAME rule admitted different rows per backend — and this evaluator is
 * the RLS write-side `check`, i.e. the half that decides whether a write is
 * allowed, against read scopes compiled elsewhere. #5146 ruled this answer
 * canonical and rewrote the SQL compiler to match it.
 *
 * These cases are therefore a PIN on the reference behaviour, mirrored id-for-id
 * by `driver-sql`'s `sql-driver-not-null-safe.test.ts` and `driver-memory`'s
 * `memory-matcher-not-null-safe.test.ts`. Moving an expectation here silently
 * re-opens the divergence.
 *
 * `cel-to-filter.ts` is why this matters in practice: a CEL `!expr` in a
 * permission rule lowers to exactly these `$not` shapes.
 *
 * Home for these eventually: `FILTER_LOGIC_CASES` in `@objectstack/spec/data`
 * (spec lane, with #5239).
 */

import { describe, it, expect } from 'vitest';
import { matchesFilterCondition } from './matches-filter.js';
import type { FilterCondition } from '@objectstack/spec/data';

/** Fields present but null — how a SQL NULL round-trips into a record. */
const NULLED: Array<Record<string, unknown>> = [
  { id: '1', stage: 'won', owner: 'u1', amount: 10 },
  { id: '2', stage: 'lost', owner: 'u2', amount: 20 },
  { id: '3', stage: null, owner: 'u1', amount: null },
  { id: '4', stage: null, owner: null, amount: 40 },
];

/** The same rows with the null fields ABSENT — a partial write's post-image. */
const MISSING: Array<Record<string, unknown>> = [
  { id: '1', stage: 'won', owner: 'u1', amount: 10 },
  { id: '2', stage: 'lost', owner: 'u2', amount: 20 },
  { id: '3', owner: 'u1' },
  { id: '4', amount: 40 },
];

const ALL = ['1', '2', '3', '4'];

const ids = (rows: Array<Record<string, unknown>>, filter: unknown): string[] =>
  rows.filter((r) => matchesFilterCondition(r, filter as FilterCondition)).map((r) => String(r.id));

/** Both readings of "no value" must give the same answer unless noted. */
const matched = (filter: unknown): string[] => {
  const nulled = ids(NULLED, filter);
  expect(ids(MISSING, filter), 'a null field and an absent field must match alike').toEqual(nulled);
  return nulled;
};

describe('[#5146] matchesFilterCondition — $not over records with no value', () => {
  describe('a record with no value does not satisfy the negated condition', () => {
    it('$not on an implicit equality matches the value-less records', () => {
      expect(matched({ $not: { stage: 'won' } })).toEqual(['2', '3', '4']);
    });

    it('$not over multiple keys matches a record missing EITHER', () => {
      expect(matched({ $not: { stage: 'won', owner: 'u1' } })).toEqual(['2', '3', '4']);
    });

    it('the RLS shape: a CEL `!(stage == "won")` check keeps stage-less records', () => {
      expect(matched({ $not: { stage: 'won' } })).toHaveLength(3);
    });
  });

  describe('nesting', () => {
    it('$not of a $or rejects a value-less record whose OTHER branch matches', () => {
      // Record 3 has no stage but owner = 'u1', so the $or holds and the
      // negation rejects it. This is the case that forced `driver-sql` to put
      // its NULL guard on each leaf rather than beside the `NOT`.
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

    it('$not of $nin still means "the field IS among them"', () => {
      expect(matched({ $not: { stage: { $nin: ['won'] } } })).toEqual(['1']);
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

    it('$not of $notContains does NOT match them — the mirror case', () => {
      // A value-less field satisfies `$notContains` here, so the negation
      // rejects it. `driver-sql` follows this answer; `driver-memory`'s
      // REFERENCE matcher answers the opposite for a null-valued field.
      //
      // ⚠️ [#5299, ruled 2026-08-10] This is the SUPERSEDED direction — see the
      // block at the bottom of this file for the ruled target and the measured
      // reason nothing has moved yet.
      expect(matched({ $not: { stage: { $notContains: 'w' } } })).toEqual(['1']);
    });

    it('$not of a null predicate', () => {
      expect(matched({ $not: { stage: { $null: true } } })).toEqual(['1', '2']);
      expect(matched({ $not: { stage: { $null: false } } })).toEqual(['3', '4']);
      expect(matched({ $not: { stage: null } })).toEqual(['1', '2']);
      expect(matched({ $not: { stage: { $eq: null } } })).toEqual(['1', '2']);
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

  // ── `$exists` — RULED on #5298, and this evaluator is the side that moved ──

  describe('[#5298/#5369] $exists means "has a value", the strict mirror of $null', () => {
    /**
     * FLIPPED PIN. This block used to sit under "known disagreement with
     * driver-memory (NOT ruled on by #5146)" and pinned the OPPOSITE answer for
     * `NULLED`: `$exists` read "the key is present", so a present-but-null
     * `stage` EXISTED and the negation matched nothing.
     *
     * The 2026-08-06 ruling on #5298 took "has a value". The deciding argument
     * is that the other reading is unimplementable where it matters: a SQL
     * column IS the schema, so a row cannot have an absent key, and `driver-sql`
     * has always compiled `$exists` to `IS NOT NULL`. Field existence is a
     * property of the schema, not of the record — a spec that declared
     * otherwise would be promising a semantics two of its backends can never
     * deliver. `driver-sql`'s emitter is therefore unchanged; THIS evaluator is
     * the one that moved.
     */
    it('a present-but-null field does NOT exist', () => {
      expect(ids(NULLED, { stage: { $exists: true } })).toEqual(['1', '2']);
      expect(ids(NULLED, { $not: { stage: { $exists: true } } })).toEqual(['3', '4']);
    });

    it('a missing key answers exactly as a present-but-null one does', () => {
      // The two fixtures differ only in whether row 3/4 carry the key at all.
      // Under "has a value" they are the same fact, so the answers must match —
      // which is the property the old `!== undefined` reading broke.
      for (const filter of [
        { stage: { $exists: true } },
        { stage: { $exists: false } },
        { $not: { stage: { $exists: true } } },
      ] as const) {
        expect(ids(NULLED, filter), JSON.stringify(filter)).toEqual(ids(MISSING, filter));
      }
    });

    it('$exists is the strict complement of $null, comparand for comparand', () => {
      for (const fixture of [NULLED, MISSING]) {
        expect(ids(fixture, { stage: { $exists: true } })).toEqual(ids(fixture, { stage: { $null: false } }));
        expect(ids(fixture, { stage: { $exists: false } })).toEqual(ids(fixture, { stage: { $null: true } }));
      }
    });
  });

  // ── The NON-negated negatives — pinned against a ruling that has not landed ─

  /**
   * [#5299, ruled 2026-08-10] The maintainer took SQL's native three-valued
   * logic as the common denominator: **negative operators never match no-value
   * rows; the only ways to select "no value" are `$exists: false` /
   * `$null: true`.** Under that rule this evaluator answers `['2']` below.
   *
   * It answers `['2','3','4']`, and that is pinned here rather than fixed,
   * because flipping it ALONE would re-open the exact hole PR #5962 closed. That
   * PR converged `formula` (the RLS write-side `check`) and `read-scope-sql`
   * (the read-side lowering) in ONE change precisely because they are
   * security-coupled: one policy string must not admit two row sets. Every SQL
   * face still emits `nullSafeNegative` for these two operators
   * (`col IS NULL OR col NOT IN (…)`), so a formula-only flip would make an RLS
   * `check` DENY a write on a null field that the read scope still RETURNS —
   * #5962's defect with the sign reversed.
   *
   * So these assertions are load-bearing in both directions. They say what this
   * evaluator does today, and they are the tripwire the cross-backend PR must
   * step on: whoever lands the ruled semantics changes these lines DELIBERATELY,
   * in the same PR that moves `driver-sql`, `read-scope-sql`, `filter-normalizer`
   * and `driver-turso`'s remote transport — not one evaluator at a time.
   *
   * The full eleven-surface measurement and the enrolment blocker (the
   * conformance ledger has no per-row DEBT, and two of the five scored drivers
   * are inside the #5499 freeze) are recorded on family 4 in
   * `@objectstack/spec`'s `filter-logic-conformance.ts` header.
   */
  describe('[#5299] $notContains / $nin over a value-less field — the pre-ruling answer', () => {
    it('$notContains MATCHES a value-less field — ruled target is that it must NOT', () => {
      expect(matched({ stage: { $notContains: 'w' } })).toEqual(['2', '3', '4']);
    });

    it('$nin MATCHES a value-less field — ruled target is that it must NOT', () => {
      expect(matched({ stage: { $nin: ['won'] } })).toEqual(['2', '3', '4']);
    });

    it('$ne answers identically — one family, and the reason a partial flip is incoherent', () => {
      // `$nin` is the list form of `$ne`, and `$ne` is ENROLLED in
      // `FILTER_LOGIC_CASES` asserting exactly this row set. Moving `$nin`
      // without `$ne` splits this evaluator against itself and against the gate.
      expect(matched({ stage: { $ne: 'won' } })).toEqual(['2', '3', '4']);
      expect(matched({ stage: { $nin: ['won'] } })).toEqual(matched({ stage: { $ne: 'won' } }));
    });

    it('the ruled ESCAPE HATCH already works, in both directions', () => {
      // Whatever happens to the three cells above, the rule's second half is
      // already true here: "no value" is selectable, precisely, today.
      expect(matched({ stage: { $exists: false } })).toEqual(['3', '4']);
      expect(matched({ stage: { $null: true } })).toEqual(['3', '4']);
      expect(matched({ stage: { $exists: true } })).toEqual(['1', '2']);
    });
  });
});
