// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21923] The metadata door and the datasource admin door agree on a runtime
// datasource — in the same boot and after a restart — over the real showcase
// composition.
//
// ## What was broken
//
// Measured on this composition before the fix:
//
//   - `PUT /api/v1/meta/datasource/<name>` saved a datasource (200), and in the
//     same boot `GET /api/v1/datasources` omitted it and the admin door's
//     `PATCH` answered "not found": the save wrote `sys_metadata`, never the
//     MetadataService slot the admin door lists, and opened no pool;
//   - after a restart the boot restore registered the row, and the admin read
//     served it as `origin: 'code'` — `origin ?? 'code'` read a body with no
//     `origin` as a code definition, and a body asserting `origin: 'code'` as
//     one too — so its `PATCH` was refused as "code-defined";
//   - the other direction: a datasource the admin door created was stored with
//     no `checksum`, so the metadata door's optimistic lock never matched it,
//     and its `PUT` and `DELETE` answered `409 METADATA_CONFLICT`.
//
// ## What each case pins (triage's pins)
//
//   - a datasource the metadata door creates, with no `origin`, is listed and
//     editable through the admin door in the same boot (with a live pool, as
//     an admin create has) and after a restart;
//   - a body asserting `origin: 'code'` stays runtime: the admin door's origin
//     comes from the host's code-datasource set, never from the record;
//   - a datasource the admin door creates is edited and removed through the
//     metadata door, and the removal leaves the admin door in the same boot;
//   - a code-defined datasource stays refused at the admin door.
//
// The verify harness composes the datasource-admin service but not its REST
// routes, so this file mounts `registerDatasourceAdminRoutes` the way
// `packages/cli/src/commands/serve.ts` does. The working directory is a
// temporary one because the showcase's external datasource and its fixture
// both name a cwd-relative SQLite file.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack, { onEnable } from '@objectstack/example-showcase';
import { registerDatasourceAdminRoutes } from '@objectstack/service-datasource';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The showcase's code-defined datasource. */
const EXTERNAL = 'showcase_external';
/** Created through the metadata door with no `origin` in the body. */
const META_NONE = 'dogfood_meta_none_21923';
/** Created through the metadata door with a body asserting `origin: 'code'`. */
const META_CODE = 'dogfood_meta_code_21923';
/** Created through the admin door, then edited and removed through the metadata door. */
const ADMIN_RT = 'dogfood_admin_rt_21923';

const SYS = { isSystem: true, positions: [], permissions: [] };

interface Answer {
  status: number;
  json: {
    success?: boolean;
    reset?: boolean;
    error?: string | { code?: string; message?: string };
    code?: string;
    item?: Record<string, unknown>;
    projectionApplied?: { success: boolean; error?: string };
    data?: { datasource?: Record<string, unknown>; datasources?: Array<Record<string, unknown>> };
  };
}

/** `{ status, code, message }` from either door's refusal envelope. */
const refusal = (a: Answer) => {
  const { error, code } = a.json;
  return typeof error === 'object' && error !== null
    ? { status: a.status, code: error.code, message: String(error.message ?? '') }
    : { status: a.status, code, message: String(error ?? '') };
};

