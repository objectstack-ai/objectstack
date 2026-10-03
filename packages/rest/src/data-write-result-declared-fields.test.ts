// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21613] A write's response serves the object's DECLARED fields plus the
 * platform's own system columns — never a column no metadata declares. The
 * write-side half of #21571's read rule, decided in the same place: the
 * engine shapes the rows its write verbs return, and the rows it reads before
 * a write, with `declared-read-columns.ts`.
 *
 * The door the card measured, on the composed REST harness #21571's reach pin
 * uses (`RestServer` → `ObjectStackProtocolImplementation` → `ObjectQL` → a
 * real `SqlDriver` on better-sqlite3):
 *
 *  1. Boot ONE declares `rq_contact` with two mailing fields, syncs, and writes
 *     rows carrying values in them.
 *  2. Boot TWO declares the same object with those two fields retired — the
 *     upgrade. Additive sync leaves both columns and their values in place.
 *  3. Every write door that answers with a record: PATCH, POST, clone, and the
 *     bulk faces (createMany, batch, updateMany).
 *
 * Before the engine shaped its write results, step 3 answered PATCH with
 * `record.mailing_street = '1 Retired Way'` (driver-sql's `select *`
 * readback), and every create face with both retired columns as `null`
 * (`returning('*')`). The `data.record.*` events, which the webhook outbox
 * delivers verbatim, carried the same row as `after`; and the prior read bound
 * as a hook's `previous` carried the stored values — the row the audit ledger
 * records as a delete's `old_value`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'rq_contact';
const RETIRED = ['mailing_street', 'mailing_city'] as const;

const DECLARED = {
  name: { name: 'name', type: 'text' as const },
  email: { name: 'email', type: 'text' as const },
  // Declared `internal`: the A-prime ruling keeps it on the engine-level
  // result and strips it at the data door. Not this card's field class.
  api_token: { name: 'api_token', type: 'text' as const, internal: true },
};

const CONTACT_V1 = {
  name: OBJECT,
  label: 'Contact',
  fields: {
    ...DECLARED,
    mailing_street: { name: 'mailing_street', type: 'text' as const },
    mailing_city: { name: 'mailing_city', type: 'text' as const },
  },
};

/** The upgrade: the two mailing fields are retired from the declaration. */
const CONTACT_V2 = {
  name: OBJECT,
  label: 'Contact',
  enable: { apiMethods: ['get', 'list', 'create', 'update', 'delete', 'bulk'] },
  fields: { ...DECLARED },
};

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

const dir = mkdtempSync(join(tmpdir(), 'os-21613-'));
const filename = join(dir, 'retired-columns.sqlite');
const engines: ObjectQL[] = [];
afterAll(async () => {
  for (const e of engines) {
    try { await e.destroy(); } catch { /* noop */ }
  }
  rmSync(dir, { recursive: true, force: true });
});

const sqlDriver = () =>
  new SqlDriver({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true }) as any;

const SEEDED = ['c1', 'c2', 'c3', 'c4', 'c5'] as const;

/** Boot one: the old declaration creates the table and writes the values. */
async function bootOne(): Promise<void> {
  const engine = new ObjectQL();
  engine.registerDriver(sqlDriver(), true);
  await engine.init();
  engine.registry.registerObject(CONTACT_V1 as any);
  await engine.syncSchemas();
  await engine.insert(OBJECT, SEEDED.map((id) => ({
    id, name: id, email: `${id}@example.com`, api_token: `tok_${id}`,
    mailing_street: `${id} Retired Way`, mailing_city: 'Oldtown',
  })) as any);
  await engine.destroy();
}

type Captured = { type: string; payload: Record<string, unknown> };
type HookSeen = { event: string; id: unknown; previous: unknown };

