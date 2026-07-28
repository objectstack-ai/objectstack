// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SqlDriver date bucket (dateGranularity) parity tests.
 *
 * Contract under test: the SQL emitted by `buildDateBucketExpr()` for each
 * granularity MUST produce the same label string as the in-memory
 * `bucketDateValue()` in `@objectstack/objectql`. Any drift breaks drill
 * filters that combine the two paths.
 *
 * `bucketDateValue` is reproduced verbatim here so the test is fully
 * self-contained (driver-sql has no dependency on objectql).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

type Granularity = 'day' | 'week' | 'month' | 'quarter' | 'year';

/** ⚠️ Keep in sync with `packages/objectql/src/in-memory-aggregation.ts#bucketDateValue` */
function bucketDateValue(value: unknown, g: Granularity): string {
  if (value == null) return '(null)';
  // A finite number is epoch milliseconds — SQLite's `Field.datetime` storage.
  const d =
    value instanceof Date ? value : typeof value === 'number' ? new Date(value) : new Date(String(value));
  if (Number.isNaN(d.getTime())) return '(null)';
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  switch (g) {
    case 'year': return String(y);
    case 'quarter': return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
    case 'month': return `${y}-${String(m).padStart(2, '0')}`;
    case 'day': return `${y}-${String(m).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    case 'week': {
      const target = new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate()));
      const dayNum = (target.getUTCDay() + 6) % 7;
      target.setUTCDate(target.getUTCDate() - dayNum + 3);
      const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
      const weekNo = 1 + Math.round(
        ((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
      );
      return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
    }
  }
}

// Fixture: dates chosen to hit cross-year, cross-quarter, cross-month, and
// ISO week boundaries (2024-12-30 is ISO week 2025-W01).
const FIXTURE: Array<{ id: string; ts: string }> = [
  { id: '1', ts: '2024-01-15T10:00:00Z' }, // 2024 / Q1 / Jan / W03
  { id: '2', ts: '2024-04-01T00:00:00Z' }, // 2024 / Q2 / Apr / W14
  { id: '3', ts: '2024-06-30T23:59:59Z' }, // 2024 / Q2 / Jun / W26
  { id: '4', ts: '2024-07-01T00:00:00Z' }, // 2024 / Q3 / Jul / W27
  { id: '5', ts: '2024-12-30T12:00:00Z' }, // 2024 / Q4 / Dec / W01 of 2025!
  { id: '6', ts: '2025-01-01T00:00:00Z' }, // 2025 / Q1 / Jan / W01
  { id: '7', ts: '2025-05-19T09:00:00Z' }, // 2025 / Q2 / May / W21
  { id: '8', ts: '2025-05-19T22:30:00Z' }, // 2025 / Q2 / May / W21 (same bucket as 7)
];

describe('SqlDriver date bucket (dateGranularity)', () => {
  let driver: SqlDriver;
  let knex: any;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    knex = (driver as any).knex;

    await knex.schema.createTable('events', (t: any) => {
      t.string('id').primary();
      t.string('ts');
    });
    await knex('events').insert(FIXTURE);
  });

  afterEach(async () => {
    await knex.destroy();
  });

  describe('capabilities advertisement', () => {
    it('advertises queryDateGranularity for the current dialect', () => {
      const caps = driver.supports.queryDateGranularity as Record<string, boolean>;
      expect(caps).toBeDefined();
      expect(caps.day).toBe(true);
      expect(caps.month).toBe(true);
      expect(caps.quarter).toBe(true);
      expect(caps.year).toBe(true);
      // SQLite-specific: ISO week (%V) is not assumed.
      expect(caps.week).toBe(false);
    });
  });

  describe.each<Granularity>(['day', 'month', 'quarter', 'year'])(
    'granularity=%s — native SQL matches bucketDateValue',
    (g) => {
      it('produces the same label set as the in-memory reference', async () => {
        const rows = await driver.aggregate('events', {
          groupBy: [{ field: 'ts', dateGranularity: g }],
          aggregations: [{ function: 'count', alias: 'n' }],
        });

        const expectedBuckets = new Map<string, number>();
        for (const r of FIXTURE) {
          const key = bucketDateValue(r.ts, g);
          expectedBuckets.set(key, (expectedBuckets.get(key) ?? 0) + 1);
        }

        const actualBuckets = new Map<string, number>();
        for (const row of rows) {
          actualBuckets.set(String(row.ts), Number(row.n));
        }

        expect([...actualBuckets.entries()].sort()).toEqual(
          [...expectedBuckets.entries()].sort(),
        );
      });
    },
  );

  describe('unsupported granularity', () => {
    it('throws a loud error for week on SQLite (so engine routes to in-memory)', async () => {
      await expect(
        driver.aggregate('events', {
          groupBy: [{ field: 'ts', dateGranularity: 'week' }],
          aggregations: [{ function: 'count', alias: 'n' }],
        }),
      ).rejects.toThrow(/dateGranularity 'week' not supported/);
    });
  });

  describe('mixed groupBy', () => {
    it('combines a plain field with a structured dateGranularity item', async () => {
      // Add a category column to verify mixed shape.
      await knex.schema.alterTable('events', (t: any) => {
        t.string('kind');
      });
      await knex('events').update({ kind: 'a' }).whereIn('id', ['1', '2', '3', '4']);
      await knex('events').update({ kind: 'b' }).whereIn('id', ['5', '6', '7', '8']);

      const rows = await driver.aggregate('events', {
        groupBy: ['kind', { field: 'ts', dateGranularity: 'year' }],
        aggregations: [{ function: 'count', alias: 'n' }],
      });

      // a (ids 1-4): all 2024 → a|2024=4
      // b (ids 5-8): id5 in 2024, ids 6-8 in 2025 → b|2024=1, b|2025=3
      const norm = rows
        .map((r: any) => `${r.kind}|${r.ts}=${Number(r.n)}`)
        .sort();
      expect(norm).toEqual(['a|2024=4', 'b|2024=1', 'b|2025=3']);
    });
  });
});
