// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Deterministic paged reads for the MongoDB driver (objectui#3106) — the
 * contract on `IDataDriver.find`, checked against the shared cases in
 * `@objectstack/spec/data` against a real MongoDB via `mongodb-memory-server`.
 *
 * This is the backend where the defect is not theoretical. MongoDB documents
 * that `sort` on a non-unique key combined with `skip`/`limit` may return the
 * same document more than once — equal keys have no defined relative order, and
 * nothing holds one execution's arrangement steady for the next. So the driver
 * appends `id` to every requested sort, and these cases walk the page
 * boundaries that would otherwise be where a row is served twice while another
 * is never served at all.
 *
 * A paged read with no `sort` at all (objectstack#4363) is covered by the same
 * fixture's `PAGINATION_UNORDERED_CASES`. It is the harder half to observe here
 * — an untouched twelve-document collection comes back in natural order every
 * time, which happens to be stable — so the sort-spec assertions carry that
 * half: they are what fails if the `id` order stops being emitted on a day the
 * fixture would have come back in a usable order anyway.
 *
 * The sort-spec assertions at the end are deliberately about the spec object
 * rather than the rows, for the same reason.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  PAGINATION_ALL_IDS,
  PAGINATION_CASES,
  PAGINATION_ROWS,
  PAGINATION_UNORDERED_CASES,
} from '@objectstack/spec/data';
import { MongoDBDriver } from './mongodb-driver.js';

let sharedMongod: MongoMemoryServer | undefined;
try {
  sharedMongod = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
} catch (err) {
  console.warn(
    '[driver-mongodb] Skipping pagination conformance — mongodb-memory-server could not start: ' +
      `${(err as Error)?.message ?? String(err)}`,
  );
}

describe.skipIf(!sharedMongod)('driver-mongodb — paged reads are a partition of the result set', () => {
  const mongod = sharedMongod as MongoMemoryServer;
  let driver: MongoDBDriver;

  beforeAll(async () => {
    driver = new MongoDBDriver({ url: mongod.getUri(), database: 'pagination_conformance' });
    await driver.connect();
    for (const row of PAGINATION_ROWS) {
      await driver.create('ticket', { ...row });
    }
  }, 90_000);

  afterAll(async () => {
    if (driver) await driver.disconnect();
    if (sharedMongod) await sharedMongod.stop();
  });

  for (const testCase of PAGINATION_CASES) {
    it(`visits every row exactly once — ${testCase.name}`, async () => {
      const seen: string[] = [];
      for (let offset = 0; offset < PAGINATION_ROWS.length; offset += testCase.pageSize) {
        const page = await driver.find('ticket', {
          orderBy: [...testCase.orderBy],
          limit: testCase.pageSize,
          offset,
        } as any);
        seen.push(...page.map((r) => String(r.id)));
      }

      expect(seen).toHaveLength(PAGINATION_ALL_IDS.length);
      expect(new Set(seen).size).toBe(PAGINATION_ALL_IDS.length);
      expect([...seen].sort()).toEqual([...PAGINATION_ALL_IDS].sort());
    });

    it(`page boundaries are invisible — ${testCase.name}`, async () => {
      const paged: any[] = [];
      for (let offset = 0; offset < PAGINATION_ROWS.length; offset += testCase.pageSize) {
        const page = await driver.find('ticket', {
          orderBy: [...testCase.orderBy],
          limit: testCase.pageSize,
          offset,
        } as any);
        paged.push(...page);
      }

      const whole = await driver.find('ticket', { orderBy: [...testCase.orderBy] } as any);
      expect(paged.map((r) => r.id)).toEqual((whole as any[]).map((r) => r.id));
    });
  }

  for (const testCase of PAGINATION_UNORDERED_CASES) {
    it(`visits every row exactly once with NO sort at all — ${testCase.name}`, async () => {
      const seen: string[] = [];
      for (let offset = 0; offset < PAGINATION_ROWS.length; offset += testCase.pageSize) {
        const page = await driver.find('ticket', { limit: testCase.pageSize, offset } as any);
        seen.push(...page.map((r) => String(r.id)));
      }

      expect(seen).toHaveLength(PAGINATION_ALL_IDS.length);
      expect(new Set(seen).size).toBe(PAGINATION_ALL_IDS.length);
      expect([...seen].sort()).toEqual([...PAGINATION_ALL_IDS].sort());
    });
  }
});

/**
 * The sort spec itself — the half that fails when the feature is deleted.
 *
 * Deliberately **outside** the `skipIf`, on a driver that is constructed but
 * never connected: `buildSortSpec` is pure, and the constructor opens no socket.
 * Gating it on `mongodb-memory-server` would be a false dependency with a real
 * cost, because that server is exactly what a restricted network cannot fetch —
 * and it is precisely there that the whole file would otherwise go quiet while
 * still reporting green. A driver's most load-bearing assertion should not be
 * the first thing an offline run drops.
 */
describe('MongoDBDriver — the sort spec sent to the server', () => {
  // Never connected: no URI is dialed, so this needs no server binary.
  const driver = new MongoDBDriver({ url: 'mongodb://127.0.0.1:1/unused', database: 'unused' });

  it('leaves an UNPAGED unordered read alone — no sort is imposed on a caller who asked for none', () => {
    // The carve-out, and the reason this rule asks about pagination rather than
    // sorting every read: with no slice there is no partial view to be wrong
    // about, so the plan stays whatever it was.
    expect(driver['buildSortSpec']({})).toBeUndefined();
    expect(driver['buildSortSpec']({ orderBy: [] })).toBeUndefined();
    expect(driver['buildSortSpec']({ where: { status: 'open' } })).toBeUndefined();
  });

  it('orders a paged read by `id` when the caller sent no sort (objectstack#4363)', () => {
    expect(driver['buildSortSpec']({ limit: 5, offset: 5 })).toEqual({ id: 1 });
    // `limit` alone is page one of a walk — ordering only the pages that carry
    // an `offset` would leave page one cut from a different arrangement, which
    // is the whole defect.
    expect(driver['buildSortSpec']({ limit: 5 })).toEqual({ id: 1 });
    expect(driver['buildSortSpec']({ offset: 5 })).toEqual({ id: 1 });
    expect(driver['buildSortSpec']({ orderBy: [], limit: 5 })).toEqual({ id: 1 });
  });

  it('appends `id` in the LAST key\'s direction', () => {
    expect(driver['buildSortSpec']({ orderBy: [{ field: 'status', order: 'asc' }] })).toEqual({
      status: 1,
      id: 1,
    });
    expect(
      driver['buildSortSpec']({
        orderBy: [
          { field: 'status', order: 'asc' },
          { field: 'rank', order: 'desc' },
        ],
      }),
    ).toEqual({ status: 1, rank: -1, id: -1 });
  });

  it('does not override `id` when the caller already sorted by it', () => {
    expect(driver['buildSortSpec']({ orderBy: [{ field: 'id', order: 'desc' }] })).toEqual({
      id: -1,
    });
    expect(
      driver['buildSortSpec']({ orderBy: [{ field: 'id', order: 'desc' }], limit: 5, offset: 5 }),
    ).toEqual({ id: -1 });
  });
});
