// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13340] `bulkCreate` is ALL-OR-NOTHING: a refused row leaves the table
 * exactly as it found it.
 *
 * ## The defect this pins, and why the obvious assertion would not have caught it
 *
 * `bulkCreate` used to be one line — `Promise.all(dataArray.map(data =>
 * this.create(object, data, options)))` — and `create` writes into the table
 * synchronously. So when any row of a batch was refused, every row accepted
 * BEFORE it stayed in the store and the caller got a rejection describing a
 * batch that had partly landed. Measured on `main` before the fix, on a
 * two-row table whose incoming batch collides with itself:
 *
 * ```
 * before: 2 rows
 * bulkCreate([A9/Z, A9/Z]) -> rejects UNIQUE_VIOLATION / 409
 * after:  3 rows            <- the FIRST batch row landed. That is the defect.
 * ```
 *
 * ⛔ Asserting "the refusal still happens" proves NOTHING here — the refusal
 * was already correct, and #13197 / #13239 already pin it. That assertion was
 * green throughout the defect's entire life. **The discriminating fact is that
 * THE ROW COUNT DOES NOT MOVE**, so every test below reads the store after the
 * refusal rather than stopping at the envelope.
 *
 * The fix is `updateMany`'s posture, one method over: #13197 made that method
 * prepare and check every row before mutating any of it, precisely so a
 * half-applied batch cannot happen. The two batch paths of this driver now
 * give the SAME answer to "is a batch atomic?" — they disagreed for as long as
 * `bulkCreate` existed, seven lines apart in one file.
 *
 * It is also the batch posture of the family this driver stands in for:
 * `driver-sql` sends the whole batch as one insert, so a constraint failure
 * there leaves the table untouched.
 *
 * ## What this does NOT claim
 *
 * Atomicity here is the driver refusing before it writes — not a transaction.
 * There is no rollback: nothing is written until the whole batch has been
 * checked. And the store still has **no primary key** (see the boundary
 * describe at the bottom): an undeclared duplicate `id` is not a constraint
 * violation on this driver, so such a batch lands in full. Atomicity is about
 * what happens when a row IS refused, not about what gets refused.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/** Run `fn`, requiring it to reject; hand back the rejection for inspection. */
