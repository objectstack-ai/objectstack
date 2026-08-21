// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3994 — `Field.time` against LIVE Postgres and MySQL servers, ideally
 * configured with a non-UTC timezone (the CI temporal-conformance job runs PG
 * at `Asia/Shanghai`, MySQL at `+08:00`, with the Node process at
 * `America/New_York`).
 *
 * What these pin, measured broken before the fix:
 *   - A full-ISO string bound to a native TIME column failed the STATEMENT on
 *     both dialects (`invalid input syntax for type time` / `Incorrect time
 *     value`) — the same payload SQLite accepted, so dev passed and prod 500ed.
 *   - A JS `Date` bound on pg was serialised in the PROCESS's local timezone
 *     (`14:30Z` became `09:30:00.500-05:00` on a New-York host), so the stored
 *     wall clock depended on the host's TZ.
 *   - MySQL's bare `TIME` is zero-precision and ROUNDS `'…00.500'` → `…01`.
 *   - A `defaultValue: 'NOW()'` time column resolved in the server's (PG) or
 *     inserting session's (MySQL) timezone — three clocks across three
 *     dialects for the same instant.
 *
 * Skipped without `OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { MYSQL_CELL, PG_CELL, type DialectCell } from './live-dialect-matrix.testkit.js';

// The cells, not `process.env.OS_TEST_*_URL`: an env var is one value for the
// whole process, so a config built from it puts this file in the same
// schema/database as every other live file. `cell.config()` derives a per-FILE
// one from vitest's own `testPath` (#9350).
const PG_URL = PG_CELL.url;
const MY_URL = MYSQL_CELL.url;
const TABLE = 'os3994_probe';

const SHAPE = {
  name: TABLE,
  fields: {
    label: { type: 'string' },
    starts_at: { type: 'time' },
    auto_at: { type: 'time', defaultValue: 'NOW()' },
  },
} as any;

/** One wall clock (14:30:00.500 UTC), every accepted input shape. */
const WRITES: Array<[string, unknown, string]> = [
  ['w_hm', '14:30', '14:30:00'],
  ['w_hms', '14:30:00', '14:30:00'],
  ['w_ms', '14:30:00.500', '14:30:00.500'],
  ['w_iso', '2026-01-15T14:30:00.500Z', '14:30:00.500'],
  ['w_naive', '2026-01-15 14:30:00', '14:30:00'],
  ['w_date', new Date(Date.UTC(2026, 0, 15, 14, 30, 0, 500)), '14:30:00.500'],
  ['w_epoch', Date.UTC(2026, 0, 15, 14, 30, 0, 500), '14:30:00.500'],
];

/**
 * Minutes-of-day distance between a presented `HH:MM:SS[.fff]` and UTC now,
 * shortest way around the clock face — so a server-zone leak (±8h here) or a
 * process-zone leak (−4/−5h) reads as hundreds of minutes, never a rounding
 * artefact.
 */
function minutesOffUtc(presented: string): number {
  const m = /^(\d{2}):(\d{2})/.exec(presented);
  if (!m) return Number.NaN;
  const now = new Date();
  const got = Number(m[1]) * 60 + Number(m[2]);
  const utc = now.getUTCHours() * 60 + now.getUTCMinutes();
  const diff = Math.abs(got - utc);
  return Math.min(diff, 1440 - diff);
}

function suite(cell: DialectCell) {
  describe.skipIf(!cell.available)(`Field.time on live ${cell.id} (#3994)`, () => {
    let driver: SqlDriver;

    beforeEach(async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.initObjects([SHAPE]);
    });

    afterEach(async () => {
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.disconnect();
    });

    it('accepts every input shape — full ISO used to fail the statement outright', async () => {
      for (const [id, v] of WRITES) {
        await driver.create(TABLE, { id, label: id, starts_at: v }, { bypassTenantAudit: true });
      }
      for (const [id, , presented] of WRITES) {
        const row: any = await driver.findOne(TABLE, { where: { id } }, { bypassTenantAudit: true });
        expect(row.starts_at, id).toBe(presented);
      }
    });

    it('a bound Date stores its UTC wall clock, independent of the process timezone', async () => {
      // On a UTC process this is trivially true; the CI job runs
      // TZ=America/New_York, where the pre-fix pg driver stored 09:30.
      await driver.create(
        TABLE,
        { id: 'd', label: 'd', starts_at: new Date(Date.UTC(2026, 0, 15, 14, 30, 0, 500)) },
        { bypassTenantAudit: true },
      );
      const row: any = await driver.findOne(TABLE, { where: { id: 'd' } }, { bypassTenantAudit: true });
      expect(row.starts_at).toBe('14:30:00.500');
    });

    it('keeps milliseconds — no zero-precision rounding to the next second', async () => {
      // MySQL's bare TIME would ROUND '14:30:00.500' up to 14:30:01.
      await driver.create(TABLE, { id: 'ms', label: 'ms', starts_at: '14:30:00.500' }, { bypassTenantAudit: true });
      const row: any = await driver.findOne(TABLE, { where: { id: 'ms' } }, { bypassTenantAudit: true });
      expect(row.starts_at).toBe('14:30:00.500');
    });

    it('the business-hours window matches every 14:30 row (the #3994 F1 repro)', async () => {
      for (const [id, v] of WRITES) {
        await driver.create(TABLE, { id, label: id, starts_at: v }, { bypassTenantAudit: true });
      }
      await driver.create(TABLE, { id: 'early', label: 'e', starts_at: '08:00:00' }, { bypassTenantAudit: true });

      const hits = await driver.find(TABLE, {
        where: { starts_at: { $gte: '09:00:00', $lte: '18:00:00' } },
        orderBy: [{ field: 'id', order: 'asc' }],
      });
      expect(hits.map((r: any) => r.id)).toEqual(WRITES.map(([id]) => id).sort());
    });

    it("a NOW()-default time column records the UTC time-of-day, not the server's or session's", async () => {
      await driver.create(TABLE, { id: 'now', label: 'n' }, { bypassTenantAudit: true });
      const row: any = await driver.findOne(TABLE, { where: { id: 'now' } }, { bypassTenantAudit: true });
      // A leak of the +08:00 server zone is ~480 minutes; of the -04:00/-05:00
      // process zone, ~240-300. Genuine clock skew is seconds.
      expect(minutesOffUtc(String(row.auto_at))).toBeLessThan(5);
    });

    it('distinct() presents exactly what find() presents', async () => {
      await driver.create(TABLE, { id: 'a', label: 'a', starts_at: '14:30' }, { bypassTenantAudit: true });
      await driver.create(TABLE, { id: 'b', label: 'b', starts_at: '14:30:00' }, { bypassTenantAudit: true });
      await driver.create(TABLE, { id: 'c', label: 'c', starts_at: '14:30:00.500' }, { bypassTenantAudit: true });
      const values = await driver.distinct(TABLE, 'starts_at');
      expect(values.sort()).toEqual(['14:30:00', '14:30:00.500']);
    });
  });
}

