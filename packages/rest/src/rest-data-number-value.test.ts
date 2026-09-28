// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20309 — a number field refuses an array, a boolean or an object at every
 * REST write door, on a real engine (`ObjectQL` + sqlite `SqlDriver`) and the
 * real `RestServer` routes (the harness `rest-data-blank-typed-value.test.ts`
 * boots).
 *
 * Measured on `origin/main` c74de10a94 with this harness: `POST /data/:object`
 * with `[500]` on a number field answered 201, and SQLite stored the TEXT
 * `'[500]'`, which `GET` returned as the string `"[500]"`. `[]` stored `'[]'`,
 * and `true` / `false` stored `1` / `0`. Every one of those now answers
 * `400 VALIDATION_FAILED` with the field code `invalid_number`, and no row is
 * written or changed.
 *
 * The PHYSICAL column is read with the driver's own query builder and SQLite's
 * `typeof()`, past every engine read coercion.
 *
 * Controls: `[5, 7]` and `{}` were already refused and still are; a JS number
 * is stored as a SQLite `real` (`integer` on `rating`) and read back
 * unchanged; a blank is still stored as `null` (#20308).
 *
 * The string half (#20309, second part), measured on `origin/main` 851af0c27
 * with this harness before it: `'0x10'` answered 201 and SQLite stored the TEXT
 * `'0x10'` (read back as 16), and `' 12 '`, `'+5'`, `'.5'`, `'5.'`, `'007'`
 * answered 201 and were stored as numbers by the column's affinity. A string
 * is now read by the spec's numeric grammar (`parseNumericString`): an
 * admitted one is stored as its number (a SQLite `real`, `integer` on
 * `rating`), one the grammar refuses answers `400` / `invalid_number` and
 * nothing is written. The grammar's own case table drives both halves.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { COMPUTED_VALUE_TYPES, NUMERIC_STRING_GRAMMAR_CASES, NUMERIC_VALUE_TYPES } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const JUDGED = [...NUMERIC_VALUE_TYPES].filter((t) => !COMPUTED_VALUE_TYPES.has(t));
const f = (t: string) => `f_${t}`;

const OBJ = {
  name: 'num_rest', label: 'Number', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    ...Object.fromEntries(JUDGED.map((t) => [f(t), { name: f(t), type: t }])),
  },
};

/** The card's table and the non-string coercions it named. */
const REFUSED: ReadonlyArray<readonly [string, unknown]> = [
  ['[500]', [500]],
  ['[5, 7]', [5, 7]],
  ['[]', []],
  ['true', true],
  ['false', false],
  ['{}', {}],
];

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

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

async function boot() {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(OBJ as any);
  await engine.syncSchemas();

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, {
    api: { requireAuth: false }, batch: { enableBatchEndpoint: true },
  } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const call = async (method: string, path: string, params: Record<string, string>, body: unknown) => {
    const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    expect(route, `${method} ${path}`).toBeDefined();
    const res = makeRes();
    await route!.handler({ params, body, query: {}, headers: {} } as any, res);
    return { status: res._status ?? 200, body: res._json };
  };
  /** The physical cell and its SQLite storage class, read past every engine read coercion. */
  const cell = async (id: string, col: string) => {
    const rows = await (driver as any).knex.raw(`select "${col}" as v, typeof("${col}") as c from "num_rest" where id = ?`, [id]);
    return rows[0] as { v: unknown; c: string } | undefined;
  };
  return { engine, call, cell };
}

describe('REST write doors on SQLite: a number field refuses a non-number (#20309)', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => { ctx = await boot(); });

  const expectRefused = (res: { status: number; body: any }, field: string) => {
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(res.body.fields.map((x: any) => [x.field, x.code])).toEqual([[field, 'invalid_number']]);
  };
  const expectRowRefused = (res: { status: number; body: any }) => {
    expect(res.body.results.map((r: any) => [r.success, r.errors?.[0]?.code])).toEqual([[false, 'VALIDATION_FAILED']]);
  };

  describe.each(JUDGED)('%s', (type) => {
    const col = f(type);

    it.each(REFUSED)('%s: POST and batch create write no row; PATCH, batch update and updateMany leave the stored number', async (_l, value) => {
      expectRefused(await ctx.call('POST', '/api/v1/data/:object', { object: 'num_rest' }, { id: 'c1', [col]: structuredClone(value) }), col);
      expect(await ctx.cell('c1', col)).toBeUndefined();

      expectRowRefused(await ctx.call('POST', '/api/v1/data/:object/batch', { object: 'num_rest' },
        { operation: 'create', records: [{ data: { id: 'c2', [col]: structuredClone(value) } }] }));
      expect(await ctx.cell('c2', col)).toBeUndefined();

      await ctx.engine.insert('num_rest', { id: 'u1', [col]: 7 });
      expectRefused(await ctx.call('PATCH', '/api/v1/data/:object/:id', { object: 'num_rest', id: 'u1' }, { [col]: structuredClone(value) }), col);
      expectRowRefused(await ctx.call('POST', '/api/v1/data/:object/batch', { object: 'num_rest' },
        { operation: 'update', records: [{ id: 'u1', data: { [col]: structuredClone(value) } }] }));
      expectRowRefused(await ctx.call('POST', '/api/v1/data/:object/updateMany', { object: 'num_rest' },
        { records: [{ id: 'u1', data: { [col]: structuredClone(value) } }] }));
      expect((await ctx.cell('u1', col))?.v).toBe(7);
    });

    it('CONTROL: a JS number is stored as a number and read back unchanged, through POST and PATCH', async () => {
      const created = await ctx.call('POST', '/api/v1/data/:object', { object: 'num_rest' }, { id: 'n1', [col]: 500 });
      expect(created.status).toBe(201);
      expect(await ctx.cell('n1', col)).toEqual({ v: 500, c: type === 'rating' ? 'integer' : 'real' });
      const patched = await ctx.call('PATCH', '/api/v1/data/:object/:id', { object: 'num_rest', id: 'n1' }, { [col]: 12.5 });
      expect(patched.status).toBe(200);
      expect(await ctx.cell('n1', col)).toEqual({ v: 12.5, c: 'real' });
      const read = await ctx.engine.findOne('num_rest', { where: { id: 'n1' } }) as Record<string, unknown>;
      expect(read[col]).toBe(12.5);
    });
  });

  it('CONTROL: a blank is still stored as null (#20308)', async () => {
    const res = await ctx.call('POST', '/api/v1/data/:object', { object: 'num_rest' }, { id: 'e1', ...Object.fromEntries(JUDGED.map((t) => [f(t), ''])) });
    expect(res.status).toBe(201);
    for (const t of JUDGED) expect(await ctx.cell('e1', f(t)), t).toEqual({ v: null, c: 'null' });
  });
});