async function refusalOf(fn: () => Promise<unknown>): Promise<WireBearingError> {
  try {
    await fn();
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error('expected the driver to refuse this write, but it resolved');
}

const DOC_SCHEMA = {
  name: 'doc',
  fields: {
    id: { type: 'text' },
    doc_no: { type: 'text', unique: 'global' },
    title: { type: 'text' },
  },
} as any;

describe('[#13340] bulkCreate refuses BEFORE writing — no surviving prefix', () => {
  let driver: InMemoryDriver;

  beforeEach(async () => {
    driver = new InMemoryDriver();
    await driver.syncSchema('doc', DOC_SCHEMA);
    await driver.create('doc', { id: '1', doc_no: 'D-0001' });
    await driver.create('doc', { id: '2', doc_no: 'D-0002' });
  });

  it('a batch colliding with ITSELF leaves the row count where it was', async () => {
    // The card's own measured reading, inverted: this used to leave 3 rows.
    const err = await refusalOf(() =>
      driver.bulkCreate('doc', [
        { id: 'a', doc_no: 'D-0100' },
        { id: 'b', doc_no: 'D-0100' },
      ]),
    );
    expect(err.code).toBe('UNIQUE_VIOLATION');
    expect(err.status).toBe(409);

    expect(await driver.count('doc')).toBe(2);
    // Named explicitly: it is the row ACCEPTED BEFORE the refusal that used to
    // survive, so its absence is the whole fix.
    expect(await driver.find('doc', { fields: ['id'], where: { id: 'a' } })).toHaveLength(0);
    expect(await driver.find('doc', { fields: ['id'], where: { id: 'b' } })).toHaveLength(0);
  });

  it('a batch colliding with a STORED row leaves the row count where it was', async () => {
    // The collision is in the LAST row, so rows 'a' and 'b' were both accepted
    // before the refusal — two survivors under the old behaviour, not one.
    const err = await refusalOf(() =>
      driver.bulkCreate('doc', [
        { id: 'a', doc_no: 'D-0100' },
        { id: 'b', doc_no: 'D-0101' },
        { id: 'c', doc_no: 'D-0001' },
      ]),
    );
    expect(err.code).toBe('UNIQUE_VIOLATION');
    expect(err.status).toBe(409);

    expect(await driver.count('doc')).toBe(2);
    const survivors = await driver.find('doc', { fields: ['id'] });
    expect(survivors.map((r: any) => r.id).sort()).toEqual(['1', '2']);
  });

  it('the FIRST row colliding refuses the batch too — the check is not order-dependent', async () => {
    const err = await refusalOf(() =>
      driver.bulkCreate('doc', [
        { id: 'a', doc_no: 'D-0001' },
        { id: 'b', doc_no: 'D-0200' },
      ]),
    );
    expect(err.code).toBe('UNIQUE_VIOLATION');
    expect(await driver.count('doc')).toBe(2);
    // The row AFTER the refusal must not land either — a check that bailed out
    // of the loop but had already pushed would still pass the count above if
    // it pushed nothing, so name the later row directly.
    expect(await driver.find('doc', { fields: ['id'], where: { id: 'b' } })).toHaveLength(0);
  });

  it('a clean batch still lands in FULL and returns every row', async () => {
    // The non-vacuity control for the controls: a fix that refused everything
    // would pass every assertion above.
    const out = await driver.bulkCreate('doc', [
      { id: 'a', doc_no: 'D-0100' },
      { id: 'b', doc_no: 'D-0101' },
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((r: any) => r.doc_no)).toEqual(['D-0100', 'D-0101']);
    expect(await driver.count('doc')).toBe(4);
  });

  it('an empty batch is a no-op that resolves to an empty array', async () => {
    expect(await driver.bulkCreate('doc', [])).toEqual([]);
    expect(await driver.count('doc')).toBe(2);
  });

  it('the two batch doors of this driver now AGREE that a batch is atomic', async () => {
    // The card's actual complaint: `bulkCreate` and `updateMany` gave opposite
    // answers to one question, in one file, seven lines apart. Both are asked
    // here so the pair cannot drift apart again silently.
    const createErr = await refusalOf(() =>
      driver.bulkCreate('doc', [
        { id: 'a', doc_no: 'D-0100' },
        { id: 'b', doc_no: 'D-0100' },
      ]),
    );
    const updateErr = await refusalOf(() => driver.updateMany('doc', { where: {} }, { doc_no: 'D-0009' }));

    expect(createErr.code).toBe('UNIQUE_VIOLATION');
    expect(updateErr.code).toBe('UNIQUE_VIOLATION');
    // Neither door moved the store.
    expect(await driver.count('doc')).toBe(2);
    const rows = await driver.find('doc', { fields: ['id', 'doc_no'], orderBy: [{ field: 'id', order: 'asc' }] });
    expect(rows.map((r: any) => r.doc_no)).toEqual(['D-0001', 'D-0002']);
  });
});

describe('[#13340] the boundary — atomicity did NOT give this store a primary key', () => {
  it('an UNDECLARED duplicate `id` is still not a violation, so that batch lands in full', async () => {
    // Load-bearing for the docstring on `InMemoryDriver`, which tells readers
    // this store has no primary key and that `bulkCreate` lands two rows with
    // the same `id` where a SQL driver raises. #13340 did NOT change that: the
    // batch is refused only when a DECLARED constraint refuses a row, and
    // `id` here declares nothing. Without this test the atomicity work above
    // reads as "bulkCreate now rejects duplicate ids", which it does not.
    const driver = new InMemoryDriver();
    await driver.syncSchema('note', {
      name: 'note',
      fields: { id: { type: 'text' }, body: { type: 'text' } },
    } as any);

    const out = await driver.bulkCreate('note', [
      { id: 'dup', body: 'first' },
      { id: 'dup', body: 'second' },
    ]);

    expect(out).toHaveLength(2);
    expect(await driver.count('note')).toBe(2);
    // ...and a read returns BOTH, exactly as the docstring says.
    expect(await driver.find('note', { fields: ['id', 'body'], where: { id: 'dup' } })).toHaveLength(2);
  });

  it('an object never passed through syncSchema is unconstrained, batch included', async () => {
    const driver = new InMemoryDriver();
    const out = await driver.bulkCreate('undeclared', [{ id: 'x', v: 1 }, { id: 'x', v: 2 }]);
    expect(out).toHaveLength(2);
    expect(await driver.count('undeclared')).toBe(2);
  });
});
