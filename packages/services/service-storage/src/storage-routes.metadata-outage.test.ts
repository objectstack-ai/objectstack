// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #5216, the half that is visible to a caller: a `sys_file` /
// `sys_upload_session` write that never landed must not come back as `200 {
// success: true }`.
//
// Before this change `StorageMetadataStore` swallowed every engine failure and
// returned the record it had just put in a process-local Map, so
// `POST /upload/presigned` answered 200 with a `fileId` naming a row that did
// not exist anywhere durable — and `GET /files/:id/url` answered 404
// FILE_NOT_FOUND during an engine outage, which reports durable business truth
// as missing. Both now surface through the route handlers' existing
// `catch → sendError(500, 'INTERNAL')`, so the REST layer needed no change:
// making the store honest was enough.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IHttpRequest, IHttpResponse, RouteHandler, IDataEngine } from '@objectstack/spec/contracts';
import { assertEngineDeleteDispatch, assertEngineFindOnePredicate } from '@objectstack/objectql';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { StorageMetadataStore } from './metadata-store.js';
import { registerStorageRoutes } from './storage-routes.js';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Harness
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
  return { params: {}, query: {}, body: undefined, headers: {}, method: 'GET', path: '/', ...overrides };
}

function createMockRes(): IHttpResponse & { _status: number; _json: any } {
  const res: any = {
    _status: 200,
    _json: null,
    json(data: any) { res._json = data; },
    send(data: any) { res._sent = data; },
    status(code: number) { res._status = code; return res; },
    header(name: string, value: string) { res._headers = { ...(res._headers ?? {}), [name]: value }; return res; },
  };
  return res;
}

type EngineMethod = 'insert' | 'update' | 'delete' | 'findOne';

/**
 * In-memory engine double with per-method failure toggles. `delete` opens with
 * the producer's own dispatch predicate (#4550/#5197) so it can never accept a
 * call shape the real `ObjectQL.delete` refuses.
 */
