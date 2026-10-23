// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0069 — the settings route family refuses a session the authentication
 * policy HOLDS (an expired password, enforced MFA not yet enrolled) with `403`
 * and the gate's own `code` and `message`, on every route, before any settings
 * logic runs.
 *
 * ## What was open
 *
 * `registerSettingsRoutes` mounts its routes straight on the host server and
 * resolves its own caller (`contextFromRequest`), so neither REST's
 * `enforceAuth` nor the dispatcher ever asked the gate for it. A held session
 * was answered as an ordinary signed-in caller. The family door could read the
 * posture only through the exported `SettingsContext`, which declared none.
 *
 * ## What is pinned, in four parts
 *
 * 1. **The census**, read off the registration with a count, as the anonymous
 *    floor's pin reads it: a route added later is driven held the day it
 *    lands. Only `GET` / `PUT` / `POST` routes and no middleware are
 *    registered, so a CORS preflight never reaches the door and stays the
 *    host's answer.
 * 2. **The door, held.** A context carrying `authGate`, under both postures,
 *    is refused on every route: the ADR-0112 envelope (`status` + `error.code`)
 *    plus the gate's `message`, no `data`, and a service that was never
 *    reached. Also where the mount sits under an allow-listed name: the door
 *    asks the gate without the request path, so no mount can earn an
 *    exemption.
 * 3. **The door, un-held (CONTROL).** A host resolver that sets no `authGate`,
 *    the field being optional, is served exactly as before: `200`, and the
 *    service sees that very context.
 * 4. **The producer.** `SettingsServicePlugin`, booted for real, puts the
 *    session's posture on the context through the shared reader, with one
 *    session read per request, and every mounted route refuses the held
 *    session end to end. An un-held session's context carries no `authGate`.
 *
 * ⛔ Nothing here asserts `toThrow()`: the unrepaired family never threw — it
 * ANSWERED, with the ordinary signed-in answer. The claim is `status` + `code`.
 *
 * Routes are named by the service member their own work calls, read off a
 * served request below, never by a path typed here.
 */

import { describe, expect, it, vi } from 'vitest';
import { isAuthGateAllowlisted, normalizeAuthGate, ObjectKernel, type AuthGate } from '@objectstack/core';
import type { IHttpRequest, IHttpResponse, IHttpServer, RouteHandler } from '@objectstack/spec/contracts';
import { SETTINGS_ROUTE_LEDGER } from './settings-route-ledger.js';
import type { SettingsContext } from './settings-service.types.js';

// The producer half (part 4) reads the context the plugin's resolver builds,
// captured through a PASS-THROUGH of the real registration, as
// `in-process-session-read.pin.test.ts` captures it: the routes still mount,
// and every other part below drives the real registrar unchanged.
const captured = vi.hoisted(() => ({ contextFromRequest: undefined as
  | ((req: IHttpRequest) => SettingsContext | Promise<SettingsContext>)
  | undefined }));

vi.mock('./settings-routes.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./settings-routes.js')>();
  return {
    ...real,
    registerSettingsRoutes: (http: any, service: any, opts: any = {}) => {
      captured.contextFromRequest = opts.contextFromRequest;
      return real.registerSettingsRoutes(http, service, opts);
    },
  };
});

const { registerSettingsRoutes } = await import('./settings-routes.js');
const { SettingsServicePlugin } = await import('./settings-service-plugin.js');

type SettingsRoutesOptions = NonNullable<Parameters<typeof registerSettingsRoutes>[2]>;

const NS = 'branding';

/** The two postures plugin-auth's `customSession` enrichment writes. */
const POSTURES: readonly AuthGate[] = [
  { code: 'PASSWORD_EXPIRED', message: 'Your password has expired. Change it to continue.' },
  { code: 'MFA_REQUIRED', message: 'Two-factor authentication is required. Enroll to continue.' },
];

/** A signed-in caller holding every capability the family's routes ask for. */
const SIGNED_IN: SettingsContext = {
  enforced: true,
  userId: 'usr_admin',
  permissions: ['setup.access', 'setup.write', 'manage_platform_settings'],
};

const held = (gate: AuthGate): SettingsContext => ({ ...SIGNED_IN, authGate: gate });

