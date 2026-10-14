// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23367, ruling A item 3] The parent-governed DOWNLOAD door answers a key
 * its own lifecycle refuses with that refusal's 403 and ledger code.
 *
 * ## What is pinned, through the booted plugin's own authorizer
 *
 *  - a revoked key → `403 API_KEY_REVOKED`, and NO capability is minted;
 *  - an expired key → `403 API_KEY_EXPIRED`, same;
 *  - an unknown key is no lifecycle refusal: the door's generic
 *    `401 AUTH_REQUIRED`, nothing minted;
 *  - control: the same key, live, gets its signed URL.
 *
 * The path: `buildFileReadAuthorizer` re-raises the branded
 * `ApiKeyLifecycleRefusalError` beside the store outage, and the download
 * gate (`authorizeDownload`, `storage-routes.ts`) relays it beside the outage
 * relay. The fixture is `file-read-tenancy-posture-admission.test.ts`'s,
 * reduced to one reachable field-owned file and no tenancy service.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ObjectKernel, hashApiKey } from '@objectstack/core';
import type { PluginContext } from '@objectstack/core';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { StorageServicePlugin } from './storage-service-plugin.js';

const KEY_LIVE = 'osk_23367_live';
const KEY_REVOKED = 'osk_23367_revoked';
const KEY_EXPIRED = 'osk_23367_expired';

const BASE_PATH = '/api/v1/storage';
const FILE_ID = 'file_23367';

/**
 * Equality plus `$in` — the two shapes the shared resolver issues — refusing
 * every other shape loudly, so a combinator it does not implement can never
 * read as a field that happened not to match.
 */
function matchesWhere(row: Record<string, unknown>, where: unknown): boolean {
  for (const [field, cond] of Object.entries((where ?? {}) as Record<string, unknown>)) {
    if (field.startsWith('$')) {
      throw new Error(`fixture where-matcher: unsupported combinator '${field}'`);
    }
    if (cond !== null && typeof cond === 'object') {
      const ops = Object.keys(cond as object);
      const inList = (cond as { $in?: unknown }).$in;
      if (ops.length !== 1 || ops[0] !== '$in' || !Array.isArray(inList)) {
        throw new Error(`fixture where-matcher: unsupported operator shape on '${field}'`);
      }
      if (!inList.includes(row[field])) return false;
      continue;
    }
    if (row[field] !== cond) return false;
  }
  return true;
}

/** `owner_id` is a user nobody holds a key for, so the uploader shortcut is never what an arm travels through. */
function makeEngine() {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    sys_api_key: [
      { id: 'key_live', key: hashApiKey(KEY_LIVE), prefix: 'osk_23367_li', user_id: 'u_holder', revoked: false, expires_at: '2999-01-01T00:00:00.000Z' },
      { id: 'key_revoked', key: hashApiKey(KEY_REVOKED), prefix: 'osk_23367_re', user_id: 'u_holder', revoked: true },
      { id: 'key_expired', key: hashApiKey(KEY_EXPIRED), prefix: 'osk_23367_ex', user_id: 'u_holder', revoked: false, expires_at: '2000-01-01T00:00:00.000Z' },
    ],
    sys_user: [{ id: 'u_holder', email: 'u_holder@example.com' }],
    sys_file: [
      {
        id: FILE_ID,
        key: 'files/23367.pdf',
        name: '23367.pdf',
        mime_type: 'application/pdf',
        size: 12,
        scope: 'record',
        status: 'committed',
        acl: 'private',
        owner_id: 'u_uploader',
        ref_object: 'contract',
        ref_id: 'rec_open',
        ref_field: 'attachment',
      },
    ],
  };
  return {
    find: async (object: string, q: Record<string, unknown> = {}) => {
      if (object === 'contract') {
        const context = (q.context ?? {}) as { userId?: string };
        return context.userId === 'u_holder' ? [{ id: 'rec_open' }] : [];
      }
      const rows = (tables[object] ?? []).filter((row) => matchesWhere(row, q.where));
      return typeof q.limit === 'number' ? rows.slice(0, q.limit) : rows;
    },
    findOne: async (object: string, q: Record<string, unknown> = {}) => {
      const rows = (tables[object] ?? []).filter((row) => matchesWhere(row, q.where));
      return rows[0] ?? null;
    },
  };
}

function makeRes() {
  const answer = { status: 200, json: undefined as Record<string, any> | undefined };
  const api = {
    json(data: Record<string, unknown>) { answer.json = data; return api; },
    send() { return api; },
    status(code: number) { answer.status = code; return api; },
    header() { return api; },
  };
  return { res: api as unknown as IHttpResponse, answer };
}

