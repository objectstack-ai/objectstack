// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0069 — the storage family refuses a session the authentication policy
 * HOLDS (an expired password, enforced MFA not yet enrolled) with the REST
 * seam's answer, on every route — the two raw-transfer token routes included —
 * before any of the family's own logic runs.
 *
 * ## What was open
 *
 * The storage routes read the caller's session for the upload and download
 * gates and never asked the ADR-0069 gate about it. The posture rides on the
 * session user (`user.authGate`, set by plugin-auth's `customSession`
 * enrichment), so a held session uploaded and downloaded as an ordinary
 * signed-in caller — measured on a serve-shaped boot before this change, where
 * REST's `enforceAuth` and the dispatcher answer the same session `403` with
 * the gate's `code`.
 *
 * ## Driven through the composition
 *
 * The gate is bound in `composeStorageRoutes` with every other storage gate,
 * so this file mounts the family through the public host door
 * `mountStorageRoutes` over a real `ObjectKernel` — the same composition the
 * plugin's own mount calls. The census is read off that mount, with a count.
 *
 * ## What each refusal asserts
 *
 * The ADR-0112 envelope — `status` AND `error.code` — plus the gate's own
 * message, and a storage adapter that was never touched.
 *
 * ## Controls
 *
 * The same caller un-held gets, on every route, the answer a mount with no
 * active gate gives; the gate's outage arm (active, session unreadable) is the
 * `503` REST gives; and the family registers nothing a CORS preflight reaches.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ObjectKernel } from '@objectstack/core';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { mountStorageRoutes } from './mount-storage-routes.js';
import { STORAGE_ROUTE_LEDGER } from './storage-route-ledger.js';

const BASE = '/api/v1/storage';

/** The gate postures plugin-auth's enrichment writes, one per policy. */
const POSTURES: Record<string, { code: string; message: string }> = {
  PASSWORD_EXPIRED: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired. Please change it to continue.' },
  MFA_REQUIRED: {
    code: 'MFA_REQUIRED',
    message: 'Multi-factor authentication is required. Please set up an authenticator app to continue.',
  },
};

/**
 * The host's auth, reduced to what the gates read: a session per `x-test-user`
 * header, held when `x-test-hold` names a posture (the session user then
 * carries `authGate` exactly as `customSession` attaches it). `gate` is what
 * `isAuthGateActive()` answers; `'throws'` makes an active gate's session read
 * fail.
 */
function makeAuth(gate: 'active' | 'inactive' | 'throws') {
  return {
    isAuthGateActive: () => gate !== 'inactive',
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        if (gate === 'throws') throw new Error('session store unreachable');
        const userId = headers.get('x-test-user');
        if (!userId) return undefined;
        const authGate = POSTURES[headers.get('x-test-hold') ?? ''];
        return { user: { id: userId, ...(authGate ? { authGate } : {}) }, session: {} };
      },
    },
  };
}

/** The host's route table — and proof nothing else was registered. */
function makeRouteCollector() {
  const routes = new Map<string, RouteHandler>();
  const other: string[] = [];
  const http = {
    get: (path: string, handler: RouteHandler) => { routes.set(`GET ${path}`, handler); },
    post: (path: string, handler: RouteHandler) => { routes.set(`POST ${path}`, handler); },
    put: (path: string, handler: RouteHandler) => { routes.set(`PUT ${path}`, handler); },
    delete: (path: string) => { other.push(`DELETE ${path}`); },
    patch: (path: string) => { other.push(`PATCH ${path}`); },
    use: () => { other.push('use'); },
    listen: async () => {},
    close: async () => {},
  };
  return { http, routes, other };
}

let rootDirs: string[] = [];

afterEach(async () => {
  for (const dir of rootDirs) await fs.rm(dir, { recursive: true, force: true });
  rootDirs = [];
});

