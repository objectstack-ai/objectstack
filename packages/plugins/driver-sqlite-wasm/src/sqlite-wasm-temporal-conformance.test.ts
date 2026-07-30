// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Temporal conformance for the wasm driver (ADR-0053 D-A3, #4081).
 *
 * `SqliteWasmDriver extends SqlDriver`, so the whole temporal seam — canonical
 * datetime storage (#3912), the calendar-day bound rewrites (#3777/#4042), the
 * comparand coercion — is inherited, not re-implemented. This runs the shared
 * `@objectstack/spec/data` table against the wasm engine so the suite fails if
 * this driver ever stops sharing that seam — the same guard the #3773/#3777
 * pin tests established one case at a time, now spanning the full matrix,
 * token spellings included.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  TEMPORAL_CASES,
  TEMPORAL_NOW,
  TEMPORAL_ROWS,
  TEMPORAL_TIME_CASES,
  TEMPORAL_TIME_ROWS,
} from '@objectstack/spec/data';
import { resolveFilterTokens } from '@objectstack/core';
import { SqliteWasmDriver } from './index.js';

const resolveTokens = <T,>(filter: T): T =>
  resolveFilterTokens(filter, { now: new Date(TEMPORAL_NOW) });

describe('driver-sqlite-wasm — temporal conformance', () => {
  let driver: SqliteWasmDriver;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([
      {
        name: 'conformance',
        fields: { at: { type: 'datetime' }, on: { type: 'date' }, why: { type: 'string' } },
      },
    ]);
    for (const r of TEMPORAL_ROWS) {
      await driver.create(
        'conformance',
        {
          id: r.id,
          // The mixed-writer axis (D-E4): both shapes must converge on write.
          at: r.writerForm === 'native' ? new Date(r.at) : r.at,
          on: r.on,
          why: r.why,
        },
        { bypassTenantAudit: true } as any,
      );
    }
  });

  afterAll(async () => {
    await (driver as any).knex.destroy();
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

describe('driver-sqlite-wasm — Field.time conformance', () => {
  let driver: SqliteWasmDriver;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([
      { name: 'time_conformance', fields: { at: { type: 'time' }, why: { type: 'string' } } },
    ]);
    for (const r of TEMPORAL_TIME_ROWS) {
      await driver.create(
        'time_conformance',
        {
          id: r.id,
          // The mixed-writer axis for wall clocks (#3994 measured this exact
          // column): a bound `Date` and a canonical-text write must converge.
          at: r.writerForm === 'native' ? new Date(`1970-01-01T${r.at}Z`) : r.at,
          why: r.why,
        },
        { bypassTenantAudit: true } as any,
      );
    }
  });

  afterAll(async () => {
    await (driver as any).knex.destroy();
  });

  for (const c of TEMPORAL_TIME_CASES) {
    it(c.name, async () => {
      const rows = await driver.find('time_conformance', { where: c.filter } as any);
      const got = (rows as any[]).map((r) => r.id).sort();
      expect(got, c.note).toEqual([...c.expected].sort());
    });
  }
});
