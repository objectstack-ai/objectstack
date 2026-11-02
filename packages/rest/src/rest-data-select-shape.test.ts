// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29244] A plain object or an array sent as a select's value, through the
 * REST write doors, on a real engine (`ObjectQL` + sqlite `SqlDriver`) and the
 * real `RestServer` routes (the harness `rest-data-text-scalar-value.test.ts`
 * boots).
 *
 * Measured on `origin/main` @ `04e0c2c0`, on SQLite and on driver-memory:
 * `POST` and `PATCH` with `{ stage: { a: 1 } }` or `{ stage: ['x'] }` on a
 * select with no `options` answered 201 / 200 and stored the object or array
 * (SQLite as its JSON text, driver-memory as the value); `{ labels: [{ a: 1 }] }`
 * on a `multiple: true` select likewise. Both now answer 400
 * `VALIDATION_FAILED` with the field's `invalid_type`, and nothing is stored.
 *
 * Controls: a string and an array of strings are stored as sent.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJ = {
  name: 'select_rest', label: 'Select', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    stage: { name: 'stage', type: 'select' as const },
    labels: { name: 'labels', type: 'select' as const, multiple: true },
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
    (await (driver as any).knex('select_rest').where({ id }).first()) as Record<string, unknown> | undefined;
  return { engine, call, stored };
}

function expectRefused(res: { status: number; body: any }, field: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(400);
  expect(res.body?.error?.code ?? res.body?.code).toBe('VALIDATION_FAILED');
  expect(JSON.stringify(res.body)).toContain(field);
  expect(JSON.stringify(res.body)).toContain('invalid_type');
}

describe('REST write doors: a select refuses a plain object or an array as its value (#29244)', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => { ctx = await boot(); });

  for (const [field, value] of [['stage', { a: 1 }], ['stage', ['x']], ['labels', [{ a: 1 }]]] as const) {
    it(`POST create with ${field}: ${JSON.stringify(value)} is refused 400, and no row is written`, async () => {
      const res = await ctx.call('POST', '/api/v1/data/:object', { object: 'select_rest' }, { id: 'c1', [field]: value });
      expectRefused(res, field);
      expect(await ctx.stored('c1')).toBeUndefined();
    });

    it(`PATCH update with ${field}: ${JSON.stringify(value)} is refused 400, and the row is unchanged`, async () => {
      await ctx.engine.insert('select_rest', { id: 'u1', stage: 'open', labels: ['a'] });
      const before = await ctx.stored('u1');
      const res = await ctx.call('PATCH', '/api/v1/data/:object/:id', { object: 'select_rest', id: 'u1' }, { [field]: value });
      expectRefused(res, field);
      expect(await ctx.stored('u1')).toEqual(before);
    });
  }

  it('control: a string and an array of strings are stored as sent', async () => {
    const res = await ctx.call('POST', '/api/v1/data/:object', { object: 'select_rest' }, { id: 's1', stage: 'won', labels: ['x', 'y'] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = (await ctx.engine.findOne('select_rest', { where: { id: 's1' } })) as Record<string, unknown>;
    expect(row.stage).toBe('won');
    expect(row.labels).toEqual(['x', 'y']);
  });
});