/** Boot two: the new declaration on the database boot one left behind. */
async function bootTwo() {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(sqlDriver(), true);
  await engine.init();
  engine.registry.registerObject(CONTACT_V2 as any);
  await engine.syncSchemas();

  const events: Captured[] = [];
  engine.setRealtimeService({
    publish: async (e: Captured) => { events.push(e); },
    subscribe: async () => 'sub',
    unsubscribe: async () => undefined,
  } as any);
  const hooks: HookSeen[] = [];
  for (const event of ['afterUpdate', 'afterDelete']) {
    engine.registerHook(event, async (ctx: any) => {
      hooks.push({ event, id: ctx.input?.id, previous: ctx.previous });
    }, { object: OBJECT });
  }

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const routes = rest.getRoutes();
  const call = async (method: string, path: string, req: Record<string, unknown>) => {
    const route = routes.find((r: any) => r.method === method && r.path === `/api/v1/data${path}`);
    expect(route, `${method} /api/v1/data${path}`).toBeDefined();
    const res = makeRes();
    await route!.handler({ query: {}, headers: {}, ...req } as any, res);
    return res;
  };
  return { engine, events, hooks, call };
}

function expectDeclaredOnly(row: unknown): void {
  expect(row).toBeTruthy();
  for (const retired of RETIRED) expect(Object.keys(row as object)).not.toContain(retired);
}

