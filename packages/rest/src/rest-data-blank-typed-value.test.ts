// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20308 — a cleared number, date or boolean, through the REST write doors, on
 * a real engine (`ObjectQL` + sqlite `SqlDriver`) and the real `RestServer`
 * routes (the harness `rest-data-create-address-unknown-key.test.ts` boots).
 *
 * The PHYSICAL column is read with the driver's own query builder, beside the
 * engine's `findOne`, because the two disagreed on the before-state: measured on
 * `origin/main` de091b50e6, SQLite stored `''` in every non-string-typed column
 * on every door below, and the engine's boolean read coercion then answered a
 * stored `''` as `false` — a clear read back as a value. PostgreSQL refused the
 * same bodies (`500 DATABASE_ERROR`; `failed` rows with `INTERNAL_ERROR` on the
 * batch doors). The door now stores the typed blank, `null`, on every door.
 *
 * Controls: a text / lookup / select `''` is stored as `''` (the spec's
 * `str_empty` — an empty string must not become null); a valid value on every
 * typed column is stored unchanged; a required field's blank is refused as
 * `400 VALIDATION_FAILED` / `required`; and a non-numeric string on `progress`
 * is refused as `invalid_number`.
 *
 * `summary` is exempt from that type check (seat ruling on #20308: it is in the
 * spec's `COMPUTED_VALUE_TYPES`, "never client-written; shape is
 * producer-owned"), so a roll-up `max` over a temporal child field recomputes
 * as it did at base: the child write succeeds and the recompute lands. Measured
 * on this change before the exemption, that child write failed with
 * `ERR_SUMMARY_RECOMPUTE` on memory and SQLite.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NON_TEXT_STORED_VALUE_TYPES } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const TYPED = [...NON_TEXT_STORED_VALUE_TYPES];
const f = (t: string) => `f_${t}`;

const REF = {
  name: 'blank_ref', label: 'Ref', systemFields: false,
  fields: { id: { name: 'id', type: 'text' as const, primaryKey: true } },
};
const OBJ = {
  name: 'blank_rest', label: 'Blank', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    c_text: { name: 'c_text', type: 'text' as const },
    c_lookup: { name: 'c_lookup', type: 'lookup' as const, reference: 'blank_ref' },
    c_select: { name: 'c_select', type: 'select' as const, options: [{ value: 'a', label: 'A' }] },
    ...Object.fromEntries(TYPED.map((t) => [f(t), { name: f(t), type: t }])),
  },
};
const REQ = {
  name: 'blank_rest_req', label: 'Required', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    amount: { name: 'amount', type: 'number' as const, required: true },
  },
};

// A roll-up whose value is not a number: `max` over a temporal child field.
const PARENT = {
  name: 'blank_rollup_parent', label: 'Parent', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    latest_due: {
      name: 'latest_due', type: 'summary' as const,
      summaryOperations: { object: 'blank_rollup_child', field: 'due', function: 'max' as const, relationshipField: 'parent' },
    },
  },
};
const CHILD = {
  name: 'blank_rollup_child', label: 'Child', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    parent: { name: 'parent', type: 'lookup' as const, reference: 'blank_rollup_parent' },
    due: { name: 'due', type: 'date' as const },
  },
};

const VALID: Record<string, unknown> = {
  f_number: 42, f_currency: 9.5, f_percent: 0.25, f_rating: 3, f_slider: 10, f_progress: 50, f_summary: 7,
  f_boolean: true, f_toggle: false, f_date: '2026-09-27', f_datetime: '2026-09-27T10:00:00.000Z', f_time: '14:30:00',
};
const blankTyped = () => Object.fromEntries(TYPED.map((t) => [f(t), '']));
const STR_BLANK = { c_text: '', c_lookup: '', c_select: '' };

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
  engine.registry.registerObject(REF as any);
  engine.registry.registerObject(OBJ as any);
  engine.registry.registerObject(REQ as any);
  engine.registry.registerObject(PARENT as any);
  engine.registry.registerObject(CHILD as any);
  await engine.syncSchemas();
  await engine.insert('blank_ref', { id: 'ref1' });

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
  const stored = async (object: string, id: string) =>
    (await (driver as any).knex(object).where({ id }).first()) as Record<string, unknown> | undefined;
  return { engine, call, stored };
}

function expectTypedNull(row: Record<string, unknown> | undefined | null, where: string) {
  expect(row, where).toBeTruthy();
  for (const t of TYPED) expect(row![f(t)], `${where} · ${t}`).toBeNull();
}

