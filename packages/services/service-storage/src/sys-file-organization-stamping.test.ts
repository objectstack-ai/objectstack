// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #12745 — the FORWARD half of "A with backfill".
//
// `StorageMetadataStore.createFile` inserted into `sys_file` with no context at
// all (the string `context` appeared 0 times in `metadata-store.ts`), so the
// driver's `injectTenantOnInsert` had no `tenantId` to stamp from and every row
// landed with `organization_id` NULL — on a tenancy-ENABLED object whose column
// the registry provisions unconditionally. Both callers already held the
// session: `storage-routes.ts` reads `owner_id: session?.userId` ten lines
// below each `createFile`.
//
// These pin the channel, at the three altitudes it crosses:
//
//   1. the STORE hands the engine `{ context: { tenantId } }` — and hands it
//      nothing when there is no organization, so the pre-#12745 call shape is
//      preserved for unscoped callers;
//   2. the ROUTES thread the session's organization into both upload doors;
//   3. the PLUGIN's session bridge reports `session.session.activeOrganizationId`
//      — and ⛔ never invents one when the session has no active organization.

import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assertEngineDeleteDispatch,
  assertEngineFindOnePredicate,
  assertEngineUpdateDispatch,
} from '@objectstack/objectql';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { LocalStorageAdapter } from './local-storage-adapter';
import { StorageMetadataStore } from './metadata-store';
import { registerStorageRoutes } from './storage-routes';
import { StorageServicePlugin } from './storage-service-plugin';

// ---------------------------------------------------------------------------
// A fake engine that records the OPTIONS bag of every insert — the argument
// this whole card is about.
// ---------------------------------------------------------------------------

function createRecordingEngine() {
  const inserts: Array<{ object: string; data: any; options: any }> = [];
  const engine: any = {
    async insert(object: string, data: any, options?: any) {
      inserts.push({ object, data: { ...data }, options });
      return { ...data };
    },
    // Each verb opens with the producer's OWN dispatch predicate, so this
    // double can never accept a call shape the real `ObjectQL` refuses.
    async findOne(object: string, query?: any) {
      assertEngineFindOnePredicate(object, query);
      const hit = inserts.find(
        (i) => i.object === object && String(i.data.id) === String(query?.where?.id),
      );
      return hit ? { ...hit.data } : null;
    },
    async update(_object: string, data: any, options?: any) {
      assertEngineUpdateDispatch(data, options);
      return { ...data };
    },
    async delete(_object: string, options?: any) {
      assertEngineDeleteDispatch(options);
      return 1;
    },
    async find() { return []; },
    async count() { return 0; },
    async aggregate() { return []; },
    _inserts: inserts,
  };
  return engine;
}

const fileRec = (id: string) => ({
  id,
  key: `user/${id}.txt`,
  name: `${id}.txt`,
  status: 'pending' as const,
});

// ---------------------------------------------------------------------------
// 1. The store — the missing channel
// ---------------------------------------------------------------------------

