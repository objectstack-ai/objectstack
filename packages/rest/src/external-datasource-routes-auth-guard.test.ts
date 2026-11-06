// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9686] The `/api/v1/datasources/:name/external/*` federation family requires
 * an authenticated caller — on every route, read and write alike — and
 * [#9901 / commit 6ce58a735] a CAPABILITY above that on every route.
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
 * `manage_platform_settings` clears the reads and is refused the writes. A
 * single gate keyed on either capability alone would pass an "unentitled is
 * refused" case and fail here, which is what makes the read/write split
 * falsifiable rather than merely written down.
 *
 * [2026-11-03 ruling] …and a caller holding ONLY `manage_metadata` is refused
 * EVERY route, the writes included. Seeing a datasource's remote structure
 * needs the read capability on every route, and both writes answer with it
 * (the import's generated definition, the refresh's catalog), so a write needs
 * both capabilities — maintainer ruling (verbatim: 「两个写接口同时要求读权限
 * (Recommended)」). Until then this file pinned the opposite ("`manage_metadata`
 * alone clears the writes"); that case is FLIPPED below rather than deleted,
 * and the table's `capabilities` column now lists every capability a route
 * requires, so a write row carries both.
 *
 * [commit 6ce58a735] `POST /external/validate` was the one route the #9901 ruling did
 * not name: no admin twin, no metadata created, so it kept the #9686
 * authentication floor — pinned here as an explicit `capability: null` row so
 * that gating it later had to change the table. That later edit is commit 6ce58a735,
 * ruled 2026-08-20 (verbatim: 「同意你的意见。」, accepting option A): validate
 * takes the READ capability, because validation drives the same live
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
import { walledCatalogWriteVerdict } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
// The relative import carries its `.js` extension (see the note in
// `direct-mount-introspection.test.ts`): under `moduleResolution: nodenext` an
// extension-less one does not resolve and every symbol it names becomes `any`.
import { createRestApiPlugin } from './rest-api-plugin.js';
import { registerExternalDatasourceRoutes } from './external-datasource-routes.js';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';

const BASE = '/api/v1';
const DS = 'pg_main';

/** A session token the fake auth service admits, and one it does not. */
const SESSION = 'sess-federation-caller';
/** A raw `sys_api_key` secret the fake engine admits by its at-rest hash. */
const API_KEY = 'osk_federation_caller_secret';

type Handler = (req: any, res: any) => any;

/**
 * The five routes of the family, each with the status it answers an entitled
 * caller, the service method it dispatches to, and [#9901] the capabilities it
 * requires above authentication — [2026-11-03 ruling] the read capability on
 * every row, the write capability added on the two writes.
 *
 * `writes` marks the two that change state — the import creates a live
 * runtime-origin federated object, the refresh rewrites the cached catalog
 * snapshot. Both are asserted to be unreachable without an identity.
 *
 * [commit 6ce58a735] There is no `capability: null` row any more: `POST
 * /external/validate` carried one — spelled as an explicit `null` rather than
 * omitted, so that a later edit gating it had to change this table — and the
 * 2026-08-20 ruling, landed as commit 6ce58a735, is that later edit: validate is a read
 * (validation drives the same live remote introspection the read twins
 * gate), so its row now carries `READ_CAPABILITY` like its two read siblings.
 *
 * [commit e634ecf6a] The validate row's `call` is the SCOPED composition
 * (`validateDatasource`), which is what the route dispatches to since the
 * fan-out fix; the fixture keeps a `validateAll` spy beside it precisely so a
 * regression to the whole-farm sweep is visible here rather than silent.
 */
const READ_CAPABILITY = 'manage_platform_settings';
const WRITE_CAPABILITY = 'manage_metadata';

const READS = [READ_CAPABILITY] as const;
const WRITES = [READ_CAPABILITY, WRITE_CAPABILITY] as const;

const FAMILY = [
  { method: 'GET', url: `${BASE}/datasources/${DS}/external/tables`, ok: 200, call: 'listRemoteTables', writes: false, capabilities: READS },
  { method: 'POST', url: `${BASE}/datasources/${DS}/external/tables/customers/draft`, ok: 200, call: 'generateObjectDraft', writes: false, capabilities: READS },
  { method: 'POST', url: `${BASE}/datasources/${DS}/external/tables/customers/import`, ok: 201, call: 'importObject', writes: true, capabilities: WRITES },
  { method: 'POST', url: `${BASE}/datasources/${DS}/external/refresh-catalog`, ok: 200, call: 'refreshCatalog', writes: true, capabilities: WRITES },
  { method: 'POST', url: `${BASE}/datasources/${DS}/external/validate`, ok: 200, call: 'validateDatasource', writes: false, capabilities: READS },
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
    // [commit e634ecf6a] `POST /external/validate` dispatches to the SCOPED composition
    // now. The whole-farm `validateAll` stays in the set, spied and never
    // expected to run: "the service never ran" then means the method the
    // route actually reaches, and a regression to the sweep shows up as a
    // call on a spy nobody expects rather than as silence.
    validateAll: vi.fn(async () => ({ results: [{ datasource: DS, ok: true }] })),
    validateDatasource: vi.fn(async (name: string) => ({ results: [{ datasource: name, ok: true }] })),
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
          ? { user: { id: 'u_federation' }, session: { userId: 'u_federation', activeOrganizationId: 'o1' } }
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
   *
   * The grant is stamped with `o1`, and both credentials act in `o1` (the
   * session's active organization, the key's stamped one): a grant applies
   * only in its own organization.
   */
  const grants = opts.grants ?? FULL_GRANT;
  const GRANT_SET_ID = 'ps_federation_caller';
  const engine = {
    find: async (object: string, query: any) => {
      if (object === 'sys_api_key') {
        return query?.where?.key === hashApiKey(API_KEY)
          ? [{ id: 'key_1', key: hashApiKey(API_KEY), user_id: 'u_federation', revoked: false, active_organization_id: 'o1' }]
          : [];
      }
      // The key's owner exists: an API key authenticates only as an owner who exists.
      if (object === 'sys_user') return query?.where?.id === 'u_federation' ? [{ id: 'u_federation' }] : [];
      if (object === 'sys_user_permission_set') {
        return query?.where?.user_id === 'u_federation' && grants.length > 0
          ? [{ id: 'ups_1', user_id: 'u_federation', permission_set_id: GRANT_SET_ID, permission_set: 'federation_caller', organization_id: 'o1' }]
          : [];
      }
      if (object === 'sys_permission_set') {
        // By id (a position binding) or by name (a user grant, ADR-0131 D4).
        const ids: string[] = query?.where?.id?.$in ?? [];
        const names: string[] = query?.where?.name?.$in ?? [];
        return ids.includes(GRANT_SET_ID) || names.includes('federation_caller')
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

  // [ADR-0131 D3/D4] The set's definition, which the resolver reads its body from.
  bindTestSecurityCatalog(engine, { permissions: [{ name: 'federation_caller', systemPermissions: [...grants] }] });

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
    // [commit 6ce58a735] Five, not four: `POST /external/validate` joined the ruled set
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
      // Every capability the route requires is named in the message, because
      // that is the one thing a refused caller must be able to act on — on a
      // write route that is both of them, in one answer.
      for (const capability of route.capabilities) {
        expect(body?.error?.message, `${route.method} ${route.url}`).toContain(capability);
      }
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

    for (const route of FAMILY.filter((r) => !r.writes)) {
      const { statusCode } = await call(table, route, { authorization: `Bearer ${SESSION}` });
      expect(statusCode, `${route.method} ${route.url}`).toBe(route.ok);
    }
    for (const route of FAMILY.filter((r) => r.writes)) {
      const { statusCode, body } = await call(table, route, { authorization: `Bearer ${SESSION}` });
      expect(statusCode, `${route.method} ${route.url}`).toBe(403);
      expect(body?.error?.code, `${route.method} ${route.url}`).toBe('PERMISSION_DENIED');
      expect(body?.error?.message, `${route.method} ${route.url}`).toContain(WRITE_CAPABILITY);
    }
  });

  it('seeing remote structure needs the read capability on every route, writes included: `manage_metadata` alone is refused all five, the writes with the read routes\' status and code', async () => {
    // [2026-11-03 ruling] FLIPPED, deliberately: this case asserted until then
    // that `manage_metadata` alone CLEARED the two writes. Both writes answer
    // with remote structure, so each requires the read capability as well as
    // the write one, and a caller lacking the read capability is told so on
    // every route in the same words.
    //
    // It is still the crossed half of the previous case: a gate admitting
    // EITHER capability would serve the reads here, and a gate asking only the
    // write capability of a write (the shape this case used to pin) would
    // serve the writes here; both now fail.
    const { table, service, lookups } = await bootFederation({
      withAuth: true, withEngine: true, grants: [WRITE_CAPABILITY],
    });
    const headers = { authorization: `Bearer ${SESSION}` };

    const readRefusal = await call(table, FAMILY.find((r) => r.call === 'listRemoteTables')!, headers);
    expect(readRefusal.statusCode).toBe(403);
    expect(readRefusal.body?.error?.code).toBe('PERMISSION_DENIED');

    for (const route of FAMILY) {
      const { statusCode, body } = await call(table, route, headers);
      // The read routes' answer, status AND code, compared to it rather than
      // only to a literal: one rule, one refusal.
      expect(statusCode, `${route.method} ${route.url}`).toBe(readRefusal.statusCode);
      expect(body?.success, `${route.method} ${route.url}`).toBe(false);
      expect(body?.error?.code, `${route.method} ${route.url}`).toBe(readRefusal.body?.error?.code);
      // It names the capability the caller lacks, and not the one it holds.
      expect(body?.error?.message, `${route.method} ${route.url}`).toContain(READ_CAPABILITY);
      expect(body?.error?.message, `${route.method} ${route.url}`).not.toContain(WRITE_CAPABILITY);
    }

    // Refused before dispatch: no import ran, no catalog was refreshed, and the
    // service was never even looked up.
    for (const route of FAMILY) {
      expect((service as any)[route.call], `${route.call} must not run without the read capability`).not.toHaveBeenCalled();
    }
    expect(lookups).not.toContain('external-datasource');
  });

  it('…and holding both capabilities clears the writes: the read capability is added to the write one, not swapped for it', async () => {
    // The control for the flip above, on its own boot with a grant of exactly
    // the two capabilities: the writes are served, and their services ran.
    const { table, service } = await bootFederation({
      withAuth: true, withEngine: true, grants: [READ_CAPABILITY, WRITE_CAPABILITY],
    });

    for (const route of FAMILY.filter((r) => r.writes)) {
      const { statusCode, body } = await call(table, route, { authorization: `Bearer ${SESSION}` });
      expect(statusCode, `${route.method} ${route.url}`).toBe(route.ok);
      expect(body?.success, `${route.method} ${route.url}`).toBe(true);
    }
    expect(service.importObject).toHaveBeenCalledWith(DS, 'customers', {});
    expect(service.refreshCatalog).toHaveBeenCalledWith(DS);
  });

  it('[#10255] POST /external/validate requires the READ capability — the authentication-floor era is over', async () => {
    // This case is the previous pin FLIPPED, deliberately. Until the
    // 2026-08-20 ruling (commit 6ce58a735) it asserted the exact opposite — an
    // authenticated caller holding nothing was SERVED here while refused the
    // other four — because #9901's ruling did not name this route. The ruling
    // that changed it is recorded in commit 6ce58a735's message (option A): validation drives
    // the same live remote-schema introspection the read twins gate, so
    // validate is a read and answers to the read capability.
    const { table, service } = await bootFederation({
      withAuth: true, withEngine: true, grants: [],
    });

    const validate = FAMILY.find((r) => r.call === 'validateDatasource')!;
    const { statusCode, body } = await call(table, validate, { authorization: `Bearer ${SESSION}` });

    // Refused with the capability NAMED — the one thing the refused caller can
    // act on — and the service never ran, so an unentitled caller cannot
    // trigger remote introspection as a side effect of being refused.
    expect(statusCode).toBe(403);
    expect(body?.success).toBe(false);
    expect(body?.error?.code).toBe('PERMISSION_DENIED');
    expect(body?.error?.message).toContain(READ_CAPABILITY);
    expect(service.validateDatasource).not.toHaveBeenCalled();
    expect(service.validateAll).not.toHaveBeenCalled();
  });

  it('[#10255] …and `manage_platform_settings` alone clears it, like its two read siblings', async () => {
    // The success half of the flip, on its own boot: the capability that
    // clears the read twins clears validate too — this is what "joined the
    // reads" means, stated as a served request rather than a table row.
    const { table, service } = await bootFederation({
      withAuth: true, withEngine: true, grants: [READ_CAPABILITY],
    });

    const validate = FAMILY.find((r) => r.call === 'validateDatasource')!;
    const { statusCode, body } = await call(table, validate, { authorization: `Bearer ${SESSION}` });

    expect(statusCode).toBe(validate.ok);
    expect(body?.success).toBe(true);
    expect(service.validateDatasource).toHaveBeenCalledWith(DS);
    // [commit e634ecf6a] …and the served request did NOT fan out across every datasource.
    expect(service.validateAll).not.toHaveBeenCalled();
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

// ── [ADR-0131 D3 · D12 items 7–8 · D11] the import is a write to the environment's catalog ──
//
// Under a walled tenancy posture (`isolated`, `group`) every organization shares
// the environment's metadata catalog, and every write to it is the platform
// operator's: the one predicate is `walledCatalogWriteVerdict`
// (`@objectstack/metadata-core`), which the `/meta` save door asks after its
// capability gate. An import saves an object into that catalog, so the import
// route asks the same verdict, right after this family's capability gate and
// before the service is looked up. Inert under `single` and with no `tenancy`
// service; the platform operator rung and `isSystem` are admitted.
//
// The registrar is mounted directly here, over a resolver that states the
// caller's ADR-0095 posture rung, because the rung is what the verdict reads
// and the plugin-boot fixture above derives none. The posture is read off the
// registrar's own kernel, the one its `external-datasource` lookup reads.

const IMPORT_ROUTE = FAMILY.find((r) => r.call === 'importObject')!;
const LIST_ROUTE = FAMILY.find((r) => r.call === 'listRemoteTables')!;

/** The kernel's rejection for a service nobody registered, branded as `PluginLoader.getService` brands it. */
const notRegistered = (name: string) =>
  Object.assign(new Error(`Service '${name}' not found`), {
    __objectstackServiceNotRegistered: true,
    code: 'SERVICE_NOT_REGISTERED',
    serviceName: name,
  });

function mountWithTenancy(opts: {
  /** The `tenancy` service the kernel answers, `'none'` for no registration, `'failing'` for one that cannot answer. */
  tenancy: { posture: string } | 'none' | 'failing';
  /** The caller's ADR-0095 posture rung. */
  posture?: string;
  grants?: readonly string[];
}) {
  const server = createRecordingServer();
  const service = federationServiceSpies();
  const lookups: string[] = [];
  const kernel = {
    getServiceAsync: async (name: string) => {
      lookups.push(`kernel:${name}`);
      if (name !== 'tenancy' || opts.tenancy === 'none') throw notRegistered(name);
      if (opts.tenancy === 'failing') throw new Error('the tenancy store did not answer');
      return opts.tenancy;
    },
  };
  const ctx = {
    getService: vi.fn((name: string) => {
      lookups.push(name);
      if (name === 'external-datasource') return service;
      throw notRegistered(name);
    }),
    getKernel: () => kernel,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  const grants = opts.grants ?? FULL_GRANT;
  registerExternalDatasourceRoutes(server as any, ctx as any, BASE, {
    resolveExecutionContext: async () => ({
      userId: 'u_federation',
      systemPermissions: [...grants],
      ...(opts.posture !== undefined ? { posture: opts.posture } : {}),
    }),
  });
  return { table: server.table, service, lookups };
}

describe('[ADR-0131 D12 items 7–8] under a walled tenancy posture the import is the platform operator\'s, like every write to the environment\'s catalog', () => {
  for (const posture of ['group', 'isolated'] as const) {
    it(`${posture}: an organization administrator holding both federation capabilities is refused the import 403 PERMISSION_DENIED, before the service is looked up`, async () => {
      const { table, service, lookups } = mountWithTenancy({ tenancy: { posture }, posture: 'TENANT_ADMIN' });

      const { statusCode, body } = await call(table, IMPORT_ROUTE, {});

      expect(statusCode).toBe(403);
      expect(body?.success).toBe(false);
      expect(body?.error?.code).toBe('PERMISSION_DENIED');
      expect(body?.error?.message).toContain(`'${posture}' tenancy posture`);
      expect(body?.error?.message).toContain('ADR-0131 D3, D12 items 7–8, D11');
      expect(service.importObject).not.toHaveBeenCalled();
      expect(lookups).not.toContain('external-datasource');
    });
  }

  it('the refusal is the walled verdict the metadata save door answers for an object, not a sentence of this family\'s own', async () => {
    const { table } = mountWithTenancy({ tenancy: { posture: 'group' }, posture: 'TENANT_ADMIN' });

    const { body } = await call(table, IMPORT_ROUTE, {});

    const verdict = walledCatalogWriteVerdict({ type: 'object', tenancyPosture: 'group', callerPosture: 'TENANT_ADMIN' });
    expect(verdict.allowed).toBe(false);
    expect(body?.error?.message).toBe(verdict.allowed ? undefined : verdict.message);
  });

  it('the capability gate still answers first: a caller lacking the write capability is told which capability, not the posture', async () => {
    const { table, service } = mountWithTenancy({
      tenancy: { posture: 'group' }, posture: 'TENANT_ADMIN', grants: [READ_CAPABILITY],
    });

    const { statusCode, body } = await call(table, IMPORT_ROUTE, {});

    expect(statusCode).toBe(403);
    expect(body?.error?.code).toBe('PERMISSION_DENIED');
    expect(body?.error?.message).toContain(WRITE_CAPABILITY);
    expect(body?.error?.message).not.toContain('tenancy posture');
    expect(service.importObject).not.toHaveBeenCalled();
  });

  it('a read writes no catalog item: the same organization administrator still lists the remote tables under a wall', async () => {
    const { table, service } = mountWithTenancy({ tenancy: { posture: 'group' }, posture: 'TENANT_ADMIN' });

    const { statusCode, body } = await call(table, LIST_ROUTE, {});

    expect(statusCode).toBe(LIST_ROUTE.ok);
    expect(body?.success).toBe(true);
    expect(service.listRemoteTables).toHaveBeenCalledWith(DS, { schema: undefined });
  });

  it('control: the platform operator imports under a wall', async () => {
    const { table, service } = mountWithTenancy({ tenancy: { posture: 'group' }, posture: 'PLATFORM_ADMIN' });

    const { statusCode, body } = await call(table, IMPORT_ROUTE, {});

    expect(statusCode).toBe(IMPORT_ROUTE.ok);
    expect(body?.success).toBe(true);
    expect(service.importObject).toHaveBeenCalledWith(DS, 'customers', {});
  });

  it('control: under `single`, and with no tenancy service at all, the same organization administrator imports as before', async () => {
    for (const tenancy of [{ posture: 'single' }, 'none'] as const) {
      const { table, service } = mountWithTenancy({ tenancy, posture: 'TENANT_ADMIN' });

      const { statusCode, body } = await call(table, IMPORT_ROUTE, {});

      expect(statusCode, JSON.stringify(tenancy)).toBe(IMPORT_ROUTE.ok);
      expect(body?.success, JSON.stringify(tenancy)).toBe(true);
      expect(service.importObject, JSON.stringify(tenancy)).toHaveBeenCalledWith(DS, 'customers', {});
    }
  });

  it('a tenancy service that is registered and cannot answer refuses 503 SERVICE_UNAVAILABLE, never a permit', async () => {
    const { table, service } = mountWithTenancy({ tenancy: 'failing', posture: 'TENANT_ADMIN' });

    const { statusCode, body } = await call(table, IMPORT_ROUTE, {});

    expect(statusCode).toBe(503);
    expect(body?.success).toBe(false);
    expect(body?.error?.code).toBe('SERVICE_UNAVAILABLE');
    expect(service.importObject).not.toHaveBeenCalled();
  });
});

// The catalog refresh is the family's other write: it rewrites the datasource's
// cached `external_catalog` snapshot, an item of the same environment-wide
// catalog, so it answers to the same walled verdict for that type, in the same
// order of checks.

const REFRESH_ROUTE = FAMILY.find((r) => r.call === 'refreshCatalog')!;

describe('[ADR-0131 D12 items 7–8] under a walled tenancy posture the catalog refresh is the platform operator\'s, like every write to the environment\'s catalog', () => {
  for (const posture of ['group', 'isolated'] as const) {
    it(`${posture}: an organization administrator holding both federation capabilities is refused the refresh 403 PERMISSION_DENIED, before the service is looked up`, async () => {
      const { table, service, lookups } = mountWithTenancy({ tenancy: { posture }, posture: 'TENANT_ADMIN' });

      const { statusCode, body } = await call(table, REFRESH_ROUTE, {});

      expect(statusCode).toBe(403);
      expect(body?.success).toBe(false);
      expect(body?.error?.code).toBe('PERMISSION_DENIED');
      expect(body?.error?.message).toContain(`'${posture}' tenancy posture`);
      expect(body?.error?.message).toContain('ADR-0131 D3, D12 items 7–8, D11');
      expect(service.refreshCatalog).not.toHaveBeenCalled();
      expect(lookups).not.toContain('external-datasource');
    });
  }

  it('the refusal is the walled verdict the metadata save door answers for an external catalog', async () => {
    const { table } = mountWithTenancy({ tenancy: { posture: 'group' }, posture: 'TENANT_ADMIN' });

    const { body } = await call(table, REFRESH_ROUTE, {});

    const verdict = walledCatalogWriteVerdict({ type: 'external_catalog', tenancyPosture: 'group', callerPosture: 'TENANT_ADMIN' });
    expect(verdict.allowed).toBe(false);
    expect(body?.error?.message).toBe(verdict.allowed ? undefined : verdict.message);
  });

  it('the capability gate still answers first: a caller lacking the write capability is told which capability, not the posture', async () => {
    const { table, service } = mountWithTenancy({
      tenancy: { posture: 'group' }, posture: 'TENANT_ADMIN', grants: [READ_CAPABILITY],
    });

    const { statusCode, body } = await call(table, REFRESH_ROUTE, {});

    expect(statusCode).toBe(403);
    expect(body?.error?.code).toBe('PERMISSION_DENIED');
    expect(body?.error?.message).toContain(WRITE_CAPABILITY);
    expect(body?.error?.message).not.toContain('tenancy posture');
    expect(service.refreshCatalog).not.toHaveBeenCalled();
  });

  it('control: the platform operator refreshes under a wall', async () => {
    const { table, service } = mountWithTenancy({ tenancy: { posture: 'group' }, posture: 'PLATFORM_ADMIN' });

    const { statusCode, body } = await call(table, REFRESH_ROUTE, {});

    expect(statusCode).toBe(REFRESH_ROUTE.ok);
    expect(body?.success).toBe(true);
    expect(service.refreshCatalog).toHaveBeenCalledWith(DS);
  });

  it('control: under `single`, and with no tenancy service at all, the same organization administrator refreshes as before', async () => {
    for (const tenancy of [{ posture: 'single' }, 'none'] as const) {
      const { table, service } = mountWithTenancy({ tenancy, posture: 'TENANT_ADMIN' });

      const { statusCode, body } = await call(table, REFRESH_ROUTE, {});

      expect(statusCode, JSON.stringify(tenancy)).toBe(REFRESH_ROUTE.ok);
      expect(body?.success, JSON.stringify(tenancy)).toBe(true);
      expect(service.refreshCatalog, JSON.stringify(tenancy)).toHaveBeenCalledWith(DS);
    }
  });

  it('a tenancy service that is registered and cannot answer refuses the refresh 503 SERVICE_UNAVAILABLE, never a permit', async () => {
    const { table, service } = mountWithTenancy({ tenancy: 'failing', posture: 'TENANT_ADMIN' });

    const { statusCode, body } = await call(table, REFRESH_ROUTE, {});

    expect(statusCode).toBe(503);
    expect(body?.success).toBe(false);
    expect(body?.error?.code).toBe('SERVICE_UNAVAILABLE');
    expect(service.refreshCatalog).not.toHaveBeenCalled();
  });
});