describe('REST write doors on SQLite: a cleared typed column stores null (#20308)', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => { ctx = await boot(); });

  const seed = (id: string) => ctx.engine.insert('blank_rest', { id, ...VALID });

  it('POST create: the typed blanks store null; the string-stored blanks store ""', async () => {
    const res = await ctx.call('POST', '/api/v1/data/:object', { object: 'blank_rest' }, { id: 'c1', ...blankTyped(), ...STR_BLANK });
    expect(res.status).toBe(201);
    const raw = await ctx.stored('blank_rest', 'c1');
    expectTypedNull(raw, 'stored');
    expect([raw!.c_text, raw!.c_lookup, raw!.c_select]).toEqual(['', '', '']);
    const read = await ctx.engine.findOne('blank_rest', { where: { id: 'c1' } });
    expectTypedNull(read as any, 'read');
    // The before-state's worst cell: a stored '' on a boolean read back as `false`.
    expect((read as any).f_boolean).toBeNull();
  });

  it('PATCH update: a cleared typed column stores null', async () => {
    await seed('u1');
    const res = await ctx.call('PATCH', '/api/v1/data/:object/:id', { object: 'blank_rest', id: 'u1' }, blankTyped());
    expect(res.status).toBe(200);
    expectTypedNull(await ctx.stored('blank_rest', 'u1'), 'stored');
  });

  it('batch create and update, createMany and updateMany', async () => {
    const bc = await ctx.call('POST', '/api/v1/data/:object/batch', { object: 'blank_rest' },
      { operation: 'create', records: [{ data: { id: 'b1', ...blankTyped() } }] });
    expect(bc.status).toBe(200);
    expect(bc.body.results.map((r: any) => r.success)).toEqual([true]);
    expectTypedNull(await ctx.stored('blank_rest', 'b1'), 'batch create');

    await seed('b2');
    const bu = await ctx.call('POST', '/api/v1/data/:object/batch', { object: 'blank_rest' },
      { operation: 'update', records: [{ id: 'b2', data: blankTyped() }] });
    expect(bu.body.results.map((r: any) => r.success)).toEqual([true]);
    expectTypedNull(await ctx.stored('blank_rest', 'b2'), 'batch update');

    const cm = await ctx.call('POST', '/api/v1/data/:object/createMany', { object: 'blank_rest' }, [{ id: 'm1', ...blankTyped() }]);
    expect(cm.status).toBe(201);
    expectTypedNull(await ctx.stored('blank_rest', 'm1'), 'createMany');

    await seed('m2');
    const um = await ctx.call('POST', '/api/v1/data/:object/updateMany', { object: 'blank_rest' },
      { records: [{ id: 'm2', data: blankTyped() }] });
    expect(um.body.results.map((r: any) => r.success)).toEqual([true]);
    expectTypedNull(await ctx.stored('blank_rest', 'm2'), 'updateMany');
  });

  it('a valid value on every typed column is stored and read back unchanged', async () => {
    const res = await ctx.call('POST', '/api/v1/data/:object', { object: 'blank_rest' }, { id: 'v1', ...VALID });
    expect(res.status).toBe(201);
    const read = await ctx.engine.findOne('blank_rest', { where: { id: 'v1' } }) as Record<string, unknown>;
    for (const [k, v] of Object.entries(VALID)) expect(read[k], k).toStrictEqual(v);
  });

  it('a required field refuses a blank: 400 VALIDATION_FAILED / required, nothing stored', async () => {
    const res = await ctx.call('POST', '/api/v1/data/:object', { object: 'blank_rest_req' }, { id: 'q1', amount: '' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(res.body.fields.map((x: any) => [x.field, x.code])).toEqual([['amount', 'required']]);
    expect(await ctx.stored('blank_rest_req', 'q1')).toBeUndefined();
  });

  it('progress refuses a non-numeric string: 400 VALIDATION_FAILED / invalid_number', async () => {
    const res = await ctx.call('POST', '/api/v1/data/:object', { object: 'blank_rest' }, { id: 'g1', f_progress: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(res.body.fields.map((x: any) => [x.field, x.code])).toEqual([['f_progress', 'invalid_number']]);
    expect(await ctx.stored('blank_rest', 'g1')).toBeUndefined();
  });

  it('a roll-up max over a temporal child field still recomputes: the child write succeeds, as at base', async () => {
    await ctx.engine.insert('blank_rollup_parent', { id: 'p1' });
    const first = await ctx.call('POST', '/api/v1/data/:object', { object: 'blank_rollup_child' }, { id: 'k1', parent: 'p1', due: '2026-01-05' });
    expect(first.status).toBe(201);
    const second = await ctx.call('POST', '/api/v1/data/:object', { object: 'blank_rollup_child' }, { id: 'k2', parent: 'p1', due: '2026-02-07' });
    expect(second.status).toBe(201);
    expect(await ctx.stored('blank_rollup_child', 'k2')).toBeTruthy();
    // The recompute landed — the base answer. What a date string in a summary
    // column should be is a separate authoring question, not pinned here.
    expect((await ctx.stored('blank_rollup_parent', 'p1'))?.latest_due).toBe('2026-02-07');
  });
});
