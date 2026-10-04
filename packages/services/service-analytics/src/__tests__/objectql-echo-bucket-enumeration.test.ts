// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21647] The echo of a date bucket, enumerated: driver x timezone class x
 * granularity. Every cell is either the driver's own bucket expression or the
 * declared refusal, and which one is read off the ENGINE, not restated here.
 *
 * ## The rule
 *
 * `ObjectQLStrategy.generateSql` prints a bucket only in the expression the
 * driver itself renders for it (the `dateBucketSql` hook), at a UTC or unset
 * `timezone`; everything else refuses (`NOT_IMPLEMENTED` / 501,
 * `refusal: true`). The family it closes: SQLite's missing `date_trunc`
 * (#21441, #21595), a non-UTC zone the engine buckets in memory (#21630), and
 * a driver that runs no SQL (#21647). Measured on `main` `1968d5e812` before
 * this change, on `driver-memory` at UTC and with no `timezone`: the engine
 * only fetched rows (`find`), the face answered `2026-01` and `2026-W02`, and
 * both faces printed `date_trunc('month', closed_at)` and
 * `date_trunc('week', closed_at)`, statements nothing ran.
 *
 * ## How a cell is judged
 *
 * Each cell runs the query through the real `AnalyticsServicePlugin` (its
 * `sqlDialect` and `dateBucketSql` bridges) over a real `ObjectQL` engine. The
 * driver's two data doors are spied, so the cell OBSERVES where the engine put
 * the bucket: `aggregate` means the driver grouped it (the engine pushed it
 * down), `find` means the engine fetched rows and bucketed them in memory. The
 * expected echo follows from that observation and from the driver's own
 * `dateBucketSql` answer:
 *
 *   - pushed down to a driver that renders an expression for it: that
 *     expression, on `/analytics/sql` and as the `sql` of `/analytics/query`;
 *   - anything else (bucketed in memory, or grouped by a driver that runs no
 *     SQL): the refusal on `/analytics/sql`, and no `sql` on the query.
 *
 * A face's doors answer nothing, except on a named exception (below): its
 * table is seeded and its doors pass through, so its rows are real.
 *
 * The engine's predicate (`engine.aggregate`'s pushdown test: the driver's
 * `supports.queryDateGranularity`, `tzRequiresInMemory`, per-aggregation
 * filters) is not reachable from this package, so the strategy reads the
 * zone and the hook. This pin is what holds the two together: a change on
 * either side moves a cell.
 *
 * ## The axes, and what turns the pin red
 *
 *   - **driver**: `BUILTIN_DRIVER_IDS`, the spec's driver vocabulary.
 *     `DRIVER_ROWS` is keyed by it (`satisfies Record<BuiltinDriverId, ...>`),
 *     and a case asserts the key sets are equal, so a new builtin with no row
 *     fails typecheck and this file.
 *   - **timezone class**: UTC, unset, and any other zone. No enum declares
 *     them; the engine's `tzRequiresInMemory` does, inline. `ZONE_CLASSES`
 *     declares each class's probes and the tier the engine gives it, and a
 *     case asserts that tier on a driver that groups every granularity, so a
 *     probe the engine moves to another class is red. `Etc/UTC` is a probe of
 *     the in-memory class: the engine treats only the literal `UTC` as UTC.
 *   - **granularity**: `TimeUpdateInterval.options`, the enum
 *     `timeDimensions[].granularity` parses (derived from `DateGranularity`).
 *     The rows are generated from it, so a new granularity has its cells the
 *     moment it is declared, judged as above.
 *
 * ## The rows
 *
 *   - `sqlite` (better-sqlite3), `sqlite-wasm` (sql.js): real drivers.
 *     `postgres` and `mysql`: real `driver-sql` instances, never connected;
 *     their dialect and bucket expression answer from the client config alone,
 *     and the spied doors mean no statement is sent.
 *   - `memory`, by code path: `InMemoryDriver` declares `supports = {}`, so
 *     the engine buckets every granularity in memory, and it has neither
 *     `dialectName` nor `dateBucketSql`. The stand-in carries exactly that
 *     surface. The real driver is not imported: a new consumer of
 *     `@objectstack/driver-memory` is a maintainer ruling
 *     (`check:driver-memory-census`), not a test's choice. #21647's own
 *     measurement ran on the real driver, before and after this change.
 *   - `mongodb`, by code path: `driver-mongodb` publishes
 *     `queryDateGranularity` for every granularity
 *     (`MONGODB_DATE_GRANULARITIES`), so the engine pushes the bucket into its
 *     aggregation pipeline, and it has neither `dialectName` nor
 *     `dateBucketSql`. The stand-in carries exactly that surface. A live
 *     MongoDB reading is not required (#21647's triage).
 *   - `turso`, by code path, both faces: `TursoDriver extends SqlDriver` and
 *     inherits `dialectName` and `dateBucketSql` on both
 *     (`REMOTE_FACE_ANSWERS` in `turso-driver.ts`). The local face keeps
 *     SQLite's `supports`; the remote face publishes `queryDateGranularity: {}`,
 *     so the engine buckets in memory there.
 *
 * ## The two named exceptions, and the equivalence each asserts
 *
 * Two cells print while the engine buckets in memory. The echo prints a
 * statement only if that statement, run on the query's own datasource,
 * answers the face's keys and rows; otherwise it answers the refusal
 * (#21647's triage). So each exception asserts that equivalence, not merely
 * that a statement prints. If it ever breaks, the cell is red, and the cell
 * falls under the refusal.
 *
 *   - `turso`'s remote face, in this table. The engine buckets in memory, and
 *     the echo prints the SQLite expression the driver renders, because the
 *     hook answers. A face declaring `printsWhileEngineBucketsInMemory` is
 *     served over a seeded table (`EXCEPTION_DEALS`). Each printed cell (UTC
 *     and unset, every granularity) runs the printed statement with its
 *     params through the engine's raw-SQL bridge, on that face's datasource.
 *     It asserts the `closed_at` / `amount_sum` pairs equal the face's rows.
 *     The row's datasource is better-sqlite3, by code path. That libSQL
 *     answers the labels better-sqlite3 answers for this expression is pinned
 *     in `driver-turso`'s `turso-remote-inherited-members.test.ts`.
 *   - A measure carrying its own `filter`, outside this table's axes. The case
 *     "a measure filter, which the engine aggregates in memory" in
 *     `objectql-echo-date-bucket.test.ts` asserts the same equivalence. It
 *     runs on SQLite on every run, and on PostgreSQL where
 *     `OS_TEST_POSTGRES_URL` is set.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { BUILTIN_DRIVER_IDS, TimeUpdateInterval, type BuiltinDriverId, type Cube } from '@objectstack/spec/data';
import { declaredRefusalMessage } from '@objectstack/types';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';

const DEAL = 'os21647_bucket_deal';
const DEAL_OBJECT = {
  name: DEAL,
  label: 'Bucket enumeration deal',
  fields: {
    closed_at: { name: 'closed_at', type: 'datetime' as const },
    amount: { name: 'amount', type: 'number' as const },
  },
};
const CUBE = 'os21647_bucket_cube';
const CUBES = [
  {
    name: CUBE,
    title: 'Bucket enumeration cube',
    sql: DEAL,
    public: true,
    measures: { amount_sum: { type: 'sum', sql: 'amount', label: 'Amount' } },
    dimensions: { closed_at: { type: 'time', sql: 'closed_at', label: 'Closed at' } },
  },
] as unknown as Cube[];

const GRANULARITIES = TimeUpdateInterval.options;

/**
 * The table a named exception is served over (see the header). Every
 * granularity answers several buckets, and at least one bucket sums two rows.
 * e1 and e2 straddle an ISO week-year boundary: Sunday 2025-12-28 is
 * 2025-W52, and Monday 2025-12-29 is 2026-W01, both in calendar 2025. e3 is
 * 20:00 UTC on 31 January, e4 and e5 share a UTC day, and e6 opens Q2.
 */
const EXCEPTION_DEALS = [
  { id: 'e1', closed_at: '2025-12-28T10:00:00.000Z', amount: 3 },
  { id: 'e2', closed_at: '2025-12-29T10:00:00.000Z', amount: 20 },
  { id: 'e3', closed_at: '2026-01-31T20:00:00.000Z', amount: 7 },
  { id: 'e4', closed_at: '2026-02-03T08:00:00.000Z', amount: 1 },
  { id: 'e5', closed_at: '2026-02-03T23:30:00.000Z', amount: 4 },
  { id: 'e6', closed_at: '2026-04-02T00:30:00.000Z', amount: 5 },
] as const;
const EXCEPTION_TOTAL = EXCEPTION_DEALS.reduce((sum, deal) => sum + deal.amount, 0);

/**
 * Rows as `[closed_at, amount_sum]` pairs, ordered by the bucket. The key is
 * compared verbatim, and the measure as a number. The query asks no `order`,
 * so arrival order is not part of the answer on either side.
 */
const bucketPairs = (rows: unknown): Array<[unknown, number]> =>
  (rows as Array<Record<string, unknown>>)
    .map((row): [unknown, number] => [row.closed_at, Number(row.amount_sum)])
    .sort(([a], [b]) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

type Tier = 'pushdown' | 'in-memory';

/** The timezone classes, each with its probes and the tier the engine gives a date bucket in it. */
const ZONE_CLASSES: ReadonlyArray<{ label: string; probes: ReadonlyArray<string | undefined>; tier: Tier }> = [
  { label: 'UTC', probes: ['UTC'], tier: 'pushdown' },
  { label: 'unset', probes: [undefined], tier: 'pushdown' },
  { label: 'any other zone', probes: ['Asia/Shanghai', 'America/New_York', 'Etc/UTC'], tier: 'in-memory' },
];

/** The surface of a driver this pin reads: the engine's inputs and the bridges' inputs. */
interface EnumeratedDriver {
  readonly name: string;
  readonly supports?: unknown;
  readonly dialectName?: unknown;
  dateBucketSql?(objectName: string, field: string, granularity: string): unknown;
  connect(): Promise<void>;
  aggregate(...args: unknown[]): Promise<unknown>;
  find(...args: unknown[]): Promise<unknown>;
  [member: string]: unknown;
}

interface DriverFace {
  readonly face: string;
  build(): EnumeratedDriver;
  /** Release whatever `build` opened. */
  release?(driver: EnumeratedDriver): Promise<void>;
  /**
   * The named exception: where the zone's class lets the engine push a bucket
   * down, this face still buckets in memory, and the echo prints the hook's
   * expression. The reason, in words. A face declaring it is served over
   * `EXCEPTION_DEALS`, and each of its printed cells asserts the equivalence
   * (see the header).
   */
  readonly printsWhileEngineBucketsInMemory?: string;
}

const releaseKnex = async (driver: EnumeratedDriver) => {
  await (driver as { knex?: { destroy(): Promise<void> } }).knex?.destroy().catch(() => {});
};

const sqliteDriver = () =>
  new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any) as unknown as EnumeratedDriver;

/**
 * A driver that runs no SQL, by code path: its `supports`, and the two data
 * doors, with no `dialectName` and no `dateBucketSql`. `find` answers `rows`.
 */
const noSqlDriverByCodePath = (name: string, supports: Record<string, unknown>, rows: unknown[] = []): EnumeratedDriver => ({
  name,
  version: '0.0.0',
  supports,
  async connect() {},
  async disconnect() {},
  async aggregate() { return []; },
  async find() { return rows.map((row) => ({ ...(row as object) })); },
});

/** `driver-memory`'s surface on this pin's read path, by code path (see the header). */
const memoryByCodePath = (rows: unknown[] = []) => noSqlDriverByCodePath('os21647.memory-by-code-path', {}, rows);

/** `driver-mongodb`'s surface on this pin's read path, by code path (see the header). */
const mongodbByCodePath = () =>
  noSqlDriverByCodePath('os21647.mongodb-by-code-path', {
    batchSchemaSync: true,
    queryDateGranularity: Object.fromEntries(GRANULARITIES.map((g) => [g, true])),
  });

const DRIVER_ROWS = {
  memory: [{ face: 'driver-memory, by code path', build: () => memoryByCodePath() }],
  sqlite: [{ face: 'driver-sql, better-sqlite3', build: sqliteDriver, release: releaseKnex }],
  'sqlite-wasm': [
    {
      face: 'driver-sqlite-wasm, sql.js',
      build: () => new SqliteWasmDriver({ filename: ':memory:' }) as unknown as EnumeratedDriver,
      release: releaseKnex,
    },
  ],
  postgres: [
    {
      face: 'driver-sql, pg, never connected',
      build: () =>
        new SqlDriver({ client: 'pg', connection: { host: '127.0.0.1', database: 'unconnected' }, pool: { min: 0 } } as any) as unknown as EnumeratedDriver,
      release: releaseKnex,
    },
  ],
  mysql: [
    {
      face: 'driver-sql, mysql2, never connected',
      build: () =>
        new SqlDriver({ client: 'mysql2', connection: { host: '127.0.0.1', database: 'unconnected' }, pool: { min: 0 } } as any) as unknown as EnumeratedDriver,
      release: releaseKnex,
    },
  ],
  mongodb: [{ face: 'driver-mongodb, by code path', build: mongodbByCodePath }],
  turso: [
    { face: 'driver-turso local face, by code path', build: sqliteDriver, release: releaseKnex },
    {
      face: 'driver-turso remote face, by code path',
      build: () => {
        const driver = sqliteDriver();
        // `TursoDriver.supports` in remote mode: no granularity is bucketed natively.
        const supports = { ...(driver.supports as Record<string, unknown>), queryDateGranularity: {} };
        Object.defineProperty(driver, 'supports', { value: supports });
        return driver;
      },
      release: releaseKnex,
      printsWhileEngineBucketsInMemory:
        'it advertises no granularity, and inherits the SQLite expression, which libSQL runs and which answers the face\'s keys and rows',
    },
  ],
} satisfies Record<BuiltinDriverId, readonly DriverFace[]>;

/** The error `p` rejects with; a resolution fails the case. */
const refusalOf = (p: Promise<unknown>) =>
  p.then(
    () => { throw new Error('expected the echo to refuse'); },
    (e) => e as Error & { code?: string; status?: number; refusal?: unknown },
  );

/** The bucket expression an echo selects for `dim`: everything between `SELECT ` and ` AS "<dim>"`. */
const selectedBucket = (sql: string, dim: string) => sql.slice('SELECT '.length, sql.indexOf(` AS "${dim}"`));

const bucketed = (granularity: string, timezone: string | undefined) => ({
  cube: CUBE,
  measures: ['amount_sum'],
  timeDimensions: [{ dimension: 'closed_at', granularity }],
  ...(timezone === undefined ? {} : { timezone }),
});

/** One driver face served through the real plugin and engine, with its two data doors spied. */
async function serve(face: DriverFace) {
  const driver = face.build();
  const doors: Tier[] = [];
  // A named exception must show its equivalence, so its table is seeded and
  // its doors record the tier and pass through: its rows are real. Every other
  // face's doors are spies that answer nothing, because the engine's choice is
  // made before either door is called (the block at the end asks the rows of
  // `driver-memory`'s surface).
  const seeded = face.printsWhileEngineBucketsInMemory !== undefined;
  if (seeded) {
    const aggregate = driver.aggregate.bind(driver);
    const find = driver.find.bind(driver);
    driver.aggregate = async (...args: unknown[]) => { doors.push('pushdown'); return aggregate(...args); };
    driver.find = async (...args: unknown[]) => { doors.push('in-memory'); return find(...args); };
  } else {
    driver.connect = async () => {};
    driver.aggregate = async () => { doors.push('pushdown'); return []; };
    driver.find = async () => { doors.push('in-memory'); return []; };
  }

  const engine = new ObjectQL({ logger: quiet } as any);
  engine.registerDriver(driver as any, true);
  await engine.init();
  engine.registry.registerObject(DEAL_OBJECT as any);
  if (seeded) {
    await engine.syncSchemas();
    for (const deal of EXCEPTION_DEALS) await engine.insert(DEAL, { ...deal } as any);
  }

  const registered: Record<string, unknown> = {};
  await new AnalyticsServicePlugin({ cubes: CUBES, debugSql: true } as any).init({
    getService: (name: string) => (name === 'data' ? engine : registered[name]),
    registerService: (name: string, svc: unknown) => { registered[name] = svc; },
    replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
    hook: () => {},
    logger: quiet,
  } as never);
  const analytics = registered.analytics as AnalyticsService;

  /** Ask one cell: where the engine put the bucket, the face's rows, and both faces' echoes. */
  const ask = async (granularity: string, timezone: string | undefined) => {
    doors.length = 0;
    const query = bucketed(granularity, timezone);
    const res = await analytics.query(query as any);
    const tiers = [...doors];
    const dryRun = await analytics.generateSql(query as any).then(
      (r) => ({ sql: r.sql, params: r.params, refusal: undefined }),
      (e) => ({ sql: undefined, params: undefined, refusal: e as Error & { code?: string; status?: number; refusal?: unknown } }),
    );
    return { tiers, rows: res.rows, querySql: res.sql, dryRun };
  };

  /**
   * Run a printed statement with its params on this face's datasource,
   * through the engine's raw-SQL bridge, as `objectql-echo-date-bucket.test.ts`
   * runs its echo.
   */
  const run = async (sql: string, params: readonly unknown[]) => {
    const result = await (engine as any).execute(sql.replace(/\$(\d+)/g, '?'), { args: params, object: DEAL });
    return Array.isArray(result) ? result : (result as { rows: unknown[] }).rows;
  };

  /** The driver's own answer for this bucket, as the bridge receives it. */
  const expression = (granularity: string): string | undefined => {
    if (typeof driver.dateBucketSql !== 'function') return undefined;
    const answered = driver.dateBucketSql(DEAL, 'closed_at', granularity);
    return typeof answered === 'string' && answered !== '' ? answered : undefined;
  };

  return { ask, expression, run, release: async () => { await face.release?.(driver); } };
}

describe('[#21647] the echo of a date bucket: driver x timezone class x granularity', () => {
  it('has a row for every builtin driver, and every row has a face', () => {
    expect(Object.keys(DRIVER_ROWS).sort()).toEqual([...BUILTIN_DRIVER_IDS].sort());
    for (const faces of Object.values(DRIVER_ROWS)) expect(faces.length).toBeGreaterThan(0);
  });

  it('enumerates the declared granularities and at least one probe per timezone class', () => {
    expect(GRANULARITIES.length).toBeGreaterThan(0);
    for (const zoneClass of ZONE_CLASSES) expect(zoneClass.probes.length).toBeGreaterThan(0);
  });

  // The class map, asserted on the engine: on a driver that groups every
  // granularity, each probe lands in its class's tier.
  describe('each timezone probe is in the class the engine gives it (driver-sql, better-sqlite3)', () => {
    let served: Awaited<ReturnType<typeof serve>>;
    beforeAll(async () => { served = await serve(DRIVER_ROWS.sqlite[0]); });
    afterAll(async () => { await served?.release(); });

    for (const zoneClass of ZONE_CLASSES) {
      for (const probe of zoneClass.probes) {
        it(`${probe ?? 'unset'}: ${zoneClass.tier}`, async () => {
          for (const granularity of GRANULARITIES) {
            expect(served.expression(granularity), `this driver renders ${granularity}`).toBeDefined();
            const { tiers } = await served.ask(granularity, probe);
            expect(tiers, `${granularity}`).toEqual([zoneClass.tier]);
          }
        });
      }
    }
  });

  for (const [driverId, faces] of Object.entries(DRIVER_ROWS) as Array<[BuiltinDriverId, readonly DriverFace[]]>) {
    for (const face of faces) {
      describe(`${driverId} (${face.face})`, () => {
        let served: Awaited<ReturnType<typeof serve>>;
        beforeAll(async () => { served = await serve(face); });
        afterAll(async () => { await served?.release(); });

        for (const zoneClass of ZONE_CLASSES) {
          for (const probe of zoneClass.probes) {
            it.each(GRANULARITIES)(`timezone ${probe ?? 'unset'} (${zoneClass.label}), %s`, async (granularity) => {
              const { tiers, rows, querySql, dryRun } = await served.ask(granularity, probe);
              expect(tiers, 'the engine reached the driver exactly once').toHaveLength(1);
              const [tier] = tiers;
              const expression = served.expression(granularity);
              const printed =
                expression !== undefined &&
                (tier === 'pushdown' ||
                  (face.printsWhileEngineBucketsInMemory !== undefined && zoneClass.tier === 'pushdown'));

              if (face.printsWhileEngineBucketsInMemory !== undefined && zoneClass.tier === 'pushdown') {
                // The named exception is pinned as one: the engine does bucket in memory here.
                expect(tier, face.printsWhileEngineBucketsInMemory).toBe('in-memory');
              }

              if (printed) {
                expect(dryRun.refusal).toBeUndefined();
                expect(selectedBucket(dryRun.sql!, 'closed_at')).toBe(expression);
                expect(dryRun.sql).toContain(`GROUP BY ${expression}`);
                expect(querySql).toBe(dryRun.sql);

                if (face.printsWhileEngineBucketsInMemory !== undefined) {
                  // The exception's equivalence: the printed statement, run
                  // with its params on this face's datasource, answers the
                  // face's keys and rows. If it stops, this cell is red and
                  // belongs to the refusal.
                  const faceRows = bucketPairs(rows);
                  expect(faceRows.length, 'the face answered several buckets').toBeGreaterThan(1);
                  expect(faceRows.reduce((sum, [, amount]) => sum + amount, 0), 'the face counted every seeded row').toBe(EXCEPTION_TOTAL);
                  expect(bucketPairs(await served.run(dryRun.sql!, dryRun.params!)), face.printsWhileEngineBucketsInMemory).toEqual(faceRows);
                }
              } else {
                const err = dryRun.refusal;
                expect(err, `expected the refusal; the dry run printed ${dryRun.sql}`).toBeDefined();
                expect([err!.code, err!.status, err!.refusal]).toEqual(['NOT_IMPLEMENTED', 501, true]);
                expect(declaredRefusalMessage(err!)).toBe(err!.message);
                expect(querySql).toBeUndefined();
              }
            });
          }
        }
      });
    }
  }
});

/**
 * [#21647] The rows, on `driver-memory`'s surface (by code path, see the
 * header): `/analytics/query` serves them with no `sql`, and the dry run
 * refuses. The driver is only asked for rows, and the real engine buckets them
 * in memory. d2 (20:00 UTC on 31 January) stays in January at UTC. These are
 * the rows #21647 measured on the real driver.
 */
describe('[#21647] driver-memory\'s surface: the query serves its rows with no `sql`, and the dry run refuses', () => {
  const DEALS = [
    { id: 'd1', closed_at: '2026-01-10T10:00:00.000Z', amount: 20 },
    { id: 'd2', closed_at: '2026-01-31T20:00:00.000Z', amount: 7 },
    { id: 'd3', closed_at: '2026-02-03T08:00:00.000Z', amount: 1 },
  ];
  const ROWS: Record<string, Array<[string, number]>> = {
    month: [['2026-01', 27], ['2026-02', 1]],
    week: [['2026-W02', 20], ['2026-W05', 7], ['2026-W06', 1]],
  };
  let engine: ObjectQL;
  let analytics: AnalyticsService;
  const doors: string[] = [];

  beforeAll(async () => {
    const driver = memoryByCodePath(DEALS);
    const aggregate = driver.aggregate.bind(driver);
    const find = driver.find.bind(driver);
    driver.aggregate = async (...args: unknown[]) => { doors.push('aggregate'); return aggregate(...args); };
    driver.find = async (...args: unknown[]) => { doors.push('find'); return find(...args); };
    engine = new ObjectQL({ logger: quiet } as any);
    engine.registerDriver(driver as any, true);
    await engine.init();
    engine.registry.registerObject(DEAL_OBJECT as any);

    const registered: Record<string, unknown> = {};
    await new AnalyticsServicePlugin({ cubes: CUBES, debugSql: true } as any).init({
      getService: (name: string) => (name === 'data' ? engine : registered[name]),
      registerService: (name: string, svc: unknown) => { registered[name] = svc; },
      replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
      hook: () => {},
      logger: quiet,
    } as never);
    analytics = registered.analytics as AnalyticsService;
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  for (const timezone of ['UTC', undefined]) {
    it.each(Object.keys(ROWS))(`timezone ${timezone ?? 'unset'}, %s`, async (granularity) => {
      const query = { ...bucketed(granularity, timezone), order: { closed_at: 'asc' } };
      doors.length = 0;
      const res = await analytics.query(query as any);
      expect(doors, 'the driver only fetched rows').toEqual(['find']);
      expect((res.rows as Array<Record<string, unknown>>).map((r) => [r.closed_at, Number(r.amount_sum)])).toEqual(ROWS[granularity]);
      expect(res.sql).toBeUndefined();

      const err = await refusalOf(analytics.generateSql(query as any));
      expect([err.code, err.status, err.refusal]).toEqual(['NOT_IMPLEMENTED', 501, true]);
      expect(declaredRefusalMessage(err)).toBe(err.message);
    });
  }
});
