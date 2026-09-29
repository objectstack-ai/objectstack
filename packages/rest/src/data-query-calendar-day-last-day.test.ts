// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20600] A bare `YYYY-MM-DD` upper bound on a `datetime` field — `$lte`, or a
 * `$between` maximum — on `9999-12-31`, the last day of the supported years
 * (0001..9999), includes that whole day, at the public door
 * `POST /api/v1/data/:object/query`, over a real `SqlDriver`.
 *
 * The widening (ADR-0053 D-D) compiles `$lte day` to `< nextUtcCalendarDay(day)`
 * midnight UTC. For the last day the helper answered `'10000-01-01'`, and the
 * driver compiled a bound in a five-digit year. On SQLite the column is ISO
 * text, where that bound sorts below `'2026-…'`, so it excluded every row;
 * PostgreSQL parsed it as an instant and answered. Every supported value is at
 * most the last millisecond of `9999-12-31`, so the helper now answers
 * `UNBOUNDED_ABOVE` for that day and the driver compiles no upper bound: `$lte`
 * keeps every row that has a value, and a `$between` keeps only its minimum.
 * Measured through this door on the base, the process in America/New_York:
 *
 * | `where opened_at` | SQLite (base) | PostgreSQL 16 (base) | the whole day |
 * |:--|:--|:--|:--|
 * | `$lte '9999-12-31'` | none | every row with a value | every row with a value |
 * | `$between ['2026-01-01', '9999-12-31']` | none | every row with a value | every row with a value |
 * | `$between ['9999-12-31', '9999-12-31']` | none | `open`, `mid`, `last` | `open`, `mid`, `last` |
 * | `$lte '9999-12-30'` (control) | `c26`, `prev` | `c26`, `prev` | the same |
 *
 * The lower-bound operators and equality do not read the widening and answer
 * the same before and after: `$gte` / `$gt` / `$lt` anchor the day to its
 * midnight, and `$eq` is that midnight instant. A row with no value stays out
 * of every bound, and a `$not` over the unbounded `$lte` answers exactly it.
 *
 * ## The dialect axis of THIS file
 *
 * The SQLite cell always runs. The PostgreSQL cell runs where
 * `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise; no CI job
 * provisions it for this package (the shared temporal conformance table in
 * `@objectstack/spec` carries the same last-day cases to the live PostgreSQL
 * and MySQL job). It owns one table, dropped before and after. An in-memory
 * cell is not here: `@objectstack/driver-memory` has no binding in this
 * package. The helper's own pins are
 * `packages/spec/src/data/calendar-day.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'rest_calendar_day_20600';
const HOST_ZONE = 'America/New_York';

const LEDGER = {
  name: OBJECT,
  label: 'Ledger 20600',
  fields: {
    memo: { name: 'memo', type: 'text' as const },
    opened_at: { name: 'opened_at', type: 'datetime' as const },
  },
};

/** id · the instant written through the door (`null`: no value). */
const ROWS: ReadonlyArray<readonly [string, string | null]> = [
  ['c26', '2026-07-15T14:00:00.000Z'], // the card's control row
  ['prev', '9999-12-30T10:00:00.000Z'], // the day before the last day
  ['open', '9999-12-31T00:00:00.000Z'], // the last day's first instant
  ['mid', '9999-12-31T10:00:00.000Z'], // the card's row
  ['last', '9999-12-31T23:59:59.999Z'], // the last supported millisecond
  ['none', null], // no value: outside every bound
];

const WITH_A_VALUE = ['c26', 'last', 'mid', 'open', 'prev'];

/** `where` · the ids it answers, sorted. */
const QUERIES: ReadonlyArray<readonly [string, Record<string, unknown>, readonly string[]]> = [
  // The widening, on the last day: no upper bound.
  ["$lte '9999-12-31'", { opened_at: { $lte: '9999-12-31' } }, WITH_A_VALUE],
  ["$between ['2026-01-01', '9999-12-31']", { opened_at: { $between: ['2026-01-01', '9999-12-31'] } }, WITH_A_VALUE],
  ["$between ['9999-12-31', '9999-12-31']", { opened_at: { $between: ['9999-12-31', '9999-12-31'] } }, ['last', 'mid', 'open']],
  ["$not $lte '9999-12-31'", { $not: { opened_at: { $lte: '9999-12-31' } } }, ['none']],
  // The day before: a bound, as on every other day (the control).
  ["$lte '9999-12-30' (control)", { opened_at: { $lte: '9999-12-30' } }, ['c26', 'prev']],
  ["$between ['2026-01-01', '9999-12-30'] (control)", { opened_at: { $between: ['2026-01-01', '9999-12-30'] } }, ['c26', 'prev']],
  // The operators that do not read the widening: that day's midnight.
  ["$gte '9999-12-31'", { opened_at: { $gte: '9999-12-31' } }, ['last', 'mid', 'open']],
  ["$gt '9999-12-31'", { opened_at: { $gt: '9999-12-31' } }, ['last', 'mid']],
  ["$lt '9999-12-31'", { opened_at: { $lt: '9999-12-31' } }, ['c26', 'prev']],
  ["$eq '9999-12-31'", { opened_at: { $eq: '9999-12-31' } }, ['open']],
];

