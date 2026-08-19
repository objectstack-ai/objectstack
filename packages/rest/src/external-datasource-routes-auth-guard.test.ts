// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9686] The `/api/v1/datasources/:name/external/*` federation family requires
 * an authenticated caller — on every route, read and write alike.
 *
 * ## What this pins, and why it is driven through the real plugin
 *
 * The defect was NOT a missing line inside one handler; it was a missing edge
 * in the composition. `mountAndRecordDirectRoutes` resolved the `RestServer`'s
 * execution-context resolver and handed it to ONE of the two registrars it
 * mounts: `registerPackageRoutes` got the identity and applied the shared
 * anonymous floor, `registerExternalDatasourceRoutes` got nothing and checked
 * nothing. Being composed by `RestServer` is not itself a guard — `enforceAuth`
 * is a private method invoked inside that server's own handlers, not middleware
 * a direct mount passes through.
 *
 * So a pin that mounted the registrar itself and handed it a resolver would
 * verify the half that was never in doubt and stay green through the half that
 * was. This file boots `createRestApiPlugin(...).start(ctx)` — the real
 * composition, the production wiring — and drives the mounted handler table.
 * A future edit that keeps the guard but drops the resolver at the call site
 * fails here, which is the point.
 *
 * ## The two halves, in separate cases on purpose
 *
 * A guard is two claims, and a revert must be able to falsify them separately:
 *
 *  - anonymous callers are REFUSED, with the shared `401 UNAUTHENTICATED`
 *    envelope — asserted by status AND machine-readable `error.code`, never
 *    "not 200" (an unwired service answers 503, which would satisfy that and
 *    prove nothing) — and the service is never reached, so the refusal
 *    provably precedes the write on the two routes that write;
 *  - an ENTITLED caller still gets the real success status on the same five
 *    routes, on the same boot. This family is SDK-expressed
 *    (`datasources.external.*` on `ObjectStackClient`), so a guard that
 *    refused credentialed callers would be this fix breaking the feature, and
 *    a one-sided pin could not tell the two apart.
 *
 * Both credential kinds the platform admits are exercised, because the cheap
 * mistake here is to read only a better-auth session: that would refuse a
 * caller presenting a valid `sys_api_key`, a credential admitted everywhere
 * else on the surface. Identity comes from `RestServer`'s own resolver, so both
 * arrive through the platform's shared `resolveAuthzContext` rather than through
 * anything this family invented.
 */

import { describe, it, expect, vi } from 'vitest';
import { hashApiKey } from '@objectstack/core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
// The relative import carries its `.js` extension (see the note in
// `direct-mount-introspection.test.ts`): under `moduleResolution: nodenext` an
// extension-less one does not resolve and every symbol it names becomes `any`.
import { createRestApiPlugin } from './rest-api-plugin.js';

const BASE = '/api/v1';
const DS = 'pg_main';

/** A session token the fake auth service admits, and one it does not. */
const SESSION = 'sess-federation-caller';
/** A raw `sys_api_key` secret the fake engine admits by its at-rest hash. */
const API_KEY = 'osk_federation_caller_secret';

type Handler = (req: any, res: any) => any;

/**
 * The five routes of the family, each with the status it answers a credentialed
 * caller and the service method it dispatches to.
 *
 * `writes` marks the two that change state — the import creates a live
 * runtime-origin federated object, the refresh rewrites the cached catalog
 * snapshot. Both are asserted to be unreachable without an identity.
 */
const FAMILY = [
  { method: 'GET', url: `${BASE}/datasources/${DS}/external/tables`, ok: 200, call: 'listRemoteTables', writes: false },
  { method: 'POST', url: `${BASE}/datasources/${DS}/external/tables/customers/draft`, ok: 200, call: 'generateObjectDraft', writes: false },
  { method: 'POST', url: `${BASE}/datasources/${DS}/external/tables/customers/import`, ok: 201, call: 'importObject', writes: true },
  { method: 'POST', url: `${BASE}/datasources/${DS}/external/refresh-catalog`, ok: 200, call: 'refreshCatalog', writes: true },
  { method: 'POST', url: `${BASE}/datasources/${DS}/external/validate`, ok: 200, call: 'validateAll', writes: false },
] as const;

