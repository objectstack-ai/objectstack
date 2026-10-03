// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21485] A `Field.date` buckets as its own calendar day, whatever zone the
 * server or the session is in. A `Field.datetime` buckets as its UTC instant.
 *
 * ## The defect this pins closed
 *
 * `buildDateBucketExpr` used one expression per dialect for every column it
 * bucketed, the instant one: `to_char((col)::timestamptz AT TIME ZONE 'UTC', …)`
 * on PostgreSQL and `date_format(convert_tz(col, @@session.time_zone, '+00:00'), …)`
 * on MySQL. A `date` has no instant, so the cast INVENTED one: midnight in the
 * session's zone. On a session east of UTC that midnight is the previous UTC
 * day, and the UTC conversion then read the day before. Measured on
 * PostgreSQL 16.14 with the server's `TimeZone` at `Asia/Shanghai`, and on
 * MySQL 8.0.46 with the session at `+08:00`, both before the fix:
 *
 * | `Field.date` value | day          | week       | month     | quarter   | year   |
 * |:--|:--|:--|:--|:--|:--|
 * | `2026-06-01`       | `2026-05-31` | `2026-W22` | `2026-05` | `2026-Q2` | `2026` |
 * | `2026-01-01`       | `2025-12-31` | `2026-W01` | `2025-12` | `2025-Q4` | `2025` |
 * | `2024-12-30`       | `2024-12-29` | `2024-W52` | `2024-12` | `2024-Q4` | `2024` |
 *
 * At a UTC session every one of those is the value's own calendar day, which
 * is why the UTC cells stayed green: the zone decided the answer.
 *
 * ## The cells
 *
 *  - **sqlite**, every run. A `date` is TEXT there and `strftime` reads it with
 *    no zone, so this cell is the control the live cells must agree with.
 *  - **live postgres** / **live mysql**, where `OS_TEST_POSTGRES_URL` /
 *    `OS_TEST_MYSQL_URL` are provisioned (the `Temporal Conformance (live PG +
 *    MySQL)` CI job, step "Run driver-sql suite against both live servers"),
 *    and a named skip (red under `OS_EXPECT_LIVE_DIALECT_MATRIX=1`) otherwise.
 *    Each runs twice:
 *     1. **as provisioned** — the session the driver leaves in place. On
 *        PostgreSQL that is the server's `TimeZone` (`Asia/Shanghai` in CI),
 *        which is this card's reproduction. On MySQL the driver pins its own
 *        session to `+00:00` (#3942), so this run cannot see the defect there.
 *        Both axes are asserted, and the three-way zone skew is asserted first.
 *     2. **session at +08:00** — a host `pool.afterCreate` sets the session
 *        zone, which the driver chains after its own hook. This is the run that
 *        is red-capable on any server, and the only one that is on MySQL. A
 *        test asserts that the session really is at `+08:00`, so a hook that
 *        stops taking effect is a red, not a quiet return to UTC.
 *        Only the `date` axis is asserted here. A host-set MySQL session also
 *        moves the `datetime` arm, whose `DATETIME(3)` holds the UTC wall
 *        clock the driver wrote; that arm is outside this card's ruling, which
 *        keeps it as it is, and it is recorded on the PR instead.
 *
 * Every cell checks both doors that render the expression: `aggregate()`'s
 * GROUP BY, and `dateBucketSql()` — the text the analytics echo prints (#21441)
 * — run as SQL against the same rows.
 *
 * ## Reverse verification
 *
 * Measured with all three cells provisioned (PostgreSQL 16.14 at
 * `Asia/Shanghai`, MySQL 8.0.46 at a global `+08:00`, process
 * `TZ=America/New_York`), this file beside `sql-driver-temporal-dialect.test.ts`:
 *
 * - fix in place: 61 of 61 green;
 * - `sql-driver.ts` reverted to its pre-fix text: 16 red, 45 green. The red
 *   ones are the `date` axis at all five granularities on live postgres as
 *   provisioned, live postgres at `+08:00`, and live mysql at `+08:00` (15),
 *   plus the no-server pin in the dialect-gating file. Live mysql as
 *   provisioned stayed green, because the driver's UTC session pin hides the
 *   defect there. Every `datetime` cell and the sqlite cell stayed green.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqlDriver, type SqlDriverConfig } from '../src/index.js';
import {
  DIALECT_CELLS,
  assertThreeWayZoneSkew,
  declareDialectCell,
  readServerZone,
  type DialectCell,
  type DialectId,
} from './live-dialect-matrix.testkit.js';

const TABLE = 'os21485_bucket';

type Granularity = 'day' | 'week' | 'month' | 'quarter' | 'year';
type Axis = 'on' | 'at';

const GRANULARITIES: readonly Granularity[] = ['day', 'week', 'month', 'quarter', 'year'];

/**
 * The granularities each dialect buckets in SQL. Declared rather than read off
 * the driver, and checked against it below, so the set the tests iterate cannot
 * shrink without a red. Every dialect buckets all five: SQLite's `week` arm
 * landed with #21595.
 */
const BUCKETED_IN_SQL: Record<DialectId, readonly Granularity[]> = {
  sqlite: GRANULARITIES,
  pg: GRANULARITIES,
  mysql: GRANULARITIES,
};

type Labels = Record<Granularity, string>;
const labels = (day: string, week: string, month: string, quarter: string, year: string): Labels =>
  ({ day, week, month, quarter, year });

/**
 * Every row, and the label each value buckets under.
 *
 * `on` is a calendar day whose midnight at `+08:00` falls on the PREVIOUS UTC
 * day, at a month, a quarter, a year and an ISO-week boundary. `at` is an
 * instant whose `+08:00` wall clock is on the NEXT day, across the same
 * boundaries, so a fix that bucketed a `datetime` by its local day would be
 * one bucket off too. The last row is the empty bucket.
 */
const ROWS: ReadonlyArray<{ id: string; on: [string, Labels] | null; at: [string, Labels] | null }> = [
  {
    id: 'r1',
    on: ['2026-06-01', labels('2026-06-01', '2026-W23', '2026-06', '2026-Q2', '2026')],
    at: ['2026-05-31T20:00:00.000Z', labels('2026-05-31', '2026-W22', '2026-05', '2026-Q2', '2026')],
  },
  {
    id: 'r2',
    on: ['2026-04-01', labels('2026-04-01', '2026-W14', '2026-04', '2026-Q2', '2026')],
    at: ['2026-03-31T18:30:00.000Z', labels('2026-03-31', '2026-W14', '2026-03', '2026-Q1', '2026')],
  },
  {
    id: 'r3',
    on: ['2026-01-01', labels('2026-01-01', '2026-W01', '2026-01', '2026-Q1', '2026')],
    at: ['2025-12-31T20:00:00.000Z', labels('2025-12-31', '2026-W01', '2025-12', '2025-Q4', '2025')],
  },
  {
    id: 'r4',
    on: ['2024-12-30', labels('2024-12-30', '2025-W01', '2024-12', '2024-Q4', '2024')],
    at: ['2024-12-29T18:00:00.000Z', labels('2024-12-29', '2024-W52', '2024-12', '2024-Q4', '2024')],
  },
  { id: 'r5', on: null, at: null },
];

/** The empty bucket, keyed out of band so it cannot collide with a real label. */
const EMPTY = '(empty bucket)';
const labelOf = (v: unknown): string => (v == null ? EMPTY : String(v));

/** label -> row count: what `field` bucketed by `g` must answer. */
function expectedBuckets(axis: Axis, g: Granularity): [string, number][] {
  const counts = new Map<string, number>();
  for (const row of ROWS) {
    const key = row[axis] ? row[axis]![1][g] : EMPTY;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort();
}

function bucketsOf(rows: readonly Record<string, unknown>[], labelColumn: string): [string, number][] {
  return rows.map((r): [string, number] => [labelOf(r[labelColumn]), Number(r.n)]).sort();
}

/** Unwrap a raw result across knex's three dialect shapes. */
function rowsOf(res: any): Record<string, unknown>[] {
  if (Array.isArray(res) && Array.isArray(res[0])) return res[0]; // mysql2: [rows, fields]
  if (Array.isArray(res)) return res; // better-sqlite3
  return res?.rows ?? []; // pg
}

/** The statement that sets a session to `+08:00`, per live dialect. */
const SET_SESSION_ZONE: Partial<Record<DialectId, string>> = {
  pg: `SET TIME ZONE 'Asia/Shanghai'`,
  mysql: `SET time_zone = '+08:00'`,
};

/** The session's own zone, read back through the driver. */
const READ_SESSION_ZONE: Partial<Record<DialectId, string>> = {
  pg: `select current_setting('TimeZone') as tz`,
  mysql: `select @@session.time_zone as tz`,
};

interface SessionRun {
  label: string;
  /** Statement a host `pool.afterCreate` runs on each new connection, if any. */
  hostSessionSql?: string;
  /** The axes asserted in this run. */
  axes: readonly Axis[];
}

function sessionRuns(cell: DialectCell): SessionRun[] {
  if (!cell.live) return [{ label: 'in process', axes: ['on', 'at'] }];
  return [
    { label: 'session as provisioned', axes: ['on', 'at'] },
    { label: 'session at +08:00 (host pool.afterCreate)', hostSessionSql: SET_SESSION_ZONE[cell.id], axes: ['on'] },
  ];
}

function configFor(cell: DialectCell, run: SessionRun): SqlDriverConfig {
  const base = cell.config();
  const sql = run.hostSessionSql;
  if (!sql) return base;
  return {
    ...base,
    pool: {
      afterCreate(connection: any, done: (err?: unknown, conn?: unknown) => void) {
        connection.query(sql, (err: unknown) => done(err, connection));
      },
    },
  };
}

function measure(cell: DialectCell): void {
  for (const run of sessionRuns(cell)) {
    describe(`[#21485] date buckets on ${cell.label}, ${run.label}`, () => {
      let driver: SqlDriver;

      beforeAll(async () => {
        driver = new SqlDriver(configFor(cell, run));
        await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
        await driver.initObjects([{ name: TABLE, fields: { on: { type: 'date' }, at: { type: 'datetime' } } }]);
        for (const row of ROWS) {
          await driver.create(
            TABLE,
            { id: row.id, on: row.on ? row.on[0] : null, at: row.at ? row.at[0] : null },
            { bypassTenantAudit: true },
          );
        }
      });

      afterAll(async () => {
        await driver?.execute(`drop table if exists ${TABLE}`).catch(() => {});
        await driver?.disconnect();
      });

      if (cell.live && !run.hostSessionSql) {
        it('runs where the server, the process and UTC are three different zones', async () => {
          assertThreeWayZoneSkew(cell, await readServerZone(cell, driver));
        });
      }

      if (run.hostSessionSql) {
        it('the session really is at +08:00, so this run can see a zone leak', async () => {
          const rows = rowsOf(await driver.execute(READ_SESSION_ZONE[cell.id]!));
          expect(['Asia/Shanghai', '+08:00']).toContain(String(rows[0]?.tz));
        });
      }

      it('buckets in SQL exactly the granularities this file iterates', () => {
        const advertised = Object.entries(driver.supports.queryDateGranularity as Record<string, boolean>)
          .filter(([, on]) => on)
          .map(([g]) => g)
          .sort();
        expect(advertised).toEqual([...BUCKETED_IN_SQL[cell.id]].sort());
      });

      for (const axis of run.axes) {
        const subject = axis === 'on' ? 'a Field.date buckets as its calendar day' : 'a Field.datetime buckets as its UTC instant';
        it.each(BUCKETED_IN_SQL[cell.id])(`${subject}, by %s: aggregate() and the dateBucketSql echo`, async (g) => {
          const want = expectedBuckets(axis, g);

          const grouped = await driver.aggregate(TABLE, {
            groupBy: [{ field: axis, dateGranularity: g }],
            aggregations: [{ function: 'count', alias: 'n' }],
          });
          expect(bucketsOf(grouped as Record<string, unknown>[], axis), 'aggregate()').toEqual(want);

          const expr = driver.dateBucketSql(TABLE, axis, g);
          expect(expr, 'dateBucketSql renders an expression').toBeTypeOf('string');
          const echoed = rowsOf(
            await driver.execute(`select ${expr} as b, count(*) as n from ${TABLE} group by ${expr}`),
          );
          expect(bucketsOf(echoed, 'b'), 'the dateBucketSql echo, run').toEqual(want);
        });
      }
    });
  }
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'date-bucket calendar day', measure);
}