describe('[#21923] the metadata door and the admin door agree on a runtime datasource (showcase)', () => {
  let stack: VerifyStack;
  let token: string;
  let prevCwd: string;
  let dir: string;

  const routes = () => ({
    name: 'dogfood.datasource-admin-routes',
    version: '1.0.0',
    optionalDependencies: ['com.objectstack.server.hono'],
    init: async (ctx: { getService?: (name: string) => unknown }) => {
      const httpServer = ctx.getService?.('http.server') ?? ctx.getService?.('http-server');
      registerDatasourceAdminRoutes(httpServer as never, ctx as never, '/api/v1');
    },
  });
  const boot = async () => {
    stack = await bootStack(showcaseStack, { databaseFile: join(dir, 'showcase.db'), extraPlugins: [routes()] });
    token = await stack.signIn();
  };
  const restart = async () => {
    await stack.stop();
    await boot();
  };
  const call = async (method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, body);
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Answer['json'] };
  };
  const storedRows = async (name: string) => {
    const ql = (await stack.kernel.getServiceAsync('objectql')) as {
      find(object: string, query: unknown): Promise<Array<Record<string, unknown>>>;
    };
    return ql.find('sys_metadata', { where: { type: 'datasource', name }, context: SYS });
  };
  const adminEntry = async (name: string) => {
    const listed = await call('GET', '/datasources');
    expect(listed.status, JSON.stringify(listed.json)).toBe(200);
    return listed.json.data?.datasources?.find((d) => d.name === name);
  };
  const connectVerdict = (name: string) => {
    const connection = stack.kernel.getService('datasource-connection') as {
      listConnectionStates(): Array<{ name: string; status: string }>;
    };
    return connection.listConnectionStates().find((s) => s.name === name)?.status;
  };
  /** The `origin` the stored row's own body asserts, if any. */
  const storedOrigin = async (name: string) => {
    const [row] = await storedRows(name);
    const raw = row?.metadata;
    return (typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown> | undefined))?.origin;
  };
  /** A sqlite datasource body, as an author writes it for the metadata door. */
  const sqliteBody = (name: string, label: string, extra: Record<string, unknown> = {}) => ({
    name, label, driver: 'sqlite', config: { filename: join(dir, `${name}.db`) }, ...extra,
  });
  /** The metadata door's served item, without its `_`-prefixed envelope keys. */
  const servedBody = async (name: string) => {
    const read = await call('GET', `/meta/datasource/${name}`);
    expect(read.status, JSON.stringify(read.json)).toBe(200);
    return Object.fromEntries(Object.entries(read.json.item ?? {}).filter(([k]) => !k.startsWith('_')));
  };

  beforeAll(async () => {
    prevCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'dogfood-21923-'));
    process.chdir(dir);
    // Provision the remote tables, exactly as `os dev` does at boot.
    await onEnable({ logger: { info() {}, warn() {} } } as never);
    await boot();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
    if (prevCwd) process.chdir(prevCwd);
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('premise: the code datasource is served as code, and none of this file\'s names exists yet', async () => {
    expect(await adminEntry(EXTERNAL)).toMatchObject({ origin: 'code' });
    for (const name of [META_NONE, META_CODE, ADMIN_RT]) {
      expect(await adminEntry(name)).toBeUndefined();
      expect(await storedRows(name)).toEqual([]);
    }
  });

  it('a datasource the metadata door creates is listed and editable through the admin door in the same boot, with a live pool', async () => {
    const none = await call('PUT', `/meta/datasource/${META_NONE}`, sqliteBody(META_NONE, 'Meta None 21923'));
    expect(none.status, JSON.stringify(none.json)).toBe(200);
    const code = await call('PUT', `/meta/datasource/${META_CODE}`, sqliteBody(META_CODE, 'Meta Code 21923', { origin: 'code' }));
    expect(code.status, JSON.stringify(code.json)).toBe(200);
    expect(await storedRows(META_NONE)).toHaveLength(1);
    // The stored body really asserts `origin: 'code'` — the record's own claim.
    expect(await storedOrigin(META_CODE)).toBe('code');

    // Listed, as runtime — the body asserting `origin: 'code'` included.
    expect(await adminEntry(META_NONE)).toMatchObject({ origin: 'runtime', label: 'Meta None 21923' });
    expect(await adminEntry(META_CODE)).toMatchObject({ origin: 'runtime', label: 'Meta Code 21923' });

    // A live pool, as the admin door's create opens one.
    expect(connectVerdict(META_NONE)).toBe('connected');
    expect(connectVerdict(META_CODE)).toBe('connected');

    // Editable through the admin door.
    const patched = await call('PATCH', `/datasources/${META_NONE}`, { label: 'Meta None 21923 (admin edit)' });
    expect(patched.status, JSON.stringify(patched.json)).toBe(200);
    expect(await adminEntry(META_NONE)).toMatchObject({ origin: 'runtime', label: 'Meta None 21923 (admin edit)' });
  });

  it('a datasource the admin door creates is edited and removed through the metadata door, and the removal leaves the admin door', async () => {
    const created = await call('POST', '/datasources', sqliteBody(ADMIN_RT, 'Admin Runtime 21923'));
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    expect(connectVerdict(ADMIN_RT)).toBe('connected');

    const put = await call('PUT', `/meta/datasource/${ADMIN_RT}`, { ...(await servedBody(ADMIN_RT)), label: 'Admin Runtime 21923 (meta edit)' });
    expect(put.status, JSON.stringify(put.json)).toBe(200);
    expect(await adminEntry(ADMIN_RT)).toMatchObject({ origin: 'runtime', label: 'Admin Runtime 21923 (meta edit)' });

    const del = await call('DELETE', `/meta/datasource/${ADMIN_RT}`);
    expect(del.status, JSON.stringify(del.json)).toBe(200);
    expect(await storedRows(ADMIN_RT)).toEqual([]);
    expect(await adminEntry(ADMIN_RT)).toBeUndefined();
    expect(connectVerdict(ADMIN_RT)).toBeUndefined();
  });

  it('after a restart, both metadata-door datasources are runtime, pooled and editable through the admin door', async () => {
    await restart();

    expect(await adminEntry(META_NONE)).toMatchObject({ origin: 'runtime', label: 'Meta None 21923 (admin edit)' });
    // Still the record's claim at this restart: `origin: 'code'`. Served runtime.
    expect(await storedOrigin(META_CODE)).toBe('code');
    expect(await adminEntry(META_CODE)).toMatchObject({ origin: 'runtime', label: 'Meta Code 21923' });
    for (const name of [META_NONE, META_CODE]) {
      expect(connectVerdict(name)).toBe('connected');
      const patched = await call('PATCH', `/datasources/${name}`, { label: `${name} (after restart)` });
      expect(patched.status, JSON.stringify(patched.json)).toBe(200);
      expect(await adminEntry(name)).toMatchObject({ origin: 'runtime', label: `${name} (after restart)` });
    }
    expect(await adminEntry(ADMIN_RT)).toBeUndefined();
  }, 180_000);

  it('the metadata door edits and removes an admin-edited datasource, and the admin door follows in the same boot', async () => {
    const put = await call('PUT', `/meta/datasource/${META_NONE}`, { ...(await servedBody(META_NONE)), label: 'Meta None 21923 (meta edit)' });
    expect(put.status, JSON.stringify(put.json)).toBe(200);
    expect(await adminEntry(META_NONE)).toMatchObject({ origin: 'runtime', label: 'Meta None 21923 (meta edit)' });

    const del = await call('DELETE', `/meta/datasource/${META_CODE}`);
    expect(del.status, JSON.stringify(del.json)).toBe(200);
    expect(await storedRows(META_CODE)).toEqual([]);
    expect(await adminEntry(META_CODE)).toBeUndefined();
    expect(connectVerdict(META_CODE)).toBeUndefined();
  });

  it('a code-defined datasource stays refused at the admin door', async () => {
    const patch = refusal(await call('PATCH', `/datasources/${EXTERNAL}`, { label: 'Admin edit 21923' }));
    expect({ status: patch.status, code: patch.code }).toEqual({ status: 400, code: 'DATASOURCE_ADMIN_ERROR' });
    expect(patch.message.startsWith(`Datasource '${EXTERNAL}' is code-defined and cannot be edited at runtime`), patch.message).toBe(true);
    expect(await adminEntry(EXTERNAL)).toMatchObject({ origin: 'code' });
  });
});
