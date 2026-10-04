// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20264] A `date` value names a year from 0001 to 9999, and [#20280] a
 * `datetime` value a year from 1000 to 9999, or it is refused at the public door — `POST /api/v1/data/:object/query` answers
 * `400 INVALID_FILTER` for a comparand (`where`, a per-aggregation `filter`,
 * `having`), and `POST /api/v1/data/:object` / `PATCH …/:id` answer
 * `400 VALIDATION_FAILED` / `invalid_date` for a written value — over a real
 * `SqlDriver`, with the range's edges and a 2026 control read beside them.
 *
 * Measured on the base (`b285508188`) through this door, seven 2026 rows:
 *
 * | position | input | SQLite | PostgreSQL 16 | MySQL 8.0 |
 * |:--|:--|:--|:--|:--|
 * | `where` on a `datetime`, `$gt` / `$lt` / `$eq` | year 10000 or −1, a number or ISO string | 7 / 0 / 0 | 500 | 500 |
 * | `where` on a `datetime` | year 0, a number or ISO string | 7 / 0 / 0 | 500 | 7 / 0 / 0 |
 * | `where` on a `date` | year 0, a number, ISO string or bare day | 7 / 0 / 0 | 500 | 7 / 0 / 0 |
 * | create a `date` | `"+010000-01-01T00:00:00.000Z"` | 201, read back verbatim | 500 | 500 |
 * | create a `date` / `datetime` | year 0 | 201 | 500 | 201 |
 *
 * (InMemoryDriver answered as SQLite. The right `where` answer for year 10000
 * is 0 / 7 / 0, and a stored `date` is a day.) The doors sit in the engine, in
 * front of every driver, so one verdict holds on each cell; the engine-level
 * pin with a recording driver is `packages/objectql/src/engine-temporal-year-range.test.ts`.
 *
 * ## The dialect axis of THIS file
 *
 * The SQLite cell always runs. The PostgreSQL and MySQL cells run where
 * `OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL` are set and are a named skip
 * otherwise; no CI job provisions them for this package (the live servers are
 * attached to `driver-sql`'s suite, where the range's edges are pinned per
 * dialect in `sql-driver-20264-temporal-year-range.test.ts`). Each live cell
 * owns one table, dropped before and after.
 *
 * [#20280] A MySQL `DATETIME` in years 0001..0099 is stored right and read
 * back a century late through mysql2's instant parser, which ADR-0053 D-F2
 * keeps, and MySQL documents its `DATETIME` from year 1000 only. So a
 * `datetime` begins at 1000: a comparand or a written value in 0001..0999 —
 * each read or written at the base on every cell — is refused here now, beside
 * the floor's edge (1000) and a `date` in those years (the control, still read
 * and written). No `datetime` below 1000 reaches a cell's read-back any more.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { EngineAggregateOptions, FilterCondition } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'rest_year_20264';

const LEDGER = {
  name: OBJECT,
  label: 'Ledger 20264',
  fields: {
    customer_id: { name: 'customer_id', type: 'text' as const },
    placed_on: { name: 'placed_on', type: 'date' as const },
    opened_at: { name: 'opened_at', type: 'datetime' as const },
  },
};

const ROWS = [
  { id: 'o1', customer_id: 'c1', placed_on: '2026-01-10', opened_at: '2026-01-01T10:00:00.000Z' },
  { id: 'o2', customer_id: 'c1', placed_on: '2026-01-02', opened_at: '2026-01-02T10:00:00.000Z' },
  { id: 'o3', customer_id: 'c2', placed_on: '2026-03-01', opened_at: '2026-02-01T10:00:00.000Z' },
  { id: 'o4', customer_id: 'c2', placed_on: '2026-02-01', opened_at: '2026-02-05T10:00:00.000Z' },
  { id: 'o5', customer_id: 'c2', placed_on: '2026-01-15', opened_at: '2026-02-06T10:00:00.000Z' },
  { id: 'o6', customer_id: 'c3', placed_on: '2026-02-01', opened_at: '2026-03-01T10:00:00.000Z' },
  { id: 'o7', customer_id: 'c4', placed_on: '2026-04-01', opened_at: '2026-04-01T10:00:00.000Z' },
];

const at = (iso: string) => Date.parse(iso);

interface Cell {
  id: 'sqlite' | 'pg' | 'mysql';
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
  {
    id: 'mysql',
    label: 'live mysql',
    env: 'OS_TEST_MYSQL_URL',
    config: () => (process.env.OS_TEST_MYSQL_URL ? { client: 'mysql2', connection: process.env.OS_TEST_MYSQL_URL } : null),
  },
];