interface Registered {
  verb: string;
  path: string;
  handler: RouteHandler;
}

/** Captures EVERY registration the registrar makes, whatever the verb. */
function capture(service: unknown, opts: SettingsRoutesOptions = {}) {
  const routes: Registered[] = [];
  const middleware: unknown[] = [];
  const add = (verb: string) => (path: string, handler: RouteHandler) => {
    routes.push({ verb, path, handler });
  };
  const http = {
    get: add('GET'),
    post: add('POST'),
    put: add('PUT'),
    delete: add('DELETE'),
    patch: add('PATCH'),
    options: add('OPTIONS'),
    use: (...args: unknown[]) => { middleware.push(args); },
    listen: async () => {},
    close: async () => {},
  };
  registerSettingsRoutes(http as any, service as any, opts);
  return { routes, middleware };
}

/**
 * A service any call into which is recorded, and fails. If a held request
 * reached it, the `calls` list says so and the answer is the route's `500`
 * tail, never the gate's `403` — so a door that let one through cannot pass.
 */
function untouchableService() {
  const calls: string[] = [];
  const service = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return undefined;
        return (..._args: unknown[]) => {
          calls.push(String(prop));
          throw new Error(`service.${String(prop)} was reached by a held session`);
        };
      },
    },
  );
  return { service, calls };
}

/**
 * A service that would SUCCEED for every route, recording the member each
 * route's own work called and the context it was handed. `secretKeysOf` is the
 * write route's redaction lookup, not its work, so it is not recorded.
 */
function permissiveService() {
  const seen: Array<{ member: string; ctx: SettingsContext }> = [];
  const service = {
    listManifests: (ctx: SettingsContext) => { seen.push({ member: 'listManifests', ctx }); return [{ namespace: NS }]; },
    getNamespace: async (_ns: string, ctx: SettingsContext) => {
      seen.push({ member: 'getNamespace', ctx });
      return { manifest: { namespace: NS }, values: {} };
    },
    // `ReadonlySet<string>` is the real shape the redaction helpers read.
    secretKeysOf: () => new Set<string>(),
    // The read route's live-status lookup — nothing to state here.
    liveStatusOf: async () => undefined,
    setMany: async (_ns: string, _values: unknown, ctx: SettingsContext) => {
      seen.push({ member: 'setMany', ctx });
      return {};
    },
    runAction: async (_ns: string, _id: string, _input: unknown, ctx: SettingsContext) => {
      seen.push({ member: 'runAction', ctx });
      return { ok: true };
    },
  };
  return { service, seen };
}

/** Request params for a registered path: every `:param` gets a value. */
function paramsFor(path: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const seg of path.split('/')) {
    if (seg.startsWith(':')) params[seg.slice(1)] = seg === ':namespace' ? NS : 'test';
  }
  return params;
}

interface Answer { status: number; body: any }

async function drive(route: Pick<Registered, 'verb' | 'path' | 'handler'>, headers: Record<string, string> = {}) {
  const answer: Answer = { status: 200, body: undefined };
  const res: any = {
    json(data: unknown) { answer.body = data; return res; },
    send() { return res; },
    status(code: number) { answer.status = code; return res; },
    header() { return res; },
  };
  await route.handler(
    {
      params: paramsFor(route.path),
      query: {},
      body: route.verb === 'GET' ? undefined : { workspace_name: 'held-write' },
      headers,
      method: route.verb,
      path: route.path,
    } as unknown as IHttpRequest,
    res as IHttpResponse,
  );
  return answer;
}

function expectGateRefusal(answer: Answer, gate: AuthGate) {
  expect(answer.status).toBe(403);
  expect(answer.body?.success).toBe(false);
  expect(answer.body?.error?.code).toBe(gate.code);
  expect(answer.body?.error?.message).toBe(gate.message);
  expect(answer.body?.data).toBeUndefined();
}

/**
 * The census, each route NAMED by the service member its own work calls when
 * a signed-in caller is served: read off a real served request, so the names
 * are the registrar's, not a list typed here. `key` is the registration's own
 * identity, used only to find the same route again in a fresh mount.
 */
