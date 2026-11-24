// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// [#35402] The REST face of Change Owner: the single and the bulk door.

import { describe, it, expect, vi, afterEach } from 'vitest';
// The first load of the engine is paid at collection, not inside a test's clock:
// the server under test reaches it through dynamic imports.
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { OWNER_FIELD_DEF } from '@objectstack/spec/data';
import { RestServer } from './rest-server';
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from './default-organization.testkit.js';

function mockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}
function mockProtocol() {
  return { getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }), getMetaTypes: vi.fn().mockResolvedValue([]), getMetaItems: vi.fn().mockResolvedValue([]) };
}
function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  res.end = vi.fn(() => res);
  return res;
}

const CALLER = { userId: 'u_manager', tenantId: 'org_1' };

const SCHEMAS: Record<string, unknown> = {
  lead: { name: 'lead', label: 'Lead', sharingModel: 'private', fields: { owner_id: OWNER_FIELD_DEF, queue: { type: 'text' } } },
  // A `private` object whose author switched the action off (ruling 7000907189, acceptance).
  pinned_lead: { name: 'pinned_lead', sharingModel: 'private', userActions: { transfer: false }, fields: { owner_id: OWNER_FIELD_DEF } },
};

/** The owner guard's refusal without the transfer grant, as plugin-security throws it. */
const transferDenied = () => Object.assign(
  new Error("[Security] Access denied: 'owner_id' on 'lead' is system-managed — changing the owner requires the transfer grant (allowTransfer or modifyAllRecords)"),
  { name: 'PermissionDeniedError', code: 'PERMISSION_DENIED', status: 403 },
);

function mockEngine(refuse: (id: string) => unknown = () => undefined, disabledPackageObjects: string[] = []) {
  const rows: Record<string, any>[] = [{ id: 'l1', owner_id: 'u_a' }, { id: 'l2', owner_id: 'u_b' }];
  const users = [{ id: 'u_next', banned: false }, { id: 'u_gone', banned: true }];
  return {
    rows,
    getSchema: vi.fn((name: string) => SCHEMAS[name]),
    // The engine registry's package predicate: a disabled package's object stays registered (getSchema resolves it).
    registry: { isObjectPackageDisabled: vi.fn((name: string) => disabledPackageObjects.includes(name)) },
    // Equality on plain fields only; a combinator this double does not implement is refused, never read as a field.
    find: vi.fn(async (o: string, q: any) => (o === 'sys_user' ? users : rows).filter((r: any) =>
      Object.entries(q.where).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`mock find: the ${k} combinator is not implemented`);
        return r[k] === v;
      })).slice(0, q.limit ?? Infinity)),
    update: vi.fn(async (_o: string, data: any, opts: any) => {
      assertEngineUpdateDispatch(data, opts);
      const row = rows.find((r) => r.id === opts.where.id);
      if (!row) return null;
      const refusal = refuse(row.id);
      if (refusal) throw refusal;
      Object.assign(row, data);
      return row;
    }),
  };
}

function buildServer(engine: any, opts: { caller?: any; messaging?: unknown } = {}) {
  const rest = new RestServer(
    mockServer() as any, mockProtocol() as any, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined,
    engine === undefined ? undefined : async () => engine,
  );
  vi.spyOn(rest as any, 'resolveExecCtx').mockResolvedValue(opts.caller === undefined ? CALLER : opts.caller);
  (rest as any).kernelServiceProvider = async (name: string) => (name === 'messaging' ? opts.messaging : undefined);
  rest.registerRoutes();
  const routes = rest.getRoutes();
  return {
    single: routes.find((r) => r.method === 'POST' && r.path === '/api/v1/data/:object/:id/change-owner'),
    bulk: routes.find((r) => r.method === 'POST' && r.path === '/api/v1/data/:object/change-owner'),
    routes,
  };
}

const req = (params: Record<string, string>, body: unknown, query: Record<string, unknown> = {}) =>
  ({ method: 'POST', params, headers: {}, query, body }) as any;

