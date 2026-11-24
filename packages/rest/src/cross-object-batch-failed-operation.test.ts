// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35726] A refusal of the cross-object `POST {basePath}/batch` names the op
 * that caused it: `failedOperation: { index, object }`, beside the `error` /
 * `code` the shared error door answered, so a caller that sent several ops can
 * say which one failed (the console's related-list add names the picked
 * record at that index).
 *
 * Real engine (`ObjectQL`), real protocol, real `RestServer` route, over a
 * SQLite driver that rolls back, so "nothing landed" is read from the table.
 *
 * Controls: a batch that commits carries no such key, and a refusal of the
 * request as a whole (`atomic: false`) names no op. The route has no
 * non-atomic run to pin: `atomic: false` is refused before any op runs.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const ALPHA = {
  name: 'fop_alpha', label: 'Alpha', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', type: 'text' as const },
  },
};
const BETA = {
  name: 'fop_beta', label: 'Beta', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', type: 'text' as const, required: true },
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
  engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
  await engine.init();
  engine.registry.registerObject(ALPHA as any);
  engine.registry.registerObject(BETA as any);
  await engine.syncSchemas();

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
  const batch = async (operations: unknown[], extra: Record<string, unknown> = {}) => {
    const res = makeRes();
    await route!.handler({ method: 'POST', params: {}, query: {}, headers: {}, body: { operations, ...extra } } as any, res);
    return { status: res._status ?? 200, body: res._json };
  };
  const rows = async (object: string) => (await engine.find(object, {})) as any[];
  return { batch, rows };
}

describe('[#35726] a refused cross-object batch names the op that failed', () => {
  it('3 ops, the 2nd addresses no row: index 1 and its object, and nothing lands', async () => {
    const ctx = await boot();
    const answer = await ctx.batch([
      { object: 'fop_alpha', action: 'create', data: { id: 'a-1', title: 'First' } },
      { object: 'fop_beta', action: 'update', id: 'no-such-row', data: { title: 'Second' } },
      { object: 'fop_alpha', action: 'create', data: { id: 'a-2', title: 'Third' } },
    ]);
    expect(answer.status).toBe(404);
    expect(answer.body.code).toBe('RECORD_NOT_FOUND');
    expect(answer.body.failedOperation).toEqual({ index: 1, object: 'fop_beta' });
    expect(await ctx.rows('fop_alpha')).toEqual([]);
    expect(await ctx.rows('fop_beta')).toEqual([]);
  });

  it('3 ops, the 2nd misses a required field: index 1 beside the validation refusal, and nothing lands', async () => {
    const ctx = await boot();
    const answer = await ctx.batch([
      { object: 'fop_alpha', action: 'create', data: { id: 'a-1', title: 'First' } },
      { object: 'fop_beta', action: 'create', data: { id: 'b-1' } },
      { object: 'fop_alpha', action: 'create', data: { id: 'a-2', title: 'Third' } },
    ]);
    expect(answer.status).toBe(400);
    expect(answer.body.code).toBe('VALIDATION_FAILED');
    expect(answer.body.failedOperation).toEqual({ index: 1, object: 'fop_beta' });
    expect(await ctx.rows('fop_alpha')).toEqual([]);
    expect(await ctx.rows('fop_beta')).toEqual([]);
  });

  it('control: a batch that commits carries no failedOperation', async () => {
    const ctx = await boot();
    const answer = await ctx.batch([
      { object: 'fop_alpha', action: 'create', data: { id: 'a-1', title: 'First' } },
      { object: 'fop_beta', action: 'create', data: { id: 'b-1', title: 'Second' } },
      { object: 'fop_alpha', action: 'create', data: { id: 'a-2', title: 'Third' } },
    ]);
    expect(answer.status).toBe(200);
    expect(answer.body).not.toHaveProperty('failedOperation');
    expect(answer.body.results.map((r: any) => r.id)).toEqual(['a-1', 'b-1', 'a-2']);
  });

  it('control: a refusal of the request as a whole (atomic: false) names no op', async () => {
    const ctx = await boot();
    const answer = await ctx.batch([
      { object: 'fop_alpha', action: 'create', data: { id: 'a-1', title: 'First' } },
    ], { atomic: false });
    expect(answer.status).toBe(400);
    expect(answer.body.code).toBe('BATCH_NOT_ATOMIC');
    expect(answer.body).not.toHaveProperty('failedOperation');
    expect(await ctx.rows('fop_alpha')).toEqual([]);
  });
});
