// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16810] The implicit-equality arm's two non-primitive comparand types, and
 * the third behaviour of the same operator that must NOT move.
 *
 * `checkCondition` routed `Date` and `Array` into `value == condition` and
 * called the result "exact match" two lines above. `==` between two objects
 * compares REFERENCES, so it is neither exact nor a match: a deep-equal array
 * and an equal-instant `Date` both answered `false`, fail-closed and silent —
 * fewer rows, no error, no warning, on a published driver that calls itself a
 * Reference Implementation.
 *
 * The two halves get DIFFERENT dispositions, and the difference is the
 * contract's, not this suite's:
 *
 * - **`Date` is EVALUATED.** It is a member of `ACCEPTED_FILTER_COMPARAND_TYPES`
 *   — the six types the spec's comparand door does rule — and
 *   `FILTER_COMPARAND_TYPE_CASES` requires that "a Date comparand must pass the
 *   door and execute everywhere". Refusing it would contradict a ruled cell. So
 *   it is compared by time value, exactly as `@objectstack/formula`'s `looseEq`
 *   does.
 * - **An array is REFUSED.** The door names that position and steps around it
 *   ("the ruling does not name it, so the door leaves it to the layers that
 *   already answer it"), `ACCEPTED_FILTER_COMPARAND_TYPES` has no array member,
 *   and `driver-sql` refuses one. The refusal lives in
 *   `assertFilterConditionShape`, so the live query path, this matcher and the
 *   analytics face answer it identically.
 *
 * ⚠️ The third behaviour, pinned here so a later edit cannot take it away by
 * accident: a SCALAR comparand against a stored ARRAY was untouched. `==`
 * stringified the stored array (`['a','b']` becomes `"a,b"`), which is a third
 * bad direction of the same operator — but it is on the VALUE side, and the
 * comparand door judges comparands. It was recorded, not repaired, and the
 * numbers below were the record.
 *
 * [commit b90aff81f] **That third behaviour has since been repaired, and this file's last
 * block moves with it — deliberately, not by accident.** The pin did its job:
 * it stated in one place what the VALUE side answered, so the change that moved
 * it had to come and say so here rather than sliding through as a side effect
 * of the refusal above. The cell was measured on its own card, on both faces —
 * the live query path read `['a','b']` as MEMBERSHIP where this face read the
 * joined string `"a,b"` — and the reference face converged on the live one, so
 * the numbers below are now the AGREEMENT rather than the record of a
 * divergence. ⛔ The block is rewritten, never deleted: what it exists to catch
 * — this refusal reaching the value side by accident — is still live, and the
 * assertion that the two sides stay distinct is the same assertion whichever
 * answer the value side gives.
 *
 * [#5930 step 4, ruling D6] The reference matcher had no production caller and
 * is RETIRED; this file keeps its name and holds the LIVE query path now
 * (`InMemoryDriver.find`), cell for cell. Every expectation below is the one the
 * matcher was asserted to give, and the live path gives each of them — measured
 * before the move. A `Date` comparand meets a row through a declared `datetime`
 * column, the case the equality cells were written for: that column holds
 * canonical ISO text (ADR-0053 D-B1, `memory-temporal.ts`), and so does the
 * comparand once it is put into the column's storage form (#4047). The ARRAY
 * refusal is the shared shape gate's, which the live path runs.
 */

import { describe, it, expect } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';

const INSTANT = '2026-01-01T00:00:00.000Z';

const FIELDS = {
  created_at: { type: 'datetime' },
  tags: { type: 'text' },
  qty: { type: 'number' },
  name: { type: 'text' },
};

/** A driver holding ONE row of the declared object `t`. */
async function oneRow(stored: Record<string, unknown>): Promise<InMemoryDriver> {
  const driver = new InMemoryDriver({ persistence: false });
  await driver.connect();
  await driver.syncSchema('t', { fields: FIELDS } as never);
  await driver.create('t', { id: 'r', ...stored });
  return driver;
}

/** Does the live query path select that one row? — what the matcher's `match(row, where)` answered, asked of `find()`. */
async function liveSelects(stored: Record<string, unknown>, where: unknown): Promise<boolean> {
  const rows = await (await oneRow(stored)).find('t', { where } as never);
  return rows.length === 1;
}

/** The live query path's refusal, or a sentinel when it answered. */
async function refusal(stored: Record<string, unknown>, where: unknown): Promise<unknown> {
  return (await oneRow(stored)).find('t', { where } as never).then(
    () => new Error('the live query path answered instead of refusing'),
    (err: unknown) => err,
  );
}

describe('[#16810] Date comparands are compared by time value (the live path, a declared datetime)', () => {
  it('a distinct Date object of the same instant matches', async () => {
    expect(await liveSelects({ created_at: new Date(INSTANT) }, { created_at: new Date(INSTANT) })).toBe(true);
  });

  it('a Date of a DIFFERENT instant does not match — the control for the case above', async () => {
    expect(await liveSelects({ created_at: new Date(INSTANT) }, { created_at: new Date('2026-06-01T00:00:00.000Z') }))
      .toBe(false);
  });

  it('a Date comparand matches a stored ISO STRING of the same instant', async () => {
    // The case that actually reaches a stored row: a declared `datetime` is
    // canonicalised to ISO text on write (ADR-0053 D-B1, `memory-temporal.ts`),
    // so a `Date` comparand meets a string. `==` stringified the Date to
    // "Wed Jan 01 2026 …", which no ISO value equals.
    expect(await liveSelects({ created_at: INSTANT }, { created_at: new Date(INSTANT) })).toBe(true);
  });

  it('a stored Date matches an ISO STRING comparand of the same instant — the same rule, mirrored', async () => {
    expect(await liveSelects({ created_at: new Date(INSTANT) }, { created_at: INSTANT })).toBe(true);
  });

  it('an ISO string of a different instant does not match', async () => {
    expect(await liveSelects({ created_at: new Date(INSTANT) }, { created_at: '2026-06-01T00:00:00.000Z' })).toBe(false);
  });

  it('a non-temporal string does not become a match by way of Date parsing', async () => {
    expect(await liveSelects({ created_at: new Date(INSTANT) }, { created_at: 'active' })).toBe(false);
  });

  it('an Invalid Date equals nothing, itself included', async () => {
    // JS `Date` convention (NaN time value), `formula`'s `looseEq` answer, and
    // ADR-0053 D-F1's reading that an Invalid Date has no canonical text.
    expect(await liveSelects({ created_at: new Date('nope') }, { created_at: new Date('nope') })).toBe(false);
  });

  it('$eq and $ne take the SAME equality as the implicit spelling', async () => {
    // One predicate must not answer two ways depending on which spelling the
    // author used.
    expect(await liveSelects({ created_at: new Date(INSTANT) }, { created_at: { $eq: new Date(INSTANT) } })).toBe(true);
    expect(await liveSelects({ created_at: new Date(INSTANT) }, { created_at: { $ne: new Date(INSTANT) } })).toBe(false);
    expect(await liveSelects({ created_at: INSTANT }, { created_at: { $eq: new Date(INSTANT) } })).toBe(true);
  });

  it('the ordering operators keep answering a Date comparand', async () => {
    expect(await liveSelects({ created_at: new Date(INSTANT) }, { created_at: { $gte: new Date(INSTANT) } })).toBe(true);
    expect(await liveSelects({ created_at: new Date(INSTANT) }, { created_at: { $gt: new Date(INSTANT) } })).toBe(false);
  });
});

describe('[#16810] an ARRAY comparand is refused, in the ADR-0112 envelope', () => {
  const envelope = { code: 'INVALID_FILTER', status: 400 };

  it('refuses the implicit-equality position', async () => {
    expect(await refusal({ tags: ['a', 'b'] }, { tags: ['a', 'b'] })).toMatchObject(envelope);
  });

  it('refuses an EMPTY array too — the member of the cell whose two silent answers coincided', async () => {
    expect(await refusal({ tags: [] }, { tags: [] })).toMatchObject(envelope);
  });

  it('refuses the $eq / $ne spelling of the same position', async () => {
    expect(await refusal({ tags: ['a', 'b'] }, { tags: { $eq: ['a', 'b'] } })).toMatchObject(envelope);
    expect(await refusal({ tags: ['a', 'b'] }, { tags: { $ne: ['a', 'b'] } })).toMatchObject(envelope);
  });

  it('refuses an array on the ordering operators', async () => {
    expect(await refusal({ qty: 5 }, { qty: { $gt: [1, 2] } })).toMatchObject(envelope);
  });

  it('names the position, the received shape and the accepted set', async () => {
    // The message is specific rather than generic: an author who wrote
    // `{ tags: ['a','b'] }` must be told which field, what arrived, what is
    // accepted, and which operators DO take a list.
    const message = String(((await refusal({ tags: ['a', 'b'] }, { tags: ['a', 'b'] })) as Error).message);
    expect(message).toContain('tags');
    expect(message).toContain('a string, number, bigint, boolean, null or Date');
    expect(message).toContain('$in/$nin');
    expect(message).toContain('$between');
  });

  it('leaves the LIST operators alone — an array is their declared comparand', async () => {
    expect(await liveSelects({ tags: 'a' }, { tags: { $in: ['a', 'z'] } })).toBe(true);
    expect(await liveSelects({ tags: 'a' }, { tags: { $nin: ['a', 'z'] } })).toBe(false);
    expect(await liveSelects({ qty: 5 }, { qty: { $between: [1, 10] } })).toBe(true);
  });

  it('leaves the TEXT family alone — its comparand disposition is recorded elsewhere', async () => {
    // `filter-refusal.ts` lists "a stringified comparand for the LIKE family"
    // among the shapes it deliberately does not refuse, fail-closed. This
    // refusal covers the ruled cell and does not widen past it.
    await expect(liveSelects({ name: 'alpha' }, { name: { $contains: ['a'] } })).resolves.toBeTypeOf('boolean');
  });
});

describe('[#16810/#16838] the value side is NOT the comparand side — still two cells, both now answered', () => {
  it('a scalar comparand against a stored array is MEMBERSHIP, and is not refused', async () => {
    // [commit b90aff81f] The three lines this block pinned as UNCHANGED under #16810,
    // with the two that commit b90aff81f moved and the one it did not:
    //
    //   before → after
    //   `{tags:'a'}`   vs `['a','b']`  false → true   the missing membership reading
    //   `{tags:'a,b'}` vs `['a','b']`  true  → false  the false positive, the sharper half
    //   `{tags:'a'}`   vs `['a']`      true  → true   the firing control, unmoved
    //
    // They are still asserted here, and still for #16810's reason: this file's
    // refusal is about the COMPARAND, and an edit that let it reach the VALUE
    // side would turn the first two lines into a throw. Their VALUES track the
    // value side's own ruling; the shape of the assertion — an answer, not an
    // exception — is what #16810 pinned and it is unchanged.
    expect(await liveSelects({ tags: ['a', 'b'] }, { tags: 'a' })).toBe(true);
    expect(await liveSelects({ tags: ['a', 'b'] }, { tags: 'a,b' })).toBe(false);
    expect(await liveSelects({ tags: ['a'] }, { tags: 'a' })).toBe(true);
  });

  it('the ARRAY-comparand refusal did not follow the value side — a stored array is still evaluated', async () => {
    // The invariant this block was created to hold, stated directly rather than
    // left to be inferred from the three answers above: the door refuses an
    // array in the COMPARAND position and says nothing about a stored one, so a
    // scalar comparand against any stored array must ANSWER.
    for (const stored of [['a', 'b'], ['a'], [] as unknown[], [null, 'b'], [['a']]]) {
      await expect(liveSelects({ tags: stored }, { tags: 'a' }), `stored ${JSON.stringify(stored)} was refused`)
        .resolves.toBeTypeOf('boolean');
    }
    // …while the comparand position still refuses, on the same row.
    expect(await refusal({ tags: ['a', 'b'] }, { tags: ['a', 'b'] })).toMatchObject({
      message: expect.stringMatching(/requires a single comparable value/),
    });
  });
});
