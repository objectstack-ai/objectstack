// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21441] The ObjectQL face echoes a date-bucketed dimension in the bucket
 * expression the driver itself groups by, so the echo runs on that dialect and
 * answers the face's rows.
 *
 * ## The shape this closes
 *
 * `ObjectQLStrategy.generateSql` printed `date_trunc('<granularity>', col)` on
 * every dialect. Measured at `POST /api/v1/analytics/query` and
 * `POST /api/v1/analytics/sql` on `main` `0bddffd55`, default composition (the
 * native face declines a granularity, so every bucketed query lands here):
 *
 * | cell | the driver grouped by | that echo, run |
 * |:--|:--|:--|
 * | SQLite, month | `strftime('%Y-%m', …)` | `no such function: date_trunc` |
 * | SQLite, quarter | `(strftime('%Y', …) \|\| '-Q' \|\| …)` | `no such function: date_trunc` |
 * | PostgreSQL 16.14, month | `to_char((…)::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM')` | `2026-01-01T00:00:00.000Z` where the face answers `2026-01` |
 *
 * (The PostgreSQL row is the `datetime` expression. Since #21485 a `date`
 * buckets as `to_char((…)::date::timestamp, …)`, its calendar day.)
 *
 * The rows were right. The echo now reads the bucket from the `dateBucketSql`
 * hook, which the plugin fills from `SqlDriver.dateBucketSql`: the driver's
 * own `buildDateBucketExpr`, rendered. No second bucketing table.
 *
 * ## The cells
 *
 *   - **sqlite** (better-sqlite3), every run. Month, quarter and week are
 *     grouped by the driver (SQLite's `week` arm landed with #21595).
 *   - **postgres** where `OS_TEST_POSTGRES_URL` is set, a named skip otherwise.
 *     Month, quarter and week are grouped by the driver. CI provisions that
 *     variable for this package in the Temporal Conformance job's step
 *     "Run the non-SQL temporal backends under the skewed process zone"
 *     (`.github/workflows/ci.yml`), so the live cell is red-capable and runs in
 *     CI.
 *
 * [#21630] A non-UTC `timezone` makes the engine bucket in memory on that
 * zone's calendar, on every driver, so no statement the database runs groups
 * by those keys. The echo refuses there on every dialect: `/analytics/sql`
 * answers `NOT_IMPLEMENTED` / 501 as a declared refusal, and `/analytics/query`
 * serves the same rows with no `sql`. It used to print `date_trunc`, which
 * PostgreSQL 16.14 ran on the session zone's calendar (timestamp keys, and at
 * `America/New_York` other groupings than the face's). The live cells pin it
 * on SQLite and PostgreSQL, and the dialect matrix below pins it on SQLite,
 * PostgreSQL and MySQL through each driver's own hooks, with no server.
 *
 * At UTC, where the hook answers nothing (a host that wires no hook), the
 * bucket keeps the representative `date_trunc`. [#21595] Except on SQLite,
 * which has no `date_trunc`: there the echo refuses too.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { Cube } from '@objectstack/spec/data';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import type { StrategyContext } from '../strategies/types.js';
import { declaredRefusalMessage } from '@objectstack/types';

const DEAL = 'os21441_bucket_deal';

const DEAL_OBJECT = {
  name: DEAL,
  label: 'Bucket echo deal',
  fields: {
    closed_on: { name: 'closed_on', type: 'date' as const },
    closed_at: { name: 'closed_at', type: 'datetime' as const },
    amount: { name: 'amount', type: 'number' as const },
  },
};

// d2 closes at 20:00 UTC on 31 January, which is 1 February in Asia/Shanghai.
const DEALS = [
  { id: 'd1', closed_on: '2026-01-10', closed_at: '2026-01-10T10:00:00.000Z', amount: 20 },
  { id: 'd2', closed_on: '2026-01-25', closed_at: '2026-01-31T20:00:00.000Z', amount: 7 },
  { id: 'd3', closed_on: '2026-02-03', closed_at: '2026-02-03T08:00:00.000Z', amount: 1 },
  { id: 'd4', closed_on: '2026-03-14', closed_at: '2026-03-14T12:00:00.000Z', amount: 10 },
  { id: 'd5', closed_on: '2026-04-02', closed_at: '2026-04-02T00:30:00.000Z', amount: 5 },
] as const;

const CUBE = 'os21441_bucket_cube';
const CUBES = [
  {
    name: CUBE,
    title: 'Bucket echo cube',
    sql: DEAL,
    public: true,
    measures: { amount_sum: { type: 'sum', sql: 'amount', label: 'Amount' } },
    dimensions: {
      closed_on: { type: 'time', sql: 'closed_on', label: 'Closed on' },
      closed_at: { type: 'time', sql: 'closed_at', label: 'Closed at' },
    },
  },
] as unknown as Cube[];

/** A dataset whose measure carries its own `filter`, which the engine aggregates in memory. */
const FILTERED = DatasetSchema.parse({
  name: 'os21441_bucket_filtered',
  label: 'Bucket echo filtered',
  object: DEAL,
  dimensions: [{ name: 'closed_on', label: 'Closed on', field: 'closed_on', type: 'date' }],
  measures: [{ name: 'big_sum', label: 'Big', aggregate: 'sum', field: 'amount', filter: { amount: { $ne: 7 } } }],
});

const bucketed = (dim: string, granularity: string, extra: Record<string, unknown> = {}) => ({
  cube: CUBE,
  measures: ['amount_sum'],
  timeDimensions: [{ dimension: dim, granularity }],
  order: { [dim]: 'asc' },
  ...extra,
});

interface Cell {
  id: 'sqlite' | 'pg';
  label: string;
  env: string | null;
  config: () => Record<string, unknown> | null;
  /** The granularities the driver groups by in SQL; the rest it buckets in memory. */
  driverGrouped: readonly string[];
}

const CELLS: readonly Cell[] = [
  {
    id: 'sqlite',
    label: 'sqlite',
    env: null,
    config: () => ({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    driverGrouped: ['month', 'quarter', 'week'],
  },
  {
    id: 'pg',
    label: 'live postgres',
    env: 'OS_TEST_POSTGRES_URL',
    config: () => (process.env.OS_TEST_POSTGRES_URL ? { client: 'pg', connection: process.env.OS_TEST_POSTGRES_URL } : null),
    driverGrouped: ['month', 'quarter', 'week'],
  },
];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

type Row = Record<string, unknown>;

/** Rows as tuples of the named columns, in arrival order; a numeric cell reads as a number on every dialect. */
const tuples = (rows: unknown, columns: readonly string[]) =>
  (rows as Row[]).map((row) => columns.map((c) => (typeof row[c] === 'number' || /^-?\d+(\.\d+)?$/.test(String(row[c])) ? Number(row[c]) : row[c])));

/** The bucket expression an echo selects for `dim`: everything between `SELECT ` and ` AS "<dim>"`. */
const selectedBucket = (sql: string, dim: string) => sql.slice('SELECT '.length, sql.indexOf(` AS "${dim}"`));

/**
 * [#21630] Non-UTC zones, each with the `closed_at` month rows the engine
 * answers on that zone's calendar. d2 (20:00 UTC on 31 January) is February
 * in Asia/Shanghai and January in America/New_York.
 */
const ZONED: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, number]>]> = [
  ['Asia/Shanghai', [['2026-01', 20], ['2026-02', 8], ['2026-03', 10], ['2026-04', 5]]],
  ['America/New_York', [['2026-01', 27], ['2026-02', 1], ['2026-03', 10], ['2026-04', 5]]],
];

/** The error `p` rejects with; a resolution fails the case. */
const refusalOf = (p: Promise<unknown>) =>
  p.then(
    () => { throw new Error('expected the echo to refuse'); },
    (e) => e as Error & { code?: string; status?: number; refusal?: unknown },
  );

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#21441] the ObjectQL face echoes a date bucket in the driver's own expression (${cell.label})${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: any;
      let engine: ObjectQL;
      let analytics: AnalyticsService;
      /** Every statement the driver ran, in order. */
      const driverRan: string[] = [];

      const dropTables = async () => {
        if (cell.id !== 'pg') return;
        await driver?.execute(`drop table if exists ${DEAL}`).catch(() => {});
      };

      /** One `query()` and the statements the driver ran for it. */
      const ask = async (query: Record<string, unknown>) => {
        const before = driverRan.length;
        const res = await analytics.query(query as any);
        return { res, ran: driverRan.slice(before) };
      };

      /** Run an echo through the engine's raw-SQL bridge, as the native face runs its own statement. */
      const run = async (sql: string, params: unknown[]) => {
        const result = await (engine as any).execute(sql.replace(/\$(\d+)/g, '?'), { args: params, object: DEAL });
        return Array.isArray(result) ? result : (result as { rows: Row[] }).rows;
      };

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        await dropTables();
        engine = new ObjectQL({ logger: quiet } as any);
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(DEAL_OBJECT as any);
        await engine.syncSchemas();
        for (const row of DEALS) await engine.insert(DEAL, { ...row } as any);
        driver.knex.on('query', (q: { sql: string }) => { driverRan.push(q.sql); });

        // The default composition: no `queryCapabilities` override.
        const registered: Record<string, unknown> = {};
        await new AnalyticsServicePlugin({ cubes: CUBES, debugSql: true } as any).init({
          getService: (name: string) => (name === 'data' ? engine : registered[name]),
          registerService: (name: string, svc: unknown) => { registered[name] = svc; },
          replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
          hook: () => {},
          logger: quiet,
        } as never);
        analytics = registered.analytics as AnalyticsService;
        analytics.registerDataset(FILTERED);
      });

      afterAll(async () => {
        await dropTables();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      for (const dim of ['closed_on', 'closed_at']) {
        it.each(cell.driverGrouped)(`${dim}, %s: the echo selects and groups by the expression the driver ran, and it runs`, async (granularity) => {
          const query = bucketed(dim, granularity);
          const { res, ran } = await ask(query);
          const echo = res.sql!;
          // `generateSql` is the body `POST /analytics/sql` answers with.
          const dryRun = await analytics.generateSql(query as any);
          expect(dryRun.sql).toBe(echo);
          expect(dryRun.params).toEqual([]);

          const bucket = selectedBucket(echo, dim);
          expect(bucket).not.toContain('date_trunc');
          expect(echo).toContain(`GROUP BY ${bucket}`);
          expect(ran, 'the driver grouped by that expression').toHaveLength(1);
          expect(ran[0]).toContain(bucket);

          expect(tuples(await run(echo, dryRun.params), [dim, 'amount_sum'])).toEqual(tuples(res.rows, [dim, 'amount_sum']));
        });
      }

      it('a measure filter, which the engine aggregates in memory: the echo keeps the driver expression and runs with its params', async () => {
        const query = { cube: FILTERED.name, measures: ['big_sum'], timeDimensions: [{ dimension: 'closed_on', granularity: 'month' }], order: { closed_on: 'asc' } };
        const { res, ran } = await ask(query);
        expect(ran.some((sql) => /group by/i.test(sql)), 'the driver grouped nothing').toBe(false);
        expect(tuples(res.rows, ['closed_on', 'big_sum'])).toEqual([['2026-01', 20], ['2026-02', 1], ['2026-03', 10], ['2026-04', 5]]);
        const dryRun = await analytics.generateSql(query as any);
        expect(dryRun.sql).toBe(res.sql);
        expect(selectedBucket(dryRun.sql, 'closed_on')).not.toContain('date_trunc');
        expect(tuples(await run(dryRun.sql, dryRun.params), ['closed_on', 'big_sum'])).toEqual(tuples(res.rows, ['closed_on', 'big_sum']));
      });

      // [#21595] A FALLBACK case for "a granularity the driver buckets in
      // memory" lived here. Its one input was SQLite `week`, and both cells now
      // group all three, so it had none left: `week` runs in the case above.

      // [#21595, #21630] One rule on every cell. The PostgreSQL cell asserted
      // `date_trunc('month', closed_at)` here, a statement the engine did not
      // run: it buckets a non-UTC zone in memory.
      it.each(ZONED)('[#21630] REFUSAL: timezone %s, which the engine buckets in memory: the dry run refuses, and the query serves its rows with no `sql`', async (timezone, rows) => {
        const query = bucketed('closed_at', 'month', { timezone });
        const { res, ran } = await ask(query);
        expect(ran.some((sql) => /group by/i.test(sql)), 'the driver grouped nothing').toBe(false);
        // The rows are the engine's, on the zone's calendar; the refusal
        // concerns the echoed statement only.
        expect(tuples(res.rows, ['closed_at', 'amount_sum'])).toEqual(rows);
        // `/analytics/query`: the echo is a debugging aid, so its refusal
        // leaves the answer without one rather than failing the query.
        expect(res.sql).toBeUndefined();

        // `/analytics/sql`: the dry run refuses in the declared envelope.
        const err = await refusalOf(analytics.generateSql(query as any));
        expect([err.code, err.status, err.refusal]).toEqual(['NOT_IMPLEMENTED', 501, true]);
        // The read every withhold arm makes: the prose reaches the caller.
        expect(declaredRefusalMessage(err)).toBe(err.message);

        // The control: the same query at UTC renders the driver's own expression.
        const utc = await analytics.generateSql({ ...query, timezone: 'UTC' } as any);
        expect(selectedBucket(utc.sql, 'closed_at')).toBe(driver.dateBucketSql(DEAL, 'closed_at', 'month'));
      });
    },
  );
}

