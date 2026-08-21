// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3942 — `Field.datetime` on MySQL.
 *
 * MySQL was the dialect the #3912 canonical-storage work did not reach, and it
 * was the worst off of the three. Measured on MariaDB 10.11 before this change:
 *
 *   - An ISO-8601 comparand or write value FAILED the statement outright —
 *     MySQL accepts neither the `T` separator nor the `Z` suffix in a datetime
 *     literal, so every REST/JSON write of a datetime errored with *Incorrect
 *     datetime value*, and canonicalising the write path in #3912 extended that
 *     to `Date` writes too.
 *   - A `Date` that did land was truncated to whole seconds: `table.timestamp`
 *     emits MySQL `TIMESTAMP`, which carries no fractional digits by default.
 *   - A zone-naive string landed at the wrong instant — 4 hours off with the
 *     process on `America/New_York` — because mysql2 renders and parses in the
 *     HOST's zone unless told otherwise.
 *   - Nothing outside 1970..2038 could be stored at all: `TIMESTAMP` is a 32-bit
 *     epoch. A contract end date in 2040 was simply rejected.
 *
 * The fix is three coordinated pieces, all asserted below: `DATETIME(3)` instead
 * of `TIMESTAMP`, a connection pinned to UTC on both the mysql2 and the server
 * layer, and a MySQL-spelled bind carrying the same UTC wall clock.
 *
 * Opt-in — needs a real server, which CI does not provision:
 *
 *   OS_TEST_MYSQL_URL=mysql://root@127.0.0.1:3306/test pnpm --filter @objectstack/driver-sql test
 *
 * Point it at a server whose `time_zone` is NOT UTC (e.g. `default_time_zone =
 * '+08:00'`) and run with a non-UTC `TZ`; the suite asserts the server side and
 * tells you if it cannot prove anything.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { MYSQL_CELL } from './live-dialect-matrix.testkit.js';

// The cell, not `process.env.OS_TEST_MYSQL_URL`: the env var is one value for
// the whole process, so a config built from it puts this file in the same
// database as every other live file. `MYSQL_CELL.config()` derives a per-FILE
// database from vitest's own `testPath` (#9350).
const URL = MYSQL_CELL.url;
const TABLE = 'os3942_probe';

const MIDDAY = '2026-03-20T12:34:56.789Z';
/** 20:00Z is 04:00 the NEXT day at +08:00 — so a day window discriminates. */
const BOUNDARY = '2026-03-20T20:00:00.000Z';

/** A driver whose connection this suite does NOT pin, to read raw server state. */
const rawDriver = () => new SqlDriver(MYSQL_CELL.config());

