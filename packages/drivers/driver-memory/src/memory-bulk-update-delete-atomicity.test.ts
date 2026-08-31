// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13435] `bulkUpdate` and `bulkDelete` are ALL-OR-NOTHING: a refused row
 * leaves the table exactly as it found it.
 *
 * ## The defect this pins, and why "it still throws" would not have caught it
 *
 * Both doors used to be `Promise.all(map(...))` over `update`/`delete`, and
 * both of THOSE write into the table synchronously. So when one row of a
 * batch was refused — `UNIQUE_VIOLATION`/409 on `bulkUpdate`, a missing-id
 * throw under `strictMode` on `bulkDelete` — every row processed BEFORE it
 * stayed mutated, and the caller got a rejection describing a batch that had
 * partly landed. #13340 measured the identical shape on `bulkCreate`; these
 * are the third and fourth batch doors it did not reach.
 *
 * ⛔ Asserting "the refusal still happens" proves NOTHING here — the refusal
 * was already correct (#13197/#13239 pin `assertUnique`, `delete`'s own
 * strict-mode throw predates this file). **The discriminating fact is that
 * the TABLE DOES NOT MOVE**, so every test below reads the store back after
 * the refusal — full rows, not just a count — rather than stopping at the
 * envelope.
 *
 * ## The construction, and why it is NOT `updateMany`'s shape copied over
 *
 * `updateMany` stamps ONE shared `data` onto every matched row and has no
 * per-row pre-image to exclude. `bulkCreate` has no pre-image at all (every
 * row is new). `bulkUpdate` is neither: each id in the batch carries its OWN
 * patch, so the fix needed new construction — per pending row, its own
 * `exceptId` AND a projected row set holding the OTHER rows' post-images
 * while dropping their pre-images — not a transcription of either sibling.
 *
 * ## What this does NOT claim
 *
 * Atomicity here is the driver refusing before it writes — not a
 * transaction, and no rollback: nothing is written until the whole batch has
 * been checked (`bulkUpdate`) or resolved to indices (`bulkDelete`).
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

/** The whole table, sorted by `id` — used to prove BYTE-IDENTITY, not just a count. */
async function snapshot(driver: InMemoryDriver, object: string) {
  const rows = await driver.find(object, {});
  return rows.slice().sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));
}

