// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21899] The metadata door answers a CODE-DEFINED datasource the way the
// datasource-admin door does — read-only — over the real showcase
// composition, across restarts.
//
// ## What was broken
//
// The showcase declares `showcase_external` in `*.datasource.ts`, so it is
// code-defined (`DatasourceSchema.origin`: "code — authored as
// `*.datasource.ts`, GitOps-owned, read-only in the UI"). The admin door
// refused to edit or remove it. The metadata door did not:
// `PUT /api/v1/meta/datasource/showcase_external` answered 200 and persisted a
// row, `GET /meta` then served the edit, and `DELETE` answered 200 too. The
// runtime registers a code-defined datasource in memory only, never as a
// registry item, so the door's artifact check missed it and the save took the
// runtime-create tier.
//
// ## What each case pins (triage's four pins, Q1-A and Q2-B)
//
//   - `PUT` on a code-defined datasource is refused with the door's own
//     `NOT_OVERRIDABLE` / 403 and the admin door's verdict and remedy; the
//     admin door keeps its own `DATASOURCE_ADMIN_ERROR` / 400 — the two codes
//     differ by ruling, the verdict agrees;
//   - a `DELETE` with no stored row is refused the same way;
//   - a `DELETE` of a stored row left from before this refusal answers 200, and
//     after a restart both doors serve the code definition again;
//   - a runtime datasource still saves and deletes, each through the door that
//     created it.
//
// The pre-existing row is seeded the way the metadata door wrote it before
// this refusal existed: through the door's own repository on the runtime-only
// intent, the intent that save took for every code-defined datasource. No
// public door writes one any more, which is the point of the fix.
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

/** The showcase's code-defined datasource and the package that declares it. */
const DATASOURCE = 'showcase_external';
const PACKAGE_ID = 'com.example.showcase';
const CODE_LABEL = 'External Analytics (SQLite)';
/** The label a pre-fix metadata-door save left in the stored row. */
const SHADOW_LABEL = 'Shadow 21899';
/** Runtime datasources: one created through each door. */
const ADMIN_RUNTIME = 'dogfood_admin_rt_21899';
const META_RUNTIME = 'dogfood_meta_rt_21899';

/** The verdict both doors state, in the admin door's words. */
const EDIT_VERDICT = `Datasource '${DATASOURCE}' is code-defined and cannot be edited at runtime`;
const REMOVE_VERDICT = `Datasource '${DATASOURCE}' is code-defined and cannot be removed at runtime`;
/** The remedy the metadata door names. */
const REMEDY = 'Edit the *.datasource.ts source that declares it and redeploy.';

const SYS = { isSystem: true, positions: [], permissions: [] };

/** The REST error envelopes the two doors answer with. */
interface Answer {
  status: number;
  json: {
    success?: boolean;
    reset?: boolean;
    error?: string | { code?: string; message?: string };
    code?: string;
    item?: Record<string, unknown>;
    data?: { datasource?: Record<string, unknown>; datasources?: Array<Record<string, unknown>> };
  };
}

/** `{ code, message }` from either door's refusal envelope. */
const refusal = (a: Answer) => {
  const { error, code } = a.json;
  return typeof error === 'object' && error !== null
    ? { status: a.status, code: error.code, message: String(error.message ?? '') }
    : { status: a.status, code, message: String(error ?? '') };
};

