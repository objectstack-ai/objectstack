// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29562] A number or a boolean sent to an option-family field, through the
 * REST write doors, on a real engine (`ObjectQL` + sqlite `SqlDriver`) and the
 * real `RestServer` routes (the harness `rest-data-text-scalar-value.test.ts`
 * boots).
 *
 * The record validator's option arms judge such a value by its string reading
 * (`3` as `'3'`, `true` as `'true'`, per element on a multi-value field), and
 * the write door now stores that string. The PHYSICAL column is read with the
 * driver's own query builder, past every engine read coercion. Base
 * (`origin/main` @ `d3175d59`) stored `3` on a select as the TEXT `'3.0'` and
 * `true` as `'1.0'`, and `[3]` on a multiselect as the JSON `[3]`.
 *
 * The unique key compares what is stored, so the accept set of a `unique`
 * option field moves (Clause-② yes, narrowing), measured on base and on this
 * change, SQLite here and driver-memory beside it:
 *
 *   sequence on a unique select   base (SQLite)   base (memory)   head (both)
 *   3, then '3'                   201, 201        201, 201        201, 409
 *   true, then 'true'             201, 201        201, 201        201, 409
 *   true, then 1                  201, 409        201, 201        201, 201
 *
 * The first two rows are the narrowing; the third is SQLite's widening (base
 * stored `true` and `1` both as `'1.0'`), the same pair #29241 moved on text.
 *
 * Filter face, recorded and NOT changed here (the number comparand on a
 * string-stored field waits on #29486's decision): see the last block.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJ = {
  name: 'option_rest', label: 'Option', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    stage: { name: 'stage', type: 'select' as const },
    score: { name: 'score', type: 'select' as const, options: [{ label: 'Three', value: '3' }, { label: 'A', value: 'a' }] },
    mood: { name: 'mood', type: 'radio' as const },
    picks: { name: 'picks', type: 'select' as const, multiple: true },
    labels: { name: 'labels', type: 'multiselect' as const },
    boxes: { name: 'boxes', type: 'checkboxes' as const },
    tags: { name: 'tags', type: 'tags' as const },
    code: { name: 'code', type: 'select' as const, unique: true },
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
    (await (driver as any).knex('option_rest').where({ id }).first()) as Record<string, unknown> | undefined;
  /** The engine's read of one id. */
  const read = async (id: string) => (await engine.findOne('option_rest', { where: { id } })) as Record<string, unknown> | null;
  return { engine, call, stored, read };
}

describe('REST write doors on SQLite: a number or boolean on an option field is stored as its string (#29562)', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => { ctx = await boot(); });

  it('POST create: single-value select, radio and a declared code', async () => {
    const res = await ctx.call('POST', '/api/v1/data/:object', { object: 'option_rest' }, { id: 'c1', stage: 3, mood: true, score: 3 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    for (const row of [await ctx.stored('c1'), await ctx.read('c1')]) {
      expect(row).toEqual(expect.objectContaining({ stage: '3', mood: 'true', score: '3' }));
    }
  });

  it('POST create: each number or boolean element of a multi-value option field, and a lone scalar', async () => {
    const res = await ctx.call('POST', '/api/v1/data/:object', { object: 'option_rest' },
      { id: 'c2', picks: [1, 'x'], labels: [3, true], boxes: [false], tags: 7 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const physical = await ctx.stored('c2');
    expect(JSON.parse(String(physical!.picks))).toEqual(['1', 'x']);
    expect(JSON.parse(String(physical!.labels))).toEqual(['3', 'true']);
    expect(JSON.parse(String(physical!.boxes))).toEqual(['false']);
    expect(JSON.parse(String(physical!.tags))).toEqual(['7']);
    expect(await ctx.read('c2')).toEqual(expect.objectContaining({ picks: ['1', 'x'], labels: ['3', 'true'], boxes: ['false'], tags: ['7'] }));
  });

  it('PATCH update: false and 0 are stored as "false" and "0"', async () => {
    await ctx.engine.insert('option_rest', { id: 'u1', stage: 'orig', labels: ['orig'] });
    const res = await ctx.call('PATCH', '/api/v1/data/:object/:id', { object: 'option_rest', id: 'u1' }, { stage: false, labels: [0] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const physical = await ctx.stored('u1');
    expect(physical!.stage).toBe('false');
    expect(JSON.parse(String(physical!.labels))).toEqual(['0']);
  });

  it('membership is judged on the string: a number with no matching code is refused 400 invalid_option, nothing written', async () => {
    const res = await ctx.call('POST', '/api/v1/data/:object', { object: 'option_rest' }, { id: 'r1', score: 4 });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body?.error?.code ?? res.body?.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(res.body)).toContain('invalid_option');
    expect(await ctx.stored('r1')).toBeUndefined();
  });

  it('control: a string and an array of strings are stored as sent', async () => {
    const res = await ctx.call('POST', '/api/v1/data/:object', { object: 'option_rest' }, { id: 's1', stage: '3', labels: ['3'] });
    expect(res.status).toBe(201);
    const physical = await ctx.stored('s1');
    expect(physical!.stage).toBe('3');
    expect(JSON.parse(String(physical!.labels))).toEqual(['3']);
  });
});

describe('a unique select compares the stored string (#29562, Clause-② narrowing)', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => { ctx = await boot(); });

  const post = (id: string, code: unknown) =>
    ctx.call('POST', '/api/v1/data/:object', { object: 'option_rest' }, { id, code });

  for (const [first, second] of [[3, '3'], ['3', 3], [true, 'true']] as const) {
    it(`${JSON.stringify(first)}, then ${JSON.stringify(second)}: the second is refused 409 (base stored both)`, async () => {
      expect((await post('a', first)).status).toBe(201);
      const res = await post('b', second);
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(await ctx.stored('b')).toBeUndefined();
      expect((await ctx.stored('a'))!.code).toBe(String(first));
    });
  }

  it('true, then 1: both land, as two strings (base refused the second on SQLite)', async () => {
    expect((await post('a', true)).status).toBe(201);
    const res = await post('b', 1);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await ctx.stored('a'))!.code).toBe('true');
    expect((await ctx.stored('b'))!.code).toBe('1');
  });
});

/**
 * The filter face, RECORDED, not changed: the number comparand on a
 * string-stored field is #29486's decision box. This pins today's answer so a
 * change there is seen here; it is not this card's contract.
 */
describe('filter face on SQLite: a number comparand against a select written 3 (#29486 decides, recorded only)', () => {
  it('{ stage: 3 } and { stage: "3" } against a row written 3 and a row written "3"', async () => {
    const ctx = await boot();
    await ctx.engine.insert('option_rest', { id: 'n', stage: 3 });
    await ctx.engine.insert('option_rest', { id: 's', stage: '3' });
    const ids = async (where: Record<string, unknown>) =>
      ((await ctx.engine.find('option_rest', { where })) as Array<{ id: string }>).map((r) => r.id).sort();
    expect(await ids({ stage: '3' })).toEqual(['n', 's']);
    // Both rows now hold the string "3", and the number comparand matches
    // neither (driver-memory answers the same). Base matched the row written
    // 3 (stored "3.0") and not the row written "3".
    expect(await ids({ stage: 3 })).toEqual([]);
  });
});