/**
 * [#21630] One rule on every dialect `driver-sql` models, MySQL included. Each
 * driver is constructed and never connected: its `dialectName` and
 * `dateBucketSql` answer from the client config alone, so this runs with no
 * server. The context is wired with them as `AnalyticsServicePlugin` wires its
 * `sqlDialect` and `dateBucketSql` hooks. The rows are not asked here: the
 * engine buckets a non-UTC zone in memory whatever the dialect, and the live
 * cells above pin them.
 */
describe('[#21630] the echo of a date bucket, per dialect: a non-UTC timezone refuses, and UTC keeps the driver\'s expression', () => {
  const DIALECT_CONFIGS = [
    { dialect: 'sqlite', config: { client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } },
    { dialect: 'postgres', config: { client: 'pg', connection: { host: '127.0.0.1', database: 'unconnected' }, pool: { min: 0 } } },
    { dialect: 'mysql', config: { client: 'mysql2', connection: { host: '127.0.0.1', database: 'unconnected' }, pool: { min: 0 } } },
  ] as const;
  const drivers: SqlDriver[] = [];

  afterAll(async () => {
    for (const d of drivers) await (d as any).knex?.destroy().catch(() => {});
  });

  for (const { dialect, config } of DIALECT_CONFIGS) {
    describe(dialect, () => {
      const driver = new SqlDriver(config as any);
      drivers.push(driver);
      const ctx = {
        getCube: (name: string) => (name === CUBE ? CUBES[0] : undefined),
        sqlDialect: () => (driver as any).dialectName,
        dateBucketSql: (object: string, field: string, granularity: string) =>
          driver.dateBucketSql(object, field, granularity as any) ?? undefined,
      } as unknown as StrategyContext;

      it('names its dialect', () => {
        expect((driver as any).dialectName).toBe(dialect);
      });

      for (const [timezone] of ZONED) {
        it.each(['month', 'week'])(`timezone ${timezone}, %s: refuses`, async (granularity) => {
          const err = await refusalOf(new ObjectQLStrategy().generateSql(bucketed('closed_at', granularity, { timezone }) as any, ctx));
          expect([err.code, err.status, err.refusal]).toEqual(['NOT_IMPLEMENTED', 501, true]);
          expect(declaredRefusalMessage(err)).toBe(err.message);
        });
      }

      for (const timezone of ['UTC', undefined]) {
        it.each(['month', 'week'])(`timezone ${timezone ?? 'unset'}, %s: the driver's own expression`, async (granularity) => {
          const { sql } = await new ObjectQLStrategy().generateSql(
            bucketed('closed_at', granularity, timezone === undefined ? {} : { timezone }) as any,
            ctx,
          );
          const expected = driver.dateBucketSql(DEAL, 'closed_at', granularity as any);
          expect(expected, 'the driver renders this granularity').toBeTruthy();
          expect(selectedBucket(sql, 'closed_at')).toBe(expected);
        });
      }
    });
  }
});

