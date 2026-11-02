// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29241] A number or a boolean sent to a text-family field, through the REST
 * write doors, on a real engine (`ObjectQL` + sqlite `SqlDriver`) and the real
 * `RestServer` routes (the harness `rest-data-blank-typed-value.test.ts`
 * boots).
 *
 * The record validator's string arm judges such a value by its string reading
 * (`42` as `'42'`, `true` as `'true'`), and the write door now stores that
 * string, so the physical TEXT column, the engine's `findOne` and `GET …/:id`
 * all hand back the string. The PHYSICAL column is read with the driver's own
 * query builder, past every engine read coercion.
 *
 * Controls: a string is stored as sent, and a number field keeps its number.
 *
 * The unique key compares what is stored, so the accept set of a `unique`
 * text field moves (Clause-② yes, narrowing), measured on `origin/main`
 * @ `7f277a86` (the file at base) and on this change, SQLite here and driver-memory beside it:
 *
 *   sequence on a unique text field   base (SQLite)   base (memory)   head (both)
 *   42, then '42'                     201, 201        201, 201        201, 409
 *   true, then 'true'                 201, 201        201, 201        201, 409
 *   true, then 1                      201, 409        201, 201        201, 201
 *   false, then 0                     201, 409        201, 201        201, 201
 *
 * The first two rows are the narrowing: the validator reads both values as one
 * string, and now the unique key does too. The last two are SQLite's widening:
 * base stored `true` and `1` both as `'1.0'`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJ = {
  name: 'scalar_rest', label: 'Scalar', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', type: 'text' as const },
    note: { name: 'note', type: 'textarea' as const },
    amount: { name: 'amount', type: 'number' as const },
    code: { name: 'code', type: 'text' as const, unique: true },
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
  /** The physical row, read past every engine read coercion. */
  const stored = async (id: string) =>
    (await (driver as any).knex('scalar_rest').where({ id }).first()) as Record<string, unknown> | undefined;
  /** The physical row, the engine's read and `GET …/:id`, for one id. */
  const threeReads = async (id: string) => {
    const g = await call('GET', '/api/v1/data/:object/:id', { object: 'scalar_rest', id }, undefined);
    expect(g.status, JSON.stringify(g.body)).toBe(200);
    return {
      stored: await stored(id),
      engine: (await engine.findOne('scalar_rest', { where: { id } })) as Record<string, unknown> | null,
      rest: (g.body.record ?? g.body) as Record<string, unknown>,
    };
  };
  return { engine, call, threeReads };
}

function expectStrings(reads: Record<string, Record<string, unknown> | null | undefined>, want: Record<string, string>) {
  for (const [where, row] of Object.entries(reads)) {
    expect(row, where).toBeTruthy();
    for (const [k, v] of Object.entries(want)) expect(row![k], `${where} · ${k}`).toBe(v);
  }
}

describe('REST write doors on SQLite: a number or boolean on a text field is stored as its string (#29241)', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => { ctx = await boot(); });

  it('POST create: 42 and true are stored and read back as "42" and "true"', async () => {
    const res = await ctx.call('POST', '/api/v1/data/:object', { object: 'scalar_rest' }, { id: 'c1', title: 42, note: true, amount: 7 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const reads = await ctx.threeReads('c1');
    expectStrings(reads, { title: '42', note: 'true' });
    // Control: a number field keeps its number.
    expect(reads.stored!.amount).toBe(7);
  });

  it('PATCH update: false and 0 are stored as "false" and "0"', async () => {
    await ctx.engine.insert('scalar_rest', { id: 'u1', title: 'orig', note: 'orig' });
    const res = await ctx.call('PATCH', '/api/v1/data/:object/:id', { object: 'scalar_rest', id: 'u1' }, { title: 0, note: false });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expectStrings(await ctx.threeReads('u1'), { title: '0', note: 'false' });
  });

  it('batch create: the judged string is stored', async () => {
    const res = await ctx.call('POST', '/api/v1/data/:object/batch', { object: 'scalar_rest' },
      { operation: 'create', records: [{ data: { id: 'b1', title: 1.5, note: true } }] });
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: any) => r.success)).toEqual([true]);
    expectStrings(await ctx.threeReads('b1'), { title: '1.5', note: 'true' });
  });

  it('control: a string is stored as sent', async () => {
    const res = await ctx.call('POST', '/api/v1/data/:object', { object: 'scalar_rest' }, { id: 's1', title: '42', note: 'true' });
    expect(res.status).toBe(201);
    expectStrings(await ctx.threeReads('s1'), { title: '42', note: 'true' });
  });
});

describe('a unique text field compares the stored string (#29241, Clause-② narrowing)', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => { ctx = await boot(); });

  const post = (id: string, code: unknown) =>
    ctx.call('POST', '/api/v1/data/:object', { object: 'scalar_rest' }, { id, code });

  for (const [first, second] of [[42, '42'], [true, 'true']] as const) {
    it(`${JSON.stringify(first)}, then ${JSON.stringify(second)}: the second is refused 409 UNIQUE_VIOLATION (base stored both)`, async () => {
      expect((await post('a', first)).status).toBe(201);
      const res = await post('b', second);
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body?.error?.code ?? res.body?.code).toBe('UNIQUE_VIOLATION');
      expect((await ctx.threeReads('a')).stored!.code).toBe(String(first));
    });
  }

  for (const [first, second] of [[true, 1], [false, 0]] as const) {
    it(`${JSON.stringify(first)}, then ${JSON.stringify(second)}: both land, as two strings (base refused the second on SQLite)`, async () => {
      expect((await post('a', first)).status).toBe(201);
      const res = await post('b', second);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect((await ctx.threeReads('a')).stored!.code).toBe(String(first));
      expect((await ctx.threeReads('b')).stored!.code).toBe(String(second));
    });
  }
});
