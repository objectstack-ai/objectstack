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
import type { MongoMemoryServer } from 'mongodb-memory-server';
import {
  PAGINATION_ALL_IDS,
  PAGINATION_CASES,
  PAGINATION_ROWS,
  PAGINATION_UNORDERED_CASES,
  PAGINATION_ZERO_LIMIT_CASES,
} from '@objectstack/spec/data';
import { MongoDBDriver } from './mongodb-driver.js';
import { createTestMongod } from './test-mongod.js';

// The live half needs a real mongod, so it is OPT-IN since #5517 (see
// `test-mongod.ts`). It used to call `MongoMemoryServer.create()` itself, which
// both started a download in every default run and bypassed the package's shared
// deadline. The sort-spec half below runs regardless — it needs no server.
const sharedMongod: MongoMemoryServer | undefined = await createTestMongod(
  'pagination conformance',
);

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

  /**
   * `limit: 0` returns no records (#6485/#6577) — the whole case-set, controls
   * included, against a real mongod. The controls are what stop the
   * short-circuit added for this contract from being an unconditional "return
   * nothing": they read 2 and 12 rows back through the same door.
   */
  describe('`limit: 0` returns no records', () => {
    for (const testCase of PAGINATION_ZERO_LIMIT_CASES) {
      it(testCase.name, async () => {
        const rows = await driver.find('ticket', { ...testCase.query });
        expect(rows).toHaveLength(testCase.expectedRowCount);
      });
    }
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

/**
 * The `limit: 0` guard, on a driver that is NEVER CONNECTED — #6485/#6577.
 *
 * Outside the `skipIf` for the same reason the sort-spec block above is, and
 * for one more that is specific to this contract: the guard's whole claim is
 * that the answer is produced WITHOUT consulting the MongoDB client. A test
 * that needs a running mongod to prove that would be asserting the opposite of
 * what it is about. Here the URI is unreachable by construction (port 1), so if
 * the short-circuit were removed these cases would not fail on a row count —
 * they would fail on a connection error, which is exactly the right alarm.
 *
 * Why this driver needed a guard at all when its `buildFindOptions` was already
 * correct: it tests presence (`!== undefined`), so `0` was forwarded faithfully
 * — into a client that DEFINES `limit: 0` as *no limit*. Forwarding was the
 * problem, not the fix.
 */
describe('MongoDBDriver — `limit: 0` is answered before the client is consulted', () => {
  const driver = new MongoDBDriver({ url: 'mongodb://127.0.0.1:1/unused', database: 'unused' });

  it('find() returns zero records without dialing the server', async () => {
    await expect(driver.find('ticket', { limit: 0 })).resolves.toHaveLength(0);
  });

  it('find() returns zero records with an offset too', async () => {
    await expect(driver.find('ticket', { limit: 0, offset: 5 })).resolves.toHaveLength(0);
  });

  it('findOne() returns null — the empty result for its signature', async () => {
    await expect(driver.findOne('ticket', { limit: 0 })).resolves.toBeNull();
  });

  it('does NOT short-circuit a non-zero limit — that read still needs the server', async () => {
    // The control that keeps the guard from becoming "return nothing, always".
    // With no short-circuit the unreachable URI is what answers, so a rejection
    // here IS the assertion: the call went to the client, as it must.
    await expect(driver.find('ticket', { limit: 2 })).rejects.toThrow();
  });

  it('does NOT short-circuit a read with no limit at all', async () => {
    await expect(driver.find('ticket', {})).rejects.toThrow();
  });
});
