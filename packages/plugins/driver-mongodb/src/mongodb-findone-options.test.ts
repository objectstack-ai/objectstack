// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#4419 — the exact `FindOptions` `MongoDBDriver.findOne` hands to
 * MongoDB, asserted without a server.
 *
 * The defect this pins was invisible in the rows: `findOne` used to call
 * `collection.findOne(filter, { session, projection: { _id: 0 } })` — no
 * `sort`, no `skip`, no field projection — so `orderBy`, `offset` and `fields`
 * were dropped between the contract and the wire. An untouched three-document
 * collection comes back in insertion order every time, which happens to be
 * stable, so a row-level assertion can pass against a driver that sorts nothing
 * at all. The options object is where the bug is legible, so that is what this
 * asserts.
 *
 * The companion suite `mongodb-findone-query.test.ts` proves the same behaviour
 * end to end against a real mongod, and skips when the binary cannot be
 * fetched. This one has no such dependency and therefore always runs — which is
 * the point: a driver defect that only a downloadable binary can catch is a
 * defect nobody catches on a restricted network.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MongoDBDriver } from './mongodb-driver.js';

interface Seen { filter: any; options: any }

/**
 * A driver wired to a fake `Db` — no connect(), no server. `getCollection` is
 * `this.db.collection(name)`, so replacing `db` is enough to observe every call
 * the real code path makes.
 */
function makeDriver() {
  const seen: { findOne: Seen[]; find: Seen[] } = { findOne: [], find: [] };
  const rows: Record<string, unknown>[] = [];
  const collection = {
    findOne: async (filter: any, options: any) => { seen.findOne.push({ filter, options }); return rows[0] ?? null; },
    find: (filter: any, options: any) => {
      seen.find.push({ filter, options });
      return { toArray: async () => rows };
    },
  };
  const driver = new MongoDBDriver({ url: 'mongodb://unused/', database: 'unused' });
  (driver as any).db = { collection: () => collection };
  return { driver, seen, rows };
}

describe('MongoDBDriver.findOne hands Mongo the whole query (#4419)', () => {
  let driver: MongoDBDriver;
  let seen: { findOne: Seen[]; find: Seen[] };

  beforeEach(() => {
    const made = makeDriver();
    driver = made.driver;
    seen = made.seen;
  });

  const lastFindOne = () => seen.findOne.at(-1)!;

  it('translates the predicate, as it always did', async () => {
    await driver.findOne('account', { object: 'account', where: { id: 'a' }, limit: 1 } as any);
    expect(lastFindOne().filter).toMatchObject({ id: 'a' });
  });

  // ── the three parameters that used to be dropped ─────────────────────

  it('sends the caller ordering, with the id tie-breaker in the same direction', async () => {
    await driver.findOne('account', {
      object: 'account', orderBy: [{ field: 'rank', order: 'desc' }], limit: 1,
    } as any);
    expect(lastFindOne().options.sort).toEqual({ rank: -1, id: -1 });
  });

  it('sends the field projection — `id` kept, `_id` dropped', async () => {
    await driver.findOne('account', {
      object: 'account', where: { id: 'a' }, fields: ['name'], limit: 1,
    } as any);
    expect(lastFindOne().options.projection).toEqual({ name: 1, id: 1, _id: 0 });
  });

  it('sends the offset', async () => {
    await driver.findOne('account', {
      object: 'account', orderBy: [{ field: 'rank', order: 'asc' }], offset: 2, limit: 1,
    } as any);
    expect(lastFindOne().options.skip).toBe(2);
  });

  it('all three at once, on one query', async () => {
    await driver.findOne('account', {
      object: 'account',
      where: { status: 'open' },
      orderBy: [{ field: 'created_at', order: 'desc' }],
      fields: ['id', 'name'],
      offset: 1,
      limit: 1,
    } as any);
    const { filter, options } = lastFindOne();
    expect(filter).toMatchObject({ status: 'open' });
    expect(options.sort).toEqual({ created_at: -1, id: -1 });
    expect(options.projection).toEqual({ id: 1, name: 1, _id: 0 });
    expect(options.skip).toBe(1);
  });

  // ── and the half that must stay absent (#4363) ───────────────────────

  it('imposes NO sort on an unordered findOne — its limit: 1 is not a page', async () => {
    await driver.findOne('account', { object: 'account', where: { id: 'a' }, limit: 1 } as any);
    expect(lastFindOne().options.sort).toBeUndefined();
  });

  it('an unordered PAGED find still gets one — the carve-out is findOne-only', async () => {
    await driver.find('account', { object: 'account', limit: 2, offset: 0 } as any);
    expect(seen.find.at(-1)!.options.sort).toEqual({ id: 1 });
  });

  it('an unordered, unpaged find still gets none — that rule is unchanged', async () => {
    await driver.find('account', { object: 'account' } as any);
    expect(seen.find.at(-1)!.options.sort).toBeUndefined();
  });

  it('the transaction session still rides through', async () => {
    const session = { id: 'sess-1' } as any;
    await driver.findOne(
      'account',
      { object: 'account', where: { id: 'a' }, limit: 1 } as any,
      { transaction: session } as any,
    );
    expect(lastFindOne().options.session).toBe(session);
  });
});
