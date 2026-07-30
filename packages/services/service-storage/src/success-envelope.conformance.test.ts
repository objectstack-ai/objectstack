// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Success-envelope conformance for the autonomously-mounted
 * `/api/v1/storage/*` routes (#3689) — the success-path twin of the error-path
 * fix in #3675 (`error-envelope.conformance.test.ts`), and the same pairing
 * i18n went through in #3636 / #3675.
 *
 * The drift this closes: `storage.zod.ts` declared every one of these routes as
 * `BaseResponseSchema.extend({ data })`, and `PresignedUrlResponse` and friends
 * are `z.infer`red from those schemas and published as the SDK's return types —
 * while the wire carried three shapes, none of them with `success`:
 *
 *   - the six upload routes:    `{ data: {…} }`
 *   - `GET /files/:fileId/url`: `{ url }`
 *   - `PUT /_local/raw/:token`: `{ ok: true, key }`
 *
 * It broke nothing only because the SDK's storage methods returned
 * `res.json()` raw — `any`, so TypeScript could not see the gap, and nothing
 * relied on the declaration. That is exactly the posture i18n was in until
 * something did rely on it.
 *
 * So the assertions here are against the DECLARED schemas, imported from
 * `packages/spec` rather than restated: a body that parses is a body the SDK's
 * published return type does not lie about. Three directions are covered:
 *
 *   1. every success-producing branch is DRIVEN and parsed against both
 *      `BaseResponseSchema` and the specific schema that route declares;
 *   2. the two retired shapes are asserted DEAD, so a revert cannot pass
 *      quietly;
 *   3. the module source is scanned, so a NEW route cannot bypass the
 *      `sendOk` helper and reintroduce a bare body — without this the suite
 *      would only ever cover the routes that existed the day it was written.
 *
 * As with the error twin: the route ledgers cannot catch any of this. They
 * audit which routes exist and whether the SDK can address them, not what
 * comes back.
 *
 * The STATIC half — proving no route can bypass the `sendOk` / `sendError` pair
 * — used to be an open-coded regex block right here. #3843 lifted it out to
 * `scripts/check-route-envelope.mjs` (`pnpm check:route-envelope`), which audits
 * EVERY route module in the repo rather than this one package.
 *
 * That move mattered more than deduplication. A per-package scan structurally
 * cannot notice a module nobody thought to convert, and going repo-wide found two
 * immediately — `share-link-routes.ts` (#3983) and the dev-only `hmr-routes.ts`,
 * neither of them in #3843's hand-written survey. It also dropped the regex: the old block stripped
 * comments with `String.replace`, which ate `//` inside string literals and
 * truncated the rest of that line — response writes included — and counted
 * `c.req.json()` (a request READ) as an unenveloped response. The AST has neither
 * bug.
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BaseResponseSchema } from '@objectstack/spec/api';
import {
  PresignedUrlResponseSchema,
  FileUploadResponseSchema,
  InitiateChunkedUploadResponseSchema,
  UploadChunkResponseSchema,
  CompleteChunkedUploadResponseSchema,
  UploadProgressSchema,
  FileDownloadUrlResponseSchema,
  RawUploadResponseSchema,
} from '@objectstack/spec/api';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { LocalStorageAdapter } from './local-storage-adapter';
import { StorageMetadataStore } from './metadata-store';
import { registerStorageRoutes } from './storage-routes';

const BASE = '/api/v1/storage';

interface Captured {
  status: number;
  body: any;
}

function mount(storage: any, store: any, routeOpts: any = {}) {
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
  registerStorageRoutes(http as any, storage, store, { basePath: BASE, ...routeOpts });
  return routes;
}

async function drive(
  routes: Map<string, RouteHandler>,
  method: string,
  path: string,
  req: Partial<IHttpRequest> = {},
): Promise<Captured> {
  const handler = routes.get(`${method}:${path}`);
  if (!handler) throw new Error(`no handler for ${method} ${path}`);
  const captured: Captured = { status: 200, body: undefined };
  const res: any = {
    json(data: any) { captured.body = data; },
    send() {},
    status(code: number) { captured.status = code; return res; },
    header() { return res; },
  };
  await handler(
    { params: {}, query: {}, body: undefined, headers: {}, method, path, ...req } as IHttpRequest,
    res as IHttpResponse,
  );
  return captured;
}

async function tmpAdapter(): Promise<LocalStorageAdapter> {
  const rootDir = join(tmpdir(), `os-ok-env-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(rootDir, { recursive: true });
  return new LocalStorageAdapter({ rootDir, signingSecret: 'test-secret' });
}

/** Presign → PUT the bytes → commit, returning the fileId of a live file. */
async function committedFile(
  routes: Map<string, RouteHandler>,
  adapter: LocalStorageAdapter,
): Promise<string> {
  const presigned = await drive(routes, 'POST', `${BASE}/upload/presigned`, {
    body: { filename: 'dl.txt', mimeType: 'text/plain', size: 5 },
  });
  const fileId = presigned.body.data.fileId;
  await adapter.upload(`user/${fileId}.txt`, Buffer.from('hello'));
  await drive(routes, 'POST', `${BASE}/upload/complete`, { body: { fileId } });
  return fileId;
}

describe('storage success envelope (#3689)', () => {
  /**
   * One entry per success-producing route. `schema` is the contract that route
   * declares in `packages/spec/src/api/storage.zod.ts` — the same object the
   * SDK's return type is inferred from, so a body that parses is a body the
   * published type describes.
   */
  const CASES: Array<{
    name: string;
    schema: { safeParse(v: unknown): { success: boolean; error?: unknown } };
    /** Payload keys the route is expected to carry, asserted under `data`. */
    dataKeys: string[];
    run: () => Promise<Captured>;
  }> = [
    {
      name: 'POST /upload/presigned',
      schema: PresignedUrlResponseSchema,
      dataKeys: ['uploadUrl', 'method', 'fileId', 'expiresIn'],
      run: async () => {
        const routes = mount(await tmpAdapter(), new StorageMetadataStore(null));
        return drive(routes, 'POST', `${BASE}/upload/presigned`, {
          body: { filename: 'photo.jpg', mimeType: 'image/jpeg', size: 1024, scope: 'user' },
        });
      },
    },
    {
      name: 'POST /upload/complete',
      schema: FileUploadResponseSchema,
      dataKeys: ['fileId', 'path', 'name', 'size', 'mimeType', 'lastModified', 'created'],
      run: async () => {
        const routes = mount(await tmpAdapter(), new StorageMetadataStore(null));
        const presigned = await drive(routes, 'POST', `${BASE}/upload/presigned`, {
          body: { filename: 'test.txt', mimeType: 'text/plain', size: 5 },
        });
        return drive(routes, 'POST', `${BASE}/upload/complete`, {
          body: { fileId: presigned.body.data.fileId },
        });
      },
    },
    {
      name: 'POST /upload/chunked',
      schema: InitiateChunkedUploadResponseSchema,
      dataKeys: ['uploadId', 'resumeToken', 'fileId', 'totalChunks', 'chunkSize', 'expiresAt'],
      run: async () => {
        const routes = mount(await tmpAdapter(), new StorageMetadataStore(null));
        return drive(routes, 'POST', `${BASE}/upload/chunked`, {
          body: { filename: 'large.bin', mimeType: 'application/octet-stream', totalSize: 100 },
        });
      },
    },
    {
      name: 'PUT /upload/chunked/:uploadId/chunk/:chunkIndex',
      schema: UploadChunkResponseSchema,
      dataKeys: ['chunkIndex', 'eTag', 'bytesReceived'],
      run: async () => {
        const routes = mount(await tmpAdapter(), new StorageMetadataStore(null));
        const init = await drive(routes, 'POST', `${BASE}/upload/chunked`, {
          body: { filename: 'large.bin', mimeType: 'application/octet-stream', totalSize: 100 },
        });
        const { uploadId, resumeToken } = init.body.data;
        return drive(routes, 'PUT', `${BASE}/upload/chunked/:uploadId/chunk/:chunkIndex`, {
          params: { uploadId, chunkIndex: '0' },
          headers: { 'x-resume-token': resumeToken },
          rawBody: async () => Buffer.from('a'.repeat(100)),
        } as any);
      },
    },
    {
      name: 'POST /upload/chunked/:uploadId/complete',
      schema: CompleteChunkedUploadResponseSchema,
      dataKeys: ['fileId', 'key', 'size', 'mimeType', 'url'],
      run: async () => {
        const routes = mount(await tmpAdapter(), new StorageMetadataStore(null));
        const init = await drive(routes, 'POST', `${BASE}/upload/chunked`, {
          body: { filename: 'large.bin', mimeType: 'application/octet-stream', totalSize: 100 },
        });
        const { uploadId, resumeToken } = init.body.data;
        const chunk = await drive(routes, 'PUT', `${BASE}/upload/chunked/:uploadId/chunk/:chunkIndex`, {
          params: { uploadId, chunkIndex: '0' },
          headers: { 'x-resume-token': resumeToken },
          rawBody: async () => Buffer.from('a'.repeat(100)),
        } as any);
        return drive(routes, 'POST', `${BASE}/upload/chunked/:uploadId/complete`, {
          params: { uploadId },
          body: { parts: [{ chunkIndex: 0, eTag: chunk.body.data.eTag }] },
        });
      },
    },
    {
      name: 'GET /upload/chunked/:uploadId/progress',
      schema: UploadProgressSchema,
      dataKeys: ['uploadId', 'fileId', 'filename', 'totalSize', 'uploadedSize', 'percentComplete', 'status'],
      run: async () => {
        const routes = mount(await tmpAdapter(), new StorageMetadataStore(null));
        const init = await drive(routes, 'POST', `${BASE}/upload/chunked`, {
          body: { filename: 'progress.bin', mimeType: 'application/octet-stream', totalSize: 200 },
        });
        return drive(routes, 'GET', `${BASE}/upload/chunked/:uploadId/progress`, {
          params: { uploadId: init.body.data.uploadId },
        });
      },
    },
    {
      // The one that MOVED: a bare `{ url }` before #3689, with no envelope at
      // all and no schema in `storage.zod.ts` to answer to.
      name: 'GET /files/:fileId/url',
      schema: FileDownloadUrlResponseSchema,
      dataKeys: ['url'],
      run: async () => {
        const adapter = await tmpAdapter();
        const routes = mount(adapter, new StorageMetadataStore(null));
        const fileId = await committedFile(routes, adapter);
        return drive(routes, 'GET', `${BASE}/files/:fileId/url`, { params: { fileId } });
      },
    },
    {
      // And the other: `{ ok: true, key }`, whose `ok` was a private second
      // word for the `success` the envelope already carries.
      name: 'PUT /_local/raw/:token',
      schema: RawUploadResponseSchema,
      dataKeys: ['key'],
      run: async () => {
        const adapter = await tmpAdapter();
        const routes = mount(adapter, new StorageMetadataStore(null));
        const desc = await adapter.getPresignedUpload!('rawtest/file.bin', 60, {
          contentType: 'application/octet-stream',
        });
        return drive(routes, 'PUT', `${BASE}/_local/raw/:token`, {
          params: { token: desc.uploadUrl.split('/_local/raw/')[1] },
          rawBody: async () => Buffer.from('raw bytes'),
        } as any);
      },
    },
  ];

  for (const c of CASES) {
    it(`${c.name} answers { success: true, data } and parses as its declared schema`, async () => {
      const { status, body } = await c.run();
      expect(status).toBe(200);

      // The shared envelope, imported — not a restatement of it.
      const base = BaseResponseSchema.safeParse(body);
      expect(base.success, `body is not a BaseResponse: ${JSON.stringify(body)}`).toBe(true);
      expect(body.success).toBe(true);
      expect(body.error).toBeUndefined();

      // The route's OWN declared contract — the object `packages/spec` infers
      // the SDK's return type from. This is the assertion that makes
      // `declared === actual` rather than merely `declared ≈ actual`.
      const declared = c.schema.safeParse(body);
      expect(
        declared.success,
        `body does not match its declared schema: ${JSON.stringify(declared.error ?? body)}`,
      ).toBe(true);

      // The payload really is under `data`, not scattered across the top level.
      for (const k of c.dataKeys) {
        expect(body.data?.[k], `data.${k} missing from ${c.name}`).toBeDefined();
      }
    });
  }

  it('the pre-#3689 shapes are dead — no top-level payload, no second success word', async () => {
    for (const c of CASES) {
      const { body } = await c.run();
      // `{ url }` and `{ ok: true, key }` lived at the top level.
      expect(body.url, `${c.name} still answers a top-level url`).toBeUndefined();
      expect(body.ok, `${c.name} still answers a top-level ok`).toBeUndefined();
      expect(body.key, `${c.name} still answers a top-level key`).toBeUndefined();
      // And `{ data }` alone, without the flag, was the third shape.
      expect(typeof body.success, `${c.name} answers no success flag`).toBe('boolean');
    }
  });
});
