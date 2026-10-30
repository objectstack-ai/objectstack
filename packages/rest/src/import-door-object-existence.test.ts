// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27728, #27729] Both import doors answer for the object exactly as the data
 * door does (`POST /data/:object`), before any row or job is written:
 *
 *  - the synchronous door (`POST /data/:object/import`) refuses an unregistered
 *    object with the data door's 404 `OBJECT_NOT_FOUND`, where it used to answer
 *    200 with the refusal repeated inside every row's result (#27728);
 *  - both doors refuse an object of a DISABLED package with the data door's
 *    404 `OBJECT_PACKAGE_DISABLED`, status and body, and write no row and no
 *    `sys_import_job` row (#27729 item 1);
 *  - a legacy `ns__short` object addressed by its short name is the object
 *    behind that name at every door: the existence read and the API-exposure
 *    gate both take the item the by-name read resolves, as the data door's
 *    `registry.getObject` does, so the job door no longer refuses a name the
 *    data door serves, and the gate judges that object's `enable` instead of
 *    passing the short name through (#27729 item 2).
 *
 * A REAL `ObjectQL` engine + `ObjectStackProtocolImplementation` on a REAL
 * sqlite `:memory:` driver; nothing below the routes is a double.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { SysImportJob } from '@objectstack/platform-objects/audit';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

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

/** A plain object, the control. */
const TASK = { name: 'ex_task', label: 'Task', systemFields: false, fields };
/** An object of a package the test disables. */
const OFF_PACKAGE = 'app.ex_off';
const GADGET = { name: 'ex_gadget', label: 'Gadget', systemFields: false, fields };
/** Legacy `ns__short` objects, addressed below by their short names. */
const LEGACY_PACKAGE = 'app.ex_legacy';
const WIDGET = { name: 'exl__widget', label: 'Widget', systemFields: false, fields };
const VAULT = { name: 'exl__vault', label: 'Vault', systemFields: false, enable: { apiEnabled: false }, fields };

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
  engine.registry.installPackage({ id: OFF_PACKAGE, name: OFF_PACKAGE, version: '1.0.0' } as any, 'code');
  engine.registry.installPackage({ id: LEGACY_PACKAGE, name: LEGACY_PACKAGE, version: '1.0.0' } as any, 'code');
  engine.registry.registerObject(TASK as any);
  engine.registry.registerObject(GADGET as any, OFF_PACKAGE);
  engine.registry.registerObject(WIDGET as any, LEGACY_PACKAGE);
  engine.registry.registerObject(VAULT as any, LEGACY_PACKAGE);
  engine.registry.registerObject(SysImportJob as any);
  await engine.syncSchemas();
  // A real `single` install's Default Organization (ADR-0131 D9).
  await installDefaultOrganization(engine);
  for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as any);
  }

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const noop = () => {};
  const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
  const rest = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const routes = rest.getRoutes();
  const route = (path: string): any => {
    const found = routes.find((r: any) => r.method === 'POST' && r.path === path);
    if (!found) throw new Error(`route POST ${path} is not registered`);
    return found;
  };
  const doors = {
    data: route('/api/v1/data/:object'),
    sync: route('/api/v1/data/:object/import'),
    jobs: route('/api/v1/data/:object/import/jobs'),
  };
  return {
    engine,
    async call(door: keyof typeof doors, object: string, body: any) {
      const res = makeRes();
      await doors[door].handler({ params: { object }, body, query: {} } as any, res);
      // The synchronous door answers with `res.json` alone on success.
      return { status: res._status ?? 200, body: res._json };
    },
    /** Rows of a table, counted at the engine. */
    async count(table: string) {
      const rows = await engine.find(table, { where: {} });
      return Array.isArray(rows) ? rows.length : 0;
    },
  };
}

const rowsBody = (id: string) => ({ format: 'json', rows: [{ id, title: 'x' }] });

