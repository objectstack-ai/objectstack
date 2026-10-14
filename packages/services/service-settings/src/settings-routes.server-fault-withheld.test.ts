// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23174] A settings route's catch-all 5xx answers its declared `code` and
 * `status` with the route's own generic text, never the caught error's.
 *
 * The four routes' `refuse` arms ended in `sendError(res, 500, 'INTERNAL_ERROR',
 * err?.message ?? '<fallback>')`, so whatever a failing store or adapter said
 * reached the caller. They now answer through `sendServerFault`
 * (`@objectstack/types`): the fallback goes on the wire, and the caught error,
 * stack included, goes to the server-fault log as one line.
 *
 * The two AUTHORED arms are pinned unchanged beside it, because the rule
 * withholds only text that came from a caught error: the
 * `SETTINGS_CRYPTO_UNAVAILABLE` refusal is product copy the console renders as
 * the operator's prescription, and the authorization-store outage relays the
 * code and message its producer declared.
 *
 * ⛔ No `toThrow()` here: the unrepaired routes never threw, they ANSWERED with
 * the fault's text. The claim is `status` + `code` + what the body carries.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { AuthzStoreUnavailableError, AUTHZ_STORE_UNAVAILABLE_CODE } from '@objectstack/core';
import { BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { SERVER_FAULT_LOG_PREFIX } from '@objectstack/types';
import { registerSettingsRoutes } from './settings-routes.js';
import { SettingsCryptoUnavailableError } from './settings-service.types.js';
import type { SettingsContext } from './settings-service.types.js';

const BASE = '/api/settings';
const NS = 'mail';

/** Shaped like a driver error: a host, a table and a statement fragment. */
const FAULT = 'connect ECONNREFUSED 10.0.4.17:5432 while reading sys_setting WHERE namespace = $1';

interface Captured { status: number; body: any }

const signedIn: () => SettingsContext = () => ({
  enforced: true,
  permissions: ['setup.access', 'setup.write'],
  userId: 'usr_admin',
});

/** A service whose every route-facing method throws `fault`. */
function failingService(fault: () => unknown) {
  const raise = () => { throw fault(); };
  return {
    listManifests: raise,
    getNamespace: async () => raise(),
    secretKeysOf: () => new Set<string>(),
    setMany: async () => raise(),
    runAction: async () => raise(),
  } as any;
}

function mount(service: any, contextFromRequest: (req: IHttpRequest) => SettingsContext | Promise<SettingsContext> = signedIn) {
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
  registerSettingsRoutes(http as any, service, { basePath: BASE, contextFromRequest });
  return routes;
}

/** The four routes, each with the generic text its catch-all answers. */
const ROUTES = [
  { key: `GET:${BASE}`, params: {}, body: undefined, generic: 'Failed to list manifests' },
  { key: `GET:${BASE}/:namespace`, params: { namespace: NS }, body: undefined, generic: 'Failed to read namespace' },
  { key: `PUT:${BASE}/:namespace`, params: { namespace: NS }, body: { host: 'x' }, generic: 'Failed to write namespace' },
  {
    key: `POST:${BASE}/:namespace/:actionId`,
    params: { namespace: NS, actionId: 'test' },
    body: {},
    generic: 'Action failed',
  },
] as const;

async function drive(routes: Map<string, RouteHandler>, route: (typeof ROUTES)[number]): Promise<Captured> {
  const handler = routes.get(route.key);
  if (!handler) throw new Error(`fixture: no handler for ${route.key}`);
  const captured: Captured = { status: 200, body: undefined };
  const res: any = {
    json(data: any) { captured.body = data; return res; },
    send() { return res; },
    status(code: number) { captured.status = code; return res; },
    header() { return res; },
  };
  const [method, path] = route.key.split(/:(.+)/);
  await handler(
    { params: route.params, query: {}, body: route.body, headers: {}, method, path } as unknown as IHttpRequest,
    res as IHttpResponse,
  );
  return captured;
}

/** The fault log is `console.error` here: `sendServerFault` takes no logger, as `sendError` takes none. */
const quietConsole = () => vi.spyOn(console, 'error').mockImplementation(() => {});
const faultLines = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter((c) => String(c[0]).startsWith(SERVER_FAULT_LOG_PREFIX));

afterEach(() => { vi.restoreAllMocks(); });

describe('[#23174] settings — a catch-all 5xx withholds the caught text', () => {
  it.each(ROUTES)('$key answers 500 INTERNAL_ERROR with "$generic", and none of the fault', async (route) => {
    quietConsole();
    const res = await drive(mount(failingService(() => new Error(FAULT))), route);

    expect(res.status).toBe(500);
    expect(res.body?.success).toBe(false);
    expect(res.body?.error?.code).toBe('INTERNAL_ERROR');
    expect(res.body?.error?.message).toBe(route.generic);
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(res.body)).not.toContain('sys_setting');
    expect(BaseResponseSchema.safeParse(res.body).success).toBe(true);
    expect(envelopeViolations(res.body)).toEqual([]);
  });

  it.each(ROUTES)('$key logs the caught text ONCE, with its stack', async (route) => {
    const spy = quietConsole();
    await drive(mount(failingService(() => new Error(FAULT))), route);

    const lines = faultLines(spy);
    expect(lines).toHaveLength(1);
    expect(String(lines[0][0])).toContain(FAULT);
    expect(String((lines[0][1] as Record<string, unknown>).stack)).toContain(FAULT);
  });
});

describe('[#23174] settings — the two authored 5xx arms keep their own text', () => {
  it('SETTINGS_CRYPTO_UNAVAILABLE still answers its operator prescription verbatim', async () => {
    quietConsole();
    const refusal = new SettingsCryptoUnavailableError(NS, 'smtp_password');
    const res = await drive(mount(failingService(() => refusal)), ROUTES[2]);

    expect(res.status).toBe(500);
    expect(res.body?.error?.code).toBe('SETTINGS_CRYPTO_UNAVAILABLE');
    expect(res.body?.error?.message).toBe(refusal.message);
    expect(res.body?.error?.details).toEqual({ namespace: NS, key: 'smtp_password' });
  });

  it.each(ROUTES)('$key still relays the authorization-store outage with its declared code and message', async (route) => {
    quietConsole();
    const outage = new AuthzStoreUnavailableError('sys_user_permission_set');
    const res = await drive(mount(failingService(() => new Error(FAULT)), () => { throw outage; }), route);

    expect(res.status).toBe(503);
    expect(res.body?.error?.code).toBe(AUTHZ_STORE_UNAVAILABLE_CODE);
    expect(res.body?.error?.message).toBe(outage.message);
  });
});