describe.skipIf(!URL)('Field.datetime on MySQL (#3942)', () => {
  let driver: SqlDriver;
  let serverTimeZone = '';

  beforeAll(async () => {
    const probe = rawDriver();
    const rows = await rowsOf(probe, `select @@global.time_zone as tz`);
    serverTimeZone = String((rows[0] as any).tz);
    await probe.disconnect();
  });

  beforeEach(async () => {
    driver = new SqlDriver(MYSQL_CELL.config());
    await driver.execute(`drop table if exists ${TABLE}`);
    await driver.initObjects([
      { name: TABLE, fields: { label: { type: 'string' }, at: { type: 'datetime' } } },
    ]);
  });

  afterEach(async () => {
    await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
    await driver.disconnect();
  });

  it('is pointed at a non-UTC server (otherwise this suite proves less)', () => {
    expect(
      serverTimeZone,
      "set default_time_zone='+08:00' — on a UTC server the timezone bugs are invisible",
    ).not.toMatch(/^(UTC|\+00:00|SYSTEM)$/i);
  });

  it('creates DATETIME(3), not TIMESTAMP — no 2038 ceiling, milliseconds kept', async () => {
    const cols = await columnTypes(driver, TABLE);
    expect(cols.at).toBe('datetime(3)');
    // The audit columns are declared `Field.datetime` by the objectql registry
    // and are what most list views sort by, so they take the same type.
    expect(cols.created_at).toBe('datetime(3)');
    expect(cols.updated_at).toBe('datetime(3)');
  });

  it('pins the session to UTC, so the server timezone stops participating', async () => {
    const rows = await rowsOf(driver, `select @@session.time_zone as tz`);
    expect(String((rows[0] as any).tz)).toBe('+00:00');
  });

  it('accepts an ISO write at all — it used to fail the statement', async () => {
    // The headline regression: a REST/JSON payload carries an ISO string, and
    // MySQL rejects it verbatim. This asserts the write completes; the next test
    // asserts it landed on the right instant.
    await expect(
      driver.create(TABLE, { id: 'iso', label: 'iso', at: MIDDAY }, { bypassTenantAudit: true }),
    ).resolves.toBeDefined();
  });

  it('records the same instant for a Date, an ISO-Z string and a NAIVE string', async () => {
    await driver.create(TABLE, { id: 'date-obj', label: 'a', at: new Date(MIDDAY) }, { bypassTenantAudit: true });
    await driver.create(TABLE, { id: 'iso-z', label: 'b', at: MIDDAY }, { bypassTenantAudit: true });
    await driver.create(TABLE, { id: 'naive', label: 'c', at: '2026-03-20 12:34:56.789' }, { bypassTenantAudit: true });
    await driver.create(TABLE, { id: 'offset', label: 'd', at: '2026-03-20T20:34:56.789+08:00' }, { bypassTenantAudit: true });

    const expected = Date.parse(MIDDAY);
    for (const id of ['date-obj', 'iso-z', 'naive', 'offset']) {
      expect(await storedEpochMs(driver, id), `${id} stored instant`).toBe(expected);
    }
  });

  it('keeps milliseconds — TIMESTAMP silently truncated them to whole seconds', async () => {
    await driver.create(TABLE, { id: 'ms', label: 'ms', at: MIDDAY }, { bypassTenantAudit: true });
    expect(await storedEpochMs(driver, 'ms')).toBe(Date.parse(MIDDAY));
    expect(Date.parse(MIDDAY) % 1000).toBe(789); // the fixture would be vacuous otherwise
  });

  it('stores instants outside the 1970..2038 TIMESTAMP range', async () => {
    // Asserted through the driver's own read rather than `unix_timestamp()`,
    // which is itself a 32-bit epoch function and returns 0 for exactly the
    // instants this test is about.
    for (const [id, iso] of [['future', '2040-06-01T00:00:00.000Z'], ['past', '1960-06-01T00:00:00.000Z']] as const) {
      await driver.create(TABLE, { id, label: id, at: iso }, { bypassTenantAudit: true });
      expect(await readInstant(driver, id), id).toBe(iso);
    }
  });

  it('anchors a bare calendar-day comparand to UTC midnight, like the other dialects', async () => {
    await driver.create(TABLE, { id: 'b1', label: 'x', at: BOUNDARY }, { bypassTenantAudit: true });
    const day = async (from: string, to: string) =>
      (await driver.find(TABLE, { where: { at: { $gte: from, $lt: to } } })).map((r: any) => r.id);

    // 20:00Z belongs to 2026-03-20 in UTC; on a `+08:00` server read as local
    // midnight it would fall on the 21st — the divergence #3912 measured on PG.
    expect(await day('2026-03-20', '2026-03-21')).toEqual(['b1']);
    expect(await day('2026-03-21', '2026-03-22')).toEqual([]);
  });

  it('round-trips the instant through a read', async () => {
    await driver.create(TABLE, { id: 'r', label: 'r', at: MIDDAY }, { bypassTenantAudit: true });
    const row: any = await driver.findOne(TABLE, { where: { id: 'r' } }, { bypassTenantAudit: true });
    expect(new Date(row.at).toISOString()).toBe(MIDDAY);
  });
});