describe('[#21613] a write\'s response serves the declared fields, never a retired column', () => {
  let h: Awaited<ReturnType<typeof bootTwo>>;
  beforeAll(async () => {
    await bootOne();
    h = await bootTwo();
  });

  it('the fixture is real: the table still stores the retired columns and their values', async () => {
    // A raw driver read, below the engine: the upgrade left the data in place.
    const driver = (h.engine as any).getDriver(OBJECT);
    const stored = await driver.findOne(OBJECT, { object: OBJECT, where: { id: 'c5' }, limit: 1 });
    expect(stored).toMatchObject({ mailing_street: 'c5 Retired Way', mailing_city: 'Oldtown' });
  });

  it('PATCH /data/:object/:id answers the record without the retired columns', async () => {
    const res = await h.call('PATCH', '/:object/:id', { params: { object: OBJECT, id: 'c1' }, body: { name: 'Ada' } });
    expect(res._status ?? 200).toBe(200);
    expect(res._json.record).toMatchObject({ id: 'c1', name: 'Ada', email: 'c1@example.com' });
    expectDeclaredOnly(res._json.record);
  });

  it('POST /data/:object answers 201 without them (a new row reads them as null)', async () => {
    const res = await h.call('POST', '/:object', { params: { object: OBJECT }, body: { id: 'n1', name: 'New' } });
    expect(res._status).toBe(201);
    expect(res._json.record).toMatchObject({ id: 'n1', name: 'New' });
    expectDeclaredOnly(res._json.record);
  });

  it('POST /data/:object/:id/clone answers 201 without them', async () => {
    const res = await h.call('POST', '/:object/:id/clone', { params: { object: OBJECT, id: 'c2' }, body: { name: 'c2 copy' } });
    expect(res._status).toBe(201);
    expect(res._json).toMatchObject({ sourceId: 'c2', record: { name: 'c2 copy', email: 'c2@example.com' } });
    expectDeclaredOnly(res._json.record);
  });

  it('the bulk faces: createMany, batch create / update / upsert, updateMany', async () => {
    const createMany = await h.call('POST', '/:object/createMany', { params: { object: OBJECT }, body: [{ id: 'm1', name: 'M1' }, { id: 'm2', name: 'M2' }] });
    expect(createMany._status).toBe(201);
    expect(createMany._json.records.map((r: any) => r.id)).toEqual(['m1', 'm2']);
    for (const row of createMany._json.records) expectDeclaredOnly(row);

    const batch = await h.call('POST', '/:object/batch', {
      params: { object: OBJECT },
      body: { operation: 'upsert', records: [{ id: 'c3', data: { name: 'c3 up' } }, { id: 'u1', data: { name: 'U1' } }] },
    });
    expect(batch._json.results.map((r: any) => [r.success, r.data?.name])).toEqual([[true, 'c3 up'], [true, 'U1']]);
    for (const r of batch._json.results) expectDeclaredOnly(r.data);

    for (const operation of ['create', 'update'] as const) {
      const records = operation === 'create' ? [{ data: { id: 'b1', name: 'B1' } }] : [{ id: 'c3', data: { name: 'c3 batch' } }];
      const res = await h.call('POST', '/:object/batch', { params: { object: OBJECT }, body: { operation, records } });
      expect(res._json.results[0]).toMatchObject({ success: true, data: { name: records[0].data.name } });
      expectDeclaredOnly(res._json.results[0].data);
    }

    const updateMany = await h.call('POST', '/:object/updateMany', { params: { object: OBJECT }, body: { records: [{ id: 'c1', data: { name: 'Ada many' } }] } });
    expect(updateMany._json.results[0]).toMatchObject({ success: true, data: { id: 'c1', name: 'Ada many' } });
    expectDeclaredOnly(updateMany._json.results[0].data);
  });

  it('the data events those writes publish carry the declared record as `after`', async () => {
    const created = h.events.filter((e) => e.type === 'data.record.created');
    const updated = h.events.filter((e) => e.type === 'data.record.updated');
    // n1, the clone, m1, m2, u1, b1 — and c3 (twice), c1 (twice): the writes above.
    expect(created.length).toBeGreaterThanOrEqual(6);
    expect(updated.length).toBeGreaterThanOrEqual(4);
    for (const e of [...created, ...updated]) {
      expect(e.payload.after).toMatchObject({ id: e.payload.recordId });
      expectDeclaredOnly(e.payload.after);
    }
  });

  it('the prior read a write binds as `previous` is the declared record (update and delete)', async () => {
    await h.call('PATCH', '/:object/:id', { params: { object: OBJECT, id: 'c4' }, body: { name: 'c4 edited' } });
    const del = await h.call('DELETE', '/:object/:id', { params: { object: OBJECT, id: 'c5' } });
    expect(del._status ?? 200).toBe(200);
    const update = h.hooks.find((x) => x.event === 'afterUpdate' && x.id === 'c4');
    const remove = h.hooks.find((x) => x.event === 'afterDelete' && x.id === 'c5');
    expect(update?.previous).toMatchObject({ id: 'c4', name: 'c4' });
    expectDeclaredOnly(update?.previous);
    expect(remove?.previous).toMatchObject({ id: 'c5', email: 'c5@example.com' });
    expectDeclaredOnly(remove?.previous);
  });

  it('declared fields and the system columns are served as before; `internal` stays the door\'s strip', async () => {
    const res = await h.call('PATCH', '/:object/:id', { params: { object: OBJECT, id: 'c2' }, body: { name: 'c2 again' } });
    const record = res._json.record;
    expect(record).toMatchObject({ id: 'c2', name: 'c2 again', email: 'c2@example.com' });
    // The registry-injected system columns, named one by one, and the
    // platform-provisioned three.
    for (const system of [
      'id', 'created_at', 'updated_at', 'created_by', 'updated_by',
      'organization_id', 'owner_id', 'owning_business_unit_id',
    ]) {
      expect(record).toHaveProperty(system);
    }
    // Every key is a declared field or a platform-provisioned column.
    const declared = new Set([...Object.keys(h.engine.registry.getObject(OBJECT)!.fields as object), 'id', 'created_at', 'updated_at']);
    expect(Object.keys(record).filter((key) => !declared.has(key))).toEqual([]);
    // `internal: true`: omitted by the data door, whole on the engine result.
    expect(record).not.toHaveProperty('api_token');
    const engineRow = await h.engine.update(OBJECT, { id: 'c2', name: 'c2 engine' });
    expect(engineRow).toMatchObject({ id: 'c2', api_token: 'tok_c2' });
    expectDeclaredOnly(engineRow);
  });
});
