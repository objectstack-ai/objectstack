// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15169] The host door — `mountStorageRoutes` — pinned on the property that
 * justified publishing it: a host mounting storage on a kernel that has no
 * `http-server` service gets the framework's own gates, and gets NO handle on
 * them.
 *
 * ## Why these pins, and why in this order
 *
 *  1. **§1 the door serves and refuses.** Controls in both directions before
 *     any property pin: a member who can read the file's parent record gets a
 *     signed URL (and the adapter MINTED it); an anonymous caller is refused
 *     401 with no capability minted; an admitted member whose parent record is
 *     unreachable gets the reachability 403, not the admission 401. Without
 *     the third arm a property pin below could pass on the wrong reason. The
 *     same two directions on the UPLOAD gate.
 *  2. **§2 one definition.** The gate a host gets IS the gate the plugin
 *     binds: the plugin's own `kernel:ready` mount and the host door register
 *     the identical route table through one composition, and the host door
 *     threads the kernel's async registry into the ADR-0104 D3 authorizer's
 *     tenancy-posture read (#15352) exactly as the plugin path does — an
 *     unreadable posture store answers the declared 503, never a verdict.
 *  3. **§3 no substitution.** The option type has none of `registerStorageRoutes`'
 *     three gate seams (a type-level pin, compiled by `tsconfig.test.json`),
 *     AND a widened options object smuggling one in is ignored (a runtime pin):
 *     the anonymous caller is still refused after a consumer "supplied" an
 *     always-allow authorizer. This is the arm an ablation of the door turns
 *     red — pass the options bag through to `registerStorageRoutes` and the
 *     smuggled authorizer wins.
 *  4. **§4 absence is loud.** No `storage` service throws naming the remedy;
 *     no `auth` / no engine mounts with the gates off, REPORTS them off, and
 *     warns — and the report carries booleans only, never a function.
 *
 * Every fixture kernel is a REAL `ObjectKernel`: the registry classification
 * the posture read depends on (branded "never registered" vs unbranded
 * "failed to construct", #13906) is the registry's, and a double imitating it
 * would be asserting about itself.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ObjectKernel } from '@objectstack/core';
import type { PluginContext } from '@objectstack/core';
// The producer's own dispatch predicates open every scanned verb of the engine
// double below (#4434 / #5619): a fake looser than `ObjectQL` is how a dead
// route ships with its suite green. Resolved through the package `exports` to
// `dist/` on purpose (`KNOWN_UNALIASED_TEST_IMPORTS`).
import {
  assertEngineDeleteDispatch,
  assertEngineFindOnePredicate,
  assertEngineUpdateDispatch,
} from '@objectstack/objectql';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { mountStorageRoutes, type MountStorageRoutesOptions } from './mount-storage-routes.js';
import { StorageServicePlugin } from './storage-service-plugin.js';

const BASE = '/api/v1/storage';

/** Field-owned, private, parked on a parent record `u_member` can read. */
const FILE_OPEN = 'file_15169_open';
/** Same shape, parent record readable by nobody — the reachability control. */
const FILE_CLOSED = 'file_15169_closed';

/** The nine routes `registerStorageRoutes` mounts, at the default base. */
const LEDGERED_ROUTES = [
  `POST:${BASE}/upload/presigned`,
  `POST:${BASE}/upload/complete`,
  `POST:${BASE}/upload/chunked`,
  `PUT:${BASE}/upload/chunked/:uploadId/chunk/:chunkIndex`,
  `POST:${BASE}/upload/chunked/:uploadId/complete`,
  `GET:${BASE}/upload/chunked/:uploadId/progress`,
  `GET:${BASE}/files/:fileId/url`,
  `GET:${BASE}/files/:fileId`,
  `PUT:${BASE}/_local/raw/:token`,
  `GET:${BASE}/_local/raw/:token`,
];

// ---------------------------------------------------------------------------
// Fixture: the data engine, the auth service, the host's route collector
// ---------------------------------------------------------------------------

function matchesWhere(row: Record<string, unknown>, where: unknown): boolean {
  for (const [field, cond] of Object.entries((where ?? {}) as Record<string, unknown>)) {
    if (field.startsWith('$')) throw new Error(`fixture where-matcher: unsupported combinator '${field}'`);
    if (cond !== null && typeof cond === 'object') {
      const inList = (cond as { $in?: unknown }).$in;
      if (!Array.isArray(inList)) throw new Error(`fixture where-matcher: unsupported operator on '${field}'`);
      if (!inList.includes(row[field])) return false;
      continue;
    }
    if (row[field] !== cond) return false;
  }
  return true;
}

/**
 * `sys_file` plus the parent object the field-owned files hang off, with row
 * visibility as an explicit allow-list — the stand-in for RLS. `owner_id` is a
 * user nobody authenticates as, so the authorizer's "uploader may always
 * download" shortcut is never what an arm travels through.
 */
function makeEngine() {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    sys_file: [
      {
        id: FILE_OPEN, key: 'files/open.pdf', name: 'open.pdf', mime_type: 'application/pdf', size: 12,
        scope: 'record', status: 'committed', acl: 'private', owner_id: 'u_uploader',
        ref_object: 'contract', ref_id: 'rec_open', ref_field: 'attachment',
      },
      {
        id: FILE_CLOSED, key: 'files/closed.pdf', name: 'closed.pdf', mime_type: 'application/pdf', size: 12,
        scope: 'record', status: 'committed', acl: 'private', owner_id: 'u_uploader',
        ref_object: 'contract', ref_id: 'rec_closed', ref_field: 'attachment',
      },
    ],
    sys_upload_session: [],
    sys_attachment: [],
  };
  const contractVisibility: Record<string, string[]> = { rec_open: ['u_member'], rec_closed: [] };
  /**
   * READS of an undeclared object answer empty: `resolveAuthzContext` reads the
   * permission store (roles, permission sets, memberships) for a session
   * principal, and a fixture that refused those reads would relay every
   * admitted caller as the 503 outage instead of reaching the verdict. WRITES
   * stay strict — a row landing in a table this fixture never declared is a
   * fixture bug, not a behaviour.
   */
  const readRows = (object: string) => tables[object] ?? [];
  const writeRows = (object: string) => {
    const rows = tables[object];
    if (!rows) throw new Error(`fixture engine: write to undeclared object '${object}'`);
    return rows;
  };
  return {
    tables,
    find: async (object: string, q: Record<string, unknown> = {}) => {
      if (object === 'contract') {
        const id = String(((q.where ?? {}) as { id?: unknown }).id ?? '');
        const userId = ((q.context ?? {}) as { userId?: string }).userId;
        return userId && (contractVisibility[id] ?? []).includes(userId) ? [{ id }] : [];
      }
      const rows = readRows(object).filter((row) => matchesWhere(row, q.where));
      return typeof q.limit === 'number' ? rows.slice(0, q.limit) : rows;
    },
    findOne: async (object: string, q: Record<string, unknown> = {}) => {
      assertEngineFindOnePredicate(object, q);
      return readRows(object).find((row) => matchesWhere(row, q.where)) ?? null;
    },
    insert: async (object: string, row: Record<string, unknown>) => {
      writeRows(object).push({ ...row });
      return row;
    },
    update: async (object: string, patch: Record<string, unknown>, q: Record<string, unknown> = {}) => {
      assertEngineUpdateDispatch(patch, q);
      for (const row of writeRows(object)) if (matchesWhere(row, q.where)) Object.assign(row, patch);
    },
    delete: async (object: string, q: Record<string, unknown> = {}) => {
      assertEngineDeleteDispatch(q);
      const rows = writeRows(object);
      const keep = rows.filter((row) => !matchesWhere(row, q.where));
      const removed = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return removed;
    },
  };
}

