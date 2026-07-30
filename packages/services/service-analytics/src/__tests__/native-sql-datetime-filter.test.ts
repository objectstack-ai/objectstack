// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Regression: dashboard time-series charts / "last N months" KPIs that filter a
 * `Field.datetime` dimension must NOT silently return zero rows.
 *
 * Root cause (confirmed): the analytics layer expands relative-date tokens like
 * `{12_months_ago}` to ISO date strings (`"2025-06-18"`). Under better-sqlite3 a
 * `Field.datetime` column is stored as an INTEGER epoch (ms), so the compiled
 * `WHERE col >= '2025-06-18'` is a TEXT-vs-INTEGER affinity compare that is
 * ALWAYS false → empty result, even though the data exists. `Field.date` columns
 * store ISO TEXT and compare fine.
 *
 * The fix threads the driver's storage-form coercion into NativeSQLStrategy via
 * `StrategyContext.coerceTemporalFilterValue`. These tests assert the strategy:
 *   1. binds the epoch-ms value when the hook reports a datetime column (SQLite),
 *   2. leaves the ISO string untouched when the hook reports no coercion
 *      (a `Field.date` text column, OR a native-timestamp dialect like Postgres),
 *      proving no Postgres regression,
 *   3. applies the same handling to `gte`/`lte`/`gt`/`lt`/`equals`, `in`, and the
 *      `dateRange` (timeDimension) path.
 */

import { describe, it, expect } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';

/** compliance_assessment cube: `assessed` dimension → datetime column `assessed_at`. */
const cube: Cube = {
  name: 'compliance',
  title: 'Compliance',
  sql: 'compliance_assessment',
  measures: { total: { name: 'total', label: 'Total', type: 'count', sql: '*' } },
  dimensions: {
    // NB: dimension id `assessed` deliberately differs from column `assessed_at`
    // to prove the storage target resolves the real column, not the member name.
    assessed: { name: 'assessed', label: 'Assessed', type: 'time', sql: 'assessed_at' },
    score: { name: 'score', label: 'Score', type: 'number', sql: 'score' },
  },
  public: false,
};

const EPOCH_2025_06_18 = Date.parse('2025-06-18T00:00:00.000Z');

/**
 * A hook that mimics the SqlDriver-under-SQLite behaviour: ISO → epoch ms for the
 * datetime column, value untouched for everything else.
 */
function sqliteHook(object: string, field: string, value: unknown): unknown {
  if (object === 'compliance_assessment' && field === 'assessed_at' && typeof value === 'string') {
    const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
    return Number.isFinite(ms) ? ms : value;
  }
  return value; // date text / non-temporal / native timestamp → unchanged
}

function ctxWith(overrides: Partial<StrategyContext>): StrategyContext {
  return {
    getCube: (name) => (name === 'compliance' ? cube : undefined),
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async () => [],
    ...overrides,
  };
}

