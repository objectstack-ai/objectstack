// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20550] A bare `YYYY-MM-DD` upper bound on a `datetime` field — `$lte`, or
 * a `$between` maximum — includes the whole of that day in the years
 * 0001..0099 exactly as it does in 2026, at the public door
 * `POST /api/v1/data/:object/query`, over a real `SqlDriver`.
 *
 * The widening (ADR-0053 D-D) compiles `$lte day` to `< nextUtcCalendarDay(day)`
 * midnight UTC, and falls back to `<= day` midnight when the helper answers
 * `null`. `@objectstack/spec`'s `nextUtcCalendarDay` built the date through
 * `Date.UTC`, which reads a year from 0 to 99 as 1900 + year, so the round trip
 * that proves a day real failed for every day of those years and the bound
 * stopped at the day's first instant. Measured through this door on the base,
 * the process in America/New_York, on the six rows below:
 *
 * | `where opened_at` | SQLite | PostgreSQL 16 | the whole day |
 * |:--|:--|:--|:--|
 * | `$lte '0050-01-01'` | `y49` | `y49` | `y49`, `y50`, `y50_last` |
 * | `$between ['0050-01-01', '0050-01-01']` | none | none | `y50`, `y50_last` |
 * | `$lte '2026-07-15'` (control) | the whole day | the whole day | `y49` … `y50_next`, `c26` |
 * | `$between ['2026-07-15', '2026-07-15']` (control) | `c26` | `c26` | `c26` |
 *
 * The next day's midnight (`y50_next`, `c26_next`) stays out in every cell: the
 * bound is half-open, never an inclusive `23:59:59.999`.
 *
 * ## The dialect axis of THIS file
 *
 * The SQLite cell always runs. The PostgreSQL cell runs where
 * `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise; no CI job
 * provisions it for this package. It owns one table, dropped before and after.
 * An in-memory cell is not here, for the reason
 * `data-temporal-write-real-day-iso.test.ts` gives: `@objectstack/driver-memory`
 * has no binding in this package. The helper's own pins, every year edge and
 * the impossible days included, are `packages/spec/src/data/calendar-day.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'rest_calendar_day_20550';
const HOST_ZONE = 'America/New_York';

const LEDGER = {
  name: OBJECT,
  label: 'Ledger 20550',
  fields: {
    memo: { name: 'memo', type: 'text' as const },
    opened_at: { name: 'opened_at', type: 'datetime' as const },
  },
};

/** id · the instant written through the door. */
const ROWS: ReadonlyArray<readonly [string, string]> = [
  ['y49', '0049-12-31T10:00:00.000Z'],
  ['y50', '0050-01-01T10:00:00.000Z'], // the card's row
  ['y50_last', '0050-01-01T23:59:59.999Z'], // the day's last millisecond
  ['y50_next', '0050-01-02T00:00:00.000Z'], // the next day's first instant: out
  ['c26', '2026-07-15T14:00:00.000Z'], // the card's control row
  ['c26_next', '2026-07-16T00:00:00.000Z'],
];

/** `where` on `opened_at` · the ids it answers, sorted. */
const QUERIES: ReadonlyArray<readonly [string, Record<string, unknown>, readonly string[]]> = [
  ["$lte '0050-01-01'", { $lte: '0050-01-01' }, ['y49', 'y50', 'y50_last']],
  ["$between max '0050-01-01'", { $between: ['0050-01-01', '0050-01-01'] }, ['y50', 'y50_last']],
  ["$lte '2026-07-15' (control)", { $lte: '2026-07-15' }, ['c26', 'y49', 'y50', 'y50_last', 'y50_next']],
  ["$between max '2026-07-15' (control)", { $between: ['2026-07-15', '2026-07-15'] }, ['c26']],
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
    `[#20550] a bare-day upper bound on a datetime includes the whole day in years 0001..0099, at the public door — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
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
          const created = await call('POST', '/api/v1/data/:object', { object: OBJECT }, { id, memo: 'm', opened_at: openedAt });
          expect(created.status, `create ${id} ${openedAt}: ${JSON.stringify(created.body)}`).toBe(201);
        }
      });

      afterAll(async () => {
        if (cell.id !== 'sqlite') await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
        try { await engine?.destroy(); } catch { /* noop */ }
        if (originalTz === undefined) delete process.env.TZ;
        else process.env.TZ = originalTz;
      });

      const idsWhere = async (opened_at: Record<string, unknown>) => {
        const res = await call('POST', '/api/v1/data/:object/query', { object: OBJECT }, { where: { opened_at } });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        return (res.body.records as Array<{ id: string }>).map((r) => r.id).sort();
      };

      it('every row reads back the instant it was written — the rows the bounds are measured against', async () => {
        const res = await call('POST', '/api/v1/data/:object/query', { object: OBJECT }, { where: { memo: 'm' } });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const stored = Object.fromEntries((res.body.records as Array<{ id: string; opened_at: string }>).map((r) => [r.id, r.opened_at]));
        expect(stored).toEqual(Object.fromEntries(ROWS));
      });

      it('$lte and the $between maximum on 0050-01-01 include that whole day, and not the next midnight — as the 2026 control does', async () => {
        // Every reading first, then one comparison, so a red run shows all four cells.
        const got: Record<string, string[]> = {};
        for (const [name, bound] of QUERIES) got[name] = await idsWhere(bound);
        expect(got).toEqual(Object.fromEntries(QUERIES.map(([name, , want]) => [name, want])));
      });
    },
  );
}
