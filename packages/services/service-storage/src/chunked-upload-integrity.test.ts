// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22313] A chunked upload completes with the file it was sent, or not at all.
//
// Two defects, driven here in the order the SDK's `resumeUpload` drives the
// doors (`packages/client/src/index.ts`):
//
//   1. The completion door assembled the parts the REQUEST listed. A resumed
//      upload lists only the chunks the resuming pass sent, so an upload whose
//      chunk 0 was stored in a first pass completed `200` with the declared size
//      while the stored object held chunk 1 alone.
//   2. The chunk door ADDED a re-sent chunk to the session's progress, so the
//      progress overstated `uploadedSize` and `uploadedChunks` — and
//      `resumeUpload` resumes from `uploadedChunks`.
//
// The session already records every chunk it holds (`sys_upload_session.parts`:
// its index, the backend's own eTag for it, and since #22283 its size), so the
// completion door assembles THAT record and checks the request's list against
// it. An upload whose record does not add up to its declared size is refused
// `409 RESOURCE_CONFLICT`, naming what is missing, and nothing is assembled.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { StorageMetadataStore } from './metadata-store.js';
import { registerStorageRoutes } from './storage-routes.js';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BASE = '/api/v1/storage';
const INIT = `${BASE}/upload/chunked`;
const CHUNK = `${BASE}/upload/chunked/:uploadId/chunk/:chunkIndex`;
const COMPLETE = `${BASE}/upload/chunked/:uploadId/complete`;
const PROGRESS = `${BASE}/upload/chunked/:uploadId/progress`;

/** The chunk size the init door floors every upload at (5 MiB). */
const MIN_CHUNK = 5 * 1024 * 1024;

type Res = IHttpResponse & { _status: number; _json: any };
type Part = { chunkIndex: number; eTag: string };

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

function createMockReq(overrides: Partial<IHttpRequest> & Record<string, unknown> = {}): IHttpRequest {
  return { params: {}, query: {}, body: undefined, headers: {}, method: 'GET', path: '/', ...overrides } as IHttpRequest;
}