async function memberCensus(): Promise<Array<{ key: string; member: string }>> {
  const census: Array<{ key: string; member: string }> = [];
  for (const route of capture(permissiveService().service).routes) {
    const { service, seen } = permissiveService();
    const fresh = capture(service, { contextFromRequest: () => SIGNED_IN }).routes.find(
      (r) => r.verb === route.verb && r.path === route.path,
    )!;
    await drive(fresh);
    census.push({ key: `${route.verb} ${route.path}`, member: seen.map((s) => s.member).join('+') });
  }
  return census;
}

const CENSUS = await memberCensus();
const MEMBERS = CENSUS.map((row) => row.member);

function routeServedBy(member: string, service: unknown, opts: SettingsRoutesOptions): Registered {
  const key = CENSUS.find((row) => row.member === member)!.key;
  return capture(service, opts).routes.find((r) => `${r.verb} ${r.path}` === key)!;
}

describe('the settings census — read off the registration', () => {
  it('registers exactly four routes, the ledgered ones, each serving one distinct member', () => {
    const { routes, middleware } = capture(untouchableService().service);
    // ⭐ A count, on purpose: a fifth route has to come through this file.
    expect(routes).toHaveLength(4);
    expect(routes.map((r) => `${r.verb} ${r.path}`).sort()).toEqual(
      SETTINGS_ROUTE_LEDGER.map((row) => row.route).sort(),
    );
    expect(new Set(MEMBERS).size).toBe(4);
    expect([...MEMBERS].sort()).toEqual(['getNamespace', 'listManifests', 'runAction', 'setMany']);
    // A preflight never reaches the door: no `OPTIONS` route, no middleware.
    expect(routes.every((r) => ['GET', 'PUT', 'POST'].includes(r.verb))).toBe(true);
    expect(middleware).toHaveLength(0);
  });
});

describe('ADR-0069 door — a held session is refused 403 with the gate code on every route', () => {
  for (const gate of POSTURES) {
    it.each(MEMBERS)(`the %s route · held by ${gate.code} → 403 ${gate.code}, the service never reached`, async (member) => {
      const { service, calls } = untouchableService();
      const route = routeServedBy(member, service, { contextFromRequest: () => held(gate) });
      expectGateRefusal(await drive(route), gate);
      expect(calls).toEqual([]);
    });
  }

  it.each(MEMBERS)('the %s route · an async resolver carrying the gate → 403, the service never reached', async (member) => {
    const gate = POSTURES[0]!;
    const { service, calls } = untouchableService();
    const route = routeServedBy(member, service, { contextFromRequest: async () => held(gate) });
    expectGateRefusal(await drive(route), gate);
    expect(calls).toEqual([]);
  });

  it('a basePath under an allow-listed name inherits no exemption', async () => {
    // The gate is asked WITHOUT the request path, so where a host mounts the
    // family cannot exempt it. Non-vacuity: the shared allow-list really would
    // exempt this path if it were asked.
    const basePath = '/api/v1/auth/settings';
    expect(isAuthGateAllowlisted(basePath, 'GET')).toBe(true);
    const gate = POSTURES[1]!;
    const { service, calls } = untouchableService();
    const { routes } = capture(service, { basePath, contextFromRequest: () => held(gate) });
    expect(routes).toHaveLength(4);
    for (const route of routes) expectGateRefusal(await drive(route), gate);
    expect(calls).toEqual([]);
  });
});

describe('CONTROL — a host resolver that sets no authGate is served as before', () => {
  it.each(MEMBERS)('the %s route · signed in, un-held → 200, and the service sees that very context', async (member) => {
    const { service, seen } = permissiveService();
    const route = routeServedBy(member, service, { contextFromRequest: () => SIGNED_IN });
    const answer = await drive(route);
    expect(answer.status).toBe(200);
    expect(answer.body?.success).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.member).toBe(member);
    expect(seen[0]!.ctx).toBe(SIGNED_IN);
  });
});

// ── Part 4: the producer ────────────────────────────────────────────────────

