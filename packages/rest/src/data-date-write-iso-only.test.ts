// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20481] A `date` string is written in its `YYYY-MM-DD` form or it is refused
 * at the public door — `POST /api/v1/data/:object` and
 * `PATCH /api/v1/data/:object/:id` answer `400 VALIDATION_FAILED` /
 * `invalid_date` for every other spelling, and write nothing — over a real
 * `SqlDriver`, with the ISO spellings and a 2026 day read back beside them.
 *
 * Measured on the base (`0bbe4005e`) through this door, a create then a
 * read-back:
 *
 * | written to a `date` | SQLite | PostgreSQL 16 (`DateStyle` `ISO, MDY`) |
 * |:--|:--|:--|
 * | `"2026/07/15"`, `"07/15/2026"`, `"15 July 2026"`, `"2026-7-15"`, `"2026.07.15"`, `"July 15, 2026"` | 201, read back verbatim | 201, `"2026-07-15"` |
 * | `"07/08/2026"` | 201, verbatim | 201, `"2026-07-08"` — August 7 on a `DMY` server |
 * | `"+002026-07-15"` | 201, verbatim | 500 |
 *
 * (InMemoryDriver answered as SQLite.) A verbatim `"2026/07/15"` is a non-day
 * that sorts and compares as text beside real days; PostgreSQL's reading is its
 * server's `DateStyle`, not the author's. No other spelling is canonicalised:
 * `07/08/2026` names two days. The refusal sits in the engine, in front of
 * every driver, so one verdict holds on each cell; the engine-level pin with a
 * recording driver, the dry-run `validate` and the comparand door's agreement
 * are `packages/objectql/src/engine-date-write-iso-only.test.ts`.
 *
 * ## The dialect axis of THIS file
 *
 * The SQLite cell always runs. The PostgreSQL cell runs where
 * `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise; no CI job
 * provisions it for this package. It owns one table, dropped before and after.
 * An in-memory cell is not here: `@objectstack/driver-memory` has no binding in
 * this package, and a new one is a census decision
 * (`scripts/driver-memory-census.ledger.json`), not a test's; the memory driver
 * stores what this door admits as its day in
 * `packages/drivers/driver-memory/src/memory-20481-date-write-iso-only.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'rest_date_20481';

const LEDGER = {
  name: OBJECT,
  label: 'Ledger 20481',
  fields: {
    customer_id: { name: 'customer_id', type: 'text' as const },
    placed_on: { name: 'placed_on', type: 'date' as const },
  },
};

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

/** `Date.parse`-readable, no leading `YYYY-MM-DD` — refused now. */
const REFUSED: readonly string[] = [
  '2026/07/15',
  '07/15/2026',
  '07/08/2026',
  '15 July 2026',
  'July 15, 2026',
  '2026-7-15',
  '2026.07.15',
  '+002026-07-15',
];

/** Written value → what reads back: a leading `YYYY-MM-DD`, collapsed to that day. */
const ACCEPTED: ReadonlyArray<readonly [string, string]> = [
  ['2026-07-15', '2026-07-15'],
  ['2026-07-15T10:00:00Z', '2026-07-15'],
  ['2026-07-15 10:00', '2026-07-15'],
  [' 2026-07-15', '2026-07-15'],
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

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#20481] a date string is written in its YYYY-MM-DD form at the public door — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let engine: ObjectQL;
      let driver: any;
      const writes = { n: 0 };
      let call: (method: string, path: string, params: Record<string, string>, body: unknown) => Promise<{ status: number; body: any }>;
      const readBack = async (id: string) =>
        (await call('POST', '/api/v1/data/:object/query', { object: OBJECT }, { where: { id } })).body.records[0]?.placed_on;

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        if (cell.id !== 'sqlite') await driver.execute(`drop table if exists ${OBJECT}`).catch(() => {});
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(LEDGER as any);
        await engine.syncSchemas();
        await engine.insert(OBJECT, { id: 'o1', customer_id: 'c1', placed_on: '2026-01-10' } as any);

        // Writes of THIS object — the protocol's own metadata traffic is not the question.
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

      it('every other spelling is 400 VALIDATION_FAILED / invalid_date on create and on PATCH — nothing written', async () => {
        const before = writes.n;
        for (const value of REFUSED) {
          const created = await call('POST', '/api/v1/data/:object', { object: OBJECT }, { id: 'refused', customer_id: 'cw', placed_on: value });
          expect(created.status, `create ${value}: ${JSON.stringify(created.body)}`).toBe(400);
          expect(created.body).toMatchObject({ code: 'VALIDATION_FAILED' });
          expect(created.body.fields.map((x: any) => [x.field, x.code]), `create ${value}`).toEqual([['placed_on', 'invalid_date']]);
          const patched = await call('PATCH', '/api/v1/data/:object/:id', { object: OBJECT, id: 'o1' }, { placed_on: value });
          expect(patched.status, `PATCH ${value}: ${JSON.stringify(patched.body)}`).toBe(400);
          expect(patched.body).toMatchObject({ code: 'VALIDATION_FAILED' });
          expect(patched.body.fields.map((x: any) => [x.field, x.code]), `PATCH ${value}`).toEqual([['placed_on', 'invalid_date']]);
        }
        expect(writes.n - before, 'no write — every refusal precedes the driver').toBe(0);
        expect(await readBack('o1'), 'o1 kept its day').toBe('2026-01-10');
        expect(await readBack('refused'), 'no row was created').toBeUndefined();
      });

      it('an epoch-millisecond number stays refused — the control for a non-string', async () => {
        const created = await call('POST', '/api/v1/data/:object', { object: OBJECT }, { id: 'n1', customer_id: 'cw', placed_on: Date.UTC(2026, 6, 15) });
        expect(created.status, JSON.stringify(created.body)).toBe(400);
        expect(created.body.fields.map((x: any) => [x.field, x.code])).toEqual([['placed_on', 'invalid_date']]);
      });

      it('the ISO spellings are written and read back as the day — the POSITIVE CONTROL, on create and on PATCH', async () => {
        for (const [i, [value, day]] of ACCEPTED.entries()) {
          const id = `w${i}`;
          const created = await call('POST', '/api/v1/data/:object', { object: OBJECT }, { id, customer_id: 'cw', placed_on: value });
          expect(created.status, `create ${JSON.stringify(value)}: ${JSON.stringify(created.body)}`).toBe(201);
          expect(await readBack(id), `read back ${JSON.stringify(value)}`).toBe(day);
        }
        const patched = await call('PATCH', '/api/v1/data/:object/:id', { object: OBJECT, id: 'o1' }, { placed_on: '2026-07-15T10:00:00Z' });
        expect(patched.status, JSON.stringify(patched.body)).toBe(200);
        expect(await readBack('o1')).toBe('2026-07-15');
      });
    },
  );
}
