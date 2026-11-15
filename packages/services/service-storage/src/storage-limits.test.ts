// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22283] The `storage` settings namespace's Limits group — `presigned_ttl`,
 * `session_ttl`, `max_upload_mb` — honoured at the doors that own them.
 *
 * ## The pins, in order
 *
 *  - **§1 every upload door refuses over the limit, and stores nothing.** The
 *    presigned door (declared `size`), the chunked start (declared
 *    `totalSize`), the local raw PUT (the body) and the chunk door (the bytes
 *    received so far plus this chunk) each answer `413` / `PAYLOAD_TOO_LARGE`
 *    in the ADR-0112 envelope, with no row written and no byte handed to the
 *    adapter. Each has its control at exactly the limit, which is accepted.
 *  - **§2 the TTLs and the precedence.** A saved TTL is what a presigned URL
 *    and a new session carry; a saved value beats the host's option, the host's
 *    option beats the namespace default, and with no namespace bound the
 *    built-in defaults stand — the upload bound's included.
 *  - **§3 the plugin wiring, end to end through `applySettings`.** Nothing
 *    saved ⇒ the declared defaults (100 MB, 3600 s, 86400 s) hold; a save after
 *    boot reaches the next request, while a session already issued keeps the
 *    lifetime it was issued with; `bindToSettings: false` keeps the
 *    constructor TTLs and the built-in upload bound.
 *  - **§4 the host door** (`mountStorageRoutes`) honours the same snapshot,
 *    because it rides the `storage` service both mounts are composed over.
 *  - **§5 the upload bound: one precedence, and unset never means unlimited.**
 *    Every path that sets nothing lands on the built-in 100 MB; the host
 *    option is a layer like the TTLs'; no limit is an explicit, announced host
 *    choice; a malformed host option refuses the boot; a saved setting still
 *    wins; the built-in default is the manifest's.
 */

import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ObjectKernel } from '@objectstack/core';
import type { IHttpRequest, IHttpResponse, IHttpServer, RouteHandler } from '@objectstack/spec/contracts';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { StorageMetadataStore } from './metadata-store.js';
import { registerStorageRoutes, type StorageRoutesOptions } from './storage-routes.js';
import { StorageServicePlugin } from './storage-service-plugin.js';
import { SwappableStorageService } from './swappable-storage-service.js';
import { mountStorageRoutes } from './mount-storage-routes.js';
import {
  DEFAULT_MAX_UPLOAD_MB,
  InvalidMaxUploadMbError,
  readStorageLimits,
  resolveStorageLimits,
  type StorageLimitsSnapshot,
} from './storage-limits.js';
import { registerStorageFamily } from './storage-routes.js';
import { FieldFileService } from './field-file-service.js';
import { FileAttachmentService } from './file-attachment-service.js';
import type { UploadLinkDoor } from './record-file-access.js';
import { storageSettingsManifest } from '@objectstack/service-settings';

const BASE = '/api/v1/storage';
const MIB = 1024 * 1024;

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

let rootDirs: string[] = [];