suite(PG_CELL);
suite(MYSQL_CELL);

describe.skipIf(!MY_URL)('MySQL TIME → TIME(3) widening (#3994)', () => {
  const LEGACY = 'os3994_legacy';
  let driver: SqlDriver;

  beforeEach(async () => {
    // Build the table the way a pre-#3994 build did: a bare TIME column.
    const legacy = new SqlDriver(MYSQL_CELL.config());
    await legacy.execute(`drop table if exists ${LEGACY}`);
    await legacy.execute(
      `create table ${LEGACY} (
         id varchar(255) not null primary key,
         label varchar(255) null,
         starts_at time null
       )`,
    );
    await legacy.execute(`insert into ${LEGACY} (id, label, starts_at) values (?, ?, ?)`, [
      'old', 'old', '14:30:00',
    ]);
    await legacy.disconnect();

    driver = new SqlDriver(MYSQL_CELL.config());
  });

  afterEach(async () => {
    await driver.execute(`drop table if exists ${LEGACY}`).catch(() => {});
    await driver.disconnect();
  });

  const LEGACY_SHAPE = { name: LEGACY, fields: { label: { type: 'string' }, starts_at: { type: 'time' } } };

  it('widens at schema sync without moving the stored wall clock, then keeps milliseconds', async () => {
    await driver.initObjects([LEGACY_SHAPE]);

    const rows: any = await driver.execute(
      `select column_type from information_schema.columns
       where table_schema = database() and table_name = ? and column_name = 'starts_at'`,
      [LEGACY],
    );
    const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
    const colType = String((list[0] as any).COLUMN_TYPE ?? (list[0] as any).column_type).toLowerCase();
    expect(colType).toBe('time(3)');

    const old: any = await driver.findOne(LEGACY, { where: { id: 'old' } }, { bypassTenantAudit: true });
    expect(old.starts_at).toBe('14:30:00'); // the wall clock must not move

    await driver.create(LEGACY, { id: 'ms', label: 'm', starts_at: '14:30:00.500' }, { bypassTenantAudit: true });
    const ms: any = await driver.findOne(LEGACY, { where: { id: 'ms' } }, { bypassTenantAudit: true });
    expect(ms.starts_at).toBe('14:30:00.500'); // pre-widen this ROUNDED to 14:30:01
  });

  it('is idempotent, and os migrate plan reports it as widen_time_columns first', async () => {
    // Plan: reported, not performed.
    driver.setDeferredDdl(true);
    await driver.initObjects([LEGACY_SHAPE]);
    const pending = await driver.previewDeferredSchemaWork();
    const widen = pending.filter((p) => p.kind === 'widen_time_columns');
    expect(widen).toHaveLength(1);
    expect(widen[0].columns).toEqual(['starts_at']);
    expect(widen[0].rows).toBe(1);

    // Apply: performed, then nothing left.
    await driver.flushDeferredSchemaDdl();
    driver.setDeferredDdl(true);
    await driver.initObjects([LEGACY_SHAPE]);
    expect((await driver.previewDeferredSchemaWork()).filter((p) => p.kind === 'widen_time_columns')).toHaveLength(0);
  });
});
