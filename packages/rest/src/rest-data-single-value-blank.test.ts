// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #29277 — a cleared optional single-value option or reference field, through
 * the REST write doors, on a real engine (`ObjectQL` + sqlite `SqlDriver`) and
 * the real `RestServer` routes (the harness `rest-data-optional-unique-blank.test.ts`
 * boots).
 *
 * The defect, measured on `origin/main` 5780fa49: a `select` or `lookup`
 * written `''` stored `''`. On a unique column the second record cleared was
 * refused `409 UNIQUE_VIOLATION` (SQL `UNIQUE` reads `''` as a value and
 * `NULL` as distinct from every `NULL`), and on every column the clear was not
 * empty to `$empty`, whose ruled table reads only `null` as empty on these
 * types. Maintainer ruling B on #29346 (record 6579813296): the write door
 * stores `''` as `null` on every optional column the table puts on its
 * `null_only` row whose value is one string — `select`, `radio`, `lookup`,
 * `master_detail`, `user`, `tree`, and the file references `image`, `file`,
 * `avatar`, `video`, `audio` today (an opaque file id; SQL stores it
 * JSON-encoded, and a cleared one collided the same way).
 *
 * The PHYSICAL column is read with the driver's own query builder. Pinned
 * beside it: the `$empty` table is unchanged (a row that already holds `''`
 * still answers as a value), `required` still refuses `''`, a blank on insert
 * takes a declared `defaultValue`, and a real duplicate is still `409`.
 * (Whitespace stays a value: the unit half pins it; on a reference column the
 * referential-integrity check refuses it, before and after.)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OPTS = [{ value: 'gold', label: 'Gold' }, { value: 'silver', label: 'Silver' }];
const TARGET = {
  name: 'svb_target', label: 'Target', systemFields: false,
  fields: { id: { name: 'id', type: 'text' as const, primaryKey: true }, name: { name: 'name', type: 'text' as const } },
};
// One optional column per ruled type, plus a unique `select` and `lookup` (the
// 409 the card names) and a unique-index member.
const OBJ = {
  name: 'svb_obj', label: 'Single value blank', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    c_select: { name: 'c_select', type: 'select' as const, options: OPTS },
    c_radio: { name: 'c_radio', type: 'radio' as const, options: OPTS },
    c_lookup: { name: 'c_lookup', type: 'lookup' as const, reference: 'svb_target' },
    c_master: { name: 'c_master', type: 'master_detail' as const, reference: 'svb_target' },
    c_user: { name: 'c_user', type: 'user' as const },
    c_tree: { name: 'c_tree', type: 'tree' as const },
    c_image: { name: 'c_image', type: 'image' as const },
    c_file: { name: 'c_file', type: 'file' as const },
    c_avatar: { name: 'c_avatar', type: 'avatar' as const },
    c_video: { name: 'c_video', type: 'video' as const },
    c_audio: { name: 'c_audio', type: 'audio' as const },
    u_image: { name: 'u_image', type: 'image' as const, unique: true },
    u_select: { name: 'u_select', type: 'select' as const, options: OPTS, unique: true },
    u_lookup: { name: 'u_lookup', type: 'lookup' as const, reference: 'svb_target', unique: true },
    grp: { name: 'grp', type: 'text' as const },
    i_lookup: { name: 'i_lookup', type: 'lookup' as const, reference: 'svb_target' },
  },
  indexes: [{ name: 'idx_svb_obj_grp_lookup', fields: ['grp', 'i_lookup'], unique: 'global' as const }],
};
const PER_TYPE = [
  'c_select', 'c_radio', 'c_lookup', 'c_master', 'c_user', 'c_tree',
  'c_image', 'c_file', 'c_avatar', 'c_video', 'c_audio',
] as const;
const REQ = {
  name: 'svb_req', label: 'Required', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    r_select: { name: 'r_select', type: 'select' as const, options: OPTS, required: true },
    r_lookup: { name: 'r_lookup', type: 'lookup' as const, reference: 'svb_target', required: true, defaultValue: 't1' },
  },
};
const DEF = {
  name: 'svb_def', label: 'Defaults', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    d_select: { name: 'd_select', type: 'select' as const, options: OPTS, defaultValue: 'silver' },
    d_lookup: { name: 'd_lookup', type: 'lookup' as const, reference: 'svb_target', defaultValue: 't1' },
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
  for (const o of [TARGET, OBJ, REQ, DEF]) engine.registry.registerObject(o as any);
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
  await engine.insert('svb_target', { id: 't1', name: 'T1' });
  return { engine, call, stored, knex };
}

