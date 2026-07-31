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
 *
 * Rows are seeded in their tagged writer forms (ISO string vs JS `Date` — the
 * D-E4 mixed-writer axis), the exact writer population #4047 hit. Cases
 * carrying a token spelling also run through `resolveFilterTokens` at the
 * pinned `TEMPORAL_NOW` — the D-A3 "token → row results" axis (#4081).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import {
  TEMPORAL_CASES,
  TEMPORAL_NOW,
  TEMPORAL_ROWS,
  TEMPORAL_TIME_CASES,
  TEMPORAL_TIME_ROWS,
} from '@objectstack/spec/data';
import { resolveFilterTokens } from '@objectstack/core';
import { MongoDBDriver } from './mongodb-driver.js';
import { createTestMongod } from './test-mongod.js';

const resolveTokens = <T,>(filter: T): T =>
  resolveFilterTokens(filter, { now: new Date(TEMPORAL_NOW) });

const sharedMongod: MongoMemoryServer | undefined = await createTestMongod('temporal conformance');

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
      await driver.create('conformance', {
        id: r.id,
        // The mixed-writer axis (D-E4): the exact population #4047 hit.
        at: r.writerForm === 'native' ? new Date(r.at) : r.at,
        on: r.on,
        why: r.why,
      });
    }
  }, 90_000);

  // Only this suite's own connection — the SERVER is shared with the time
  // suite below and is stopped once, at file level, after both have run.
  // Stopping it here left `getUri()` throwing `Incorrect State … gotState:
  // 'new'` for the second suite, whose cases then never executed at all.
  afterAll(async () => {
    if (driver) await driver.disconnect();
  });

  for (const c of TEMPORAL_CASES) {
    it(c.name, async () => {
      const rows = await driver.find('conformance', { where: c.filter } as any);
      const got = (rows as any[]).map((r) => r.id).sort();
      expect(got, c.note).toEqual([...c.expected].sort());
    });

    if (c.tokenFilter) {
      it(`${c.name} — via relative tokens`, async () => {
        const rows = await driver.find('conformance', { where: resolveTokens(c.tokenFilter) } as any);
        const got = (rows as any[]).map((r) => r.id).sort();
        expect(got, c.note).toEqual([...c.expected].sort());
      });
    }
  }
});

describe.skipIf(!sharedMongod)('driver-mongodb — Field.time conformance', () => {
  const mongod = sharedMongod as MongoMemoryServer;
  let driver: MongoDBDriver;

  beforeAll(async () => {
    driver = new MongoDBDriver({ url: mongod.getUri(), database: 'time_conformance' });
    await driver.connect();
    await driver.syncSchema('time_conformance', {
      name: 'time_conformance',
      fields: { at: { type: 'time' }, why: { type: 'string' } },
    });
    for (const r of TEMPORAL_TIME_ROWS) {
      await driver.create('time_conformance', {
        id: r.id,
        // The mixed-writer axis for wall clocks: a `Date` write and a
        // canonical-text write of the SAME wall clock must converge, or BSON
        // type-bracket comparison hides one half from every text bound.
        at: r.writerForm === 'native' ? new Date(`1970-01-01T${r.at}Z`) : r.at,
        why: r.why,
      });
    }
  }, 90_000);

  afterAll(async () => {
    if (driver) await driver.disconnect();
  });

  for (const c of TEMPORAL_TIME_CASES) {
    it(c.name, async () => {
      const rows = await driver.find('time_conformance', { where: c.filter } as any);
      const got = (rows as any[]).map((r) => r.id).sort();
      expect(got, c.note).toEqual([...c.expected].sort());
    });
  }
});

// The shared server outlives both suites, so it is torn down once here rather
// than by whichever suite happens to finish first.
afterAll(async () => {
  if (sharedMongod) await sharedMongod.stop();
});
