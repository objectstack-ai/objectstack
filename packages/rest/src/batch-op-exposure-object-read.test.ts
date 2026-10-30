// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27899] The cross-object batch door (`POST {basePath}/batch`) judges each
 * op's API exposure on the object the data door would serve for the op's
 * name, and refuses it with the data door's own answer.
 *
 * The `/data/:object` exposure gate reads its object by name, through the read
 * that resolves a legacy `ns__short` object from its short name exactly as the
 * data door's `registry.getObject` does (#27729). The batch door's per-op gate
 * keyed the object LIST by each item's declared name instead, and the list
 * carries no such resolution: an op naming such an object by its short name
 * found "no object" there, passed as unknown, and was then written by the
 * engine, which does resolve the name. It now asks the `/data` gate's read, so
 * every data door gives one answer about whether an object is exposed.
 *
 * A REAL `ObjectQL` engine + `ObjectStackProtocolImplementation` on a REAL
 * sqlite `:memory:` driver, with `objectQLProvider` wired so the batch door is
 * reachable rather than answering 501; nothing below the routes is a double.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

const fields = {
  id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
  title: { name: 'title', type: 'text' as const, label: 'Title' },
};

/** Legacy `ns__short` objects of one package, addressed below by short name. */
const LEGACY_PACKAGE = 'app.ex_legacy';
/** Exposed: no `enable` block. */
const WIDGET = { name: 'exl__widget', label: 'Widget', systemFields: false, fields };
/** Hidden from the API. */
const VAULT = { name: 'exl__vault', label: 'Vault', systemFields: false, enable: { apiEnabled: false }, fields };
/** Exposed for reads only. */
const LEDGER = { name: 'exl__ledger', label: 'Ledger', systemFields: false, enable: { apiMethods: ['get', 'list'] }, fields };
/** A plain-named object hidden from the API: the gate's answer before this change. */
const SECRET = { name: 'ex_secret', label: 'Secret', systemFields: false, enable: { apiEnabled: false }, fields };

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
  engine.registry.installPackage({ id: LEGACY_PACKAGE, name: LEGACY_PACKAGE, version: '1.0.0' } as any, 'code');
  for (const o of [WIDGET, VAULT, LEDGER]) engine.registry.registerObject(o as any, LEGACY_PACKAGE);
  engine.registry.registerObject(SECRET as any);
  await engine.syncSchemas();

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const noop = () => {};
  const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
  const rest = new RestServer(
    server as any, protocol as any, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined, // kernelManager, envRegistry, defaultEnvIdProvider, authServiceProvider
    (async () => engine) as any,                // objectQLProvider (positional arg #8)
  );
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const routes = rest.getRoutes();
  const route = (path: string): any => {
    const found = routes.find((r: any) => r.method === 'POST' && r.path === path);
    if (!found) throw new Error(`route POST ${path} is not registered`);
    return found;
  };
  const doors = {
    batch: route('/api/v1/batch'),
    data: route('/api/v1/data/:object'),
    createMany: route('/api/v1/data/:object/createMany'),
  };
  const transaction = vi.spyOn(engine, 'transaction');
  const call = async (door: keyof typeof doors, object: string | undefined, body: unknown) => {
    const res = makeRes();
    await doors[door].handler({ method: 'POST', params: object ? { object } : {}, query: {}, headers: {}, body } as any, res);
    return { status: res._status ?? 200, body: res._json };
  };
  return {
    engine,
    transaction,
    batch: (operations: unknown[]) => call('batch', undefined, { operations }),
    data: (object: string, record: Record<string, unknown>) => call('data', object, record),
    createMany: (object: string, records: Array<Record<string, unknown>>) => call('createMany', object, records),
    /** Rows of a table, counted at the engine. */
    async count(table: string) {
      const rows = await engine.find(table, { where: {} });
      return Array.isArray(rows) ? rows.length : 0;
    },
  };
}