/** The storage adapter, every method call recorded. */
async function makeStorage() {
  const rootDir = join(tmpdir(), `os-23178-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(rootDir, { recursive: true });
  rootDirs.push(rootDir);
  const adapter = new LocalStorageAdapter({ rootDir, signingSecret: 'test-secret-23178' });
  const calls: string[] = [];
  const storage = new Proxy(adapter, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function'
        ? (...args: unknown[]) => { calls.push(String(prop)); return value.apply(target, args); }
        : value;
    },
  });
  return { storage, calls };
}

async function mount(gate: 'active' | 'inactive' | 'throws') {
  const { storage, calls } = await makeStorage();
  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as never);
  kernel.registerService('storage', storage);
  kernel.registerService('auth', makeAuth(gate));
  const { http, routes, other } = makeRouteCollector();
  mountStorageRoutes(http, kernel, { basePath: BASE, logger: { info: () => {}, warn: () => {} } });
  calls.length = 0;
  return { routes, other, calls };
}

/** A concrete request for each registered pattern. */
const PARAMS: Record<string, string> = { uploadId: 'up_23178', chunkIndex: '0', fileId: 'file_23178', token: 'tok_23178' };

async function drive(
  routes: Map<string, RouteHandler>,
  key: string,
  headers: Record<string, string>,
  body: unknown = {},
) {
  const handler = routes.get(key);
  if (!handler) throw new Error(`no handler for ${key}`);
  const method = key.slice(0, key.indexOf(' '));
  const path = key.slice(key.indexOf(' ') + 1);
  const params: Record<string, string> = {};
  for (const seg of path.split('/')) if (seg.startsWith(':')) params[seg.slice(1)] = PARAMS[seg.slice(1)] ?? 'x';
  const captured: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    json(data: unknown) { captured.body = data; return res; },
    send() { return res; },
    status(code: number) { captured.status = code; return res; },
    header() { return res; },
  };
  await handler(
    { params, query: {}, body: method === 'GET' ? undefined : body, headers, method, path } as unknown as IHttpRequest,
    res as IHttpResponse,
  );
  return { status: captured.status, code: captured.body?.error?.code as string | undefined, body: captured.body };
}

const UNHELD = { 'x-test-user': 'u_member' };
const held = (posture: string) => ({ 'x-test-user': 'u_member', 'x-test-hold': posture });

describe('the storage census — read off the composed mount', () => {
  it('mounts exactly ten routes, the ledgered ones, and nothing a preflight or another verb could reach', async () => {
    const { routes, other } = await mount('active');
    // ⭐ A count, on purpose: an eleventh route has to come through this file.
    expect(routes.size).toBe(10);
    expect([...routes.keys()].sort()).toEqual(STORAGE_ROUTE_LEDGER.map((row) => row.route).sort());
    // No OPTIONS route, no middleware: a CORS preflight is the host's answer, held or not.
    expect(other).toEqual([]);
  });
});

describe('ADR-0069 — a held session is refused 403 with the gate code on every route, before storage is touched', () => {
  const census = STORAGE_ROUTE_LEDGER.map((row) => row.route);
  for (const posture of Object.keys(POSTURES)) {
    it.each(census)(`%s · held by ${posture} → 403 ${posture}`, async (key) => {
      const { routes, calls } = await mount('active');
      const answer = await drive(routes, key, held(posture));
      expect(answer.status).toBe(403);
      expect(answer.body?.success).toBe(false);
      expect(answer.code).toBe(posture);
      expect(answer.body?.error?.message).toBe(POSTURES[posture]!.message);
      expect(answer.body?.data).toBeUndefined();
      expect(calls).toEqual([]);
    });
  }
});

describe('CONTROL — the same caller un-held gets what a mount with no active gate gives', () => {
  const census = STORAGE_ROUTE_LEDGER.map((row) => row.route);
  it.each(census)('%s · un-held, gate active === un-held, gate inactive', async (key) => {
    const gated = await mount('active');
    const open = await mount('inactive');
    const a = await drive(gated.routes, key, UNHELD);
    const b = await drive(open.routes, key, UNHELD);
    expect({ status: a.status, code: a.code }).toEqual({ status: b.status, code: b.code });
    expect(a.code).not.toBe('PASSWORD_EXPIRED');
  });

  it('non-vacuity: an un-held member is SERVED a presigned upload through the gated mount', async () => {
    const { routes, calls } = await mount('active');
    const answer = await drive(routes, `POST ${BASE}/upload/presigned`, UNHELD, {
      filename: 'a.txt', mimeType: 'text/plain', size: 3,
    });
    expect(answer.status).toBe(200);
    expect(answer.body?.success).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe('CONTROL — an active gate whose session read fails is the outage REST answers, never an admission', () => {
  it.each(STORAGE_ROUTE_LEDGER.map((row) => row.route))('%s · gate active, session unreadable → 503 SERVICE_UNAVAILABLE', async (key) => {
    const { routes, calls } = await mount('throws');
    const answer = await drive(routes, key, held('PASSWORD_EXPIRED'));
    expect(answer.status).toBe(503);
    expect(answer.code).toBe('SERVICE_UNAVAILABLE');
    expect(calls).toEqual([]);
  });
});