/** field · comparand (as the wire carries it) — refused on every position */
const REFUSED: ReadonlyArray<readonly [string, string, unknown]> = [
  ['datetime, year 10000, a number', 'opened_at', at('+010000-01-01T00:00:00.000Z')],
  ['datetime, year 10000, its ISO string', 'opened_at', '+010000-01-01T00:00:00.000Z'],
  ['datetime, year -1, a number', 'opened_at', at('-000001-01-01T00:00:00.000Z')],
  ['datetime, year -1, its ISO string', 'opened_at', '-000001-01-01T00:00:00.000Z'],
  ['datetime, year 0, a number', 'opened_at', at('0000-06-15T00:00:00.000Z')],
  ['datetime, year 0, its ISO string', 'opened_at', '0000-06-15T00:00:00.000Z'],
  ['date, year 0, a number', 'placed_on', at('0000-06-15T00:00:00.000Z')],
  ['date, year 0, its ISO string', 'placed_on', '0000-06-15T00:00:00.000Z'],
  ['date, year 0, a bare day', 'placed_on', '0000-06-15'],
  // [#20280] A datetime before year 1000, in every spelling — each read at the base.
  ['datetime, the first instant of year 1, its ISO string', 'opened_at', '0001-01-01T00:00:00.000Z'],
  ['datetime, year 99, a number', 'opened_at', at('0099-03-04T10:00:00.000Z')],
  ['datetime, year 999, a bare day (midnight UTC)', 'opened_at', '0999-12-31'],
  ['datetime, 1000 in its zone, 999 in UTC', 'opened_at', '1000-01-01T00:00:00+08:00'],
];

/** field · comparand · `where` counts for `$gt` / `$lt` / `$eq` — the edges and the 2026 control */
const READ: ReadonlyArray<readonly [string, string, unknown, readonly [number, number, number]]> = [
  ['datetime, the first instant of year 1000 (the floor)', 'opened_at', '1000-01-01T00:00:00.000Z', [7, 0, 0]],
  ['datetime, the last instant of year 9999, a number', 'opened_at', at('9999-12-31T23:59:59.999Z'), [0, 7, 0]],
  ['datetime, 2026-02-01T10:00Z (control)', 'opened_at', '2026-02-01T10:00:00.000Z', [4, 2, 1]],
  ['datetime, 2026-02-01T10:00Z as a number (control)', 'opened_at', at('2026-02-01T10:00:00.000Z'), [4, 2, 1]],
  ['date, 0001-01-01', 'placed_on', '0001-01-01', [7, 0, 0]],
  ['date, 0999-12-31 (a date keeps the years before 1000)', 'placed_on', '0999-12-31', [7, 0, 0]],
  ['date, 9999-12-31', 'placed_on', '9999-12-31', [0, 7, 0]],
  ['date, 2026-02-01 (control)', 'placed_on', '2026-02-01', [2, 3, 2]],
];

/** field · written value — refused at the write door */
const WRITE_REFUSED: ReadonlyArray<readonly [string, string]> = [
  ['placed_on', '+010000-01-01T00:00:00.000Z'],
  ['placed_on', '-000001-01-01T00:00:00.000Z'],
  ['placed_on', '0000-06-15'],
  ['opened_at', '+010000-01-01T00:00:00.000Z'],
  ['opened_at', '0000-06-15T10:00:00.000Z'],
  ['opened_at', '9999-12-31T23:59:59-01:00'],
  // [#20280] Each a 201 at the base.
  ['opened_at', '0001-01-01T00:00:00.000Z'],
  ['opened_at', '0100-03-04T10:00:00.000Z'],
  ['opened_at', '0999-12-31T23:59:59.999Z'],
];