describe('[#21899] the metadata door answers a code-defined datasource as read-only (showcase)', () => {
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
  /** The served body, minus the read decorations, as a client edits it. */
  const servedBody = async (): Promise<Record<string, unknown>> => {
    const read = await call('GET', `/meta/datasource/${DATASOURCE}`);
    expect(read.status, JSON.stringify(read.json)).toBe(200);
    return Object.fromEntries(Object.entries(read.json.item ?? {}).filter(([k]) => !k.startsWith('_')));
  };
  const storedRows = async (name: string) => {
    const ql = (await stack.kernel.getServiceAsync('objectql')) as {
      find(object: string, query: unknown): Promise<Array<Record<string, unknown>>>;
    };
    return ql.find('sys_metadata', { where: { type: 'datasource', name }, context: SYS });
  };
  const adminEntry = async () => {
    const listed = await call('GET', '/datasources');
    expect(listed.status, JSON.stringify(listed.json)).toBe(200);
    return listed.json.data?.datasources?.find((d) => d.name === DATASOURCE);
  };

  beforeAll(async () => {
    prevCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'dogfood-21899-'));
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

  it('premise: both doors serve the code definition, and no row is stored for it', async () => {
    const read = await call('GET', `/meta/datasource/${DATASOURCE}`);
    expect(read.status, JSON.stringify(read.json)).toBe(200);
    expect(read.json.item).toMatchObject({ origin: 'code', label: CODE_LABEL, _packageId: PACKAGE_ID });
    expect(await adminEntry()).toMatchObject({ origin: 'code', label: CODE_LABEL });
    expect(await storedRows(DATASOURCE)).toEqual([]);
  });

  it('PUT is refused NOT_OVERRIDABLE / 403 with the admin door\'s verdict and remedy, and stores nothing', async () => {
    const put = await call('PUT', `/meta/datasource/${DATASOURCE}`, { ...(await servedBody()), label: 'Meta Renamed 21899' });

    const answer = refusal(put);
    expect({ status: answer.status, code: answer.code }).toEqual({ status: 403, code: 'NOT_OVERRIDABLE' });
    expect(answer.message.startsWith(`${EDIT_VERDICT}: it is read-only.`), answer.message).toBe(true);
    expect(answer.message).toContain(REMEDY);

    expect(await storedRows(DATASOURCE)).toEqual([]);
    expect((await servedBody()).label).toBe(CODE_LABEL);

    // The admin door keeps its own code — the two differ by ruling — and
    // states the same verdict.
    const admin = refusal(await call('PATCH', `/datasources/${DATASOURCE}`, { label: 'Admin Renamed 21899' }));
    expect({ status: admin.status, code: admin.code }).toEqual({ status: 400, code: 'DATASOURCE_ADMIN_ERROR' });
    expect(admin.message.startsWith(EDIT_VERDICT), admin.message).toBe(true);
  });

  it('DELETE with no stored row is refused the same way, naming the removal', async () => {
    const del = refusal(await call('DELETE', `/meta/datasource/${DATASOURCE}`));
    expect({ status: del.status, code: del.code }).toEqual({ status: 403, code: 'NOT_OVERRIDABLE' });
    expect(del.message.startsWith(`${REMOVE_VERDICT}: it is read-only.`), del.message).toBe(true);
    expect(del.message).toContain(REMEDY);

    const admin = refusal(await call('DELETE', `/datasources/${DATASOURCE}`));
    expect({ status: admin.status, code: admin.code }).toEqual({ status: 400, code: 'DATASOURCE_ADMIN_ERROR' });
    expect(admin.message.startsWith(REMOVE_VERDICT), admin.message).toBe(true);

    expect(await adminEntry()).toMatchObject({ origin: 'code', label: CODE_LABEL });
  });

  it('control: a runtime datasource still saves and deletes through the door that created it', async () => {
    // The admin door.
    const created = await call('POST', '/datasources', {
      name: ADMIN_RUNTIME, label: 'Admin Runtime 21899', driver: 'sqlite', config: { filename: join(dir, 'admin-rt.db') },
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    expect(created.json.data?.datasource).toMatchObject({ name: ADMIN_RUNTIME, origin: 'runtime' });
    const patched = await call('PATCH', `/datasources/${ADMIN_RUNTIME}`, { label: 'Admin Runtime 21899 (edited)' });
    expect(patched.status, JSON.stringify(patched.json)).toBe(200);
    const removed = await call('DELETE', `/datasources/${ADMIN_RUNTIME}`);
    expect(removed.status, JSON.stringify(removed.json)).toBe(204);

    // The metadata door.
    const runtimeBody = (label: string) => ({
      name: META_RUNTIME, label, driver: 'sqlite', config: { filename: join(dir, 'meta-rt.db') },
    });
    const saved = await call('PUT', `/meta/datasource/${META_RUNTIME}`, runtimeBody('Meta Runtime 21899'));
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    const updated = await call('PUT', `/meta/datasource/${META_RUNTIME}`, runtimeBody('Meta Runtime 21899 (edited)'));
    expect(updated.status, JSON.stringify(updated.json)).toBe(200);
    expect(await storedRows(META_RUNTIME)).toHaveLength(1);
    const deleted = await call('DELETE', `/meta/datasource/${META_RUNTIME}`);
    expect(deleted.status, JSON.stringify(deleted.json)).toBe(200);
    expect(deleted.json).toMatchObject({ success: true, reset: true });
    expect(await storedRows(META_RUNTIME)).toEqual([]);
  });

  it('a stored row left from before the refusal: PUT is still refused, DELETE removes it (200), a second DELETE is refused', async () => {
    // The row a pre-fix `PUT /meta/datasource/showcase_external` persisted,
    // written the way that save wrote it.
    const protocol = stack.kernel.getService('protocol') as {
      getOverlayRepo(organizationId: string | null): {
        put(ref: unknown, body: unknown, opts: unknown): Promise<unknown>;
      };
    };
    await protocol.getOverlayRepo(null).put(
      { org: 'env', type: 'datasource', name: DATASOURCE },
      { ...(await servedBody()), label: SHADOW_LABEL },
      { parentVersion: null, actor: null, intent: 'runtime-only', source: 'dogfood.pre-fix-save' },
    );
    expect(await storedRows(DATASOURCE)).toHaveLength(1);

    // Across a restart, so the row is the one a deployment upgraded onto this
    // fix carries.
    await restart();
    expect(await storedRows(DATASOURCE)).toHaveLength(1);
    expect((await servedBody()).label).toBe(SHADOW_LABEL);

    const put = refusal(await call('PUT', `/meta/datasource/${DATASOURCE}`, { ...(await servedBody()), label: 'Meta Renamed 21899' }));
    expect({ status: put.status, code: put.code }).toEqual({ status: 403, code: 'NOT_OVERRIDABLE' });

    const repaired = await call('DELETE', `/meta/datasource/${DATASOURCE}`);
    expect(repaired.status, JSON.stringify(repaired.json)).toBe(200);
    expect(repaired.json).toMatchObject({ success: true, reset: true });
    expect(await storedRows(DATASOURCE)).toEqual([]);

    const again = refusal(await call('DELETE', `/meta/datasource/${DATASOURCE}`));
    expect({ status: again.status, code: again.code }).toEqual({ status: 403, code: 'NOT_OVERRIDABLE' });
  }, 180_000);

  it('after the repair and a restart, both doors serve the code definition again', async () => {
    await restart();

    const read = await call('GET', `/meta/datasource/${DATASOURCE}`);
    expect(read.status, JSON.stringify(read.json)).toBe(200);
    expect(read.json.item).toMatchObject({ origin: 'code', label: CODE_LABEL, _packageId: PACKAGE_ID });
    expect(await adminEntry()).toMatchObject({ origin: 'code', label: CODE_LABEL });
    expect(await storedRows(DATASOURCE)).toEqual([]);
  }, 180_000);
});
