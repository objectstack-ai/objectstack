// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20386 — a `progress` field's declared `min` / `max` are refused at every REST
 * write door, with the `number` field's codes, on a real engine (`ObjectQL` +
 * sqlite `SqlDriver`) and the real `RestServer` routes (the harness
 * `rest-data-number-value.test.ts` boots).
 *
 * Measured on `origin/main` dc0ab6a2e with this harness (and the same rows on
 * the memory driver): `POST /data/:object` with `150` on a `progress` field
 * declaring `max: 100` answered 201 and SQLite stored the `real` 150; `-5` on
 * `min: 0` answered 201 and stored -5. A `number` field with the same bounds
 * answered `400 VALIDATION_FAILED` with `max_value` / `min_value` and wrote no
 * row. Both `progress` rows now answer exactly what the `number` rows answer.
 *
 * The PHYSICAL column is read with the driver's own query builder and SQLite's
 * `typeof()`, past every engine read coercion.
 *
 * Controls: a `progress` value inside its bounds (and on each inclusive bound)
 * is stored as the same number; `scale` / `precision` declared on a `progress`
 * field stay unread (their contracts name other types), so `33.5` under
 * `scale: 0` still writes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJ = {
  name: 'progress_rest', label: 'Progress', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    p_done: { name: 'p_done', type: 'progress' as const, label: 'Done', min: 0, max: 100 },
    n_done: { name: 'n_done', type: 'number' as const, label: 'Done', min: 0, max: 100 },
    p_whole: { name: 'p_whole', type: 'progress' as const, label: 'Whole', min: 0, max: 100, scale: 0, precision: 2 },
  },
};

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
    const rows = await (driver as any).knex.raw(`select "${col}" as v, typeof("${col}") as c from "progress_rest" where id = ?`, [id]);
    return rows[0] as { v: unknown; c: string } | undefined;
  };
  return { engine, call, cell };
}

const OUT_OF_BOUNDS: ReadonlyArray<readonly [number, string, Record<string, number>]> = [
  [150, 'max_value', { max: 100 }],
  [-5, 'min_value', { min: 0 }],
];

describe('REST write doors on SQLite: a `progress` field refuses a value outside its declared bounds (#20386)', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => { ctx = await boot(); });

  const expectRefused = (res: { status: number; body: any }, field: string, code: string, constraint: Record<string, number>) => {
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(res.body.fields.map((x: any) => [x.field, x.code, x.constraint])).toEqual([[field, code, constraint]]);
  };
  const expectRowRefused = (res: { status: number; body: any }) => {
    expect(res.body.results.map((r: any) => [r.success, r.errors?.[0]?.code])).toEqual([[false, 'VALIDATION_FAILED']]);
  };

  it.each(OUT_OF_BOUNDS)('%s: POST answers the `number` field\'s refusal (%s) and writes no row', async (value, code, constraint) => {
    const progress = await ctx.call('POST', '/api/v1/data/:object', { object: 'progress_rest' }, { id: 'p', p_done: value });
    expectRefused(progress, 'p_done', code, constraint);
    expect(await ctx.cell('p', 'p_done')).toBeUndefined();

    // The control the card measured beside it: the same bound on `number`.
    const number = await ctx.call('POST', '/api/v1/data/:object', { object: 'progress_rest' }, { id: 'n', n_done: value });
    expectRefused(number, 'n_done', code, constraint);
    expect(await ctx.cell('n', 'n_done')).toBeUndefined();
  });

  it.each(OUT_OF_BOUNDS)('%s: batch create writes no row; PATCH, batch update and updateMany leave the stored value', async (value, code, constraint) => {
    expectRowRefused(await ctx.call('POST', '/api/v1/data/:object/batch', { object: 'progress_rest' },
      { operation: 'create', records: [{ data: { id: 'b1', p_done: value } }] }));
    expect(await ctx.cell('b1', 'p_done')).toBeUndefined();

    await ctx.engine.insert('progress_rest', { id: 'u1', p_done: 40 });
    expectRefused(await ctx.call('PATCH', '/api/v1/data/:object/:id', { object: 'progress_rest', id: 'u1' }, { p_done: value }), 'p_done', code, constraint);
    expectRowRefused(await ctx.call('POST', '/api/v1/data/:object/batch', { object: 'progress_rest' },
      { operation: 'update', records: [{ id: 'u1', data: { p_done: value } }] }));
    expectRowRefused(await ctx.call('POST', '/api/v1/data/:object/updateMany', { object: 'progress_rest' },
      { records: [{ id: 'u1', data: { p_done: value } }] }));
    expect(await ctx.cell('u1', 'p_done')).toEqual({ v: 40, c: 'real' });
  });

  it('CONTROL: a value inside the bounds, and each inclusive bound, is stored as the same number through POST and PATCH', async () => {
    for (const [id, value] of [['i50', 50], ['i0', 0], ['i100', 100], ['i33', 33.5]] as const) {
      const created = await ctx.call('POST', '/api/v1/data/:object', { object: 'progress_rest' }, { id, p_done: value });
      expect(created.status, `${value}`).toBe(201);
      expect((await ctx.cell(id, 'p_done'))?.v, `${value}`).toBe(value);
    }
    const patched = await ctx.call('PATCH', '/api/v1/data/:object/:id', { object: 'progress_rest', id: 'i50' }, { p_done: 75 });
    expect(patched.status).toBe(200);
    expect((await ctx.cell('i50', 'p_done'))?.v).toBe(75);
  });

  it('CONTROL: `scale` / `precision` declared on `progress` stay unread — 33.5 under `scale: 0, precision: 2` writes', async () => {
    const created = await ctx.call('POST', '/api/v1/data/:object', { object: 'progress_rest' }, { id: 's1', p_whole: 33.5 });
    expect(created.status).toBe(201);
    expect(await ctx.cell('s1', 'p_whole')).toEqual({ v: 33.5, c: 'real' });
    // …while its bounds bind like every other `progress` field's.
    expectRefused(await ctx.call('POST', '/api/v1/data/:object', { object: 'progress_rest' }, { id: 's2', p_whole: 150 }), 'p_whole', 'max_value', { max: 100 });
  });
});