describe('[#13435] bulkUpdate refuses BEFORE writing — no surviving prefix', () => {
  let driver: InMemoryDriver;

  beforeEach(async () => {
    driver = new InMemoryDriver();
    await driver.syncSchema('doc', DOC_SCHEMA);
    await driver.create('doc', { id: '1', doc_no: 'D-0001', title: 'One' });
    await driver.create('doc', { id: '2', doc_no: 'D-0002', title: 'Two' });
    await driver.create('doc', { id: '3', doc_no: 'D-0003', title: 'Three' });
  });

  it('a batch colliding WITHIN itself leaves the table byte-identical', async () => {
    const before = await snapshot(driver, 'doc');

    const err = await refusalOf(() =>
      driver.bulkUpdate('doc', [
        { id: '1', data: { doc_no: 'D-0100' } },
        { id: '2', data: { doc_no: 'D-0100' } }, // collides with the row above, not with the table
      ]),
    );
    expect(err.code).toBe('UNIQUE_VIOLATION');
    expect(err.status).toBe(409);

    // Named explicitly: it is row '1' — accepted BEFORE the refusal under the
    // old `Promise.all` shape — whose survival used to be the defect.
    const after = await snapshot(driver, 'doc');
    expect(after).toEqual(before);
    expect((await driver.find('doc', { where: { id: '1' } }))[0].doc_no).toBe('D-0001');
  });

  it('a batch colliding with a STORED, UNTOUCHED row leaves the table byte-identical', async () => {
    const before = await snapshot(driver, 'doc');
    // Row '1' would be accepted (no collision on its own) before row '2'
    // collides with row '3' — untouched by this batch, so it sits in
    // `settled` — under the old `Promise.all` shape row '1' would have
    // landed as a survivor before the second `update()` call threw.
    const err = await refusalOf(() =>
      driver.bulkUpdate('doc', [
        { id: '1', data: { doc_no: 'D-0100' } },
        { id: '2', data: { doc_no: 'D-0003' } }, // row '3's stored value — untouched by this batch
      ]),
    );
    expect(err.code).toBe('UNIQUE_VIOLATION');
    expect(err.status).toBe(409);

    const after = await snapshot(driver, 'doc');
    expect(after).toEqual(before);
  });

  it('the FIRST row colliding refuses the batch too — the check is not order-dependent', async () => {
    const before = await snapshot(driver, 'doc');
    // Row '1' collides with STORED untouched row '3' on the very first
    // iteration; row '2's patch is unrelated and would still land under a
    // check that bailed out of the loop but had already pushed nothing.
    const err = await refusalOf(() =>
      driver.bulkUpdate('doc', [
        { id: '1', data: { doc_no: 'D-0003' } }, // row '3's stored value — collides immediately
        { id: '2', data: { doc_no: 'D-0300' } },
      ]),
    );
    expect(err.code).toBe('UNIQUE_VIOLATION');
    const after = await snapshot(driver, 'doc');
    expect(after).toEqual(before);
    // The row AFTER the refusal must not land either — named directly, not
    // just inferred from the full-snapshot equality above.
    expect((await driver.find('doc', { where: { id: '2' } }))[0].doc_no).toBe('D-0002');
  });

  it('a clean batch still lands in FULL and returns every updated row', async () => {
    // The non-vacuity control: a fix that refused everything would pass every
    // assertion above.
    const out = await driver.bulkUpdate('doc', [
      { id: '1', data: { doc_no: 'D-0100' } },
      { id: '2', data: { doc_no: 'D-0200' } },
    ]);
    expect(out.map((r: any) => r.doc_no)).toEqual(['D-0100', 'D-0200']);
    expect((await driver.find('doc', { where: { id: '1' } }))[0].doc_no).toBe('D-0100');
    expect((await driver.find('doc', { where: { id: '2' } }))[0].doc_no).toBe('D-0200');
  });

  it('a row that keeps its OWN unique value (untouched field) does not collide with itself', async () => {
    // exceptId must still exclude a row from its own pre-image when the patch
    // does not touch the unique field.
    const out = await driver.bulkUpdate('doc', [{ id: '1', data: { title: 'Renamed' } }]);
    expect(out[0].doc_no).toBe('D-0001');
    expect(out[0].title).toBe('Renamed');
  });

  it('an empty batch is a no-op that resolves to an empty array', async () => {
    const before = await snapshot(driver, 'doc');
    expect(await driver.bulkUpdate('doc', [])).toEqual([]);
    expect(await snapshot(driver, 'doc')).toEqual(before);
  });

  describe('non-strict missing id (default `strictMode`)', () => {
    it('a missing id is SKIPPED (no placeholder); the rest of the batch still lands', async () => {
      // `IDataDriver.bulkUpdate` is declared `Promise<Record<string, unknown>[]>`
      // — no `null` member — so a skipped id is OMITTED, not padded, mirroring
      // `SqlDriver.bulkUpdate`'s own `if (updated) results.push(updated)`.
      const out = await driver.bulkUpdate('doc', [
        { id: 'ghost', data: { doc_no: 'D-9999' } },
        { id: '1', data: { doc_no: 'D-0100' } },
      ]);
      expect(out).toHaveLength(1);
      expect(out[0].doc_no).toBe('D-0100');
      expect((await driver.find('doc', { where: { id: '1' } }))[0].doc_no).toBe('D-0100');
    });
  });

  describe('strictMode: true', () => {
    it('a missing id refuses the WHOLE batch — table byte-identical, valid rows included', async () => {
      const strict = new InMemoryDriver({ strictMode: true });
      await strict.syncSchema('doc', DOC_SCHEMA);
      await strict.create('doc', { id: '1', doc_no: 'D-0001', title: 'One' });
      await strict.create('doc', { id: '2', doc_no: 'D-0002', title: 'Two' });
      const before = await snapshot(strict, 'doc');

      await expect(
        strict.bulkUpdate('doc', [
          { id: '1', data: { doc_no: 'D-0100' } }, // would have been valid alone
          { id: 'ghost', data: { doc_no: 'D-9999' } },
        ]),
      ).rejects.toThrow();

      expect(await snapshot(strict, 'doc')).toEqual(before);
    });
  });
});