/** A session per `x-test-user` header — the host's auth, reduced to what the gates read. */
function makeAuth() {
  return {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const userId = headers.get('x-test-user');
        return userId ? { user: { id: userId }, session: {} } : undefined;
      },
    },
  };
}

/** The cloud shape: a route table the host later dispatches into. */
function makeRouteCollector() {
  const routes = new Map<string, RouteHandler>();
  const http = {
    get: (path: string, handler: RouteHandler) => { routes.set(`GET:${path}`, handler); },
    post: (path: string, handler: RouteHandler) => { routes.set(`POST:${path}`, handler); },
    put: (path: string, handler: RouteHandler) => { routes.set(`PUT:${path}`, handler); },
    delete: () => {},
    patch: () => {},
    use: () => {},
    listen: async () => {},
    close: async () => {},
  };
  return { http, routes };
}

interface MockResponse {
  status: number;
  json: Record<string, unknown> | undefined;
  headers: Record<string, string>;
}

function makeRes(): IHttpResponse & MockResponse {
  const res: Record<string, unknown> = { status: 200, json: undefined, headers: {} };
  const api = {
    json(data: Record<string, unknown>) { (res as { json?: unknown }).json = data; return api; },
    send() { return api; },
    status(code: number) { (res as { status: number }).status = code; return api; },
    header(name: string, value: string) {
      ((res as { headers: Record<string, string> }).headers)[name] = value;
      return api;
    },
  };
  return Object.assign(res, api) as unknown as IHttpResponse & MockResponse;
}

