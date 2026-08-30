// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #12928 — the `sys_upload_session` sibling of #12745's forward stamp.
//
// `StorageMetadataStore.createSession` inserted into `sys_upload_session` with
// no third argument, so the driver's `injectTenantOnInsert` had no `tenantId`
// to stamp from and every row landed with `organization_id` NULL — on a
// tenancy-ENABLED object (no `tenancy` key anywhere in
// `objects/system-upload-session.object.ts`) whose column the registry
// provisions unconditionally. The chunked-upload door already held the value:
// it threads the identical `session?.organizationId` into the `createFile`
// twenty lines above.
//
// Maintainer ruling 2026-08-29, verbatim and untranslated: 「同意」 — option A,
// FORWARD STAMP ONLY, no backfill. So these pin the forward channel at both
// altitudes it crosses, and the NULL half is pinned just as hard: a caller
// that genuinely has no organization must still produce the pre-#12928 call
// shape, because "NULL only where the caller genuinely has none" is the other
// half of what was ruled.
//
// ⚠️ What NULL costs is not only cross-tenant reach. Both walled Layer 0
// predicates are exclusive — `computeTenantLayer0Filter` emits
// `{ organization_id: <id> }` under `isolated` and `{ $in: [...] }` under
// `group`, and neither matches NULL (pinned in plugin-security's
// `tenant-layer.test.ts`, "the wall excludes NULL rows"). So an unstamped
// session row is invisible to its OWN tenant on a walled deployment, the same
// silent-empty class `sys_api_key` was renamed to avoid.

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
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { StorageMetadataStore } from './metadata-store.js';
import type { UploadSessionRecord } from './metadata-store.js';
import { registerStorageRoutes } from './storage-routes.js';

// ---------------------------------------------------------------------------
// A fake engine that records the OPTIONS bag of every insert — the argument
// this whole card is about. Same double as the #12745 suite next door; each
// verb opens with the producer's OWN dispatch predicate so it can never accept
// a call shape the real `ObjectQL` refuses.
// ---------------------------------------------------------------------------

function createRecordingEngine() {
  const inserts: Array<{ object: string; data: any; options: any }> = [];
  const engine: any = {
    async insert(object: string, data: any, options?: any) {
      inserts.push({ object, data: { ...data }, options });
      return { ...data };
    },
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
    async find() {
      return [];
    },
    async count() {
      return 0;
    },
    async aggregate() {
      return [];
    },
    _inserts: inserts,
  };
  return engine;
}

const sessionRec = (id: string): UploadSessionRecord => ({
  id,
  file_id: `f_${id}`,
  key: `user/${id}.bin`,
  filename: `${id}.bin`,
  total_size: 10,
  chunk_size: 5,
  total_chunks: 2,
  status: 'in_progress',
});

// ---------------------------------------------------------------------------
// 1. The store — the missing channel
// ---------------------------------------------------------------------------