describe('[#27899] the batch door judges each op on the object the data door serves for its name', () => {
  let h: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => { h = await boot(); });

  it('premise: the data door resolves a legacy short name and refuses the hidden object behind it', async () => {
    expect((h.engine.registry.getObject('vault') as any)?.name).toBe('exl__vault');
    const door = await h.data('vault', { id: 'v0', title: 'x' });
    expect(door.status).toBe(404);
    expect(door.body?.code).toBe('OBJECT_API_DISABLED');
  });

  for (const action of ['create', 'update', 'delete'] as const) {
    it(`a ${action} op on a hidden object is refused with the data door's answer, before the transaction opens`, async () => {
      const door = await h.data('vault', { id: 'v0', title: 'x' });
      const op = action === 'create'
        ? { object: 'vault', action, data: { id: 'v1', title: 'x' } }
        : { object: 'vault', action, id: 'v1', ...(action === 'update' ? { data: { title: 'y' } } : {}) };
      const batch = await h.batch([op]);
      expect(batch).toEqual({ status: door.status, body: door.body });
      expect(h.transaction).not.toHaveBeenCalled();
      expect(await h.count('exl__vault')).toBe(0);
    });
  }

  it('an op the object does not expose is refused with the bulk data door\'s 405, status and body', async () => {
    const bulk = await h.createMany('ledger', [{ id: 'l0', title: 'x' }]);
    expect(bulk.status).toBe(405);
    expect(bulk.body?.code).toBe('OBJECT_API_METHOD_NOT_ALLOWED');
    const batch = await h.batch([{ object: 'ledger', action: 'create', data: { id: 'l1', title: 'x' } }]);
    expect(batch).toEqual(bulk);
    expect(h.transaction).not.toHaveBeenCalled();
    expect(await h.count('exl__ledger')).toBe(0);
  });

  it('one refused op refuses the whole batch: an exposed op before it is never written', async () => {
    const batch = await h.batch([
      { object: 'widget', action: 'create', data: { id: 'w1', title: 'x' } },
      { object: 'vault', action: 'create', data: { id: 'v1', title: 'x' } },
    ]);
    expect(batch.status).toBe(404);
    expect(batch.body?.code).toBe('OBJECT_API_DISABLED');
    expect(h.transaction).not.toHaveBeenCalled();
    expect(await h.count('exl__widget')).toBe(0);
    expect(await h.count('exl__vault')).toBe(0);
  });

  // ── controls: answers that do not move ────────────────────────────────────

  it('control: the hidden object\'s full name is refused, as it already was', async () => {
    const door = await h.data('exl__vault', { id: 'v0', title: 'x' });
    expect(door.status).toBe(404);
    const batch = await h.batch([{ object: 'exl__vault', action: 'create', data: { id: 'v1', title: 'x' } }]);
    expect(batch).toEqual({ status: door.status, body: door.body });
    expect(await h.count('exl__vault')).toBe(0);
  });

  it('control: an exposed object is written under its short name and under its full name', async () => {
    const batch = await h.batch([
      { object: 'widget', action: 'create', data: { id: 'w1', title: 'x' } },
      { object: 'exl__widget', action: 'create', data: { id: 'w2', title: 'x' } },
    ]);
    expect(batch.status).toBe(200);
    expect(batch.body?.results).toHaveLength(2);
    expect(h.transaction).toHaveBeenCalledTimes(1);
    expect(await h.count('exl__widget')).toBe(2);
  });

  it('control: a plain-named hidden object is refused, as it already was', async () => {
    const door = await h.data('ex_secret', { id: 's0', title: 'x' });
    expect(door.status).toBe(404);
    expect(door.body?.code).toBe('OBJECT_API_DISABLED');
    const batch = await h.batch([{ object: 'ex_secret', action: 'create', data: { id: 's1', title: 'x' } }]);
    expect(batch).toEqual({ status: door.status, body: door.body });
    expect(h.transaction).not.toHaveBeenCalled();
    expect(await h.count('ex_secret')).toBe(0);
  });
});
