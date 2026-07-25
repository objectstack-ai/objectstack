// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { LocalStorageAdapter } from './local-storage-adapter';
import { StorageMetadataStore } from './metadata-store';
import { registerStorageRoutes } from './storage-routes';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Mocks
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
    _routes: routes,
  };
}

function createMockReq(overrides: Partial<IHttpRequest> = {}): IHttpRequest {
  return {
    params: {},
    query: {},
    body: undefined,
    headers: {},
    method: 'GET',
    path: '/',
    ...overrides,
  };
}

function createMockRes(): IHttpResponse & { _status: number; _json: any; _headers: Record<string, string> } {
  const res: any = {
    _status: 200,
    _json: null,
    _headers: {},
    json(data: any) { res._json = data; },
    send(data: any) { res._sent = data; },
    status(code: number) { res._status = code; return res; },
    header(name: string, value: string) { res._headers[name] = value; return res; },
  };
  return res;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Storage REST Routes', () => {
  let rootDir: string;
  let adapter: LocalStorageAdapter;
  let store: StorageMetadataStore;
  let httpServer: ReturnType<typeof createMockHttpServer>;

  beforeEach(async () => {
    rootDir = join(tmpdir(), `os-route-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(rootDir, { recursive: true });
    adapter = new LocalStorageAdapter({ rootDir, signingSecret: 'test-secret' });
    store = new StorageMetadataStore(null);
    httpServer = createMockHttpServer();
    registerStorageRoutes(httpServer as any, adapter, store, { basePath: '/api/v1/storage' });
  });

  afterEach(async () => {
    if (rootDir) {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it('should register all required routes', () => {
    const registeredPaths = [...httpServer._routes.keys()];
    expect(registeredPaths).toContain('POST:/api/v1/storage/upload/presigned');
    expect(registeredPaths).toContain('POST:/api/v1/storage/upload/complete');
    expect(registeredPaths).toContain('POST:/api/v1/storage/upload/chunked');
    expect(registeredPaths).toContain('PUT:/api/v1/storage/upload/chunked/:uploadId/chunk/:chunkIndex');
    expect(registeredPaths).toContain('POST:/api/v1/storage/upload/chunked/:uploadId/complete');
    expect(registeredPaths).toContain('GET:/api/v1/storage/upload/chunked/:uploadId/progress');
    expect(registeredPaths).toContain('GET:/api/v1/storage/files/:fileId/url');
    expect(registeredPaths).toContain('PUT:/api/v1/storage/_local/raw/:token');
    expect(registeredPaths).toContain('GET:/api/v1/storage/_local/raw/:token');
  });

  describe('POST /upload/presigned', () => {
    it('should return presigned upload details', async () => {
      const handler = httpServer._getHandler('POST', '/api/v1/storage/upload/presigned')!;
      const req = createMockReq({
        body: { filename: 'photo.jpg', mimeType: 'image/jpeg', size: 1024, scope: 'user' },
      });
      const res = createMockRes();
      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._json.data).toBeDefined();
      expect(res._json.data.fileId).toBeTruthy();
      expect(res._json.data.uploadUrl).toContain('/_local/raw/');
      expect(res._json.data.method).toBe('PUT');
      expect(res._json.data.expiresIn).toBeGreaterThan(0);
    });

    it('should reject missing required fields', async () => {
      const handler = httpServer._getHandler('POST', '/api/v1/storage/upload/presigned')!;
      const req = createMockReq({ body: { filename: 'x.txt' } });
      const res = createMockRes();
      await handler(req, res);
      expect(res._status).toBe(400);
    });
  });

  describe('POST /upload/complete', () => {
    it('should mark file as committed', async () => {
      // First create a pending file
      const presignHandler = httpServer._getHandler('POST', '/api/v1/storage/upload/presigned')!;
      const presignReq = createMockReq({
        body: { filename: 'test.txt', mimeType: 'text/plain', size: 5 },
      });
      const presignRes = createMockRes();
      await presignHandler(presignReq, presignRes);
      const fileId = presignRes._json.data.fileId;

      // Now complete it
      const completeHandler = httpServer._getHandler('POST', '/api/v1/storage/upload/complete')!;
      const completeReq = createMockReq({ body: { fileId } });
      const completeRes = createMockRes();
      await completeHandler(completeReq, completeRes);

      expect(completeRes._status).toBe(200);
      expect(completeRes._json.data.name).toBe('test.txt');
      expect(completeRes._json.data.mimeType).toBe('text/plain');
      // ADR-0104 D3 PR-1: the commit response surfaces the opaque sys_file id
      // so a caller can persist it in a file field.
      expect(completeRes._json.data.fileId).toBe(fileId);
    });

    it('should 404 for unknown fileId', async () => {
      const handler = httpServer._getHandler('POST', '/api/v1/storage/upload/complete')!;
      const req = createMockReq({ body: { fileId: 'nonexistent' } });
      const res = createMockRes();
      await handler(req, res);
      expect(res._status).toBe(404);
    });
  });

  describe('Chunked upload flow', () => {
    it('should initiate, upload chunks, and complete', async () => {
      // 1. Initiate
      const initHandler = httpServer._getHandler('POST', '/api/v1/storage/upload/chunked')!;
      const initReq = createMockReq({
        body: { filename: 'large.bin', mimeType: 'application/octet-stream', totalSize: 100, chunkSize: 5242880 },
      });
      const initRes = createMockRes();
      await initHandler(initReq, initRes);
      expect(initRes._status).toBe(200);
      const { uploadId, resumeToken, fileId, totalChunks } = initRes._json.data;
      expect(uploadId).toBeTruthy();
      expect(resumeToken).toBeTruthy();
      expect(totalChunks).toBe(1);

      // 2. Upload chunk
      const chunkHandler = httpServer._getHandler('PUT', '/api/v1/storage/upload/chunked/:uploadId/chunk/:chunkIndex')!;
      const chunkData = Buffer.from('a'.repeat(100));
      const chunkReq = createMockReq({
        params: { uploadId, chunkIndex: '0' },
        headers: { 'x-resume-token': resumeToken },
        rawBody: async () => chunkData,
      } as any);
      const chunkRes = createMockRes();
      await chunkHandler(chunkReq, chunkRes);
      expect(chunkRes._status).toBe(200);
      expect(chunkRes._json.data.eTag).toBeTruthy();
      const eTag = chunkRes._json.data.eTag;

      // 3. Complete
      const completeHandler = httpServer._getHandler('POST', '/api/v1/storage/upload/chunked/:uploadId/complete')!;
      const completeReq = createMockReq({
        params: { uploadId },
        body: { parts: [{ chunkIndex: 0, eTag }] },
      });
      const completeRes = createMockRes();
      await completeHandler(completeReq, completeRes);
      expect(completeRes._status).toBe(200);
      expect(completeRes._json.data.fileId).toBe(fileId);
      expect(completeRes._json.data.size).toBe(100);
    });

    it('should return progress for an active upload', async () => {
      // Initiate
      const initHandler = httpServer._getHandler('POST', '/api/v1/storage/upload/chunked')!;
      const initReq = createMockReq({
        body: { filename: 'progress.bin', mimeType: 'application/octet-stream', totalSize: 200 },
      });
      const initRes = createMockRes();
      await initHandler(initReq, initRes);
      const { uploadId } = initRes._json.data;

      // Get progress (no chunks uploaded yet)
      const progressHandler = httpServer._getHandler('GET', '/api/v1/storage/upload/chunked/:uploadId/progress')!;
      const progressReq = createMockReq({ params: { uploadId } });
      const progressRes = createMockRes();
      await progressHandler(progressReq, progressRes);
      expect(progressRes._status).toBe(200);
      expect(progressRes._json.data.uploadedChunks).toBe(0);
      expect(progressRes._json.data.status).toBe('in_progress');
    });
  });

  describe('GET /files/:fileId/url', () => {
    it('should return download URL for committed file', async () => {
      // Create and commit a file
      const presignHandler = httpServer._getHandler('POST', '/api/v1/storage/upload/presigned')!;
      const presignReq = createMockReq({
        body: { filename: 'dl.txt', mimeType: 'text/plain', size: 5 },
      });
      const presignRes = createMockRes();
      await presignHandler(presignReq, presignRes);
      const fileId = presignRes._json.data.fileId;

      // Upload the actual file
      await adapter.upload(`user/${fileId}.txt`, Buffer.from('hello'));

      // Complete
      const completeHandler = httpServer._getHandler('POST', '/api/v1/storage/upload/complete')!;
      await completeHandler(createMockReq({ body: { fileId } }), createMockRes());

      // Get URL
      const urlHandler = httpServer._getHandler('GET', '/api/v1/storage/files/:fileId/url')!;
      const urlReq = createMockReq({ params: { fileId } });
      const urlRes = createMockRes();
      await urlHandler(urlReq, urlRes);
      expect(urlRes._status).toBe(200);
      expect(urlRes._json.url).toContain('/_local/raw/');
    });

    it('should 404 for non-committed file', async () => {
      const handler = httpServer._getHandler('GET', '/api/v1/storage/files/:fileId/url')!;
      const req = createMockReq({ params: { fileId: 'ghost' } });
      const res = createMockRes();
      await handler(req, res);
      expect(res._status).toBe(404);
    });
  });

  describe('attachments download gate (#2970 item 2)', () => {
    const commit = async (s: StorageMetadataStore, rec: Partial<import('./metadata-store').FileRecord>) =>
      s.createFile({
        id: rec.id ?? 'f-dl',
        key: rec.key ?? `attachments/${rec.id ?? 'f-dl'}.bin`,
        name: 'x.bin',
        status: 'committed',
        acl: rec.acl ?? 'private',
        scope: rec.scope ?? 'attachments',
        owner_id: rec.owner_id,
        ...rec,
      } as any);

    function serverWith(verdict: import('./storage-routes').FileReadVerdict | 'skip', extra: any = {}) {
      const server = createMockHttpServer();
      const s = new StorageMetadataStore(null);
      const authorizeFileRead =
        verdict === 'skip' ? undefined : vi.fn(async () => verdict as any);
      registerStorageRoutes(server as any, adapter, s, {
        basePath: '/api/v1/storage',
        authorizeFileRead,
        ...extra,
      });
      return { server, store: s, authorizeFileRead };
    }

    const hit = async (server: any, path: string, fileId: string) => {
      const res = createMockRes();
      await server._getHandler('GET', path)!(createMockReq({ params: { fileId } }), res);
      return res;
    };

    it('401s an unauthenticated download of an attachments file (both endpoints)', async () => {
      const { server, store: s } = serverWith('unauthenticated');
      await commit(s, { id: 'a1' });
      for (const p of ['/api/v1/storage/files/:fileId/url', '/api/v1/storage/files/:fileId']) {
        const res = await hit(server, p, 'a1');
        expect(res._status, p).toBe(401);
        expect(res._json?.code, p).toBe('AUTH_REQUIRED');
      }
    });

    it('403s when the caller cannot read any parent record', async () => {
      const { server, store: s } = serverWith('deny');
      await commit(s, { id: 'a2' });
      const res = await hit(server, '/api/v1/storage/files/:fileId/url', 'a2');
      expect(res._status).toBe(403);
      expect(res._json?.code).toBe('ATTACHMENT_DOWNLOAD_DENIED');
    });

    it('allows the download when authorized, minting a short-lived signed URL', async () => {
      const { server, store: s, authorizeFileRead } = serverWith('allow', { downloadTtl: 120 });
      await commit(s, { id: 'a3' });
      const res = await hit(server, '/api/v1/storage/files/:fileId/url', 'a3');
      expect(res._status).toBe(200);
      expect(res._json.url).toContain('/_local/raw/');
      expect(authorizeFileRead).toHaveBeenCalledOnce();
    });

    it('never gates a public_read attachments file (authorizer not consulted)', async () => {
      const { server, store: s, authorizeFileRead } = serverWith('deny');
      await commit(s, { id: 'a4', acl: 'public_read' });
      const res = await hit(server, '/api/v1/storage/files/:fileId/url', 'a4');
      expect(res._status).toBe(200);
      expect(authorizeFileRead).not.toHaveBeenCalled();
    });

    it('never gates a non-attachments file (avatars / field files stay open)', async () => {
      const { server, store: s, authorizeFileRead } = serverWith('deny');
      await commit(s, { id: 'a5', scope: 'user', key: 'user/a5.png' });
      const res = await hit(server, '/api/v1/storage/files/:fileId', 'a5');
      expect(res._status).toBe(302);
      expect(authorizeFileRead).not.toHaveBeenCalled();
    });

    it('stays open when no authorizer is wired (back-compat)', async () => {
      const { server, store: s } = serverWith('skip');
      await commit(s, { id: 'a6' });
      const res = await hit(server, '/api/v1/storage/files/:fileId/url', 'a6');
      expect(res._status).toBe(200);
    });
  });

  describe('PUT/GET /_local/raw/:token', () => {
    it('should accept raw upload with valid token and serve download', async () => {
      // Generate a presigned upload
      const desc = await adapter.getPresignedUpload!('rawtest/file.bin', 60, { contentType: 'application/octet-stream' });
      const token = desc.uploadUrl.split('/_local/raw/')[1];

      // PUT handler
      const putHandler = httpServer._getHandler('PUT', '/api/v1/storage/_local/raw/:token')!;
      const data = Buffer.from('raw bytes');
      const putReq = createMockReq({
        params: { token },
        rawBody: async () => data,
      } as any);
      const putRes = createMockRes();
      await putHandler(putReq, putRes);
      expect(putRes._status).toBe(200);
      expect(putRes._json.ok).toBe(true);

      // Verify file was written
      const downloaded = await adapter.download('rawtest/file.bin');
      expect(downloaded.toString()).toBe('raw bytes');
    });

    it('should reject invalid token on raw upload', async () => {
      const putHandler = httpServer._getHandler('PUT', '/api/v1/storage/_local/raw/:token')!;
      const putReq = createMockReq({
        params: { token: 'invalid.token' },
        rawBody: async () => Buffer.from('x'),
      } as any);
      const putRes = createMockRes();
      await putHandler(putReq, putRes);
      expect(putRes._status).toBe(403);
    });
  });

  describe('upload auth gate (#2755)', () => {
    const presignBody = { filename: 'a.txt', mimeType: 'text/plain', size: 3 };

    function registerWithResolver(resolveSession: any) {
      const server = createMockHttpServer();
      registerStorageRoutes(server as any, adapter, store, {
        basePath: '/api/v1/storage',
        resolveSession,
      });
      return server;
    }

    it('401s anonymous requests on every upload entry point when a resolver is wired', async () => {
      const server = registerWithResolver(async () => null);
      const uploadRoutes: Array<[string, string, any]> = [
        ['POST', '/api/v1/storage/upload/presigned', { body: presignBody }],
        ['POST', '/api/v1/storage/upload/complete', { body: { fileId: 'x' } }],
        ['POST', '/api/v1/storage/upload/chunked', { body: { filename: 'a', mimeType: 't', totalSize: 1 } }],
        ['PUT', '/api/v1/storage/upload/chunked/:uploadId/chunk/:chunkIndex', { params: { uploadId: 'u', chunkIndex: '0' } }],
        ['POST', '/api/v1/storage/upload/chunked/:uploadId/complete', { params: { uploadId: 'u' } }],
        ['GET', '/api/v1/storage/upload/chunked/:uploadId/progress', { params: { uploadId: 'u' } }],
      ];
      for (const [method, path, reqOpts] of uploadRoutes) {
        const res = createMockRes();
        await server._getHandler(method, path)!(createMockReq(reqOpts as any), res);
        expect(res._status, `${method} ${path}`).toBe(401);
        expect(res._json?.code, `${method} ${path}`).toBe('AUTH_REQUIRED');
      }
    });

    it('stamps owner_id from the resolved session on presigned uploads', async () => {
      const server = registerWithResolver(async () => ({ userId: 'user-42' }));
      const res = createMockRes();
      await server._getHandler('POST', '/api/v1/storage/upload/presigned')!(
        createMockReq({ body: presignBody }),
        res,
      );
      expect(res._status).toBe(200);
      const file = await store.getFile(res._json.data.fileId);
      expect(file?.owner_id).toBe('user-42');
    });

    it('download routes stay open even with a resolver wired (capability URLs)', async () => {
      const server = registerWithResolver(async () => null);
      const res = createMockRes();
      await server._getHandler('GET', '/api/v1/storage/files/:fileId/url')!(
        createMockReq({ params: { fileId: 'missing' } }),
        res,
      );
      expect(res._status).toBe(404); // not 401 — anonymous reads reach the handler
    });

    it('stays open (back-compat) when no resolver is wired', async () => {
      // The default beforeEach registration has no resolver.
      const res = createMockRes();
      await httpServer._getHandler('POST', '/api/v1/storage/upload/presigned')!(
        createMockReq({ body: presignBody }),
        res,
      );
      expect(res._status).toBe(200);
      const file = await store.getFile(res._json.data.fileId);
      expect(file?.owner_id).toBeUndefined();
    });

    it('a throwing resolver fails closed (401), never open', async () => {
      const server = registerWithResolver(async () => { throw new Error('auth backend down'); });
      const res = createMockRes();
      await server._getHandler('POST', '/api/v1/storage/upload/presigned')!(
        createMockReq({ body: presignBody }),
        res,
      );
      expect(res._status).toBe(401);
    });
  });
});