async function tmpRoot(): Promise<string> {
  const dir = join(tmpdir(), `os-22283-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  rootDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of rootDirs) await fs.rm(dir, { recursive: true, force: true });
  rootDirs = [];
});

function routeCollector() {
  const routes = new Map<string, RouteHandler>();
  const http = {
    get: (p: string, h: RouteHandler) => { routes.set(`GET:${p}`, h); },
    post: (p: string, h: RouteHandler) => { routes.set(`POST:${p}`, h); },
    put: (p: string, h: RouteHandler) => { routes.set(`PUT:${p}`, h); },
    delete: () => {},
    patch: () => {},
    use: () => {},
    listen: async () => {},
    close: async () => {},
  };
  return { http: http as unknown as IHttpServer, routes };
}

interface Answer {
  status: number;
  body: any;
}

async function call(
  routes: Map<string, RouteHandler>,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  init: {
    params?: Record<string, string>;
    body?: unknown;
    headers?: Record<string, string>;
    rawBody?: () => Promise<Buffer>;
  } = {},
): Promise<Answer> {
  const handler = routes.get(`${method}:${path}`);
  if (!handler) throw new Error(`fixture: no handler for ${method} ${path}`);
  const answer: Answer = { status: 200, body: undefined };
  const res = {
    json(data: unknown) { answer.body = data; return res; },
    send() { return res; },
    status(code: number) { answer.status = code; return res; },
    header() { return res; },
  };
  const req = {
    params: init.params ?? {},
    query: {},
    body: init.body,
    headers: init.headers ?? {},
    method,
    path,
    ...(init.rawBody ? { rawBody: init.rawBody } : {}),
  };
  await handler(req as unknown as IHttpRequest, res as unknown as IHttpResponse);
  return answer;
}

/** The ADR-0112 refusal this card answers with: status, code, and the setting named. */
function expectTooLarge(answer: Answer): void {
  expect(answer.status).toBe(413);
  expect(answer.body?.success).toBe(false);
  expect(answer.body?.error?.code).toBe('PAYLOAD_TOO_LARGE');
  expect(String(answer.body?.error?.message)).toContain('max_upload_mb');
}

/** Seconds from now until an ISO timestamp. */
const secondsUntil = (iso: string): number => (Date.parse(iso) - Date.now()) / 1000;

/** The `exp` a local-adapter capability URL carries, in seconds from now. */
function tokenSecondsLeft(url: string): number {
  const token = String(url).split('/_local/raw/')[1] ?? '';
  const payload = JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8')) as { exp: number };
  return payload.exp - Date.now() / 1000;
}

/** A route table over a real local adapter and an in-memory metadata store. */
async function mountDoors(snapshot: StorageLimitsSnapshot | undefined, opts: StorageRoutesOptions = {}) {
  const adapter = new LocalStorageAdapter({ rootDir: await tmpRoot(), signingSecret: 'test-secret-22283' });
  const store = new StorageMetadataStore(null);
  const { http, routes } = routeCollector();
  registerStorageRoutes(http, adapter, store, { basePath: BASE, limitsSnapshot: () => snapshot, ...opts });
  return { adapter, store, routes };
}

/** An admin saved `max_upload_mb: 1`. */
const SAVED_ONE_MB: StorageLimitsSnapshot = { maxUploadMb: { value: 1, authored: true } };

// ---------------------------------------------------------------------------
// §1 — every upload door refuses over the limit, and stores nothing
// ---------------------------------------------------------------------------

describe('[#22283] §1 · the upload doors refuse a file over max_upload_mb, before anything is stored', () => {
  it('presigned door: a declared size over the limit is 413 PAYLOAD_TOO_LARGE — no row, no URL minted', async () => {
    const { adapter, store, routes } = await mountDoors(SAVED_ONE_MB);
    const createFile = vi.spyOn(store, 'createFile');
    const presign = vi.spyOn(adapter, 'getPresignedUpload');

    const over = await call(routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'big.bin', mimeType: 'application/octet-stream', size: MIB + 1 },
    });
    expectTooLarge(over);
    expect(createFile).not.toHaveBeenCalled();
    expect(presign).not.toHaveBeenCalled();

    // CONTROL — exactly at the limit is accepted.
    const at = await call(routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'ok.bin', mimeType: 'application/octet-stream', size: MIB },
    });
    expect(at.status).toBe(200);
    expect(createFile).toHaveBeenCalledTimes(1);
  });

  it('chunked start: a declared total over the limit is 413 — no file row, no session row, no backend multipart', async () => {
    const { adapter, store, routes } = await mountDoors(SAVED_ONE_MB);
    const createFile = vi.spyOn(store, 'createFile');
    const createSession = vi.spyOn(store, 'createSession');
    const initiate = vi.spyOn(adapter, 'initiateChunkedUpload');

    const over = await call(routes, 'POST', `${BASE}/upload/chunked`, {
      body: { filename: 'big.bin', mimeType: 'application/octet-stream', totalSize: MIB + 1 },
    });
    expectTooLarge(over);
    expect(createFile).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(initiate).not.toHaveBeenCalled();

    const at = await call(routes, 'POST', `${BASE}/upload/chunked`, {
      body: { filename: 'ok.bin', mimeType: 'application/octet-stream', totalSize: MIB },
    });
    expect(at.status).toBe(200);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it('local raw PUT: a body over the limit is 413 and never reaches the adapter or the disk', async () => {
    const { adapter, routes } = await mountDoors(SAVED_ONE_MB);
    const presigned = await call(routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'liar.bin', mimeType: 'application/octet-stream', size: 10 },
    });
    expect(presigned.status).toBe(200);
    const token = String(presigned.body.data.uploadUrl).split('/_local/raw/')[1]!;
    const key = adapter.verifyToken(token, 'put').k;
    const upload = vi.spyOn(adapter, 'upload');

    // Declared 10 bytes at presign, sends one byte over the limit.
    const over = await call(routes, 'PUT', `${BASE}/_local/raw/:token`, {
      params: { token },
      rawBody: async () => Buffer.alloc(MIB + 1),
    });
    expectTooLarge(over);
    expect(upload).not.toHaveBeenCalled();
    expect(await adapter.exists(key)).toBe(false);

    const at = await call(routes, 'PUT', `${BASE}/_local/raw/:token`, {
      params: { token },
      rawBody: async () => Buffer.alloc(MIB),
    });
    expect(at.status).toBe(200);
    expect(await adapter.exists(key)).toBe(true);
  });

  it('local raw PUT: a declared content-length over the limit is refused before the body is read', async () => {
    const { routes } = await mountDoors(SAVED_ONE_MB);
    const presigned = await call(routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'x.bin', mimeType: 'application/octet-stream', size: 10 },
    });
    const token = String(presigned.body.data.uploadUrl).split('/_local/raw/')[1]!;
    const rawBody = vi.fn(async () => Buffer.alloc(10));
    const over = await call(routes, 'PUT', `${BASE}/_local/raw/:token`, {
      params: { token },
      headers: { 'content-length': String(5 * MIB) },
      rawBody,
    });
    expectTooLarge(over);
    expect(rawBody).not.toHaveBeenCalled();
  });

  /**
   * The init door floors a chunk at 5 MiB, so an upload under a 1 MiB limit
   * declares ONE chunk, and the chunk door refuses an index past the declared
   * count (#27412). The limit is judged on the bytes received across chunks,
   * so these cases widen the session row to two declared chunks to send its
   * bytes in two.
   */
  async function declareTwoChunks(store: { updateSession(id: string, patch: Record<string, unknown>): Promise<unknown> }, uploadId: string) {
    await store.updateSession(uploadId, { total_chunks: 2 });
  }

  it('chunk door: the chunk that takes the bytes received past the limit is 413 — not stored, progress unchanged', async () => {
    const { adapter, store, routes } = await mountDoors(SAVED_ONE_MB);
    const started = await call(routes, 'POST', `${BASE}/upload/chunked`, {
      body: { filename: 'c.bin', mimeType: 'application/octet-stream', totalSize: MIB },
    });
    expect(started.status).toBe(200);
    const { uploadId, resumeToken } = started.body.data;
    await declareTwoChunks(store, uploadId);
    const uploadChunk = vi.spyOn(adapter, 'uploadChunk');
    const chunk = (index: number, bytes: number, headers: Record<string, string> = {}) =>
      call(routes, 'PUT', `${BASE}/upload/chunked/:uploadId/chunk/:chunkIndex`, {
        params: { uploadId, chunkIndex: String(index) },
        headers: { 'x-resume-token': resumeToken, ...headers },
        rawBody: async () => Buffer.alloc(bytes),
      });

    // CONTROL — 600 KiB received, under the limit.
    expect((await chunk(0, 600 * 1024)).status).toBe(200);
    expect(uploadChunk).toHaveBeenCalledTimes(1);

    // 600 KiB more would make 1200 KiB, over 1 MiB.
    expectTooLarge(await chunk(1, 600 * 1024));
    expect(uploadChunk).toHaveBeenCalledTimes(1);
    expect((await store.getSession(uploadId))?.uploaded_size).toBe(600 * 1024);

    // Exactly up to the limit is accepted.
    expect((await chunk(1, MIB - 600 * 1024)).status).toBe(200);
    expect(uploadChunk).toHaveBeenCalledTimes(2);
    expect((await store.getSession(uploadId))?.uploaded_size).toBe(MIB);
  });

  it('chunk door: a RETRIED chunk index replaces its earlier bytes — a retry is not counted twice, a grown retry still is judged', async () => {
    const { adapter, store, routes } = await mountDoors(SAVED_ONE_MB);
    const started = await call(routes, 'POST', `${BASE}/upload/chunked`, {
      body: { filename: 'r.bin', mimeType: 'application/octet-stream', totalSize: MIB },
    });
    const { uploadId, resumeToken } = started.body.data;
    await declareTwoChunks(store, uploadId);
    const uploadChunk = vi.spyOn(adapter, 'uploadChunk');
    const chunk = (index: number, bytes: number) =>
      call(routes, 'PUT', `${BASE}/upload/chunked/:uploadId/chunk/:chunkIndex`, {
        params: { uploadId, chunkIndex: String(index) },
        headers: { 'x-resume-token': resumeToken },
        rawBody: async () => Buffer.alloc(bytes),
      });

    // Chunk 0 sent twice (the client lost the first answer): the upload holds
    // 600 KiB, not 1200 KiB, so the retry is under the 1 MiB limit.
    expect((await chunk(0, 600 * 1024)).status).toBe(200);
    expect((await chunk(0, 600 * 1024)).status).toBe(200);
    expect((await chunk(1, 400 * 1024)).status).toBe(200);
    expect(uploadChunk).toHaveBeenCalledTimes(3);

    // A retry of chunk 1 that grows it to 500 KiB would make 1100 KiB.
    expectTooLarge(await chunk(1, 500 * 1024));
    expect(uploadChunk).toHaveBeenCalledTimes(3);
  });

  it('chunk door: a session whose parts carry no sizes (started before sizes were recorded) is judged by its running total', async () => {
    const { store, routes } = await mountDoors(SAVED_ONE_MB);
    await store.createSession({
      id: 'legacy-session',
      file_id: 'f-legacy',
      key: 'user/f-legacy.bin',
      filename: 'legacy.bin',
      mime_type: 'application/octet-stream',
      total_size: MIB,
      chunk_size: 5 * MIB,
      total_chunks: 1,
      resume_token: 'tok',
      status: 'in_progress',
    } as any);
    await store.updateSession('legacy-session', {
      uploaded_chunks: 1,
      uploaded_size: 600 * 1024,
      parts: JSON.stringify([{ chunkIndex: 0, eTag: 'etag-0' }]),
    } as any);
    const retry = await call(routes, 'PUT', `${BASE}/upload/chunked/:uploadId/chunk/:chunkIndex`, {
      params: { uploadId: 'legacy-session', chunkIndex: '0' },
      headers: { 'x-resume-token': 'tok' },
      rawBody: async () => Buffer.alloc(600 * 1024),
    });
    // No per-chunk sizes to sum: the running total is the bound, and 1200 KiB is over.
    expectTooLarge(retry);
  });

  it('chunk door: a declared content-length that would pass the limit is refused before the body is read', async () => {
    const { routes } = await mountDoors(SAVED_ONE_MB);
    const started = await call(routes, 'POST', `${BASE}/upload/chunked`, {
      body: { filename: 'c.bin', mimeType: 'application/octet-stream', totalSize: MIB },
    });
    const { uploadId, resumeToken } = started.body.data;
    const rawBody = vi.fn(async () => Buffer.alloc(10));
    const over = await call(routes, 'PUT', `${BASE}/upload/chunked/:uploadId/chunk/:chunkIndex`, {
      params: { uploadId, chunkIndex: '0' },
      headers: { 'x-resume-token': resumeToken, 'content-length': String(2 * MIB) },
      rawBody,
    });
    expectTooLarge(over);
    expect(rawBody).not.toHaveBeenCalled();
  });

  it('no settings namespace bound: the built-in 100 MB bounds the declared-size doors, never no limit', async () => {
    const { routes } = await mountDoors(undefined);
    expectTooLarge(await call(routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'huge.bin', mimeType: 'application/octet-stream', size: 101 * MIB },
    }));
    expectTooLarge(await call(routes, 'POST', `${BASE}/upload/chunked`, {
      body: { filename: 'huge.bin', mimeType: 'application/octet-stream', totalSize: 101 * MIB },
    }));
    // CONTROL — exactly the built-in bound is accepted at both.
    const presigned = await call(routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'at.bin', mimeType: 'application/octet-stream', size: 100 * MIB },
    });
    expect(presigned.status).toBe(200);
    const started = await call(routes, 'POST', `${BASE}/upload/chunked`, {
      body: { filename: 'at.bin', mimeType: 'application/octet-stream', totalSize: 100 * MIB },
    });
    expect(started.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// §1b — a body with no declared length is held to the door's own bound
// ---------------------------------------------------------------------------

/**
 * A transport's `rawBody` as `IHttpRequest.rawBody` contracts it: it records
 * the bound each read states, and refuses past it (413 `PAYLOAD_TOO_LARGE`),
 * handing back nothing. No `content-length` is sent, so only the stated bound
 * can hold the body.
 */
function boundedRawBody(bytes: number) {
  const asked: Array<number | undefined> = [];
  const rawBody = vi.fn(async (options?: { maxBytes?: number }) => {
    asked.push(options?.maxBytes);
    if (options?.maxBytes !== undefined && bytes > options.maxBytes) {
      throw Object.assign(new Error('refused past the bound'), { status: 413, code: 'PAYLOAD_TOO_LARGE' });
    }
    return Buffer.alloc(bytes);
  });
  return { asked, rawBody };
}

describe('a byte door holds a body with no declared length to its own bound, as it holds a declared one', () => {
  it('local raw PUT: the read is bounded by max_upload_mb and refused past it — 413, nothing stored', async () => {
    const { adapter, routes } = await mountDoors(SAVED_ONE_MB);
    const presigned = await call(routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'u.bin', mimeType: 'application/octet-stream', size: 10 },
    });
    const token = String(presigned.body.data.uploadUrl).split('/_local/raw/')[1]!;
    const key = adapter.verifyToken(token, 'put').k;
    const upload = vi.spyOn(adapter, 'upload');

    const over = boundedRawBody(MIB + 1);
    expectTooLarge(await call(routes, 'PUT', `${BASE}/_local/raw/:token`, { params: { token }, rawBody: over.rawBody }));
    expect(over.asked).toEqual([MIB]);
    expect(upload).not.toHaveBeenCalled();
    expect(await adapter.exists(key)).toBe(false);

    // CONTROL — exactly the bound is read whole and stored.
    const at = boundedRawBody(MIB);
    expect((await call(routes, 'PUT', `${BASE}/_local/raw/:token`, { params: { token }, rawBody: at.rawBody })).status).toBe(200);
    expect(at.asked).toEqual([MIB]);
    expect(await adapter.exists(key)).toBe(true);
  });

  it('chunk door: the read is bounded by what the limit leaves this chunk, and refused past it — not stored, progress unchanged', async () => {
    const { adapter, store, routes } = await mountDoors(SAVED_ONE_MB);
    const started = await call(routes, 'POST', `${BASE}/upload/chunked`, {
      body: { filename: 'u.bin', mimeType: 'application/octet-stream', totalSize: MIB },
    });
    const { uploadId, resumeToken } = started.body.data;
    await store.updateSession(uploadId, { total_chunks: 2 } as never);
    const uploadChunk = vi.spyOn(adapter, 'uploadChunk');
    const chunk = (index: number, read: ReturnType<typeof boundedRawBody>) =>
      call(routes, 'PUT', `${BASE}/upload/chunked/:uploadId/chunk/:chunkIndex`, {
        params: { uploadId, chunkIndex: String(index) },
        headers: { 'x-resume-token': resumeToken },
        rawBody: read.rawBody,
      });

    const first = boundedRawBody(600 * 1024);
    expect((await chunk(0, first)).status).toBe(200);
    expect(first.asked).toEqual([MIB]);

    const over = boundedRawBody(MIB);
    expectTooLarge(await chunk(1, over));
    expect(over.asked).toEqual([MIB - 600 * 1024]);
    expect(uploadChunk).toHaveBeenCalledTimes(1);
    expect((await store.getSession(uploadId))?.uploaded_size).toBe(600 * 1024);

    // CONTROL — exactly what is left is read whole and stored.
    const rest = boundedRawBody(MIB - 600 * 1024);
    expect((await chunk(1, rest)).status).toBe(200);
    expect(uploadChunk).toHaveBeenCalledTimes(2);
    expect((await store.getSession(uploadId))?.uploaded_size).toBe(MIB);
  });

  /** A host's own size refusal: a read refused for size with no bound stated by the door. */
  const hostSizeRefusal = vi.fn(async () => {
    throw Object.assign(new Error('the host refused this body for size'), { status: 413, code: 'PAYLOAD_TOO_LARGE' });
  });

  it('with no bound (the host chose unlimited), a host size refusal on the local raw PUT is not taken as the door\'s own', async () => {
    const { adapter, routes } = await mountDoors(undefined, { maxUploadMb: 'unlimited' });
    const presigned = await call(routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'h.bin', mimeType: 'application/octet-stream', size: 10 },
    });
    const token = String(presigned.body.data.uploadUrl).split('/_local/raw/')[1]!;
    const upload = vi.spyOn(adapter, 'upload');
    const answer = await call(routes, 'PUT', `${BASE}/_local/raw/:token`, { params: { token }, rawBody: hostSizeRefusal });
    expect(answer.body?.success).toBe(false);
    expect(answer.status).toBe(500);
    expect(answer.body?.error?.code).toBe('INTERNAL');
    expect(String(answer.body?.error?.message ?? '')).not.toBe('');
    expect(upload).not.toHaveBeenCalled();
  });

  it('with no bound (the host chose unlimited), a host size refusal on the chunk PUT is not taken as the door\'s own', async () => {
    const { adapter, routes } = await mountDoors(undefined, { maxUploadMb: 'unlimited' });
    const started = await call(routes, 'POST', `${BASE}/upload/chunked`, {
      body: { filename: 'h.bin', mimeType: 'application/octet-stream', totalSize: MIB },
    });
    const { uploadId, resumeToken } = started.body.data;
    const uploadChunk = vi.spyOn(adapter, 'uploadChunk');
    const answer = await call(routes, 'PUT', `${BASE}/upload/chunked/:uploadId/chunk/:chunkIndex`, {
      params: { uploadId, chunkIndex: '0' },
      headers: { 'x-resume-token': resumeToken },
      rawBody: hostSizeRefusal,
    });
    expect(answer.body?.success).toBe(false);
    expect(answer.status).toBe(500);
    expect(answer.body?.error?.code).toBe('INTERNAL');
    expect(String(answer.body?.error?.message ?? '')).not.toBe('');
    expect(uploadChunk).not.toHaveBeenCalled();
  });

  it('with no max_upload_mb the doors state the built-in 100 MB bound; only an explicit host unlimited states none', async () => {
    const tokenFrom = async (routes: Map<string, RouteHandler>) => {
      const presigned = await call(routes, 'POST', `${BASE}/upload/presigned`, {
        body: { filename: 'n.bin', mimeType: 'application/octet-stream', size: 10 },
      });
      return String(presigned.body.data.uploadUrl).split('/_local/raw/')[1]!;
    };
    const unset = await mountDoors(undefined);
    const bounded = boundedRawBody(2 * MIB);
    const token = await tokenFrom(unset.routes);
    expect((await call(unset.routes, 'PUT', `${BASE}/_local/raw/:token`, { params: { token }, rawBody: bounded.rawBody })).status).toBe(200);
    expect(bounded.asked).toEqual([100 * MIB]);

    // CONTROL — the explicit host choice reads the whole body, stating no bound.
    const unlimited = await mountDoors(undefined, { maxUploadMb: 'unlimited' });
    const whole = boundedRawBody(2 * MIB);
    const open = await tokenFrom(unlimited.routes);
    expect((await call(unlimited.routes, 'PUT', `${BASE}/_local/raw/:token`, { params: { token: open }, rawBody: whole.rawBody })).status).toBe(200);
    expect(whole.asked).toEqual([undefined]);
  });
});

// ---------------------------------------------------------------------------
// §2 — the TTLs, and the precedence
// ---------------------------------------------------------------------------

describe('[#22283] §2 · the saved TTLs reach issuance; saved > host option > namespace default > built-in', () => {
  it('a presigned upload URL, a non-gated download URL and a new session carry the saved TTLs', async () => {
    const { store, routes } = await mountDoors({
      presignedTtl: { value: 120, authored: true },
      sessionTtl: { value: 600, authored: true },
    });

    const presigned = await call(routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'a.txt', mimeType: 'text/plain', size: 5 },
    });
    expect(presigned.body.data.expiresIn).toBe(120);
    expect(tokenSecondsLeft(presigned.body.data.uploadUrl)).toBeGreaterThan(110);
    expect(tokenSecondsLeft(presigned.body.data.uploadUrl)).toBeLessThanOrEqual(121);

    await store.createFile({ id: 'f-plain', key: 'user/f-plain.txt', name: 'f.txt', status: 'committed' } as any);
    const url = await call(routes, 'GET', `${BASE}/files/:fileId/url`, { params: { fileId: 'f-plain' } });
    expect(url.status).toBe(200);
    expect(tokenSecondsLeft(url.body.data.url)).toBeGreaterThan(110);
    expect(tokenSecondsLeft(url.body.data.url)).toBeLessThanOrEqual(121);

    const started = await call(routes, 'POST', `${BASE}/upload/chunked`, {
      body: { filename: 'b.bin', mimeType: 'application/octet-stream', totalSize: 10 },
    });
    expect(secondsUntil(started.body.data.expiresAt)).toBeGreaterThan(590);
    expect(secondsUntil(started.body.data.expiresAt)).toBeLessThanOrEqual(601);
  });

  it('resolution order, per key', () => {
    const saved = (value: number) => ({ value, authored: true });
    const dflt = (value: number) => ({ value, authored: false });

    // A saved value beats the host's option.
    expect(resolveStorageLimits({ presignedTtl: saved(1200) }, { presignedTtl: 600 }).presignedTtl).toBe(1200);
    // The host's option beats the namespace default.
    expect(resolveStorageLimits({ presignedTtl: dflt(3600) }, { presignedTtl: 600 }).presignedTtl).toBe(600);
    expect(resolveStorageLimits({ sessionTtl: dflt(86400) }, { sessionTtl: 900 }).sessionTtl).toBe(900);
    // The namespace default applies when the host said nothing.
    expect(resolveStorageLimits({ sessionTtl: dflt(7200) }, {}).sessionTtl).toBe(7200);
    // No namespace: the host's option, else the built-in defaults — the upload bound's included.
    expect(resolveStorageLimits(undefined, { presignedTtl: 600 })).toEqual({
      presignedTtl: 600,
      sessionTtl: 86400,
      maxUploadBytes: 100 * MIB,
      maxUploadLayer: 'built-in default',
    });
    expect(resolveStorageLimits(undefined)).toEqual({
      presignedTtl: 3600,
      sessionTtl: 86400,
      maxUploadBytes: 100 * MIB,
      maxUploadLayer: 'built-in default',
    });
    // The size limit: the namespace default, a saved value (MB counted as MiB).
    expect(resolveStorageLimits({ maxUploadMb: dflt(100) }).maxUploadBytes).toBe(100 * MIB);
    expect(resolveStorageLimits({ maxUploadMb: saved(2.5) }).maxUploadBytes).toBe(Math.floor(2.5 * MIB));
  });

  it('reading the namespace: authorship from `source`, numeric strings admitted, a non-positive value refused aloud', () => {
    const warns: string[] = [];
    const snapshot = readStorageLimits(
      { presigned_ttl: '900', session_ttl: 600.9, max_upload_mb: 0 },
      { presigned_ttl: 'global', session_ttl: 'env' },
      (m) => warns.push(m),
    );
    expect(snapshot.presignedTtl).toEqual({ value: 900, authored: true });
    // A TTL is whole seconds.
    expect(snapshot.sessionTtl).toEqual({ value: 600, authored: true });
    // Not applied, and said so — never silently "no value".
    expect(snapshot.maxUploadMb).toBeUndefined();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("'max_upload_mb'");

    // A missing `source` lands on the conservative side: not authored.
    expect(readStorageLimits({ max_upload_mb: 100 }, {}, () => {}).maxUploadMb).toEqual({ value: 100, authored: false });
  });
});

// ---------------------------------------------------------------------------
// §3 — the plugin, end to end through applySettings
// ---------------------------------------------------------------------------

/** The manifest defaults the cascade answers when nothing is saved. */
const MANIFEST_DEFAULTS = { adapter: 'local', presigned_ttl: 3600, session_ttl: 86400, max_upload_mb: 100 };

function fakeSettings(values: Record<string, unknown>, sources: Record<string, string>) {
  const state = { values, sources };
  const subs: Array<() => void> = [];
  return {
    state,
    createClient: () => ({}),
    getNamespace: async () => ({
      values: Object.fromEntries(
        Object.entries(state.values).map(([k, v]) => [k, { value: v, source: state.sources[k] ?? 'default' }]),
      ),
    }),
    subscribe: (_ns: string, fn: () => void) => { subs.push(fn); },
    registerAction: () => {},
    emit: () => subs.forEach((fn) => fn()),
  };
}

async function bootPlugin(
  settings: ReturnType<typeof fakeSettings> | null,
  options: { presignedTtl?: number; sessionTtl?: number; maxUploadMb?: number | 'unlimited'; bindToSettings?: boolean } = {},
) {
  const { http, routes } = routeCollector();
  const services = new Map<string, unknown>([['http-server', http]]);
  if (settings) services.set('settings', settings);
  const hooks: Array<() => Promise<void> | void> = [];
  const infos: string[] = [];
  const warns: string[] = [];
  const ctx = {
    logger: { info: (m: string) => { infos.push(m); }, warn: (m: string) => { warns.push(m); }, error: () => {}, debug: () => {} },
    registerService: (name: string, svc: unknown) => { services.set(name, svc); },
    getService: (name: string) => {
      if (!services.has(name)) throw new Error(`service '${name}' not registered`);
      return services.get(name);
    },
    hook: (event: string, fn: () => Promise<void> | void) => { if (event === 'kernel:ready') hooks.push(fn); },
  };
  const plugin = new StorageServicePlugin({
    adapter: 'local',
    local: { rootDir: await tmpRoot(), signingSecret: 'test-secret-22283' },
    ...options,
  });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  for (const h of hooks) await h();
  return { routes, infos, warns, services };
}

/** Let a `void applySettings()` fired by a settings change settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('[#22283] §3 · StorageServicePlugin reads the Limits group and its doors honour it', () => {
  it('nothing saved: the declared defaults hold — 100 MB, 3600 s, 86400 s', async () => {
    const { routes } = await bootPlugin(fakeSettings({ ...MANIFEST_DEFAULTS }, {}));

    const at = await call(routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'a.bin', mimeType: 'application/octet-stream', size: 100 * MIB },
    });
    expect(at.status).toBe(200);
    expect(at.body.data.expiresIn).toBe(3600);
    expectTooLarge(await call(routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'b.bin', mimeType: 'application/octet-stream', size: 100 * MIB + 1 },
    }));

    const started = await call(routes, 'POST', `${BASE}/upload/chunked`, {
      body: { filename: 'c.bin', mimeType: 'application/octet-stream', totalSize: 10 },
    });
    expect(secondsUntil(started.body.data.expiresAt)).toBeGreaterThan(86390);
    expect(secondsUntil(started.body.data.expiresAt)).toBeLessThanOrEqual(86401);
  });

  it('saved values reach the doors', async () => {
    const { routes, infos } = await bootPlugin(fakeSettings(
      { ...MANIFEST_DEFAULTS, presigned_ttl: 120, session_ttl: 600, max_upload_mb: 1 },
      { presigned_ttl: 'global', session_ttl: 'global', max_upload_mb: 'global' },
    ));
    expect(infos.join('\n')).toContain('max_upload_mb=1MB (saved)');

    expectTooLarge(await call(routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'a.bin', mimeType: 'application/octet-stream', size: MIB + 1 },
    }));
    const ok = await call(routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'a.bin', mimeType: 'application/octet-stream', size: MIB },
    });
    expect(ok.body.data.expiresIn).toBe(120);
    const started = await call(routes, 'POST', `${BASE}/upload/chunked`, {
      body: { filename: 'c.bin', mimeType: 'application/octet-stream', totalSize: 10 },
    });
    expect(secondsUntil(started.body.data.expiresAt)).toBeLessThanOrEqual(601);
    expect(secondsUntil(started.body.data.expiresAt)).toBeGreaterThan(590);
  });

  it('a save after boot reaches the next request; a session already issued keeps its lifetime', async () => {
    const settings = fakeSettings({ ...MANIFEST_DEFAULTS }, {});
    const { routes } = await bootPlugin(settings);
    const before = await call(routes, 'POST', `${BASE}/upload/chunked`, {
      body: { filename: 'early.bin', mimeType: 'application/octet-stream', totalSize: 10 },
    });
    const earlyDeadline = before.body.data.expiresAt;

    settings.state.values = { ...MANIFEST_DEFAULTS, session_ttl: 600, max_upload_mb: 1 };
    settings.state.sources = { session_ttl: 'global', max_upload_mb: 'global' };
    settings.emit();
    await settle();

    const after = await call(routes, 'POST', `${BASE}/upload/chunked`, {
      body: { filename: 'late.bin', mimeType: 'application/octet-stream', totalSize: 10 },
    });
    expect(secondsUntil(after.body.data.expiresAt)).toBeLessThanOrEqual(601);
    expectTooLarge(await call(routes, 'POST', `${BASE}/upload/chunked`, {
      body: { filename: 'big.bin', mimeType: 'application/octet-stream', totalSize: MIB + 1 },
    }));

    // The session issued before the save still answers its original deadline.
    const progress = await call(routes, 'GET', `${BASE}/upload/chunked/:uploadId/progress`, {
      params: { uploadId: before.body.data.uploadId },
    });
    expect(progress.status).toBe(200);
    expect(progress.body.data.expiresAt).toBe(earlyDeadline);
    expect(secondsUntil(earlyDeadline)).toBeGreaterThan(86390);
  });

  it("the host's constructor TTL beats the namespace default, and a saved value beats the host's", async () => {
    const unsaved = await bootPlugin(fakeSettings({ ...MANIFEST_DEFAULTS }, {}), { presignedTtl: 600 });
    const a = await call(unsaved.routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'a.txt', mimeType: 'text/plain', size: 5 },
    });
    expect(a.body.data.expiresIn).toBe(600);

    const saved = await bootPlugin(
      fakeSettings({ ...MANIFEST_DEFAULTS, presigned_ttl: 1200 }, { presigned_ttl: 'global' }),
      { presignedTtl: 600 },
    );
    const b = await call(saved.routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'b.txt', mimeType: 'text/plain', size: 5 },
    });
    expect(b.body.data.expiresIn).toBe(1200);
  });

  it('bindToSettings: false keeps the constructor doors — built-in TTLs and the built-in 100 MB bound, the saved 1 MB unread', async () => {
    const { routes } = await bootPlugin(
      fakeSettings({ ...MANIFEST_DEFAULTS, max_upload_mb: 1 }, { max_upload_mb: 'global' }),
      { bindToSettings: false },
    );
    expectTooLarge(await call(routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'huge.bin', mimeType: 'application/octet-stream', size: 101 * MIB },
    }));
    // CONTROL — the saved 1 MB is not read: 2 MiB is under the built-in bound.
    const within = await call(routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'two.bin', mimeType: 'application/octet-stream', size: 2 * MIB },
    });
    expect(within.status).toBe(200);
    expect(within.body.data.expiresIn).toBe(3600);
  });
});

// ---------------------------------------------------------------------------
// §4 — the host door rides the same snapshot
// ---------------------------------------------------------------------------

describe('[#22283] §4 · mountStorageRoutes honours the Limits group the kernel\'s storage service carries', () => {
  it('refuses over the saved limit, and resolves the TTL against the host option', async () => {
    const adapter = new LocalStorageAdapter({ rootDir: await tmpRoot(), signingSecret: 'test-secret-22283' });
    const storage = new SwappableStorageService(adapter);
    storage.setLimitsSnapshot({
      maxUploadMb: { value: 1, authored: true },
      presignedTtl: { value: 3600, authored: false },
    });
    const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as never);
    kernel.registerService('storage', storage);
    const { http, routes } = routeCollector();
    mountStorageRoutes(http, kernel, { basePath: BASE, presignedTtl: 300, logger: { info: () => {}, warn: () => {} } });

    expectTooLarge(await call(routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'a.bin', mimeType: 'application/octet-stream', size: MIB + 1 },
    }));
    const ok = await call(routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'a.bin', mimeType: 'application/octet-stream', size: MIB },
    });
    expect(ok.status).toBe(200);
    // The host's option beats the namespace default.
    expect(ok.body.data.expiresIn).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// §5 — the upload bound: one precedence, and unset never means unlimited
// ---------------------------------------------------------------------------

/** One MB over the built-in bound. */
const OVER = 101 * MIB;
const BUILT_IN = 100 * MIB;

/** A link door that takes whatever it is handed: what the routes need to reach the upload-link byte door. */
function acceptingLinkDoor(filesMax: number) {
  const consumeUploadLink = vi.fn(async (_token: string, upload: { data: Buffer }) => ({ fileId: 'f-link', size: upload.data.byteLength }));
  const consumeUploadLinkFiles = vi.fn(async () => ({ files: [] }));
  const door = {
    inspectUploadLink: async () => ({
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      target: 'attachments',
      files: { min: 1, max: filesMax },
    }),
    consumeUploadLink,
    consumeUploadLinkFiles,
  } as unknown as UploadLinkDoor;
  return { door, consumeUploadLink, consumeUploadLinkFiles };
}

/** The upload-link door over a composition with no settings bound, signed in. */
async function mountLinkDoor(filesMax: number, opts: StorageRoutesOptions = {}) {
  const adapter = new LocalStorageAdapter({ rootDir: await tmpRoot(), signingSecret: 'test-secret-bound' });
  const { http, routes } = routeCollector();
  const link = acceptingLinkDoor(filesMax);
  registerStorageFamily(
    http,
    adapter,
    new StorageMetadataStore(null),
    { basePath: BASE, resolveSession: async () => ({ userId: 'u_link' }), ...opts } as StorageRoutesOptions,
    undefined,
    undefined,
    () => link.door,
  );
  return { routes, ...link };
}

/** The several-file form as a transport hands it once its request-body limit refused `req.body`. */
async function putTakenOverForm(
  routes: Map<string, RouteHandler>,
  rawBody: (options?: { maxBytes?: number }) => Promise<Buffer>,
  headers: Record<string, string> = {},
): Promise<Answer> {
  const handler = routes.get(`PUT:${BASE}/upload-links/:token`)!;
  const answer: Answer = { status: 200, body: undefined };
  const res = {
    json(data: unknown) { answer.body = data; return res; },
    send() { return res; },
    status(code: number) { answer.status = code; return res; },
    header() { return res; },
  };
  const req: Record<string, unknown> = {
    params: { token: 'link.token' },
    query: {},
    headers: { 'content-type': 'multipart/form-data; boundary=----os', 'x-upload-link-form': 'several', ...headers },
    method: 'PUT',
    path: `${BASE}/upload-links/:token`,
    rawBody,
  };
  Object.defineProperty(req, 'body', {
    get() {
      throw Object.assign(new Error('over the request-body limit'), { status: 413, code: 'PAYLOAD_TOO_LARGE' });
    },
  });
  await handler(req as unknown as IHttpRequest, res as unknown as IHttpResponse);
  return answer;
}

/** An engine or store no call may reach before the size verdict: reaching it is the proof the verdict passed. */
const unreachable = () =>
  new Proxy({}, {
    get() {
      throw new Error('reached past the size verdict');
    },
  });

/** A refusal as a thrown ADR-0112 error carries it. */
const refusalOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: any) => ({ code: e?.code as string | undefined, status: e?.status as number | undefined, message: String(e?.message) }),
  );

describe('the upload bound resolves by one precedence — saved > host > manifest default > built-in — and unset is never unlimited', () => {
  const saved = (value: number) => ({ value, authored: true });
  const dflt = (value: number) => ({ value, authored: false });

  it('every layer, by resolution: built-in when nothing is set, host over the manifest default, saved over the host', () => {
    expect(resolveStorageLimits(undefined)).toMatchObject({ maxUploadBytes: BUILT_IN, maxUploadLayer: 'built-in default' });
    expect(resolveStorageLimits({})).toMatchObject({ maxUploadBytes: BUILT_IN, maxUploadLayer: 'built-in default' });
    expect(resolveStorageLimits({ maxUploadMb: dflt(100) })).toMatchObject({ maxUploadBytes: BUILT_IN, maxUploadLayer: 'manifest default' });
    expect(resolveStorageLimits(undefined, { maxUploadMb: 5 })).toMatchObject({ maxUploadBytes: 5 * MIB, maxUploadLayer: 'host option' });
    expect(resolveStorageLimits({ maxUploadMb: dflt(100) }, { maxUploadMb: 200 })).toMatchObject({
      maxUploadBytes: 200 * MIB,
      maxUploadLayer: 'host option',
    });
    expect(resolveStorageLimits(undefined, { maxUploadMb: 'unlimited' })).toMatchObject({
      maxUploadBytes: undefined,
      maxUploadLayer: 'host option',
    });
    // A saved setting wins over every host choice, an explicit unlimited included.
    expect(resolveStorageLimits({ maxUploadMb: saved(2) }, { maxUploadMb: 'unlimited' })).toMatchObject({
      maxUploadBytes: 2 * MIB,
      maxUploadLayer: 'saved setting',
    });
    expect(resolveStorageLimits({ maxUploadMb: saved(2) }, { maxUploadMb: 200 }).maxUploadBytes).toBe(2 * MIB);
  });

  it('the built-in default is the settings manifest\'s declared max_upload_mb default', () => {
    const declared = (storageSettingsManifest.specifiers as Array<{ key?: string; default?: unknown }>).find(
      (s) => s.key === 'max_upload_mb',
    );
    expect(declared?.default).toBe(DEFAULT_MAX_UPLOAD_MB);
    expect(DEFAULT_MAX_UPLOAD_MB * MIB).toBe(BUILT_IN);
  });

  describe('each unset path resolves to the built-in 100 MB', () => {
    it('a plugin with no settings service: 101 MB refused, 100 MB accepted, and the boot line names the built-in default', async () => {
      const { routes, infos, warns } = await bootPlugin(null);
      expectTooLarge(await call(routes, 'POST', `${BASE}/upload/presigned`, {
        body: { filename: 'over.bin', mimeType: 'application/octet-stream', size: OVER },
      }));
      expect((await call(routes, 'POST', `${BASE}/upload/presigned`, {
        body: { filename: 'at.bin', mimeType: 'application/octet-stream', size: BUILT_IN },
      })).status).toBe(200);
      const line = infos.filter((m) => m.includes(`(${BUILT_IN} bytes)`));
      expect(line).toHaveLength(1);
      expect(line[0]).toContain('built-in default');
      expect(warns.filter((m) => m.includes('UNLIMITED'))).toEqual([]);
    });

    it('a settings-bound plugin whose settings read fails takes the built-in bound, not no limit', async () => {
      const settings = fakeSettings({ ...MANIFEST_DEFAULTS }, {});
      settings.getNamespace = async () => { throw new Error('settings store unreachable'); };
      const { routes, infos } = await bootPlugin(settings);
      expectTooLarge(await call(routes, 'POST', `${BASE}/upload/presigned`, {
        body: { filename: 'over.bin', mimeType: 'application/octet-stream', size: OVER },
      }));
      expect(infos.find((m) => m.includes(`(${BUILT_IN} bytes)`))).toContain('built-in default');
    });

    it('a saved value that is not a positive number is dropped to the host option, else the built-in bound — never to no limit', async () => {
      const bad = () => fakeSettings({ ...MANIFEST_DEFAULTS, max_upload_mb: 'lots' }, { max_upload_mb: 'global' });
      const builtIn = await bootPlugin(bad());
      expectTooLarge(await call(builtIn.routes, 'POST', `${BASE}/upload/presigned`, {
        body: { filename: 'over.bin', mimeType: 'application/octet-stream', size: OVER },
      }));
      expect(builtIn.warns.some((m) => m.includes("'max_upload_mb'"))).toBe(true);

      const host = await bootPlugin(bad(), { maxUploadMb: 5 });
      expectTooLarge(await call(host.routes, 'POST', `${BASE}/upload/presigned`, {
        body: { filename: 'over.bin', mimeType: 'application/octet-stream', size: 5 * MIB + 1 },
      }));
    });

    it('mountStorageRoutes over a bare adapter, and over an unbound plugin\'s service, refuses 101 MB', async () => {
      for (const storage of [
        new LocalStorageAdapter({ rootDir: await tmpRoot(), signingSecret: 'test-secret-bound' }),
        new SwappableStorageService(new LocalStorageAdapter({ rootDir: await tmpRoot(), signingSecret: 'test-secret-bound' })),
      ]) {
        const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as never);
        kernel.registerService('storage', storage);
        const { http, routes } = routeCollector();
        const infos: string[] = [];
        mountStorageRoutes(http, kernel, { basePath: BASE, logger: { info: (m) => { infos.push(m); }, warn: () => {} } });
        expectTooLarge(await call(routes, 'POST', `${BASE}/upload/presigned`, {
          body: { filename: 'over.bin', mimeType: 'application/octet-stream', size: OVER },
        }));
        expect(infos.find((m) => m.includes(`(${BUILT_IN} bytes)`))).toContain('built-in default');
      }
    });
  });

  describe('the host option is a layer, exactly like the TTLs', () => {
    it('on the plugin it overrides the manifest default, and a saved setting still wins over it', async () => {
      const unsaved = await bootPlugin(fakeSettings({ ...MANIFEST_DEFAULTS }, {}), { maxUploadMb: 200 });
      expect((await call(unsaved.routes, 'POST', `${BASE}/upload/presigned`, {
        body: { filename: 'big.bin', mimeType: 'application/octet-stream', size: 150 * MIB },
      })).status).toBe(200);
      expectTooLarge(await call(unsaved.routes, 'POST', `${BASE}/upload/presigned`, {
        body: { filename: 'over.bin', mimeType: 'application/octet-stream', size: 200 * MIB + 1 },
      }));
      expect(unsaved.infos.find((m) => m.includes(`(${200 * MIB} bytes)`))).toContain('host option');

      const savedWins = await bootPlugin(
        fakeSettings({ ...MANIFEST_DEFAULTS, max_upload_mb: 1 }, { max_upload_mb: 'global' }),
        { maxUploadMb: 'unlimited' },
      );
      expectTooLarge(await call(savedWins.routes, 'POST', `${BASE}/upload/presigned`, {
        body: { filename: 'a.bin', mimeType: 'application/octet-stream', size: MIB + 1 },
      }));
      expect(savedWins.infos.find((m) => m.includes(`(${MIB} bytes)`))).toContain('saved setting');
      expect(savedWins.warns.filter((m) => m.includes('UNLIMITED'))).toEqual([]);
    });

    it('on mountStorageRoutes it bounds that mount\'s doors', async () => {
      const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as never);
      kernel.registerService('storage', new LocalStorageAdapter({ rootDir: await tmpRoot(), signingSecret: 'test-secret-bound' }));
      const { http, routes } = routeCollector();
      mountStorageRoutes(http, kernel, { basePath: BASE, maxUploadMb: 1, logger: { info: () => {}, warn: () => {} } });
      expectTooLarge(await call(routes, 'POST', `${BASE}/upload/presigned`, {
        body: { filename: 'a.bin', mimeType: 'application/octet-stream', size: MIB + 1 },
      }));
      expect((await call(routes, 'POST', `${BASE}/upload/presigned`, {
        body: { filename: 'a.bin', mimeType: 'application/octet-stream', size: MIB },
      })).status).toBe(200);
    });
  });

  describe('no limit is an explicit host choice, honoured and announced', () => {
    it('the plugin: maxUploadMb \'unlimited\' accepts any size, and boot says so at warn', async () => {
      const { routes, warns, infos } = await bootPlugin(null, { maxUploadMb: 'unlimited' });
      expect((await call(routes, 'POST', `${BASE}/upload/presigned`, {
        body: { filename: 'huge.bin', mimeType: 'application/octet-stream', size: 1024 * MIB },
      })).status).toBe(200);
      const announced = warns.filter((m) => m.includes('UNLIMITED'));
      expect(announced).toHaveLength(1);
      expect(announced[0]).toContain("'unlimited'");
      expect(infos.filter((m) => m.includes('upload size bound'))).toEqual([]);
    });

    it('mountStorageRoutes: maxUploadMb \'unlimited\' is announced at warn by the mount', async () => {
      const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as never);
      kernel.registerService('storage', new LocalStorageAdapter({ rootDir: await tmpRoot(), signingSecret: 'test-secret-bound' }));
      const { http, routes } = routeCollector();
      const warns: string[] = [];
      mountStorageRoutes(http, kernel, {
        basePath: BASE,
        maxUploadMb: 'unlimited',
        logger: { info: () => {}, warn: (m) => { warns.push(m); } },
      });
      expect(warns.filter((m) => m.includes('UNLIMITED'))).toHaveLength(1);
      expect((await call(routes, 'POST', `${BASE}/upload/presigned`, {
        body: { filename: 'huge.bin', mimeType: 'application/octet-stream', size: 1024 * MIB },
      })).status).toBe(200);
    });
  });

  it('a malformed host option refuses the boot — the plugin, the host mount and the route registrar alike', async () => {
    const malformed: unknown[] = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '100', 'Unlimited', 'none', null, true, {}];
    const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as never);
    kernel.registerService('storage', new LocalStorageAdapter({ rootDir: await tmpRoot(), signingSecret: 'test-secret-bound' }));
    for (const bad of malformed) {
      expect(() => new StorageServicePlugin({ maxUploadMb: bad as never }), String(bad)).toThrow(InvalidMaxUploadMbError);
      const host = routeCollector();
      expect(() => mountStorageRoutes(host.http, kernel, { maxUploadMb: bad as never }), String(bad)).toThrow(InvalidMaxUploadMbError);
      expect(host.routes.size).toBe(0);
      const direct = routeCollector();
      expect(
        () => registerStorageRoutes(direct.http, new LocalStorageAdapter({ rootDir: tmpdir(), signingSecret: 's' }), new StorageMetadataStore(null), {
          maxUploadMb: bad as never,
        }),
        String(bad),
      ).toThrow(InvalidMaxUploadMbError);
      expect(direct.routes.size).toBe(0);
    }
    // CONTROL — the two well-formed spellings construct.
    expect(() => new StorageServicePlugin({ maxUploadMb: 0.5 })).not.toThrow();
    expect(() => new StorageServicePlugin({ maxUploadMb: 'unlimited' })).not.toThrow();
  });
});

describe('with no settings bound, a 101 MB body is refused at every byte door, declared or not', () => {
  it('local raw PUT: a declared 101 MB is refused unread; an undeclared one is read under the built-in bound and refused', async () => {
    const { adapter, routes } = await mountDoors(undefined);
    const presigned = await call(routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'r.bin', mimeType: 'application/octet-stream', size: 10 },
    });
    const token = String(presigned.body.data.uploadUrl).split('/_local/raw/')[1]!;
    const upload = vi.spyOn(adapter, 'upload');
    const unread = vi.fn(async () => Buffer.alloc(10));
    expectTooLarge(await call(routes, 'PUT', `${BASE}/_local/raw/:token`, {
      params: { token },
      headers: { 'content-length': String(OVER) },
      rawBody: unread,
    }));
    expect(unread).not.toHaveBeenCalled();
    const undeclared = boundedRawBody(OVER);
    expectTooLarge(await call(routes, 'PUT', `${BASE}/_local/raw/:token`, { params: { token }, rawBody: undeclared.rawBody }));
    expect(undeclared.asked).toEqual([BUILT_IN]);
    expect(upload).not.toHaveBeenCalled();
  });

  it('chunk PUT: a declared 101 MB chunk is refused unread; an undeclared one is read under the built-in bound and refused', async () => {
    const { adapter, store, routes } = await mountDoors(undefined);
    const started = await call(routes, 'POST', `${BASE}/upload/chunked`, {
      body: { filename: 'c.bin', mimeType: 'application/octet-stream', totalSize: BUILT_IN },
    });
    expect(started.status).toBe(200);
    const { uploadId, resumeToken } = started.body.data;
    const uploadChunk = vi.spyOn(adapter, 'uploadChunk');
    const chunk = (rawBody: (o?: { maxBytes?: number }) => Promise<Buffer>, headers: Record<string, string> = {}) =>
      call(routes, 'PUT', `${BASE}/upload/chunked/:uploadId/chunk/:chunkIndex`, {
        params: { uploadId, chunkIndex: '0' },
        headers: { 'x-resume-token': resumeToken, ...headers },
        rawBody,
      });
    const unread = vi.fn(async () => Buffer.alloc(10));
    expectTooLarge(await chunk(unread, { 'content-length': String(OVER) }));
    expect(unread).not.toHaveBeenCalled();
    const undeclared = boundedRawBody(OVER);
    expectTooLarge(await chunk(undeclared.rawBody));
    expect(undeclared.asked).toEqual([BUILT_IN]);
    expect(uploadChunk).not.toHaveBeenCalled();
    expect((await store.getSession(uploadId))?.uploaded_size ?? 0).toBe(0);
  });

  it('upload-link PUT, one file: a declared 101 MB is refused unread; an undeclared one is read under the built-in bound and refused', async () => {
    const { routes, consumeUploadLink } = await mountLinkDoor(1);
    const put = (rawBody: (o?: { maxBytes?: number }) => Promise<Buffer>, headers: Record<string, string> = {}) =>
      call(routes, 'PUT', `${BASE}/upload-links/:token`, {
        params: { token: 'link.token' },
        headers: { 'content-type': 'application/pdf', 'x-file-name': 'scan.pdf', ...headers },
        rawBody,
      });
    const unread = vi.fn(async () => Buffer.alloc(10));
    expectTooLarge(await put(unread, { 'content-length': String(OVER) }));
    expect(unread).not.toHaveBeenCalled();
    const undeclared = boundedRawBody(OVER);
    expectTooLarge(await put(undeclared.rawBody));
    expect(undeclared.asked).toEqual([BUILT_IN]);
    expect(consumeUploadLink).not.toHaveBeenCalled();
    // CONTROL — a body within the bound reaches the link.
    expect((await put(boundedRawBody(10).rawBody)).status).toBe(200);
    expect(consumeUploadLink).toHaveBeenCalledTimes(1);
  });

  it('upload-link PUT, the several-file form: over its form limit (each file within the built-in bound) is refused, declared or not', async () => {
    const { routes, consumeUploadLinkFiles } = await mountLinkDoor(2);
    const formLimit = BUILT_IN * 2 + 64 * 1024;
    /** The form's refusal names its form limit, not the setting: status and code are the claim. */
    const expectFormTooLarge = (answer: Answer) => {
      expect(answer.status).toBe(413);
      expect(answer.body?.error?.code).toBe('PAYLOAD_TOO_LARGE');
    };
    const unread = vi.fn(async () => Buffer.alloc(10));
    expectFormTooLarge(await putTakenOverForm(routes, unread, { 'content-length': String(formLimit + 1) }));
    expect(unread).not.toHaveBeenCalled();
    const undeclared = boundedRawBody(formLimit + 1);
    expectFormTooLarge(await putTakenOverForm(routes, undeclared.rawBody));
    expect(undeclared.asked).toEqual([formLimit]);
    expect(consumeUploadLinkFiles).not.toHaveBeenCalled();
  });

  it('CONTROL · with the host\'s explicit unlimited, the upload-link door relays a host size refusal in its own words', async () => {
    const { routes } = await mountLinkDoor(1, { maxUploadMb: 'unlimited' });
    const hostRefusal = boundedRawBody(OVER);
    const host = vi.fn(async (options?: { maxBytes?: number }) => {
      hostRefusal.asked.push(options?.maxBytes);
      throw Object.assign(new Error('the host refused this body for size'), { status: 413, code: 'PAYLOAD_TOO_LARGE' });
    });
    const answer = await call(routes, 'PUT', `${BASE}/upload-links/:token`, {
      params: { token: 'link.token' },
      headers: { 'content-type': 'application/pdf', 'x-file-name': 'scan.pdf' },
      rawBody: host,
    });
    expect(answer.status).toBe(413);
    expect(answer.body?.error?.code).toBe('PAYLOAD_TOO_LARGE');
    expect(answer.body?.error?.message).toBe('the host refused this body for size');
    expect(hostRefusal.asked).toEqual([undefined]);
  });
});

describe('with no settings bound, the server-side file verbs refuse a 101 MB file at the built-in bound', () => {
  let file: Buffer | undefined;
  const overFile = () => (file ??= Buffer.alloc(OVER));
  afterAll(() => { file = undefined; });

  it('field-files storeFile: 413 PAYLOAD_TOO_LARGE before the engine or the store is reached; the host\'s unlimited lets it through', async () => {
    const verb = (hostMaxUploadMb?: 'unlimited') =>
      new FieldFileService({
        getEngine: () => unreachable() as never,
        getStorage: () => unreachable() as never,
        getLimitsSnapshot: () => undefined,
        hostMaxUploadMb,
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as never,
      });
    const input = { organizationId: 'org_a', filename: 'big.pdf', mimeType: 'application/pdf', data: overFile() };
    expect(await refusalOf(verb().storeFile(input))).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413 });
    // CONTROL — past the size verdict, the verb reaches the engine.
    expect((await refusalOf(verb('unlimited').storeFile(input)))?.message).toContain('reached past the size verdict');
  });

  it('file-attachments attachFile: 413 PAYLOAD_TOO_LARGE before the engine or the store is reached; the host\'s unlimited lets it through', async () => {
    const verb = (hostMaxUploadMb?: 'unlimited') =>
      new FileAttachmentService({
        getEngine: () => unreachable() as never,
        getStorage: () => unreachable() as never,
        getLimitsSnapshot: () => undefined,
        hostMaxUploadMb,
        logger: { warn: () => {} },
      });
    const input = {
      parentObject: 'att_case',
      parentId: 'case_a',
      organizationId: 'org_a',
      filename: 'big.eml',
      mimeType: 'message/rfc822',
      data: overFile(),
    };
    expect(await refusalOf(verb().attachFile(input))).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413 });
    expect((await refusalOf(verb('unlimited').attachFile(input)))?.message).toContain('reached past the size verdict');
  });
});