/** The spec grammar's own verdicts (#20336), blank rows aside (#20308 owns them). */
const ADMITTED = NUMERIC_STRING_GRAMMAR_CASES.flatMap((c) => (c.numeric ? [[JSON.stringify(c.input), c.input, c.value] as const] : []));
const REFUSED_STRINGS = NUMERIC_STRING_GRAMMAR_CASES.flatMap((c) => (!c.numeric && c.form !== 'empty' ? [[JSON.stringify(c.input), c.input] as const] : []));

describe('REST write doors on SQLite: a number field reads a string by the spec numeric grammar (#20309)', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => { ctx = await boot(); });

  const expectRefused = (res: { status: number; body: any }, field: string) => {
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(res.body.fields.map((x: any) => [x.field, x.code])).toEqual([[field, 'invalid_number']]);
  };
  const expectRowRefused = (res: { status: number; body: any }) => {
    expect(res.body.results.map((r: any) => [r.success, r.errors?.[0]?.code])).toEqual([[false, 'VALIDATION_FAILED']]);
  };
  const expectRowOk = (res: { status: number; body: any }) => {
    expect(res.body.results.map((r: any) => r.success)).toEqual([true]);
  };
  /** SQLite's storage class for a stored number: an integral value in the `rating` column is `integer`,
   *  unless it is past the 64-bit integer range (`1e21`), which stays `real`. */
  const classOf = (type: string, n: number) => (type === 'rating' && Number.isSafeInteger(n) ? 'integer' : 'real');

  describe.each(JUDGED)('%s', (type) => {
    const col = f(type);

    it.each(ADMITTED)('%s: POST, batch create, PATCH, batch update and updateMany store the number', async (_l, input, value) => {
      // `-0` is stored as the number 0: SQLite keeps no negative zero.
      const expected = { v: Object.is(value, -0) ? 0 : value, c: classOf(type, value) };

      expect((await ctx.call('POST', '/api/v1/data/:object', { object: 'num_rest' }, { id: 's1', [col]: input })).status).toBe(201);
      expect(await ctx.cell('s1', col)).toEqual(expected);

      expectRowOk(await ctx.call('POST', '/api/v1/data/:object/batch', { object: 'num_rest' },
        { operation: 'create', records: [{ data: { id: 's2', [col]: input } }] }));
      expect(await ctx.cell('s2', col)).toEqual(expected);

      for (const [door, send] of [
        ['PATCH', (id: string) => ctx.call('PATCH', '/api/v1/data/:object/:id', { object: 'num_rest', id }, { [col]: input })],
        ['batch update', (id: string) => ctx.call('POST', '/api/v1/data/:object/batch', { object: 'num_rest' },
          { operation: 'update', records: [{ id, data: { [col]: input } }] })],
        ['updateMany', (id: string) => ctx.call('POST', '/api/v1/data/:object/updateMany', { object: 'num_rest' },
          { records: [{ id, data: { [col]: input } }] })],
      ] as const) {
        const id = `u_${door.replace(' ', '_')}`;
        await ctx.engine.insert('num_rest', { id, [col]: 7 });
        const res = await send(id);
        expect(res.status, door).toBeLessThan(300);
        expect(await ctx.cell(id, col), door).toEqual(expected);
      }
    });

    it.each(REFUSED_STRINGS)('%s: POST and batch create write no row; PATCH, batch update and updateMany leave the stored number', async (_l, input) => {
      expectRefused(await ctx.call('POST', '/api/v1/data/:object', { object: 'num_rest' }, { id: 'c1', [col]: input }), col);
      expect(await ctx.cell('c1', col)).toBeUndefined();

      expectRowRefused(await ctx.call('POST', '/api/v1/data/:object/batch', { object: 'num_rest' },
        { operation: 'create', records: [{ data: { id: 'c2', [col]: input } }] }));
      expect(await ctx.cell('c2', col)).toBeUndefined();

      await ctx.engine.insert('num_rest', { id: 'u1', [col]: 7 });
      expectRefused(await ctx.call('PATCH', '/api/v1/data/:object/:id', { object: 'num_rest', id: 'u1' }, { [col]: input }), col);
      expectRowRefused(await ctx.call('POST', '/api/v1/data/:object/batch', { object: 'num_rest' },
        { operation: 'update', records: [{ id: 'u1', data: { [col]: input } }] }));
      expectRowRefused(await ctx.call('POST', '/api/v1/data/:object/updateMany', { object: 'num_rest' },
        { records: [{ id: 'u1', data: { [col]: input } }] }));
      expect(await ctx.cell('u1', col)).toEqual({ v: 7, c: type === 'rating' ? 'integer' : 'real' });
    });
  });
});