/** field · written value · what reads back — the edges and the 2026 control */
const WRITE_ACCEPTED: ReadonlyArray<readonly [string, string, string]> = [
  ['placed_on', '0001-01-01', '0001-01-01'],
  ['placed_on', '9999-12-31', '9999-12-31'],
  ['placed_on', '2026-02-01', '2026-02-01'],
  ['placed_on', '0999-12-31', '0999-12-31'],
  ['opened_at', '1000-01-01T00:00:00.000Z', '1000-01-01T00:00:00.000Z'],
  ['opened_at', '9999-12-31T23:59:59.999Z', '9999-12-31T23:59:59.999Z'],
  ['opened_at', '2026-02-01T10:00:00.000Z', '2026-02-01T10:00:00.000Z'],
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

const perAggregation = (filter: FilterCondition): EngineAggregateOptions => ({
  aggregations: [{ function: 'count', alias: 'n' }, { function: 'count', alias: 'm', filter }],
});
const grouped = (field: string, having: FilterCondition): EngineAggregateOptions => ({
  groupBy: ['customer_id'],
  aggregations: [{ function: 'min', field, alias: 'first' }],
  having,
});

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#20264] the supported years, a date 0001..9999 and a datetime 1000..9999, at the public door — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let engine: ObjectQL;
      let driver: any;
      const reads = { n: 0 };
      const writes = { n: 0 };
      let call: (method: string, path: string, params: Record<string, string>, body: unknown) => Promise<{ status: number; body: any }>;
      const query = (body: Record<string, unknown>) =>
        call('POST', '/api/v1/data/:object/query', { object: OBJECT }, JSON.parse(JSON.stringify(body)));

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        if (cell.id !== 'sqlite') await driver.execute(`drop table if exists ${OBJECT}`).catch(() => {});
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(LEDGER as any);
        await engine.syncSchemas();
        for (const row of ROWS) await engine.insert(OBJECT, { ...row } as any);

        // Reads and writes of THIS object — the protocol's own metadata traffic is not the question.
        for (const verb of ['find', 'findOne', 'count', 'aggregate'] as const) {
          const real = driver[verb].bind(driver);
          driver[verb] = (o: string, ...rest: unknown[]) => { if (o === OBJECT) reads.n += 1; return real(o, ...rest); };
        }
        for (const verb of ['create', 'update', 'bulkCreate', 'updateMany'] as const) {
          if (typeof driver[verb] !== 'function') continue;
          const real = driver[verb].bind(driver);
          driver[verb] = (o: string, ...rest: unknown[]) => { if (o === OBJECT) writes.n += 1; return real(o, ...rest); };
        }

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
      });

      afterAll(async () => {
        if (cell.id !== 'sqlite') await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      it('a comparand outside its kind\'s years is 400 INVALID_FILTER at where, the per-aggregation filter and having — no read', async () => {
        const before = reads.n;
        for (const [name, field, comparand] of REFUSED) {
          for (const op of ['$gt', '$lt', '$eq'] as const) {
            const where = { [field]: { [op]: comparand } } as FilterCondition;
            for (const [position, body] of [
              ['where', { where }],
              ['filter', perAggregation(where)],
              ['having', grouped(field, { first: { [op]: comparand } } as FilterCondition)],
            ] as const) {
              const res = await query(body as Record<string, unknown>);
              expect(res.status, `${position}, ${name}, ${op}: ${JSON.stringify(res.body)}`).toBe(400);
              expect(res.body.code, `${position}, ${name}, ${op}`).toBe('INVALID_FILTER');
            }
          }
        }
        expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
      });

      it('the edges and the 2026 control are read — the same counts at where and at the per-aggregation filter', async () => {
        for (const [name, field, comparand, counts] of READ) {
          for (const [i, op] of (['$gt', '$lt', '$eq'] as const).entries()) {
            const where = { [field]: { [op]: comparand } } as FilterCondition;
            const w = await query({ where });
            expect(w.status, `where, ${name}, ${op}: ${JSON.stringify(w.body)}`).toBe(200);
            expect(w.body.records.length, `where, ${name}, ${op}`).toBe(counts[i]);
            const f = await query(perAggregation(where) as Record<string, unknown>);
            expect(f.status, `filter, ${name}, ${op}`).toBe(200);
            expect(Number(f.body.records[0]?.m), `filter, ${name}, ${op}`).toBe(counts[i]);
            const h = await query(grouped(field, { first: { [op]: comparand } } as FilterCondition) as Record<string, unknown>);
            expect(h.status, `having, ${name}, ${op}`).toBe(200);
          }
        }
      });

      it('a written value outside its kind\'s years is 400 VALIDATION_FAILED / invalid_date on create and on PATCH — nothing written', async () => {
        const before = writes.n;
        for (const [field, value] of WRITE_REFUSED) {
          const created = await call('POST', '/api/v1/data/:object', { object: OBJECT }, { id: 'refused', customer_id: 'cw', [field]: value });
          expect(created.status, `create ${field} ${value}: ${JSON.stringify(created.body)}`).toBe(400);
          expect(created.body).toMatchObject({ code: 'VALIDATION_FAILED' });
          expect(created.body.fields.map((x: any) => [x.field, x.code]), `create ${field} ${value}`).toEqual([[field, 'invalid_date']]);
          const patched = await call('PATCH', '/api/v1/data/:object/:id', { object: OBJECT, id: 'o1' }, { [field]: value });
          expect(patched.status, `PATCH ${field} ${value}: ${JSON.stringify(patched.body)}`).toBe(400);
          expect(patched.body).toMatchObject({ code: 'VALIDATION_FAILED' });
        }
        expect(writes.n - before, 'no write — every refusal precedes the driver').toBe(0);
        const o1 = await query({ where: { id: 'o1' } });
        expect(o1.body.records[0]).toMatchObject({ placed_on: '2026-01-10', opened_at: '2026-01-01T10:00:00.000Z' });
      });

      it('the edges and the 2026 control are written and read back as written', async () => {
        for (const [i, [field, value, readBack]] of WRITE_ACCEPTED.entries()) {
          const id = `w${i}`;
          const created = await call('POST', '/api/v1/data/:object', { object: OBJECT }, { id, customer_id: 'cw', [field]: value });
          expect(created.status, `create ${field} ${value}: ${JSON.stringify(created.body)}`).toBe(201);
          const got = (await query({ where: { id } })).body.records[0]?.[field];
          expect(got, `read back ${field} ${value}`).toBe(readBack);
        }
      });
    },
  );
}