describe('[#27728] the synchronous import door refuses an unregistered object as the data door does', () => {
  let h: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => { h = await boot(); });

  it('answers 404 OBJECT_NOT_FOUND, the data door\'s envelope byte for byte, not 200', async () => {
    const door = await h.call('data', 'ex_no_such_object', { id: 'n1', title: 'x' });
    expect(door.status).toBe(404);
    expect(door.body?.code).toBe('OBJECT_NOT_FOUND');

    const sync = await h.call('sync', 'ex_no_such_object', rowsBody('n2'));
    expect(sync.status).toBe(404);
    expect(sync.body).toEqual(door.body);
  });

  it('a dry run and a CSV body get the same refusal, before the body is parsed', async () => {
    const door = await h.call('data', 'ex_no_such_object', { id: 'n1', title: 'x' });
    const dry = await h.call('sync', 'ex_no_such_object', { ...rowsBody('n3'), dryRun: true });
    expect(dry).toEqual({ status: 404, body: door.body });
    // Not even a parseable body is needed: the object is asked first.
    const csv = await h.call('sync', 'ex_no_such_object', { format: 'csv', csv: 'not,a\n"broken' });
    expect(csv).toEqual({ status: 404, body: door.body });
  });

  it('control: a registered object still imports (200, one row created)', async () => {
    const sync = await h.call('sync', 'ex_task', rowsBody('t1'));
    expect(sync.status).toBe(200);
    expect(sync.body).toMatchObject({ object: 'ex_task', total: 1, ok: 1, created: 1, errors: 0 });
    expect(await h.count('ex_task')).toBe(1);
  });
});

describe('[#27729 item 1] both import doors refuse a disabled package\'s object with the data door\'s answer', () => {
  let h: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => {
    h = await boot();
    h.engine.registry.disablePackage(OFF_PACKAGE);
  });

  it('the data door\'s answer is 404 OBJECT_PACKAGE_DISABLED (the reference)', async () => {
    const door = await h.call('data', 'ex_gadget', { id: 'g0', title: 'x' });
    expect(door.status).toBe(404);
    expect(door.body?.code).toBe('OBJECT_PACKAGE_DISABLED');
  });

  for (const kind of ['sync', 'jobs'] as const) {
    it(`${kind}: status and body equal the data door's, and no row and no job row is written`, async () => {
      const door = await h.call('data', 'ex_gadget', { id: 'g0', title: 'x' });
      const answer = await h.call(kind, 'ex_gadget', rowsBody('g1'));
      expect(answer.status).toBe(door.status);
      expect(answer.body).toEqual(door.body);
      expect(await h.count('sys_import_job')).toBe(0);
      expect(await h.count('ex_gadget')).toBe(0);
    });
  }
});

describe('[#27729 item 2] a legacy ns__short object is the object behind its short name at every door', () => {
  let h: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => { h = await boot(); });

  it('premise: the data door serves the short name (registry.getObject resolves it)', async () => {
    expect((h.engine.registry.getObject('widget') as any)?.name).toBe('exl__widget');
    const door = await h.call('data', 'widget', { id: 'w0', title: 'x' });
    expect(door.status).toBe(201);
  });

  it('the job door creates the job, where it used to answer OBJECT_NOT_FOUND', async () => {
    const jobs = await h.call('jobs', 'widget', rowsBody('w1'));
    expect(jobs.status).toBe(201);
    expect(jobs.body).toMatchObject({ object: 'widget', status: 'pending', total: 1 });
    expect(await h.count('sys_import_job')).toBe(1);
  });

  it('the synchronous door imports under the short name', async () => {
    const sync = await h.call('sync', 'widget', rowsBody('w2'));
    expect(sync.status).toBe(200);
    expect(sync.body).toMatchObject({ object: 'widget', ok: 1, created: 1 });
  });

  it('an unregistered short name is still OBJECT_NOT_FOUND at both import doors', async () => {
    const door = await h.call('data', 'gizmo', { id: 'z0', title: 'x' });
    expect(door.status).toBe(404);
    expect(await h.call('sync', 'gizmo', rowsBody('z1'))).toEqual(door);
    expect(await h.call('jobs', 'gizmo', rowsBody('z2'))).toEqual(door);
    expect(await h.count('sys_import_job')).toBe(0);
  });

  it('the exposure gate judges the resolved object: apiEnabled:false hides it under its short name too', async () => {
    const full = await h.call('data', 'exl__vault', { id: 'v0', title: 'x' });
    expect(full.status).toBe(404);
    expect(full.body?.code).toBe('OBJECT_API_DISABLED');
    for (const kind of ['data', 'sync', 'jobs'] as const) {
      const short = await h.call(kind, 'vault', kind === 'data' ? { id: 'v1', title: 'x' } : rowsBody('v1'));
      expect(short.status).toBe(404);
      expect(short.body?.code).toBe('OBJECT_API_DISABLED');
    }
    expect(await h.count('exl__vault')).toBe(0);
    expect(await h.count('sys_import_job')).toBe(0);
  });
});
