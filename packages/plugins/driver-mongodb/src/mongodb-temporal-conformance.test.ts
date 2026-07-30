// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Temporal conformance for the MongoDB driver (ADR-0053 D-A3), against a real
 * MongoDB via `mongodb-memory-server`.
 *
 * The cases come from `@objectstack/spec/data` so this backend, `driver-sql`,
 * `driver-memory`, the analytics preview and `formula`'s write-side `check`
 * evaluator are all held to one standard — see `temporal-conformance.ts` for
 * the four divergences that standard exists to prevent, one of which (#4047)
 * was this driver's and was the worst of them: type-bracket comparison meant a
 * string bound matched no BSON `Date` row at all, so the default dashboard
 * window returned nothing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { TEMPORAL_CASES, TEMPORAL_ROWS } from '@objectstack/spec/data';
import { MongoDBDriver } from './mongodb-driver.js';

let sharedMongod: MongoMemoryServer | undefined;
try {
  sharedMongod = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
} catch (err) {
  console.warn(
    '[driver-mongodb] Skipping temporal conformance — mongodb-memory-server could not start: ' +
      `${(err as Error)?.message ?? String(err)}`,
  );
}

describe.skipIf(!sharedMongod)('driver-mongodb — temporal conformance', () => {
  const mongod = sharedMongod as MongoMemoryServer;
  let driver: MongoDBDriver;

  beforeAll(async () => {
    driver = new MongoDBDriver({ url: mongod.getUri(), database: 'temporal_conformance' });
    await driver.connect();
    // The declaration is what gives this driver its field types (#4047) — and
    // therefore the BSON storage form its comparands must be coerced into.
    await driver.syncSchema('conformance', {
      name: 'conformance',
      fields: { at: { type: 'datetime' }, on: { type: 'date' }, why: { type: 'string' } },
    });
    for (const r of TEMPORAL_ROWS) {
      await driver.create('conformance', { id: r.id, at: r.at, on: r.on, why: r.why });
    }
  }, 90_000);

  afterAll(async () => {
    if (driver) await driver.disconnect();
    if (mongod) await mongod.stop();
  });

  for (const c of TEMPORAL_CASES) {
    it(c.name, async () => {
      const rows = await driver.find('conformance', { where: c.filter } as any);
      const got = (rows as any[]).map((r) => r.id).sort();
      expect(got, c.note).toEqual([...c.expected].sort());
    });
  }
});