function createMockRes(): Res {
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

describe('[#22313] the chunked completion door assembles the parts the upload holds', () => {
  let rootDir: string;
  let adapter: LocalStorageAdapter;
  let store: StorageMetadataStore;
  let server: ReturnType<typeof createMockHttpServer>;

  beforeEach(async () => {
    rootDir = join(tmpdir(), `os-chunk-integrity-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(rootDir, { recursive: true });
    adapter = new LocalStorageAdapter({ rootDir, signingSecret: 'test-secret' });
    store = new StorageMetadataStore(null);
    server = createMockHttpServer();
    registerStorageRoutes(server as any, adapter, store, { basePath: BASE });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  // ── the doors, called the way a client calls them ──────────────────────

  async function init(totalSize: number) {
    const res = createMockRes();
    await server.handler('POST', INIT)(
      createMockReq({ body: { filename: 'big.bin', mimeType: 'application/octet-stream', totalSize } }),
      res,
    );
    expect(res._status, JSON.stringify(res._json)).toBe(200);
    return res._json.data as { uploadId: string; resumeToken: string; fileId: string; totalChunks: number };
  }

  async function putChunk(uploadId: string, resumeToken: string, chunkIndex: number, bytes: Buffer): Promise<Res> {
    const res = createMockRes();
    await server.handler('PUT', CHUNK)(
      createMockReq({
        params: { uploadId, chunkIndex: String(chunkIndex) },
        headers: { 'x-resume-token': resumeToken },
        rawBody: async () => bytes,
      }),
      res,
    );
    expect(res._status, JSON.stringify(res._json)).toBe(200);
    return res;
  }

  async function progress(uploadId: string) {
    const res = createMockRes();
    await server.handler('GET', PROGRESS)(createMockReq({ params: { uploadId } }), res);
    expect(res._status, JSON.stringify(res._json)).toBe(200);
    return res._json.data as {
      uploadedSize: number;
      uploadedChunks: number;
      percentComplete: number;
      totalChunks: number;
      status: string;
    };
  }

  async function complete(uploadId: string, parts: Part[]): Promise<Res> {
    const res = createMockRes();
    await server.handler('POST', COMPLETE)(createMockReq({ params: { uploadId }, body: { uploadId, parts } }), res);
    return res;
  }

  const etagOf = (res: Res) => res._json.data.eTag as string;
  const fill = (byte: string, n: number) => Buffer.alloc(n, byte);

  /** The refusal every rule below answers: the status, the code, and the session left resumable. */
  async function expectRefused(res: Res, uploadId: string, fileId: string) {
    expect(res._status, JSON.stringify(res._json)).toBe(409);
    expect(res._json.success).toBe(false);
    expect(res._json.error.code).toBe('RESOURCE_CONFLICT');
    // Nothing moved: the upload can still be finished by sending what it lacks.
    expect((await store.getSession(uploadId))!.status).toBe('in_progress');
    expect((await store.getFile(fileId))!.status).toBe('pending');
  }

  // ── finding 1 ──────────────────────────────────────────────────────────

  it('a RESUMED upload whose resume lists only its own chunk completes with the FULL file', async () => {
    const chunk0 = fill('a', MIN_CHUNK);
    const chunk1 = fill('b', 10);
    const { uploadId, resumeToken, fileId, totalChunks } = await init(MIN_CHUNK + 10);
    expect(totalChunks).toBe(2);

    // First pass: chunk 0 is stored, then the client goes away.
    await putChunk(uploadId, resumeToken, 0, chunk0);

    // The resume, exactly as `resumeUpload` drives it: progress, the chunks
    // from `uploadedChunks` on, then a completion listing what THIS pass sent.
    const before = await progress(uploadId);
    expect(before.uploadedChunks).toBe(1);
    const sent1 = await putChunk(uploadId, resumeToken, 1, chunk1);
    const res = await complete(uploadId, [{ chunkIndex: 1, eTag: etagOf(sent1) }]);

    expect(res._status, JSON.stringify(res._json)).toBe(200);
    expect(res._json.data.size).toBe(MIN_CHUNK + 10);
    const stored = await adapter.download(res._json.data.key);
    expect(stored.byteLength, 'the stored object is the whole file, not the resumed chunk alone').toBe(MIN_CHUNK + 10);
    expect(stored.equals(Buffer.concat([chunk0, chunk1]))).toBe(true);
    expect((await store.getFile(fileId))!.status).toBe('committed');
    expect((await store.getSession(uploadId))!.status).toBe('completed');
  });

  it('REFUSED: an upload that does not hold a declared chunk is refused naming it, and nothing is assembled', async () => {
    const { uploadId, resumeToken, fileId } = await init(MIN_CHUNK + 10);
    const sent1 = await putChunk(uploadId, resumeToken, 1, fill('b', 10));
    const assemble = vi.spyOn(adapter, 'completeChunkedUpload');

    const res = await complete(uploadId, [{ chunkIndex: 1, eTag: etagOf(sent1) }]);

    await expectRefused(res, uploadId, fileId);
    expect(res._json.error.details.missingChunks).toEqual([0]);
    expect(assemble).not.toHaveBeenCalled();

    // Sending what it lacks finishes it.
    const chunk0 = fill('a', MIN_CHUNK);
    await putChunk(uploadId, resumeToken, 0, chunk0);
    const retry = await complete(uploadId, [{ chunkIndex: 1, eTag: etagOf(sent1) }]);
    expect(retry._status, JSON.stringify(retry._json)).toBe(200);
    expect((await adapter.download(retry._json.data.key)).equals(Buffer.concat([chunk0, fill('b', 10)]))).toBe(true);
  });

  it('REFUSED: a completion before any chunk is held', async () => {
    const { uploadId, fileId } = await init(10);
    const res = await complete(uploadId, []);
    await expectRefused(res, uploadId, fileId);
    expect(res._json.error.details.missingChunks).toEqual([0]);
  });

  it('REFUSED: the chunks held do not add up to the declared total size', async () => {
    const { uploadId, resumeToken, fileId } = await init(100);
    const sent = await putChunk(uploadId, resumeToken, 0, fill('a', 60));
    const assemble = vi.spyOn(adapter, 'completeChunkedUpload');

    const res = await complete(uploadId, [{ chunkIndex: 0, eTag: etagOf(sent) }]);

    await expectRefused(res, uploadId, fileId);
    expect(res._json.error.details.heldBytes).toBe(60);
    expect(res._json.error.details.totalSize).toBe(100);
    expect(assemble).not.toHaveBeenCalled();
  });

  it('REFUSED: a chunk held beyond the declared chunk count', async () => {
    const { uploadId, resumeToken, fileId } = await init(100);
    const sent0 = await putChunk(uploadId, resumeToken, 0, fill('a', 100));
    await putChunk(uploadId, resumeToken, 3, fill('z', 5));

    const res = await complete(uploadId, [{ chunkIndex: 0, eTag: etagOf(sent0) }]);

    await expectRefused(res, uploadId, fileId);
    expect(res._json.error.details.unexpectedChunks).toEqual([3]);
  });

  it('REFUSED: a listed part the upload does not hold', async () => {
    const { uploadId, resumeToken, fileId } = await init(100);
    const sent0 = await putChunk(uploadId, resumeToken, 0, fill('a', 100));

    const res = await complete(uploadId, [
      { chunkIndex: 0, eTag: etagOf(sent0) },
      { chunkIndex: 1, eTag: 'never-sent' },
    ]);

    await expectRefused(res, uploadId, fileId);
    expect(res._json.error.details.unheldListedChunks).toEqual([1]);
  });

  it('REFUSED: a listed part whose eTag is not the one the upload holds for that chunk', async () => {
    const { uploadId, resumeToken, fileId } = await init(100);
    await putChunk(uploadId, resumeToken, 0, fill('a', 100));

    const res = await complete(uploadId, [{ chunkIndex: 0, eTag: 'not-the-held-etag' }]);

    await expectRefused(res, uploadId, fileId);
    expect(res._json.error.details.mismatchedChunks).toEqual([0]);
  });

  // ── finding 2 ──────────────────────────────────────────────────────────

  it('a RE-SENT chunk leaves the progress unchanged', async () => {
    const MIB = 1024 * 1024;
    const { uploadId, resumeToken } = await init(MIB);
    const chunk = fill('a', 600 * 1024);

    await putChunk(uploadId, resumeToken, 0, chunk);
    const once = await progress(uploadId);
    await putChunk(uploadId, resumeToken, 0, chunk);
    const twice = await progress(uploadId);

    expect(once).toMatchObject({ uploadedSize: 600 * 1024, uploadedChunks: 1, percentComplete: 59 });
    expect(twice.uploadedSize, 'the re-sent chunk replaced its slot').toBe(once.uploadedSize);
    expect(twice.uploadedChunks).toBe(once.uploadedChunks);
    expect(twice.percentComplete).toBe(once.percentComplete);
  });

  it('a re-sent chunk REPLACES its slot: one record per chunk, and the completion assembles the latest bytes', async () => {
    const { uploadId, resumeToken } = await init(100);
    await putChunk(uploadId, resumeToken, 0, fill('a', 100));
    const latest = await putChunk(uploadId, resumeToken, 0, fill('b', 100));

    const parts = JSON.parse((await store.getSession(uploadId))!.parts ?? '[]') as Array<{ chunkIndex: number; eTag: string }>;
    expect(parts.map((p) => p.chunkIndex)).toEqual([0]);
    expect(parts[0].eTag).toBe(etagOf(latest));

    const res = await complete(uploadId, [{ chunkIndex: 0, eTag: etagOf(latest) }]);
    expect(res._status, JSON.stringify(res._json)).toBe(200);
    expect((await adapter.download(res._json.data.key)).equals(fill('b', 100))).toBe(true);
  });

  // ── control ────────────────────────────────────────────────────────────

  it('CONTROL: a clean one-pass upload listing every part is unchanged', async () => {
    const chunk0 = fill('a', MIN_CHUNK);
    const chunk1 = fill('b', 10);
    const { uploadId, resumeToken, fileId } = await init(MIN_CHUNK + 10);
    const sent0 = await putChunk(uploadId, resumeToken, 0, chunk0);
    const sent1 = await putChunk(uploadId, resumeToken, 1, chunk1);

    expect(await progress(uploadId)).toMatchObject({
      uploadedSize: MIN_CHUNK + 10,
      uploadedChunks: 2,
      totalChunks: 2,
      percentComplete: 100,
      status: 'in_progress',
    });

    const res = await complete(uploadId, [
      { chunkIndex: 0, eTag: etagOf(sent0) },
      { chunkIndex: 1, eTag: etagOf(sent1) },
    ]);
    expect(res._status, JSON.stringify(res._json)).toBe(200);
    expect(res._json.data).toMatchObject({ fileId, size: MIN_CHUNK + 10, mimeType: 'application/octet-stream' });
    expect((await adapter.download(res._json.data.key)).equals(Buffer.concat([chunk0, chunk1]))).toBe(true);
  });

  it('the list is checked, never the assembly source: an empty list completes an upload that holds every chunk', async () => {
    const { uploadId, resumeToken } = await init(100);
    await putChunk(uploadId, resumeToken, 0, fill('a', 100));
    const res = await complete(uploadId, []);
    expect(res._status, JSON.stringify(res._json)).toBe(200);
    expect((await adapter.download(res._json.data.key)).equals(fill('a', 100))).toBe(true);
  });

  // ── sessions recorded before part sizes existed ───────────────────────

  describe('a session whose parts predate the recorded size is judged by its running total', () => {
    /** Strip the per-part size, the shape a session started before #22283 carries. */
    async function asLegacy(uploadId: string, uploadedSize: number) {
      const parts = JSON.parse((await store.getSession(uploadId))!.parts ?? '[]') as Array<Record<string, unknown>>;
      await store.updateSession(uploadId, {
        parts: JSON.stringify(parts.map(({ chunkIndex, eTag }) => ({ chunkIndex, eTag }))),
        uploaded_size: uploadedSize,
      });
    }

    it('REFUSED when the running total is below the declared size', async () => {
      const { uploadId, resumeToken, fileId } = await init(100);
      await putChunk(uploadId, resumeToken, 0, fill('a', 100));
      await asLegacy(uploadId, 50);

      const res = await complete(uploadId, []);
      await expectRefused(res, uploadId, fileId);
      expect(res._json.error.details.heldBytes).toBe(50);
    });

    it('completes when every declared chunk is held and the running total reaches the declared size', async () => {
      const { uploadId, resumeToken } = await init(100);
      await putChunk(uploadId, resumeToken, 0, fill('a', 100));
      await asLegacy(uploadId, 100);

      const res = await complete(uploadId, []);
      expect(res._status, JSON.stringify(res._json)).toBe(200);
      expect((await adapter.download(res._json.data.key)).equals(fill('a', 100))).toBe(true);
    });
  });
});
