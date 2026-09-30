// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20280] A `date` field reads back the day it stores through the engine and
 * REST, a year below 100 included, over a real `SqlDriver`.
 *
 * On MySQL the driver used to take mysql2's `Date` for a `DATE`, rebuilt as
 * `new Date(Date.UTC(y, m - 1, d))`, which reads a year from 0 to 99 as
 * 1900 + year. Measured on the base, on MySQL 8.0.46 (server
 * `time_zone='+08:00'`), a record created through `POST /api/v1/data/:object`:
 *
 * | written `date` | stored | `engine.find`, `…/query`, `GET …/:id` |
 * |:--|:--|:--|
 * | `0009-03-04` | `0009-03-04` | `1909-03-04` |
 * | `0099-03-04` | `0099-03-04` | `1999-03-04` |
 * | `0999-06-15` | `0999-06-15` | `0999-06-15` |
 * | `2026-03-04` | `2026-03-04` | `2026-03-04` |
 *
 * and a `groupBy` key, `min` and `$eq` agreed with the misread: `where
 * placed_on $eq '0009-03-04'` found the row and presented `1909-03-04`. The
 * driver now reads a MySQL `DATE` as its wire text, presented through
 * `@objectstack/core`'s `temporalStorageForm`, so every door presents the
 * stored day.
 *
 * Two cells. SQLite runs on every runner and is the control: it read these
 * years right before the change. MySQL runs where `OS_TEST_MYSQL_URL` names a
 * server, and is a named skip otherwise (a failure under
 * `OS_EXPECT_LIVE_DIALECT_MATRIX=1`). ⚠️ No CI job runs this package against a
 * MySQL server today, so the MySQL cell runs only where one is provisioned; the
 * CI-run pin of the same read is driver-sql's
 * `sql-driver-20280-mysql-date-read.test.ts` under `Temporal Conformance (live
 * PG + MySQL)`, and every door here hands the driver's value through.
 *
 * `datetime` was outside that change: a MySQL `DATETIME` in years 0..99 still
 * reads a century late (ADR-0053 D-F2 keeps the client parser's `Date` for an
 * instant). Its MySQL cells are pinned as OBSERVED, so a decision that moves
 * them has to move this file — and the card's second half did: a `datetime`
 * begins at year 1000, MySQL's documented `DATETIME` floor, and both doors
 * refuse one below it. The rows' `datetime` values below 1000 are therefore
 * written straight through the driver, which no door fronts: they are what a
 * row stored before that floor holds. Such a row still presents as before, is
 * found by `$lt` on the floor's first instant (the operator's census), and
 * takes a PATCH of another field or of that field onto the range.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'rest20280_days';

const DAYS_OBJECT = {
  name: OBJECT,
  label: 'Days',
  fields: {
    placed_on: { name: 'placed_on', type: 'date' as const },
    opened_at: { name: 'opened_at', type: 'datetime' as const },
  },
};

/** id · the day and the instant written through REST create */
const ROWS = [
  { id: 'y9', placed_on: '0009-03-04', opened_at: '0009-03-04T10:00:00.000Z' },
  { id: 'y99', placed_on: '0099-03-04', opened_at: '0099-03-04T10:00:00.000Z' },
  { id: 'y999', placed_on: '0999-06-15', opened_at: '0999-06-15T10:00:00.000Z' },
  { id: 'y2026', placed_on: '2026-03-04', opened_at: '2026-03-04T10:00:00.123Z' },
] as const;
type Row = (typeof ROWS)[number];

/** What a MySQL `DATETIME` in years 0..99 still reads as. Observed, not desired. */
const MYSQL_DATETIME_FOLD: Record<string, string> = {
  y9: '2004-09-03T10:00:00.000Z',
  y99: '1999-03-04T10:00:00.000Z',
};

interface Cell {
  readonly id: 'sqlite' | 'mysql';
  readonly label: string;
  /** The environment variable that provisions this cell, or `null`. */
  readonly env: string | null;
  readonly config: () => Record<string, unknown> | null;
}

const MYSQL_URL = process.env.OS_TEST_MYSQL_URL;
const EXPECT_LIVE_DIALECTS = process.env.OS_EXPECT_LIVE_DIALECT_MATRIX === '1';

