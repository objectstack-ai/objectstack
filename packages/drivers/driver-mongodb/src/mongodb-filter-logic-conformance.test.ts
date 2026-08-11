// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Filter logical-combinator conformance for the MongoDB driver, against a REAL
 * mongod (#4405) — the half that answers whether MongoDB agrees.
 *
 * The shared cases come from `@objectstack/spec/data`, so this backend now
 * stands beside `driver-sql`, `driver-memory`, `formula`'s
 * `matchesFilterCondition` and `read-scope-sql` under one standard (#3774).
 * `mongodb-filter.ts` reaches that standard by a completely separate route:
 * MongoDB has no document-level `$not`, so a negation is emitted as `$nor`, and
 * a branch's own keys have to stay inside one document while `$and`/`$or`
 * clauses are lifted beside them. Whether that route arrives at the same rows
 * is not a question a translator test can close — it is a question about the
 * server's evaluation of the document, and this file is where it is asked.
 *
 * The same table is driven server-free by
 * `mongodb-filter-logic-translation.test.ts`, which is the half that always
 * runs. This one is OPT-IN since #5517: it needs the mongod binary, whose
 * concurrent download turned green runs into `exit 1`, so `createTestMongod`
 * skips it unless `OS_TEST_MONGODB_MEMORY_SERVER_ENABLED=1` (and still skips,
 * rather than stalling, when an opted-in download is blocked or hanging).
 * **A skip is not a pass**: by default the translation suite is the whole proof,
 * which is exactly why it carries the priority half.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { FILTER_LOGIC_CASES, FILTER_LOGIC_ROWS } from '@objectstack/spec/data';
import { MongoDBDriver } from './mongodb-driver.js';
import { createTestMongod } from './test-mongod.js';

const sharedMongod: MongoMemoryServer | undefined = await createTestMongod('filter logic conformance');

describe.skipIf(!sharedMongod)('driver-mongodb — filter logic conformance', () => {
  const mongod = sharedMongod as MongoMemoryServer;
  let driver: MongoDBDriver;

  beforeAll(async () => {
    driver = new MongoDBDriver({ url: mongod.getUri(), database: 'filter_logic_conformance' });
    await driver.connect();
    // Every fixture column is a plain string — the shared table keeps its
    // predicates boring on purpose, so nothing here is about coercion. The
    // declaration is still made, because that is how a real object reaches the
    // driver and how its field kinds are resolved (#4047).
    await driver.syncSchema('conformance', {
      name: 'conformance',
      fields: {
        a: { type: 'string' },
        b: { type: 'string' },
        c: { type: 'string' },
        // [#5298] The NULL-bearing column; rows 3-4 seed it as `null`.
        d: { type: 'string' },
        owner: { type: 'string' },
        status: { type: 'string' },
        parent_object: { type: 'string' },
        parent_id: { type: 'string' },
      },
    });
    for (const row of FILTER_LOGIC_ROWS) {
      await driver.create('conformance', { ...row });
    }
  }, 90_000);

  afterAll(async () => {
    if (driver) await driver.disconnect();
    if (sharedMongod) await sharedMongod.stop();
  });

  for (const c of FILTER_LOGIC_CASES) {
    it(c.name, async () => {
      const rows = await driver.find('conformance', { where: c.filter });
      const got = (rows as any[])
        .map((r) => String(r.id))
        .sort((x, y) => x.localeCompare(y));
      expect(got, c.note).toEqual([...c.expected]);
    });
  }

  /**
   * The fixture as a whole, so a case that returns nothing because the seed
   * failed cannot read as a case that correctly excluded everything.
   */
  it('the fixture really is all four rows', async () => {
    const rows = await driver.find('conformance', {});
    expect((rows as any[]).map((r) => String(r.id)).sort()).toEqual(['1', '2', '3', '4']);
  });
});
