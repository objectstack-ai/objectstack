// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0069 — the share-link family refuses a session the authentication
 * policy HOLDS (an expired password, enforced MFA not yet enrolled) with the
 * REST seam's answer, on every route — the two token routes included — before
 * any of the family's own logic runs.
 *
 * ## What was open
 *
 * The family's context resolver read the caller's session and never carried
 * its ADR-0069 posture (`user.authGate`, set by plugin-auth's `customSession`
 * enrichment), and the routes never asked about one, so a held session listed,
 * created and revoked links and resolved tokens as an ordinary signed-in
 * caller — measured on a serve-shaped boot before this change, where REST's
 * `enforceAuth` and the dispatcher (whose twin of these five routes is gated)
 * answer the same session `403` with the gate's `code`.
 *
 * ## Two halves, both pinned
 *
 * 1. The DOOR (`registerShareLinkRoutes`): every route is captured off a mock
 *    `IHttpServer` as the registrar registers it, with a count, and driven
 *    with a context carrying `authGate` — the declared envelope field the door
 *    reads, as REST's `enforceAuth` reads it.
 * 2. The PRODUCER (`SharingServicePlugin`): the plugin's own resolver, booted,
 *    puts the session user's posture on that envelope, so a held session
 *    reaching the mounted routes is refused end to end.
 *
 * ## What each refusal asserts
 *
 * The ADR-0112 envelope — `status` AND `error.code` — plus the gate's own
 * message, and a service and engine that were never called. The token routes
 * also keep their no-store response headers on the refusal.
 *
 * ## Controls
 *
 * The same caller un-held is served every route as before, and the family
 * registers nothing a CORS preflight could reach.
 */