describe('StorageMetadataStore.createFile: the acting organization reaches the engine', () => {
  it('threads the organization as an execution context on the insert', async () => {
    const engine = createRecordingEngine();
    const store = new StorageMetadataStore(engine);

    await store.createFile(fileRec('f1'), { organizationId: 'org_A' });

    expect(engine._inserts).toHaveLength(1);
    expect(engine._inserts[0].object).toBe('sys_file');
    // The platform's insert-side chokepoint reads exactly this:
    // `context.tenantId` → `buildDriverOptions` → `DriverOptions.tenantId` →
    // `SqlDriver.injectTenantOnInsert` → the object's tenant column.
    expect(engine._inserts[0].options).toEqual({ context: { tenantId: 'org_A' } });
  });

  it('⛔ does NOT stamp the column onto the payload — that decision is the driver’s', async () => {
    const engine = createRecordingEngine();
    const store = new StorageMetadataStore(engine);

    await store.createFile(fileRec('f1'), { organizationId: 'org_A' });

    // Whether this object HAS a tenant column (`resolveTenantField`) and
    // whether an explicit value wins are the driver's answers. A store that
    // wrote the column itself would re-decide both, one package away from the
    // schema — and would fail on an install that opted the object out.
    expect(engine._inserts[0].data).not.toHaveProperty('organization_id');
  });

  it('passes NO options at all when there is no organization — the pre-#12745 shape', async () => {
    const engine = createRecordingEngine();
    const store = new StorageMetadataStore(engine);

    await store.createFile(fileRec('f1'));
    await store.createFile(fileRec('f2'), {});
    await store.createFile(fileRec('f3'), { organizationId: '' });
    await store.createFile(fileRec('f4'), { organizationId: null });

    // An empty context is still a context; handing one to the engine would
    // change what every other option resolver on that call sees.
    expect(engine._inserts.map((i) => i.options)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('records the organization on the engine-absent stand-in too', async () => {
    const store = new StorageMetadataStore(null);

    const created = await store.createFile(fileRec('f1'), { organizationId: 'org_A' });

    expect(created.organization_id).toBe('org_A');
    expect(await store.getFile('f1')).toMatchObject({ organization_id: 'org_A' });
  });

  it('an explicit organization on the record wins, mirroring `injectTenantOnInsert`', async () => {
    const store = new StorageMetadataStore(null);

    const created = await store.createFile(
      { ...fileRec('f1'), organization_id: 'org_EXPLICIT' },
      { organizationId: 'org_SESSION' },
    );

    expect(created.organization_id).toBe('org_EXPLICIT');
  });
});

// ---------------------------------------------------------------------------
// 2. The routes — both upload doors
// ---------------------------------------------------------------------------

function createMockHttpServer() {
  const routes = new Map<string, RouteHandler>();
  return {
    get: vi.fn((path: string, handler: RouteHandler) => { routes.set(`GET:${path}`, handler); }),
    post: vi.fn((path: string, handler: RouteHandler) => { routes.set(`POST:${path}`, handler); }),
    put: vi.fn((path: string, handler: RouteHandler) => { routes.set(`PUT:${path}`, handler); }),
    delete: vi.fn(),
    patch: vi.fn(),
    use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    _getHandler(method: string, path: string): RouteHandler | undefined {
      return routes.get(`${method}:${path}`);
    },
  };
}

function createMockReq(overrides: Partial<IHttpRequest> = {}): IHttpRequest {
  return { params: {}, query: {}, body: undefined, headers: {}, method: 'POST', path: '/', ...overrides };
}

function createMockRes(): IHttpResponse & { _status: number; _json: any } {
  const res: any = {
    _status: 200,
    _json: null,
    json(data: any) { res._json = data; },
    send(data: any) { res._sent = data; },
    status(code: number) { res._status = code; return res; },
    header() { return res; },
  };
  return res;
}

describe('storage upload routes: a file created with a session lands with that organization', () => {
  const doors: Array<{ label: string; path: string; body: Record<string, unknown> }> = [
    {
      label: 'presigned',
      path: '/api/v1/storage/upload/presigned',
      body: { filename: 'a.txt', mimeType: 'text/plain', size: 3 },
    },
    {
      label: 'chunked',
      path: '/api/v1/storage/upload/chunked',
      body: { filename: 'b.bin', mimeType: 'application/octet-stream', totalSize: 10 },
    },
  ];

  for (const door of doors) {
    it(`stamps the ${door.label} upload door's sys_file row from the session`, async () => {
      const rootDir = join(tmpdir(), `os-12745-${door.label}-${Math.random().toString(36).slice(2)}`);
      await fs.mkdir(rootDir, { recursive: true });
      try {
        const adapter = new LocalStorageAdapter({ rootDir, signingSecret: 'test-secret' });
        const engine = createRecordingEngine();
        const store = new StorageMetadataStore(engine);
        const httpServer = createMockHttpServer();
        registerStorageRoutes(httpServer as any, adapter, store, {
          basePath: '/api/v1/storage',
          resolveSession: async () => ({ userId: 'u1', organizationId: 'org_A' }),
        });

        const handler = httpServer._getHandler('POST', door.path)!;
        const res = createMockRes();
        await handler(createMockReq({ body: door.body }), res);

        expect(res._status).toBe(200);
        const insert = engine._inserts.find((i: any) => i.object === 'sys_file');
        expect(insert).toBeTruthy();
        // The owner was already threaded before this card; the organization is
        // what was being dropped two lines away from it.
        expect(insert.data.owner_id).toBe('u1');
        expect(insert.options).toEqual({ context: { tenantId: 'org_A' } });
      } finally {
        await fs.rm(rootDir, { recursive: true, force: true });
      }
    });
  }

  it('a session with no active organization stamps nothing — ⛔ no guess is substituted', async () => {
    const rootDir = join(tmpdir(), `os-12745-noorg-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(rootDir, { recursive: true });
    try {
      const adapter = new LocalStorageAdapter({ rootDir, signingSecret: 'test-secret' });
      const engine = createRecordingEngine();
      const store = new StorageMetadataStore(engine);
      const httpServer = createMockHttpServer();
      registerStorageRoutes(httpServer as any, adapter, store, {
        basePath: '/api/v1/storage',
        resolveSession: async () => ({ userId: 'u1' }),
      });

      const handler = httpServer._getHandler('POST', '/api/v1/storage/upload/presigned')!;
      const res = createMockRes();
      await handler(
        createMockReq({ body: { filename: 'a.txt', mimeType: 'text/plain', size: 3 } }),
        res,
      );

      expect(res._status).toBe(200);
      // Such a row is precisely what the backfill reports rather than repairs.
      expect(engine._inserts[0].options).toBeUndefined();
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The plugin's session bridge — where the organization comes FROM
// ---------------------------------------------------------------------------

function makeBootCtx(services: Record<string, unknown>) {
  const registry = new Map<string, any>(Object.entries(services));
  const hooks: Array<() => Promise<void> | void> = [];
  const ctx: any = {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    registerService: (name: string, svc: any) => { registry.set(name, svc); },
    getService: (name: string) => {
      const s = registry.get(name);
      if (!s) throw new Error(`service '${name}' not registered`);
      return s;
    },
    hook: (event: string, fn: () => Promise<void> | void) => {
      if (event === 'kernel:ready') hooks.push(fn);
    },
    _flushReady: async () => { for (const h of hooks) await h(); },
  };
  return ctx;
}

/** better-auth's session payload, as `api.getSession({ headers })` returns it. */
function makeAuthService(session: unknown) {
  return { api: { getSession: async () => session } };
}

async function bootPluginAndUpload(session: unknown) {
  const rootDir = await fs.mkdtemp(join(tmpdir(), 'os-12745-plugin-'));
  const engine = createRecordingEngine();
  const httpServer = createMockHttpServer();
  const ctx = makeBootCtx({
    'http-server': httpServer,
    objectql: engine,
    auth: makeAuthService(session),
  });
  const plugin = new StorageServicePlugin({ adapter: 'local', local: { rootDir } });
  await plugin.init(ctx);
  await plugin.start(ctx);
  await ctx._flushReady();

  const handler = httpServer._getHandler('POST', '/api/v1/storage/upload/presigned');
  expect(handler, 'the presigned upload route was registered').toBeTruthy();
  const res = createMockRes();
  await handler!(
    createMockReq({
      body: { filename: 'a.txt', mimeType: 'text/plain', size: 3 },
      headers: { cookie: 'session=abc' },
    }),
    res,
  );
  await fs.rm(rootDir, { recursive: true, force: true });
  return { res, engine };
}

describe('StorageServicePlugin: the session bridge reports the ACTIVE organization', () => {
  it('reads `session.session.activeOrganizationId` — the platform’s own spelling', async () => {
    const { res, engine } = await bootPluginAndUpload({
      user: { id: 'u1' },
      session: { userId: 'u1', activeOrganizationId: 'org_A' },
    });

    expect(res._status).toBe(200);
    expect(engine._inserts[0].options).toEqual({ context: { tenantId: 'org_A' } });
  });

  it('accepts the flattened shape a host may hand back directly', async () => {
    const { res, engine } = await bootPluginAndUpload({
      user: { id: 'u1' },
      activeOrganizationId: 'org_B',
    });

    expect(res._status).toBe(200);
    expect(engine._inserts[0].options).toEqual({ context: { tenantId: 'org_B' } });
  });

  it('⛔ invents nothing when the session carries no active organization', async () => {
    // `marketplace-install-local-plugin`'s `resolveActiveOrgId` falls back to
    // the user's first membership row; that is a SCOPING read for a seed. Here
    // the answer becomes a WALL, and a file stamped from a guessed membership
    // is a file its uploader can no longer see from the organization they were
    // actually acting in.
    const { res, engine } = await bootPluginAndUpload({
      user: { id: 'u1' },
      session: { userId: 'u1' },
    });

    expect(res._status).toBe(200);
    expect(engine._inserts[0].data.owner_id).toBe('u1');
    expect(engine._inserts[0].options).toBeUndefined();
  });
});
