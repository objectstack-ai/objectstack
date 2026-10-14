// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23174] A storage route's catch-all 5xx answers `500 INTERNAL` with the
 * route's own generic text, never the caught error's, and the operator reads
 * the caught error in ONE server-fault line.
 *
 * Eight handlers ended their `catch` in `sendError(res, 500, 'INTERNAL',
 * err?.message ?? 'Internal error')`, so whatever a failing metadata store or
 * adapter said reached the caller. They now answer through `sendServerFault`
 * (`@objectstack/types`): `Internal error` goes on the wire, and the caught
 * error, stack included, goes to the server-fault log.
 *
 * The two `_local/raw/:token` byte routes already withheld the text through
 * `sendRawByteRouteFailure`, which composed `logServerFault` and `sendError`
 * and so logged TWO lines per fault (the original with its stack, then
 * `sendError`'s own). That arm converges onto the same writer: one line. Its
 * line keys by the MOUNTED pattern, and the token in the request URL, a live
 * signed capability, never reaches the log.
 *
 * ⛔ No `toThrow()` here: the unrepaired routes never threw, they ANSWERED with
 * the fault's text. The claim is `status` + `code` + what the body carries.
 */

import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { SERVER_FAULT_LOG_PREFIX } from '@objectstack/types';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { StorageMetadataStore } from './metadata-store.js';
import { registerStorageRoutes } from './storage-routes.js';

const BASE = '/api/v1/storage';
const SECRET = 'server-fault-withheld-secret';

/** Shaped like a driver error: a host, a table and a server path. */
const FAULT = 'connect ETIMEDOUT 10.0.9.3:5432 reading sys_file (/srv/objectstack/storage-root/tenant-a)';

const roots: string[] = [];

async function adapter(): Promise<LocalStorageAdapter> {
  const rootDir = join(tmpdir(), `os-23174-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(rootDir, { recursive: true });
  roots.push(rootDir);
  return new LocalStorageAdapter({ rootDir, signingSecret: SECRET });
}

afterAll(async () => {
  await Promise.all(roots.map((r) => fs.rm(r, { recursive: true, force: true })));
});

/** A metadata store whose every read and write throws `FAULT` — the first thing each handler asks. */
function failingStore(): StorageMetadataStore {
  const store = new StorageMetadataStore(null);
  const raise = async () => { throw new Error(FAULT); };
  Object.assign(store, { createFile: raise, getFile: raise, createSession: raise, getSession: raise, updateFile: raise, updateSession: raise });
  return store;
}

function mount(storage: unknown, store: StorageMetadataStore): Map<string, RouteHandler> {
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
  registerStorageRoutes(http as any, storage as any, store, { basePath: BASE });
  return routes;
}

async function drive(
  routes: Map<string, RouteHandler>,
  key: string,
  req: Partial<IHttpRequest> & { rawBody?: () => Promise<Buffer> },
): Promise<{ status: number; body: any }> {
  const handler = routes.get(key);
  if (!handler) throw new Error(`fixture: no handler for ${key}`);
  const captured = { status: 200, body: undefined as any };
  const res: any = {
    json(data: any) { captured.body = data; },
    send() {},
    status(code: number) { captured.status = code; return res; },
    header() { return res; },
  };
  const [method] = key.split(':');
  await handler({ params: {}, query: {}, headers: {}, method, path: '/', ...req } as unknown as IHttpRequest, res as IHttpResponse);
  return captured;
}

/** The eight catch-all arms, each driven to its `catch` by the failing store. */
const CATCH_ALL_ROUTES: Array<{ key: string; req: Partial<IHttpRequest> & { rawBody?: () => Promise<Buffer> } }> = [
  { key: `POST:${BASE}/upload/presigned`, req: { body: { filename: 'a.txt', mimeType: 'text/plain', size: 3 } } },
  { key: `POST:${BASE}/upload/complete`, req: { body: { fileId: 'f1' } } },
  { key: `POST:${BASE}/upload/chunked`, req: { body: { filename: 'a.bin', mimeType: 'application/octet-stream', totalSize: 10 } } },
  {
    key: `PUT:${BASE}/upload/chunked/:uploadId/chunk/:chunkIndex`,
    req: { params: { uploadId: 'u1', chunkIndex: '0' }, rawBody: async () => Buffer.from('chunk') },
  },
  { key: `POST:${BASE}/upload/chunked/:uploadId/complete`, req: { params: { uploadId: 'u1' } } },
  { key: `GET:${BASE}/upload/chunked/:uploadId/progress`, req: { params: { uploadId: 'u1' } } },
  { key: `GET:${BASE}/files/:fileId/url`, req: { params: { fileId: 'f1' } } },
  { key: `GET:${BASE}/files/:fileId`, req: { params: { fileId: 'f1' } } },
];

/** The fault log is `console.error` here: `sendServerFault` takes no logger, as `sendError` takes none. */
const quietConsole = () => vi.spyOn(console, 'error').mockImplementation(() => {});
const faultLines = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter((c) => String(c[0]).startsWith(SERVER_FAULT_LOG_PREFIX));

afterEach(() => { vi.restoreAllMocks(); });

describe('[#23174] storage — a catch-all 5xx withholds the caught text', () => {
  it.each(CATCH_ALL_ROUTES)('$key answers 500 INTERNAL with the generic text, and none of the fault', async ({ key, req }) => {
    quietConsole();
    const res = await drive(mount(await adapter(), failingStore()), key, req);

    expect(res.status).toBe(500);
    expect(res.body?.success).toBe(false);
    expect(res.body?.error?.code).toBe('INTERNAL');
    expect(res.body?.error?.message).toBe('Internal error');
    expect(JSON.stringify(res.body)).not.toContain('ETIMEDOUT');
    expect(JSON.stringify(res.body)).not.toContain('/srv/objectstack');
    expect(BaseResponseSchema.safeParse(res.body).success).toBe(true);
    expect(envelopeViolations(res.body)).toEqual([]);
  });

  it.each(CATCH_ALL_ROUTES)('$key logs the caught text ONCE, with its stack', async ({ key, req }) => {
    const spy = quietConsole();
    await drive(mount(await adapter(), failingStore()), key, req);

    const lines = faultLines(spy);
    expect(lines).toHaveLength(1);
    expect(String(lines[0][0])).toContain(FAULT);
    expect(String((lines[0][1] as Record<string, unknown>).stack)).toContain(FAULT);
  });
});

describe('[#23174] storage — the raw byte routes log ONE line, keyed by the mounted pattern', () => {
  const inTenMinutes = () => Math.floor(Date.now() / 1000) + 600;
  const signed = (op: 'put' | 'get') => {
    const b64 = Buffer.from(JSON.stringify({ k: 'key.bin', exp: inTenMinutes(), op }), 'utf8').toString('base64url');
    return `${b64}.${createHmac('sha256', SECRET).update(b64).digest('base64url')}`;
  };

  for (const [method, op, generic] of [['PUT', 'put', 'Upload failed'], ['GET', 'get', 'Download failed']] as const) {
    it(`${method} _local/raw/:token: one line, the pattern, never the token, and the generic text on the wire`, async () => {
      const local = await adapter();
      local.upload = async () => { throw new Error(FAULT); };
      local.download = async () => { throw new Error(FAULT); };
      const token = signed(op);
      const spy = quietConsole();
      const res = await drive(mount(local, new StorageMetadataStore(null)), `${method}:${BASE}/_local/raw/:token`, {
        params: { token },
        path: `${BASE}/_local/raw/${token}`,
        url: `${BASE}/_local/raw/${token}`,
        rawBody: async () => Buffer.from('bytes'),
      } as Partial<IHttpRequest>);

      expect(res.status).toBe(500);
      expect(res.body?.error?.code).toBe('INTERNAL');
      expect(res.body?.error?.message).toBe(generic);
      expect(JSON.stringify(res.body)).not.toContain('ETIMEDOUT');

      const lines = faultLines(spy);
      expect(lines).toHaveLength(1);
      expect(String(lines[0][0])).toContain(`${method} ${BASE}/_local/raw/:token`);
      expect(String(lines[0][0])).toContain(FAULT);
      expect(JSON.stringify(spy.mock.calls)).not.toContain(token);
    });
  }
});
