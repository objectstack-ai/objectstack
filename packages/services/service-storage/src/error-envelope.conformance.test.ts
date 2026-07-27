// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Error-envelope conformance for the autonomously-mounted `/api/v1/storage/*`
 * routes (#3675).
 *
 * The route ledgers (#3563 → #3656) audit which routes EXIST and whether the
 * SDK can address them. They say nothing about what comes back, which is how
 * these routes carried green `sdk` rows while emitting a bare
 * `{ error: '<message>' }` — with the code, where one existed at all, as a
 * SIBLING of `error` rather than a field of it — against a contract that
 * declares `{ success: false, error: { code, message } }`.
 *
 * This file closes that gap for the error path, in two directions:
 *   1. every distinct error branch is DRIVEN and its body parsed against the
 *      real `BaseResponseSchema` from `packages/spec` — not a local copy, so
 *      the assertion tracks the contract if the contract moves;
 *   2. the module source is scanned so a NEW route cannot quietly reintroduce
 *      the bare shape. Without (2) this suite only ever covers the branches
 *      that existed the day it was written.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BaseResponseSchema } from '@objectstack/spec/api';
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

/** A store whose every read throws — drives the `catch` arms. */
const explodingStore = {
  getFile: async () => { throw new Error('boom'); },
  getSession: async () => { throw new Error('boom'); },
  createFile: async () => { throw new Error('boom'); },
} as any;

async function tmpAdapter(): Promise<LocalStorageAdapter> {
  const rootDir = join(tmpdir(), `os-err-env-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(rootDir, { recursive: true });
  return new LocalStorageAdapter({ rootDir, signingSecret: 'test-secret' });
}

async function committedAttachment(store: StorageMetadataStore, id: string, extra: any = {}) {
  await store.createFile({
    id,
    key: `attachments/${id}.bin`,
    name: 'x.bin',
    status: 'committed',
    acl: 'private',
    scope: 'attachments',
    ...extra,
  } as any);
}

describe('storage error envelope (#3675)', () => {
  /**
   * One entry per distinct `code` the routes can emit. `expected` is asserted
   * exactly, so retiring a code without retiring its case fails here rather
   * than silently shrinking coverage.
   */
  const CASES: Array<{ name: string; status: number; code: string; run: () => Promise<Captured> }> = [
    {
      name: 'missing required upload fields',
      status: 400,
      code: 'INVALID_REQUEST',
      run: async () => {
        const routes = mount(await tmpAdapter(), new StorageMetadataStore(null));
        return drive(routes, 'POST', `${BASE}/upload/presigned`, { body: {} });
      },
    },
    {
      name: 'completing an upload for an unknown file',
      status: 404,
      code: 'FILE_NOT_FOUND',
      run: async () => {
        const routes = mount(await tmpAdapter(), new StorageMetadataStore(null));
        return drive(routes, 'POST', `${BASE}/upload/complete`, { body: { fileId: 'nope' } });
      },
    },
    {
      name: 'completing an unknown chunked session',
      status: 404,
      code: 'UPLOAD_SESSION_NOT_FOUND',
      run: async () => {
        const routes = mount(await tmpAdapter(), new StorageMetadataStore(null));
        return drive(routes, 'POST', `${BASE}/upload/chunked/:uploadId/complete`, {
          params: { uploadId: 'nope' },
        });
      },
    },
    {
      name: 'chunk upload with the wrong resume token',
      status: 403,
      code: 'INVALID_RESUME_TOKEN',
      run: async () => {
        const store = new StorageMetadataStore(null);
        await store.createSession({
          id: 'sess-1',
          file_id: 'f-1',
          key: 'user/f-1.bin',
          filename: 'f.bin',
          mime_type: 'application/octet-stream',
          total_size: 10,
          chunk_size: 5,
          total_chunks: 2,
          resume_token: 'the-real-token',
          status: 'in_progress',
        } as any);
        const routes = mount(await tmpAdapter(), store);
        return drive(routes, 'PUT', `${BASE}/upload/chunked/:uploadId/chunk/:chunkIndex`, {
          params: { uploadId: 'sess-1', chunkIndex: '0' },
          headers: { 'x-resume-token': 'wrong' },
        });
      },
    },
    {
      name: 'anonymous upload when a session resolver is wired',
      status: 401,
      code: 'AUTH_REQUIRED',
      run: async () => {
        const routes = mount(await tmpAdapter(), new StorageMetadataStore(null), {
          resolveSession: async () => null,
        });
        return drive(routes, 'POST', `${BASE}/upload/presigned`, { body: {} });
      },
    },
    {
      name: 'denied download of an attachments-scope file',
      status: 403,
      code: 'ATTACHMENT_DOWNLOAD_DENIED',
      run: async () => {
        const store = new StorageMetadataStore(null);
        await committedAttachment(store, 'a1');
        const routes = mount(await tmpAdapter(), store, { authorizeFileRead: async () => 'deny' });
        return drive(routes, 'GET', `${BASE}/files/:fileId/url`, { params: { fileId: 'a1' } });
      },
    },
    {
      name: 'denied download of a field-owned file',
      status: 403,
      code: 'FILE_DOWNLOAD_DENIED',
      run: async () => {
        const store = new StorageMetadataStore(null);
        await committedAttachment(store, 'fo1', {
          scope: 'user',
          key: 'user/fo1.png',
          ref_object: 'product',
          ref_id: 'p1',
        });
        const routes = mount(await tmpAdapter(), store, { authorizeFileRead: async () => 'deny' });
        return drive(routes, 'GET', `${BASE}/files/:fileId/url`, { params: { fileId: 'fo1' } });
      },
    },
    {
      name: 'unauthenticated download of an attachments-scope file',
      status: 401,
      code: 'AUTH_REQUIRED',
      run: async () => {
        const store = new StorageMetadataStore(null);
        await committedAttachment(store, 'a2');
        const routes = mount(await tmpAdapter(), store, {
          authorizeFileRead: async () => 'unauthenticated',
        });
        return drive(routes, 'GET', `${BASE}/files/:fileId/url`, { params: { fileId: 'a2' } });
      },
    },
    {
      name: 'raw upload against an adapter with no token support',
      status: 501,
      code: 'NOT_IMPLEMENTED',
      run: async () => {
        const routes = mount({} as any, new StorageMetadataStore(null));
        return drive(routes, 'PUT', `${BASE}/_local/raw/:token`, { params: { token: 'x' } });
      },
    },
    {
      name: 'raw download with a forged token signature',
      status: 403,
      code: 'INVALID_TOKEN',
      run: async () => {
        const routes = mount(await tmpAdapter(), new StorageMetadataStore(null));
        return drive(routes, 'GET', `${BASE}/_local/raw/:token`, { params: { token: 'YWJj.ZGVm' } });
      },
    },
    {
      name: 'an unexpected throw from the metadata store',
      status: 500,
      code: 'INTERNAL',
      run: async () => {
        const routes = mount(await tmpAdapter(), explodingStore);
        return drive(routes, 'GET', `${BASE}/files/:fileId/url`, { params: { fileId: 'whatever' } });
      },
    },
  ];

  for (const c of CASES) {
    it(`${c.name} → ${c.status} ${c.code}, in the declared envelope`, async () => {
      const { status, body } = await c.run();
      expect(status).toBe(c.status);

      // The contract itself, imported — not a restatement of it.
      const parsed = BaseResponseSchema.safeParse(body);
      expect(parsed.success, `body is not a BaseResponse: ${JSON.stringify(body)}`).toBe(true);

      expect(body.success).toBe(false);
      expect(body.error.code).toBe(c.code);
      expect(typeof body.error.message).toBe('string');
      expect(body.error.message.length).toBeGreaterThan(0);

      // The pre-#3675 shapes, explicitly dead: `error` is no longer a bare
      // string, and the code is no longer a SIBLING of `error`.
      expect(typeof body.error).not.toBe('string');
      expect(body.code).toBeUndefined();
    });
  }

  it('routes every error through `sendError` — no route may reintroduce the bare shape', () => {
    // Comments stripped first: this file's own prose quotes both the old and
    // the new shape, and a doc comment is not a code path.
    const source = readFileSync(new URL('./storage-routes.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    // `res.status(…).json({ error…` was the bare-shape idiom. Any reappearance
    // means a new route bypassed the helper.
    const bare = [...source.matchAll(/res\s*\.\s*status\([^)]*\)\s*\.\s*json\(\s*\{\s*error/g)];
    expect(bare, `bare error bodies found: ${bare.map((m) => m[0]).join(', ')}`).toHaveLength(0);

    // And the helper is the only place that builds one, so the shape lives in
    // exactly one line of this package.
    const builders = [...source.matchAll(/success:\s*false/g)];
    expect(builders).toHaveLength(1);
  });
});
