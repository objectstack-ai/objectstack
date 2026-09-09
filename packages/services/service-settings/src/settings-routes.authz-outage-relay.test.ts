// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15999 ruling item 3] Every settings route relays an authorization-store
 * OUTAGE as the `503 SERVICE_UNAVAILABLE` the brand declares, instead of
 * flattening it into this layer's untyped `500 INTERNAL_ERROR` tail.
 *
 * ## What was measured
 *
 * `SettingsServicePlugin`'s `verifiedContextFromRequest` re-raises
 * `AuthzStoreUnavailableError` rather than returning an enforced-but-empty
 * context the routes would read as a denial (#13279). But it is called as
 * `await ctxOf(req)` from INSIDE each route's own `try`, so the brand was
 * caught here and re-encoded: `message` survived, `code` and `status` did not —
 * and those are the two a client branches on.
 *
 * ## The count on the card was wrong, and this file is why it matters
 *
 * The #15999 ruling says 「settings' three route catches」. Located by
 * PREDICATE — a `catch` around a `ctxOf(req)` whose exit is a denial or a
 * swallow — this registrar has **four**: `GET /api/settings`,
 * `GET /api/settings/:namespace`, `PUT /api/settings/:namespace` and
 * `POST /api/settings/:namespace/:actionId`. All four are driven below, so the
 * fourth cannot be the one nobody remembered.
 *
 * ## RELAY, not re-raise
 *
 * A bare re-raise escapes to the transport, which answers a bare
 * `500 INTERNAL_ERROR "No response from handler"` — losing the message the
 * flattening at least preserved — and the shared render that would give an
 * escaped ADR-0112 envelope its declared status is #16545 and has not landed.
 * A relay answers before the throw escapes, so it is correct today and stays
 * correct once #16545 lands. Same shape as `badRequest` in
 * `service-datasource`'s `admin-routes.ts` since #6504.
 *
 * ## Controls
 *
 * A layer that answered 503 for everything would pass an outage-only suite
 * while making every settings fault unreadable. So §1 drives the happy path and
 * §3 pins the relay's WIDTH: `SettingsForbiddenError` still answers its 403,
 * `UnknownNamespaceError` its 404, and a plain throw still lands on the untyped
 * `500 INTERNAL_ERROR` tail that this repair deliberately did NOT widen.
 *
 * ⛔ Nothing here asserts `toThrow()`: the unrepaired layer never threw — it
 * ANSWERED, with the wrong envelope. The claim is `status` + `code`.
 */

import { describe, it, expect } from 'vitest';
import {
  AuthzStoreUnavailableError,
  AUTHZ_STORE_UNAVAILABLE_CODE,
  AUTHZ_STORE_UNAVAILABLE_STATUS,
} from '@objectstack/core';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { registerSettingsRoutes } from './settings-routes.js';
import { SettingsForbiddenError, UnknownNamespaceError } from './settings-service.types.js';
import type { SettingsContext } from './settings-service.types.js';

const BASE = '/api/settings';
const NS = 'mail';

interface Captured { status: number; body: any }

/**
 * A `SettingsService` stand-in that would SUCCEED for every verb. It exists so
 * a green outage arm can only come from the context resolver — if the service
 * were the thing failing, every arm below would pass for the wrong reason.
 */
function permissiveService() {
  return {
    listManifests: () => [{ namespace: NS }],
    getNamespace: async () => ({ manifest: { namespace: NS }, values: {} }),
    // `ReadonlySet<string>` is the real `SettingsService` shape — an array
    // makes the redaction helpers' `.size` read `undefined` and the PUT door
    // answers 500, i.e. the control would fail for a fixture reason.
    secretKeysOf: () => new Set<string>(),
    setMany: async () => ({}),
    runAction: async () => ({ ok: true }),
  } as any;
}

type Ctx = (req: IHttpRequest) => SettingsContext | Promise<SettingsContext>;

function mount(contextFromRequest: Ctx, service: any = permissiveService()) {
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

/** The four doors this registrar mounts — the predicate-found census, not the card's count. */
const DOORS = [
  { name: 'GET /api/settings', key: `GET:${BASE}`, params: {}, body: undefined },
  { name: 'GET /api/settings/:namespace', key: `GET:${BASE}/:namespace`, params: { namespace: NS }, body: undefined },
  { name: 'PUT /api/settings/:namespace', key: `PUT:${BASE}/:namespace`, params: { namespace: NS }, body: { host: 'x' } },
  {
    name: 'POST /api/settings/:namespace/:actionId',
    key: `POST:${BASE}/:namespace/:actionId`,
    params: { namespace: NS, actionId: 'test' },
    body: {},
  },
] as const;

async function drive(routes: Map<string, RouteHandler>, door: (typeof DOORS)[number]): Promise<Captured> {
  const handler = routes.get(door.key);
  if (!handler) throw new Error(`fixture: no handler for ${door.key}`);
  const captured: Captured = { status: 200, body: undefined };
  const res: any = {
    json(data: any) { captured.body = data; return res; },
    send() { return res; },
    status(code: number) { captured.status = code; return res; },
    header() { return res; },
  };
  const [method, path] = door.key.split(/:(.+)/);
  await handler(
    { params: door.params, query: {}, body: door.body, headers: {}, method, path } as unknown as IHttpRequest,
    res as IHttpResponse,
  );
  return captured;
}

const codeOf = (c: Captured) => c.body?.error?.code;
const OUTAGE: Ctx = () => { throw new AuthzStoreUnavailableError('sys_user_permission_set'); };

// ---------------------------------------------------------------------------
// §0 — The census control: the door table above IS the mounted surface.
// ---------------------------------------------------------------------------

describe('[#15999] §0 — all four route catches exist and are the ones driven', () => {
  it('the registrar mounts exactly the four doors this file drives', () => {
    const routes = mount(() => ({ enforced: false }));
    expect([...routes.keys()].sort()).toEqual(DOORS.map((d) => d.key).sort());
  });
});

// ---------------------------------------------------------------------------
// §1 — Control: the doors still work when the context resolves.
// ---------------------------------------------------------------------------

describe('[#15999] §1 — a resolvable context still reaches the service', () => {
  it.each(DOORS)('CONTROL · $name answers 200', async (door) => {
    const routes = mount(() => ({ enforced: false }));
    const res = await drive(routes, door);
    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2 — THE SUBJECT.
// ---------------------------------------------------------------------------

describe('[#15999] §2 — an authorization-store outage reaches the caller as its declared envelope', () => {
  it.each(DOORS)('REPAIRED: $name answers 503 SERVICE_UNAVAILABLE — was 500 INTERNAL_ERROR', async (door) => {
    const routes = mount(OUTAGE);
    const res = await drive(routes, door);
    expect(res.status).toBe(AUTHZ_STORE_UNAVAILABLE_STATUS);
    expect(res.status).toBe(503);
    expect(codeOf(res)).toBe(AUTHZ_STORE_UNAVAILABLE_CODE);
    // ⛔ The code that used to arrive, and that named the wrong component.
    expect(codeOf(res)).not.toBe('INTERNAL_ERROR');
  });

  it('the operator still learns WHICH read failed, and that it is not a denial', async () => {
    const routes = mount(OUTAGE);
    const res = await drive(routes, DOORS[2]);
    expect(res.body?.error?.message).toContain('sys_user_permission_set');
    expect(res.body?.error?.message).toContain('not a permission denial');
    expect(res.body).toMatchObject({ success: false, error: { code: 'SERVICE_UNAVAILABLE' } });
  });

  it('an async rejection is relayed too, not only a synchronous throw', async () => {
    // `contextFromRequest` is declared to return `SettingsContext | Promise<…>`
    // and the production resolver is async, so the rejected-promise path is the
    // one that actually runs.
    const routes = mount(async () => { throw new AuthzStoreUnavailableError('sys_permission_set_assignment'); });
    const res = await drive(routes, DOORS[0]);
    expect(res.status).toBe(503);
    expect(codeOf(res)).toBe(AUTHZ_STORE_UNAVAILABLE_CODE);
  });
});

// ---------------------------------------------------------------------------
// §3 — THE WIDTH PIN. Every other arm is untouched.
// ---------------------------------------------------------------------------

describe('[#15999] §3 — the relay is scoped to the brand; every other arm is unchanged', () => {
  it.each(DOORS)('$name still answers 403 SETTINGS_FORBIDDEN for a forbidden context', async (door) => {
    const routes = mount(() => { throw new SettingsForbiddenError(NS, 'setup.access', 'read'); });
    const res = await drive(routes, door);
    expect(res.status).toBe(403);
    expect(codeOf(res)).toBe('SETTINGS_FORBIDDEN');
  });

  it.each(DOORS)('$name still answers the untyped 500 INTERNAL_ERROR tail for a plain throw', async (door) => {
    const routes = mount(() => { throw new Error('some unrelated fault'); });
    const res = await drive(routes, door);
    expect(res.status).toBe(500);
    expect(codeOf(res)).toBe('INTERNAL_ERROR');
    // The message channel this layer already preserved is preserved still.
    expect(res.body?.error?.message).toBe('some unrelated fault');
  });

  it('a look-alike carrying the declared status+code but NO brand is not relayed', async () => {
    // The brand survives module duplication where `instanceof` does not
    // (`authz-store-unavailable.ts` module doc); the converse is that a
    // look-alike without it is not this error.
    const routes = mount(() => {
      throw Object.assign(new Error('look-alike'), {
        status: AUTHZ_STORE_UNAVAILABLE_STATUS,
        code: AUTHZ_STORE_UNAVAILABLE_CODE,
      });
    });
    const res = await drive(routes, DOORS[1]);
    expect(res.status).toBe(500);
    expect(codeOf(res)).toBe('INTERNAL_ERROR');
  });

  it('the namespace 404 arm is untouched — a service-thrown UnknownNamespaceError still wins', async () => {
    const service = permissiveService();
    service.getNamespace = async () => { throw new UnknownNamespaceError(NS); };
    const routes = mount(() => ({ enforced: false }), service);
    const res = await drive(routes, DOORS[1]);
    expect(res.status).toBe(404);
    expect(codeOf(res)).toBe('UNKNOWN_NAMESPACE');
  });
});
