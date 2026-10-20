// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST /api/v1/batch` — an `update` / `delete` op whose row address names no
 * row is refused up front with the missing-id answer, on a real engine
 * (`ObjectQL` + sqlite `SqlDriver`), the real protocol and the real
 * `RestServer` route, with `objectQLProvider` wired so the cross-object door is
 * reachable rather than answering 501.
 *
 * The door's up-front check read `op.id == null && op.data?.id == null`, so an
 * address the engine does not take as an id — the empty string, `0`, a
 * non-scalar — passed it, reached `ql.update` / `ql.delete`, and the engine's
 * `Update requires an ID…` / `Delete requires an ID…` throw answered as a
 * server fault. And the check accepted `data.id` for a `delete`, whose write
 * arm never read it. Both are now judged once: the address each arm hands the
 * engine (`batchOpRowAddress`), against the engine's own by-id predicate.
 *
 * Measured on `origin/main` a43405d59 with this harness, before the fix: every
 * REFUSED row below answered `500` — `DATABASE_ERROR` on an update arm,
 * `INTERNAL_ERROR` on a delete arm — and wrote nothing (the transaction rolled
 * the batch back). They now answer `400 VALIDATION_FAILED` with the sentence a
 * missing id gets, before the transaction opens.
 *
 * Controls: a missing id answers as before; a real id updates and deletes as
 * before (by `id`, and an update by `data.id`); an update whose `data.id` is a
 * `{ $ref }` to an earlier create still resolves; a whitespace id is an id the
 * engine looks up, so it answers what an unknown id answers (`404`), not this
 * refusal.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJ = {
  name: 'blank_id_task', label: 'Task', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', type: 'text' as const },
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
  await engine.insert('blank_id_task', { id: 'row-1', title: 'Kept' });

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(
    createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined, // kernelManager, envRegistry, defaultEnvIdProvider, authServiceProvider
    (async () => engine) as any,                // objectQLProvider (positional arg #8)
  );
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/batch');
  expect(route, 'POST /api/v1/batch').toBeDefined();
  const transaction = vi.spyOn(engine, 'transaction');
  const batch = async (operations: unknown[], extra: Record<string, unknown> = {}) => {
    const res = makeRes();
    await route!.handler({ method: 'POST', params: {}, query: {}, headers: {}, body: { operations, ...extra } } as any, res);
    return { status: res._status ?? 200, body: res._json };
  };
  const row = (id: string) => engine.findOne('blank_id_task', { where: { id } } as any);
  return { batch, row, transaction };
}

const O = 'blank_id_task';
const missingId = (action: 'update' | 'delete') => ({
  error: `Operation '${action}' on '${O}' requires an id`,
  code: 'VALIDATION_FAILED',
});

/** Every op here names no row the engine could address; the arm is the op's own. */
const REFUSED: ReadonlyArray<readonly [string, 'update' | 'delete', Record<string, unknown>]> = [
  ['update, id ""', 'update', { id: '', data: { title: 'Changed' } }],
  ['update, data.id ""', 'update', { data: { id: '', title: 'Changed' } }],
  ['update, id "" beside a real data.id (the arm reads id first)', 'update', { id: '', data: { id: 'row-1', title: 'Changed' } }],
  ['update, data.id 0', 'update', { data: { id: 0, title: 'Changed' } }],
  ['update, data.id false', 'update', { data: { id: false, title: 'Changed' } }],
  ['update, data.id true', 'update', { data: { id: true, title: 'Changed' } }],
  ['update, data.id {}', 'update', { data: { id: {}, title: 'Changed' } }],
  ['update, data.id []', 'update', { data: { id: [], title: 'Changed' } }],
  ['delete, id ""', 'delete', { id: '' }],
  ['delete, id "" beside a real data.id', 'delete', { id: '', data: { id: 'row-1' } }],
  ['delete, a real id in data.id only (the delete arm never read data.id)', 'delete', { data: { id: 'row-1' } }],
];

describe('POST /api/v1/batch: an update or delete op that names no row answers the missing-id 400', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => { ctx = await boot(); });

  it.each(REFUSED)('%s → 400 VALIDATION_FAILED, before the transaction opens, nothing written', async (_l, action, op) => {
    const res = await ctx.batch([{ object: O, action, ...op }], { atomic: true });
    expect({ status: res.status, body: res.body }).toEqual({ status: 400, body: missingId(action) });
    expect(ctx.transaction).not.toHaveBeenCalled();
    expect(await ctx.row('row-1')).toMatchObject({ id: 'row-1', title: 'Kept' });
  });

  it('refuses the whole batch up front: an earlier create in it is never written', async () => {
    const res = await ctx.batch([
      { object: O, action: 'create', data: { id: 'row-2', title: 'New' } },
      { object: O, action: 'update', id: '', data: { title: 'Changed' } },
    ]);
    expect({ status: res.status, body: res.body }).toEqual({ status: 400, body: missingId('update') });
    expect(ctx.transaction).not.toHaveBeenCalled();
    expect(await ctx.row('row-2')).toBeFalsy();
  });

  // ── controls: answers that do not move ────────────────────────────────────

  it.each([
    ['update', { data: { title: 'Changed' } }],
    ['delete', {}],
  ] as const)('control: %s with no id at all answers the same 400', async (action, op) => {
    const res = await ctx.batch([{ object: O, action, ...op }]);
    expect({ status: res.status, body: res.body }).toEqual({ status: 400, body: missingId(action) });
    expect(await ctx.row('row-1')).toMatchObject({ title: 'Kept' });
  });

  it('control: an update by id writes the row', async () => {
    const res = await ctx.batch([{ object: O, action: 'update', id: 'row-1', data: { title: 'By id' } }]);
    expect(res.status).toBe(200);
    expect(await ctx.row('row-1')).toMatchObject({ title: 'By id' });
  });

  it('control: an update by data.id writes the row', async () => {
    const res = await ctx.batch([{ object: O, action: 'update', data: { id: 'row-1', title: 'By data.id' } }]);
    expect(res.status).toBe(200);
    expect(await ctx.row('row-1')).toMatchObject({ title: 'By data.id' });
  });

  it('control: an update whose data.id is a $ref to an earlier create still resolves', async () => {
    const res = await ctx.batch([
      { object: O, action: 'create', data: { id: 'row-3', title: 'Created' } },
      { object: O, action: 'update', data: { id: { $ref: 0 }, title: 'Then updated' } },
    ]);
    expect(res.status).toBe(200);
    expect(await ctx.row('row-3')).toMatchObject({ title: 'Then updated' });
  });

  it('control: a delete by id deletes the row', async () => {
    const res = await ctx.batch([{ object: O, action: 'delete', id: 'row-1' }]);
    expect(res.status).toBe(200);
    expect(await ctx.row('row-1')).toBeFalsy();
  });

  it.each([
    ['an unknown id', 'nope'],
    ['a whitespace id (an id the engine looks up)', '  '],
  ])('control: update and delete with %s answer 404 RECORD_NOT_FOUND, not this refusal', async (_l, id) => {
    for (const op of [{ action: 'update', id, data: { title: 'Changed' } }, { action: 'delete', id }]) {
      const res = await ctx.batch([{ object: O, ...op }]);
      expect([op.action, res.status, res.body?.code]).toEqual([op.action, 404, 'RECORD_NOT_FOUND']);
    }
    expect(await ctx.row('row-1')).toMatchObject({ title: 'Kept' });
  });
});
