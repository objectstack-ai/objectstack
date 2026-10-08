// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22332] Concurrent chunk PUTs to one upload record every part.
//
// The chunk door reads the session row, merges its part into the parts list
// in memory (`recordChunk`) and writes the record back. Two PUTs to one upload
// at once both read the same record, and the second write replaced the first:
// both answered `200` while `sys_upload_session.parts` kept one part and
// `uploaded_chunks` / `uploaded_size` counted one chunk. Since #22313 the
// completion door refuses such an upload `409` naming the lost chunk, so the
// loss cost a parallel uploader a round trip rather than its file; it was
// still a loss the chunk door reported as a success.
//
// The record's write is now a COMPARE-AND-SET: it lands only while the row's
// progress columns still hold what the door read, and the door re-reads and
// re-merges when another write landed first. On a wired engine that is the
// engine's own conditional update (`where: { id, …guards }, multi: true`,
// which answers the matched-row count); on the engine-absent stand-in it is
// one synchronous compare-and-set on the Map.
//
// Every pin runs on both stores: the stand-in, and a REAL ObjectQL over a REAL
// SqlDriver on sqlite `:memory:` (the project's ruled test backend).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ObjectQL, assertEngineUpdateDispatch, resolveEngineUpdateDispatch } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { StorageMetadataStore, updateSessionProgressIfUnchanged } from './metadata-store.js';
import type { UploadSessionProgress, UploadSessionRecord } from './metadata-store.js';
import { registerStorageRoutes, CHUNK_RECORD_ATTEMPTS } from './storage-routes.js';
import { SystemFile } from './objects/system-file.object.js';
import { SystemUploadSession } from './objects/system-upload-session.object.js';

const BASE = '/api/v1/storage';
const INIT = `${BASE}/upload/chunked`;
const CHUNK = `${BASE}/upload/chunked/:uploadId/chunk/:chunkIndex`;
const COMPLETE = `${BASE}/upload/chunked/:uploadId/complete`;
const PROGRESS = `${BASE}/upload/chunked/:uploadId/progress`;

/** The chunk size the init door floors every upload at (5 MiB). */
const MIN_CHUNK = 5 * 1024 * 1024;

type Res = IHttpResponse & { _status: number; _json: any };
type StoredPart = { chunkIndex: number; eTag: string; size: number };

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

// ── the two stores ─────────────────────────────────────────────────────────

interface Backend {
  store: StorageMetadataStore;
  /** The real engine, when there is one. */
  engine: any;
  /** `sys_upload_session` writes that reached the engine — `null` on the stand-in, which has none. */
  sessionWrites(): number | null;
  teardown(): Promise<void>;
}

async function standIn(): Promise<Backend> {
  return { store: new StorageMetadataStore(null), engine: null, sessionWrites: () => null, teardown: async () => {} };
}

async function realEngine(): Promise<Backend> {
  const sql = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const ql = new ObjectQL();
  ql.registerDriver(sql, true);
  await ql.init();
  ql.registry.registerObject(SystemFile as any, 'com.objectstack.storage');
  ql.registry.registerObject(SystemUploadSession as any, 'com.objectstack.storage');
  await ql.syncSchemas();
  let writes = 0;
  const realUpdate = ql.update.bind(ql);
  (ql as any).update = (object: string, data: any, options: any) => {
    if (object === 'sys_upload_session') writes++;
    return realUpdate(object, data, options);
  };
  return {
    store: new StorageMetadataStore(ql as any),
    engine: ql,
    sessionWrites: () => writes,
    teardown: async () => {
      try {
        await ql.destroy();
      } catch {
        /* noop */
      }
    },
  };
}

