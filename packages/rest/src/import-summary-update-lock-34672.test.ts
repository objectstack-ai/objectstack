// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34672] A roll-up `summary` field without `readonly: true`, through the
 * public doors: `PATCH /api/v1/data/:object/:id` and
 * `POST /api/v1/data/:object/import` with `writeMode: 'update'` (dry run and
 * commit), over a REAL {@link ObjectQL} + {@link ObjectStackProtocolImplementation}
 * + SQLite `:memory:`, as a signed-in person.
 *
 * Measured on `main` before this card: both doors answered `200` / `ok`, said
 * nothing about the column, and stored the typed value (`90`, `2`) while the
 * child rows summed to `42`. Now the engine reads every `summary` field as
 * read-only on update, so both doors report the column as `readonly`, as they
 * do for the roll-up the author declared read-only (the control), and the
 * stored value stays the engine's.
 *
 * The engine's own pins (predicate update, `strictReadonlyWrites`, the
 * recompute, `isSystem`, the insert boundary):
 * `packages/objectql/src/engine-summary-update-lock.test.ts`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysImportJob } from '@objectstack/platform-objects/audit';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const PARENT = 'acct_rollup_34672';
const CHILD = 'ord_rollup_34672';

const ACCOUNT = {
  name: PARENT, label: 'Account 34672', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    order_total: {
      name: 'order_total', type: 'summary' as const,
      summaryOperations: { object: CHILD, field: 'amount', function: 'sum' as const },
    },
    order_total_ro: {
      name: 'order_total_ro', type: 'summary' as const, readonly: true,
      summaryOperations: { object: CHILD, field: 'amount', function: 'sum' as const },
    },
  },
};

const ORDER = {
  name: CHILD, label: 'Order 34672', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    amount: { name: 'amount', type: 'number' as const },
    acct: { name: 'acct', type: 'master_detail' as const, reference: PARENT },
  },
};

const ROLL_UP = { object: PARENT, fields: ['order_total'], reason: 'readonly' };
const ROLL_UP_RO = { object: PARENT, fields: ['order_total_ro'], reason: 'readonly' };

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

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot() {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
  await engine.init();
  engine.registry.registerObject(ACCOUNT as any);
  engine.registry.registerObject(ORDER as any);
  engine.registry.registerObject(SysImportJob as any);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const call = async (method: string, path: string, body: unknown, params: Record<string, string>): Promise<{ status: number; body: any }> => {
    const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    expect(route, `${method} ${path}`).toBeDefined();
    const res = makeRes();
    await route!.handler({ params, body, query: {}, headers: {} } as any, res);
    return { status: res._status ?? 200, body: res._json };
  };

  // The account and its two orders, written through the create door as the
  // same person: the roll-ups are the engine's, 10 + 32.
  for (const [object, row] of [
    [PARENT, { id: 'a1', name: 'A' }],
    [CHILD, { id: 'o1', acct: 'a1', amount: 10 }],
    [CHILD, { id: 'o2', acct: 'a1', amount: 32 }],
  ] as const) {
    const created = await call('POST', '/api/v1/data/:object', row, { object });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
  }
  const stored = async () => engine.findOne(PARENT, { where: { id: 'a1' } });
  expect(await stored()).toMatchObject({ order_total: 42, order_total_ro: 42 });

  const importUpdate = (rows: Array<Record<string, unknown>>, dryRun: boolean) =>
    call('POST', '/api/v1/data/:object/import', {
      format: 'json', rows, dryRun, writeMode: 'update', matchFields: ['id'],
    }, { object: PARENT });
  return { call, importUpdate, stored };
}

describe('[#34672] a roll-up summary without readonly: true, through the public doors', () => {
  it('PATCH: the roll-up value is dropped and reported as readonly; the rest of the patch is written', async () => {
    const b = await boot();
    const patch = await b.call('PATCH', '/api/v1/data/:object/:id', { name: 'A2', order_total: 90 }, { object: PARENT, id: 'a1' });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    expect(patch.body.droppedFields).toEqual([ROLL_UP]);
    expect(await b.stored()).toMatchObject({ name: 'A2', order_total: 42 });
  });

  it('import writeMode update: the dry run and the commit both report the drop, and the commit stores the engine\'s value', async () => {
    const b = await boot();
    const dry = await b.importUpdate([{ id: 'a1', name: 'A3', order_total: 2 }], true);
    expect(dry.body, JSON.stringify(dry.body)).toMatchObject({ ok: 1, errors: 0, updated: 1 });
    expect(dry.body.results[0]).toEqual({ row: 1, ok: true, action: 'updated', id: 'a1', droppedFields: [ROLL_UP] });

    const commit = await b.importUpdate([{ id: 'a1', name: 'A3', order_total: 2 }], false);
    expect(commit.body, JSON.stringify(commit.body)).toMatchObject({ ok: 1, errors: 0, updated: 1 });
    expect(commit.body.results[0]).toEqual({ row: 1, ok: true, action: 'updated', id: 'a1', droppedFields: [ROLL_UP] });
    expect(await b.stored()).toMatchObject({ name: 'A3', order_total: 42 });
  });

  it('CONTROL: the roll-up the author declared readonly: true answers the same on both doors', async () => {
    const b = await boot();
    const patch = await b.call('PATCH', '/api/v1/data/:object/:id', { order_total_ro: 90 }, { object: PARENT, id: 'a1' });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    expect(patch.body.droppedFields).toEqual([ROLL_UP_RO]);

    const commit = await b.importUpdate([{ id: 'a1', order_total_ro: 2 }], false);
    expect(commit.body.results[0]).toEqual({ row: 1, ok: true, action: 'updated', id: 'a1', droppedFields: [ROLL_UP_RO] });
    expect(await b.stored()).toMatchObject({ order_total: 42, order_total_ro: 42 });
  });
});
