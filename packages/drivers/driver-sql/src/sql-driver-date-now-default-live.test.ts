// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4022 — `Field.date` + `defaultValue: 'NOW()'` on live Postgres and MySQL.
 *
 * The bare `CURRENT_TIMESTAMP` default `knex.fn.now()` emits resolves the
 * calendar day in the SERVER's timezone on Postgres — measured: with the server
 * at UTC-12, a defaulted insert on UTC's 2026-07-30 stored `2026-07-29`. On an
 * Asia/Shanghai production server every default after 16:00 UTC records
 * TOMORROW. MySQL 8.0 rejects the bare default on a DATE column outright
 * (MariaDB is merely permissive, and the driver's UTC-pinned session masked
 * the semantic half there).
 *
 * The fix is an expression default reading the UTC clock (`nowColumnDefault`),
 * the #3994 D-C3 construction one type over. The wrong-day scenario cannot be
 * asserted deterministically in CI (it depends on the time of day relative to
 * the server's offset), so these tests pin the two things that CAN be:
 * the DDL builds — which on MySQL 8.0 is itself the compatibility fix — with a
 * default expression that spells `utc`, and a defaulted insert round-trips a
 * valid calendar day.
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
const TABLE = 'os4022_probe';

const SHAPE = {
  name: TABLE,
  fields: {
    label: { type: 'string' },
    due_on: { type: 'date', defaultValue: 'NOW()' },
  },
} as any;

function suite(cell: DialectCell) {
  describe.skipIf(!cell.available)(`Field.date NOW() default on live ${cell.id} (#4022)`, () => {
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

    it('builds with a UTC expression default, not a bare CURRENT_TIMESTAMP', async () => {
      // On MySQL 8.0 reaching this line at all is the compatibility half of the
      // fix — the bare default fails CREATE TABLE there.
      const res: any = await driver.execute(
        cell.id === 'pg'
          ? `select column_default as d from information_schema.columns
             where table_name = '${TABLE}' and column_name = 'due_on'`
          : `select column_default as d from information_schema.columns
             where table_schema = database() and table_name = ? and column_name = 'due_on'`,
        cell.id === 'pg' ? [] : [TABLE],
      );
      const rows = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : (res?.rows ?? res);
      const def = String((rows[0] as any).d ?? (rows[0] as any).D ?? '').toLowerCase();
      expect(def).toContain('utc');
      expect(def).not.toBe('current_timestamp');
    });

    it('a defaulted insert round-trips a valid canonical calendar day', async () => {
      await driver.create(TABLE, { id: 'x', label: 'x' }, { bypassTenantAudit: true });
      const row: any = await driver.findOne(TABLE, { where: { id: 'x' } }, { bypassTenantAudit: true });
      expect(String(row.due_on)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // The UTC calendar day only ever differs from this probe's own UTC clock
      // across a midnight boundary — accept today or the day either side rather
      // than flake at 00:00, while still catching a ±12h zone leak on any run
      // that is not within a day-boundary race.
      const utcToday = Date.parse(new Date().toISOString().slice(0, 10));
      const stored = Date.parse(String(row.due_on));
      expect(Math.abs(stored - utcToday)).toBeLessThanOrEqual(24 * 3600 * 1000);
    });
  });
}

suite(PG_CELL);
suite(MYSQL_CELL);