async function call(
  routes: Map<string, RouteHandler>,
  method: 'GET' | 'POST',
  path: string,
  init: { params?: Record<string, string>; body?: unknown; user?: string } = {},
): Promise<MockResponse> {
  const handler = routes.get(`${method}:${path}`);
  if (!handler) throw new Error(`fixture: no handler registered for ${method} ${path}`);
  const req = {
    params: init.params ?? {},
    query: {},
    body: init.body,
    headers: init.user ? { 'x-test-user': init.user } : {},
    method,
    path,
  } as unknown as IHttpRequest;
  const res = makeRes();
  await handler(req, res);
  return { status: res.status, json: res.json, headers: res.headers };
}

const errorCode = (res: MockResponse) => (res.json?.error as { code?: string } | undefined)?.code;

let rootDirs: string[] = [];

async function makeStorage() {
  const rootDir = join(tmpdir(), `os-15169-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(rootDir, { recursive: true });
  rootDirs.push(rootDir);
  return new LocalStorageAdapter({ rootDir, signingSecret: 'test-secret-15169' });
}

/** A real kernel carrying the named services — `gracefulShutdown: false` so it never hooks the runner's signals. */
function makeKernel(services: Record<string, unknown>): ObjectKernel {
  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as never);
  for (const [name, svc] of Object.entries(services)) kernel.registerService(name, svc);
  return kernel;
}

interface Host {
  routes: Map<string, RouteHandler>;
  minted: () => number;
  warns: string[];
  report: ReturnType<typeof mountStorageRoutes>;
  engine: ReturnType<typeof makeEngine>;
}

async function mountHost(
  wire: { auth?: boolean; engine?: boolean; tenancy?: 'single' | 'factory-throws' } = {},
  opts: MountStorageRoutesOptions = { basePath: BASE },
  accessor?: (kernel: ObjectKernel) => Parameters<typeof mountStorageRoutes>[1],
): Promise<Host> {
  const storage = await makeStorage();
  const engine = makeEngine();
  const services: Record<string, unknown> = { storage };
  if (wire.engine !== false) services.objectql = engine;
  if (wire.auth !== false) services.auth = makeAuth();
  if (wire.tenancy === 'single') services.tenancy = { posture: 'single' };
  const kernel = makeKernel(services);
  if (wire.tenancy === 'factory-throws') {
    kernel.registerServiceFactory('tenancy', () => { throw new Error('tenancy backend unavailable'); });
  }
  const { http, routes } = makeRouteCollector();
  const warns: string[] = [];
  const mintSpy = vi.spyOn(storage, 'getPresignedDownload');
  const report = mountStorageRoutes(http, accessor ? accessor(kernel) : kernel, {
    ...opts,
    logger: { info: () => {}, warn: (m: string) => { warns.push(m); } },
  });
  return { routes, minted: () => mintSpy.mock.calls.length, warns, report, engine };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of rootDirs) await fs.rm(dir, { recursive: true, force: true });
  rootDirs = [];
});

// ---------------------------------------------------------------------------
// §1 — the door serves and refuses (controls in both directions)
// ---------------------------------------------------------------------------

describe('[#15169] §1 · the host door serves, and the host door refuses', () => {
  it('mounts the full ledgered route table on the host surface and reports every gate bound', async () => {
    const h = await mountHost();
    expect([...h.routes.keys()].sort()).toEqual([...LEDGERED_ROUTES].sort());
    expect(h.report).toEqual({
      basePath: BASE,
      sessionResolver: true,
      downloadAuthorizer: true,
      tombstoneHolderResolver: true,
      metadataStore: 'engine',
    });
    expect(h.warns).toEqual([]);
  });

  it('CONTROL · SERVES: a member who can read the parent record gets a signed URL, and the adapter MINTED it', async () => {
    const h = await mountHost();
    const res = await call(h.routes, 'GET', `${BASE}/files/:fileId/url`, { params: { fileId: FILE_OPEN }, user: 'u_member' });
    expect(res.status).toBe(200);
    expect(String((res.json?.data as { url?: string } | undefined)?.url)).toContain('/_local/raw/');
    expect(h.minted()).toBe(1);
  });

  it('CONTROL · REFUSES at the door: anonymous is 401 AUTH_REQUIRED and no capability is minted', async () => {
    const h = await mountHost();
    const res = await call(h.routes, 'GET', `${BASE}/files/:fileId/url`, { params: { fileId: FILE_OPEN } });
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('AUTH_REQUIRED');
    expect(h.minted()).toBe(0);
  });

  it('CONTROL · REFUSES by reachability: an admitted member whose parent record is unreachable is 403, not 401', async () => {
    const h = await mountHost();
    const res = await call(h.routes, 'GET', `${BASE}/files/:fileId/url`, { params: { fileId: FILE_CLOSED }, user: 'u_member' });
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('FILE_DOWNLOAD_DENIED');
    expect(h.minted()).toBe(0);
  });

  it('UPLOAD gate · anonymous is 401 AUTH_REQUIRED and no sys_file row lands', async () => {
    const h = await mountHost();
    const before = h.engine.tables.sys_file.length;
    const res = await call(h.routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'photo.jpg', mimeType: 'image/jpeg', size: 1024, scope: 'user' },
    });
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('AUTH_REQUIRED');
    expect(h.engine.tables.sys_file.length).toBe(before);
  });

  it('UPLOAD gate · a session gets a presigned upload and the sys_file row is stamped with its user', async () => {
    const h = await mountHost();
    const res = await call(h.routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'photo.jpg', mimeType: 'image/jpeg', size: 1024, scope: 'user' },
      user: 'u_member',
    });
    expect(res.status).toBe(200);
    const fileId = (res.json?.data as { fileId?: string } | undefined)?.fileId;
    expect(fileId).toBeTruthy();
    const row = h.engine.tables.sys_file.find((r) => r.id === fileId);
    expect(row?.owner_id).toBe('u_member');
  });
});

// ---------------------------------------------------------------------------
// §2 — one definition: the host's gate is the plugin's gate
// ---------------------------------------------------------------------------

describe('[#15169] §2 · one definition — the plugin mount and the host door are the same composition', () => {
  it('the plugin\'s own kernel:ready mount registers byte-for-byte the same route table', async () => {
    // The plugin path, on the fake context every plugin suite here mounts,
    // with an `http-server` in the registry so its own branch runs.
    const { http, routes: pluginRoutes } = makeRouteCollector();
    const services = new Map<string, unknown>([['http-server', http]]);
    const readyHooks: Array<() => Promise<void> | void> = [];
    const ctx = {
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      registerService: (name: string, svc: unknown) => { services.set(name, svc); },
      getService: (name: string) => {
        const s = services.get(name);
        if (!s) throw new Error(`service '${name}' not registered`);
        return s;
      },
      hook: (event: string, fn: () => Promise<void> | void) => { if (event === 'kernel:ready') readyHooks.push(fn); },
    } as unknown as PluginContext;
    const rootDir = join(tmpdir(), `os-15169-plugin-${Date.now()}`);
    rootDirs.push(rootDir);
    const plugin = new StorageServicePlugin({
      adapter: 'local', basePath: BASE, local: { rootDir, signingSecret: 's' }, bindToSettings: false,
    });
    await plugin.init(ctx);
    await plugin.start(ctx);
    for (const hook of readyHooks) await hook();

    const host = await mountHost();
    expect([...pluginRoutes.keys()].sort()).toEqual([...host.routes.keys()].sort());
  });

  it('threads the kernel\'s async registry into the download gate: an unreadable tenancy posture is the declared 503, never a verdict', async () => {
    // Subject: the posture read (#15352) runs on the host door, off the REAL
    // registry's classification — a registered-and-failing `tenancy` factory
    // is an OUTAGE, relayed as 503 SERVICE_UNAVAILABLE (#15999).
    const outage = await mountHost({ tenancy: 'factory-throws' });
    const res = await call(outage.routes, 'GET', `${BASE}/files/:fileId/url`, { params: { fileId: FILE_OPEN } });
    expect(res.status).toBe(503);
    expect(errorCode(res)).toBe('SERVICE_UNAVAILABLE');
    expect(outage.minted()).toBe(0);

    // Control: the same door with a readable posture reaches the admission
    // verdict — anonymous is 401. Same kernel shape, only the posture differs.
    const readable = await mountHost({ tenancy: 'single' });
    const ctrl = await call(readable.routes, 'GET', `${BASE}/files/:fileId/url`, { params: { fileId: FILE_OPEN } });
    expect(ctrl.status).toBe(401);
  });

  it('a `getService`-only accessor (LiteKernel shape) keeps the posture read quiet and the gate bound', async () => {
    const h = await mountHost({}, { basePath: BASE }, (kernel) => ({
      getService: <T>(name: string): T => kernel.getService<T>(name),
    }));
    expect(h.report.downloadAuthorizer).toBe(true);
    const res = await call(h.routes, 'GET', `${BASE}/files/:fileId/url`, { params: { fileId: FILE_OPEN } });
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('AUTH_REQUIRED');
  });
});

// ---------------------------------------------------------------------------
// §3 — no substitution: a consumer cannot hand the door its own gate
// ---------------------------------------------------------------------------

describe('[#15169] §3 · the consumer cannot substitute or bypass the download gate', () => {
  it('TYPE · the option type carries none of the three gate seams', () => {
    // Compiled by `tsconfig.test.json` (and the build program, which does not
    // exclude tests): each line is a type error the day the seam is admitted.
    // @ts-expect-error — `authorizeFileRead` is not a host-mount option
    const a: MountStorageRoutesOptions = { basePath: BASE, authorizeFileRead: async () => 'allow' };
    // @ts-expect-error — `resolveSession` is not a host-mount option
    const b: MountStorageRoutesOptions = { basePath: BASE, resolveSession: async () => ({ userId: 'u' }) };
    // @ts-expect-error — `resolveFileHolder` is not a host-mount option
    const c: MountStorageRoutesOptions = { basePath: BASE, resolveFileHolder: async () => null };
    expect([a, b, c].length).toBe(3);
  });

  it('RUNTIME · a widened options object smuggling an always-allow authorizer changes nothing: anonymous is still refused', async () => {
    const smuggled = {
      basePath: BASE,
      authorizeFileRead: async () => 'allow' as const,
      resolveSession: async () => ({ userId: 'u_member' }),
      resolveFileHolder: async () => 'attachment' as const,
    } as MountStorageRoutesOptions;
    const h = await mountHost({}, smuggled);
    const download = await call(h.routes, 'GET', `${BASE}/files/:fileId/url`, { params: { fileId: FILE_OPEN } });
    expect(download.status).toBe(401);
    expect(errorCode(download)).toBe('AUTH_REQUIRED');
    expect(h.minted()).toBe(0);
    const upload = await call(h.routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'photo.jpg', mimeType: 'image/jpeg', size: 1024, scope: 'user' },
    });
    expect(upload.status).toBe(401);
    expect(errorCode(upload)).toBe('AUTH_REQUIRED');
  });
});

// ---------------------------------------------------------------------------
// §4 — absence is loud
// ---------------------------------------------------------------------------

describe('[#15169] §4 · absence is loud', () => {
  it('a kernel with no `storage` service throws, naming the service and the plugin that registers it', async () => {
    const kernel = makeKernel({ objectql: makeEngine(), auth: makeAuth() });
    const { http } = makeRouteCollector();
    expect(() => mountStorageRoutes(http, kernel, { basePath: BASE })).toThrow(/`storage`[\s\S]*StorageServicePlugin/);
  });

  it('a kernel with no `auth` and no engine mounts with the gates OFF, reports them off, and warns once', async () => {
    const h = await mountHost({ auth: false, engine: false });
    expect(h.report).toEqual({
      basePath: BASE,
      sessionResolver: false,
      downloadAuthorizer: false,
      tombstoneHolderResolver: false,
      metadataStore: 'memory',
    });
    expect(h.warns).toHaveLength(1);
    // The report is booleans and strings only — never a function a caller
    // could invoke around the door.
    expect(Object.values(h.report).every((v) => typeof v !== 'function')).toBe(true);
    // And "off" is real, not merely reported: the declared bare-kernel posture
    // accepts an anonymous upload.
    const res = await call(h.routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'photo.jpg', mimeType: 'image/jpeg', size: 1024, scope: 'user' },
    });
    expect(res.status).toBe(200);
  });
});
