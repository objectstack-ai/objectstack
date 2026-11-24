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
 * The create doors (second describe): `POST /api/v1/data/:object`, and the
 * import with `writeMode: 'insert'` and with `writeMode: 'upsert'` (the rows it
 * creates). Before the create half of this card each stored the typed value
 * with no report. Now the value is dropped, reported as `readonly`, and the
 * column starts at the empty-child-list seed (`0` for a `sum`), the declared
 * `readonly: true` control included, which used to land `null`.
 *
 * The engine's own pins (predicate update, `strictReadonlyWrites`, the
 * recompute, `isSystem`, the create side):
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
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  engine.registerDriver(driver, true);
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
  const importAs = (writeMode: 'insert' | 'upsert', rows: Array<Record<string, unknown>>, dryRun: boolean) =>
    call('POST', '/api/v1/data/:object/import', {
      format: 'json', rows, dryRun, writeMode, ...(writeMode === 'upsert' ? { matchFields: ['id'] } : {}),
    }, { object: PARENT });
  const storedRow = async (id: string) => engine.findOne(PARENT, { where: { id } });
  /** The physical row, read past every engine read coercion. */
  const raw = async (id: string) =>
    (await (driver as any).knex(PARENT).where({ id }).first()) as Record<string, unknown> | undefined;
  return { call, importUpdate, importAs, stored, storedRow, raw, driver };
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

describe('[#34672] a roll-up summary is read-only on create, through the public doors', () => {
  const BOTH = { object: PARENT, fields: ['order_total', 'order_total_ro'], reason: 'readonly' };

  it('POST create: both roll-up values are dropped and reported; both columns store 0, not the typed value and not null', async () => {
    const b = await boot();
    const created = await b.call('POST', '/api/v1/data/:object', { id: 'a2', name: 'B', order_total: 90, order_total_ro: 90 }, { object: PARENT });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.droppedFields).toEqual([BOTH]);
    expect(await b.raw('a2')).toMatchObject({ name: 'B', order_total: 0, order_total_ro: 0 });
  });

  it('import writeMode insert: the dry run and the commit report the drop on the row, and the commit stores 0', async () => {
    const b = await boot();
    const rows = [{ id: 'a2', name: 'B', order_total: 90 }, { id: 'a3', name: 'C' }];
    const dry = await b.importAs('insert', rows, true);
    expect(dry.body, JSON.stringify(dry.body)).toMatchObject({ ok: 2, errors: 0 });
    expect(dry.body.results[0]).toMatchObject({ row: 1, ok: true, droppedFields: [ROLL_UP] });
    expect(dry.body.results[1].droppedFields ?? []).toEqual([]);

    const commit = await b.importAs('insert', rows, false);
    expect(commit.body, JSON.stringify(commit.body)).toMatchObject({ ok: 2, errors: 0 });
    expect(commit.body.results[0]).toMatchObject({ row: 1, ok: true, droppedFields: [ROLL_UP] });
    expect(await b.raw('a2')).toMatchObject({ name: 'B', order_total: 0, order_total_ro: 0 });
    expect(await b.raw('a3')).toMatchObject({ name: 'C', order_total: 0, order_total_ro: 0 });
  });

  it('import writeMode upsert: drops the value on the row it updates and on the row it creates; a created row with children already stored lands 0, not the typed value', async () => {
    const b = await boot();
    // Two orders already naming `a9`, which does not exist yet (an import keyed
    // on an external id can leave them so), put straight in the table: a child
    // write through the engine would recompute a parent that is not there. The
    // true sum is 50; the create seeds 0, and the next child write recomputes.
    await (b.driver as any).knex(CHILD).insert([{ id: 'o8', acct: 'a9', amount: 20 }, { id: 'o9', acct: 'a9', amount: 30 }]);
    const commit = await b.importAs('upsert', [
      { id: 'a1', name: 'A4', order_total: 2 },
      { id: 'a9', name: 'Z', order_total: 90 },
    ], false);
    expect(commit.body, JSON.stringify(commit.body)).toMatchObject({ ok: 2, errors: 0 });
    expect(commit.body.results).toEqual([
      expect.objectContaining({ row: 1, ok: true, action: 'updated', id: 'a1', droppedFields: [ROLL_UP] }),
      expect.objectContaining({ row: 2, ok: true, action: 'created', droppedFields: [ROLL_UP] }),
    ]);
    expect(await b.raw('a1')).toMatchObject({ name: 'A4', order_total: 42 });
    expect(await b.raw('a9')).toMatchObject({ name: 'Z', order_total: 0, order_total_ro: 0 });

    const child = await b.call('POST', '/api/v1/data/:object', { id: 'o10', acct: 'a9', amount: 1 }, { object: CHILD });
    expect(child.status, JSON.stringify(child.body)).toBe(201);
    expect(await b.raw('a9')).toMatchObject({ order_total: 51, order_total_ro: 51 });
  });
});