describe('NativeSQLStrategy — datetime filter storage coercion', () => {
  it('binds an ISO `gte` filter on a datetime column as epoch ms (SQLite fix)', async () => {
    const strategy = new NativeSQLStrategy();
    const ctx = ctxWith({ coerceTemporalFilterValue: sqliteHook });
    const query: AnalyticsQuery = {
      cube: 'compliance',
      measures: ['total'],
      where: { assessed: { $gte: '2025-06-18' } },
    };

    const { sql, params } = await strategy.generateSql(query, ctx);

    expect(sql).toContain('assessed_at >= $1');
    // The ISO string was converted to its INTEGER epoch storage form — this is
    // the exact value that matches the stored datetime and fixes "No rows".
    expect(params).toEqual([EPOCH_2025_06_18]);
    expect(typeof params[0]).toBe('number');
  });

  it('leaves the ISO string untouched when the hook reports no coercion (Postgres / date text — no regression)', async () => {
    const strategy = new NativeSQLStrategy();
    // Hook present but returns the value unchanged for this column — the contract
    // for a native-timestamp dialect or a `Field.date` text column.
    const ctx = ctxWith({ coerceTemporalFilterValue: (_o, _f, v) => v });
    const query: AnalyticsQuery = {
      cube: 'compliance',
      measures: ['total'],
      where: { assessed: { $gte: '2025-06-18' } },
    };

    const { params } = await strategy.generateSql(query, ctx);

    // Bound as the ISO TEXT comparand — correct against a native TIMESTAMP or a
    // YYYY-MM-DD text date; NOT coerced to an epoch integer (would break Postgres).
    expect(params).toEqual(['2025-06-18']);
    expect(typeof params[0]).toBe('string');
  });

  it('is backward-compatible: no hook configured → value bound as-is', async () => {
    const strategy = new NativeSQLStrategy();
    const ctx = ctxWith({}); // no coerceTemporalFilterValue
    const query: AnalyticsQuery = {
      cube: 'compliance',
      measures: ['total'],
      where: { assessed: { $gte: '2025-06-18' } },
    };
    const { params } = await strategy.generateSql(query, ctx);
    expect(params).toEqual(['2025-06-18']);
  });

  it('coerces both bounds of a datetime range (gte + lt)', async () => {
    const strategy = new NativeSQLStrategy();
    const ctx = ctxWith({ coerceTemporalFilterValue: sqliteHook });
    const query: AnalyticsQuery = {
      cube: 'compliance',
      measures: ['total'],
      where: { assessed: { $gte: '2025-06-18', $lt: '2025-07-01' } },
    };
    const { params } = await strategy.generateSql(query, ctx);
    expect(params).toEqual([
      EPOCH_2025_06_18,
      Date.parse('2025-07-01T00:00:00.000Z'),
    ]);
  });

  it('compiles a bare-day `lte` half-open — through the whole day (#3777)', async () => {
    const strategy = new NativeSQLStrategy();
    const ctx = ctxWith({ coerceTemporalFilterValue: sqliteHook });
    const query: AnalyticsQuery = {
      cube: 'compliance',
      measures: ['total'],
      where: { assessed: { $lte: '2025-06-18' } },
    };
    const { sql, params } = await strategy.generateSql(query, ctx);
    // `<= 2025-06-18` means "including everything on June 18th": the bound is
    // June 19th's midnight, compared with `<` — not midnight of the 18th.
    expect(sql).toContain('assessed_at < $1');
    expect(params).toEqual([Date.parse('2025-06-19T00:00:00.000Z')]);
  });

  it('a full-ISO `lte` keeps instant semantics (no widening)', async () => {
    const strategy = new NativeSQLStrategy();
    const ctx = ctxWith({ coerceTemporalFilterValue: sqliteHook });
    const query: AnalyticsQuery = {
      cube: 'compliance',
      measures: ['total'],
      where: { assessed: { $lte: '2025-06-18T12:00:00.000Z' } },
    };
    const { sql, params } = await strategy.generateSql(query, ctx);
    expect(sql).toContain('assessed_at <= $1');
    expect(params).toEqual([Date.parse('2025-06-18T12:00:00.000Z')]);
  });

  it('coerces each element of an `in` set on a datetime column', async () => {
    const strategy = new NativeSQLStrategy();
    const ctx = ctxWith({ coerceTemporalFilterValue: sqliteHook });
    const query: AnalyticsQuery = {
      cube: 'compliance',
      measures: ['total'],
      where: { assessed: { $in: ['2025-06-18', '2025-06-19'] } },
    };
    const { sql, params } = await strategy.generateSql(query, ctx);
    expect(sql).toContain('IN ($1, $2)');
    expect(params).toEqual([
      EPOCH_2025_06_18,
      Date.parse('2025-06-19T00:00:00.000Z'),
    ]);
  });

  it('coerces a timeDimension dateRange (half-open window) on a datetime column', async () => {
    const strategy = new NativeSQLStrategy();
    const ctx = ctxWith({ coerceTemporalFilterValue: sqliteHook });
    const query: AnalyticsQuery = {
      cube: 'compliance',
      measures: ['total'],
      timeDimensions: [{ dimension: 'assessed', dateRange: ['2025-06-18', '2025-07-01'] }],
    };
    const { sql, params } = await strategy.generateSql(query, ctx);
    // Half-open since #3777: the bare-day end "2025-07-01" means through the
    // whole of July 1st, so the coerced upper bound is July 2nd's midnight,
    // compared with `<` — not the BETWEEN whose inclusive midnight bound
    // dropped the final day's rows.
    expect(sql).toContain('>= $1 AND');
    expect(sql).toContain('< $2');
    expect(params).toEqual([
      EPOCH_2025_06_18,
      Date.parse('2025-07-02T00:00:00.000Z'),
    ]);
  });

  it('does NOT coerce a non-temporal numeric column', async () => {
    const strategy = new NativeSQLStrategy();
    const ctx = ctxWith({ coerceTemporalFilterValue: sqliteHook });
    const query: AnalyticsQuery = {
      cube: 'compliance',
      measures: ['total'],
      where: { score: { $gte: '80' } },
    };
    const { params } = await strategy.generateSql(query, ctx);
    // hook returns the string unchanged → falls back to numeric recovery
    expect(params).toEqual([80]);
  });
});
