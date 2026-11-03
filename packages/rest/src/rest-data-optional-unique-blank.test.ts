// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #29176 — a cleared optional unique text field, through the REST write doors,
 * on a real engine (`ObjectQL` + sqlite `SqlDriver`) and the real `RestServer`
 * routes (the harness `rest-data-blank-typed-value.test.ts` boots).
 *
 * The defect, measured on `origin/main` dedc3505 with this file: the first
 * record cleared (or created with `''`) stored `''`, and the SECOND was
 * refused `409 UNIQUE_VIOLATION` by the driver's unique index — `''` is a
 * value to SQL `UNIQUE`, while `NULL` is distinct from every other `NULL`. The
 * engine's write door now stores such a blank as `null`, so the index exempts
 * it, on every door below.
 *
 * The PHYSICAL column is read with the driver's own query builder. Controls: a
 * column no unique constraint covers stores `''` (the spec's `str_empty`); a
 * real duplicate is still `409 UNIQUE_VIOLATION`; a required unique field's
 * `''` is still `400 VALIDATION_FAILED` / `required`, with or without a
 * `defaultValue`. Rows that ALREADY hold `''` are not migrated: they keep their
 * value, a new clear no longer collides with them, and the `$empty` operator
 * answers both.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJ = {
  name: 'uniq_rest', label: 'Unique', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const, required: true },
    sku: { name: 'sku', type: 'text' as const, label: 'SKU', unique: true },
    grp: { name: 'grp', type: 'text' as const },
    code: { name: 'code', type: 'text' as const },
    note: { name: 'note', type: 'text' as const },
  },
  indexes: [{ name: 'idx_uniq_rest_grp_code', fields: ['grp', 'code'], unique: 'global' as const }],
};
const REQ = {
  name: 'uniq_rest_req', label: 'Required unique', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    sku: { name: 'sku', type: 'text' as const, unique: true, required: true },
    skud: { name: 'skud', type: 'text' as const, unique: true, required: true, defaultValue: 'D-1' },
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
  engine.registry.registerObject(REQ as any);
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
  const knex = (driver as any).knex;
  /** The physical row, read past every engine read coercion. */
  const stored = async (object: string, id: string) =>
    (await knex(object).where({ id }).first()) as Record<string, unknown> | undefined;
  return { engine, call, stored, knex };
}

const create = (ctx: Awaited<ReturnType<typeof boot>>, body: Record<string, unknown>, object = 'uniq_rest') =>
  ctx.call('POST', '/api/v1/data/:object', { object }, body);
const patch = (ctx: Awaited<ReturnType<typeof boot>>, id: string, body: Record<string, unknown>) =>
  ctx.call('PATCH', '/api/v1/data/:object/:id', { object: 'uniq_rest', id }, body);

