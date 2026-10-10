// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #22470 — one upload-scope list. `@objectstack/spec` declares it once
// (`UploadScopeSchema`, api/storage.zod.ts); the upload requests' `scope`, the
// `sys_file.scope` select and the two upload-starting doors all read it.
//
// Before this, the request declared `scope` an open string, the doors passed a
// caller's value straight to the `sys_file` insert, and the data engine refused
// anything outside the select as an invalid option — which the door relayed as
// `500 INTERNAL` telling the operator to restore the data engine. The door pins
// below run on a REAL ObjectQL over a REAL SqlDriver on sqlite `:memory:` with
// the real `SystemFile` / `SystemUploadSession` objects, because the defect
// was the engine's select check meeting an open request: a double would only
// restate what this file has to measure.
//
// What is pinned:
//
//   - the `sys_file.scope` select's values ARE the enum's values, in order,
//     with their labels;
//   - `scope: 'avatars'` on each upload-starting door → 400 INVALID_REQUEST
//     naming the allowed values, and no `sys_file` row, no session row, no URL
//     and no backend call;
//   - control: each allowed scope, and an omitted one, still starts an upload
//     that the real engine stores;
//   - control: a real engine fault on an allowed scope still answers 500.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { UploadScopeSchema } from '@objectstack/spec/api';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { SystemFile } from './objects/system-file.object.js';
import { SystemUploadSession } from './objects/system-upload-session.object.js';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { StorageMetadataStore } from './metadata-store.js';
import { registerStorageRoutes } from './storage-routes.js';

const PRESIGNED = '/api/v1/storage/upload/presigned';
const CHUNKED = '/api/v1/storage/upload/chunked';
const DOORS = [PRESIGNED, CHUNKED] as const;

// Literal on purpose — the list the select, the request and the doors share.
const UPLOAD_SCOPES = ['user', 'tenant', 'private', 'temp', 'attachments'] as const;

const silentLogger = () => ({
  info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(),
  trace: vi.fn(), fatal: vi.fn(), child() { return this; },
});

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
    handler(method: string, path: string): RouteHandler {
      const h = routes.get(`${method}:${path}`);
      if (!h) throw new Error(`no route ${method} ${path}`);
      return h;
    },
  };
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

const bodyFor = (door: string, scope?: unknown): Record<string, unknown> => ({
  filename: 'logo.png',
  mimeType: 'image/png',
  ...(door === PRESIGNED ? { size: 3 } : { totalSize: 3 }),
  ...(scope === undefined ? {} : { scope }),
});

describe('the sys_file scope select reads the spec upload-scope enum (#22470)', () => {
  const scopeField = (SystemFile as any).fields.scope;

  it('lists exactly the enum values, in the enum order', () => {
    expect(scopeField.type).toBe('select');
    expect(scopeField.options.map((o: { value: string }) => o.value)).toEqual([...UploadScopeSchema.options]);
    expect([...UploadScopeSchema.options]).toEqual([...UPLOAD_SCOPES]);
  });

  it('keeps one label per scope', () => {
    expect(scopeField.options).toEqual([
      { label: 'User', value: 'user' },
      { label: 'Tenant', value: 'tenant' },
      { label: 'Private', value: 'private' },
      { label: 'Temp', value: 'temp' },
      { label: 'Attachments', value: 'attachments' },
    ]);
  });
});

describe('the upload-starting doors refuse a scope outside the vocabulary (#22470) — a real ObjectQL over SqlDriver (sqlite :memory:)', () => {
  let rootDir: string;
  let sql: SqlDriver;
  let engine: ObjectQL;
  let adapter: LocalStorageAdapter;
  let store: StorageMetadataStore;
  let server: ReturnType<typeof createMockHttpServer>;

  beforeEach(async () => {
    rootDir = join(tmpdir(), `os-upload-scope-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(rootDir, { recursive: true });
    sql = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    engine = new ObjectQL({ logger: silentLogger() } as any);
    engine.registerDriver(sql as any, true);
    await engine.init();
    engine.registry.registerObject(SystemFile as any, 'com.objectstack.storage');
    engine.registry.registerObject(SystemUploadSession as any, 'com.objectstack.storage');
    await engine.syncSchemas();

    adapter = new LocalStorageAdapter({ rootDir, signingSecret: 'test-secret' });
    store = new StorageMetadataStore(engine as any);
    server = createMockHttpServer();
    registerStorageRoutes(server as any, adapter, store, { basePath: '/api/v1/storage' });
  });

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* already torn down */ }
    if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
  });

  const post = async (door: string, body: Record<string, unknown>) => {
    const res = createMockRes();
    await server.handler('POST', door)({ params: {}, query: {}, headers: {}, method: 'POST', path: door, body } as IHttpRequest, res);
    return res;
  };
  const storedFiles = () => engine.find('sys_file', { context: { isSystem: true } } as any);
  const storedSessions = () => engine.find('sys_upload_session', { context: { isSystem: true } } as any);

  it("refuses scope 'avatars' on both doors with 400 INVALID_REQUEST naming the allowed values, before any row, URL or backend call", async () => {
    const presign = vi.spyOn(adapter, 'getPresignedUpload');
    const initiate = vi.spyOn(adapter, 'initiateChunkedUpload');
    for (const door of DOORS) {
      const res = await post(door, bodyFor(door, 'avatars'));
      expect(res._status, door).toBe(400);
      expect(res._json?.success, door).toBe(false);
      expect(res._json?.error?.code, door).toBe('INVALID_REQUEST');
      expect(res._json?.error?.message, door).toMatch(/^scope 'avatars' is not accepted/);
      expect(res._json?.error?.message, door).toContain(`The upload scopes are ${UPLOAD_SCOPES.join(', ')}`);
    }
    expect(await storedFiles()).toHaveLength(0);
    expect(await storedSessions()).toHaveLength(0);
    expect(presign).not.toHaveBeenCalled();
    expect(initiate).not.toHaveBeenCalled();
  });

  it('refuses a value that is not a string, and a case variant, the same way', async () => {
    for (const door of DOORS) {
      for (const scope of [null, 7, 'User']) {
        const res = await post(door, bodyFor(door, scope));
        expect(res._status, `${door} ${String(scope)}`).toBe(400);
        expect(res._json?.error?.code, `${door} ${String(scope)}`).toBe('INVALID_REQUEST');
      }
    }
    expect(await storedFiles()).toHaveLength(0);
  });

  it('starts an upload for every allowed scope, and an omitted one, and the engine stores it (control)', async () => {
    for (const door of DOORS) {
      for (const scope of [...UPLOAD_SCOPES, undefined]) {
        const res = await post(door, bodyFor(door, scope));
        expect(res._status, `${door} ${scope}`).toBe(200);
        const row = await store.getFile(res._json.data.fileId);
        expect(row?.scope, `${door} ${scope}`).toBe(scope ?? 'user');
      }
    }
    expect(await storedFiles()).toHaveLength(2 * (UPLOAD_SCOPES.length + 1));
  });

  it('still answers a real engine fault on an allowed scope with 500 INTERNAL (control)', async () => {
    const realInsert = engine.insert.bind(engine);
    vi.spyOn(engine, 'insert').mockImplementation((object: string, data: any, options?: any) =>
      object === 'sys_file' ? Promise.reject(new Error('sqlite: disk I/O error')) : realInsert(object, data, options));
    for (const door of DOORS) {
      const res = await post(door, bodyFor(door, 'user'));
      expect(res._status, door).toBe(500);
      expect(res._json?.error?.code, door).toBe('INTERNAL');
    }
  });
});
