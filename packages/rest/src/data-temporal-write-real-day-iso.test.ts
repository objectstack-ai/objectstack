// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20525] A temporal string is written on a calendar day that exists, and a
 * `datetime` string in an ISO 8601 spelling, or it is refused at the public
 * door — `POST /api/v1/data/:object` and `PATCH /api/v1/data/:object/:id`
 * answer `400 VALIDATION_FAILED` / `invalid_date` and write nothing — over a
 * real `SqlDriver`, with the process in America/New_York so a host-zone
 * reading would show, and a leap day and the ISO spellings read back beside
 * them.
 *
 * Measured on the base (`b2b6a0643`) through this door, a create then a
 * read-back, the process in America/New_York:
 *
 * | written | SQLite | PostgreSQL 16 |
 * |:--|:--|:--|
 * | `date` `"2026-02-30"` | 201, `"2026-02-30"` (a day that does not exist) | 500 `DATABASE_ERROR` |
 * | `datetime` `"2026-02-30T10:00:00Z"` | 201, `"2026-03-02T10:00:00.000Z"` | the same |
 * | `datetime` `"2026/07/15 10:00"`, `"07/15/2026 10:00"`, `"15 July 2026 10:00"` | 201, `"2026-07-15T14:00:00.000Z"` — the process zone | the same |
 * | `datetime` `"07/08/2026"` | 201, `"2026-07-08T04:00:00.000Z"` — month-first, the process zone | the same |
 *
 * (InMemoryDriver answered as SQLite.) The refusal sits in the engine, in front
 * of every driver; the engine-level pin with a recording driver and the dry-run
 * `validate` is `packages/objectql/src/engine-temporal-write-real-day-iso.test.ts`.
 *
 * ## The dialect axis of THIS file
 *
 * The SQLite cell always runs. The PostgreSQL cell runs where
 * `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise; no CI job
 * provisions it for this package. It owns one table, dropped before and after.
 * An in-memory cell is not here: `@objectstack/driver-memory` has no binding in
 * this package, and a new one is a census decision
 * (`scripts/driver-memory-census.ledger.json`), not a test's; the memory driver
 * stores what this door admits as written in
 * `packages/drivers/driver-memory/src/memory-20525-temporal-write-real-day-iso.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'rest_temporal_20525';
const HOST_ZONE = 'America/New_York';

const LEDGER = {
  name: OBJECT,
  label: 'Ledger 20525',
  fields: {
    customer_id: { name: 'customer_id', type: 'text' as const },
    placed_on: { name: 'placed_on', type: 'date' as const },
    opened_at: { name: 'opened_at', type: 'datetime' as const },
  },
};

type Field = 'placed_on' | 'opened_at';

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

/** Arm 1, a day that does not exist, and Arm 2, the card's four non-ISO spellings — each a 201 or a 500 at the base. */
const REFUSED: ReadonlyArray<readonly [Field, string]> = [
  ['placed_on', '2026-02-30'],
  ['opened_at', '2026-02-30T10:00:00Z'],
  ['opened_at', '2026/07/15 10:00'],
  ['opened_at', '07/15/2026 10:00'],
  ['opened_at', '15 July 2026 10:00'],
  ['opened_at', '07/08/2026'],
];

