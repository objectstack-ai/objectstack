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
 * ## [#20549] The comparand door, over the same cells
 *
 * The same values as filter comparands, through `POST /api/v1/data/:object/query`
 * with the process in America/New_York. Measured on the base (`f1e921ab8e`),
 * PostgreSQL 16 at Asia/Shanghai:
 *
 * | `where` | SQLite | PostgreSQL 16 |
 * |:--|:--|:--|
 * | `opened_at $eq "2026-02-30T10:00:00Z"` | 200, the row at 2026-03-02T10:00Z (rolled over) | the same |
 * | `opened_at $eq "07/15/2026 10:00"`, `"2026/07/15 10:00"` | 200, the row at 2026-07-15T14:00Z (the process zone) | the same |
 * | `placed_on $eq "2026-02-30"` | 200 `[]` (compared as text) | 500 `DATABASE_ERROR` |
 *
 * (InMemoryDriver answered as SQLite.) Both doors now ask
 * `@objectstack/core`'s one rule, so each is `400 INVALID_FILTER` naming the
 * field, before any read, and the leap day and the ISO spellings still find
 * their rows; the engine-level pin is
 * `packages/objectql/src/engine-temporal-comparand-door.test.ts`.
 *
 * ## [#20480] A time comparand whose instant has no four-digit UTC year
 *
 * Measured on the base through this door, rows `09:00:00` / `10:30:00` /
 * `12:00:00`: `slot $gt "+010000-01-01T10:00:00Z"` answered 3 of 3 on SQLite
 * (compared as text) and 500 on PostgreSQL (`22009`); the number of that
 * instant answered 3 of 3 on SQLite. Each is `400 INVALID_FILTER` now, and the
 * same wall clock as a 2026 instant still answers 2 / 1.
 *
 * ## [#20671] The same class as a WRITTEN time
 *
 * Measured on the base (`fa0a4b661`) through this door, a create then a
 * read-back, the process in America/New_York, PostgreSQL 16 at Asia/Shanghai:
 *
 * | written to `slot` | SQLite | PostgreSQL 16 |
 * |:--|:--|:--|
 * | `"+010000-01-01T10:00:00Z"`, `"9999-12-31T23:00:00-02:00"` | 201, read back verbatim | 500 `DATABASE_ERROR` |
 * | `"10:00Z"`, `"10:00+08:00"` | 201, read back verbatim | 201, `"10:00:00"` |
 * | `"10:00"`, `"10:00:00"`, `"2026-07-15T10:00:00Z"` | 201, `"10:00:00"` | the same |
 *
 * (InMemoryDriver answered as SQLite.) The `time` write arm now asks the same
 * core rule as the comparand door: the first four are `400 VALIDATION_FAILED`
 * / `invalid_time` with no write, a zone suffix on a time of day in its own
 * sentence, and the controls read back unchanged on both cells. The
 * engine-level pin is `packages/objectql/src/engine-time-write-zone-less.test.ts`,
 * and the memory driver's half is
 * `packages/drivers/driver-memory/src/memory-20671-time-write-zone-less.test.ts`.
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
import { renderValidationMessage } from '@objectstack/spec/system';
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
    // [#20480] A time column, for the third kind of the same rule.
    slot: { name: 'slot', type: 'time' as const },
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
      const reads = { n: 0 };
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
        // [#20549] …and reads of it, for the comparand door's "before any read".
        for (const verb of ['find', 'findOne', 'count', 'aggregate'] as const) {
          if (typeof driver[verb] !== 'function') continue;
          const real = driver[verb].bind(driver);
          driver[verb] = (o: string, ...rest: unknown[]) => { if (o === OBJECT) reads.n += 1; return real(o, ...rest); };
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

      it('[#20480] an instant with no four-digit UTC year on a time field is 400 INVALID_FILTER before any read — and the 2026 control answers 2 / 1', async () => {
        for (const [id, slot] of [['s09', '09:00:00'], ['s1030', '10:30:00'], ['s12', '12:00:00']] as const) {
          const created = await call('POST', '/api/v1/data/:object', { object: OBJECT }, { id, customer_id: 'cs', slot });
          expect(created.status, JSON.stringify(created.body)).toBe(201);
        }
        const query = (where: Record<string, unknown>) =>
          call('POST', '/api/v1/data/:object/query', { object: OBJECT }, { where: { $and: [{ customer_id: 'cs' }, where] } });
        const before = reads.n;
        for (const value of ['+010000-01-01T10:00:00Z', '9999-12-31T23:00:00-02:00', Date.parse('+010000-01-01T10:00:00Z')]) {
          for (const op of ['$gt', '$lt'] as const) {
            const res = await query({ slot: { [op]: value } });
            expect(res.status, `${op} ${String(value)}: ${JSON.stringify(res.body)}`).toBe(400);
            expect(res.body.code, `${op} ${String(value)}`).toBe('INVALID_FILTER');
            expect(JSON.stringify(res.body), 'names the field').toContain('slot');
          }
        }
        expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
        const ids = async (where: Record<string, unknown>) => {
          const res = await query(where);
          expect(res.status, `${JSON.stringify(where)}: ${JSON.stringify(res.body)}`).toBe(200);
          return (res.body.records as Array<{ id: string }>).map((r) => r.id).sort();
        };
        for (const at of ['2026-07-15T10:00:00Z', '2026-07-15T18:00:00+08:00', Date.parse('2026-07-15T10:00:00Z')]) {
          expect(await ids({ slot: { $gt: at } }), `$gt ${String(at)}`).toEqual(['s1030', 's12']);
          expect(await ids({ slot: { $lt: at } }), `$lt ${String(at)}`).toEqual(['s09']);
        }
      });

      it('[#20671] a zone-suffixed time of day and an instant with no four-digit UTC year are 400 VALIDATION_FAILED / invalid_time on create and on PATCH — and a plain wall clock reads back identically', async () => {
        const readSlot = async (id: string) =>
          (await call('POST', '/api/v1/data/:object/query', { object: OBJECT }, { where: { id } })).body.records[0]?.slot;
        const created0 = await call('POST', '/api/v1/data/:object', { object: OBJECT }, { id: 't0', customer_id: 'ct', slot: '09:00' });
        expect(created0.status, JSON.stringify(created0.body)).toBe(201);
        const before = writes.n;
        for (const [value, zoned] of [
          ['+010000-01-01T10:00:00Z', false],
          ['9999-12-31T23:00:00-02:00', false],
          ['10:00Z', true],
          ['10:00+08:00', true],
        ] as const) {
          for (const [door, res] of [
            ['create', await call('POST', '/api/v1/data/:object', { object: OBJECT }, { id: 'refused-t', customer_id: 'ct', slot: value })],
            ['PATCH', await call('PATCH', '/api/v1/data/:object/:id', { object: OBJECT, id: 't0' }, { slot: value })],
          ] as const) {
            expect(res.status, `${door} ${value}: ${JSON.stringify(res.body)}`).toBe(400);
            expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
            expect(res.body.fields.map((x: any) => [x.field, x.code]), `${door} ${value}`).toEqual([['slot', 'invalid_time']]);
            const sentence = renderValidationMessage({ messageKey: zoned ? 'invalid_time_zoned' : 'invalid_time', label: res.body.fields[0].label, field: 'slot' });
            expect(res.body.fields[0].message, `${door} ${value}: the ${zoned ? 'zone' : 'plain'} sentence`).toBe(sentence);
          }
        }
        expect(writes.n - before, 'no write — every refusal precedes the driver').toBe(0);
        expect(await readSlot('t0'), 't0 kept its wall clock').toBe('09:00:00');
        expect(await readSlot('refused-t'), 'no row was created').toBeUndefined();

        for (const [i, [value, stored]] of ([
          ['10:00', '10:00:00'],
          ['10:00:00', '10:00:00'],
          ['10:00:00.250', '10:00:00.250'],
          // A full ISO instant with a four-digit year stays admitted, and keeps its UTC time of day.
          ['2026-07-15T10:00:00Z', '10:00:00'],
          ['2026-07-15T18:00:00+08:00', '10:00:00'],
        ] as const).entries()) {
          const created = await call('POST', '/api/v1/data/:object', { object: OBJECT }, { id: `t${i + 1}`, customer_id: 'ct', slot: value });
          expect(created.status, `create ${value}: ${JSON.stringify(created.body)}`).toBe(201);
          expect(await readSlot(`t${i + 1}`), `read back ${value}`).toBe(stored);
        }
        const patched = await call('PATCH', '/api/v1/data/:object/:id', { object: OBJECT, id: 't0' }, { slot: '10:00' });
        expect(patched.status, JSON.stringify(patched.body)).toBe(200);
        expect(await readSlot('t0')).toBe('10:00:00');
      });

      it('[#20549] the same values as filter comparands are 400 INVALID_FILTER naming the field, before any read — and the leap day and the ISO spellings still find their rows', async () => {
        // The rows the base's misreadings matched: March 2 (a rolled-over
        // February 30) and 14:00Z (10:00 in the process zone).
        for (const [id, placed_on, opened_at] of [
          ['q-mar2', '2026-03-02', '2026-03-02T10:00:00Z'],
          ['q-jul15', '2026-07-15', '2026-07-15T14:00:00Z'],
          ['q-leap', '2028-02-29', '2028-02-29T10:00:00Z'],
        ] as const) {
          const created = await call('POST', '/api/v1/data/:object', { object: OBJECT }, { id, customer_id: 'cq', placed_on, opened_at });
          expect(created.status, JSON.stringify(created.body)).toBe(201);
        }
        const query = (where: Record<string, unknown>) =>
          call('POST', '/api/v1/data/:object/query', { object: OBJECT }, { where: { $and: [{ customer_id: 'cq' }, where] } });

        const before = reads.n;
        for (const [field, value] of REFUSED) {
          const res = await query({ [field]: { $eq: value } });
          expect(res.status, `${field} ${value}: ${JSON.stringify(res.body)}`).toBe(400);
          expect(res.body.code, `${field} ${value}`).toBe('INVALID_FILTER');
          expect(JSON.stringify(res.body), `${field} ${value} names the field`).toContain(field);
        }
        expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);

        const ids = async (where: Record<string, unknown>) => {
          const res = await query(where);
          expect(res.status, `${JSON.stringify(where)}: ${JSON.stringify(res.body)}`).toBe(200);
          return (res.body.records as Array<{ id: string }>).map((r) => r.id).sort();
        };
        expect(await ids({ placed_on: { $eq: '2028-02-29' } }), 'a leap day on a date').toEqual(['q-leap']);
        expect(await ids({ opened_at: { $eq: '2028-02-29T10:00:00Z' } }), 'a leap day on a datetime').toEqual(['q-leap']);
        expect(await ids({ opened_at: { $eq: '2026-07-15T14:00:00Z' } }), 'ISO, Z').toEqual(['q-jul15']);
        expect(await ids({ opened_at: { $eq: '2026-07-15T22:00:00+08:00' } }), 'ISO, an offset').toEqual(['q-jul15']);
        expect(await ids({ opened_at: { $eq: '2026-07-15 14:00' } }), 'zone-naive ISO is UTC, not the host zone').toEqual(['q-jul15']);
        expect(await ids({ opened_at: { $gte: '2026-03-02', $lt: '2026-03-03' } }), 'bare days as bounds').toEqual(['q-mar2']);
        expect(await ids({ placed_on: { $eq: '2026-03-02' } }), 'the day February 30 was rolled onto').toEqual(['q-mar2']);
      });
    },
  );
}
