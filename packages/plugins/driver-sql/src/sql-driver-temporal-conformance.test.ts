// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Temporal filter conformance for the SQL compiler, on a real engine
 * (in-memory better-sqlite3) — asserting ROW RESULTS, not emitted SQL
 * (ADR-0053 D-A3).
 *
 * The shared cases come from `@objectstack/spec/data` so this backend,
 * `driver-sqlite-wasm`, `driver-memory`, `driver-mongodb`, `formula`'s
 * `matchesFilterCondition` and the analytics preview evaluator are all held to
 * one standard — see `temporal-conformance.ts` for the four incidents
 * (#3650/#3773/#3777/#4047) that standard exists to end. Adding a case there
 * adds it to all six at once.
 *
 * Three sweeps here, because this driver owns two extra axes:
 *   1. canonical storage — rows written through `create()`, which the D-B1
 *      convention converges to canonical UTC text;
 *   2. the same table again with each case's relative-token spelling resolved
 *      through `@objectstack/core`'s `resolveFilterTokens` (the D-A3
 *      "token → row results" axis);
 *   3. legacy storage — the same rows seeded RAW as pre-#3912 forms (INTEGER
 *      epoch ms / zone-naive TEXT) with the canonical marker cleared, so the
 *      read-repair path answers the same table.
 *
 * Under CI's `Temporal Conformance (live PG + MySQL)` job this whole file also
 * runs against real non-UTC Postgres and MySQL servers — the server-timezone
 * axis needs no extra code here.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  TEMPORAL_CONFORMANCE_CASES,
  TEMPORAL_CONFORMANCE_NOW,
  TEMPORAL_CONFORMANCE_ROWS,
} from '@objectstack/spec/data';
import { resolveFilterTokens } from '@objectstack/core';
import { SqlDriver } from './index.js';
import { LegacyStorageDriver } from './legacy-datetime-storage.testkit.js';

const ids = (rows: any[]) => rows.map((r: any) => String(r.id)).sort();

const resolveTokens = <T,>(filter: T): T =>
  resolveFilterTokens(filter, { now: new Date(TEMPORAL_CONFORMANCE_NOW) });

const TASK = {
  name: 'task',
  fields: {
    title: { type: 'string' },
    happened_at: { type: 'datetime' },
    happened_on: { type: 'date' },
  },
};

describe('SqlDriver temporal conformance (SQLite, canonical storage)', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([TASK]);
    for (const row of TEMPORAL_CONFORMANCE_ROWS) {
      await driver.create(
        'task',
        {
          id: row.id,
          title: row.id,
          // The writer-form axis: `formatInput` must converge both shapes.
          happened_at: row.writerForm === 'native' ? new Date(row.happened_at) : row.happened_at,
          happened_on: row.happened_on,
        },
        { bypassTenantAudit: true } as any,
      );
    }
  });

  afterEach(async () => {
    await driver.disconnect?.();
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

describe('SqlDriver temporal conformance (SQLite, un-backfilled legacy storage)', () => {
  let driver: LegacyStorageDriver;

  beforeEach(async () => {
    driver = new LegacyStorageDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([TASK]);
    // The two pre-#3912 storage forms, split by the same writer-form tag:
    // `native` writes were INTEGER epoch ms (a bound JS Date), `wire` writes
    // were zone-naive TEXT (CURRENT_TIMESTAMP / REST payloads). One column,
    // both forms — the read repair must answer the same table the canonical
    // sweep does. (`happened_on` is unaffected: bare-day text has been the
    // date canon since Phase 1.)
    await driver.seedLegacyRows(
      'task',
      'happened_at',
      TEMPORAL_CONFORMANCE_ROWS.map((row) => ({
        id: row.id,
        title: row.id,
        happened_at:
          row.writerForm === 'native'
            ? Date.parse(row.happened_at)
            : row.happened_at.replace('T', ' ').replace('Z', ''),
        happened_on: row.happened_on,
      })),
    );
  });

  afterEach(async () => {
    await driver.disconnect?.();
  });

  // Literal spellings only: the token axis is orthogonal to storage form and
  // already swept above — a divergence here is a repair-path bug by construction.
  for (const c of TEMPORAL_CONFORMANCE_CASES) {
    it(c.name, async () => {
      const found = await driver.find('task', { where: c.filter } as any);
      expect(ids(found), c.note).toEqual(c.expected);
    });
  }
});
