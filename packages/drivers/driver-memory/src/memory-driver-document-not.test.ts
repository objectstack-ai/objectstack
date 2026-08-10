// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5324] Document-level `$not` on the LIVE query path — the shape the issue was
 * filed on.
 *
 * # Why this is implemented and not refused
 *
 * #5324 offered both directions and deliberately declined to choose. The
 * evidence chooses: `$not` is a DECLARED combinator (`LOGICAL_OPERATORS` in
 * `@objectstack/spec/data`, alongside `$and`/`$or`), `driver-sql` compiles it,
 * `driver-mongodb` translates it, `memory-matcher` evaluates it, and
 * `FILTER_LOGIC_CASES` — the standard every backend is held to — contains a case
 * that requires it. Refusing it would have made this driver the only backend
 * that cannot run a spec-declared operator, and would have left the conformance
 * table with a case it could never pass. "Refuse what you cannot evaluate" has a
 * companion clause: what the contract DECLARES, you evaluate.
 *
 * So the general refusal in `memory-filter-vocabulary-refusal.test.ts` covers
 * every operator the Filter Protocol does not declare, and this file covers the
 * one it does.
 *
 * # The rewrite, and why `$nor`
 *
 * mingo is a MongoDB-semantics engine, and MongoDB has no document-level `$not`
 * — `unknown top level operator: $not`, uncoded, was the whole of #5324. The
 * negation of a whole condition in MongoDB is `$nor` with a single operand, and
 * that is exactly the rewrite `driver-mongodb` performs for the same reason
 * (#4405). Nothing else about the condition changes.
 *
 * # Why the null cases are the load-bearing ones
 *
 * `cel-to-filter.ts` lowers a CEL `!expr` to `{ $not: {…} }`, which is the
 * ordinary product of an RLS read scope — so this operator decides who sees
 * which rows. #5146 ruled the JS backends' two-valued reading canonical and
 * rewrote `driver-sql`'s SQL to match it, because SQL's `NOT (col = x)` is
 * UNKNOWN for a NULL column and a `WHERE` drops the row. `$nor` is total by
 * construction and lands on the same answer — asserted below against the exact
 * fixture and expectations `memory-matcher-not-null-safe.test.ts` pins, so the
 * live path is held to the ruling rather than merely to "it no longer throws".
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';

import { InMemoryDriver } from './memory-driver.js';
import { match } from './memory-matcher.js';

/** Fields present but null — how a SQL NULL round-trips into a record. */
const NULLED = [
  { id: '1', stage: 'won', owner: 'u1', amount: 10 },
  { id: '2', stage: 'lost', owner: 'u2', amount: 20 },
  { id: '3', stage: null, owner: 'u1', amount: null },
  { id: '4', stage: null, owner: null, amount: 40 },
];

/** The same rows with the null fields ABSENT — the shape a partial write leaves. */
const MISSING = [
  { id: '1', stage: 'won', owner: 'u1', amount: 10 },
  { id: '2', stage: 'lost', owner: 'u2', amount: 20 },
  { id: '3', owner: 'u1' },
  { id: '4', amount: 40 },
];

const ALL = ['1', '2', '3', '4'];

const FIELDS = {
  id: { type: 'text', name: 'id' },
  stage: { type: 'text', name: 'stage' },
  owner: { type: 'text', name: 'owner' },
  amount: { type: 'number', name: 'amount' },
};

describe('[#5324] InMemoryDriver.find compiles a document-level $not', () => {
  let nulled: InMemoryDriver;
  let missing: InMemoryDriver;

  beforeAll(async () => {
    nulled = new InMemoryDriver({ persistence: false });
    await nulled.syncSchema('deal', { fields: FIELDS });
    for (const row of NULLED) await nulled.create('deal', { ...row });

    missing = new InMemoryDriver({ persistence: false });
    await missing.syncSchema('deal', { fields: FIELDS });
    for (const row of MISSING) await missing.create('deal', { ...row });
  });

  const idsFrom = async (driver: InMemoryDriver, where: unknown): Promise<string[]> => {
    const rows = await driver.find('deal', { fields: ['id'], where: where as FilterCondition });
    return (rows as Array<Record<string, unknown>>).map((r) => String(r.id)).sort();
  };

  /**
   * Both readings of "no value" must give the same answer, and the reference
   * matcher must give it too — the same contract
   * `memory-matcher-not-null-safe.test.ts` states for its own face, now binding
   * on the path that actually serves queries.
   */
  const matched = async (where: unknown): Promise<string[]> => {
    const fromNulled = await idsFrom(nulled, where);
    const fromMissing = await idsFrom(missing, where);
    expect(fromMissing, 'a null field and an absent field must match alike').toEqual(fromNulled);
    const reference = NULLED.filter((r) => match(r, where)).map((r) => r.id);
    expect(fromNulled, 'the live query path and the reference matcher must agree').toEqual(reference);
    return fromNulled;
  };

  describe('the shape #5324 reported — every position, not just the top level', () => {
    it('at the top level', async () => {
      expect(await matched({ $not: { stage: 'won' } })).toEqual(['2', '3', '4']);
    });

    it('inside a $or branch', async () => {
      // The issue measured all three of these throwing `unknown top level
      // operator: $not`; `normalizeFilterCondition` passed `$not` through
      // wherever it sat, so nesting never helped.
      expect(await matched({ $or: [{ $not: { stage: 'won' } }] })).toEqual(['2', '3', '4']);
    });

    it('inside a $and branch', async () => {
      expect(await matched({ $and: [{ $not: { stage: 'won' } }] })).toEqual(['2', '3', '4']);
    });

    it('ANDs with its sibling keys', async () => {
      expect(await matched({ $not: { stage: 'won' }, owner: 'u1' })).toEqual(['3']);
    });

    it('nested two combinators deep', async () => {
      expect(await matched({ $and: [{ $or: [{ $not: { stage: 'won' }, owner: 'u1' }] }] })).toEqual(['3']);
    });

    it('the RLS shape a CEL `!(stage == "won")` scope lowers to', async () => {
      // `cel-to-filter.ts` emits exactly this for a negated read scope. On this
      // driver — the default for dev and test — it used to be an uncoded throw
      // on every query the scope touched, not a wrong row count.
      expect(await matched({ $not: { stage: 'won' } })).toHaveLength(3);
    });
  });

  describe('the #5146 canon, now answered by the live path too', () => {
    it('$not over multiple keys matches a record missing EITHER', async () => {
      expect(await matched({ $not: { stage: 'won', owner: 'u1' } })).toEqual(['2', '3', '4']);
    });

    it('$not of a $or rejects a value-less record whose OTHER branch matches', async () => {
      // Record 3 has no stage but owner = 'u1', so the $or holds and the
      // negation must reject it. This is the case that forced `driver-sql` to
      // compile its NULL guard onto each leaf instead of beside the `NOT`.
      expect(await matched({ $not: { $or: [{ stage: 'won' }, { owner: 'u1' }] } })).toEqual(['2', '4']);
    });

    it('$not of a $and matches every record failing either conjunct', async () => {
      expect(await matched({ $not: { $and: [{ stage: 'won' }, { owner: 'u1' }] } })).toEqual(['2', '3', '4']);
    });

    it('a double negation is the positive filter again', async () => {
      expect(await matched({ $not: { $not: { stage: 'won' } } })).toEqual(['1']);
      expect(await matched({ $not: { $not: { stage: 'won' } } })).toEqual(await matched({ stage: 'won' }));
    });

    it('$not of $ne still means "the field IS that value"', async () => {
      expect(await matched({ $not: { stage: { $ne: 'won' } } })).toEqual(['1']);
    });

    it('$not of $in matches the value-less records', async () => {
      expect(await matched({ $not: { stage: { $in: ['won'] } } })).toEqual(['2', '3', '4']);
    });

    it('$not of an ordering comparison matches the value-less records', async () => {
      expect(await matched({ $not: { amount: { $gt: 15 } } })).toEqual(['1', '3']);
    });

    it('$not of $contains matches the value-less records', async () => {
      expect(await matched({ $not: { stage: { $contains: 'w' } } })).toEqual(['2', '3', '4']);
    });

    it('$not of a null predicate', async () => {
      expect(await matched({ $not: { stage: { $null: true } } })).toEqual(['1', '2']);
      expect(await matched({ $not: { stage: { $null: false } } })).toEqual(['3', '4']);
    });
  });

  describe('the boolean identities (#5134)', () => {
    it('$not: {} matches nothing — NOT TRUE ≡ FALSE', async () => {
      expect(await matched({ $not: {} })).toEqual([]);
    });

    it('$not of an empty $or matches everything', async () => {
      expect(await matched({ $not: { $or: [] } })).toEqual(ALL);
    });
  });

  /**
   * Measured while verifying this fix, and NOT caused by it: three operators
   * answer a value-less field differently on the two faces, with or without a
   * `$not` around them. mingo reads `$exists` as key presence and lets `$nin`
   * match a missing key; the matcher's `value === undefined` guard and its
   * `typeof value !== 'string'` test answer the opposite.
   *
   * This is a SEMANTIC divergence, not a shape one, so the gate this PR adds
   * neither causes nor cures it — a ruling on which reading is canonical belongs
   * with the identical matcher-vs-formula divergence already filed as **#5299**,
   * where this measurement is recorded. Pinned as measured so the fix that lands
   * there has to move these lines deliberately.
   *
   * ⚠️ [#5299, settled 2026-08-10] The semantics are settled, and neither column
   * below is wholly right — they are correct on complementary rows:
   *
   *   `$exists`      REFERENCE is correct. `$exists` means "has a value"
   *                  (#5298 ③ / #5369, PR #5962), so mingo's key-presence
   *                  reading is the divergent one.
   *   `$nin`         LIVE is correct. Negative operators MATCH no-value rows —
   *                  #5146, extended by #5298, re-affirmed 2026-08-10 — so a
   *                  missing key satisfying `$nin` is the affirmed answer, and
   *                  the reference matcher's early-exit guard is the divergence.
   *   `$notContains` LIVE is correct, for the same reason.
   *
   * A ruling that morning (07:33Z) would have made the REFERENCE column the
   * target on all three rows. Cells 1 and 3 of it were WITHDRAWN the same day,
   * once the reversal's cross-backend cost had been measured, and the include
   * direction was re-affirmed — which leaves the split above.
   *
   * ⛔ Nothing is flipped in either direction: this package is inside the #5499
   * investment freeze. What the round trip confirmed is exactly why this pin
   * exists — this package answers with two different faces, so a statement like
   * "driver-memory already reads has-value" is true of the reference matcher and
   * FALSE of the live query path users actually reach.
   */
  describe('[#5299] the settled cells, live vs reference — behaviour frozen (#5499)', () => {
    const liveVsReference = async (where: unknown) => ({
      live: await idsFrom(nulled, where),
      reference: NULLED.filter((r) => match(r, where)).map((r) => r.id),
    });

    it('$exists on a present-but-null field: mingo says "the key is there", the matcher says "no value"', async () => {
      expect(await liveVsReference({ stage: { $exists: true } })).toEqual({
        live: ['1', '2', '3', '4'],
        reference: ['1', '2'],
      });
    });

    it('$nin on an ABSENT field', async () => {
      const live = await idsFrom(missing, { stage: { $nin: ['won'] } });
      const reference = MISSING.filter((r) => match(r, { stage: { $nin: ['won'] } })).map((r) => r.id);
      expect({ live, reference }).toEqual({ live: ['2', '3', '4'], reference: ['2'] });
    });

    it('$notContains on a null field', async () => {
      expect(await liveVsReference({ $not: { stage: { $notContains: 'w' } } })).toEqual({
        live: ['1'],
        reference: ['1', '3', '4'],
      });
    });
  });
});