describe('REST write doors on SQLite: a cleared optional unique text field stores null (#29176)', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => { ctx = await boot(); });

  it('POST create with "" twice: both 201, both store NULL', async () => {
    const a = await create(ctx, { id: 'c1', name: 'r1', sku: '' });
    const b = await create(ctx, { id: 'c2', name: 'r2', sku: '' });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect((await ctx.stored('uniq_rest', 'c1'))?.sku).toBeNull();
    expect((await ctx.stored('uniq_rest', 'c2'))?.sku).toBeNull();
  });

  it('PATCH clearing the field on two records: both 200, both store NULL', async () => {
    expect((await create(ctx, { id: 'u1', name: 'r1', sku: 'S1' })).status).toBe(201);
    expect((await create(ctx, { id: 'u2', name: 'r2', sku: 'S2' })).status).toBe(201);
    const first = await patch(ctx, 'u1', { sku: '' });
    const second = await patch(ctx, 'u2', { sku: '' });
    expect([first.status, second.status]).toEqual([200, 200]);
    expect((await ctx.stored('uniq_rest', 'u1'))?.sku).toBeNull();
    expect((await ctx.stored('uniq_rest', 'u2'))?.sku).toBeNull();
  });

  it('a member of a declared unique index: two rows with the same group and a cleared code both land', async () => {
    const a = await create(ctx, { id: 'i1', name: 'r1', grp: 'g', code: '' });
    const b = await create(ctx, { id: 'i2', name: 'r2', grp: 'g', code: '' });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect((await ctx.stored('uniq_rest', 'i2'))?.code).toBeNull();
  });

  it('batch create and createMany: every row lands, every blank stores NULL', async () => {
    const bc = await ctx.call('POST', '/api/v1/data/:object/batch', { object: 'uniq_rest' }, {
      operation: 'create',
      records: [{ data: { id: 'b1', name: 'r1', sku: '' } }, { data: { id: 'b2', name: 'r2', sku: '' } }],
    });
    expect(bc.status).toBe(200);
    expect(bc.body.results.map((r: any) => r.success)).toEqual([true, true]);

    const cm = await ctx.call('POST', '/api/v1/data/:object/createMany', { object: 'uniq_rest' },
      [{ id: 'm1', name: 'r3', sku: '' }, { id: 'm2', name: 'r4', sku: '' }]);
    expect(cm.status).toBe(201);
    for (const id of ['b1', 'b2', 'm1', 'm2']) expect((await ctx.stored('uniq_rest', id))?.sku, id).toBeNull();
  });

  it('a column no unique constraint covers keeps "" — the str_empty side', async () => {
    expect((await create(ctx, { id: 'n1', name: 'r1', note: '' })).status).toBe(201);
    expect((await ctx.stored('uniq_rest', 'n1'))?.note).toBe('');
  });

  it('a real duplicate is still refused: 409 UNIQUE_VIOLATION, nothing stored', async () => {
    expect((await create(ctx, { id: 'd1', name: 'r1', sku: 'S1' })).status).toBe(201);
    const dup = await create(ctx, { id: 'd2', name: 'r2', sku: 'S1' });
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ code: 'UNIQUE_VIOLATION' });
    expect(await ctx.stored('uniq_rest', 'd2')).toBeUndefined();

    // And by PATCH: clearing is not a licence to copy another row's value.
    expect((await create(ctx, { id: 'd3', name: 'r3', sku: '' })).status).toBe(201);
    const copy = await patch(ctx, 'd3', { sku: 'S1' });
    expect(copy.status).toBe(409);
    expect(copy.body).toMatchObject({ code: 'UNIQUE_VIOLATION' });
    expect((await ctx.stored('uniq_rest', 'd3'))?.sku).toBeNull();
  });

  it('a required unique field refuses "": 400 VALIDATION_FAILED / required, with or without a defaultValue', async () => {
    const bare = await create(ctx, { id: 'q1', sku: '', skud: 'K1' }, 'uniq_rest_req');
    expect(bare.status).toBe(400);
    expect(bare.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(bare.body.fields.map((x: any) => [x.field, x.code])).toEqual([['sku', 'required']]);

    // `''` is a supplied value to `applyFieldDefaults`, so the default never
    // fills it: refused, exactly as before.
    const defaulted = await create(ctx, { id: 'q2', sku: 'S2', skud: '' }, 'uniq_rest_req');
    expect(defaulted.status).toBe(400);
    expect(defaulted.body.fields.map((x: any) => [x.field, x.code])).toEqual([['skud', 'required']]);
    expect(await ctx.stored('uniq_rest_req', 'q1')).toBeUndefined();
    expect(await ctx.stored('uniq_rest_req', 'q2')).toBeUndefined();
  });

  it('a row that already holds "" is not migrated, and a new clear no longer collides with it', async () => {
    // Written past the engine, as the before-state stored it.
    await ctx.knex('uniq_rest').insert({ id: 'legacy', name: 'old', sku: '' });
    const fresh = await create(ctx, { id: 'f1', name: 'new', sku: '' });
    expect(fresh.status).toBe(201);
    expect((await ctx.stored('uniq_rest', 'legacy'))?.sku).toBe('');
    expect((await ctx.stored('uniq_rest', 'f1'))?.sku).toBeNull();

    const ids = async (where: Record<string, unknown>) =>
      ((await ctx.engine.find('uniq_rest', { where, fields: ['id'] })) as Array<{ id: string }>).map((r) => r.id).sort();
    // `= ''` answers the stored `''` only; `$null` the new NULL only; the
    // ruled `$empty` (text-like: null or '') answers both, as it did before.
    expect(await ids({ sku: '' })).toEqual(['legacy']);
    expect(await ids({ sku: { $null: true } })).toEqual(['f1']);
    expect(await ids({ sku: { $empty: true } })).toEqual(['f1', 'legacy']);
  });
});
