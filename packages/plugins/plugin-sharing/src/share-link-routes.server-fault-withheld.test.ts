// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23174] The share-link family door's catch-all 5xx answers `500 INTERNAL`
 * with the route's own `failure` text, never the caught error's.
 *
 * The door's `catch` (`mountFamilyRoute` in `share-link-routes.ts`) wrote
 * `sendError(res, err?.status ?? 500, err?.code ?? 'INTERNAL', err?.message ??
 * route.failure)`, so a throw that declared no status answered 500 carrying
 * whatever the failing store or engine said. Such a throw now answers through
 * `sendServerFault` (`@objectstack/types`): `failure` goes on the wire, and the
 * caught error, stack included, goes to the server-fault log as one line.
 *
 * A throw that DECLARES its status keeps the envelope its producer declared,
 * pinned below beside it: a coded 4xx refusal is an answer by design, and the
 * branded authorization-store outage relays its own code and message.
 *
 * The two token routes are driven too: the door hands the log no request
 * object, so the token in their URL cannot reach the line.
 *
 * ⛔ No `toThrow()` here: the unrepaired door never threw, it ANSWERED with the
 * fault's text. The claim is `status` + `code` + what the body carries.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { AuthzStoreUnavailableError, AUTHZ_STORE_UNAVAILABLE_CODE } from '@objectstack/core';
import { BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { SERVER_FAULT_LOG_PREFIX } from '@objectstack/types';
import { registerShareLinkRoutes } from './share-link-routes';
import type { ShareLinkService } from './share-link-service';
import type { SharingEngine } from './sharing-service';

const B = '/api/v1/share-links';
const TOKEN = 'tok_live_9f8e7d6c5b4a';

/** Shaped like a driver error: a table, a column and a server path. */
const FAULT = 'SQLITE_ERROR: no such column: sys_share_link.password_hash (/srv/objectstack/data/tenant-a.db)';

function mount(
  fault: () => unknown,
  contextFromRequest: (req: IHttpRequest) => ExecutionContext | Promise<ExecutionContext> = () => ({ userId: 'u_1' }),
) {
  const raise = async () => { throw fault(); };
  const service = {
    createLink: raise,
    listLinks: raise,
    revokeLink: raise,
    resolveToken: raise,
  } as unknown as ShareLinkService;
  // The routes read the engine through `find` (the token routes' probe and messages) alone.
  const engine = { find: raise, getSchema: () => undefined } as unknown as SharingEngine;
  const routes = new Map<string, RouteHandler>();
  const http = {
    get: (p: string, h: RouteHandler) => { routes.set(`GET ${p}`, h); },
    post: (p: string, h: RouteHandler) => { routes.set(`POST ${p}`, h); },
    put: (p: string, h: RouteHandler) => { routes.set(`PUT ${p}`, h); },
    delete: (p: string, h: RouteHandler) => { routes.set(`DELETE ${p}`, h); },
    patch: () => {},
    use: () => {},
    listen: async () => {},
    close: async () => {},
  };
  registerShareLinkRoutes(http as any, service, engine, { contextFromRequest });
  return routes;
}

/** The five routes, each with the `failure` text its catch-all answers. */
const ROUTES = [
  { key: `POST ${B}`, params: {}, body: { object: 'crm_account', recordId: 'acc_1' }, failure: 'Failed to create link' },
  { key: `GET ${B}`, params: {}, body: undefined, failure: 'Failed to list links' },
  { key: `DELETE ${B}/:idOrToken`, params: { idOrToken: TOKEN }, body: undefined, failure: 'Failed to revoke link' },
  { key: `GET ${B}/:token/resolve`, params: { token: TOKEN }, body: undefined, failure: 'Failed to resolve link' },
  { key: `GET ${B}/:token/messages`, params: { token: TOKEN }, body: undefined, failure: 'Failed to load messages' },
] as const;

async function drive(routes: Map<string, RouteHandler>, route: (typeof ROUTES)[number]) {
  const handler = routes.get(route.key);
  if (!handler) throw new Error(`fixture: no handler for ${route.key}`);
  const captured = { status: 200, body: undefined as any };
  const res: any = {
    json(data: any) { captured.body = data; },
    send() {},
    status(code: number) { captured.status = code; return res; },
    header() { return res; },
  };
  const [method] = route.key.split(' ');
  const url = route.key.slice(method.length + 1).replace(':token', TOKEN).replace(':idOrToken', TOKEN);
  await handler(
    { params: route.params, query: {}, body: route.body, headers: {}, method, path: url, url } as unknown as IHttpRequest,
    res as IHttpResponse,
  );
  return captured;
}

/** The fault log is `console.error` here: `sendServerFault` takes no logger, as `sendError` takes none. */
const quietConsole = () => vi.spyOn(console, 'error').mockImplementation(() => {});
const faultLines = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter((c) => String(c[0]).startsWith(SERVER_FAULT_LOG_PREFIX));

afterEach(() => { vi.restoreAllMocks(); });

describe('[#23174] share-link door — a throw that declares no status withholds its text', () => {
  it.each(ROUTES)('$key answers 500 INTERNAL with "$failure", and none of the fault', async (route) => {
    quietConsole();
    const res = await drive(mount(() => new Error(FAULT)), route);

    expect(res.status).toBe(500);
    expect(res.body?.success).toBe(false);
    expect(res.body?.error?.code).toBe('INTERNAL');
    expect(res.body?.error?.message).toBe(route.failure);
    expect(JSON.stringify(res.body)).not.toContain('SQLITE_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('/srv/objectstack');
    expect(BaseResponseSchema.safeParse(res.body).success).toBe(true);
    expect(envelopeViolations(res.body)).toEqual([]);
  });

  it.each(ROUTES)('$key logs the caught text ONCE, with its stack, and never the token', async (route) => {
    const spy = quietConsole();
    await drive(mount(() => new Error(FAULT)), route);

    const lines = faultLines(spy);
    expect(lines).toHaveLength(1);
    expect(String(lines[0][0])).toContain(FAULT);
    expect(String((lines[0][1] as Record<string, unknown>).stack)).toContain(FAULT);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
  });
});

describe('[#23174] share-link door — a throw that declares no status withholds its code too', () => {
  /**
   * The throws that reach the catch-all are engine and driver throws, and they
   * carry a string `code` and no status: Postgres `42P01`, SQLite
   * `SQLITE_ERROR`, a Node `ECONNREFUSED`. That spelling names the backend and
   * is outside the closed `error.code` vocabulary, so a body carrying it fails
   * `BaseResponseSchema`. The two token routes are the public ones.
   */
  const TOKEN_ROUTES = ROUTES.filter((route) => route.key.includes(':token'));
  const driverThrow = () => Object.assign(new Error(FAULT), { code: '42P01' });

  it.each(TOKEN_ROUTES)('$key answers INTERNAL for a 42P01 throw, and 42P01 is nowhere in the body', async (route) => {
    quietConsole();
    const res = await drive(mount(driverThrow), route);

    expect(res.status).toBe(500);
    expect(res.body?.error?.code).toBe('INTERNAL');
    expect(BaseResponseSchema.safeParse(res.body).success).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('42P01');
  });

  it('a caught registered code with no status still costs one ERROR line, never the capability-absence warn', async () => {
    const spy = quietConsole();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await drive(mount(() => Object.assign(new Error(FAULT), { code: 'SERVICE_UNAVAILABLE' })), TOKEN_ROUTES[0]);

    expect(res.status).toBe(500);
    expect(res.body?.error?.code).toBe('INTERNAL');
    const lines = faultLines(spy);
    expect(lines).toHaveLength(1);
    expect(String((lines[0][1] as Record<string, unknown>).stack)).toContain(FAULT);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('[#23174] share-link door — a throw that declares its status keeps its envelope', () => {
  it('a coded 4xx refusal still answers its own status, code and message', async () => {
    quietConsole();
    const refusal = Object.assign(new Error('Not permitted to revoke this share link'), { status: 403, code: 'FORBIDDEN' });
    const res = await drive(mount(() => refusal), ROUTES[2]);

    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe('FORBIDDEN');
    expect(res.body?.error?.message).toBe('Not permitted to revoke this share link');
  });

  it.each(ROUTES)('$key still relays the authorization-store outage with its declared code and message', async (route) => {
    quietConsole();
    const outage = new AuthzStoreUnavailableError('sys_user_permission_set');
    const res = await drive(mount(() => new Error(FAULT), () => { throw outage; }), route);

    expect(res.status).toBe(503);
    expect(res.body?.error?.code).toBe(AUTHZ_STORE_UNAVAILABLE_CODE);
    expect(res.body?.error?.message).toBe(outage.message);
  });
});
