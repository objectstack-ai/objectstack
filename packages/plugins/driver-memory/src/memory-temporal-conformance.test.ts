// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Temporal conformance for the in-memory driver (ADR-0053 D-A3).
 *
 * The cases come from `@objectstack/spec/data` so this backend, `driver-sql`,
 * `driver-mongodb`, the analytics preview and `formula`'s write-side `check`
 * evaluator are all held to one standard — see `temporal-conformance.ts` for
 * the four divergences that standard exists to prevent, one of which (#4047)
 * was this driver's.
 *
 * Rows are seeded in their tagged writer forms (ISO string vs JS `Date` — the
 * D-E4 mixed-writer axis), reproducing exactly the mixed column #4047 hit;
 * the sweep proves the converged storage answers every shared case. Cases
 * carrying a token spelling also run through `resolveFilterTokens` at the
 * pinned `TEMPORAL_NOW` — the D-A3 "token → row results" axis (#4081).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { TEMPORAL_CASES, TEMPORAL_NOW, TEMPORAL_ROWS } from '@objectstack/spec/data';
import { resolveFilterTokens } from '@objectstack/core';
import { InMemoryDriver } from './memory-driver.js';

const resolveTokens = <T,>(filter: T): T =>
  resolveFilterTokens(filter, { now: new Date(TEMPORAL_NOW) });

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
      await driver.create('conformance', {
        id: r.id,
        // The mixed-writer axis (D-E4): both shapes must converge on write.
        at: r.writerForm === 'native' ? new Date(r.at) : r.at,
        on: r.on,
        why: r.why,
      });
    }
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
