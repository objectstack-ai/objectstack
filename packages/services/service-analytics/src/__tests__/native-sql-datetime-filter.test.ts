// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Regression: dashboard time-series charts / "last N months" KPIs that filter a
 * `Field.datetime` dimension must NOT silently return zero rows.
 *
 * Root cause (confirmed): the analytics layer expands relative-date tokens like
 * `{12_months_ago}` to ISO date strings (`"2025-06-18"`), and the raw-SQL
 * strategy binds them OUTSIDE the driver's builder, so nothing canonicalises
 * them to the column's storage form. `WHERE col >= '2025-06-18'` then compares
 * an unnormalised comparand against the stored value and is always false →
 * empty result, even though the data exists.
 *
 * The fix threads the driver's storage-form coercion into NativeSQLStrategy via
 * `StrategyContext.coerceTemporalFilterValue`. These tests assert the strategy:
 *   1. binds whatever the hook returns, VERBATIM and at the hook's own type,
 *      when the hook reports a datetime column,
 *   2. leaves the comparand untouched when the hook reports no coercion
 *      (a `Field.date` text column, OR a native-timestamp dialect like Postgres),
 *      proving no Postgres regression,
 *   3. applies the same handling to `gte`/`lte`/`gt`/`lt`/`equals`, `in`, and the
 *      `dateRange` (timeDimension) path.
 *
 * ## ⛔ Two storage forms appear below, and only one of them is current (#16737)
 *
 * This file's original narrative said "under better-sqlite3 a `Field.datetime`
 * column is stored as an INTEGER epoch (ms)". #3912 retired that: a SQLite
 * `Field.datetime` now has ONE storage form, canonical UTC TEXT, and the epoch
 * survives only in a database written before the convention and not yet
 * backfilled. The storage reality is stated once, on
 * `AnalyticsServiceConfig.coerceTemporalFilterValue` in `analytics-service.ts`.
 *
 * The epoch-ms fixture is KEPT rather than re-spelled, because the property
 * under test is that the strategy binds the hook's return verbatim — and an
 * epoch hook is the only one that changes both the VALUE and its JS TYPE, which
 * is what makes "verbatim" decidable. `canonicalTextHook` below adds today's
 * real driver behaviour beside it, so the suite covers the live form as well as
 * the one it was written against.
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
 * A LEGACY-form hook: ISO → epoch ms for the datetime column, value untouched
 * for everything else. It is not what `SqlDriver` answers today (see the module
 * header) — it is the type-changing return that makes "bound verbatim"
 * observable.
 */
function sqliteHook(object: string, field: string, value: unknown): unknown {
  if (object === 'compliance_assessment' && field === 'assessed_at' && typeof value === 'string') {
    const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
    return Number.isFinite(ms) ? ms : value;
  }
  return value; // date text / non-temporal / native timestamp → unchanged
}

/**
 * [#16737] Today's `SqlDriver`-under-SQLite behaviour: a `Field.datetime`
 * comparand is canonicalised to the ONE stored form, canonical UTC text
 * (`YYYY-MM-DDTHH:MM:SS.sssZ`, #3912) — a bare calendar day becoming UTC
 * midnight. Same contract as {@link sqliteHook}, current spelling.
 */
function canonicalTextHook(object: string, field: string, value: unknown): unknown {
  if (object === 'compliance_assessment' && field === 'assessed_at' && typeof value === 'string') {
    const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
  }
  return value;
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
    // The hook's return is bound verbatim, at the hook's own JS type — the
    // strategy adds no interpretation of its own. (This assertion used to be
    // described as "the value that matches the stored datetime"; that is the
    // DRIVER's claim to make, not this suite's — see the module header.)
    expect(params).toEqual([EPOCH_2025_06_18]);
    expect(typeof params[0]).toBe('number');
  });

  it('binds the CANONICAL UTC text a modern SQLite driver returns (#16737 — the live storage form)', async () => {
    // The sibling of the epoch case above, against what `SqlDriver` actually
    // answers on `origin/main`. Both prove the same property — the hook's
    // return is bound verbatim — so the strategy is correct for the storage
    // form the driver has TODAY, not only for the one this file was written
    // against. A bare calendar day arrives as UTC midnight, in full canonical
    // spelling, and stays a string.
    const strategy = new NativeSQLStrategy();
    const ctx = ctxWith({ coerceTemporalFilterValue: canonicalTextHook });
    const query: AnalyticsQuery = {
      cube: 'compliance',
      measures: ['total'],
      where: { assessed: { $gte: '2025-06-18' } },
    };

    const { sql, params } = await strategy.generateSql(query, ctx);

    expect(sql).toContain('assessed_at >= $1');
    expect(params).toEqual(['2025-06-18T00:00:00.000Z']);
    expect(typeof params[0]).toBe('string');
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
    // The hook returns the value unchanged for a non-temporal column, and the
    // fallback binds it as the author wrote it.
    //
    // [#5526] This assertion used to read `[80]`. It was pinning the DECODER
    // half of the deleted `values: string[]` round trip: the fallback was
    // `coerceFilterValueForSql`, which re-read a numeric-LOOKING string as a
    // number — the same guess that bound `'007'` as `7` against a TEXT column
    // and drew "no data". A string comparand now binds as a string, and the
    // comparison is decided by the database's own type resolution (SQLite
    // applies this INTEGER column's numeric affinity to it; Postgres infers the
    // parameter type from the column). What this test still proves is unchanged
    // and is why it stays here: the temporal hook does not touch a non-temporal
    // column. The full comparand-type table lives in
    // `filter-value-type-fidelity.test.ts`.
    expect(params).toEqual(['80']);
  });
});
