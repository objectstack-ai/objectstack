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
 * `driver-mongodb` translates it, `formula` evaluates it, and
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
 * fixture and expectations `sql-driver-not-null-safe.test.ts` and `formula`'s
 * `matches-filter-not-null-safe.test.ts` pin, so the live path is held to the
 * ruling rather than merely to "it no longer throws".
 *
 * [#5930 step 4, ruling D6] This package's reference matcher is retired. Its
 * #5146 pin (`memory-matcher-not-null-safe.test.ts`) held that record-at-a-time
 * face to the same fixture and the same ids; every one of its cells is asserted
 * here now, on the live path and on both readings of "no value", and the
 * live-vs-reference comparisons below became literal expectations — the
 * answers both faces gave when the matcher was retired.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';

import { InMemoryDriver } from './memory-driver.js';

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
   * Both readings of "no value" must give the same answer — the contract the
   * retired reference matcher's #5146 pin stated for its own face, binding on
   * the path that actually serves queries. Every caller asserts the literal ids
   * as well, so the two readings cannot pass by being wrong together.
   */
  const matched = async (where: unknown): Promise<string[]> => {
    const fromNulled = await idsFrom(nulled, where);
    const fromMissing = await idsFrom(missing, where);
    expect(fromMissing, 'a null field and an absent field must match alike').toEqual(fromNulled);
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
   *                  reading was the divergent one. CLOSED by commit 9dac1ae01: the live
   *                  path stopped handing `$exists` to mingo under its own name
   *                  and lowers it to `{$ne: null}` / `{$eq: null}` — the
   *                  spelling `$null` in the same method already used — so the
   *                  two faces agree. Ruled 2026-08-30.
   *   `$nin`         LIVE was correct. Negative operators MATCH no-value rows —
   *                  #5146, extended by #5298, re-affirmed 2026-08-10 — so a
   *                  missing key satisfying `$nin` is the affirmed answer, and
   *                  the reference matcher's early-exit guard was the
   *                  divergence. CLOSED by #13166: the guard now exempts the
   *                  negation-carrying operators, and the two faces agree.
   *   `$notContains` LIVE was correct, for the same reason. CLOSED by #13166,
   *                  through a SECOND and independent cause — the arm's
   *                  `typeof value !== 'string'` test, which rejected a `null`
   *                  on its type rather than on the predicate.
   *
   * A ruling that morning (07:33Z) would have made the REFERENCE column the
   * target on all three rows. Cells 1 and 3 of it were WITHDRAWN the same day,
   * once the reversal's cross-backend cost had been measured, and the include
   * direction was re-affirmed — which left the split above.
   *
   * ⚠️ Two of the three cells are no longer a divergence, and this block was
   * built for exactly that edit. It used to say "⛔ Nothing is flipped in either
   * direction. The #5499 investment freeze was the reason while it stood; it
   * dissolved 2026-08-11 …, so that excuse has lapsed and the direction is now
   * #13166's and [commit 9dac1ae01]'s to settle." #13166 settled its two: the `$nin` and
   * `$notContains` rows below now assert live and reference AGREEING, on the
   * affirmed include answer. They were not re-baselined onto whatever the
   * matcher began printing — the target was the live path's pre-existing
   * answer, named as correct in this very note before the fix existed.
   *
   * ⚠️ [commit 9dac1ae01, ruled 2026-08-30] The third cell has now converged too, and by
   * the same discipline: the target was the REFERENCE column, which this note
   * named correct before the fix existed, not whatever the live path began
   * printing. `driver-mongodb` — which read key-presence for its own,
   * wire-level reason — moved in the same change, so the statement this row
   * used to disprove is finally true of the whole package AND of the other
   * document-shaped backend.
   *
   * ⛔ What the row still showed, and why the pin stays: this package answered
   * with two faces. "driver-memory reads has-value" was true of the reference
   * matcher and FALSE of the live query path users actually reach, for the
   * three months between #5962 and commit 9dac1ae01.
   *
   * [#5930 step 4, ruling D6] The reference matcher is retired, so the
   * live-vs-reference columns below are asserted as the literal answer both
   * faces gave — which is the column each note already named correct — on the
   * live path, and on BOTH readings of "no value" where the matcher's own #5146
   * pin (`memory-matcher-not-null-safe.test.ts`) asserted both.
   */
  describe('[#5299] the settled cells — $nin / $notContains converged (#13166), $exists converged (#13195)', () => {
    it('$exists on a present-but-null field reads HAS-VALUE (#13195)', async () => {
      // Was `live: ['1','2','3','4']` — mingo said "the key is there" while the
      // matcher said "no value". The matcher's column was the ruling's.
      expect(await idsFrom(nulled, { stage: { $exists: true } })).toEqual(['1', '2']);
    });

    it('$exists: false on a present-but-null field returns the no-value rows (#13195)', async () => {
      // The direction the old pin never recorded, and the worse one: the live
      // path returned NOTHING for the query asking for the rows with no value.
      expect(await idsFrom(nulled, { stage: { $exists: false } })).toEqual(['3', '4']);
    });

    it('$nin on an ABSENT field includes the no-value rows (#13166)', async () => {
      // Was `reference: ['2']` — the matcher's `value === undefined` guard
      // short-circuited before the `$nin` arm ran. The LIVE column was the
      // affirmed include answer.
      expect(await idsFrom(missing, { stage: { $nin: ['won'] } })).toEqual(['2', '3', '4']);
    });

    it('$notContains on a null field: a value-less field satisfies it, so its $not excludes it (#13166)', async () => {
      // Was `reference: ['1', '3', '4']` — `typeof null !== 'string'` failed the
      // TYPE test, so the negation readmitted the null rows. The LIVE column was
      // the affirmed answer; both readings of "no value" give it.
      expect(await matched({ $not: { stage: { $notContains: 'w' } } })).toEqual(['1']);
    });

    // ── Moved from `memory-matcher-not-null-safe.test.ts` (#5930 step 4) ──────

    it('$not of $nin: an ABSENT field and a null one are treated ALIKE (#13166)', async () => {
      // The matcher's pin asserted both columns separately, because the whole
      // content of the cell is that the two readings agree.
      expect(await idsFrom(nulled, { $not: { stage: { $nin: ['won'] } } })).toEqual(['1']);
      expect(await idsFrom(missing, { $not: { stage: { $nin: ['won'] } } })).toEqual(['1']);
      expect(await matched({ $not: { stage: { $nin: ['won'] } } })).toEqual(['1']);
    });

    it('$not of $exists: a present-but-null field counts as NOT existing, on both readings (#13195)', async () => {
      expect(await idsFrom(nulled, { $not: { stage: { $exists: true } } })).toEqual(['3', '4']);
      expect(await idsFrom(missing, { $not: { stage: { $exists: true } } })).toEqual(['3', '4']);
      expect(await idsFrom(nulled, { stage: { $exists: true } })).toEqual(['1', '2']);
      expect(await idsFrom(nulled, { stage: { $exists: true } }))
        .toEqual(await idsFrom(nulled, { stage: { $null: false } }));
    });
  });
});