describe('[#35402] POST /data/:object/:id/change-owner', () => {
  it('registers the bulk literal before the greedy CRUD matchers', () => {
    const { routes } = buildServer(mockEngine());
    const at = (method: string, path: string) => routes.findIndex((r) => r.method === method && r.path === path);
    const bulk = at('POST', '/api/v1/data/:object/change-owner');
    expect(bulk).toBeGreaterThanOrEqual(0);
    const crud = routes.findIndex((r) => r.path === '/api/v1/data/:object/:id');
    expect(crud === -1 || bulk < crud).toBe(true);
  });

  it('hands the record to the person, through update as the caller, and answers it', async () => {
    const engine = mockEngine();
    const { single } = buildServer(engine);
    const res = mockRes();
    await single!.handler(req({ object: 'lead', id: 'l1' }, { ownerId: 'u_next' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: { object: 'lead', id: 'l1', ownerId: 'u_next', notified: false } });
    expect(engine.update).toHaveBeenCalledWith('lead', { owner_id: 'u_next' }, { where: { id: 'l1' }, context: CALLER, strictReadonlyWrites: true });
  });

  it('an object that switched the action off is refused 403 CHANGE_OWNER_DISABLED, nothing read or written', async () => {
    const engine = mockEngine();
    const { single } = buildServer(engine);
    const res = mockRes();
    await single!.handler(req({ object: 'pinned_lead', id: 'p1' }, { ownerId: 'u_next' }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('CHANGE_OWNER_DISABLED');
    expect(engine.find).not.toHaveBeenCalled();
    expect(engine.update).not.toHaveBeenCalled();
  });

  it('edit without the transfer grant answers the /data write door\'s 403 PERMISSION_DENIED', async () => {
    const engine = mockEngine(() => transferDenied());
    const { single } = buildServer(engine);
    const res = mockRes();
    await single!.handler(req({ object: 'lead', id: 'l1' }, { ownerId: 'u_next' }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
    expect(engine.rows[0]!.owner_id).toBe('u_a');
  });

  it('a record out of reach answers 404 RECORD_NOT_FOUND', async () => {
    const { single } = buildServer(mockEngine());
    const res = mockRes();
    await single!.handler(req({ object: 'lead', id: 'l9' }, { ownerId: 'u_next' }), res);
    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('RECORD_NOT_FOUND');
  });

  it('a banned person is refused with the field code, before any write', async () => {
    const engine = mockEngine();
    const { single } = buildServer(engine);
    const res = mockRes();
    await single!.handler(req({ object: 'lead', id: 'l1' }, { ownerId: 'u_gone' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields[0]).toMatchObject({ field: 'ownerId', code: 'reference_user_banned' });
    expect(engine.update).not.toHaveBeenCalled();
  });

  it('[ADR-0142] moves the record to a queue', async () => {
    const engine = mockEngine();
    const { single } = buildServer(engine);
    const res = mockRes();
    await single!.handler(req({ object: 'lead', id: 'l1' }, { queue: 'triage' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({ object: 'lead', id: 'l1', ownerId: null, queue: 'triage', notified: false });
    expect(engine.update).toHaveBeenCalledWith('lead', { owner_id: null, queue: 'triage' }, { where: { id: 'l1' }, context: CALLER, strictReadonlyWrites: true });
  });

  it('notify sends through the messaging service and says so', async () => {
    const messaging = { emit: vi.fn(async () => ({ delivered: 0, enqueued: 1 })) };
    const { single } = buildServer(mockEngine(), { messaging });
    const res = mockRes();
    await single!.handler(req({ object: 'lead', id: 'l1' }, { ownerId: 'u_next', notify: true }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.notified).toBe(true);
    expect(messaging.emit).toHaveBeenCalledWith(expect.objectContaining({ topic: 'record.owner_changed', audience: ['u_next'] }));
  });

  it('refuses a body that is not the closed shape, and an unknown query parameter, before anything is written', async () => {
    const bodies: unknown[] = [
      {}, null, [], 'u_next',
      { ownerId: 'u_next', cascade: true },
      { ownerId: 'u_next', queue: 'triage' },
      { ownerId: '' },
      { ownerId: 'u_next', notify: 'yes' },
      { queue: 'triage', notify: true },
    ];
    for (const body of bodies) {
      const engine = mockEngine();
      const { single } = buildServer(engine);
      const res = mockRes();
      await single!.handler(req({ object: 'lead', id: 'l1' }, body), res);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(engine.update).not.toHaveBeenCalled();
    }
    const engine = mockEngine();
    const { single } = buildServer(engine);
    const res = mockRes();
    await single!.handler(req({ object: 'lead', id: 'l1' }, { ownerId: 'u_next' }, { notify: 'true' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(engine.update).not.toHaveBeenCalled();
  });

  it('an anonymous caller is refused before anything is read', async () => {
    const engine = mockEngine();
    const { single } = buildServer(engine, { caller: null });
    const res = mockRes();
    await single!.handler(req({ object: 'lead', id: 'l1' }, { ownerId: 'u_next' }), res);
    expect(res.statusCode).toBe(401);
    expect(engine.getSchema).not.toHaveBeenCalled();
    expect(engine.update).not.toHaveBeenCalled();
  });

  it('answers 501 when no data engine is wired', async () => {
    const { single } = buildServer(undefined);
    const res = mockRes();
    await single!.handler(req({ object: 'lead', id: 'l1' }, { ownerId: 'u_next' }), res);
    expect(res.statusCode).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });
});

/**
 * A `readonlyWhen` lock on the owner column that holds for the record, over a
 * REAL `ObjectQL` + SQLite `:memory:`: the engine strips a locked key, so the
 * door's answer has to come from what was saved. Each owner write passes
 * `strictReadonlyWrites`, so the strip is the row's refusal and nothing is
 * written; the stored row is read back to prove it.
 */
describe('POST /data/:object/(:id/)change-owner — a readonlyWhen lock on the owner, over a real engine', () => {
  const OBJECT = 'case_owner_lock';
  const SYS = { isSystem: true, userId: 'u_system', tenantId: DEFAULT_ORGANIZATION_ID };
  const MEMBER = { userId: 'u_manager', tenantId: DEFAULT_ORGANIZATION_ID };
  const SENT = { delivered: 0, enqueued: 1 };

  const live: ObjectQL[] = [];
  afterEach(async () => {
    while (live.length) {
      try { await live.pop()?.destroy(); } catch { /* noop */ }
    }
  });

  async function boot() {
    const engine = new ObjectQL();
    live.push(engine);
    engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
    await engine.init();
    engine.registry.registerObject({
      name: 'sys_user', label: 'User', managedBy: 'better-auth',
      fields: { name: { type: 'text' }, banned: { type: 'boolean' }, ban_expires: { type: 'datetime' } },
    } as any, '@objectstack/rest');
    engine.registry.registerObject({
      name: OBJECT, label: 'Case', sharingModel: 'private',
      fields: {
        subject: { type: 'text' },
        status: { type: 'text' },
        // The platform injects the owner and queue columns; the author locks the owner once the case is closed.
        owner_id: { ...OWNER_FIELD_DEF, readonlyWhen: "record.status == 'closed'" },
      },
    } as any, '@objectstack/rest');
    await engine.syncSchemas();
    await installDefaultOrganization(engine as any);
    for (const id of ['u_a', 'u_next', 'u_manager']) await engine.insert('sys_user', { id, name: id, banned: false }, { context: SYS });
    for (const [id, status] of [['k_open', 'open'], ['k_closed', 'closed'], ['k_open2', 'open']] as const) {
      await engine.insert(OBJECT, { id, subject: id, status, owner_id: 'u_a' }, { context: SYS });
    }
    const stored = async (id: string) => (await engine.find(OBJECT, { where: { id }, fields: ['id', 'owner_id', 'queue'], context: SYS }))[0];
    return { engine, stored };
  }

  it('single: the locked record answers the refusal, not 200; owner unchanged, nobody told', async () => {
    const { engine, stored } = await boot();
    const messaging = { emit: vi.fn(async () => SENT) };
    const { single } = buildServer(engine, { caller: MEMBER, messaging });
    const res = mockRes();
    await single!.handler(req({ object: OBJECT, id: 'k_closed' }, { ownerId: 'u_next', notify: true }), res);
    expect(res.statusCode, JSON.stringify(res.body)).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FIELD_NOT_ACCESSIBLE');
    expect((await stored('k_closed'))?.owner_id).toBe('u_a');
    expect(messaging.emit).not.toHaveBeenCalled();

    // The control: the same door moves an open record of the same object.
    const ok = mockRes();
    await single!.handler(req({ object: OBJECT, id: 'k_open' }, { ownerId: 'u_next' }), ok);
    expect(ok.statusCode, JSON.stringify(ok.body)).toBe(200);
    expect((await stored('k_open'))?.owner_id).toBe('u_next');
  });

  it('bulk: the locked row is listed under failures with its code, the open rows move, one notice names only them', async () => {
    const { engine, stored } = await boot();
    const messaging = { emit: vi.fn(async () => SENT) };
    const { bulk } = buildServer(engine, { caller: MEMBER, messaging });
    const res = mockRes();
    await bulk!.handler(req({ object: OBJECT }, { ids: ['k_open', 'k_closed', 'k_open2'], ownerId: 'u_next', notify: true }), res);
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ updated: 2, failed: 1, notified: true });
    expect(res.body.data.failures.map((f: any) => [f.id, f.code])).toEqual([['k_closed', 'FIELD_NOT_ACCESSIBLE']]);
    expect((await stored('k_closed'))?.owner_id).toBe('u_a');
    expect(messaging.emit).toHaveBeenCalledTimes(1);
    expect((messaging.emit.mock.calls[0] as any[])[0].payload.recordIds).toEqual(['k_open', 'k_open2']);
  });

  it('[ADR-0142 D3] a queue target whose owner_id is locked: refused, and the queue does not land either', async () => {
    const { engine, stored } = await boot();
    const { single, bulk } = buildServer(engine, { caller: MEMBER });
    const res = mockRes();
    await single!.handler(req({ object: OBJECT, id: 'k_closed' }, { queue: 'triage' }), res);
    expect(res.statusCode, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error.code).toBe('FIELD_NOT_ACCESSIBLE');
    expect(await stored('k_closed')).toMatchObject({ owner_id: 'u_a', queue: null });

    const many = mockRes();
    await bulk!.handler(req({ object: OBJECT }, { ids: ['k_closed', 'k_open'], queue: 'triage' }), many);
    expect(many.statusCode, JSON.stringify(many.body)).toBe(200);
    expect(many.body.data).toMatchObject({ ownerId: null, queue: 'triage', updated: 1, failed: 1 });
    expect(many.body.data.failures.map((f: any) => [f.id, f.code])).toEqual([['k_closed', 'FIELD_NOT_ACCESSIBLE']]);
    expect(await stored('k_closed')).toMatchObject({ owner_id: 'u_a', queue: null });
  });

  it('an emit that resolves with zero delivered and zero enqueued answers notified: false, and the move stands', async () => {
    const { engine, stored } = await boot();
    const messaging = { emit: vi.fn(async () => ({ delivered: 0, enqueued: 0 })) };
    const { single } = buildServer(engine, { caller: MEMBER, messaging });
    const res = mockRes();
    await single!.handler(req({ object: OBJECT, id: 'k_open' }, { ownerId: 'u_next', notify: true }), res);
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ ownerId: 'u_next', notified: false });
    expect(messaging.emit).toHaveBeenCalledTimes(1);
    expect((await stored('k_open'))?.owner_id).toBe('u_next');
  });
});

describe('[#35402] POST /data/:object/change-owner — bulk', () => {
  it('a mixed batch answers 200 with a per-row report, every refused row listed with the door\'s code', async () => {
    const engine = mockEngine((id) => (id === 'l2' ? transferDenied() : undefined));
    const { bulk } = buildServer(engine);
    const res = mockRes();
    await bulk!.handler(req({ object: 'lead' }, { ids: ['l1', 'l2', 'l9'], ownerId: 'u_next' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({ object: 'lead', field: 'owner_id', ownerId: 'u_next', updated: 1, failed: 2, notified: false });
    expect(res.body.data.failures.map((f: any) => [f.id, f.code])).toEqual([['l2', 'PERMISSION_DENIED'], ['l9', 'RECORD_NOT_FOUND']]);
    expect(engine.update.mock.calls.map((c: any[]) => c[2])).toEqual([
      { where: { id: 'l1' }, context: CALLER, strictReadonlyWrites: true },
      { where: { id: 'l2' }, context: CALLER, strictReadonlyWrites: true },
      { where: { id: 'l9' }, context: CALLER, strictReadonlyWrites: true },
    ]);
  });

  it('an object that switched the action off is refused as a whole, 403 CHANGE_OWNER_DISABLED', async () => {
    const engine = mockEngine();
    const { bulk } = buildServer(engine);
    const res = mockRes();
    await bulk!.handler(req({ object: 'pinned_lead' }, { ids: ['p1'], ownerId: 'u_next' }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('CHANGE_OWNER_DISABLED');
    expect(engine.update).not.toHaveBeenCalled();
  });

  it('refuses a missing, empty, repeated or over-cap id list before any write', async () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => `l${i}`);
    for (const ids of [undefined, 'l1', [], ['l1', 'l1'], [''], tooMany]) {
      const engine = mockEngine();
      const { bulk } = buildServer(engine);
      const res = mockRes();
      await bulk!.handler(req({ object: 'lead' }, { ids, ownerId: 'u_next' }), res);
      expect(res.statusCode, JSON.stringify(ids)?.slice(0, 40)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(engine.update).not.toHaveBeenCalled();
    }
  });
});

describe('[#36261] Change Owner on an object of a disabled package', () => {
  it('the single door answers the /data door\'s 404 OBJECT_PACKAGE_DISABLED: no write, no notification', async () => {
    const engine = mockEngine(undefined, ['lead']);
    const messaging = { emit: vi.fn(async () => ({})) };
    const { single } = buildServer(engine, { messaging });
    const res = mockRes();
    await single!.handler(req({ object: 'lead', id: 'l1' }, { ownerId: 'u_next', notify: true }), res);
    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('OBJECT_PACKAGE_DISABLED');
    expect(engine.update).not.toHaveBeenCalled();
    expect(messaging.emit).not.toHaveBeenCalled();
    expect(engine.rows[0]!.owner_id).toBe('u_a');
  });

  it('the bulk door refuses the whole call 404 OBJECT_PACKAGE_DISABLED: no write, no notification', async () => {
    const engine = mockEngine(undefined, ['lead']);
    const messaging = { emit: vi.fn(async () => ({})) };
    const { bulk } = buildServer(engine, { messaging });
    const res = mockRes();
    await bulk!.handler(req({ object: 'lead' }, { ids: ['l1', 'l2'], ownerId: 'u_next', notify: true }), res);
    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('OBJECT_PACKAGE_DISABLED');
    expect(engine.update).not.toHaveBeenCalled();
    expect(messaging.emit).not.toHaveBeenCalled();
  });

  it('control: the same object with its package enabled answers 200, single and bulk', async () => {
    const engine = mockEngine();
    const { single, bulk } = buildServer(engine);
    const one = mockRes();
    await single!.handler(req({ object: 'lead', id: 'l1' }, { ownerId: 'u_next' }), one);
    expect(one.statusCode).toBe(200);
    const many = mockRes();
    await bulk!.handler(req({ object: 'lead' }, { ids: ['l2'], ownerId: 'u_next' }), many);
    expect(many.statusCode).toBe(200);
    expect(many.body.data).toMatchObject({ updated: 1, failed: 0 });
    expect(engine.registry.isObjectPackageDisabled).toHaveBeenCalledWith('lead');
  });
});
