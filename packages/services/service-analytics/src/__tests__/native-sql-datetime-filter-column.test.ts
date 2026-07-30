// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Regression #3912 — the COLUMN half of the datetime storage-form fix.
 *
 * `native-sql-datetime-filter.test.ts` covers coercing the comparand to epoch ms.
 * That alone is not enough: a SQLite `Field.datetime` column holds an INTEGER
 * epoch (a `Date` write) and ISO TEXT (a REST/JSON write, a `NOW()` default) at
 * the same time, so an epoch comparand matches the INTEGER rows and misses every
 * TEXT one — a dashboard `dateRange: last_30_days` reading 0 with rows in range.
 *
 * The fix threads a companion `StrategyContext.coerceTemporalFilterColumn` hook
 * that lets the driver normalise the column reference. These tests assert the
 * strategy applies it to exactly the value comparisons, leaves the null and LIKE
 * predicates on the raw column, and emits byte-identical SQL when the hook is
 * absent (Postgres, non-SQL drivers, legacy wiring).
 */

import { describe, it, expect } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';

const cube: Cube = {
  name: 'compliance',
  title: 'Compliance',
  sql: 'compliance_assessment',
  measures: { total: { name: 'total', label: 'Total', type: 'count', sql: '*' } },
  dimensions: {
    // Dimension id deliberately differs from the column, so a hook that fires on
    // `assessed_at` proves the storage target resolved the real column.
    assessed: { name: 'assessed', label: 'Assessed', type: 'time', sql: 'assessed_at' },
    title: { name: 'title', label: 'Title', type: 'string', sql: 'title' },
  },
  public: false,
};

/** Stand-in for `SqlDriver.temporalFilterColumnSql` under better-sqlite3. */
function sqliteColumnHook(object: string, field: string, columnSql: string): string {
  if (object === 'compliance_assessment' && field === 'assessed_at') {
    return `EPOCH_MS(${columnSql})`;
  }
  return columnSql; // date text / non-temporal / native timestamp → unchanged
}

function ctxWith(overrides: Partial<StrategyContext>): StrategyContext {
  return {
    getCube: (name) => (name === 'compliance' ? cube : undefined),
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async () => [],
    ...overrides,
  };
}

const withHook = () => ctxWith({ coerceTemporalFilterColumn: sqliteColumnHook });

const gen = async (query: AnalyticsQuery, ctx: StrategyContext) =>
  new NativeSQLStrategy().generateSql(query, ctx);

describe('NativeSQLStrategy — datetime filter column normalisation (#3912)', () => {
  it('normalises the column on a scalar comparison', async () => {
    const { sql } = await gen(
      { cube: 'compliance', measures: ['total'], where: { assessed: { $gte: '2025-06-18' } } },
      withHook(),
    );
    expect(sql).toContain('EPOCH_MS(assessed_at) >= $1');
  });

  it('normalises the column on an `in` set', async () => {
    const { sql } = await gen(
      {
        cube: 'compliance',
        measures: ['total'],
        where: { assessed: { $in: ['2025-06-18', '2025-06-19'] } },
      },
      withHook(),
    );
    expect(sql).toContain('EPOCH_MS(assessed_at) IN ($1, $2)');
  });

  it('normalises the column on a timeDimension dateRange — the dashboard shape', async () => {
    const { sql } = await gen(
      {
        cube: 'compliance',
        measures: ['total'],
        timeDimensions: [{ dimension: 'assessed', dateRange: ['2025-06-18', '2025-07-01'] }],
      },
      withHook(),
    );
    // Half-open since #3777: the bare-day end means "through that whole day",
    // so it binds as `< 2025-07-02`, and BOTH comparisons read the normalised
    // column.
    expect(sql).toContain(
      '(EPOCH_MS(assessed_at) >= $1 AND EPOCH_MS(assessed_at) < $2)',
    );
  });

  it('leaves the null predicates on the raw column (storage-independent)', async () => {
    const set = await gen(
      { cube: 'compliance', measures: ['total'], where: { assessed: { $exists: true } } },
      withHook(),
    );
    expect(set.sql).toContain('assessed_at IS NOT NULL');
    expect(set.sql).not.toContain('EPOCH_MS');

    const notSet = await gen(
      { cube: 'compliance', measures: ['total'], where: { assessed: null } },
      withHook(),
    );
    expect(notSet.sql).toContain('assessed_at IS NULL');
    expect(notSet.sql).not.toContain('EPOCH_MS');
  });

  it('leaves a LIKE match on the raw column (a substring match reads the text)', async () => {
    const { sql } = await gen(
      { cube: 'compliance', measures: ['total'], where: { assessed: { $contains: '2025-06' } } },
      withHook(),
    );
    expect(sql).toContain('assessed_at LIKE $1');
    expect(sql).not.toContain('EPOCH_MS');
  });

  it('does not touch a non-temporal column', async () => {
    const { sql } = await gen(
      { cube: 'compliance', measures: ['total'], where: { title: { $eq: 'SOC2' } } },
      withHook(),
    );
    expect(sql).toContain('title = $1');
    expect(sql).not.toContain('EPOCH_MS');
  });

  it('is backward-compatible: no hook → the bare column, exactly as before', async () => {
    const query: AnalyticsQuery = {
      cube: 'compliance',
      measures: ['total'],
      where: { assessed: { $gte: '2025-06-18' } },
      timeDimensions: [{ dimension: 'assessed', dateRange: ['2025-06-18', '2025-07-01'] }],
    };
    const { sql } = await gen(query, ctxWith({}));
    expect(sql).toContain('assessed_at >= $1');
    // The window itself is half-open (#3777) even without the storage hook —
    // bound semantics and storage-form normalisation are independent layers.
    expect(sql).toContain('(assessed_at >= $2 AND assessed_at < $3)');
  });

  it('falls back to the bare column when the hook returns nothing usable', async () => {
    const { sql } = await gen(
      { cube: 'compliance', measures: ['total'], where: { assessed: { $gte: '2025-06-18' } } },
      ctxWith({ coerceTemporalFilterColumn: () => '' as unknown as string }),
    );
    expect(sql).toContain('assessed_at >= $1');
  });
});