/** A host server whose registrations land in a real handler table. */
function createRecordingServer() {
  const table = new Map<string, Handler>();
  const on = (method: string) => vi.fn((path: string, handler: Handler) => {
    table.set(`${method} ${path}`, handler);
  });
  return {
    table,
    get: on('GET'), post: on('POST'), put: on('PUT'), delete: on('DELETE'), patch: on('PATCH'),
    use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}

/** Match a concrete URL against the table's `:param` patterns. */
function resolveRoute(table: Map<string, Handler>, method: string, url: string) {
  const urlSegs = url.split('/');
  for (const [key, handler] of table) {
    const [m, pattern] = key.split(' ');
    if (m !== method) continue;
    const patSegs = pattern.split('/');
    if (patSegs.length !== urlSegs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < patSegs.length; i++) {
      if (patSegs[i].startsWith(':')) params[patSegs[i].slice(1)] = urlSegs[i];
      else if (patSegs[i] !== urlSegs[i]) { ok = false; break; }
    }
    if (ok) return { handler, params };
  }
  return undefined;
}

function makeProtocol() {
  const engine = { registry: { getObject: (_n: string) => undefined, getRegisteredTypes: () => [] } };
  const services = new Map<string, any>([['package', { list: async () => [] }]]);
  return new ObjectStackProtocolImplementation(engine as any, () => services);
}

/**
 * The `external-datasource` service, every method a spy.
 *
 * Spies rather than stubs because "was it called" is half of what the anonymous
 * case asserts: a refusal that landed AFTER dispatch would have performed the
 * write it was refusing, and only the call record can tell the two apart.
 */
function federationServiceSpies() {
  return {
    listRemoteTables: vi.fn(async () => [{ name: 'customers' }]),
    generateObjectDraft: vi.fn(async () => ({ name: 'customers' })),
    importObject: vi.fn(async () => ({ name: 'customers' })),
    refreshCatalog: vi.fn(async () => ({ tables: {} })),
    validateAll: vi.fn(async () => ({ results: [{ datasource: DS, ok: true }] })),
  };
}

/**
 * Boot the REST plugin exactly as production does.
 *
 * `auth` and `objectql` are the two services `RestServer.resolveExecCtx`
 * consults to resolve a caller; a boot may wire either, both or neither, which
 * is how the cases below separate the credential kinds and the anonymous floor.
 */
async function bootFederation(opts: { withAuth?: boolean; withEngine?: boolean } = {}) {
  const server = createRecordingServer();
  const service = federationServiceSpies();
  const lookups: string[] = [];

  const authService = {
    api: {
      getSession: async ({ headers }: { headers: Headers }) =>
        headers?.get?.('authorization') === `Bearer ${SESSION}`
          ? { user: { id: 'u_federation' }, session: { userId: 'u_federation' } }
          : null,
    },
  };

  // A minimal engine: the api-key admission path reads `sys_api_key` by the
  // at-rest hash of the presented secret, and the grant aggregation that
  // follows reads membership/position objects that simply have no rows here.
  const engine = {
    find: async (object: string, query: any) => {
      if (object !== 'sys_api_key') return [];
      return query?.where?.key === hashApiKey(API_KEY) && query?.where?.revoked === false
        ? [{ id: 'key_1', key: hashApiKey(API_KEY), user_id: 'u_federation', revoked: false }]
        : [];
    },
  };

  const services: Record<string, unknown> = {
    'http.server': server,
    protocol: makeProtocol(),
    'external-datasource': service,
  };
  if (opts.withAuth) services.auth = authService;
  if (opts.withEngine) services.objectql = engine;

  const ctx = {
    registerService: vi.fn(),
    getService: vi.fn((name: string) => {
      lookups.push(name);
      if (name in services) return services[name];
      throw new Error(`Service '${name}' not found`);
    }),
    getServices: vi.fn(() => new Map(Object.entries(services))),
    hook: vi.fn(),
    trigger: vi.fn().mockResolvedValue(undefined),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    getKernel: vi.fn(),
  };
  await createRestApiPlugin(undefined as any).start!(ctx as any);
  // Boot itself resolves services; only what the REQUESTS resolve is evidence.
  lookups.length = 0;
  return { table: server.table, service, lookups };
}

/** Drive one concrete URL against the mounted table. */
async function call(
  table: Map<string, Handler>,
  route: { method: string; url: string },
  headers: Record<string, string>,
) {
  const entry = resolveRoute(table, route.method, route.url);
  expect(entry, `${route.method} ${route.url} must be mounted for this pin to mean anything`).toBeDefined();
  let body: any;
  let statusCode = 200;
  const res: any = {
    status: (c: number) => { statusCode = c; return res; },
    json: (b: any) => { body = b; },
    header: () => res,
    send: () => {},
  };
  await entry!.handler(
    {
      params: entry!.params,
      query: {},
      body: {},
      method: route.method,
      path: route.url,
      headers: { host: 'example.test', ...headers },
    },
    res,
  );
  return { statusCode, body };
}

describe('[#9686] the external-datasource federation family refuses an anonymous caller', () => {
  it('answers 401 UNAUTHENTICATED on every route — reads and writes — without reaching the service', async () => {
    const { table, service, lookups } = await bootFederation({ withAuth: true, withEngine: true });

    for (const route of FAMILY) {
      const { statusCode, body } = await call(table, route, {});

      // Status AND code. "not 200" is not the assertion: a deployment with no
      // federation service answers 503 through this same surface, and a pin
      // that accepted that would pass on a boot where nothing was guarded.
      expect(statusCode, `${route.method} ${route.url}`).toBe(401);
      expect(body?.success, `${route.method} ${route.url}`).toBe(false);
      expect(body?.error?.code, `${route.method} ${route.url}`).toBe('UNAUTHENTICATED');
    }

    // The refusal precedes dispatch: no service method ran, and the service was
    // never even looked up — so an anonymous caller also cannot learn from a
    // 503 which services this deployment has wired.
    for (const route of FAMILY) {
      expect(
        (service as any)[route.call],
        `${route.call} must not run for an unauthenticated caller`,
      ).not.toHaveBeenCalled();
    }
    expect(lookups).not.toContain('external-datasource');
  });

  it('refuses a caller presenting a credential the platform does not admit', async () => {
    const { table, service } = await bootFederation({ withAuth: true, withEngine: true });

    // The write route, with a session token and an api key that are both
    // simply wrong. A guard that admitted "any Authorization header" would
    // pass the case above and fail here.
    const { statusCode, body } = await call(
      table,
      FAMILY[2],
      { authorization: 'Bearer not-a-session', 'x-api-key': 'osk_not_a_key' },
    );

    expect(statusCode).toBe(401);
    expect(body?.error?.code).toBe('UNAUTHENTICATED');
    expect(service.importObject).not.toHaveBeenCalled();
  });

  it('fails closed when the deployment wires no way to resolve an identity', async () => {
    // No auth service, no engine — the shape a misconfigured or partially
    // started host has. There is no posture under which that opens the family.
    const { table, service } = await bootFederation();

    const { statusCode, body } = await call(table, FAMILY[2], { authorization: `Bearer ${SESSION}` });

    expect(statusCode).toBe(401);
    expect(body?.error?.code).toBe('UNAUTHENTICATED');
    expect(service.importObject).not.toHaveBeenCalled();
  });
});

describe('[#9686] the same boot still serves an entitled caller', () => {
  it('answers every route with its real success status for a session-authenticated caller', async () => {
    const { table, service } = await bootFederation({ withAuth: true });

    for (const route of FAMILY) {
      const { statusCode, body } = await call(table, route, { authorization: `Bearer ${SESSION}` });

      expect(statusCode, `${route.method} ${route.url}`).toBe(route.ok);
      expect(body?.success, `${route.method} ${route.url}`).toBe(true);
      expect((service as any)[route.call], `${route.call}`).toHaveBeenCalled();
    }

    // The write really executed for this caller — the half a guard breaking the
    // feature would take away, stated as a call rather than as a status alone.
    expect(service.importObject).toHaveBeenCalledWith(DS, 'customers', {});
  });

  it('admits an api-key caller, not only a better-auth session', async () => {
    // The SDK reaches this family (`datasources.external.*`), and a `sys_api_key`
    // is a credential the platform admits everywhere else. This boot wires NO
    // session for the key holder, so only the api-key admission path can
    // produce the identity that clears the floor.
    const { table, service } = await bootFederation({ withAuth: true, withEngine: true });

    const { statusCode, body } = await call(table, FAMILY[2], { 'x-api-key': API_KEY });

    expect(statusCode).toBe(201);
    expect(body?.success).toBe(true);
    expect(service.importObject).toHaveBeenCalledWith(DS, 'customers', {});
  });
});