let rootDirs: string[] = [];
let warnSpy: ReturnType<typeof vi.spyOn>;

async function mount() {
  const rootDir = join(tmpdir(), `os-23367-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(rootDir, { recursive: true });
  rootDirs.push(rootDir);

  const routes = new Map<string, RouteHandler>();
  const httpServer = {
    get: (path: string, handler: RouteHandler) => { routes.set(`GET:${path}`, handler); },
    post: (path: string, handler: RouteHandler) => { routes.set(`POST:${path}`, handler); },
    put: (path: string, handler: RouteHandler) => { routes.set(`PUT:${path}`, handler); },
    delete: () => {},
    patch: () => {},
    use: () => {},
    listen: async () => {},
    close: async () => {},
  };
  const services = new Map<string, unknown>();
  services.set('objectql', makeEngine());
  services.set('http-server', httpServer);
  // No session path: this pin is about API keys.
  services.set('auth', { api: { getSession: async () => undefined } });

  const readyHooks: Array<() => Promise<void> | void> = [];
  // A real kernel with no `tenancy` registered: the branded "never
  // registered" answer, so no posture refusal can be what an arm rides on.
  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as never);
  const ctx = {
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    registerService: (name: string, svc: unknown) => { services.set(name, svc); },
    getService: (name: string) => {
      const s = services.get(name);
      if (!s) throw new Error(`service '${name}' not registered`);
      return s;
    },
    hook: (event: string, fn: () => Promise<void> | void) => {
      if (event === 'kernel:ready') readyHooks.push(fn);
    },
    getKernel: () => kernel,
  } as unknown as PluginContext;

  const plugin = new StorageServicePlugin({
    adapter: 'local',
    basePath: BASE_PATH,
    local: { rootDir, signingSecret: 'test-secret-23367' },
    bindToSettings: false,
  });
  await plugin.init(ctx);
  await plugin.start(ctx);
  for (const hook of readyHooks) await hook();

  const storage = services.get('storage') as {
    getPresignedDownload: (key: string, ttl: number, opts?: unknown) => Promise<unknown>;
  };
  const mintSpy = vi.spyOn(storage, 'getPresignedDownload');
  const path = `${BASE_PATH}/files/:fileId/url`;
  const handler = routes.get(`GET:${path}`);
  if (!handler) throw new Error(`fixture: no handler registered for GET ${path}`);

  return {
    call: async (rawKey: string) => {
      const { res, answer } = makeRes();
      await handler(
        { params: { fileId: FILE_ID }, query: {}, body: undefined, headers: { 'x-api-key': rawKey }, method: 'GET', path } as unknown as IHttpRequest,
        res,
      );
      return answer;
    },
    minted: () => mintSpy.mock.calls.length,
  };
}

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  warnSpy.mockRestore();
  vi.restoreAllMocks();
  for (const dir of rootDirs) await fs.rm(dir, { recursive: true, force: true });
  rootDirs = [];
});

describe('[#23367] the download door answers a key its lifecycle refuses with its own 403 and code', () => {
  it('a revoked key: 403 API_KEY_REVOKED, and no capability is minted', async () => {
    const h = await mount();
    const res = await h.call(KEY_REVOKED);
    expect(res.status).toBe(403);
    expect(res.json?.success).toBe(false);
    expect(res.json?.error?.code).toBe('API_KEY_REVOKED');
    expect(h.minted()).toBe(0);
  });

  it('an expired key: 403 API_KEY_EXPIRED, and no capability is minted', async () => {
    const h = await mount();
    const res = await h.call(KEY_EXPIRED);
    expect(res.status).toBe(403);
    expect(res.json?.error?.code).toBe('API_KEY_EXPIRED');
    expect(h.minted()).toBe(0);
  });

  it('an unknown key is no lifecycle refusal: the generic 401 AUTH_REQUIRED, nothing minted', async () => {
    const h = await mount();
    const res = await h.call('osk_never_issued');
    expect(res.status).toBe(401);
    expect(res.json?.error?.code).toBe('AUTH_REQUIRED');
    expect(h.minted()).toBe(0);
  });

  it('control: the same door serves a live key its signed URL', async () => {
    const h = await mount();
    const res = await h.call(KEY_LIVE);
    expect(res.status).toBe(200);
    expect(h.minted()).toBe(1);
  });
});