class MockHttp implements IHttpServer {
  routes: Registered[] = [];
  private add(verb: string, path: string, handler: RouteHandler) { this.routes.push({ verb, path, handler }); }
  get(path: string, h: RouteHandler) { this.add('GET', path, h); return this as any; }
  post(path: string, h: RouteHandler) { this.add('POST', path, h); return this as any; }
  put(path: string, h: RouteHandler) { this.add('PUT', path, h); return this as any; }
  delete(path: string, h: RouteHandler) { this.add('DELETE', path, h); return this as any; }
  patch(path: string, h: RouteHandler) { this.add('PATCH', path, h); return this as any; }
  use() { return this as any; }
  listen() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  getInstance() { return null; }
}

const SESSION_COOKIE = 'better-auth.session_token=tok_23178.c2lnbmF0dXJl';

/**
 * Boot `SettingsServicePlugin` for real (`init` → `start` → `kernel:ready`)
 * over an auth service whose session read answers `sessionUser` and is
 * counted. No engine is registered (the memory fallback) and no `tenancy` (a
 * quiet `undefined` posture), so the session read is the only thing the
 * resolver does with the caller.
 */
async function bootPlugin(sessionUser: Record<string, unknown>) {
  const reads: unknown[] = [];
  const http = new MockHttp();
  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as any);
  const services: Record<string, unknown> = {
    'http-server': http,
    auth: {
      api: {
        getSession: async (input: unknown) => {
          reads.push(input);
          return { user: sessionUser, session: { id: 'sess_23178', userId: sessionUser.id } };
        },
      },
    },
  };
  let readyHook: (() => Promise<void>) | undefined;
  const ctx: any = {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    registerService: () => {},
    getService: (name: string) => services[name],
    hook: (event: string, fn: () => Promise<void>) => { if (event === 'kernel:ready') readyHook = fn; },
    getKernel: () => kernel,
  };
  captured.contextFromRequest = undefined;
  const plugin = new SettingsServicePlugin({ manifests: [], env: {}, actionHandlers: {} });
  await plugin.init(ctx);
  await plugin.start(ctx);
  await readyHook!();
  const contextFromRequest = captured.contextFromRequest as
    | ((req: IHttpRequest) => SettingsContext | Promise<SettingsContext>)
    | undefined;
  if (!contextFromRequest) throw new Error('fixture: the settings routes were not registered');
  return { http, reads, contextFromRequest };
}

const request = { headers: { cookie: SESSION_COOKIE }, method: 'GET', path: '/' } as unknown as IHttpRequest;

describe('ADR-0069 producer — SettingsServicePlugin carries the session posture to the door', () => {
  for (const gate of POSTURES) {
    it(`a session held by ${gate.code} is refused 403 on every mounted route, one session read each`, async () => {
      const { http, reads } = await bootPlugin({ id: 'usr_held', authGate: gate });
      expect(http.routes).toHaveLength(4);
      for (const route of http.routes) {
        const before = reads.length;
        expectGateRefusal(await drive(route, { cookie: SESSION_COOKIE }), gate);
        expect(reads.length - before, 'one session read serves the identity and the posture').toBe(1);
      }
    });
  }

  it('the posture on the context is the shared reader\'s normalization, not a verbatim copy', async () => {
    const sessionUser = { id: 'usr_held', authGate: { ...POSTURES[0]!, internal: 'not-on-the-envelope' } };
    const { contextFromRequest, reads } = await bootPlugin(sessionUser);
    const context = await contextFromRequest(request);
    expect(reads).toHaveLength(1);
    expect(context.userId).toBe('usr_held');
    expect(context.authGate).toEqual(normalizeAuthGate(sessionUser));
    expect(context.authGate).toEqual(POSTURES[0]);
  });

  it('CONTROL — an un-held session resolves a context with no authGate, and the index serves it 200', async () => {
    const { http, contextFromRequest, reads } = await bootPlugin({ id: 'usr_free' });
    const context = await contextFromRequest(request);
    expect(reads).toHaveLength(1);
    expect(context.userId).toBe('usr_free');
    expect('authGate' in context).toBe(false);
    const index = http.routes.find((r) => r.verb === 'GET' && !r.path.includes(':'))!;
    const answer = await drive(index, { cookie: SESSION_COOKIE });
    expect(answer.status).toBe(200);
    expect(answer.body?.success).toBe(true);
    expect(answer.body?.data?.manifests).toEqual([]);
  });
});
