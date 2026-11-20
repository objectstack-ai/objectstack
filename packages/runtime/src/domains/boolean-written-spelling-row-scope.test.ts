// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A boolean field is stored as a boolean whatever spelling the caller sends,
 * on both faces of `TursoDriver`, so a row-level `using` written in negative
 * form answers each row by the boolean it was written as.
 *
 * Three writers hand the store the STRING `'true'`:
 *
 *  - the engine's own door (`engine.insert`): it already writes the boolean its
 *    validator judged (`normalizeNumericStringValues`), the control;
 *  - the driver's door, called directly (a plugin or a migration that writes
 *    past the engine);
 *  - a `beforeInsert` hook that assigns the string: the engine's rewrite runs
 *    before the hooks, so the assignment reaches the driver as sent, and the
 *    driver's door is the one that stores it.
 *
 * The driver's write door binds every accepted spelling as the boolean it
 * spells, so all three land as a boolean, and a row-level `using` written in
 * negative form (`restricted != true` and its siblings) answers each row by
 * the boolean it was written as, on `find`, `count`, `findOne`, the REST list
 * and get, and the REST delete. Every read below happens on the boot that
 * wrote the rows: the local face's boot convergence rewrites a TEXT cell on
 * the next boot, and the remote face has none, so a later boot would not tell
 * the faces' write doors apart.
 *
 * Both faces run over an embedded libSQL file: the local face by `file:` URL,
 * the remote face through a real `@libsql/client` handed in as its client.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterAll, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ObjectQL } from '@objectstack/objectql';
import { TursoDriver } from '@objectstack/driver-turso';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from '@objectstack/rest';
// Paid at collection, not inside a case's clocked window: the stack reaches it by dynamic import.
import '@objectstack/metadata';
import { installDefaultOrganization } from '../default-organization.testkit.js';

const OBJ = 'bool_spelling_row_scope';
const SYS_CTX = { isSystem: true, userId: 'usr_system' };
const MEMBER_CTX = { userId: 'usr_bool_spelling_member', positions: [], permissions: ['member_default'], posture: 'MEMBER' };

/** The rows the policy must withhold (each written as true), and the one it must serve. */
const WITHHELD = ['driver_text_true', 'engine_text_true', 'hook_text_true'] as const;
const SERVED = ['engine_false'];

/** Negative-form `using` shapes, over the boolean field and over the toggle field. */
const SHAPES = ['restricted != true', '!(record.restricted in [true])', 'record.locked != true'] as const;

type Face = 'local' | 'remote';
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function mockHttpServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function response() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res, setHeader: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

async function boot(face: Face, file: string, using: string) {
  const driver = face === 'local'
    ? new TursoDriver({ url: `file:${file}` })
    : new TursoDriver({ url: 'libsql://bool-spelling-row-scope.turso.io', client: createClient({ url: `file:${file}` }) });
  const engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.test.bool-spelling-row-scope',
    name: 'bool spelling row scope',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [{
      name: OBJ,
      label: 'Doc',
      sharingModel: 'public_read_write',
      fields: {
        title: { name: 'title', type: 'text' },
        restricted: { name: 'restricted', type: 'boolean' },
        locked: { name: 'locked', type: 'toggle' },
      },
    }],
  } as never);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);

  const memberSet = PermissionSetSchema.parse({
    name: 'member_default',
    label: 'Member',
    objects: { [OBJ]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    rowLevelSecurity: [{ name: 'negative_form', object: OBJ, operation: 'all', using }],
  });
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) => (type === 'permission' ? (name === memberSet.name ? memberSet : null) : engine.getSchema(name) ?? null),
      list: async () => [memberSet],
    },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);

  const server = new RestServer(mockHttpServer() as any, new ObjectStackProtocolImplementation(engine as any) as any, { api: { requireAuth: false } } as any);
  (server as any).resolveExecCtx = async () => ({ ...MEMBER_CTX });
  server.registerRoutes();
  const routes = server.getRoutes();
  const rest = async (method: string, path: string, id?: string) => {
    const route = routes.find((r: any) => r.method === method && r.path === path);
    if (!route) throw new Error(`no route ${method} ${path}`);
    const res = response();
    await route.handler({ params: { object: OBJ, ...(id ? { id } : {}) }, query: {}, headers: {} } as any, res);
    return { status: res._status ?? 200, body: res._json };
  };
  return { engine, driver, rest };
}

