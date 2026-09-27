// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20280] A MySQL `DATE` reads back the day it stores, in every year a
 * `YYYY-MM-DD` day spells.
 *
 * mysql2 rebuilt a `DATE` from its three numbers, `new Date(Date.UTC(y, m - 1,
 * d))` under the driver's `timezone: 'Z'`, and `Date.UTC` reads a year from 0
 * to 99 as 1900 + year. The write was right and the read was wrong. Measured on
 * MySQL 8.0.46 (server `time_zone='+08:00'`), through the driver, the engine and
 * `POST /api/v1/data/:object/query`, which present the same value:
 *
 * | stored `date` | presented before | presented now |
 * |:--|:--|:--|
 * | `0009-03-04` | `1909-03-04` | `0009-03-04` |
 * | `0099-03-04` | `1999-03-04` | `0099-03-04` |
 * | `0999-06-15` | `0999-06-15` | `0999-06-15` |
 * | `2026-03-04` | `2026-03-04` | `2026-03-04` |
 *
 * The connection now asks mysql2 for the `DATE`'s wire text (`dateStrings:
 * ['DATE']`, `withMysqlCalendarDayAsText`), and the read doors present it
 * through `toDateOnly`, which is `@objectstack/core`'s `temporalStorageForm`.
 * That is how PostgreSQL already reads a day. SQLite and PostgreSQL read these
 * years right before and after, so their cells are the control.
 *
 * `datetime` is outside this change. A MySQL `DATETIME` in years 0..99 still
 * reads a century late (`0009-03-04T10:00Z` as `2004-09-03T10:00Z`): mysql2's
 * `parseDateTime` hands the wire text to V8's non-ISO `Date` parser. Fixing
 * that means text (or a new parse) at the client parser, which ADR-0053 D-F2
 * declines for an instant, so it waits on a decision. The MySQL `datetime`
 * cells below pin it as OBSERVED, beside the raw `Date` that D-F2 keeps, so a
 * decision that moves it has to move this file too.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'os20280_days';
const NO_AUDIT = { bypassTenantAudit: true };

/** id · the stored day · the stored instant */
const ROWS = [
  { id: 'y9', placed_on: '0009-03-04', opened_at: '0009-03-04T10:00:00.000Z' },
  { id: 'y99', placed_on: '0099-03-04', opened_at: '0099-03-04T10:00:00.000Z' },
  { id: 'y999', placed_on: '0999-06-15', opened_at: '0999-06-15T10:00:00.000Z' },
  { id: 'y2026', placed_on: '2026-03-04', opened_at: '2026-03-04T10:00:00.123Z' },
] as const;
const DAYS = ROWS.map((r) => r.placed_on);

/**
 * What a MySQL `DATETIME` in years 0..99 still reads as — the half this card
 * does not decide (see the header). Observed, not desired.
 */
const MYSQL_DATETIME_FOLD: Record<string, string> = {
  y9: '2004-09-03T10:00:00.000Z',
  y99: '1999-03-04T10:00:00.000Z',
};

/** The instant each row presents on this cell. */
function presentedInstant(cell: DialectCell, row: (typeof ROWS)[number]): string {
  return cell.id === 'mysql' ? (MYSQL_DATETIME_FOLD[row.id] ?? row.opened_at) : row.opened_at;
}

/** knex's raw result shape differs per client; this is the only place that knows. */
function rowsOf(cell: DialectCell, res: any): any[] {
  if (cell.id === 'pg') return res?.rows ?? [];
  if (cell.id === 'mysql') return Array.isArray(res) ? (res[0] ?? []) : [];
  return Array.isArray(res) ? res : (res?.rows ?? []);
}

describe('[#20280] a MySQL connection asks mysql2 for a DATE as its wire text', () => {
  const drivers: SqlDriver[] = [];
  const make = (config: any): SqlDriver => {
    // knex builds its client eagerly and opens a pool connection only on the
    // first query, so nothing here connects.
    const d = new SqlDriver(config);
    drivers.push(d);
    return d;
  };
  const connectionOf = (d: SqlDriver): any => (d as any).knex.client.config.connection;
  afterAll(async () => {
    for (const d of drivers) await d.disconnect().catch(() => {});
  });

  it('a URL and an object connection both carry `dateStrings: [DATE]` beside the UTC pin', () => {
    // `mysql2` only: knex loads the `mysql` package when it builds that client,
    // and this workspace does not install it.
    for (const connection of ['mysql://u:p@127.0.0.1:1/d', { host: '127.0.0.1', port: 1, database: 'd' }]) {
      const conn = connectionOf(make({ client: 'mysql2', connection }));
      expect(conn.dateStrings, typeof connection).toEqual(['DATE']);
      expect(conn.timezone, typeof connection).toBe('Z');
    }
  });

  it('only `DATE`: an instant keeps the client parser, ADR-0053 D-F2', () => {
    const conn = connectionOf(make({ client: 'mysql2', connection: 'mysql://u:p@127.0.0.1:1/d' }));
    expect(conn.dateStrings).not.toContain('DATETIME');
    expect(conn.dateStrings).not.toContain('TIMESTAMP');
  });

  it("leaves a host's own `dateStrings` alone, as `withUtcSession` leaves its `timezone`", () => {
    for (const own of [true, false, ['DATE', 'DATETIME']]) {
      const conn = connectionOf(make({ client: 'mysql2', connection: { host: '127.0.0.1', database: 'd', dateStrings: own } }));
      expect(conn.dateStrings).toEqual(own);
    }
  });

  it('touches no other dialect', () => {
    for (const config of [
      { client: 'pg', connection: 'postgres://u:p@127.0.0.1:1/d' },
      { client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true },
    ]) {
      expect(connectionOf(make(config)).dateStrings, config.client).toBeUndefined();
    }
  });
});

function measure(cell: DialectCell): void {
  describe(`[#20280] a date reads back the day it stores — ${cell.label}`, () => {
    let driver: SqlDriver;
    const ids = async (where: Record<string, unknown>) =>
      (await driver.find(TABLE, { where } as any, NO_AUDIT)).map((r: any) => r.id).sort();

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.initObjects([
        { name: TABLE, fields: { placed_on: { type: 'date' }, opened_at: { type: 'datetime' } } },
      ] as any);
      for (const row of ROWS) await driver.create(TABLE, { ...row }, NO_AUDIT);
    });

    afterAll(async () => {
      await driver?.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver?.disconnect();
    });

    it('the server stores each day as written — a raw cast, past every read path', async () => {
      const sql =
        cell.id === 'pg'
          ? `select "id", "placed_on"::text as t from "${TABLE}"`
          : cell.id === 'mysql'
            ? `select \`id\`, cast(\`placed_on\` as char) as t from \`${TABLE}\``
            : `select "id", cast("placed_on" as text) as t from "${TABLE}"`;
      const stored = Object.fromEntries(rowsOf(cell, await driver.execute(sql)).map((r) => [r.id, r.t]));
      expect(stored).toEqual(Object.fromEntries(ROWS.map((r) => [r.id, r.placed_on])));
    });

    it('find() and findOne() present the stored day', async () => {
      const rows = await driver.find(TABLE, {} as any, NO_AUDIT);
      expect(Object.fromEntries(rows.map((r: any) => [r.id, r.placed_on])))
        .toEqual(Object.fromEntries(ROWS.map((r) => [r.id, r.placed_on])));
      for (const row of ROWS) {
        const one: any = await driver.findOne(TABLE, { where: { id: row.id } } as any, NO_AUDIT);
        expect(one?.placed_on, row.id).toBe(row.placed_on);
      }
    });

    it('a groupBy key, distinct() and min / max present the stored day', async () => {
      const grouped = await driver.aggregate(TABLE, {
        groupBy: ['placed_on'],
        aggregations: [{ function: 'count', alias: 'n' }],
      } as any);
      expect(grouped.map((r: any) => r.placed_on).sort()).toEqual([...DAYS].sort());
      expect((await driver.distinct(TABLE, 'placed_on', undefined, NO_AUDIT)).sort()).toEqual([...DAYS].sort());
      const [range]: any[] = await driver.aggregate(TABLE, {
        aggregations: [
          { function: 'min', field: 'placed_on', alias: 'first' },
          { function: 'max', field: 'placed_on', alias: 'last' },
        ],
      } as any);
      expect(range.first).toBe('0009-03-04');
      expect(range.last).toBe('2026-03-04');
    });

    it('$eq finds each stored day, $gt orders by it, and the misread day finds nothing', async () => {
      for (const row of ROWS) expect(await ids({ placed_on: { $eq: row.placed_on } }), row.id).toEqual([row.id]);
      expect(await ids({ placed_on: { $gt: '0099-03-04' } })).toEqual(['y2026', 'y999']);
      expect(await ids({ placed_on: { $eq: '1909-03-04' } })).toEqual([]);
    });

    it('a datetime is presented as before: right on SQLite and PostgreSQL, a MySQL year below 100 still folded (observed)', async () => {
      const rows = await driver.find(TABLE, {} as any, NO_AUDIT);
      expect(Object.fromEntries(rows.map((r: any) => [r.id, r.opened_at])))
        .toEqual(Object.fromEntries(ROWS.map((r) => [r.id, presentedInstant(cell, r)])));
    });

    it('the raw wire: a date is text on every dialect, and a datetime stays the client\'s Date on a live one (ADR-0053 D-F2)', async () => {
      const sql =
        cell.id === 'mysql'
          ? `select \`placed_on\`, \`opened_at\` from \`${TABLE}\` where \`id\` = 'y9'`
          : `select "placed_on", "opened_at" from "${TABLE}" where "id" = 'y9'`;
      const [raw] = rowsOf(cell, await driver.execute(sql));
      expect(raw.placed_on).toBe('0009-03-04');
      if (cell.live) {
        expect(raw.opened_at instanceof Date, `${cell.label} raw datetime is ${typeof raw.opened_at}`).toBe(true);
        expect((raw.opened_at as Date).toISOString()).toBe(presentedInstant(cell, ROWS[0]));
      } else {
        expect(typeof raw.opened_at).toBe('string');
      }
    });

    it('a write then a read round-trips a year below 100 — create, update, findOne', async () => {
      await driver.create(TABLE, { id: 'rt', placed_on: '0042-01-31' }, NO_AUDIT);
      expect((await driver.findOne(TABLE, { where: { id: 'rt' } } as any, NO_AUDIT) as any)?.placed_on).toBe('0042-01-31');
      await driver.update(TABLE, 'rt', { placed_on: '0001-12-31' }, NO_AUDIT);
      expect((await driver.findOne(TABLE, { where: { id: 'rt' } } as any, NO_AUDIT) as any)?.placed_on).toBe('0001-12-31');
    });
  });
}

for (const cell of DIALECT_CELLS) declareDialectCell(cell, 'mysql date read (#20280)', measure);
