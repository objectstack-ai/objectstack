// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#4419 — `MongoDBDriver.findOne` executes the whole QueryAST, not
 * just its `where`.
 *
 * It used to issue `collection.findOne(translateFilter(query.where), {
 * projection: { _id: 0 } })` and nothing else: `orderBy`, `fields` and `offset`
 * were accepted by the contract and dropped on the floor. `find` and
 * `_findStream` in the same file had always handled all three, so this was a
 * per-method divergence exactly like the engine-level one #4419 is about —
 * `findOne({ orderBy: [{ field: 'created_at', order: 'desc' }] })` did not
 * return the newest record, it returned whichever document the scan reached
 * first, with no error and nothing to grep for.
 *
 * It matters beyond Mongo: the engine's own findOne guard tells a caller with
 * no predicate to pass `orderBy` instead ("the first record in THIS order"). An
 * escape hatch one backend silently ignores is not an escape hatch.
 *
 * The other half is what must NOT happen: no ordering is imposed when the
 * caller asks for none (objectstack#4363). The engine sends `limit: 1`, which
 * the paged-read rule cannot tell from "page one with page size 1", and the two
 * want opposite things — `findOne` promises *a* matching record, never a
 * position in a sequence, so an imposed `sort` only costs it the plan its
 * predicate earned.
 *
 * Runs against a real mongod via `mongodb-memory-server`, and skips itself when
 * the binary cannot be fetched — the convention the other suites in this
 * package already use.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoDBDriver } from './mongodb-driver.js';

let sharedMongod: MongoMemoryServer | undefined;
try {
  sharedMongod = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
} catch (err) {
  console.warn(
    '[driver-mongodb] Skipping findOne query-execution suite — mongodb-memory-server could not '
      + `start: ${(err as Error)?.message ?? String(err)}`,
  );
}

const ROWS = [
  { id: 'a', name: 'Alpha', rank: 3, secret: 'sa' },
  { id: 'b', name: 'Bravo', rank: 1, secret: 'sb' },
  { id: 'c', name: 'Charlie', rank: 2, secret: 'sc' },
];

describe.skipIf(!sharedMongod)('driver-mongodb — findOne executes the whole query', () => {
  const mongod = sharedMongod as MongoMemoryServer;
  let driver: MongoDBDriver;

  beforeAll(async () => {
    driver = new MongoDBDriver({ url: mongod.getUri(), database: 'findone_query' });
    await driver.connect();
    for (const row of ROWS) await driver.create('account', { ...row });
  }, 90_000);

  afterAll(async () => {
    if (driver) await driver.disconnect();
    if (sharedMongod) await sharedMongod.stop();
  });

  // ── orderBy: the half that used to vanish ───────────────────────────

  it.each([
    ['asc', 'b'],
    ['desc', 'a'],
  ])('findOne({orderBy rank %s}) returns the extreme row, not an arbitrary one', async (order, expected) => {
    const row = await driver.findOne('account', {
      object: 'account',
      orderBy: [{ field: 'rank', order: order as 'asc' | 'desc' }],
      limit: 1,
    } as any);
    expect(row?.id).toBe(expected);
  });

  it('orderBy composes with a predicate — the newest of the MATCHING rows', async () => {
    const row = await driver.findOne('account', {
      object: 'account',
      where: { id: { $in: ['a', 'c'] } },
      orderBy: [{ field: 'rank', order: 'asc' }],
      limit: 1,
    } as any);
    expect(row?.id).toBe('c'); // rank 2 < rank 3
  });

  // ── fields / offset ─────────────────────────────────────────────────

  it('findOne({fields}) projects — a column not asked for does not come back', async () => {
    const row = await driver.findOne('account', {
      object: 'account', where: { id: 'a' }, fields: ['name'], limit: 1,
    } as any);
    expect(row).toEqual({ id: 'a', name: 'Alpha' }); // `id` always kept, `_id` never
    expect(row).not.toHaveProperty('secret');
  });

  it('findOne({offset}) skips, so an ordered walk can step past the first match', async () => {
    const row = await driver.findOne('account', {
      object: 'account', orderBy: [{ field: 'rank', order: 'asc' }], offset: 1, limit: 1,
    } as any);
    expect(row?.id).toBe('c'); // ranks asc → b, c, a
  });

  // ── and the half that must stay absent (#4363) ───────────────────────

  it('imposes NO sort when the caller asked for none — the limit: 1 is not a page', async () => {
    const collection = (driver as any).getCollection('account');
    const spy = vi.spyOn(collection, 'findOne');
    try {
      await driver.findOne('account', { object: 'account', where: { id: 'a' }, limit: 1 } as any);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][1]).not.toHaveProperty('sort');
    } finally {
      spy.mockRestore();
    }
  });

  it('a caller-supplied sort still gets the id tie-breaker appended', async () => {
    const collection = (driver as any).getCollection('account');
    const spy = vi.spyOn(collection, 'findOne');
    try {
      await driver.findOne('account', {
        object: 'account', orderBy: [{ field: 'rank', order: 'desc' }], limit: 1,
      } as any);
      expect(spy.mock.calls[0][1]?.sort).toEqual({ rank: -1, id: -1 });
    } finally {
      spy.mockRestore();
    }
  });

  it('find() is unchanged — a paged read still gets its deterministic order', async () => {
    const collection = (driver as any).getCollection('account');
    const spy = vi.spyOn(collection, 'find');
    try {
      await driver.find('account', { object: 'account', limit: 2, offset: 0 } as any);
      expect(spy.mock.calls[0][1]?.sort).toEqual({ id: 1 });
    } finally {
      spy.mockRestore();
    }
  });

  it('a miss is still null', async () => {
    expect(await driver.findOne('account', {
      object: 'account', where: { id: 'nope' }, limit: 1,
    } as any)).toBeNull();
  });
});