describe.each([
  ['the engine-absent stand-in', standIn],
  ['a real ObjectQL over SqlDriver (sqlite :memory:)', realEngine],
] as const)('[#22332] the chunk door records every part — %s', (_label, makeBackend) => {
  let rootDir: string;
  let adapter: LocalStorageAdapter;
  let backend: Backend;
  let store: StorageMetadataStore;
  let server: ReturnType<typeof createMockHttpServer>;

  beforeEach(async () => {
    rootDir = join(tmpdir(), `os-chunk-cas-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(rootDir, { recursive: true });
    adapter = new LocalStorageAdapter({ rootDir, signingSecret: 'test-secret' });
    backend = await makeBackend();
    store = backend.store;
    server = createMockHttpServer();
    registerStorageRoutes(server as any, adapter, store, { basePath: BASE });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await backend.teardown();
    await fs.rm(rootDir, { recursive: true, force: true });
  });

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
    return res;
  }

  async function progress(uploadId: string) {
    const res = createMockRes();
    await server.handler('GET', PROGRESS)(createMockReq({ params: { uploadId } }), res);
    expect(res._status, JSON.stringify(res._json)).toBe(200);
    return res._json.data as { uploadedSize: number; uploadedChunks: number };
  }

  async function storedParts(uploadId: string): Promise<{ row: UploadSessionRecord; parts: StoredPart[] }> {
    const row = (await store.getSession(uploadId))!;
    const parts = (JSON.parse(row.parts ?? '[]') as StoredPart[]).sort((a, b) => a.chunkIndex - b.chunkIndex);
    return { row, parts };
  }

  /** Chunk `i` of a test upload: distinct bytes and a distinct size, so a lost part shows in every count. */
  const chunkBytes = (i: number) => Buffer.alloc(10 + i, 0x61 + i);

  it.each([2, 8])('%i concurrent chunk PUTs to one upload each record their part', async (n) => {
    const { uploadId, resumeToken, totalChunks } = await init(n * MIN_CHUNK);
    expect(totalChunks).toBe(n);
    const chunks = Array.from({ length: n }, (_, i) => chunkBytes(i));

    const answers = await Promise.all(chunks.map((bytes, i) => putChunk(uploadId, resumeToken, i, bytes)));

    for (const res of answers) expect(res._status, JSON.stringify(res._json)).toBe(200);
    const { row, parts } = await storedParts(uploadId);
    expect(parts.map((p) => p.chunkIndex), 'every concurrently sent chunk is in the record').toEqual(
      Array.from({ length: n }, (_, i) => i),
    );
    expect(parts.map((p) => p.eTag)).toEqual(answers.map((res) => res._json.data.eTag));
    expect(parts.map((p) => p.size)).toEqual(chunks.map((c) => c.byteLength));
    const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
    expect(row.uploaded_chunks).toBe(n);
    expect(row.uploaded_size).toBe(total);
    expect(await progress(uploadId)).toMatchObject({ uploadedChunks: n, uploadedSize: total });
  });

  it('a parallel upload completes on its first completion — no lost chunk to send again', async () => {
    const chunk0 = Buffer.alloc(MIN_CHUNK, 0x61);
    const chunk1 = Buffer.alloc(10, 0x62);
    const { uploadId, resumeToken } = await init(MIN_CHUNK + 10);

    const [sent0, sent1] = await Promise.all([
      putChunk(uploadId, resumeToken, 0, chunk0),
      putChunk(uploadId, resumeToken, 1, chunk1),
    ]);
    const res = createMockRes();
    await server.handler('POST', COMPLETE)(
      createMockReq({
        params: { uploadId },
        body: {
          uploadId,
          parts: [
            { chunkIndex: 0, eTag: sent0._json.data.eTag },
            { chunkIndex: 1, eTag: sent1._json.data.eTag },
          ],
        },
      }),
      res,
    );

    expect(res._status, JSON.stringify(res._json)).toBe(200);
    expect(res._json.data.size).toBe(MIN_CHUNK + 10);
    expect((await adapter.download(res._json.data.key)).equals(Buffer.concat([chunk0, chunk1]))).toBe(true);
  });

  it('CONTROL: the sequential path is unchanged — the same answers, the same record, one write per chunk', async () => {
    const { uploadId, resumeToken } = await init(3 * MIN_CHUNK);
    const writesBefore = backend.sessionWrites();

    const answers: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await putChunk(uploadId, resumeToken, i, chunkBytes(i));
      expect(res._status, JSON.stringify(res._json)).toBe(200);
      answers.push(res._json);
    }

    expect(answers.map((a: any) => ({ ...a.data, eTag: typeof a.data.eTag }))).toEqual([
      { chunkIndex: 0, eTag: 'string', bytesReceived: 10 },
      { chunkIndex: 1, eTag: 'string', bytesReceived: 11 },
      { chunkIndex: 2, eTag: 'string', bytesReceived: 12 },
    ]);
    // An uncontended write lands first time: no retry reaches the engine.
    const writesAfter = backend.sessionWrites();
    if (writesBefore !== null) expect(writesAfter! - writesBefore).toBe(3);
    const { row, parts } = await storedParts(uploadId);
    expect(parts.map((p) => [p.chunkIndex, p.size])).toEqual([[0, 10], [1, 11], [2, 12]]);
    expect(row.uploaded_chunks).toBe(3);
    expect(row.uploaded_size).toBe(33);
    expect(await progress(uploadId)).toMatchObject({ uploadedChunks: 3, uploadedSize: 33 });
  });

  it(`REFUSED 409 RESOURCE_CONFLICT when another write lands before each of ${CHUNK_RECORD_ATTEMPTS} attempts — the other writes kept, nothing silently lost`, async () => {
    const { uploadId, resumeToken } = await init(2 * MIN_CHUNK);
    // A competitor lands a part between EVERY read the chunk door makes and the
    // write that follows it: the read hands back the row as it stood, then the
    // competitor's own write moves it on.
    const readSession = store.getSession.bind(store);
    let competitors = 0;
    let competing = false;
    let doorReads = 0;
    vi.spyOn(store, 'getSession').mockImplementation(async (id: string) => {
      // The stand-in's own `updateSession` reads through `getSession`: the
      // competitor's write must not count as a door read or compete again.
      if (competing) return readSession(id);
      doorReads++;
      const row = await readSession(id);
      if (row) {
        const held = JSON.parse(row.parts ?? '[]') as StoredPart[];
        const part: StoredPart = { chunkIndex: 100 + competitors, eTag: `competitor-${competitors}`, size: 1 };
        competitors++;
        competing = true;
        try {
          await store.updateSession(id, {
            parts: JSON.stringify([...held, part]),
            uploaded_chunks: held.length + 1,
            uploaded_size: (row.uploaded_size ?? 0) + 1,
          });
        } finally {
          competing = false;
        }
      }
      return row;
    });

    const res = await putChunk(uploadId, resumeToken, 0, chunkBytes(0));

    expect.soft(res._status, JSON.stringify(res._json)).toBe(409);
    expect.soft(res._json.success).toBe(false);
    expect.soft(res._json.error?.code).toBe('RESOURCE_CONFLICT');
    expect.soft(res._json.error?.details).toEqual({ chunkIndex: 0, attempts: CHUNK_RECORD_ATTEMPTS });
    expect.soft(doorReads, 'one read per attempt: the first, then one re-read per lost write').toBe(CHUNK_RECORD_ATTEMPTS);
    vi.mocked(store.getSession).mockRestore();
    // Every competitor's part survived, and the refused chunk is not claimed as held.
    const { parts } = await storedParts(uploadId);
    expect(parts.map((p) => p.chunkIndex)).toEqual(
      Array.from({ length: CHUNK_RECORD_ATTEMPTS }, (_, i) => 100 + i),
    );
  });
});

// ── the store's conditional progress write ─────────────────────────────────

const sessionRec = (id: string): UploadSessionRecord => ({
  id,
  file_id: `f_${id}`,
  key: `user/${id}.bin`,
  filename: `${id}.bin`,
  total_size: 20,
  chunk_size: 10,
  total_chunks: 2,
  status: 'in_progress',
});

const ONE_PART: UploadSessionProgress = {
  parts: JSON.stringify([{ chunkIndex: 0, eTag: 'e0', size: 10 }]),
  uploaded_chunks: 1,
  uploaded_size: 10,
};

describe.each([
  ['the engine-absent stand-in', standIn],
  ['a real ObjectQL over SqlDriver (sqlite :memory:)', realEngine],
] as const)('[#22332] updateSessionProgressIfUnchanged — %s', (_label, makeBackend) => {
  let backend: Backend;
  let store: StorageMetadataStore;

  beforeEach(async () => {
    backend = await makeBackend();
    store = backend.store;
    await store.createSession(sessionRec('s1'));
  });

  afterEach(async () => {
    await backend.teardown();
  });

  it('lands on a row that still holds the progress the caller read', async () => {
    const seen = (await store.getSession('s1'))!;
    expect(await updateSessionProgressIfUnchanged(store, 's1', seen, ONE_PART)).toBe(true);
    expect(await store.getSession('s1')).toMatchObject(ONE_PART);
  });

  it.each([
    ['parts', { parts: '[{"chunkIndex":9,"eTag":"x","size":1}]' }],
    ['uploaded_chunks', { uploaded_chunks: 7 }],
    ['uploaded_size', { uploaded_size: 7 }],
  ] as const)('REFUSED once %s moved since the read — the row keeps the other write', async (_column, moved) => {
    const seen = (await store.getSession('s1'))!;
    await store.updateSession('s1', moved);

    expect(await updateSessionProgressIfUnchanged(store, 's1', seen, ONE_PART)).toBe(false);
    expect(await store.getSession('s1')).toMatchObject(moved);
  });

  it('REFUSED for a row that is gone', async () => {
    const seen = (await store.getSession('s1'))!;
    await store.deleteSession('s1');
    expect(await updateSessionProgressIfUnchanged(store, 's1', seen, ONE_PART)).toBe(false);
    expect(await store.getSession('s1')).toBeNull();
  });
});

describe('[#22332] updateSessionProgressIfUnchanged on a wired engine is the engine’s conditional update', () => {
  let backend: Backend;
  let calls: Array<{ data: any; options: any; dispatch: string; answer: unknown }>;

  beforeEach(async () => {
    backend = await realEngine();
    const ql = backend.engine;
    const inner = ql.update;
    calls = [];
    ql.update = async (object: string, data: any, options: any) => {
      // Snapshotted before the call: the engine may decorate what it is handed.
      const asked = { data: structuredClone(data), options: structuredClone(options) };
      const answer = await inner(object, data, options);
      if (object === 'sys_upload_session' && options?.multi) {
        assertEngineUpdateDispatch(asked.data, asked.options);
        calls.push({ ...asked, dispatch: resolveEngineUpdateDispatch(asked.data, asked.options).kind, answer });
      }
      return answer;
    };
  });

  afterEach(async () => {
    await backend.teardown();
  });

  it('the guard rides the `where` beside the id, as a declared predicate, scoped like every by-id write', async () => {
    const { store } = backend;
    await store.createSession(sessionRec('s1'), { organizationId: 'org_A' });
    const seen = (await store.getSession('s1'))!;

    expect(await updateSessionProgressIfUnchanged(store, 's1', seen, ONE_PART, { organizationId: 'org_A' })).toBe(true);

    expect(calls).toEqual([
      {
        data: ONE_PART,
        options: {
          where: { parts: '[]', uploaded_chunks: 0, uploaded_size: 0, id: 's1' },
          multi: true,
          context: { tenantId: 'org_A', isSystem: true },
        },
        dispatch: 'multi',
        answer: 1,
      },
    ]);
  });

  it('a row stamped for another organization matches nothing — the write misses, it does not land there', async () => {
    const { store } = backend;
    await store.createSession(sessionRec('s1'), { organizationId: 'org_B' });
    const seen = (await store.getSession('s1'))!;

    expect(await updateSessionProgressIfUnchanged(store, 's1', seen, ONE_PART, { organizationId: 'org_A' })).toBe(false);
    expect((await store.getSession('s1'))!.parts).toBe('[]');
  });

  it('REFUSED loudly when the engine answers something other than a matched-row count', async () => {
    const { store } = backend;
    await store.createSession(sessionRec('s1'));
    const seen = (await store.getSession('s1'))!;
    backend.engine.update = async (_o: string, data: any) => ({ ...data });

    await expect(updateSessionProgressIfUnchanged(store, 's1', seen, ONE_PART)).rejects.toMatchObject({
      name: 'StorageMetadataStoreError',
      objectName: 'sys_upload_session',
      operation: 'update',
      message: expect.stringContaining('where a matched-row count was due'),
    });
  });

  it('the chunk door answers 500, once, when its write cannot reach a row nothing else moved', async () => {
    const rootDir = join(tmpdir(), `os-chunk-cas-unreachable-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(rootDir, { recursive: true });
    try {
      const server = createMockHttpServer();
      registerStorageRoutes(server as any, new LocalStorageAdapter({ rootDir, signingSecret: 'test-secret' }), backend.store, {
        basePath: BASE,
      });
      const initRes = createMockRes();
      await server.handler('POST', INIT)(
        createMockReq({ body: { filename: 'u.bin', mimeType: 'application/octet-stream', totalSize: 10 } }),
        initRes,
      );
      expect(initRes._status, JSON.stringify(initRes._json)).toBe(200);
      const { uploadId, resumeToken } = initRes._json.data;
      // The conditional write matches no row and changes nothing, whatever it is asked.
      const inner = backend.engine.update;
      let conditional = 0;
      backend.engine.update = async (object: string, data: any, options: any) => {
        if (object === 'sys_upload_session' && options?.multi) {
          conditional++;
          return 0;
        }
        return inner(object, data, options);
      };

      const res = createMockRes();
      await server.handler('PUT', CHUNK)(
        createMockReq({
          params: { uploadId, chunkIndex: '0' },
          headers: { 'x-resume-token': resumeToken },
          rawBody: async () => Buffer.alloc(10, 0x61),
        }),
        res,
      );

      expect(res._status, JSON.stringify(res._json)).toBe(500);
      expect(res._json.error.code).toBe('INTERNAL');
      expect(res._json.error.message).toContain('the write cannot reach the row');
      expect(conditional, 'no retry loop over a write that cannot land').toBe(1);
      expect((await backend.store.getSession(uploadId))!.parts).toBe('[]');
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
