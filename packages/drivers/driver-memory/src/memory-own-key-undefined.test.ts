// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#9276 — a declared field written as an explicit `undefined` and
 * the same field never written must be INDISTINGUISHABLE in the returned row.
 *
 * The contract is the deep equality, not the spelling. "The key is dropped" is
 * one spelling of it; pinning only that would let a future change satisfy the
 * letter (drop the key here) while breaking the rule (materialise something
 * else there), so every case asserts the two rows against each other and the
 * key-level assertion rides along as the diagnostic.
 *
 * ## What was measured before the repair (`origin/main`, built dist)
 *
 * ```
 * create('article', { id:'a1', title:'t', status: undefined })
 * find('article', {})  ->  own keys: [id, title, status, created_at, updated_at]
 *                          'status' in row : true      row.status : UNDEFINED
 * create('article', { id:'a2', title:'t2' })
 * find(...)            ->  own keys: [id, title, created_at, updated_at]
 *                          'status' in row : false
 * ```
 *
 * An own key holding `undefined` is neither of the two states a row is allowed
 * to be in, so each consumer picks a reading and they disagree: the real
 * `@objectstack/formula` CEL engine and `materializeDeclaredFields` read it as
 * ABSENT, a bare `f in row` reads it as PRESENT (objectstack#8489).
 *
 * The last two cases are the ones that make this a repair rather than a
 * behaviour change: this driver's own projection path and its own matcher
 * ALREADY read the shape as absent, so the returned row was the only surface
 * still disagreeing with the rest of the driver.
 */

import { describe, it, expect } from 'vitest';

import { InMemoryDriver } from './memory-driver.js';

const SCHEMA = {
  fields: {
    id: { type: 'text' },
    title: { type: 'text' },
    status: { type: 'text' },
  },
} as any;

const silent = { debug() {}, info() {}, warn() {}, error() {} } as any;

async function driver(config: Record<string, unknown> = {}) {
  const d = new InMemoryDriver({ logger: silent, ...config } as any);
  await d.connect();
  await d.syncSchema('article', SCHEMA);
  return d;
}

/** The row minus the three columns that legitimately differ between two rows. */
function comparable(row: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, created_at: _c, updated_at: _u, ...rest } = row;
  return rest;
}

/**
 * The contract itself: `written` (the field carried an explicit `undefined`)
 * and `neverWritten` (the field was simply absent) must be the same row.
 *
 * ⚠️ `toStrictEqual`, never `toEqual`. Measured on this repo's vitest, on the
 * exact input class this file is about:
 *
 * ```
 * expect({ a: 1, status: undefined }).toEqual({ a: 1 })        // PASSES
 * expect({ a: 1, status: undefined }).toStrictEqual({ a: 1 })  // fails
 * ```
 *
 * `toEqual` ignores own keys holding `undefined` — so spelled with it, the one
 * assertion that states the CONTRACT would be vacuous here, green against the
 * unrepaired driver, and the file would owe its whole discriminating power to
 * the key-list and `in` assertions below, which pin a SPELLING ("the key is
 * dropped") rather than the rule. Do not relax this back.
 */
function assertIndistinguishable(
  written: Record<string, unknown>,
  neverWritten: Record<string, unknown>,
) {
  expect(comparable(written)).toStrictEqual(comparable(neverWritten));
  // Diagnostic, so a failure names WHICH way the two diverged.
  expect(Object.keys(written).sort()).toEqual(Object.keys(neverWritten).sort());
  expect('status' in written).toBe('status' in neverWritten);
}