describe('[#21441] FALLBACK: a host that wires no dateBucketSql hook', () => {
  it('echoes the bucket as `date_trunc`', async () => {
    const ctx = { getCube: (name: string) => (name === CUBE ? CUBES[0] : undefined) } as unknown as StrategyContext;
    const { sql } = await new ObjectQLStrategy().generateSql(bucketed('closed_on', 'month') as any, ctx);
    expect(selectedBucket(sql, 'closed_on')).toBe("date_trunc('month', closed_on)");
  });

  it('[#21630] REFUSAL: with a non-UTC timezone, it refuses: the engine buckets that in memory whatever the host wires', async () => {
    const ctx = { getCube: (name: string) => (name === CUBE ? CUBES[0] : undefined) } as unknown as StrategyContext;
    const err = await refusalOf(new ObjectQLStrategy().generateSql(bucketed('closed_on', 'month', { timezone: 'Asia/Shanghai' }) as any, ctx));
    expect([err.code, err.status, err.refusal]).toEqual(['NOT_IMPLEMENTED', 501, true]);
    expect(declaredRefusalMessage(err)).toBe(err.message);
  });

  it('[#21595] REFUSAL: on a SQLite datasource, it refuses rather than echo `date_trunc`', async () => {
    const ctx = {
      getCube: (name: string) => (name === CUBE ? CUBES[0] : undefined),
      sqlDialect: () => 'sqlite',
    } as unknown as StrategyContext;
    const err = await new ObjectQLStrategy().generateSql(bucketed('closed_on', 'month') as any, ctx).then(
      () => { throw new Error('expected the echo to refuse'); },
      (e) => e as Error & { code?: string; status?: number; refusal?: unknown },
    );
    expect([err.code, err.status, err.refusal]).toEqual(['NOT_IMPLEMENTED', 501, true]);
    expect(declaredRefusalMessage(err)).toBe(err.message);
  });
});