describe('[#13435] bulkDelete refuses BEFORE writing — no surviving prefix', () => {
  let driver: InMemoryDriver;

  beforeEach(async () => {
    driver = new InMemoryDriver({ strictMode: true });
    await driver.syncSchema('doc', DOC_SCHEMA);
    await driver.create('doc', { id: '1', doc_no: 'D-0001' });
    await driver.create('doc', { id: '2', doc_no: 'D-0002' });
    await driver.create('doc', { id: '3', doc_no: 'D-0003' });
  });

  it('strictMode: a missing id refuses the WHOLE batch — table byte-identical, valid ids included', async () => {
    const before = await snapshot(driver, 'doc');

    await expect(driver.bulkDelete('doc', ['1', 'ghost', '2'])).rejects.toThrow();

    // Id '1' would have been removed BEFORE the refusal under the old
    // `Promise.all` shape. Named explicitly, not just via count.
    const after = await snapshot(driver, 'doc');
    expect(after).toEqual(before);
    expect(await driver.count('doc')).toBe(3);
  });

  it('strictMode: a clean batch still removes every named row', async () => {
    await driver.bulkDelete('doc', ['1', '3']);
    expect(await driver.count('doc')).toBe(1);
    expect((await driver.find('doc', { where: {} }))[0].id).toBe('2');
  });

  describe('non-strict (default `strictMode`)', () => {
    it('a missing id is SKIPPED; the rest of the batch still lands', async () => {
      const loose = new InMemoryDriver();
      await loose.syncSchema('doc', DOC_SCHEMA);
      await loose.create('doc', { id: '1', doc_no: 'D-0001' });
      await loose.create('doc', { id: '2', doc_no: 'D-0002' });

      await loose.bulkDelete('doc', ['1', 'ghost']);
      expect(await loose.count('doc')).toBe(1);
      expect((await loose.find('doc', { where: {} }))[0].id).toBe('2');
    });
  });

  it('an empty batch is a no-op', async () => {
    const before = await snapshot(driver, 'doc');
    await driver.bulkDelete('doc', []);
    expect(await snapshot(driver, 'doc')).toEqual(before);
  });

  it('duplicate ids in one batch delete the row once, not twice', async () => {
    await driver.bulkDelete('doc', ['1', '1']);
    expect(await driver.count('doc')).toBe(2);
  });
});

describe('[#13435] all FOUR batch doors of this driver now agree that a batch is atomic', () => {
  it('bulkCreate, updateMany, bulkUpdate and bulkDelete all refuse without moving the table', async () => {
    const driver = new InMemoryDriver({ strictMode: true });
    await driver.syncSchema('doc', DOC_SCHEMA);
    await driver.create('doc', { id: '1', doc_no: 'D-0001' });
    await driver.create('doc', { id: '2', doc_no: 'D-0002' });
    const before = await snapshot(driver, 'doc');

    const createErr = await refusalOf(() =>
      driver.bulkCreate('doc', [
        { id: 'a', doc_no: 'D-0100' },
        { id: 'b', doc_no: 'D-0100' },
      ]),
    );
    const updateManyErr = await refusalOf(() => driver.updateMany('doc', { where: {} }, { doc_no: 'D-0009' }));
    const bulkUpdateErr = await refusalOf(() =>
      driver.bulkUpdate('doc', [
        { id: '1', data: { doc_no: 'D-0100' } },
        { id: '2', data: { doc_no: 'D-0100' } }, // collides with the row above, not the table
      ]),
    );
    const bulkDeleteErr = await refusalOf(() => driver.bulkDelete('doc', ['1', 'ghost']));

    expect(createErr.code).toBe('UNIQUE_VIOLATION');
    expect(updateManyErr.code).toBe('UNIQUE_VIOLATION');
    expect(bulkUpdateErr.code).toBe('UNIQUE_VIOLATION');
    expect(bulkDeleteErr).toBeInstanceOf(Error);

    // None of the four doors moved the store.
    expect(await snapshot(driver, 'doc')).toEqual(before);
  });
});