/** Written value → what reads back: the leap-day controls, and the ISO spellings read the same in every zone. */
const ACCEPTED: ReadonlyArray<readonly [Field, string, string]> = [
  ['placed_on', '2028-02-29', '2028-02-29'],
  ['opened_at', '2028-02-29T10:00:00Z', '2028-02-29T10:00:00.000Z'],
  ['opened_at', '2026-07-15T10:00:00Z', '2026-07-15T10:00:00.000Z'],
  ['opened_at', '2026-07-15T10:00:00+08:00', '2026-07-15T02:00:00.000Z'],
  ['opened_at', '2026-07-15 10:00', '2026-07-15T10:00:00.000Z'],
  ['opened_at', '2026-07-15T10:00', '2026-07-15T10:00:00.000Z'],
  ['opened_at', '2026-07-15', '2026-07-15T00:00:00.000Z'],
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
    `[#20525] a real calendar day, and an ISO spelling for a datetime, at the public door — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let engine: ObjectQL;
      let driver: any;
      const writes = { n: 0 };
      let call: (method: string, path: string, params: Record<string, string>, body: unknown) => Promise<{ status: number; body: any }>;
      const readBack = async (id: string, field: Field) =>
        (await call('POST', '/api/v1/data/:object/query', { object: OBJECT }, { where: { id } })).body.records[0]?.[field];

      beforeAll(async () => {
        // A host whose zone is not UTC: the only configuration in which a
        // host-zone reading of a datetime can show. Node re-reads TZ lazily.
        process.env.TZ = HOST_ZONE;
        expect(Intl.DateTimeFormat().resolvedOptions().timeZone, 'the host zone really changed').toBe(HOST_ZONE);

        driver = new SqlDriver(config as any);
        if (cell.id !== 'sqlite') await driver.execute(`drop table if exists ${OBJECT}`).catch(() => {});
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(LEDGER as any);
        await engine.syncSchemas();
        await engine.insert(OBJECT, { id: 'o1', customer_id: 'c1', placed_on: '2026-01-10', opened_at: '2026-01-10T09:00:00Z' } as any);

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
        if (originalTz === undefined) delete process.env.TZ;
        else process.env.TZ = originalTz;
      });

      it('an impossible day and a non-ISO datetime are 400 VALIDATION_FAILED / invalid_date on create and on PATCH — nothing written', async () => {
        const before = writes.n;
        for (const [field, value] of REFUSED) {
          const created = await call('POST', '/api/v1/data/:object', { object: OBJECT }, { id: 'refused', customer_id: 'cw', [field]: value });
          expect(created.status, `create ${field} ${value}: ${JSON.stringify(created.body)}`).toBe(400);
          expect(created.body).toMatchObject({ code: 'VALIDATION_FAILED' });
          expect(created.body.fields.map((x: any) => [x.field, x.code]), `create ${field} ${value}`).toEqual([[field, 'invalid_date']]);
          const patched = await call('PATCH', '/api/v1/data/:object/:id', { object: OBJECT, id: 'o1' }, { [field]: value });
          expect(patched.status, `PATCH ${field} ${value}: ${JSON.stringify(patched.body)}`).toBe(400);
          expect(patched.body).toMatchObject({ code: 'VALIDATION_FAILED' });
          expect(patched.body.fields.map((x: any) => [x.field, x.code]), `PATCH ${field} ${value}`).toEqual([[field, 'invalid_date']]);
        }
        expect(writes.n - before, 'no write — every refusal precedes the driver').toBe(0);
        expect(await readBack('o1', 'placed_on'), 'o1 kept its day').toBe('2026-01-10');
        expect(await readBack('o1', 'opened_at'), 'o1 kept its instant').toBe('2026-01-10T09:00:00.000Z');
        expect(await readBack('refused', 'placed_on'), 'no row was created').toBeUndefined();
      });

      it('an epoch-millisecond number stays refused for a datetime — the control for a non-string', async () => {
        const created = await call('POST', '/api/v1/data/:object', { object: OBJECT }, { id: 'n1', customer_id: 'cw', opened_at: Date.UTC(2026, 6, 15, 10) });
        expect(created.status, JSON.stringify(created.body)).toBe(400);
        expect(created.body.fields.map((x: any) => [x.field, x.code])).toEqual([['opened_at', 'invalid_date']]);
      });

      it('a leap day and the ISO spellings are written and read back unchanged, in UTC — the POSITIVE CONTROL, on create and on PATCH', async () => {
        for (const [i, [field, value, stored]] of ACCEPTED.entries()) {
          const id = `w${i}`;
          const created = await call('POST', '/api/v1/data/:object', { object: OBJECT }, { id, customer_id: 'cw', [field]: value });
          expect(created.status, `create ${field} ${JSON.stringify(value)}: ${JSON.stringify(created.body)}`).toBe(201);
          expect(await readBack(id, field), `read back ${field} ${JSON.stringify(value)}`).toBe(stored);
        }
        const patched = await call('PATCH', '/api/v1/data/:object/:id', { object: OBJECT, id: 'o1' }, { placed_on: '2028-02-29', opened_at: '2026-07-15 10:00' });
        expect(patched.status, JSON.stringify(patched.body)).toBe(200);
        expect(await readBack('o1', 'placed_on')).toBe('2028-02-29');
        expect(await readBack('o1', 'opened_at'), 'zone-naive ISO is UTC, not the host zone').toBe('2026-07-15T10:00:00.000Z');
      });
    },
  );
}