interface Cell {
  id: 'sqlite' | 'pg';
  label: string;
  env: string | null;
  config: () => Record<string, unknown> | null;
}

const CELLS: readonly Cell[] = [
  { id: 'sqlite', label: 'sqlite', env: null, config: () => ({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) },
  {
    id: 'pg',
    label: 'live postgres',
    env: 'OS_TEST_POSTGRES_URL',
    config: () => (process.env.OS_TEST_POSTGRES_URL ? { client: 'pg', connection: process.env.OS_TEST_POSTGRES_URL } : null),
  },
];

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

const originalTz = process.env.TZ;

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#20600] a bare-day upper bound on 9999-12-31 has no upper bound, at the public door — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let engine: ObjectQL;
      let driver: any;
      let call: (method: string, path: string, params: Record<string, string>, body: unknown) => Promise<{ status: number; body: any }>;

      beforeAll(async () => {
        // A host whose zone is not UTC, so a host-zone reading of a bound would show.
        process.env.TZ = HOST_ZONE;
        expect(Intl.DateTimeFormat().resolvedOptions().timeZone, 'the host zone really changed').toBe(HOST_ZONE);

        driver = new SqlDriver(config as any);
        if (cell.id !== 'sqlite') await driver.execute(`drop table if exists ${OBJECT}`).catch(() => {});
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(LEDGER as any);
        await engine.syncSchemas();

        const protocol = new ObjectStackProtocolImplementation(engine as any);
        const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
        (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
        rest.registerRoutes();
        call = async (method, path, params, body) => {
          const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
          expect(route, `${method} ${path}`).toBeDefined();
          const res = makeRes();
          await route!.handler({ params, body, query: {}, headers: {} } as any, res);
          return { status: res._status ?? 200, body: res._json };
        };

        for (const [id, openedAt] of ROWS) {
          const record = openedAt === null ? { id, memo: 'm' } : { id, memo: 'm', opened_at: openedAt };
          const created = await call('POST', '/api/v1/data/:object', { object: OBJECT }, record);
          expect(created.status, `create ${id} ${openedAt}: ${JSON.stringify(created.body)}`).toBe(201);
        }
      });

      afterAll(async () => {
        if (cell.id !== 'sqlite') await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
        try { await engine?.destroy(); } catch { /* noop */ }
        if (originalTz === undefined) delete process.env.TZ;
        else process.env.TZ = originalTz;
      });

      const idsWhere = async (where: Record<string, unknown>) => {
        const res = await call('POST', '/api/v1/data/:object/query', { object: OBJECT }, { where });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        return (res.body.records as Array<{ id: string }>).map((r) => r.id).sort();
      };

      it('every row reads back the instant it was written — the rows the bounds are measured against', async () => {
        const res = await call('POST', '/api/v1/data/:object/query', { object: OBJECT }, { where: { memo: 'm' } });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const stored = Object.fromEntries(
          (res.body.records as Array<{ id: string; opened_at?: string | null }>).map((r) => [r.id, r.opened_at ?? null]),
        );
        expect(stored).toEqual(Object.fromEntries(ROWS));
      });

      it('$lte and the $between maximum on 9999-12-31 compile no upper bound; 9999-12-30 is a bound; the lower-bound operators do not move', async () => {
        // Every reading first, then one comparison, so a red run shows every cell.
        const got: Record<string, string[]> = {};
        for (const [name, where] of QUERIES) got[name] = await idsWhere(where);
        expect(got).toEqual(Object.fromEntries(QUERIES.map(([name, , want]) => [name, want])));
      });
    },
  );
}