describe('[#13435] non-regression — updateMany and bulkCreate still behave as #13197/#13340 left them', () => {
  let driver: InMemoryDriver;

  beforeEach(async () => {
    driver = new InMemoryDriver();
    await driver.syncSchema('doc', DOC_SCHEMA);
    await driver.create('doc', { id: '1', doc_no: 'D-0001' });
    await driver.create('doc', { id: '2', doc_no: 'D-0002' });
  });

  it('updateMany still refuses a colliding shared patch and leaves the table untouched', async () => {
    const before = await snapshot(driver, 'doc');
    const err = await refusalOf(() => driver.updateMany('doc', { where: {} }, { doc_no: 'D-SAME' }));
    expect(err.code).toBe('UNIQUE_VIOLATION');
    expect(await snapshot(driver, 'doc')).toEqual(before);
  });

  it('updateMany still applies a clean shared patch to every matched row', async () => {
    const count = await driver.updateMany('doc', { where: {} }, { title: 'Bulk' });
    expect(count).toBe(2);
    expect((await driver.find('doc', { where: { id: '1' } }))[0].title).toBe('Bulk');
    expect((await driver.find('doc', { where: { id: '2' } }))[0].title).toBe('Bulk');
  });

  it('bulkCreate still refuses a self-colliding batch and leaves the table untouched', async () => {
    const before = await snapshot(driver, 'doc');
    const err = await refusalOf(() =>
      driver.bulkCreate('doc', [
        { id: 'a', doc_no: 'D-0100' },
        { id: 'b', doc_no: 'D-0100' },
      ]),
    );
    expect(err.code).toBe('UNIQUE_VIOLATION');
    expect(await snapshot(driver, 'doc')).toEqual(before);
  });

  it('bulkCreate still lands a clean batch in full', async () => {
    const out = await driver.bulkCreate('doc', [{ id: 'a', doc_no: 'D-0100' }]);
    expect(out).toHaveLength(1);
    expect(await driver.count('doc')).toBe(3);
  });
});

/**
 * [#13911] The batch's two id lookups must AGREE.
 *
 * `IDataDriver.bulkUpdate` declares `id: string | number`, so a caller may
 * legitimately name a row with an id whose JS type differs from the stored
 * row's — and `update`/`bulkUpdate` resolve ids with a LOOSE `==` precisely so
 * that `'1'` still finds stored `1`. The first cut of #13435 then built its
 * untouched-row set (`settled`) from the CALLER's ids with a STRICT `Set.has`,
 * so for a mixed-type id the two disagreed: `findIndex` resolved the row (it
 * got updated) while `settled` still carried that row's PRE-image. The row sat
 * in the projected check set twice — once stale, once pending — and a batch
 * that merely MOVES a unique value between rows was refused with a false
 * `UNIQUE_VIOLATION`.
 *
 * The sibling `updateMany` never had this gap: its `targetIds` come from table
 * ROWS and its `findIndex` is strict `===`, so both sides agree by
 * construction. The fix restores that property here the other way round —
 * keeping the loose resolution (narrowing it would silently change which ids
 * resolve at all) and drawing the touched set from the RESOLVED rows' own ids.
 *
 * ⛔ The discriminating fact is that a legitimate batch SUCCEEDS. A test that
 * only asserted "a collision still refuses" would pass against the defect.
 */
