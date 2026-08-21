// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9686] The `/api/v1/datasources/:name/external/*` federation family requires
 * an authenticated caller — on every route, read and write alike — and
 * [#9901/#10255] a CAPABILITY above that on every route.
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
 * ## [#9901] "Entitled" is now two facts, and the middle of the axis is pinned
 *
 * Authentication was the whole gate until the 2026-08-20 ruling (verbatim:
 * 「其他接受你的建议。」) put `manage_platform_settings` on the two read twins
 * and `manage_metadata` on the two writes. So a THIRD posture now exists
 * between "anonymous" and "entitled" — authenticated, holding nothing — and it
 * gets its own cases below rather than being left to the two ends. Each asserts
 * `403` AND the machine-readable `PERMISSION_DENIED`, never "not 200": the 401
 * the anonymous cases already cover would satisfy that, which would mean the
 * credential was never read at all.
 *
 * The split itself is asserted, not just the refusals: a caller holding ONLY
 * `manage_platform_settings` clears the reads and is refused the writes, and a
 * caller holding ONLY `manage_metadata` the reverse. A single gate keyed on
 * either capability alone would pass an "unentitled is refused" case and fail
 * here, which is what makes the read/write split falsifiable rather than
 * merely written down.
 *
 * [#10255] `POST /external/validate` was the one route the #9901 ruling did
 * not name: no admin twin, no metadata created, so it kept the #9686
 * authentication floor — pinned here as an explicit `capability: null` row so
 * that gating it later had to change the table. That later card is #10255,
 * ruled 2026-08-20 (verbatim: 「同意你的意见。」, accepting option A): validate
 * takes the READ capability, because `validateAll` drives the same live
 * remote-schema introspection the read twins gate and reports on it. The row
 * now carries `READ_CAPABILITY`, and its case below flips from "still served
 * holding nothing" to "refused holding nothing" — deliberately, not by a
 * neighbour's loop swallowing it.
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
 * The five routes of the family, each with the status it answers an entitled
 * caller, the service method it dispatches to, and [#9901] the capability it
 * requires above authentication.
 *
 * `writes` marks the two that change state — the import creates a live
 * runtime-origin federated object, the refresh rewrites the cached catalog
 * snapshot. Both are asserted to be unreachable without an identity.
 *
 * [#10255] There is no `capability: null` row any more: `POST
 * /external/validate` carried one — spelled as an explicit `null` rather than
 * omitted, so that a later edit gating it had to change this table — and the
 * 2026-08-20 #10255 ruling is that later edit: validate is a read
 * (`validateAll` drives the same live remote introspection the read twins
 * gate), so its row now carries `READ_CAPABILITY` like its two read siblings.
 */
const READ_CAPABILITY = 'manage_platform_settings';
const WRITE_CAPABILITY = 'manage_metadata';

const FAMILY = [
  { method: 'GET', url: `${BASE}/datasources/${DS}/external/tables`, ok: 200, call: 'listRemoteTables', writes: false, capability: READ_CAPABILITY },
  { method: 'POST', url: `${BASE}/datasources/${DS}/external/tables/customers/draft`, ok: 200, call: 'generateObjectDraft', writes: false, capability: READ_CAPABILITY },
  { method: 'POST', url: `${BASE}/datasources/${DS}/external/tables/customers/import`, ok: 201, call: 'importObject', writes: true, capability: WRITE_CAPABILITY },
  { method: 'POST', url: `${BASE}/datasources/${DS}/external/refresh-catalog`, ok: 200, call: 'refreshCatalog', writes: true, capability: WRITE_CAPABILITY },
  { method: 'POST', url: `${BASE}/datasources/${DS}/external/validate`, ok: 200, call: 'validateAll', writes: false, capability: READ_CAPABILITY },
] as const;

/** Every capability an entitled caller needs to clear all five routes. */
const FULL_GRANT = [READ_CAPABILITY, WRITE_CAPABILITY] as const;

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
async function bootFederation(
  opts: { withAuth?: boolean; withEngine?: boolean; grants?: readonly string[] } = {},
) {
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

  /**
   * A minimal engine: the api-key admission path reads `sys_api_key` by the
   * at-rest hash of the presented secret, and the grant aggregation that
   * follows reads membership/position objects that simply have no rows here.
   *
   * [#9901] …except the two it now MUST have rows in. The capability gate reads
   * `systemPermissions`, which `resolveAuthzContext` aggregates off
   * `sys_user_permission_set` → `sys_permission_set`, so a boot with no engine
   * resolves an identity holding NOTHING — which is a real posture (pinned
   * below) but not the entitled one. `opts.grants` is what the caller
   * `u_federation` holds, so one fixture expresses every posture on the axis.
   *
   * The set is deliberately not `admin_full_access`: that platform set carries
   * `manage_platform_settings` among six other capabilities, so a gate keyed on
   * platform-admin posture rather than on the named capability would pass here
   * unnoticed — the same reason the twin-equivalence fixture builds its own.
   */
  const grants = opts.grants ?? FULL_GRANT;
  const GRANT_SET_ID = 'ps_federation_caller';
  const engine = {
    find: async (object: string, query: any) => {
      if (object === 'sys_api_key') {
        return query?.where?.key === hashApiKey(API_KEY) && query?.where?.revoked === false
          ? [{ id: 'key_1', key: hashApiKey(API_KEY), user_id: 'u_federation', revoked: false }]
          : [];
      }
      if (object === 'sys_user_permission_set') {
        return query?.where?.user_id === 'u_federation' && grants.length > 0
          ? [{ id: 'ups_1', user_id: 'u_federation', permission_set_id: GRANT_SET_ID, organization_id: null }]
          : [];
      }
      if (object === 'sys_permission_set') {
        const ids: string[] = query?.where?.id?.$in ?? [];
        return ids.includes(GRANT_SET_ID)
          ? [{
              id: GRANT_SET_ID,
              name: 'federation_caller',
              // JSON string — the spelling SQLite hands back, which the
              // resolver parses. Pinning the stored shape keeps the fixture on
              // the real read path.
              system_permissions: JSON.stringify([...grants]),
              object_permissions: '{}',
            }]
          : [];
      }
      return [];
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
    // [#9901] The engine is now part of what makes this caller ENTITLED, not
    // fixture noise: `systemPermissions` is aggregated off it, so a boot
    // without one resolves an identity holding nothing and every gated route
    // would answer 403. Wiring it here keeps this case measuring what it names
    // — the success arm — rather than quietly becoming a refusal case.
    const { table, service } = await bootFederation({ withAuth: true, withEngine: true });

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

describe('[#9901] the family requires a capability above authentication', () => {
  it('refuses an authenticated caller holding NOTHING on all five routes — 403 PERMISSION_DENIED, before the service', async () => {
    // [#10255] Five, not four: `POST /external/validate` joined the ruled set
    // on 2026-08-20, so there is no `capability: null` row left to filter out
    // and this loop runs the whole family.
    const { table, service, lookups } = await bootFederation({
      withAuth: true, withEngine: true, grants: [],
    });

    for (const route of FAMILY) {
      const { statusCode, body } = await call(table, route, { authorization: `Bearer ${SESSION}` });

      // Status AND code. "not 200" would be satisfied by the 401 the anonymous
      // cases already cover, which would mean the credential was never read.
      expect(statusCode, `${route.method} ${route.url}`).toBe(403);
      expect(body?.success, `${route.method} ${route.url}`).toBe(false);
      expect(body?.error?.code, `${route.method} ${route.url}`).toBe('PERMISSION_DENIED');
      // The named capability is in the message, because that is the one thing a
      // refused caller must be able to act on.
      expect(body?.error?.message, `${route.method} ${route.url}`).toContain(route.capability);
    }

    // The refusal precedes dispatch — so on the two routes that WRITE, nothing
    // was created before the caller was turned away.
    for (const route of FAMILY) {
      expect(
        (service as any)[route.call],
        `${route.call} must not run for an unentitled caller`,
      ).not.toHaveBeenCalled();
    }
    expect(lookups).not.toContain('external-datasource');
  });

  it('the read/write split is real: `manage_platform_settings` alone clears the reads and is refused the writes', async () => {
    const { table } = await bootFederation({
      withAuth: true, withEngine: true, grants: [READ_CAPABILITY],
    });

    for (const route of FAMILY.filter((r) => r.capability === READ_CAPABILITY)) {
      const { statusCode } = await call(table, route, { authorization: `Bearer ${SESSION}` });
      expect(statusCode, `${route.method} ${route.url}`).toBe(route.ok);
    }
    for (const route of FAMILY.filter((r) => r.capability === WRITE_CAPABILITY)) {
      const { statusCode, body } = await call(table, route, { authorization: `Bearer ${SESSION}` });
      expect(statusCode, `${route.method} ${route.url}`).toBe(403);
      expect(body?.error?.code, `${route.method} ${route.url}`).toBe('PERMISSION_DENIED');
    }
  });

  it('…and the other way round: `manage_metadata` alone clears the writes and is refused the reads', async () => {
    // Both directions, because a gate that required EITHER capability on every
    // route would satisfy the unentitled case above and the two halves of the
    // previous case would still pass one at a time. Only the crossed pair can
    // tell "two capabilities" from "one capability spelled twice".
    const { table } = await bootFederation({
      withAuth: true, withEngine: true, grants: [WRITE_CAPABILITY],
    });

    for (const route of FAMILY.filter((r) => r.capability === WRITE_CAPABILITY)) {
      const { statusCode } = await call(table, route, { authorization: `Bearer ${SESSION}` });
      expect(statusCode, `${route.method} ${route.url}`).toBe(route.ok);
    }
    for (const route of FAMILY.filter((r) => r.capability === READ_CAPABILITY)) {
      const { statusCode, body } = await call(table, route, { authorization: `Bearer ${SESSION}` });
      expect(statusCode, `${route.method} ${route.url}`).toBe(403);
      expect(body?.error?.code, `${route.method} ${route.url}`).toBe('PERMISSION_DENIED');
    }
  });

  it('[#10255] POST /external/validate requires the READ capability — the authentication-floor era is over', async () => {
    // This case is the previous pin FLIPPED, deliberately. Until the
    // 2026-08-20 #10255 ruling it asserted the exact opposite — an
    // authenticated caller holding nothing was SERVED here while refused the
    // other four — because #9901's ruling did not name this route. The ruling
    // that changed it is recorded on #10255 (option A): `validateAll` drives
    // the same live remote-schema introspection the read twins gate, so
    // validate is a read and answers to the read capability.
    const { table, service } = await bootFederation({
      withAuth: true, withEngine: true, grants: [],
    });

    const validate = FAMILY.find((r) => r.call === 'validateAll')!;
    const { statusCode, body } = await call(table, validate, { authorization: `Bearer ${SESSION}` });

    // Refused with the capability NAMED — the one thing the refused caller can
    // act on — and the service never ran, so an unentitled caller cannot
    // trigger remote introspection as a side effect of being refused.
    expect(statusCode).toBe(403);
    expect(body?.success).toBe(false);
    expect(body?.error?.code).toBe('PERMISSION_DENIED');
    expect(body?.error?.message).toContain(READ_CAPABILITY);
    expect(service.validateAll).not.toHaveBeenCalled();
  });

  it('[#10255] …and `manage_platform_settings` alone clears it, like its two read siblings', async () => {
    // The success half of the flip, on its own boot: the capability that
    // clears the read twins clears validate too — this is what "joined the
    // reads" means, stated as a served request rather than a table row.
    const { table, service } = await bootFederation({
      withAuth: true, withEngine: true, grants: [READ_CAPABILITY],
    });

    const validate = FAMILY.find((r) => r.call === 'validateAll')!;
    const { statusCode, body } = await call(table, validate, { authorization: `Bearer ${SESSION}` });

    expect(statusCode).toBe(validate.ok);
    expect(body?.success).toBe(true);
    expect(service.validateAll).toHaveBeenCalled();
  });

  it('a capability the caller does not hold is not granted by an api key either', async () => {
    // The api-key admission path seeds `permissions` from the key's scopes and
    // then aggregates grants off the SAME `sys_*` tables — so an unentitled key
    // holder is refused exactly like an unentitled session. A gate that read
    // the key's scopes instead of `systemPermissions` would pass the session
    // cases above and open the family to every key.
    const { table, service } = await bootFederation({
      withAuth: true, withEngine: true, grants: [],
    });

    const { statusCode, body } = await call(table, FAMILY[2], { 'x-api-key': API_KEY });

    expect(statusCode).toBe(403);
    expect(body?.error?.code).toBe('PERMISSION_DENIED');
    expect(service.importObject).not.toHaveBeenCalled();
  });
});
