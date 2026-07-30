// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Temporal conformance for the in-memory driver (ADR-0053 D-A3).
 *
 * The cases come from `@objectstack/spec/data` so this backend, `driver-sql`,
 * `driver-mongodb`, the analytics preview and `formula`'s write-side `check`
 * evaluator are all held to one standard — see `temporal-conformance.ts` for
 * the four divergences that standard exists to prevent, one of which (#4047)
 * was this driver's.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { TEMPORAL_CASES, TEMPORAL_ROWS } from '@objectstack/spec/data';
import { InMemoryDriver } from './memory-driver.js';

describe('driver-memory — temporal conformance', () => {
  let driver: InMemoryDriver;

  beforeAll(async () => {
    driver = new InMemoryDriver({});
    await driver.connect();
    // Declaring the object is what teaches this driver the field types (#4047);
    // without it the values would keep whatever form the writer produced.
    await driver.syncSchema('conformance', {
      name: 'conformance',
      fields: { at: { type: 'datetime' }, on: { type: 'date' }, why: { type: 'string' } },
    });
    for (const r of TEMPORAL_ROWS) {
      await driver.create('conformance', { id: r.id, at: r.at, on: r.on, why: r.why });
    }
  });

  for (const c of TEMPORAL_CASES) {
    it(c.name, async () => {
      const rows = await driver.find('conformance', { where: c.filter } as any);
      const got = (rows as any[]).map((r) => r.id).sort();
      expect(got, c.note).toEqual([...c.expected].sort());
    });
  }
});