describe('[#13911] caller id TYPE never changes the outcome of a batch', () => {
  let driver: InMemoryDriver;

  /** Numeric stored ids — the caller may still name them as strings. */
  beforeEach(async () => {
    driver = new InMemoryDriver();
    await driver.syncSchema('doc', DOC_SCHEMA);
    await driver.create('doc', { id: 1, doc_no: 'D-0001', title: 'One' });
    await driver.create('doc', { id: 2, doc_no: 'D-0002', title: 'Two' });
  });

  it('POSITIVE CONTROL: the same hand-off with CONSISTENT id types succeeds', async () => {
    // Row 1 vacates D-0001; row 2 takes it. Nothing about this batch is
    // unusual — it is here so the mixed-type case below cannot pass vacuously.
    const out = await driver.bulkUpdate('doc', [
      { id: 1, data: { doc_no: 'D-0900' } },
      { id: 2, data: { doc_no: 'D-0001' } },
    ]);

    expect(out).toHaveLength(2);
    const rows = await snapshot(driver, 'doc');
    expect(rows.map((r: any) => [r.id, r.doc_no])).toEqual([
      [1, 'D-0900'],
      [2, 'D-0001'],
    ]);
  });

  it('a STRING id naming a NUMERIC row still hands a unique value over cleanly', async () => {
    // Identical to the control except the first id is a string. It resolves
    // (loose `==`), so row 1 really does vacate D-0001 — and row 2 taking it
    // must therefore NOT collide. Against the defect this threw a false
    // UNIQUE_VIOLATION, because row 1's stale pre-image stayed in `settled`.
    const out = await driver.bulkUpdate('doc', [
      { id: '1', data: { doc_no: 'D-0900' } },
      { id: 2, data: { doc_no: 'D-0001' } },
    ]);

    expect(out).toHaveLength(2);
    const rows = await snapshot(driver, 'doc');
    expect(rows.map((r: any) => [r.id, r.doc_no])).toEqual([
      [1, 'D-0900'],
      [2, 'D-0001'],
    ]);
  });

  it('the stored id KEEPS its own type — a string id in the batch does not restamp it', async () => {
    await driver.bulkUpdate('doc', [{ id: '1', data: { title: 'Renamed' } }]);

    const row: any = (await driver.find('doc', { where: { id: 1 } }))[0];
    expect(row.id).toBe(1);
    expect(row.title).toBe('Renamed');
  });

  it('a REAL collision is still refused when the id types are mixed', async () => {
    // The fix must not turn the check off: row 2 keeps D-0002, so row 1 taking
    // it is a genuine violation however the caller spelled row 1's id.
    const before = await snapshot(driver, 'doc');

    const err = await refusalOf(() => driver.bulkUpdate('doc', [{ id: '1', data: { doc_no: 'D-0002' } }]));

    expect(err.code).toBe('UNIQUE_VIOLATION');
    expect(err.status).toBe(409);
    expect(await snapshot(driver, 'doc')).toEqual(before);
  });

  it('bulkDelete: a mixed-type id removes exactly its own row', async () => {
    await driver.bulkDelete('doc', ['1']);

    const rows = await snapshot(driver, 'doc');
    expect(rows.map((r: any) => r.id)).toEqual([2]);
  });

  it('bulkDelete: the SAME row named twice in two id types is removed once, and only it', async () => {
    // `bulkDelete` dedups on the RESOLVED table index, not on the caller's id.
    // Keying the set on caller input instead would make '1' and 1 two entries
    // and splice index 0 twice — taking row 2 with it.
    await driver.bulkDelete('doc', ['1', 1]);

    const rows = await snapshot(driver, 'doc');
    expect(rows.map((r: any) => [r.id, r.doc_no])).toEqual([[2, 'D-0002']]);
  });
});
