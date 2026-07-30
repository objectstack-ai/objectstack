// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Temporal filter conformance for the MongoDB driver, against a real server
 * via mongodb-memory-server (ADR-0053 D-A3).
 *
 * The shared cases come from `@objectstack/spec/data` — see
 * `temporal-conformance.ts` for the four incidents (#3650/#3773/#3777/#4047)
 * the table exists to end. This driver's own incident is #4047, and it was the
 * worst of the family: BSON type-bracket comparison meant a string comparand
 * matched NO `Date` row for every operator, so the dashboard's default window
 * returned nothing at all. The fixture's writer-form tags reproduce that mixed
 * string/Date writer population through `create()`; the sweep proves the
 * converged BSON-Date storage answers every shared case.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  TEMPORAL_CONFORMANCE_CASES,
  TEMPORAL_CONFORMANCE_NOW,
  TEMPORAL_CONFORMANCE_ROWS,
} from '@objectstack/spec/data';
import { resolveFilterTokens } from '@objectstack/core';
import { MongoDBDriver } from './mongodb-driver.js';

let sharedMongod: MongoMemoryServer | undefined;
try {
  sharedMongod = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
} catch (err) {
  console.warn(
    '[driver-mongodb] Skipping temporal-conformance suite — mongodb-memory-server could not start: ' +
      `${(err as Error)?.message ?? String(err)}`,
  );
}

const ids = (rows: any[]) => rows.map((r: any) => String(r.id)).sort();

const resolveTokens = <T,>(filter: T): T =>
  resolveFilterTokens(filter, { now: new Date(TEMPORAL_CONFORMANCE_NOW) });

describe.skipIf(!sharedMongod)('MongoDBDriver temporal conformance', () => {
  const mongod = sharedMongod as MongoMemoryServer;
  let driver: MongoDBDriver;

  beforeAll(async () => {
    driver = new MongoDBDriver({ url: mongod.getUri(), database: 'temporal_conformance_db' });
    await driver.connect();
    // Declaring the object is what teaches the driver which fields are
    // temporal (D-E2). Seed once — every case is a pure read.
    await driver.syncSchema('task', {
      name: 'task',
      fields: {
        title: { type: 'string' },
        happened_at: { type: 'datetime' },
        happened_on: { type: 'date' },
      },
    });
    for (const row of TEMPORAL_CONFORMANCE_ROWS) {
      await driver.create('task', {
        id: row.id,
        title: row.id,
        // The mixed-writer axis (D-E4): the exact population #4047 hit.
        happened_at: row.writerForm === 'native' ? new Date(row.happened_at) : row.happened_at,
        happened_on: row.happened_on,
      });
    }
  }, 90_000);

  afterAll(async () => {
    if (driver) await driver.disconnect();
    if (mongod) await mongod.stop();
  });

  for (const c of TEMPORAL_CONFORMANCE_CASES) {
    it(c.name, async () => {
      const found = await driver.find('task', { where: c.filter } as any);
      expect(ids(found), c.note).toEqual(c.expected);
    });

    if (c.tokenFilter) {
      it(`${c.name} — via relative tokens`, async () => {
        const found = await driver.find('task', { where: resolveTokens(c.tokenFilter) } as any);
        expect(ids(found), c.note).toEqual(c.expected);
      });
    }
  }
});
