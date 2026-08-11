// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#4419 — `MongoDBDriver.findOne` executes the whole QueryAST
 * against a REAL mongod, not just its `where`.
 *
 * It used to issue `collection.findOne(translateFilter(query.where), {
 * projection: { _id: 0 } })` and nothing else: `orderBy`, `fields` and `offset`
 * were accepted by the contract and dropped on the floor. `find` in the same
 * file had always handled all three, so this was a
 * per-method divergence exactly like the engine-level one #4419 is about —
 * `findOne({ orderBy: [{ field: 'created_at', order: 'desc' }] })` did not
 * return the newest record, it returned whichever document the scan reached
 * first, with no error and nothing to grep for.
 *
 * It matters beyond Mongo: the engine's own findOne guard tells a caller with
 * no predicate to pass `orderBy` instead ("the first record in THIS order"). An
 * escape hatch one backend silently ignores is not an escape hatch.
 *
 * The cases come from {@link FINDONE_CASES}, shared with
 * `mongodb-findone-options.test.ts` so the two halves cannot drift. This half
 * answers the one question the other cannot: does MongoDB agree? It therefore
 * asserts ROWS only — the "no sort was imposed" cases are checked over there,
 * because an untouched collection comes back in insertion order whether or not
 * a sort went out.
 *
 * Needs a real mongod, so it is OPT-IN since #5517 — `createTestMongod` prints
 * why and this suite skips unless `OS_TEST_MONGODB_MEMORY_SERVER_ENABLED=1`. It
 * used to call `MongoMemoryServer.create()` itself, which both started a
 * download in every default run and bypassed the package's shared deadline. A
 * skip is not a pass.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoDBDriver } from './mongodb-driver.js';
import { FINDONE_CASES, FINDONE_ROWS } from './mongodb-findone-cases.js';
import { createTestMongod } from './test-mongod.js';

const sharedMongod: MongoMemoryServer | undefined = await createTestMongod(
  'findOne query-execution',
);

describe.skipIf(!sharedMongod)('driver-mongodb — findOne executes the whole query', () => {
  const mongod = sharedMongod as MongoMemoryServer;
  let driver: MongoDBDriver;

  beforeAll(async () => {
    driver = new MongoDBDriver({ url: mongod.getUri(), database: 'findone_query' });
    await driver.connect();
    for (const row of FINDONE_ROWS) await driver.create('account', { ...row });
  }, 90_000);

  afterAll(async () => {
    if (driver) await driver.disconnect();
    if (sharedMongod) await sharedMongod.stop();
  });

  for (const c of FINDONE_CASES) {
    it(c.name, async () => {
      const row = await driver.findOne('account', { ...c.query } as any);
      expect(row === null ? null : String((row as any).id)).toBe(c.expectId);
      if (c.expectKeys && row) expect(new Set(Object.keys(row))).toEqual(new Set(c.expectKeys));
    });
  }

  it('find() is unchanged — a paged walk is still a partition of the rows', async () => {
    const seen: string[] = [];
    for (let offset = 0; offset < FINDONE_ROWS.length; offset += 2) {
      const page = await driver.find('account', { limit: 2, offset });
      seen.push(...page.map((r) => String(r.id)));
    }
    expect(seen).toHaveLength(FINDONE_ROWS.length);
    expect(new Set(seen).size).toBe(FINDONE_ROWS.length); // none served twice, none missed
  });
});
