// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Temporal filter conformance for the in-memory driver (ADR-0053 D-A3).
 *
 * The shared cases come from `@objectstack/spec/data` — see
 * `temporal-conformance.ts` for the four incidents (#3650/#3773/#3777/#4047)
 * the table exists to end. This driver's own incident is #4047: mingo compares
 * across JS types the way MongoDB compares across BSON types, so a mixed
 * string/Date column answered a window with whichever half matched the
 * comparand's type. The fixture's writer-form tags reproduce exactly that
 * mixed-writer column through `create()`, and the conformance sweep proves the
 * converged storage answers every shared case.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TEMPORAL_CONFORMANCE_CASES,
  TEMPORAL_CONFORMANCE_NOW,
  TEMPORAL_CONFORMANCE_ROWS,
} from '@objectstack/spec/data';
import { resolveFilterTokens } from '@objectstack/core';
import { InMemoryDriver } from './memory-driver.js';

const ids = (rows: any[]) => rows.map((r: any) => String(r.id)).sort();

const resolveTokens = <T,>(filter: T): T =>
  resolveFilterTokens(filter, { now: new Date(TEMPORAL_CONFORMANCE_NOW) });

describe('InMemoryDriver temporal conformance', () => {
  let driver: InMemoryDriver;

  beforeEach(async () => {
    driver = new InMemoryDriver({});
    await driver.connect();
    // Declaring the object is what teaches the driver which fields are
    // temporal (D-E2) — without it, no coercion happens at all.
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
        // The mixed-writer axis (D-E4): both shapes must converge on write.
        happened_at: row.writerForm === 'native' ? new Date(row.happened_at) : row.happened_at,
        happened_on: row.happened_on,
      });
    }
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