describe.skipIf(!URL)('MySQL TIMESTAMP → DATETIME(3) migration (#3942)', () => {
  const LEGACY = 'os3942_legacy';
  const GOOD = '2026-03-20T12:34:56.000Z';
  let driver: SqlDriver;

  beforeEach(async () => {
    // Build the table the way a pre-#3942 build did: TIMESTAMP columns, rows in
    // it. The legacy connection is pinned to UTC so the fixture's instants are
    // the ones we intend — the migration's job is to preserve them, not to
    // second-guess what an older, timezone-ambiguous writer recorded.
    const legacy = rawDriver();
    await legacy.execute(`drop table if exists ${LEGACY}`);
    await legacy.execute(
      `create table ${LEGACY} (
         id varchar(255) not null primary key,
         created_at timestamp null default current_timestamp,
         updated_at timestamp null default current_timestamp,
         label varchar(255) null,
         at timestamp null
       )`,
    );
    await legacy.execute(`set time_zone = '+00:00'`);
    await legacy.execute(`insert into ${LEGACY} (id, label, at) values (?, ?, ?)`, [
      'old', 'old', '2026-03-20 12:34:56',
    ]);
    await legacy.disconnect();

    driver = new SqlDriver(MYSQL_CELL.config());
  });

  afterEach(async () => {
    await driver.execute(`drop table if exists ${LEGACY}`).catch(() => {});
    await driver.disconnect();
  });

  it('widens the columns at schema sync without moving any instant', async () => {
    const before = await storedEpochMs(driver, 'old', LEGACY);
    expect((await columnTypes(driver, LEGACY)).at).toBe('timestamp');

    await driver.initObjects([
      { name: LEGACY, fields: { label: { type: 'string' }, at: { type: 'datetime' } } },
    ]);

    const cols = await columnTypes(driver, LEGACY);
    expect(cols.at).toBe('datetime(3)');
    expect(cols.created_at).toBe('datetime(3)');
    expect(cols.updated_at).toBe('datetime(3)');
    // The instant is what must not move. A migration that silently reinterprets
    // stored data is worse than one that never runs.
    expect(await storedEpochMs(driver, 'old', LEGACY)).toBe(before);
    expect(before).toBe(Date.parse(GOOD));
  });

  it('lets the migrated column hold what TIMESTAMP could not', async () => {
    await driver.initObjects([
      { name: LEGACY, fields: { label: { type: 'string' }, at: { type: 'datetime' } } },
    ]);
    await driver.create(LEGACY, { id: 'future', label: 'f', at: '2040-06-01T00:00:00.000Z' }, { bypassTenantAudit: true });
    expect(await readInstant(driver, 'future', LEGACY)).toBe('2040-06-01T00:00:00.000Z');
  });

  it('is idempotent — a second sync leaves the schema alone', async () => {
    const shape = { name: LEGACY, fields: { label: { type: 'string' }, at: { type: 'datetime' } } };
    await driver.initObjects([shape]);
    const first = await columnTypes(driver, LEGACY);
    await driver.initObjects([shape]);
    expect(await columnTypes(driver, LEGACY)).toEqual(first);
  });

  it('keeps the audit default, so inserts do not start writing NULL', async () => {
    await driver.initObjects([
      { name: LEGACY, fields: { label: { type: 'string' }, at: { type: 'datetime' } } },
    ]);
    await driver.create(LEGACY, { id: 'fresh', label: 'f' }, { bypassTenantAudit: true });
    const row: any = await driver.findOne(LEGACY, { where: { id: 'fresh' } }, { bypassTenantAudit: true });
    expect(row.created_at ?? null, 'created_at must still default').not.toBeNull();
  });
});

