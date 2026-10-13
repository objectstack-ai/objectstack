// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A presigned token the local adapter will not honour is refused on BOTH
 * `_local/raw/:token` byte routes with the ADR-0112 envelope the published
 * `INVALID_TOKEN` entry declares: `401`, `error.code: 'INVALID_TOKEN'`, and one
 * message for every case, so the answer never tells a forger which check
 * failed. A genuine fault behind a valid token stays `500 INTERNAL`, whatever
 * its text says.
 *
 * Each case is driven through both compositions a host can mount: the bare
 * `LocalStorageAdapter`, and the `SwappableStorageService` wrapper the storage
 * plugin hands the routes, whose `verifyToken` passes the adapter's throw
 * through.
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { LocalStorageAdapter, STORAGE_TOKEN_REFUSAL_MESSAGE } from './local-storage-adapter.js';
import { SwappableStorageService } from './swappable-storage-service.js';
import { StorageMetadataStore } from './metadata-store.js';
import { registerStorageRoutes } from './storage-routes.js';

const BASE = '/api/v1/storage';
const SECRET = 'raw-token-refusal-secret';

type Verb = 'put' | 'get';
type Method = 'PUT' | 'GET';

const VERB: Record<Method, Verb> = { PUT: 'put', GET: 'get' };

function signed(payload: object): string {
  const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${b64}.${createHmac('sha256', SECRET).update(b64).digest('base64url')}`;
}

const inTenMinutes = () => Math.floor(Date.now() / 1000) + 600;

/** Every way `verifyToken` refuses a token, each built for the verb of the route under test. */
const REFUSED_TOKENS: Record<string, (verb: Verb) => string> = {
  malformed: () => 'not-a-presigned-token',
  forged: (verb) => {
    const b64 = Buffer.from(JSON.stringify({ k: 'victim/key.bin', exp: inTenMinutes(), op: verb })).toString('base64url');
    return `${b64}.${createHmac('sha256', 'a-guessed-secret').update(b64).digest('base64url')}`;
  },
  expired: (verb) => signed({ k: 'key.bin', exp: Math.floor(Date.now() / 1000) - 60, op: verb }),
  'minted for the other verb': (verb) => signed({ k: 'key.bin', exp: inTenMinutes(), op: verb === 'put' ? 'get' : 'put' }),
  'signed but unreadable payload': () => {
    const b64 = Buffer.from('not json', 'utf8').toString('base64url');
    return `${b64}.${createHmac('sha256', SECRET).update(b64).digest('base64url')}`;
  },
};

const roots: string[] = [];

async function adapter(): Promise<LocalStorageAdapter> {
  const rootDir = join(tmpdir(), `os-raw-token-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(rootDir, { recursive: true });
  roots.push(rootDir);
  return new LocalStorageAdapter({ rootDir, signingSecret: SECRET });
}

afterAll(async () => {
  await Promise.all(roots.map((r) => fs.rm(r, { recursive: true, force: true })));
});

/** The adapter's byte calls, counted, so a refusal can be shown to have touched no bytes. */
function countBytes(local: LocalStorageAdapter): { calls: number } {
  const counter = { calls: 0 };
  const upload = local.upload.bind(local);
  const download = local.download.bind(local);
  local.upload = async (...args) => { counter.calls++; return upload(...args); };
  local.download = async (...args) => { counter.calls++; return download(...args); };
  return counter;
}

function mount(storage: unknown): Map<string, RouteHandler> {
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
  registerStorageRoutes(http as any, storage as any, new StorageMetadataStore(null), { basePath: BASE });
  return routes;
}

async function drive(routes: Map<string, RouteHandler>, method: Method, token: string): Promise<{ status: number; body: any }> {
  const handler = routes.get(`${method}:${BASE}/_local/raw/:token`);
  if (!handler) throw new Error(`no handler for ${method} ${BASE}/_local/raw/:token`);
  const captured = { status: 200, body: undefined as any };
  const res: any = {
    json(data: any) { captured.body = data; },
    send() {},
    status(code: number) { captured.status = code; return res; },
    header() { return res; },
  };
  await handler(
    {
      params: { token },
      query: {},
      headers: {},
      method,
      path: `${BASE}/_local/raw/${token}`,
      rawBody: async () => Buffer.from('bytes'),
    } as unknown as IHttpRequest,
    res as IHttpResponse,
  );
  return captured;
}

