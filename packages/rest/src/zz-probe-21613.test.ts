// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21613] TEMPORARY measurement probe — reverted before the fix lands.
 *
 * Records, on the composed REST harness (RestServer, then the protocol, then
 * ObjectQL, then a real SqlDriver on better-sqlite3), which write doors serve a
 * column no metadata declares, and which in-process carriers of a write result
 * (data events, hook `previous` / `result`) carry one.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'rq_contact';
const RETIRED = ['mailing_street', 'mailing_city'];

const CONTACT_V1 = {
  name: OBJECT,
  label: 'Contact',
  fields: {
    name: { name: 'name', type: 'text' as const },
    email: { name: 'email', type: 'text' as const },
    mailing_street: { name: 'mailing_street', type: 'text' as const },
    mailing_city: { name: 'mailing_city', type: 'text' as const },
  },
};
const CONTACT_V2 = {
  name: OBJECT,
  label: 'Contact',
  enable: { apiMethods: ['get', 'list', 'create', 'update', 'delete', 'bulk', 'upsert'] },
  fields: {
    name: { name: 'name', type: 'text' as const },
    email: { name: 'email', type: 'text' as const },
  },
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

const dir = mkdtempSync(join(tmpdir(), 'os-21613-probe-'));
const filename = join(dir, 'retired-columns.sqlite');
const engines: ObjectQL[] = [];
afterAll(async () => {
  for (const e of engines) { try { await e.destroy(); } catch { /* noop */ } }
  rmSync(dir, { recursive: true, force: true });
});
const sqlDriver = () => new SqlDriver({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true }) as any;

const notes: Record<string, unknown> = {};
const retiredIn = (v: any): string[] => {
  if (!v || typeof v !== 'object') return [];
  return RETIRED.filter((k) => k in v).map((k) => `${k}=${JSON.stringify(v[k])}`);
};

describe('[#21613] probe', () => {
  let rest: RestServer;
  let engine: ObjectQL;
  const events: any[] = [];
  const hooks: Array<{ event: string; previous: string[]; result: string[] }> = [];

  beforeAll(async () => {
    const one = new ObjectQL();
    one.registerDriver(sqlDriver(), true);
    await one.init();
    one.registry.registerObject(CONTACT_V1 as any);
    await one.syncSchemas();
    await one.insert(OBJECT, [
      { id: 'c1', name: 'Ada', email: 'ada@example.com', mailing_street: '1 Retired Way', mailing_city: 'Oldtown' },
      { id: 'c2', name: 'Bo', email: 'bo@example.com', mailing_street: '2 Retired Way', mailing_city: 'Oldtown' },
      { id: 'c3', name: 'Cy', email: 'cy@example.com', mailing_street: '3 Retired Way', mailing_city: 'Oldtown' },
      { id: 'c4', name: 'Di', email: 'di@example.com', mailing_street: '4 Retired Way', mailing_city: 'Oldtown' },
      { id: 'c5', name: 'Ed', email: 'bulk@example.com', mailing_street: '5 Retired Way', mailing_city: 'Oldtown' },
      { id: 'c6', name: 'Fi', email: 'bulk@example.com', mailing_street: '6 Retired Way', mailing_city: 'Oldtown' },
      { id: 'c7', name: 'Gu', email: 'gone@example.com', mailing_street: '7 Retired Way', mailing_city: 'Oldtown' },
    ] as any);
    await one.destroy();

    engine = new ObjectQL();
    engines.push(engine);
    engine.registerDriver(sqlDriver(), true);
    await engine.init();
    engine.registry.registerObject(CONTACT_V2 as any);
    await engine.syncSchemas();
    engine.setRealtimeService({
      publish: async (e: any) => { events.push(e); },
      subscribe: async () => 'x',
      unsubscribe: async () => {},
    } as any);
    for (const ev of ['beforeUpdate', 'afterUpdate', 'beforeDelete', 'afterDelete', 'afterInsert']) {
      engine.registerHook(ev, async (ctx: any) => {
        hooks.push({ event: `${ev}:${ctx.input?.id ?? ''}`, previous: retiredIn(ctx.previous), result: retiredIn(ctx.result) });
      }, { object: OBJECT });
    }
    const protocol = new ObjectStackProtocolImplementation(engine as any);
    rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
  });

  const route = (method: string, path: string) => {
    const r = rest.getRoutes().find((x: any) => x.method === method && x.path === path);
    if (!r) throw new Error(`no route ${method} ${path}`);
    return r;
  };
  const call = async (method: string, path: string, req: any) => {
    const res = makeRes();
    await route(method, path).handler({ query: {}, headers: {}, ...req }, res);
    return res;
  };

  it('measures every write door', async () => {
    const p = '/api/v1/data/:object';
    let res = await call('PATCH', `${p}/:id`, { params: { object: OBJECT, id: 'c1' }, body: { name: 'Ada 2' } });
    notes['PATCH /data/:object/:id'] = { status: res._status ?? 200, retired: retiredIn(res._json?.record) };

    res = await call('POST', p, { params: { object: OBJECT }, body: { id: 'n1', name: 'New' } });
    notes['POST /data/:object (create)'] = { status: res._status ?? 200, retired: retiredIn(res._json?.record) };

    res = await call('POST', `${p}/:id/clone`, { params: { object: OBJECT, id: 'c2' }, body: { name: 'Bo copy' } });
    notes['POST /data/:object/:id/clone'] = { status: res._status ?? 200, retired: retiredIn(res._json?.record), err: res._json?.error };

    res = await call('POST', `${p}/createMany`, { params: { object: OBJECT }, body: [{ id: 'm1', name: 'M1' }, { id: 'm2', name: 'M2' }] });
    notes['POST /data/:object/createMany'] = { status: res._status ?? 200, retired: (res._json?.records ?? []).map(retiredIn), err: res._json?.error };

    res = await call('POST', `${p}/batch`, { params: { object: OBJECT }, body: { operation: 'update', records: [{ id: 'c3', data: { name: 'Cy 2' } }] } });
    notes['POST /data/:object/batch update'] = { status: res._status ?? 200, retired: (res._json?.results ?? []).map((r: any) => retiredIn(r.data)), err: res._json?.error ?? res._json?.results?.[0]?.errors };

    res = await call('POST', `${p}/batch`, { params: { object: OBJECT }, body: { operation: 'upsert', records: [{ id: 'c4', data: { name: 'Di 2' } }, { id: 'u1', data: { name: 'Up new' } }] } });
    notes['POST /data/:object/batch upsert'] = { status: res._status ?? 200, retired: (res._json?.results ?? []).map((r: any) => retiredIn(r.data)), err: res._json?.error ?? res._json?.results?.map((r: any) => r.errors) };

    res = await call('POST', `${p}/batch`, { params: { object: OBJECT }, body: { operation: 'create', records: [{ data: { id: 'b1', name: 'B1' } }] } });
    notes['POST /data/:object/batch create'] = { status: res._status ?? 200, retired: (res._json?.results ?? []).map((r: any) => retiredIn(r.data)), err: res._json?.error ?? res._json?.results?.map((r: any) => r.errors) };

    res = await call('POST', `${p}/updateMany`, { params: { object: OBJECT }, body: { records: [{ id: 'c1', data: { name: 'Ada 3' } }] } });
    notes['POST /data/:object/updateMany'] = { status: res._status ?? 200, retired: (res._json?.results ?? []).map((r: any) => retiredIn(r.data)), err: res._json?.error ?? res._json?.results?.map((r: any) => r.errors) };

    res = await call('DELETE', `${p}/:id`, { params: { object: OBJECT, id: 'c7' } });
    notes['DELETE /data/:object/:id'] = { status: res._status ?? 200, body: res._json };

    // In-process verbs.
    const updated = await engine.update(OBJECT, { id: 'c2', name: 'Bo 2' });
    notes['engine.update by id'] = retiredIn(updated);
    const inserted = await engine.insert(OBJECT, { id: 'n2', name: 'New 2' });
    notes['engine.insert single'] = retiredIn(inserted);
    const outcomes: any[] = await (engine as any).insertMany(OBJECT, [{ id: 'n3', name: 'New 3' }]);
    notes['engine.insertMany'] = outcomes.map((o) => retiredIn(o.record));
    const count = await engine.update(OBJECT, { name: 'bulk' } as any, { where: { email: 'bulk@example.com' }, multi: true } as any);
    notes['engine.update multi (count)'] = count;
    const del = await engine.delete(OBJECT, { where: { email: 'bulk@example.com' }, multi: true } as any);
    notes['engine.delete multi (count)'] = del;

    notes.events = events.map((e) => ({ type: e.type, recordId: e.payload?.recordId, after: retiredIn(e.payload?.after), changes: retiredIn(e.payload?.changes) }));
    notes.hooks = hooks;
    writeFileSync(process.env.OS_PROBE_OUT ?? join(tmpdir(), 'probe-21613.json'), JSON.stringify(notes, null, 2));
    expect(true).toBe(true);
  });
});
