// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21922 / #21944] Across a restart, a stored datasource row never displaces a
// code datasource — over the real showcase composition.
//
// ## What was broken
//
// The datasource-admin plugin's boot restore registered EVERY stored
// `datasource` row in the MetadataService, last-write-wins over the code
// definition the runtime had registered. Measured on this composition before
// the fix, with a stored row asserting `origin: 'runtime'` and its own
// `config.filename` under each code name:
//
//   - `showcase_external` — the admin list served it as `origin: runtime` with
//     the stored label, and `PATCH /api/v1/datasources/showcase_external`
//     answered 200: a code-defined datasource edited at runtime;
//   - `default` — the restore handed the boot's pool rehydration a "runtime"
//     record, and it opened a SECOND live pool named `default` on the stored
//     row's file (`getDriverByName('default')` answered that driver; the
//     connect verdict went `already-registered` → `connected`);
//   - and the `/meta` door saved an edit of `default` (`PUT` 200), the one
//     code datasource no package declares.
//
// ## What each case pins (triage's pins on both cards)
//
//   - after a restart with a stored row under each code name, the admin door
//     serves the code definition and refuses the edit, and no pool is opened
//     from a stored row;
//   - the `/meta` door's `DELETE` of such a row (the repair) removes it, and
//     what the admin door serves does not change;
//   - `PUT` and `DELETE` on `/api/v1/meta/datasource/default` are refused with
//     the answer the door gives every code-defined datasource, its remedy
//     naming the host's database configuration — no `*.datasource.ts`
//     declares `default`;
//   - a runtime datasource with no code twin still restores, and one still
//     saves through the `/meta` door.
//
// ⚠ Not pinned here, and named rather than hidden: while a stored row exists,
// `GET /api/v1/meta/datasource/:name` serves THAT row — the door reads its
// stored overlay first (ADR-0005's read order), whatever the MetadataService
// holds. `meta-door-code-datasource.dogfood.test.ts` pins that read as it is.
// After the repair below it serves the code definition, in the same boot.
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
const EXTERNAL_LABEL = 'External Analytics (SQLite)';
/** The label and origin the stored rows assert — what an earlier runtime write could leave. */
const SHADOW_LABEL = 'Shadow 21922';
/** A runtime datasource created through the admin door before the restart. */
const RUNTIME = 'dogfood_rt_21922';
/** A runtime datasource created through the `/meta` door. */
const META_RUNTIME = 'dogfood_meta_rt_21944';

const SYS = { isSystem: true, positions: [], permissions: [] };