const CELLS: readonly Cell[] = [
  {
    id: 'sqlite',
    label: 'sqlite',
    env: null,
    config: () => ({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
  },
  {
    id: 'mysql',
    label: 'live mysql',
    env: 'OS_TEST_MYSQL_URL',
    // A URL string, as the driver-sql matrix spells it: the driver's own
    // connect handling keys off that shape.
    config: () => (MYSQL_URL ? { client: 'mysql2', connection: MYSQL_URL } : null),
  },
];

function presentedInstant(cell: Cell, row: Row): string {
  return cell.id === 'mysql' ? (MYSQL_DATETIME_FOLD[row.id] ?? row.opened_at) : row.opened_at;
}

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

function measure(cell: Cell, config: Record<string, unknown>): void {
  describe(`[#20280] a date reads back the day it stores, engine and REST — ${cell.label}`, { timeout: 60_000 }, () => {
    let driver: any;
    let engine: ObjectQL;
    let call: (method: string, path: string, req: Record<string, unknown>) => Promise<any>;

    beforeAll(async () => {
      driver = new SqlDriver(config as any);
      await driver.execute(`drop table if exists ${OBJECT}`).catch(() => {});
      engine = new ObjectQL();
      engine.registerDriver(driver, true);
      await engine.init();
      engine.registry.registerObject(DAYS_OBJECT as any);
      await engine.syncSchemas();

      const protocol = new ObjectStackProtocolImplementation(engine as any);
      const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
      rest.registerRoutes();
      const routes = rest.getRoutes();
      call = async (method, path, req) => {
        const route = routes.find((r: any) => r.method === method && r.path === path);
        expect(route, `${method} ${path}`).toBeDefined();
        const res = makeRes();
        // What the wire carries: JSON.
        await route!.handler(JSON.parse(JSON.stringify(req)) as any, res);
        return res;
      };

      for (const row of ROWS) {
        // [#20280] A datetime below 1000 is refused at the create door now; it
        // is written the way a row stored before the floor holds it.
        const beforeTheFloor = row.opened_at < '1000';
        const body = beforeTheFloor ? { id: row.id, placed_on: row.placed_on } : { ...row };
        const res = await call('POST', '/api/v1/data/:object', { params: { object: OBJECT }, body });
        expect(res._status, JSON.stringify(res._json)).toBe(201);
        if (beforeTheFloor) await driver.update(OBJECT, row.id, { opened_at: row.opened_at });
      }
    }, 60_000);

    afterAll(async () => {
      await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
      try { await engine?.destroy(); } catch { /* noop */ }
    });

    const byId = (rows: any[], key: 'placed_on' | 'opened_at') =>
      Object.fromEntries(rows.map((r: any) => [r.id, r[key]]));
    const expectedDays = Object.fromEntries(ROWS.map((r) => [r.id, r.placed_on]));

    it('engine.find and engine.findOne present the stored day', async () => {
      expect(byId(await engine.find(OBJECT, {}), 'placed_on')).toEqual(expectedDays);
      for (const row of ROWS) {
        expect((await engine.findOne(OBJECT, { where: { id: row.id } }))?.placed_on, row.id).toBe(row.placed_on);
      }
    });

    it('POST …/query and GET …/:id present the stored day', async () => {
      const q = await call('POST', '/api/v1/data/:object/query', { params: { object: OBJECT }, body: {} });
      expect(q._status ?? 200, JSON.stringify(q._json)).toBe(200);
      expect(byId(q._json.records, 'placed_on')).toEqual(expectedDays);
      for (const row of ROWS) {
        const g = await call('GET', '/api/v1/data/:object/:id', { params: { object: OBJECT, id: row.id }, query: {} });
        expect(g._status ?? 200, JSON.stringify(g._json)).toBe(200);
        expect((g._json.record ?? g._json).placed_on, row.id).toBe(row.placed_on);
      }
    });

    it('a groupBy key and min / max present the stored day, on the engine and over REST', async () => {
      const days = ROWS.map((r) => r.placed_on).sort();
      const grouped = { groupBy: ['placed_on'], aggregations: [{ function: 'count' as const, alias: 'n' }] };
      const range = {
        aggregations: [
          { function: 'min' as const, field: 'placed_on', alias: 'first' },
          { function: 'max' as const, field: 'placed_on', alias: 'last' },
        ],
      };
      expect((await engine.aggregate(OBJECT, grouped)).map((r: any) => r.placed_on).sort()).toEqual(days);
      const [e] = await engine.aggregate(OBJECT, range);
      expect([e.first, e.last]).toEqual(['0009-03-04', '2026-03-04']);
      const g = await call('POST', '/api/v1/data/:object/query', { params: { object: OBJECT }, body: grouped });
      expect(g._json.records.map((r: any) => r.placed_on).sort()).toEqual(days);
      const m = await call('POST', '/api/v1/data/:object/query', { params: { object: OBJECT }, body: range });
      expect([m._json.records[0].first, m._json.records[0].last]).toEqual(['0009-03-04', '2026-03-04']);
    });

    it('$eq on the stored day finds the row and presents that day; the misread day finds nothing', async () => {
      for (const row of ROWS) {
        const found = await engine.find(OBJECT, { where: { placed_on: { $eq: row.placed_on } } });
        expect(byId(found, 'placed_on'), `engine ${row.id}`).toEqual({ [row.id]: row.placed_on });
        const q = await call('POST', '/api/v1/data/:object/query', {
          params: { object: OBJECT }, body: { where: { placed_on: { $eq: row.placed_on } } },
        });
        expect(byId(q._json.records, 'placed_on'), `REST ${row.id}`).toEqual({ [row.id]: row.placed_on });
      }
      expect(await engine.count(OBJECT, { where: { placed_on: { $eq: '1909-03-04' } } })).toBe(0);
    });

    it('a datetime is presented as before: right on SQLite, a MySQL year below 100 still folded (observed)', async () => {
      const expected = Object.fromEntries(ROWS.map((r) => [r.id, presentedInstant(cell, r)]));
      expect(byId(await engine.find(OBJECT, {}), 'opened_at')).toEqual(expected);
      const q = await call('POST', '/api/v1/data/:object/query', { params: { object: OBJECT }, body: {} });
      expect(byId(q._json.records, 'opened_at')).toEqual(expected);
    });

    // [#20280] Last, because it edits two rows. The census and the remedy the
    // changeset gives an operator for a datetime stored before the floor.
    it('[#20280] a datetime below 1000 is refused at create; a row stored before the floor is found by $lt 1000 and takes a PATCH', async () => {
      const created = await call('POST', '/api/v1/data/:object', {
        params: { object: OBJECT }, body: { id: 'n1', placed_on: '2026-03-04', opened_at: '0500-01-01T00:00:00.000Z' },
      });
      expect(created._status, JSON.stringify(created._json)).toBe(400);
      expect(created._json.fields.map((f: any) => [f.field, f.code])).toEqual([['opened_at', 'invalid_date']]);
      // The census: the floor's first instant is a comparand the door admits.
      const census = await call('POST', '/api/v1/data/:object/query', {
        params: { object: OBJECT }, body: { where: { opened_at: { $lt: '1000-01-01T00:00:00.000Z' } } },
      });
      expect(census._status ?? 200, JSON.stringify(census._json)).toBe(200);
      expect(census._json.records.map((r: any) => r.id).sort()).toEqual(['y9', 'y99', 'y999']);
      // A comparand below the floor is refused, as every one is.
      const below = await call('POST', '/api/v1/data/:object/query', {
        params: { object: OBJECT }, body: { where: { opened_at: { $lt: '0500-01-01T00:00:00.000Z' } } },
      });
      expect(below._status, JSON.stringify(below._json)).toBe(400);
      expect(below._json.code).toBe('INVALID_FILTER');
      // Such a row still takes a PATCH of another field — the stored value is not re-judged —
      const other = await call('PATCH', '/api/v1/data/:object/:id', {
        params: { object: OBJECT, id: 'y999' }, body: { placed_on: '0999-06-16' },
      });
      expect(other._status ?? 200, JSON.stringify(other._json)).toBe(200);
      // — and a PATCH that moves the instant onto the range; one that keeps it below is refused.
      const kept = await call('PATCH', '/api/v1/data/:object/:id', {
        params: { object: OBJECT, id: 'y9' }, body: { opened_at: '0009-03-05T10:00:00.000Z' },
      });
      expect(kept._status, JSON.stringify(kept._json)).toBe(400);
      const moved = await call('PATCH', '/api/v1/data/:object/:id', {
        params: { object: OBJECT, id: 'y9' }, body: { opened_at: '1000-01-01T00:00:00.000Z' },
      });
      expect(moved._status ?? 200, JSON.stringify(moved._json)).toBe(200);
      expect((await engine.findOne(OBJECT, { where: { id: 'y9' } }))?.opened_at).toBe('1000-01-01T00:00:00.000Z');
    });
  });
}

for (const cell of CELLS) {
  const config = cell.config();
  if (config) {
    measure(cell, config);
    continue;
  }
  // Declared either way: a cell that emitted nothing would read as coverage.
  describe(`[#20280] a date reads back the day it stores, engine and REST — ${cell.label}`, () => {
    it.skipIf(!EXPECT_LIVE_DIALECTS)(`is provisioned — set ${cell.env} to run this cell`, () => {
      expect.fail(
        `${cell.env} is unset while OS_EXPECT_LIVE_DIALECT_MATRIX=1: this runner declared it ` +
          `provisions a live server, so the ${cell.label} cell must not be skipped.`,
      );
    });
  });
}