describe('#9276 an own key holding `undefined` is not a row state this driver emits', () => {
  it('find() returns the same row for "written as undefined" and "never written"', async () => {
    const d = await driver();
    await d.create('article', { id: 'a1', title: 't', status: undefined });
    await d.create('article', { id: 'a2', title: 't' });

    const rows = await d.find('article', {});
    const written = rows.find((r: any) => r.id === 'a1')!;
    const neverWritten = rows.find((r: any) => r.id === 'a2')!;

    assertIndistinguishable(written, neverWritten);
    expect('status' in written).toBe(false);
    expect(Object.keys(written)).toEqual(['id', 'title', 'created_at', 'updated_at']);
  });

  it('create() returns the same row it will hand back from find()', async () => {
    const d = await driver();
    const created = await d.create('article', { id: 'a1', title: 't', status: undefined });
    const [found] = await d.find('article', { where: { id: 'a1' } });

    expect('status' in created).toBe(false);
    expect(created).toStrictEqual(found);
  });

  it('findOne() agrees with find()', async () => {
    const d = await driver();
    await d.create('article', { id: 'a1', title: 't', status: undefined });
    await d.create('article', { id: 'a2', title: 't' });

    const written = await d.findOne('article', { where: { id: 'a1' } });
    const neverWritten = await d.findOne('article', { where: { id: 'a2' } });

    assertIndistinguishable(written as any, neverWritten as any);
  });

  it('bulkCreate() emits the same shape as create()', async () => {
    const d = await driver();
    const [written, neverWritten] = await d.bulkCreate('article', [
      { id: 'a1', title: 't', status: undefined },
      { id: 'a2', title: 't' },
    ]);

    assertIndistinguishable(written, neverWritten);
    const rows = await d.find('article', {});
    assertIndistinguishable(rows.find((r: any) => r.id === 'a1')!, rows.find((r: any) => r.id === 'a2')!);
  });

  it('update() with an explicit `undefined` CLEARS the field rather than storing the third state', async () => {
    // The prior reading is preserved exactly: every measured consumer read the
    // own-key-`undefined` this merge used to produce as "absent", and the row
    // now says absent outright. Dropping the key BEFORE the merge instead would
    // leave 'draft' standing — a different answer to what a patch carrying
    // `undefined` means, which this card does not reopen.
    const d = await driver();
    await d.create('article', { id: 'a1', title: 't', status: 'draft' });
    const updated = await d.update('article', 'a1', { status: undefined });

    expect('status' in (updated as any)).toBe(false);
    const [found] = await d.find('article', { where: { id: 'a1' } });
    expect(found).toStrictEqual(updated);
    expect('status' in found).toBe(false);
  });

  it('updateMany() with an explicit `undefined` leaves no own key behind', async () => {
    const d = await driver();
    await d.create('article', { id: 'a1', title: 't', status: 'draft' });
    await d.updateMany('article', { where: { id: 'a1' } }, { status: undefined });

    const [found] = await d.find('article', { where: { id: 'a1' } });
    expect('status' in found).toBe(false);
  });

  it('the `initialData` seeding door is normalised too — it bypasses create()', async () => {
    const d = await driver({
      initialData: {
        article: [
          { id: 'a1', title: 't', status: undefined },
          { id: 'a2', title: 't' },
        ],
      },
    });

    const rows = await d.find('article', {});
    assertIndistinguishable(rows.find((r: any) => r.id === 'a1')!, rows.find((r: any) => r.id === 'a2')!);
  });

  it('a projected read and an unprojected read now answer the same question the same way', async () => {
    // Before the repair this ONE row answered `'status' in row === false` under
    // a projection (projectFields already skips `undefined`) and `true`
    // without one.
    const d = await driver();
    await d.create('article', { id: 'a1', title: 't', status: undefined });

    const [plain] = await d.find('article', {});
    const [projected] = await d.find('article', { fields: ['id', 'title', 'status'] });

    expect('status' in plain).toBe(false);
    expect('status' in projected).toBe(false);
  });

  it('filter semantics are unchanged — the matcher already read the shape as absent', async () => {
    const d = await driver();
    await d.create('article', { id: 'a1', title: 't', status: undefined }); // written as undefined
    await d.create('article', { id: 'a2', title: 't' });                    // never written
    await d.create('article', { id: 'a3', title: 't', status: null });      // a value
    await d.create('article', { id: 'a4', title: 't', status: 'draft' });

    const ids = async (where: any) =>
      (await d.find('article', { where })).map((r: any) => r.id).sort();

    // Measured identical on `origin/main` before the repair.
    expect(await ids({ status: { $null: true } })).toEqual(['a1', 'a2', 'a3']);
    expect(await ids({ status: { $null: false } })).toEqual(['a4']);
    expect(await ids({ status: { $exists: true } })).toEqual(['a3', 'a4']);
    expect(await ids({ status: { $exists: false } })).toEqual(['a1', 'a2']);
    expect(await ids({ status: 'draft' })).toEqual(['a4']);
  });

  it('a field holding `null` stays a VALUE — the repair does not collapse the two', async () => {
    // The other arm of the card's fork ("returned as `null`") would have made
    // the two states indistinguishable in the wrong direction. `null` is a
    // value and must survive as one.
    const d = await driver();
    await d.create('article', { id: 'a1', title: 't', status: null });

    const [row] = await d.find('article', {});
    expect('status' in row).toBe(true);
    expect(row.status).toBeNull();
  });
});