function createFakeEngine(opts: { failing?: EngineMethod[] } = {}) {
  const failing = new Set<EngineMethod>(opts.failing ?? []);
  const rows = new Map<string, Map<string, any>>();
  const table = (object: string) => {
    let t = rows.get(object);
    if (!t) rows.set(object, (t = new Map()));
    return t;
  };
  const boom = (method: EngineMethod, object: string) => {
    if (failing.has(method)) throw new Error(`simulated engine outage on ${method}(${object})`);
  };
  const engine = {
    async insert(object: string, data: any) {
      boom('insert', object);
      table(object).set(String(data.id), { ...data });
      return { ...data };
    },
    async findOne(object: string, query?: any) {
      assertEngineFindOnePredicate(object, query);
      boom('findOne', object);
      return table(object).get(String(query?.where?.id)) ?? null;
    },
    async update(object: string, data: any, options?: any) {
      boom('update', object);
      const id = String(options?.where?.id ?? data?.id);
      const t = table(object);
      if (!t.has(id)) return null;
      t.set(id, { ...t.get(id), ...data });
      return { ...t.get(id) };
    },
    async delete(object: string, options?: any) {
      assertEngineDeleteDispatch(options);
      boom('delete', object);
      return table(object).delete(String(options?.where?.id)) ? 1 : 0;
    },
    async find() { return []; },
    async count() { return 0; },
    async aggregate() { return []; },
    _rows: (object: string) => [...table(object).values()],
    _setFailing: (method: EngineMethod, on: boolean) => {
      if (on) failing.add(method);
      else failing.delete(method);
    },
  };
  return engine as typeof engine & IDataEngine;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Storage routes: a metadata write that never landed is not a 200 (#5216)', () => {
  let rootDir: string;
  let adapter: LocalStorageAdapter;
  let httpServer: ReturnType<typeof createMockHttpServer>;

  const mount = (engine: IDataEngine) => {
    const store = new StorageMetadataStore(engine);
    registerStorageRoutes(httpServer as any, adapter, store, { basePath: '/api/v1/storage' });
    return store;
  };

  beforeEach(async () => {
    rootDir = join(tmpdir(), `os-5216-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(rootDir, { recursive: true });
    adapter = new LocalStorageAdapter({ rootDir, signingSecret: 'test-secret' });
    httpServer = createMockHttpServer();
  });

  afterEach(async () => {
    if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('POST /upload/presigned answers 500, not 200, when the sys_file insert fails', async () => {
    const engine = createFakeEngine({ failing: ['insert'] });
    mount(engine);

    const handler = httpServer._getHandler('POST', '/api/v1/storage/upload/presigned')!;
    const res = createMockRes();
    await handler(
      createMockReq({ body: { filename: 'photo.jpg', mimeType: 'image/jpeg', size: 1024, scope: 'user' } }),
      res,
    );

    expect(res._status).toBe(500);
    expect(res._json.success).toBe(false);
    expect(res._json.error.code).toBe('INTERNAL');
    expect(res._json.error.message).toContain('sys_file row was NOT written');
    expect(engine._rows('sys_file')).toHaveLength(0);
  });

  it('POST /upload/chunked answers 500 when the sys_upload_session insert fails', async () => {
    const engine = createFakeEngine();
    mount(engine);

    // sys_file lands; the session insert is the one that fails.
    const originalInsert = engine.insert.bind(engine);
    (engine as any).insert = async (object: string, data: any) => {
      if (object === 'sys_upload_session') throw new Error('simulated engine outage on insert(sys_upload_session)');
      return originalInsert(object, data);
    };

    const handler = httpServer._getHandler('POST', '/api/v1/storage/upload/chunked')!;
    const res = createMockRes();
    await handler(
      createMockReq({ body: { filename: 'big.bin', mimeType: 'application/octet-stream', totalSize: 10_000_000 } }),
      res,
    );

    expect(res._status).toBe(500);
    expect(res._json.error.code).toBe('INTERNAL');
    expect(res._json.error.message).toContain('cannot find this upload');
  });

  it('POST /upload/complete answers 500, not 200, when the sys_file update fails', async () => {
    const engine = createFakeEngine();
    const store = mount(engine);
    await store.createFile({ id: 'f1', key: 'user/f1.txt', name: 'f1.txt', status: 'pending' });
    engine._setFailing('update', true);

    const handler = httpServer._getHandler('POST', '/api/v1/storage/upload/complete')!;
    const res = createMockRes();
    await handler(createMockReq({ body: { fileId: 'f1', eTag: 'abc' } }), res);

    expect(res._status).toBe(500);
    expect(res._json.error.message).toContain('did not land');
    // The row is untouched — which is exactly what the 500 now tells the caller.
    expect(engine._rows('sys_file')[0]).toMatchObject({ status: 'pending' });
  });

  it('GET /files/:fileId/url answers 500 on a read OUTAGE, not 404 FILE_NOT_FOUND', async () => {
    const engine = createFakeEngine();
    const store = mount(engine);
    await store.createFile({ id: 'f1', key: 'user/f1.txt', name: 'f1.txt', status: 'committed' });
    engine._setFailing('findOne', true);

    const handler = httpServer._getHandler('GET', '/api/v1/storage/files/:fileId/url')!;
    const res = createMockRes();
    await handler(createMockReq({ params: { fileId: 'f1' } }), res);

    expect(res._status).toBe(500);
    expect(res._json.error.code).toBe('INTERNAL');
    expect(res._json.error.message).toContain('NOT the same as it being absent');
  });

  it('GET /files/:fileId/url still answers 404 on a genuine MISS', async () => {
    mount(createFakeEngine());

    const handler = httpServer._getHandler('GET', '/api/v1/storage/files/:fileId/url')!;
    const res = createMockRes();
    await handler(createMockReq({ params: { fileId: 'never-existed' } }), res);

    expect(res._status).toBe(404);
    expect(res._json.error.code).toBe('FILE_NOT_FOUND');
  });

  it('GET /upload/chunked/:uploadId/progress answers 500 on a read outage, 404 on a miss', async () => {
    const engine = createFakeEngine();
    const store = mount(engine);
    await store.createSession({
      id: 'u1',
      file_id: 'f1',
      key: 'user/f1.bin',
      filename: 'f1.bin',
      total_size: 100,
      chunk_size: 50,
      total_chunks: 2,
      status: 'in_progress',
    });

    const handler = httpServer._getHandler('GET', '/api/v1/storage/upload/chunked/:uploadId/progress')!;

    const miss = createMockRes();
    await handler(createMockReq({ params: { uploadId: 'nope' } }), miss);
    expect(miss._status).toBe(404);
    expect(miss._json.error.code).toBe('UPLOAD_SESSION_NOT_FOUND');

    engine._setFailing('findOne', true);
    const outage = createMockRes();
    await handler(createMockReq({ params: { uploadId: 'u1' } }), outage);
    expect(outage._status).toBe(500);
    expect(outage._json.error.message).toContain('abort a live upload');
  });

  it('with NO engine wired the routes keep their in-memory behaviour', async () => {
    const store = new StorageMetadataStore(null);
    registerStorageRoutes(httpServer as any, adapter, store, { basePath: '/api/v1/storage' });

    const presigned = httpServer._getHandler('POST', '/api/v1/storage/upload/presigned')!;
    const res = createMockRes();
    await presigned(
      createMockReq({ body: { filename: 'photo.jpg', mimeType: 'image/jpeg', size: 1024 } }),
      res,
    );

    expect(res._status).toBe(200);
    expect(res._json.success).toBe(true);
    expect(await store.getFile(res._json.data.fileId)).toMatchObject({ status: 'pending' });
  });
});