interface Answer {
  status: number;
  json: {
    success?: boolean;
    reset?: boolean;
    error?: string | { code?: string; message?: string };
    code?: string;
    item?: Record<string, unknown>;
    records?: unknown[];
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

describe('[#21922 / #21944] a stored datasource row never displaces a code datasource across a restart (showcase)', () => {
  let stack: VerifyStack;
  let token: string;
  let prevCwd: string;
  let dir: string;
  /** What `showcase_ext_customer` answers on a fresh boot — the code fixture's rows. */
  let fixtureRows: number;

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
  const customerRows = async () => {
    const read = await call('GET', '/data/showcase_ext_customer');
    expect(read.status, JSON.stringify(read.json)).toBe(200);
    return read.json.records?.length;
  };
  const connectVerdict = (name: string) => {
    const connection = stack.kernel.getService('datasource-connection') as {
      listConnectionStates(): Array<{ name: string; status: string }>;
    };
    return connection.listConnectionStates().find((s) => s.name === name)?.status;
  };
  const engine = () => stack.kernel.getService('objectql') as { getDriverByName(name: string): unknown };

  beforeAll(async () => {
    prevCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'dogfood-21922-'));
    process.chdir(dir);
    // Provision the remote tables, exactly as `os dev` does at boot.
    await onEnable({ logger: { info() {}, warn() {} } } as never);
    await boot();
    fixtureRows = (await customerRows()) ?? -1;
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
    if (prevCwd) process.chdir(prevCwd);
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('premise: both code datasources are served as code, the default pool is the host\'s own, and no row is stored', async () => {
    expect(fixtureRows).toBeGreaterThan(0);
    expect(await adminEntry(EXTERNAL)).toMatchObject({ origin: 'code', label: EXTERNAL_LABEL });
    expect(await adminEntry('default')).toMatchObject({ origin: 'code' });
    expect(connectVerdict('default')).toBe('already-registered');
    expect(engine().getDriverByName('default')).toBeUndefined();
    expect(await storedRows(EXTERNAL)).toEqual([]);
    expect(await storedRows('default')).toEqual([]);
  });

  it('the /meta door refuses PUT and a no-row DELETE of `default`, as for every code-defined datasource', async () => {
    const served = await call('GET', '/meta/datasource/default');
    expect(served.status, JSON.stringify(served.json)).toBe(200);
    const body = Object.fromEntries(Object.entries(served.json.item ?? {}).filter(([k]) => !k.startsWith('_')));

    const put = refusal(await call('PUT', '/meta/datasource/default', { ...body, label: 'Meta Renamed default 21944' }));
    expect({ status: put.status, code: put.code }).toEqual({ status: 403, code: 'NOT_OVERRIDABLE' });
    expect(put.message.startsWith("Datasource 'default' is code-defined and cannot be edited at runtime: it is read-only."), put.message).toBe(true);

    const del = refusal(await call('DELETE', '/meta/datasource/default'));
    expect({ status: del.status, code: del.code }).toEqual({ status: 403, code: 'NOT_OVERRIDABLE' });
    expect(del.message.startsWith("Datasource 'default' is code-defined and cannot be removed at runtime: it is read-only."), del.message).toBe(true);

    // The remedy tells the truth about `default`: no `*.datasource.ts` declares
    // it — the host defines it from the database the server starts with.
    for (const message of [put.message, del.message]) {
      expect(message).toContain("It is defined by the host's database configuration");
      expect(message).not.toContain('.datasource.ts');
    }

    expect(await storedRows('default')).toEqual([]);
  });

  it('control: a runtime datasource still saves through the /meta door', async () => {
    const saved = await call('PUT', `/meta/datasource/${META_RUNTIME}`, {
      name: META_RUNTIME, label: 'Meta Runtime 21944', driver: 'sqlite', config: { filename: join(dir, 'meta-rt.db') },
    });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    expect(await storedRows(META_RUNTIME)).toHaveLength(1);
  });

  it('after a restart over a stored row under each code name: the admin door serves code, refuses the edit, and no pool opens from a row', async () => {
    // A runtime datasource with no code twin, created before the restart.
    const created = await call('POST', '/datasources', {
      name: RUNTIME, label: 'Runtime 21922', driver: 'sqlite', config: { filename: join(dir, 'rt.db') },
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);

    // The rows an earlier runtime write left: each asserts `origin: 'runtime'`
    // and its own connection file — the fixture shape under which the admin
    // door's refusal cannot come from its `origin ?? 'code'` read default.
    // Written through the `/meta` door's own repository on the runtime-only
    // intent, the write the door's save made before it refused these names.
    const protocol = stack.kernel.getService('protocol') as {
      getOverlayRepo(organizationId: string | null): {
        put(ref: unknown, body: unknown, opts: unknown): Promise<unknown>;
      };
    };
    const external = await call('GET', `/meta/datasource/${EXTERNAL}`);
    const externalBody = Object.fromEntries(Object.entries(external.json.item ?? {}).filter(([k]) => !k.startsWith('_')));
    await protocol.getOverlayRepo(null).put(
      { org: 'env', type: 'datasource', name: EXTERNAL },
      { ...externalBody, label: SHADOW_LABEL, origin: 'runtime', config: { filename: join(dir, 'shadow-external.db') } },
      { parentVersion: null, actor: null, intent: 'runtime-only', source: 'dogfood.pre-fix-runtime-write' },
    );
    await protocol.getOverlayRepo(null).put(
      { org: 'env', type: 'datasource', name: 'default' },
      { name: 'default', label: SHADOW_LABEL, driver: 'sqlite', origin: 'runtime', config: { filename: join(dir, 'shadow-default.db') } },
      { parentVersion: null, actor: null, intent: 'runtime-only', source: 'dogfood.pre-fix-runtime-write' },
    );
    expect(await storedRows(EXTERNAL)).toHaveLength(1);
    expect(await storedRows('default')).toHaveLength(1);

    await restart();

    // The rows are kept — they are the repair target.
    expect(await storedRows(EXTERNAL)).toHaveLength(1);
    expect(await storedRows('default')).toHaveLength(1);

    // The admin door serves each code definition…
    expect(await adminEntry(EXTERNAL)).toMatchObject({ origin: 'code', label: EXTERNAL_LABEL });
    expect(await adminEntry('default')).toMatchObject({ origin: 'code' });
    expect((await adminEntry('default'))?.label).not.toBe(SHADOW_LABEL);

    // …and refuses to edit one at runtime.
    const patch = refusal(await call('PATCH', `/datasources/${EXTERNAL}`, { label: 'Admin edit after restart' }));
    expect({ status: patch.status, code: patch.code }).toEqual({ status: 400, code: 'DATASOURCE_ADMIN_ERROR' });
    expect(patch.message.startsWith(`Datasource '${EXTERNAL}' is code-defined and cannot be edited at runtime`), patch.message).toBe(true);

    // No pool was opened from a stored row: `default` is still the host's own
    // driver alone, and the federated objects still read the code fixture.
    expect(engine().getDriverByName('default')).toBeUndefined();
    expect(connectVerdict('default')).toBe('already-registered');
    expect(await customerRows()).toBe(fixtureRows);

    // A runtime datasource with no code twin still restores, editable.
    expect(await adminEntry(RUNTIME)).toMatchObject({ origin: 'runtime', label: 'Runtime 21922' });
    const runtimePatch = await call('PATCH', `/datasources/${RUNTIME}`, { label: 'Runtime 21922 (edited)' });
    expect(runtimePatch.status, JSON.stringify(runtimePatch.json)).toBe(200);
  }, 180_000);

  it('the /meta DELETE of each row (the repair) removes it, and what the admin door serves does not change', async () => {
    const before = { external: await adminEntry(EXTERNAL), def: await adminEntry('default') };

    for (const name of [EXTERNAL, 'default']) {
      const repaired = await call('DELETE', `/meta/datasource/${name}`);
      expect(repaired.status, JSON.stringify(repaired.json)).toBe(200);
      expect(repaired.json).toMatchObject({ success: true, reset: true });
      expect(await storedRows(name)).toEqual([]);
    }

    expect(await adminEntry(EXTERNAL)).toEqual(before.external);
    expect(await adminEntry('default')).toEqual(before.def);
    // With the row gone, the /meta read serves the code definition in this
    // same boot — the slot it falls back to was never overwritten.
    const read = await call('GET', `/meta/datasource/${EXTERNAL}`);
    expect(read.status, JSON.stringify(read.json)).toBe(200);
    expect(read.json.item).toMatchObject({ origin: 'code', label: EXTERNAL_LABEL });
  });
});
