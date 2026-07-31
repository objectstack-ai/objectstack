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
 * The sort-spec assertions at the end are deliberately about the spec object
 * rather than the rows: they are what fails if the tie-breaker is removed on a
 * day the fixture happens to come back in a stable order anyway.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { PAGINATION_ALL_IDS, PAGINATION_CASES, PAGINATION_ROWS } from '@objectstack/spec/data';
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

  it('leaves an unordered read alone — no sort is imposed on a caller who asked for none', () => {
    expect(driver['buildSortSpec'](undefined)).toBeUndefined();
    expect(driver['buildSortSpec']([])).toBeUndefined();
  });

  it('appends `id` in the LAST key\'s direction', () => {
    expect(driver['buildSortSpec']([{ field: 'status', order: 'asc' }])).toEqual({
      status: 1,
      id: 1,
    });
    expect(
      driver['buildSortSpec']([
        { field: 'status', order: 'asc' },
        { field: 'rank', order: 'desc' },
      ]),
    ).toEqual({ status: 1, rank: -1, id: -1 });
  });

  it('does not override `id` when the caller already sorted by it', () => {
    expect(driver['buildSortSpec']([{ field: 'id', order: 'desc' }])).toEqual({ id: -1 });
  });
});
