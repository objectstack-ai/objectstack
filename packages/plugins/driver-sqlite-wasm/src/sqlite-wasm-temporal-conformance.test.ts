// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Temporal filter conformance for the wasm driver (ADR-0053 D-A3).
 *
 * `SqliteWasmDriver extends SqlDriver`, so the whole temporal seam — canonical
 * datetime storage (#3912), the calendar-day bound rewrites (#3777/#4042), the
 * comparand coercion — is inherited, not re-implemented. This runs the shared
 * `@objectstack/spec/data` conformance table against the wasm engine so the
 * suite fails if this driver ever stops sharing that seam, the same guard the
 * #3773/#3777 pin tests established one case at a time.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  TEMPORAL_CONFORMANCE_CASES,
  TEMPORAL_CONFORMANCE_NOW,
  TEMPORAL_CONFORMANCE_ROWS,
} from '@objectstack/spec/data';
import { resolveFilterTokens } from '@objectstack/core';
import { SqliteWasmDriver } from './index.js';

const ids = (rows: any[]) => rows.map((r: any) => String(r.id)).sort();

const resolveTokens = <T,>(filter: T): T =>
  resolveFilterTokens(filter, { now: new Date(TEMPORAL_CONFORMANCE_NOW) });

describe('SqliteWasmDriver temporal conformance', () => {
  let driver: SqliteWasmDriver;

  beforeEach(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([
      {
        name: 'task',
        fields: {
          title: { type: 'string' },
          happened_at: { type: 'datetime' },
          happened_on: { type: 'date' },
        },
      },
    ]);
    for (const row of TEMPORAL_CONFORMANCE_ROWS) {
      await driver.create(
        'task',
        {
          id: row.id,
          title: row.id,
          happened_at: row.writerForm === 'native' ? new Date(row.happened_at) : row.happened_at,
          happened_on: row.happened_on,
        },
        { bypassTenantAudit: true } as any,
      );
    }
  });

  afterEach(async () => {
    await (driver as any).knex.destroy();
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
