// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#9276 — measured on THIS driver, not assumed from its sibling.
 *
 * The card asks for `driver-mongodb` to be measured the same way as
 * `driver-memory` before deciding, and the two do NOT match. `driver-memory`
 * emits an own key holding `undefined` consistently, from `create` and from
 * `find` alike. This driver SPLITS:
 *
 *  - `create()` returns the object it built in process, so an explicitly
 *    `undefined` field came back as an own key holding `undefined`;
 *  - what BSON stored for that same field was `null` — the MongoClient default
 *    is `ignoreUndefined: false` and this driver sets no override — so a
 *    subsequent `find()` answered `null`, a VALUE.
 *
 * One write, two answers, from one driver: CEL reads own-key-`undefined` as
 * absent (`has(record.f)` is `false`) and a present `null` as a value
 * (`has(record.f)` is `true`).
 *
 * Both halves are closed at the insert doors: nothing ambiguous is returned,
 * and no key is stored for a field that was given no value.
 *
 * ⚠️ Scope, deliberately: the INSERT doors. `$set`-shaped patches are not
 * touched — see the `withoutUndefinedOwnKeys` doc comment in
 * `mongodb-driver.ts`.
 *
 * Runs without a server (#5517 gates the mongod-backed suites). The fake `Db`
 * is the pattern `mongodb-findone-options.test.ts` established: `getCollection`
 * is `this.db.collection(name)`, so replacing `db` observes every call the real
 * code path makes. The BSON leg then applies the driver's OWN serialization
 * setting to the recorded document, which is what makes the claim about
 * `find()` falsifiable here rather than only on a runner with a mongod.
 */

import { describe, it, expect } from 'vitest';
import { BSON } from 'mongodb';

import { MongoDBDriver } from './mongodb-driver.js';

/** A driver wired to a recording fake `Db` — no connect(), no server. */
function makeDriver() {
  const inserted: Record<string, unknown>[] = [];
  const collection = {
    insertOne: async (doc: Record<string, unknown>) => {
      inserted.push({ ...doc });
      return { insertedId: 'x' };
    },
    insertMany: async (docs: Record<string, unknown>[]) => {
      for (const d of docs) inserted.push({ ...d });
      return { insertedIds: {} };
    },
  };
  const driver = new MongoDBDriver({ url: 'mongodb://127.0.0.1:1/probe' });
  (driver as any).db = { collection: () => collection };
  return { driver, inserted };
}

/**
 * The stored form of a document, under the serialization this driver actually
 * uses. `ignoreUndefined: false` is the MongoClient default and `mongodb-driver.ts`
 * passes no override, so this is the round trip a real `find()` reads back.
 */
function asStored(doc: Record<string, unknown>): Record<string, unknown> {
  return BSON.deserialize(BSON.serialize(doc, { ignoreUndefined: false }));
}

function comparable(row: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, created_at: _c, updated_at: _u, ...rest } = row;
  return rest;
}

describe('#9276 driver-mongodb — measured separately from driver-memory', () => {
  it('the serialization that made this driver DIFFER from its sibling is still the live one', () => {
    // The mechanism, pinned so the repair below cannot be misread as
    // redundant: if an own key holding `undefined` reached the collection, BSON
    // would store it as `null`, which is a value — not the absence the caller
    // expressed. Guarding at the insert door is what keeps it from getting
    // there.
    expect(asStored({ id: 'a1', status: undefined })).toEqual({ id: 'a1', status: null });
    expect(Object.keys(asStored({ id: 'a1' }))).toEqual(['id']);
  });

  it('create() returns no own key holding `undefined`, and its row equals the never-written row', async () => {
    const { driver } = makeDriver();

    const written = await driver.create('article', { id: 'a1', title: 't', status: undefined });
    const neverWritten = await driver.create('article', { id: 'a2', title: 't' });

    expect('status' in written).toBe(false);
    expect(comparable(written)).toEqual(comparable(neverWritten));
  });

  it('nothing is stored for the field, so find() agrees with create()', async () => {
    const { driver, inserted } = makeDriver();

    await driver.create('article', { id: 'a1', title: 't', status: undefined });

    expect('status' in inserted[0]).toBe(false);
    // What a real `find()` would read back for that document.
    expect('status' in asStored(inserted[0])).toBe(false);
  });

  it('bulkCreate() closes the same door', async () => {
    const { driver, inserted } = makeDriver();

    const [written, neverWritten] = await driver.bulkCreate('article', [
      { id: 'a1', title: 't', status: undefined },
      { id: 'a2', title: 't' },
    ]);

    expect('status' in written).toBe(false);
    expect(comparable(written)).toEqual(comparable(neverWritten));
    expect(inserted.every((doc) => !('status' in doc))).toBe(true);
    expect(inserted.every((doc) => !('status' in asStored(doc)))).toBe(true);
  });

  it('a field holding `null` is a VALUE and survives as one, through the wire too', async () => {
    const { driver, inserted } = makeDriver();

    const row = await driver.create('article', { id: 'a1', title: 't', status: null });

    expect('status' in row).toBe(true);
    expect(row.status).toBeNull();
    expect(asStored(inserted[0]).status).toBeNull();
  });

  it('no own key holding `undefined` survives any insert-door return value', async () => {
    const { driver } = makeDriver();

    const rows = [
      await driver.create('article', { id: 'a1', title: 't', status: undefined }),
      ...(await driver.bulkCreate('article', [{ id: 'a2', title: 't', status: undefined }])),
    ];

    for (const row of rows) {
      const undefinedOwnKeys = Object.keys(row).filter((k) => row[k] === undefined);
      expect(undefinedOwnKeys).toEqual([]);
    }
  });
});
