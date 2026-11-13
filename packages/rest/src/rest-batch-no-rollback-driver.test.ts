// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32604] `POST /api/v1/batch` on a runtime whose default driver cannot roll
 * back answers the route's typed `501 NOT_IMPLEMENTED` and writes nothing,
 * instead of applying a "transactional" batch op by op.
 *
 * Real engine (`ObjectQL`), real protocol, real `RestServer` route. The
 * no-rollback driver is a `SqlDriver` that INHERITS `beginTransaction` and
 * declares `supports.transactionsUnsupported` — the shape `TursoDriver` takes on
 * its remote transport, the runtime hosted tenants run on.
 *
 * The defect: the route tested only `typeof ql.transaction === 'function'` and
 * called `ql.transaction(cb, context)` without `{ require: true }`. On this
 * driver the engine takes its declared degrade (ADR-0119 D1): the callback runs
 * with no transaction and no rollback. A batch whose second op failed kept its
 * first op's row, while the route documents itself "all-or-nothing by
 * construction". Measured on `origin/main` 5fb79bc0 with this file: the first
 * case below answered `404 RECORD_NOT_FOUND` and left the `alpha` row in
 * place; the second answered `200` with both rows written.
 *
 * Now the route passes `{ require: true }` (#5696), the engine refuses before
 * the callback runs, and the route maps that refusal to the same 501 body it
 * already answers for an engine without `transaction()`.
 *
 * Controls on a driver that CAN roll back: the failing batch keeps its existing
 * answer with nothing persisted, and a good batch commits with 200. Discovery's
 * `capabilities.transactionalBatch` agrees with the route on both runtimes,
 * because both read the default driver through `driverSupportsTransactions`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

/** Inherits `beginTransaction`; the transport declares it cannot honour it. */
class NoRollbackSqlDriver extends SqlDriver {
  override get supports() {
    return { ...super.supports, transactionsUnsupported: true };
  }
}

const ALPHA = {
  name: 'nrb_alpha', label: 'Alpha', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', type: 'text' as const },
  },
};
const BETA = {
  name: 'nrb_beta', label: 'Beta', systemFields: false,
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

async function boot(canRollBack: boolean) {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  const options = { client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true };
  const driver = canRollBack ? new SqlDriver(options) : new NoRollbackSqlDriver(options);
  engine.registerDriver(driver, true);
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
  const route = (method: string, path: string) => {
    const found = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    expect(found, `${method} ${path}`).toBeDefined();
    return found!;
  };
  const batchRoute = route('POST', '/api/v1/batch');
  const discoveryRoute = route('GET', '/api/v1/discovery');
  const call = async (r: any, body?: unknown) => {
    const res = makeRes();
    await r.handler({ method: r.method, params: {}, query: {}, headers: {}, body } as any, res);
    return { status: res._status ?? 200, body: res._json };
  };
  return {
    batch: (operations: unknown[]) => call(batchRoute, { operations }),
    discovery: () => call(discoveryRoute),
    rows: async (object: string) => (await engine.find(object, {})) as any[],
  };
}

/** Op 0 writes; op 1 fails inside the transaction (no such row). */
const FAILING_BATCH = [
  { object: 'nrb_alpha', action: 'create', data: { id: 'a-1', title: 'First op' } },
  { object: 'nrb_beta', action: 'update', id: 'no-such-row', data: { title: 'Second op' } },
];
const GOOD_BATCH = [
  { object: 'nrb_alpha', action: 'create', data: { id: 'a-1', title: 'First op' } },
  { object: 'nrb_beta', action: 'create', data: { id: 'b-1', title: 'Second op' } },
];

const REFUSAL = { error: 'Transactional batch not supported by this runtime', code: 'NOT_IMPLEMENTED' };

describe('[#32604] POST /api/v1/batch on a driver that cannot roll back', () => {
  it('refuses a batch whose later op fails with 501 NOT_IMPLEMENTED, and the earlier op leaves no row', async () => {
    const ctx = await boot(false);
    const answer = await ctx.batch(FAILING_BATCH);
    expect(answer.status).toBe(501);
    expect(answer.body).toEqual(REFUSAL);
    expect(await ctx.rows('nrb_alpha')).toEqual([]);
    expect(await ctx.rows('nrb_beta')).toEqual([]);
  });

  it('refuses a batch whose ops would all succeed too: the refusal comes before any write', async () => {
    const ctx = await boot(false);
    const answer = await ctx.batch(GOOD_BATCH);
    expect(answer.status).toBe(501);
    expect(answer.body).toEqual(REFUSAL);
    expect(await ctx.rows('nrb_alpha')).toEqual([]);
    expect(await ctx.rows('nrb_beta')).toEqual([]);
  });

  it('discovery advertises capabilities.transactionalBatch = false, agreeing with the refusal', async () => {
    const ctx = await boot(false);
    const doc = await ctx.discovery();
    expect(doc.body.capabilities.transactionalBatch.enabled).toBe(false);
  });
});

describe('[#32604] controls: POST /api/v1/batch on a driver that can roll back is unchanged', () => {
  it('a batch whose later op fails keeps its existing answer, and the rollback leaves no row', async () => {
    const ctx = await boot(true);
    const answer = await ctx.batch(FAILING_BATCH);
    expect(answer.status).toBe(404);
    expect(answer.body.code).toBe('RECORD_NOT_FOUND');
    expect(await ctx.rows('nrb_alpha')).toEqual([]);
    expect(await ctx.rows('nrb_beta')).toEqual([]);
  });

  it('a good batch commits every op with 200', async () => {
    const ctx = await boot(true);
    const answer = await ctx.batch(GOOD_BATCH);
    expect(answer.status).toBe(200);
    expect(answer.body.results.map((r: any) => r.id)).toEqual(['a-1', 'b-1']);
    expect((await ctx.rows('nrb_alpha')).map((r) => r.id)).toEqual(['a-1']);
    expect((await ctx.rows('nrb_beta')).map((r) => r.id)).toEqual(['b-1']);
  });

  it('discovery advertises capabilities.transactionalBatch = true', async () => {
    const ctx = await boot(true);
    const doc = await ctx.discovery();
    expect(doc.body.capabilities.transactionalBatch.enabled).toBe(true);
  });
});