const COMPOSITIONS: Record<string, (local: LocalStorageAdapter) => unknown> = {
  'the bare local adapter': (local) => local,
  'the swappable wrapper the storage plugin mounts': (local) => new SwappableStorageService(local),
};

describe('_local/raw/:token — a refused token answers 401 INVALID_TOKEN, undistinguished', () => {
  for (const [composition, compose] of Object.entries(COMPOSITIONS)) {
    describe(composition, () => {
      for (const method of ['PUT', 'GET'] as const) {
        for (const [refusal, tokenFor] of Object.entries(REFUSED_TOKENS)) {
          it(`${method}: a ${refusal} token`, async () => {
            const local = await adapter();
            const bytes = countBytes(local);
            const res = await drive(mount(compose(local)), method, tokenFor(VERB[method]));

            expect(res.status).toBe(401);
            expect(res.body?.success).toBe(false);
            expect(res.body?.error?.code).toBe('INVALID_TOKEN');
            expect(res.body?.error?.message).toBe(STORAGE_TOKEN_REFUSAL_MESSAGE);
            expect(bytes.calls).toBe(0);
          });
        }

        it(`${method}: every refusal carries the identical message`, async () => {
          const routes = mount(compose(await adapter()));
          const messages = new Set<string>();
          for (const tokenFor of Object.values(REFUSED_TOKENS)) {
            messages.add((await drive(routes, method, tokenFor(VERB[method]))).body?.error?.message);
          }
          expect([...messages]).toEqual([STORAGE_TOKEN_REFUSAL_MESSAGE]);
        });
      }
    });
  }
});

describe('_local/raw/:token — a 5xx withholds its own text from the caller, and the server log keeps it', () => {
  const FAULT_TEXT = 'adapter fault at /srv/storage-root/tenant-a/private/report.bin';
  const PATH_LIKE = '/srv/storage-root/tenant-a/private/report.bin';

  for (const method of ['PUT', 'GET'] as const) {
    it(`${method}: the body carries the route's generic text, never the fault's`, async () => {
      const local = await adapter();
      local.upload = async () => { throw new Error(FAULT_TEXT); };
      local.download = async () => { throw new Error(FAULT_TEXT); };
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const res = await drive(mount(local), method, signed({ k: 'key.bin', exp: inTenMinutes(), op: VERB[method] }));

        expect(res.status).toBe(500);
        expect(res.body?.success).toBe(false);
        expect(res.body?.error?.code).toBe('INTERNAL');
        expect(JSON.stringify(res.body)).not.toContain(PATH_LIKE);
        // The operator still reads it: the server-fault line carries the original.
        expect(logged.mock.calls.some((call) => call.some((arg) => String(arg).includes(PATH_LIKE)))).toBe(true);
      } finally {
        logged.mockRestore();
      }
    });
  }
});

describe('_local/raw/:token — a genuine fault behind a valid token stays 500 INTERNAL', () => {
  // The second text is the one a message-reading classifier would have taken
  // for a refused token.
  for (const text of ['disk fault', 'upstream certificate signature expired']) {
    for (const method of ['PUT', 'GET'] as const) {
      it(`${method}: an adapter fault reading "${text}"`, async () => {
        const local = await adapter();
        local.upload = async () => { throw new Error(text); };
        local.download = async () => { throw new Error(text); };
        const res = await drive(mount(local), method, signed({ k: 'key.bin', exp: inTenMinutes(), op: VERB[method] }));

        expect(res.status).toBe(500);
        expect(res.body?.success).toBe(false);
        expect(res.body?.error?.code).toBe('INTERNAL');
      });
    }
  }
});