describe('StorageMetadataStore.createSession: the acting organization reaches the engine', () => {
  it('threads the organization as an execution context on the insert', async () => {
    const engine = createRecordingEngine();
    const store = new StorageMetadataStore(engine);

    await store.createSession(sessionRec('s1'), { organizationId: 'org_A' });

    expect(engine._inserts).toHaveLength(1);
    expect(engine._inserts[0].object).toBe('sys_upload_session');
    // The platform's insert-side chokepoint reads exactly this:
    // `context.tenantId` → `buildDriverOptions` → `DriverOptions.tenantId` →
    // `SqlDriver.injectTenantOnInsert` → the object's tenant column.
    expect(engine._inserts[0].options).toEqual({ context: { tenantId: 'org_A' } });
  });

  it('⛔ does NOT stamp the column onto the payload — that decision is the driver’s', async () => {
    const engine = createRecordingEngine();
    const store = new StorageMetadataStore(engine);

    await store.createSession(sessionRec('s1'), { organizationId: 'org_A' });

    // Whether this object HAS a tenant column (`resolveTenantField`) and
    // whether an explicit value wins are the driver's answers. A store that
    // wrote the column itself would re-decide both, one package away from the
    // schema — and would fail on an install that opted the object out.
    expect(engine._inserts[0].data).not.toHaveProperty('organization_id');
  });

  it('passes NO options at all when there is no organization — the pre-#12928 shape', async () => {
    const engine = createRecordingEngine();
    const store = new StorageMetadataStore(engine);

    await store.createSession(sessionRec('s1'));
    await store.createSession(sessionRec('s2'), {});
    await store.createSession(sessionRec('s3'), { organizationId: '' });
    await store.createSession(sessionRec('s4'), { organizationId: null });

    // "NULL only where the caller genuinely has none" — the ruled other half.
    // An empty context is still a context; handing one to the engine would
    // change what every other option resolver on that call sees.
    expect(engine._inserts.map((i: { options: unknown }) => i.options)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('records the organization on the engine-absent stand-in too', async () => {
    const store = new StorageMetadataStore(null);

    const created = await store.createSession(sessionRec('s1'), { organizationId: 'org_A' });

    expect(created.organization_id).toBe('org_A');
    expect(await store.getSession('s1')).toMatchObject({ organization_id: 'org_A' });
  });

  it('an explicit organization on the record wins, mirroring `injectTenantOnInsert`', async () => {
    const store = new StorageMetadataStore(null);

    const created = await store.createSession(
      { ...sessionRec('s1'), organization_id: 'org_EXPLICIT' },
      { organizationId: 'org_SESSION' },
    );

    expect(created.organization_id).toBe('org_EXPLICIT');
  });

  it('leaves the stand-in row unstamped when the caller has no organization', async () => {
    const store = new StorageMetadataStore(null);

    const created = await store.createSession(sessionRec('s1'));

    expect(created.organization_id).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. The route — the chunked-upload door, the only production caller
// ---------------------------------------------------------------------------

function createMockHttpServer() {
  const routes = new Map<string, RouteHandler>();
  return {
    get: vi.fn((path: string, handler: RouteHandler) => {
      routes.set(`GET:${path}`, handler);
    }),
    post: vi.fn((path: string, handler: RouteHandler) => {
      routes.set(`POST:${path}`, handler);
    }),
    put: vi.fn((path: string, handler: RouteHandler) => {
      routes.set(`PUT:${path}`, handler);
    }),
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
  return {
    params: {},
    query: {},
    body: undefined,
    headers: {},
    method: 'POST',
    path: '/',
    ...overrides,
  } as IHttpRequest;
}

function createMockRes(): IHttpResponse & { _status: number; _json: any } {
  const res: any = {
    _status: 200,
    _json: null,
    json(data: any) {
      res._json = data;
    },
    send(data: any) {
      res._sent = data;
    },
    status(code: number) {
      res._status = code;
      return res;
    },
    header() {
      return res;
    },
  };
  return res;
}

const CHUNKED_PATH = '/api/v1/storage/upload/chunked';
const CHUNKED_BODY = { filename: 'b.bin', mimeType: 'application/octet-stream', totalSize: 10 };

async function driveChunkedDoor(session: { userId?: string; organizationId?: string } | null) {
  const rootDir = join(tmpdir(), `os-12928-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(rootDir, { recursive: true });
  try {
    const adapter = new LocalStorageAdapter({ rootDir, signingSecret: 'test-secret' });
    const engine = createRecordingEngine();
    const store = new StorageMetadataStore(engine);
    const httpServer = createMockHttpServer();
    registerStorageRoutes(httpServer as any, adapter, store, {
      basePath: '/api/v1/storage',
      resolveSession: async () => session,
    });

    const handler = httpServer._getHandler('POST', CHUNKED_PATH)!;
    const res = createMockRes();
    await handler(createMockReq({ body: CHUNKED_BODY }), res);
    return { res, engine };
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

describe('the chunked-upload door stamps its sys_upload_session row from the session', () => {
  it('threads the session organization into the session insert', async () => {
    const { res, engine } = await driveChunkedDoor({ userId: 'u1', organizationId: 'org_A' });

    expect(res._status).toBe(200);
    const insert = engine._inserts.find((i: any) => i.object === 'sys_upload_session');
    expect(insert).toBeTruthy();
    expect(insert.options).toEqual({ context: { tenantId: 'org_A' } });
  });

  it('stamps the file and the session row from the SAME session value', async () => {
    const { engine } = await driveChunkedDoor({ userId: 'u1', organizationId: 'org_A' });

    // The asymmetry this card records: before #12928 the `sys_file` insert two
    // dozen lines up carried the context and this one did not. Asserting the
    // pair together is what keeps them from drifting apart again.
    const file = engine._inserts.find((i: any) => i.object === 'sys_file');
    const session = engine._inserts.find((i: any) => i.object === 'sys_upload_session');
    expect(file.options).toEqual({ context: { tenantId: 'org_A' } });
    expect(session.options).toEqual(file.options);
  });

  it('a session with no active organization stamps nothing — ⛔ no guess is substituted', async () => {
    const { res, engine } = await driveChunkedDoor({ userId: 'u1' });

    expect(res._status).toBe(200);
    const insert = engine._inserts.find((i: any) => i.object === 'sys_upload_session');
    expect(insert).toBeTruthy();
    // Ruled: NULL only where the caller genuinely has none. Such a row is what
    // the TTL sweep reaps rather than what a backfill repairs.
    expect(insert.options).toBeUndefined();
    expect(insert.data).not.toHaveProperty('organization_id');
  });
});
