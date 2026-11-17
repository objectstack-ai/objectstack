// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35015] The row key a structured `groupBy` node's `alias` produces on the
 * pushed-down SQL face: the alias, on every dialect cell, for a date bucket and
 * for a plain field alike.
 *
 * The data-modeling docs said the SQL driver ignored the alias and always
 * projected the bucket under the field name. That has been false since #6401
 * (`sql-driver-aggregation.ts`, `const outKey = g.alias ?? g.field`), and the
 * query skill (`skills/objectstack-query/rules/aggregation.md`) already teaches
 * that the column keys match on both paths. This file holds that answer at the
 * key level: the EXACT key set of every row, so a face that projected the field
 * name (or both names) turns it red. The in-memory half of the same answer is
 * `packages/objectql/src/in-memory-aggregation.test.ts` ('groups by a structured
 * groupBy with dateGranularity (quarter)', alias `qtr`).
 *
 * Measured through `engine.aggregate` on SQLite and live PostgreSQL 16 before
 * this file was written: every arm (pushed down; in memory, forced by an offset
 * zone or by a driver that declares no `quarter` bucket) answered the same keys.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/data';
import { SqlDriver } from '../src/index.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'os35015_groupby_alias';

const ROWS = [
  { id: 'd1', region: 'us', amount: 10, closed_at: '2025-01-15T12:00:00.000Z' },
  { id: 'd2', region: 'us', amount: 20, closed_at: '2025-02-15T12:00:00.000Z' },
  { id: 'd3', region: 'eu', amount: 5, closed_at: '2025-04-15T12:00:00.000Z' },
  { id: 'd4', region: 'us', amount: 7, closed_at: '2025-05-15T12:00:00.000Z' },
];

const revenue = [{ function: 'sum', field: 'amount', alias: 'revenue' }];

/** Every row's key set, sorted, and the rows as `key|revenue` pairs (pg hands some numbers back as strings). */
function read(rows: Array<Record<string, unknown>>, groupKeys: string[]) {
  return {
    keys: [...new Set(rows.map((r) => Object.keys(r).sort().join(',')))],
    pairs: rows.map((r) => `${groupKeys.map((k) => String(r[k])).join('/')}|${Number(r.revenue)}`).sort(),
  };
}

function declareCell(cell: DialectCell): void {
  describe(`[#35015] a structured groupBy alias is the row key (${cell.label})`, () => {
    let driver: SqlDriver;
    let quarterNative = false;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.initObjects([
        { name: TABLE, fields: { region: { type: 'string' }, amount: { type: 'number' }, closed_at: { type: 'datetime' } } },
      ] as never);
      for (const row of ROWS) await driver.create(TABLE, { ...row }, { bypassTenantAudit: true } as never);
      const caps = (driver as unknown as { supports: { queryDateGranularity?: Record<string, boolean> } }).supports;
      quarterNative = caps.queryDateGranularity?.quarter === true;
    });

    afterAll(async () => {
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.disconnect();
    });

    it('declares a native quarter bucket, so the cases below are the pushed-down face', () => {
      expect(quarterNative).toBe(true);
    });

    it('a date bucket with alias projects under the alias, not the field name', async () => {
      const rows = (await driver.aggregate(TABLE, {
        groupBy: [{ field: 'closed_at', dateGranularity: 'quarter', alias: 'quarter' }],
        aggregations: revenue,
      } as unknown as DriverQuery)) as Array<Record<string, unknown>>;
      expect(read(rows, ['quarter'])).toEqual({ keys: ['quarter,revenue'], pairs: ['2025-Q1|30', '2025-Q2|12'] });
    });

    it('control: the same bucket without alias projects under the field name', async () => {
      const rows = (await driver.aggregate(TABLE, {
        groupBy: [{ field: 'closed_at', dateGranularity: 'quarter' }],
        aggregations: revenue,
      } as unknown as DriverQuery)) as Array<Record<string, unknown>>;
      expect(read(rows, ['closed_at'])).toEqual({ keys: ['closed_at,revenue'], pairs: ['2025-Q1|30', '2025-Q2|12'] });
    });

    it('a plain field alias beside a bucket alias: both columns carry their alias', async () => {
      const rows = (await driver.aggregate(TABLE, {
        groupBy: [{ field: 'region', alias: 'r' }, { field: 'closed_at', dateGranularity: 'quarter', alias: 'quarter' }],
        aggregations: revenue,
      } as unknown as DriverQuery)) as Array<Record<string, unknown>>;
      expect(read(rows, ['r', 'quarter'])).toEqual({
        keys: ['quarter,r,revenue'],
        pairs: ['eu/2025-Q2|5', 'us/2025-Q1|30', 'us/2025-Q2|7'],
      });
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, '#35015 structured groupBy alias row key', declareCell);
}
