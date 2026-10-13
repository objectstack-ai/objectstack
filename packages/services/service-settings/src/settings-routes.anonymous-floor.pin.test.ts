// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0056 D2 / ADR-0138 D2 — the settings REST family answers an anonymous
 * caller with the platform's shared `401 UNAUTHENTICATED`, on every route,
 * before any settings logic runs.
 *
 * ## What was open
 *
 * `registerSettingsRoutes` mounted its routes with no anonymous floor. An
 * unauthenticated request was answered by the family's own authorization
 * logic instead: an empty index (`200`), a capability refusal (`403`), or — for
 * a namespace that does not exist — `404`, which told an anonymous caller which
 * namespaces do. ADR-0138 D2 says everything outside its door classes "answers
 * 401 (UNAUTHENTICATED)", and the settings family is in none of them.
 *
 * ## The census comes from the registration, not from a list typed here
 *
 * Every route is captured off a mock `IHttpServer` as `registerSettingsRoutes`
 * registers it, and every captured route is driven. A route added to the
 * family later is therefore driven anonymously the day it lands: mounted
 * through the family's door it answers 401 and this file stays green; mounted
 * on `http` directly, past the door, it reaches the service and this file goes
 * red — twice, once on the count below and once on the sweep.
 *
 * ## What each refusal asserts
 *
 * The ADR-0112 envelope — `status` AND `error.code` — plus the shared message,
 * no `data`, and a service that was never called. A bare `toThrow()` would be
 * no pin at all: the unfloored family never threw, it ANSWERED.
 *
 * ## Controls
 *
 * A floor that refused everybody would pass every refusal here. So the same
 * routes are driven for a signed-in caller, and each one reaches the service
 * with that caller's context and answers `200` exactly as before.
 */

import { describe, expect, it } from 'vitest';
import {
  ANONYMOUS_DENY_CODE,
  ANONYMOUS_DENY_MESSAGE,
  ANONYMOUS_DENY_STATUS,
  isAuthGateAllowlisted,
} from '@objectstack/core';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { registerSettingsRoutes, type SettingsRoutesOptions } from './settings-routes.js';
import { SETTINGS_ROUTE_LEDGER } from './settings-route-ledger.js';
import type { SettingsContext } from './settings-service.types.js';

const NS = 'branding';

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
    use: (...args: unknown[]) => { middleware.push(args); },
    listen: async () => {},
    close: async () => {},
  };
  registerSettingsRoutes(http as any, service as any, opts);
  return { routes, middleware };
}