describe.skipIf(!URL)('os migrate plan lists the MySQL widening (#3954)', () => {
  const LEGACY = 'os3954_legacy';
  const SHAPE = { name: LEGACY, fields: { label: { type: 'string' }, at: { type: 'datetime' } } };
  let driver: SqlDriver;

  beforeEach(async () => {
    const legacy = rawDriver();
    await legacy.execute(`drop table if exists ${LEGACY}`);
    await legacy.execute(
      `create table ${LEGACY} (
         id varchar(255) not null primary key,
         created_at timestamp null default current_timestamp,
         updated_at timestamp null default current_timestamp,
         label varchar(255) null,
         at timestamp null
       )`,
    );
    await legacy.execute(`set time_zone = '+00:00'`);
    for (let i = 0; i < 5; i++) {
      await legacy.execute(`insert into ${LEGACY} (id, label, at) values (?, ?, ?)`, [
        `e${i}`, `e${i}`, '2026-03-20 12:00:00',
      ]);
    }
    await legacy.disconnect();
    driver = new SqlDriver(MYSQL_CELL.config());
  });

  afterEach(async () => {
    await driver.execute(`drop table if exists ${LEGACY}`).catch(() => {});
    await driver.disconnect();
  });

  it('reports the widening, its columns and the table size — without performing it', async () => {
    driver.setDeferredDdl(true);
    await driver.initObjects([SHAPE]);

    const pending = await driver.previewDeferredSchemaWork();
    const widen = pending.filter((p) => p.kind === 'widen_datetime_columns');
    expect(widen).toHaveLength(1);
    expect(widen[0].table).toBe(LEGACY);
    // The audit columns are declared datetime too, so all three are rebuilt.
    expect([...widen[0].columns].sort()).toEqual(['at', 'created_at', 'updated_at']);
    // `ALTER … MODIFY` is a full rebuild holding a metadata lock, so the table's
    // size is the number that decides "now" versus "in a maintenance window".
    expect(widen[0].rows).toBe(5);

    // Planning must not have touched the schema.
    expect((await columnTypes(driver, LEGACY)).at).toBe('timestamp');
  });

  it('applies exactly what it planned, and then finds nothing left', async () => {
    driver.setDeferredDdl(true);
    await driver.initObjects([SHAPE]);
    const planned = await driver.previewDeferredSchemaWork();
    expect(planned.some((p) => p.kind === 'widen_datetime_columns')).toBe(true);

    await driver.flushDeferredSchemaDdl();
    expect((await columnTypes(driver, LEGACY)).at).toBe('datetime(3)');

    driver.setDeferredDdl(true);
    await driver.initObjects([SHAPE]);
    expect(await driver.previewDeferredSchemaWork()).toEqual([]);
  });
});

// ── helpers ─────────────────────────────────────────────────────────────────

/** mysql2 hands back `[rows, fields]`; normalise to just the rows. */
async function rowsOf(driver: SqlDriver, sql: string, bindings: unknown[] = []): Promise<unknown[]> {
  const res: any = await driver.execute(sql, bindings as any);
  if (Array.isArray(res) && Array.isArray(res[0])) return res[0];
  return Array.isArray(res) ? res : (res?.rows ?? []);
}

/** column → its full MySQL type, lower-cased and case-insensitive on the key. */
async function columnTypes(driver: SqlDriver, table: string): Promise<Record<string, string>> {
  const rows = await rowsOf(
    driver,
    `select column_name, column_type from information_schema.columns
     where table_schema = database() and table_name = ?`,
    [table],
  );
  const out: Record<string, string> = {};
  for (const r of rows as any[]) {
    out[String(r.COLUMN_NAME ?? r.column_name)] = String(r.COLUMN_TYPE ?? r.column_type).toLowerCase();
  }
  return out;
}

/**
 * The instant the driver presents for a row, as canonical ISO. The user-facing
 * contract, and the only check that works outside 1970..2038 — `unix_timestamp()`
 * is itself a 32-bit epoch function and returns 0 there.
 */
async function readInstant(driver: SqlDriver, id: string, table = TABLE): Promise<string> {
  const row: any = await driver.findOne(table, { where: { id } }, { bypassTenantAudit: true });
  return new Date(row.at).toISOString();
}

/**
 * The stored instant as epoch ms, read under an explicitly-UTC session so the
 * assertion cannot be satisfied by a compensating session-timezone error.
 */
async function storedEpochMs(driver: SqlDriver, id: string, table = TABLE): Promise<number> {
  await driver.execute(`set time_zone = '+00:00'`);
  const rows = await rowsOf(
    driver,
    `select cast(unix_timestamp(at) * 1000 as signed) as ms from ${table} where id = ?`,
    [id],
  );
  return Number((rows[0] as any).ms);
}
