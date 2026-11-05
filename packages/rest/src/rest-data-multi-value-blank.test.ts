// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #29343 — a cleared optional multi-value field, through the REST write doors,
 * on a real engine (`ObjectQL` + sqlite `SqlDriver`) and the real `RestServer`
 * routes (the harness `rest-data-single-value-blank.test.ts` boots).
 *
 * The defect, measured on `origin/main` 322cf906: a multi-value column
 * (`multiselect`, `checkboxes`, `tags`, or a multi-capable type with
 * `multiple: true`) written `[]` stored the JSON text `[]`. On a unique column
 * the second record cleared was refused `409 UNIQUE_VIOLATION` (SQL `UNIQUE`
 * reads `'[]'` as a value and `NULL` as distinct from every `NULL`); a
 * multi-value field written `''` stored the JSON text `'""'` and collided the
 * same way.
 * Maintainer ruling B on #29346 (record 6579813296), execution step 2: this
 * card follows the `$empty` table's `multi_value` row for `[]` the way the
 * #29277 arm follows its `null_only` row for `''` — the write door stores an
 * empty list (or exactly `''`, never a member) as `null` on every OPTIONAL
 * column the table puts on that row.
 *
 * The PHYSICAL column is read with the driver's own query builder. Pinned
 * beside it: the `$empty` table answers as before (a row that already holds
 * `[]` is still empty, and so is `null`), `required` still refuses `[]`, a
 * blank on insert takes a declared `defaultValue`, a non-empty list is
 * untouched, and a real duplicate is still `409`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OPTS = [{ value: 'gold', label: 'Gold' }, { value: 'silver', label: 'Silver' }];
const TARGET = {
  name: 'mvb_target', label: 'Target', systemFields: false,
  fields: { id: { name: 'id', type: 'text' as const, primaryKey: true }, name: { name: 'name', type: 'text' as const } },
};
// One optional column per multi_value-row shape, and a unique twin of each
// shape the card names (multiselect, a multi-value lookup), plus a unique-index
// member.
const OBJ = {
  name: 'mvb_obj', label: 'Multi value blank', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    c_multiselect: { name: 'c_multiselect', type: 'multiselect' as const, options: OPTS },
    c_checkboxes: { name: 'c_checkboxes', type: 'checkboxes' as const, options: OPTS },
    c_tags: { name: 'c_tags', type: 'tags' as const },
    c_select_multi: { name: 'c_select_multi', type: 'select' as const, options: OPTS, multiple: true },
    c_lookup_multi: { name: 'c_lookup_multi', type: 'lookup' as const, reference: 'mvb_target', multiple: true },
    c_image_multi: { name: 'c_image_multi', type: 'image' as const, multiple: true },
    u_multiselect: { name: 'u_multiselect', type: 'multiselect' as const, options: OPTS, unique: true },
    u_lookup_multi: { name: 'u_lookup_multi', type: 'lookup' as const, reference: 'mvb_target', multiple: true, unique: true },
    u_tags: { name: 'u_tags', type: 'tags' as const, unique: true },
    grp: { name: 'grp', type: 'text' as const },
    i_tags: { name: 'i_tags', type: 'tags' as const },
  },
  indexes: [{ name: 'idx_mvb_obj_grp_tags', fields: ['grp', 'i_tags'], unique: 'global' as const }],
};
const PER_TYPE = [
  'c_multiselect', 'c_checkboxes', 'c_tags', 'c_select_multi', 'c_lookup_multi', 'c_image_multi',
] as const;
const REQ = {
  name: 'mvb_req', label: 'Required', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    r_multiselect: { name: 'r_multiselect', type: 'multiselect' as const, options: OPTS, required: true },
    r_tags: { name: 'r_tags', type: 'tags' as const, required: true, defaultValue: ['x'] },
  },
};
const DEF = {
  name: 'mvb_def', label: 'Defaults', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    d_multiselect: { name: 'd_multiselect', type: 'multiselect' as const, options: OPTS, defaultValue: ['silver'] },
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
  await engine.insert('mvb_target', { id: 't1', name: 'T1' });
  await engine.insert('mvb_target', { id: 't2', name: 'T2' });
  return { engine, call, stored, knex };
}