/** Seed the four rows on the boot that reads them. */
async function seed(engine: ObjectQL, driver: TursoDriver): Promise<void> {
  // A server-side hook that assigns the string, after the engine's own rewrite has run.
  engine.registerHook('beforeInsert', async (ctx: any) => {
    if (ctx.input?.data?.title === 'hook') { ctx.input.data.restricted = 'true'; ctx.input.data.locked = 'true'; }
  }, { object: OBJ });
  await engine.insert(OBJ, { id: 'engine_false', title: 'engine', restricted: false, locked: false } as never, { context: SYS_CTX } as never);
  await engine.insert(OBJ, { id: 'engine_text_true', title: 'engine', restricted: 'true', locked: 'true' } as never, { context: SYS_CTX } as never);
  await engine.insert(OBJ, { id: 'hook_text_true', title: 'hook', restricted: false, locked: false } as never, { context: SYS_CTX } as never);
  await driver.create(OBJ, { id: 'driver_text_true', title: 'driver', organization_id: 'org_default', restricted: 'true', locked: 'true' });
}

async function rawCells(file: string): Promise<Record<string, string>> {
  const c: Client = createClient({ url: `file:${file}` });
  try {
    const rs = await c.execute(`select id, typeof(restricted) as t, typeof(locked) as lt, title from ${OBJ} order by id`);
    return Object.fromEntries(rs.rows.map((r: any) => [String(r.id), `${r.t}/${r.lt}`]));
  } finally {
    c.close();
  }
}

for (const face of ['local', 'remote'] as const) {
  describe(`TursoDriver ${face.toUpperCase()} — a negative-form row scope answers a boolean written as the string true by its boolean`, () => {
    for (const using of SHAPES) {
      it(`using: ${using}`, async () => {
        const dir = mkdtempSync(join(tmpdir(), `bool-spelling-${face}-`));
        dirs.push(dir);
        const file = join(dir, 'db.sqlite');
        const { engine, driver, rest } = await boot(face, file, using);
        try {
          await seed(engine, driver);
          // What landed: a boolean on every row, never TEXT. The remote `toggle` column has TEXT affinity,
          // so its canonical cell is the text '1' / '0' there.
          const toggleForm = face === 'remote' ? 'text' : 'integer';
          expect(await rawCells(file)).toEqual(Object.fromEntries(
            [...SERVED, ...WITHHELD].sort().map((id) => [id, `integer/${toggleForm}`]),
          ));

          const found = (await engine.find(OBJ, { context: MEMBER_CTX } as never)) as Array<{ id: string }>;
          const one: Record<string, unknown> = {};
          const got: Record<string, number> = {};
          for (const id of WITHHELD) {
            one[id] = await engine.findOne(OBJ, { where: { id }, context: MEMBER_CTX } as never);
            got[id] = (await rest('GET', '/api/v1/data/:object/:id', id)).status;
          }
          const listed = await rest('GET', '/api/v1/data/:object');
          const deleted: Record<string, number> = {};
          for (const id of WITHHELD) deleted[id] = (await rest('DELETE', '/api/v1/data/:object/:id', id)).status;

          expect({
            find: found.map((r) => r.id).sort(),
            count: await engine.count(OBJ, { context: MEMBER_CTX } as never),
            findOne: one,
            restList: ((listed.body?.records ?? []) as Array<{ id: string }>).map((r) => r.id).sort(),
            restGet: got,
            restDelete: deleted,
          }).toEqual({
            find: SERVED,
            count: SERVED.length,
            findOne: Object.fromEntries(WITHHELD.map((id) => [id, null])),
            restList: SERVED,
            restGet: Object.fromEntries(WITHHELD.map((id) => [id, 404])),
            restDelete: Object.fromEntries(WITHHELD.map((id) => [id, 404])),
          });
          // The refused deletes removed nothing.
          expect(Object.keys(await rawCells(file)).sort()).toEqual([...SERVED, ...WITHHELD].sort());
        } finally {
          await engine.destroy();
        }
      });
    }
  });
}
