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
      // rejects it. `driver-sql` follows this answer; `driver-memory` answers
      // the opposite for a null-valued field, which is filed on its own.
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
});