type Ctx = Awaited<ReturnType<typeof boot>>;
const create = (ctx: Ctx, body: Record<string, unknown>, object = 'svb_obj') =>
  ctx.call('POST', '/api/v1/data/:object', { object }, body);
const patch = (ctx: Ctx, id: string, body: Record<string, unknown>) =>
  ctx.call('PATCH', '/api/v1/data/:object/:id', { object: 'svb_obj', id }, body);
const allBlank = Object.fromEntries(PER_TYPE.map((f) => [f, '']));

describe('REST write doors on SQLite: a cleared optional single-value option / reference field stores null (#29277)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await boot(); });

  it('POST create with "" on every joined type: 201, every column stores NULL', async () => {
    const res = await create(ctx, { id: 'p1', name: 'r1', ...allBlank });
    expect(res.status).toBe(201);
    const row = await ctx.stored('svb_obj', 'p1');
    for (const f of PER_TYPE) expect(row?.[f], f).toBeNull();
  });

  it('PATCH clearing every joined type: 200, every column stores NULL', async () => {
    // `c_user` is left unset: no `sys_user` is registered here to resolve an id.
    expect((await create(ctx, { id: 'e0', name: 'parent' })).status).toBe(201);
    const set = {
      c_select: 'gold', c_radio: 'gold', c_lookup: 't1', c_master: 't1', c_tree: 'e0',
      c_image: 'img_1', c_file: 'fil_1', c_avatar: 'ava_1', c_video: 'vid_1', c_audio: 'aud_1',
    };
    expect((await create(ctx, { id: 'e1', name: 'r1', ...set })).status).toBe(201);
    const res = await patch(ctx, 'e1', allBlank);
    expect(res.status).toBe(200);
    const row = await ctx.stored('svb_obj', 'e1');
    for (const f of PER_TYPE) expect(row?.[f], f).toBeNull();
  });

  it('unique select and unique lookup: two records created with "" both land (no 409)', async () => {
    const a = await create(ctx, { id: 'u1', name: 'r1', u_select: '', u_lookup: '' });
    const b = await create(ctx, { id: 'u2', name: 'r2', u_select: '', u_lookup: '' });
    expect([a.status, b.status]).toEqual([201, 201]);
    for (const id of ['u1', 'u2']) {
      const row = await ctx.stored('svb_obj', id);
      expect([row?.u_select, row?.u_lookup], id).toEqual([null, null]);
    }
  });

  it('unique select and unique lookup: clearing two records by PATCH both land', async () => {
    await ctx.engine.insert('svb_target', { id: 't2', name: 'T2' });
    expect((await create(ctx, { id: 'w1', name: 'r1', u_select: 'gold', u_lookup: 't1' })).status).toBe(201);
    expect((await create(ctx, { id: 'w2', name: 'r2', u_select: 'silver', u_lookup: 't2' })).status).toBe(201);
    const first = await patch(ctx, 'w1', { u_select: '', u_lookup: '' });
    const second = await patch(ctx, 'w2', { u_select: '', u_lookup: '' });
    expect([first.status, second.status]).toEqual([200, 200]);
    for (const id of ['w1', 'w2']) expect((await ctx.stored('svb_obj', id))?.u_lookup, id).toBeNull();
  });

  it('unique image: two records created with "" both land (no 409)', async () => {
    const a = await create(ctx, { id: 'g1', name: 'r1', u_image: '' });
    const b = await create(ctx, { id: 'g2', name: 'r2', u_image: '' });
    expect([a.status, b.status]).toEqual([201, 201]);
    for (const id of ['g1', 'g2']) expect((await ctx.stored('svb_obj', id))?.u_image, id).toBeNull();
  });

  it('a member of a declared unique index: same group, cleared lookup, both land', async () => {
    const a = await create(ctx, { id: 'i1', name: 'r1', grp: 'g', i_lookup: '' });
    const b = await create(ctx, { id: 'i2', name: 'r2', grp: 'g', i_lookup: '' });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect((await ctx.stored('svb_obj', 'i2'))?.i_lookup).toBeNull();
  });

  it('batch create and createMany: every row lands, every blank stores NULL', async () => {
    const bc = await ctx.call('POST', '/api/v1/data/:object/batch', { object: 'svb_obj' }, {
      operation: 'create',
      records: [{ data: { id: 'b1', name: 'r1', u_select: '' } }, { data: { id: 'b2', name: 'r2', u_select: '' } }],
    });
    expect(bc.status).toBe(200);
    expect(bc.body.results.map((r: any) => r.success)).toEqual([true, true]);
    const cm = await ctx.call('POST', '/api/v1/data/:object/createMany', { object: 'svb_obj' },
      [{ id: 'm1', name: 'r3', u_lookup: '' }, { id: 'm2', name: 'r4', u_lookup: '' }]);
    expect(cm.status).toBe(201);
    for (const id of ['b1', 'b2']) expect((await ctx.stored('svb_obj', id))?.u_select, id).toBeNull();
    for (const id of ['m1', 'm2']) expect((await ctx.stored('svb_obj', id))?.u_lookup, id).toBeNull();
  });

  it('a real duplicate is still refused: 409 UNIQUE_VIOLATION', async () => {
    expect((await create(ctx, { id: 'd1', name: 'r1', u_lookup: 't1' })).status).toBe(201);
    const dup = await create(ctx, { id: 'd2', name: 'r2', u_lookup: 't1' });
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ code: 'UNIQUE_VIOLATION' });
    expect(await ctx.stored('svb_obj', 'd2')).toBeUndefined();
  });

  it('a required select / lookup refuses "": 400 VALIDATION_FAILED / required, with or without a defaultValue', async () => {
    const res = await create(ctx, { id: 'q1', r_select: '', r_lookup: '' }, 'svb_req');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(res.body.fields.map((x: any) => [x.field, x.code]).sort()).toEqual([['r_lookup', 'required'], ['r_select', 'required']]);
    expect(await ctx.stored('svb_req', 'q1')).toBeUndefined();
  });

  it('a blank on insert takes a declared defaultValue, exactly as null does', async () => {
    expect((await create(ctx, { id: 'f1', d_select: '', d_lookup: '' }, 'svb_def')).status).toBe(201);
    expect((await create(ctx, { id: 'f2', d_select: null, d_lookup: null }, 'svb_def')).status).toBe(201);
    for (const id of ['f1', 'f2']) {
      const row = await ctx.stored('svb_def', id);
      expect([row?.d_select, row?.d_lookup], id).toEqual(['silver', 't1']);
    }
  });

  it('the $empty table is unchanged: null is empty, a stored "" is still a value on these types', async () => {
    // Written past the engine, as the before-state stored it.
    await ctx.knex('svb_obj').insert({ id: 'legacy', name: 'old', c_select: '', c_lookup: '' });
    expect((await create(ctx, { id: 'cleared', name: 'new', c_select: '', c_lookup: '' })).status).toBe(201);
    expect((await create(ctx, { id: 'held', name: 'v', c_select: 'gold', c_lookup: 't1' })).status).toBe(201);
    expect((await ctx.stored('svb_obj', 'legacy'))?.c_select).toBe('');

    const ids = async (where: Record<string, unknown>) =>
      ((await ctx.engine.find('svb_obj', { where, fields: ['id'] })) as Array<{ id: string }>).map((r) => r.id).sort();
    for (const f of ['c_select', 'c_lookup']) {
      expect(await ids({ [f]: { $empty: true } }), f).toEqual(['cleared']);
      expect(await ids({ [f]: { $empty: false } }), f).toEqual(['held', 'legacy']);
      expect(await ids({ [f]: '' }), f).toEqual(['legacy']);
    }
  });
});