type Ctx = Awaited<ReturnType<typeof boot>>;
const create = (ctx: Ctx, body: Record<string, unknown>, object = 'mvb_obj') =>
  ctx.call('POST', '/api/v1/data/:object', { object }, body);
const patch = (ctx: Ctx, id: string, body: Record<string, unknown>) =>
  ctx.call('PATCH', '/api/v1/data/:object/:id', { object: 'mvb_obj', id }, body);
const allEmpty = Object.fromEntries(PER_TYPE.map((f) => [f, []]));

describe('REST write doors on SQLite: a cleared optional multi-value field stores null (#29343)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await boot(); });

  it('POST create with [] on every multi_value shape: 201, every column stores NULL', async () => {
    const res = await create(ctx, { id: 'p1', name: 'r1', ...allEmpty });
    expect(res.status).toBe(201);
    const row = await ctx.stored('mvb_obj', 'p1');
    for (const f of PER_TYPE) expect(row?.[f], f).toBeNull();
  });

  it('PATCH clearing every multi_value shape: 200, every column stores NULL', async () => {
    const set = {
      c_multiselect: ['gold'], c_checkboxes: ['gold'], c_tags: ['a'],
      c_select_multi: ['gold'], c_lookup_multi: ['t1'], c_image_multi: ['img_1'],
    };
    expect((await create(ctx, { id: 'e1', name: 'r1', ...set })).status).toBe(201);
    const res = await patch(ctx, 'e1', allEmpty);
    expect(res.status).toBe(200);
    const row = await ctx.stored('mvb_obj', 'e1');
    for (const f of PER_TYPE) expect(row?.[f], f).toBeNull();
  });

  for (const f of ['u_multiselect', 'u_lookup_multi', 'u_tags'] as const) {
    for (const blank of [[], ''] as const) {
      it(`unique ${f}: two records created with ${JSON.stringify(blank)} both land (no 409)`, async () => {
        const a = await create(ctx, { id: 'u1', name: 'r1', [f]: blank });
        const b = await create(ctx, { id: 'u2', name: 'r2', [f]: blank });
        expect([a.status, b.status]).toEqual([201, 201]);
        for (const id of ['u1', 'u2']) expect((await ctx.stored('mvb_obj', id))?.[f], id).toBeNull();
      });
    }
  }

  it('unique multiselect and multi-value lookup: clearing two records by PATCH both land', async () => {
    expect((await create(ctx, { id: 'w1', name: 'r1', u_multiselect: ['gold'], u_lookup_multi: ['t1'] })).status).toBe(201);
    expect((await create(ctx, { id: 'w2', name: 'r2', u_multiselect: ['silver'], u_lookup_multi: ['t2'] })).status).toBe(201);
    const first = await patch(ctx, 'w1', { u_multiselect: [], u_lookup_multi: [] });
    const second = await patch(ctx, 'w2', { u_multiselect: [], u_lookup_multi: [] });
    expect([first.status, second.status]).toEqual([200, 200]);
    for (const id of ['w1', 'w2']) {
      const row = await ctx.stored('mvb_obj', id);
      expect([row?.u_multiselect, row?.u_lookup_multi], id).toEqual([null, null]);
    }
  });

  it('a member of a declared unique index: same group, cleared tags, both land', async () => {
    const a = await create(ctx, { id: 'i1', name: 'r1', grp: 'g', i_tags: [] });
    const b = await create(ctx, { id: 'i2', name: 'r2', grp: 'g', i_tags: [] });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect((await ctx.stored('mvb_obj', 'i2'))?.i_tags).toBeNull();
  });

  it('batch create and createMany: every row lands, every [] stores NULL', async () => {
    const bc = await ctx.call('POST', '/api/v1/data/:object/batch', { object: 'mvb_obj' }, {
      operation: 'create',
      records: [{ data: { id: 'b1', name: 'r1', u_multiselect: [] } }, { data: { id: 'b2', name: 'r2', u_multiselect: [] } }],
    });
    expect(bc.status).toBe(200);
    expect(bc.body.results.map((r: any) => r.success)).toEqual([true, true]);
    const cm = await ctx.call('POST', '/api/v1/data/:object/createMany', { object: 'mvb_obj' },
      [{ id: 'm1', name: 'r3', u_lookup_multi: [] }, { id: 'm2', name: 'r4', u_lookup_multi: [] }]);
    expect(cm.status).toBe(201);
    for (const id of ['b1', 'b2']) expect((await ctx.stored('mvb_obj', id))?.u_multiselect, id).toBeNull();
    for (const id of ['m1', 'm2']) expect((await ctx.stored('mvb_obj', id))?.u_lookup_multi, id).toBeNull();
  });

  it('a non-empty list is untouched, and a real duplicate is still refused: 409 UNIQUE_VIOLATION', async () => {
    expect((await create(ctx, { id: 'd1', name: 'r1', u_multiselect: ['gold'] })).status).toBe(201);
    expect((await ctx.stored('mvb_obj', 'd1'))?.u_multiselect).not.toBeNull();
    const dup = await create(ctx, { id: 'd2', name: 'r2', u_multiselect: ['gold'] });
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ code: 'UNIQUE_VIOLATION' });
    expect(await ctx.stored('mvb_obj', 'd2')).toBeUndefined();
  });

  it('a required multi-value field refuses []: 400 VALIDATION_FAILED / required, with or without a defaultValue', async () => {
    const res = await create(ctx, { id: 'q1', r_multiselect: [], r_tags: [] }, 'mvb_req');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(res.body.fields.map((x: any) => [x.field, x.code]).sort()).toEqual([['r_multiselect', 'required'], ['r_tags', 'required']]);
    expect(await ctx.stored('mvb_req', 'q1')).toBeUndefined();
  });

  it('[] on insert takes a declared defaultValue, exactly as null does', async () => {
    expect((await create(ctx, { id: 'f1', d_multiselect: [] }, 'mvb_def')).status).toBe(201);
    expect((await create(ctx, { id: 'f2', d_multiselect: null }, 'mvb_def')).status).toBe(201);
    const a = await ctx.engine.findOne('mvb_def', { where: { id: 'f1' } }) as Record<string, unknown>;
    const b = await ctx.engine.findOne('mvb_def', { where: { id: 'f2' } }) as Record<string, unknown>;
    expect(a.d_multiselect).toEqual(['silver']);
    expect(b.d_multiselect).toEqual(['silver']);
  });

  it('the $empty table answers as before: a stored [] and a NULL are both empty', async () => {
    // Written past the engine, as the before-state stored it.
    await ctx.knex('mvb_obj').insert({ id: 'legacy', name: 'old', c_multiselect: '[]', c_lookup_multi: '[]' });
    expect((await create(ctx, { id: 'cleared', name: 'new', c_multiselect: [], c_lookup_multi: [] })).status).toBe(201);
    expect((await create(ctx, { id: 'held', name: 'v', c_multiselect: ['gold'], c_lookup_multi: ['t1'] })).status).toBe(201);
    expect((await ctx.stored('mvb_obj', 'legacy'))?.c_multiselect).toBe('[]');

    const ids = async (where: Record<string, unknown>) =>
      ((await ctx.engine.find('mvb_obj', { where, fields: ['id'] })) as Array<{ id: string }>).map((r) => r.id).sort();
    for (const f of ['c_multiselect', 'c_lookup_multi']) {
      expect(await ids({ [f]: { $empty: true } }), f).toEqual(['cleared', 'legacy']);
      expect(await ids({ [f]: { $empty: false } }), f).toEqual(['held']);
    }
  });
});