/**
 * A service any call into which is recorded, and fails. If an anonymous
 * request reached it, the `calls` list says so and the answer is the route's
 * `500` tail, never a `401` — so a floor that let one through cannot pass.
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
          throw new Error(`service.${String(prop)} was reached by an anonymous request`);
        };
      },
    },
  );
  return { service, calls };
}

/** A service that would SUCCEED for every route, recording the context it was handed. */
function permissiveService() {
  const seen: Array<{ method: string; ctx: SettingsContext }> = [];
  const service = {
    listManifests: (ctx: SettingsContext) => { seen.push({ method: 'listManifests', ctx }); return [{ namespace: NS }]; },
    getNamespace: async (_ns: string, ctx: SettingsContext) => {
      seen.push({ method: 'getNamespace', ctx });
      return { manifest: { namespace: NS }, values: {} };
    },
    // `ReadonlySet<string>` is the real shape the redaction helpers read.
    secretKeysOf: () => new Set<string>(),
    setMany: async (_ns: string, _values: unknown, ctx: SettingsContext) => { seen.push({ method: 'setMany', ctx }); return {}; },
    runAction: async (_ns: string, _id: string, _input: unknown, ctx: SettingsContext) => {
      seen.push({ method: 'runAction', ctx });
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

async function drive(route: Registered, headers: Record<string, string> = {}) {
  const captured: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    json(data: unknown) { captured.body = data; return res; },
    send() { return res; },
    status(code: number) { captured.status = code; return res; },
    header() { return res; },
  };
  await route.handler(
    {
      params: paramsFor(route.path),
      query: {},
      body: route.verb === 'GET' ? undefined : { workspace_name: 'anonymous-write' },
      headers,
      method: route.verb,
      path: route.path,
    } as unknown as IHttpRequest,
    res as IHttpResponse,
  );
  return captured;
}

function expectAnonymousRefusal(answer: { status: number; body: any }) {
  expect(answer.status).toBe(ANONYMOUS_DENY_STATUS);
  expect(answer.status).toBe(401);
  expect(answer.body?.success).toBe(false);
  expect(answer.body?.error?.code).toBe(ANONYMOUS_DENY_CODE);
  expect(answer.body?.error?.code).toBe('UNAUTHENTICATED');
  expect(answer.body?.error?.message).toBe(ANONYMOUS_DENY_MESSAGE);
  expect(answer.body?.data).toBeUndefined();
}

/**
 * Every shape a context with no principal arrives in. Each one is anonymous:
 * the floor reads `userId` and nothing else, so neither held capabilities nor
 * the in-process `enforced: false` marker stands in for a signed-in caller.
 */
const ANONYMOUS_CONTEXTS: Array<{ name: string; opts: SettingsRoutesOptions }> = [
  { name: 'the secure default (no resolver wired)', opts: {} },
  { name: 'a resolver that resolved no principal', opts: { contextFromRequest: () => ({ enforced: true }) } },
  { name: 'an async resolver that resolved no principal', opts: { contextFromRequest: async () => ({ enforced: true }) } },
  {
    name: 'capabilities with no principal',
    opts: { contextFromRequest: () => ({ enforced: true, permissions: ['setup.access', 'setup.write'] }) },
  },
  { name: 'the in-process marker with no principal', opts: { contextFromRequest: () => ({ enforced: false }) } },
];

describe('the settings family census — read off the registration', () => {
  it('registers exactly four routes, the ledgered ones, and no middleware past them', () => {
    const { routes, middleware } = capture(untouchableService().service);
    // ⭐ A count, on purpose: a fifth route has to come through this file.
    expect(routes).toHaveLength(4);
    expect(routes.map((r) => `${r.verb} ${r.path}`).sort()).toEqual(
      SETTINGS_ROUTE_LEDGER.map((row) => row.route).sort(),
    );
    expect(middleware).toHaveLength(0);
  });
});

describe('ADR-0056 D2 — an anonymous caller is refused 401 on every route of the family', () => {
  const census = capture(untouchableService().service).routes.map((r) => `${r.verb} ${r.path}`);

  for (const shape of ANONYMOUS_CONTEXTS) {
    it.each(census)(`%s · ${shape.name} → 401 UNAUTHENTICATED, the service never reached`, async (key) => {
      const { service, calls } = untouchableService();
      const route = capture(service, shape.opts).routes.find((r) => `${r.verb} ${r.path}` === key)!;
      expectAnonymousRefusal(await drive(route));
      expect(calls).toEqual([]);
    });
  }

  it.each(census)('%s · a forged identity header is not an identity → 401', async (key) => {
    const { service, calls } = untouchableService();
    const route = capture(service).routes.find((r) => `${r.verb} ${r.path}` === key)!;
    expectAnonymousRefusal(
      await drive(route, { 'x-user-id': 'usr_forged', 'x-permissions': 'setup.access,setup.write' }),
    );
    expect(calls).toEqual([]);
  });

  it('a basePath under an allow-listed control-plane name inherits no exemption', async () => {
    // The floor is asked WITHOUT the request path, so where a host mounts the
    // family cannot exempt it. Non-vacuity: the shared allow-list really would
    // exempt this path if it were asked.
    const basePath = '/api/v1/auth/settings';
    expect(isAuthGateAllowlisted(basePath, 'GET')).toBe(true);
    const { service, calls } = untouchableService();
    const { routes } = capture(service, { basePath });
    expect(routes).toHaveLength(4);
    for (const route of routes) expectAnonymousRefusal(await drive(route));
    expect(calls).toEqual([]);
  });
});

describe('CONTROL — a signed-in caller is served as before', () => {
  const census = capture(permissiveService().service).routes.map((r) => `${r.verb} ${r.path}`);

  it.each(census)('%s · signed in → 200, and the service sees that caller', async (key) => {
    const { service, seen } = permissiveService();
    const signedIn: SettingsContext = { enforced: true, userId: 'usr_admin', permissions: ['setup.access', 'setup.write'] };
    const route = capture(service, { contextFromRequest: () => signedIn }).routes.find(
      (r) => `${r.verb} ${r.path}` === key,
    )!;
    const answer = await drive(route);
    expect(answer.status).toBe(200);
    expect(answer.body?.success).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.ctx).toBe(signedIn);
  });
});
