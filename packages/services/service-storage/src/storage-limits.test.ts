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
 *    received so far plus this chunk) each answer `413` / `VALIDATION_ERROR`
 *    in the ADR-0112 envelope, with no row written and no byte handed to the
 *    adapter. Each has its control at exactly the limit, which is accepted.
 *  - **§2 the TTLs and the precedence.** A saved TTL is what a presigned URL
 *    and a new session carry; a saved value beats the host's option, the host's
 *    option beats the namespace default, and with no namespace bound the
 *    built-in defaults and NO size limit stand (the pre-#22283 behaviour).
 *  - **§3 the plugin wiring, end to end through `applySettings`.** Nothing
 *    saved ⇒ the declared defaults (100 MB, 3600 s, 86400 s) hold; a save after
 *    boot reaches the next request, while a session already issued keeps the
 *    lifetime it was issued with; `bindToSettings: false` keeps the old doors.
 *  - **§4 the host door** (`mountStorageRoutes`) honours the same snapshot,
 *    because it rides the `storage` service both mounts are composed over.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
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
import { readStorageLimits, resolveStorageLimits, type StorageLimitsSnapshot } from './storage-limits.js';

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
  expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
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
  it('presigned door: a declared size over the limit is 413 VALIDATION_ERROR — no row, no URL minted', async () => {
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

  it('chunk door: the chunk that takes the bytes received past the limit is 413 — not stored, progress unchanged', async () => {
    const { adapter, store, routes } = await mountDoors(SAVED_ONE_MB);
    const started = await call(routes, 'POST', `${BASE}/upload/chunked`, {
      body: { filename: 'c.bin', mimeType: 'application/octet-stream', totalSize: MIB },
    });
    expect(started.status).toBe(200);
    const { uploadId, resumeToken } = started.body.data;
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
    const { adapter, routes } = await mountDoors(SAVED_ONE_MB);
    const started = await call(routes, 'POST', `${BASE}/upload/chunked`, {
      body: { filename: 'r.bin', mimeType: 'application/octet-stream', totalSize: MIB },
    });
    const { uploadId, resumeToken } = started.body.data;
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

  it('CONTROL · no settings namespace bound: no size limit at any door (the pre-#22283 behaviour)', async () => {
    const { routes } = await mountDoors(undefined);
    const presigned = await call(routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'huge.bin', mimeType: 'application/octet-stream', size: 1024 * MIB },
    });
    expect(presigned.status).toBe(200);
    const started = await call(routes, 'POST', `${BASE}/upload/chunked`, {
      body: { filename: 'huge.bin', mimeType: 'application/octet-stream', totalSize: 1024 * MIB },
    });
    expect(started.status).toBe(200);
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
    // No namespace: the host's option, else the built-in defaults, and no size limit.
    expect(resolveStorageLimits(undefined, { presignedTtl: 600 })).toEqual({
      presignedTtl: 600,
      sessionTtl: 86400,
      maxUploadBytes: undefined,
    });
    expect(resolveStorageLimits(undefined)).toEqual({ presignedTtl: 3600, sessionTtl: 86400, maxUploadBytes: undefined });
    // The size limit comes from the namespace alone — its default included.
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
  options: { presignedTtl?: number; sessionTtl?: number; bindToSettings?: boolean } = {},
) {
  const { http, routes } = routeCollector();
  const services = new Map<string, unknown>([['http-server', http]]);
  if (settings) services.set('settings', settings);
  const hooks: Array<() => Promise<void> | void> = [];
  const infos: string[] = [];
  const ctx = {
    logger: { info: (m: string) => { infos.push(m); }, warn: () => {}, error: () => {}, debug: () => {} },
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
  return { routes, infos };
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

  it('CONTROL · bindToSettings: false keeps the constructor doors — no size limit, built-in TTLs', async () => {
    const { routes } = await bootPlugin(
      fakeSettings({ ...MANIFEST_DEFAULTS, max_upload_mb: 1 }, { max_upload_mb: 'global' }),
      { bindToSettings: false },
    );
    const huge = await call(routes, 'POST', `${BASE}/upload/presigned`, {
      body: { filename: 'huge.bin', mimeType: 'application/octet-stream', size: 1024 * MIB },
    });
    expect(huge.status).toBe(200);
    expect(huge.body.data.expiresIn).toBe(3600);
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