import { describe, expect, it, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import type { PluginContext } from '@objectstack/core';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { registerShareLinkRoutes } from './share-link-routes.js';
import { SharingServicePlugin } from './sharing-plugin.js';
import type { ShareLinkService } from './share-link-service.js';
import type { SharingEngine } from './sharing-service.js';

const BASE = '/api/v1/share-links';

/** The gate postures plugin-auth's enrichment writes, one per policy. */
const PASSWORD_EXPIRED = { code: 'PASSWORD_EXPIRED' as const, message: 'Your password has expired. Please change it to continue.' };
const MFA_REQUIRED = {
  code: 'MFA_REQUIRED' as const,
  message: 'Multi-factor authentication is required. Please set up an authenticator app to continue.',
};

class MockHttp implements IHttpServer {
  routes = new Map<string, RouteHandler>();
  middleware: unknown[] = [];
  private add(method: string, path: string, handler: RouteHandler) {
    this.routes.set(`${method} ${path}`, handler);
  }
  get(path: string, h: RouteHandler) { this.add('GET', path, h); return this as any; }
  post(path: string, h: RouteHandler) { this.add('POST', path, h); return this as any; }
  put(path: string, h: RouteHandler) { this.add('PUT', path, h); return this as any; }
  delete(path: string, h: RouteHandler) { this.add('DELETE', path, h); return this as any; }
  patch(path: string, h: RouteHandler) { this.add('PATCH', path, h); return this as any; }
  use(...args: unknown[]) { this.middleware.push(args); return this as any; }
  listen() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  getInstance() { return null; }
}

const LINK_ROW = {
  id: 'sl_1',
  token: 'tok_abcdefgh',
  object_name: 'ai_conversations',
  record_id: 'conv_1',
  permission: 'view',
  audience: 'anyone',
  expires_at: null,
  label: 'For the auditor',
  created_at: '2026-01-01T00:00:00.000Z',
};

/** A service and engine that would SUCCEED on every route, recording every call. */
function mount(contextFromRequest: (req: IHttpRequest) => ExecutionContext | Promise<ExecutionContext>) {
  const service = {
    createLink: vi.fn(async () => ({ ...LINK_ROW })),
    listLinks: vi.fn(async () => [{ ...LINK_ROW }]),
    revokeLink: vi.fn(async () => undefined),
    resolveToken: vi.fn(async () => ({ link: { ...LINK_ROW }, redactFields: [] })),
  };
  const engine = {
    find: vi.fn(async () => [{ id: 'conv_1', title: 'Shared' }]),
    getSchema: vi.fn(() => undefined),
    insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
  };
  const http = new MockHttp();
  registerShareLinkRoutes(http, service as unknown as ShareLinkService, engine as unknown as SharingEngine, {
    contextFromRequest,
  });
  const calls = () => [
    ...Object.entries(service).filter(([, fn]) => fn.mock.calls.length > 0).map(([n]) => `service.${n}`),
    ...(engine.find.mock.calls.length > 0 ? ['engine.find'] : []),
  ];
  return { http, calls };
}

/** One case per route: the request, and what an un-held signed-in caller gets. */
const CASES: Record<string, { params?: Record<string, string>; body?: unknown; okStatus: number; publicRoute?: boolean }> = {
  [`POST ${BASE}`]: { body: { object: 'ai_conversations', recordId: 'conv_1' }, okStatus: 201 },
  [`GET ${BASE}`]: { okStatus: 200 },
  [`DELETE ${BASE}/:idOrToken`]: { params: { idOrToken: 'sl_1' }, okStatus: 200 },
  [`GET ${BASE}/:token/resolve`]: { params: { token: 'tok_abcdefgh' }, okStatus: 200, publicRoute: true },
  [`GET ${BASE}/:token/messages`]: { params: { token: 'tok_abcdefgh' }, okStatus: 200, publicRoute: true },
};

async function drive(http: MockHttp, key: string) {
  const c = CASES[key]!;
  const handler = http.routes.get(key);
  if (!handler) throw new Error(`no handler for ${key}`);
  const captured: { status: number; body: any; headers: Record<string, string> } = { status: 200, body: undefined, headers: {} };
  const res: IHttpResponse = {
    json: vi.fn((data: any) => { captured.body = data; }) as any,
    send: vi.fn() as any,
    status: vi.fn((code: number) => { captured.status = code; return res; }) as any,
    header: vi.fn((name: string, value: string) => { captured.headers[name] = value; return res; }) as any,
  };
  const req = {
    params: c.params ?? {},
    query: {},
    body: c.body,
    headers: {},
    method: key.slice(0, key.indexOf(' ')),
    path: key.slice(key.indexOf(' ') + 1),
  } as unknown as IHttpRequest;
  await handler(req, res);
  return captured;
}

const census = [...mount(() => ({})).http.routes.keys()];

describe('the share-link census — read off the registration', () => {
  it('registers exactly five routes, every one has a case below, and no middleware or preflight route', () => {
    const { http } = mount(() => ({}));
    // ⭐ A count, on purpose: a sixth route has to come through this file.
    expect(census).toHaveLength(5);
    expect([...census].sort()).toEqual(Object.keys(CASES).sort());
    // Nothing here a CORS preflight could reach: no OPTIONS route and no
    // middleware, so a preflight is the host's answer, held or not.
    expect(census.filter((k) => k.startsWith('OPTIONS '))).toEqual([]);
    expect(http.middleware).toEqual([]);
  });
});

describe('ADR-0069 door — a held session is refused 403 with the gate code on every route', () => {
  const HELD: Array<[string, ExecutionContext]> = [
    ['held by password expiry', { userId: 'u_1', tenantId: 't_1', authGate: PASSWORD_EXPIRED }],
    ['held by enforced MFA', { userId: 'u_1', tenantId: 't_1', authGate: MFA_REQUIRED }],
  ];
  for (const [name, ctx] of HELD) {
    it.each(census)(`%s · ${name} → 403 with the gate code, nothing reached`, async (key) => {
      const { http, calls } = mount(() => ctx);
      const answer = await drive(http, key);
      expect(answer.status).toBe(403);
      expect(answer.body?.success).toBe(false);
      expect(answer.body?.error?.code).toBe(ctx.authGate!.code);
      expect(answer.body?.error?.message).toBe(ctx.authGate!.message);
      expect(answer.body?.data).toBeUndefined();
      expect(calls()).toEqual([]);
      if (CASES[key]!.publicRoute) expect(answer.headers['Cache-Control']).toBe('no-store');
    });
  }
});

describe('CONTROL — the same caller un-held is served as before', () => {
  it.each(census)('%s · signed in, un-held → its own success status', async (key) => {
    const { http, calls } = mount(() => ({ userId: 'u_1', tenantId: 't_1' }));
    const answer = await drive(http, key);
    expect(answer.status).toBe(CASES[key]!.okStatus);
    expect(answer.body?.success).toBe(true);
    expect(calls().length).toBeGreaterThan(0);
  });
});

// ── The producer half: the plugin's own resolver carries the posture ─────────

interface Session { user: Record<string, unknown>; session: { userId: string } }

async function bootPlugin(session: () => Session | undefined) {
  const http = new MockHttp();
  const engine = {
    async find() { return []; },
    async insert(_o: string, row: any) { return row; },
    getSchema(object: string) { return { name: object }; },
  };
  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as any);
  const hooks: Record<string, Array<() => Promise<void> | void>> = {};
  const ctx = {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    hook: (event: string, handler: () => Promise<void> | void) => { (hooks[event] ??= []).push(handler); },
    getService: <T>(name: string): T => {
      if (name === 'objectql') return engine as unknown as T;
      if (name === 'http.server') return http as unknown as T;
      if (name === 'auth') return { api: { getSession: async () => session() } } as unknown as T;
      return kernel.getService<T>(name);
    },
    registerService: vi.fn(),
    getKernel: () => kernel,
  };
  const plugin = new SharingServicePlugin({ enforce: false });
  await plugin.start(ctx as unknown as PluginContext);
  for (const handler of hooks['kernel:ready'] ?? []) await handler();
  return http;
}

describe('ADR-0069 producer — SharingServicePlugin carries the session posture to the door', () => {
  it('a held session reaching the mounted list route is refused 403 PASSWORD_EXPIRED', async () => {
    const http = await bootPlugin(() => ({
      user: { id: 'u_held', authGate: PASSWORD_EXPIRED },
      session: { userId: 'u_held' },
    }));
    const answer = await drive(http, `GET ${BASE}`);
    expect(answer.status).toBe(403);
    expect(answer.body?.error?.code).toBe('PASSWORD_EXPIRED');
    expect(answer.body?.error?.message).toBe(PASSWORD_EXPIRED.message);
  });

  it('CONTROL — the same session un-held lists its links', async () => {
    const http = await bootPlugin(() => ({ user: { id: 'u_held' }, session: { userId: 'u_held' } }));
    const answer = await drive(http, `GET ${BASE}`);
    expect(answer.status).toBe(200);
    expect(answer.body?.success).toBe(true);
  });
});
