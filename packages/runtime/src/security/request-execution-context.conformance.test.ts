// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The conformance test of ruling record 6227928430, item 4: one request driven
 * through `resolveRequestExecutionContext` (`@objectstack/core`) and through
 * each door converted onto it must give one identical context.
 *
 * ## The shape
 *
 * Each converted door is one row of {@link DOORS}: how a request is driven
 * through the door's OWN entry, and the named parameters the door declares to
 * the function. Every request in {@link REQUESTS} goes through both, and the
 * two contexts must be equal. A later slice converts its door and adds it as
 * one more row.
 *
 * Who a request resolves to is the request's {@link Request.principal} at every
 * door, except where a door's declared parameters authenticate nobody for it
 * ({@link expectedPrincipal}: a door that requires a session API, on a host
 * with no auth service). Across rows, every door that resolves a principal
 * resolves the SAME one ({@link IDENTITY}): the named parameters decide what a
 * door withholds or adds around the identity, and whether it admits at all,
 * never who the caller is.
 *
 * A door's own additions after the function returns (REST's `__kernel` and
 * `__authEnvironmentId`, see its `drive`) are not the composition and are
 * set aside before the comparison, by name.
 *
 * ## Why the requests are these
 *
 * Each named parameter changes the answer for at least one request below, so a
 * row whose declared parameters drift from what its door really passes fails
 * here instead of agreeing by accident:
 *
 * | request | the parameters it tells apart |
 * |:--|:--|
 * | no credential | `anonymous` |
 * | a session cookie, a gated user, a session bearer, `Accept-Language` | `session`, `authGate`, `accessToken`, `requestLocale`, `localization` |
 * | the same session while no gate is active | `authGate` (`'resolved'` against `'reread-when-active'`) |
 * | an API key | `credentials` |
 * | an ex-member's organization-stamped key under a walled posture | `tenancy` |
 * | an API key on a host with no auth service | `sessionApi` |
 *
 * The runtime door's `/mcp` face (an OAuth access token) is not a row: its
 * verification and scope interpretation are the door's own, ahead of the call,
 * and its pins are `resolve-execution-context.oauth-organization.test.ts` and
 * the agent-principal cases of `resolve-execution-context.test.ts`.
 */

import { describe, it, expect } from 'vitest';

import type { ExecutionContext } from '@objectstack/spec/kernel';
import { preferredLocaleFromHeader } from '@objectstack/spec/system';
import { resolveRequestExecutionContext, type RequestExecutionContextInput } from '@objectstack/core';

import { RestServer } from '@objectstack/rest';

import { hashApiKey } from './api-key.js';
import { resolveExecutionContext } from './resolve-execution-context.js';
import { bindCatalogFromTables } from './security-catalog.testkit.js';

const ORG = 'org_alpha';
const COOKIE = 'better-auth.session_token=tok3n.c2ln';
const KEY = 'osk_conformance_key';
const EX_MEMBER_KEY = 'osk_conformance_ex_member';
const FUTURE = '2999-01-01T00:00:00Z';

/** One deployment every row is driven against: its engine and its kernel services. */
interface World {
  ql: unknown;
  services: Record<string, unknown>;
}

function world(opts: { auth: boolean; gateActive?: boolean }): World {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    sys_api_key: [
      { id: 'k_live', key: hashApiKey(KEY), revoked: false, user_id: 'u_key', active_organization_id: ORG, expires_at: FUTURE },
      { id: 'k_ex', key: hashApiKey(EX_MEMBER_KEY), revoked: false, user_id: 'u_ex', active_organization_id: ORG, expires_at: FUTURE },
    ],
    sys_member: [
      { user_id: 'u_key', organization_id: ORG, role: 'member' },
      { user_id: 'u_ses', organization_id: ORG, role: 'admin' },
    ],
    sys_user_position: [{ user_id: 'u_ses', position: 'sales_rep', organization_id: ORG }],
    sys_user_permission_set: [{ user_id: 'u_key', permission_set: 'contact_reader', organization_id: null }],
    sys_permission_set: [
      { id: 'ps_sales', name: 'sales_user', object_permissions: '{}' },
      { id: 'ps_contact', name: 'contact_reader', system_permissions: '["export_reports"]', object_permissions: '{}' },
    ],
    sys_position: [{ id: 'pos_sales', name: 'sales_rep', organization_id: null }],
    sys_position_permission_set: [{ position_id: 'pos_sales', permission_set_id: 'ps_sales' }],
  };
  const ql = bindCatalogFromTables({
    async find(object: string, q: { where?: Record<string, unknown>; limit?: number } | undefined) {
      const rows = (tables[object] ?? []).filter((row) => Object.entries(q?.where ?? {}).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fixture: unsupported combinator ${k}`);
        if (v !== null && typeof v === 'object') {
          return Array.isArray((v as { $in?: unknown[] }).$in) ? (v as { $in: unknown[] }).$in.includes(row[k]) : true;
        }
        return (v ?? null) === (row[k] ?? null);
      }));
      return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
    },
  }, tables);

  const services: Record<string, unknown> = {
    tenancy: { posture: 'isolated' },
    settings: {
      async get(namespace: string, key: string) {
        const values: Record<string, string> = { 'localization.timezone': 'Europe/Paris', 'localization.locale': 'fr-FR' };
        return { value: values[`${namespace}.${key}`], source: 'tenant' };
      },
    },
  };
  if (opts.auth) {
    services.auth = {
      api: {
        async getSession(input: { headers: Headers }) {
          if (input.headers.get('cookie') !== COOKIE) return undefined;
          return {
            user: { id: 'u_ses', email: 'ses@example.com', authGate: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' } },
            session: { id: 'sess_1', userId: 'u_ses', token: 'sess_bearer', activeOrganizationId: ORG },
          };
        },
      },
      isAuthGateActive: () => opts.gateActive ?? true,
      resolveUserAuthGates: async () => [],
    };
  }
  return { ql, services };
}

interface Request {
  name: string;
  headers: Record<string, string>;
  auth: boolean;
  /** Whether the auth service says a gate feature is active (default: active). */
  gateActive?: boolean;
  /** Who the request resolves to, or `undefined` for none; see {@link expectedPrincipal}. */
  principal: string | undefined;
}

const REQUESTS: Request[] = [
  { name: 'no credential', headers: {}, auth: true, principal: undefined },
  {
    name: 'a session cookie for a gated user, with a language preference',
    headers: { cookie: COOKIE, 'accept-language': 'zh-CN,zh;q=0.9' },
    auth: true,
    principal: 'u_ses',
  },
  {
    name: 'the same session while no gate is active',
    headers: { cookie: COOKIE, 'accept-language': 'zh-CN,zh;q=0.9' },
    auth: true,
    gateActive: false,
    principal: 'u_ses',
  },
  { name: 'an API key', headers: { 'x-api-key': KEY }, auth: true, principal: 'u_key' },
  { name: "an ex-member's organization-stamped key under the walled posture", headers: { 'x-api-key': EX_MEMBER_KEY }, auth: true, principal: undefined },
  { name: 'an API key on a host with no auth service', headers: { 'x-api-key': KEY }, auth: false, principal: 'u_key' },
];

/** A converted door: its own entry, and the named parameters it declares to the function. */
interface DoorRow {
  door: string;
  drive(w: World, headers: Record<string, string>): Promise<ExecutionContext | undefined>;
  parameters(w: World, headers: Headers): Omit<RequestExecutionContextInput, 'headers' | 'ql' | 'authService'>;
}

/**
 * Who `request` resolves to at a door declaring `parameters`: its principal,
 * unless the door requires a session API and the host has no auth service, in
 * which case the door authenticates nobody, the API-key door included.
 */
function expectedPrincipal(request: Request, parameters: Pick<RequestExecutionContextInput, 'sessionApi'>): string | undefined {
  return !request.auth && parameters.sessionApi === 'required' ? undefined : request.principal;
}

/**
 * REST's door, `RestServer#computeExecCtx`, through its public entry, on the
 * single-kernel wiring `rest-api-plugin` builds: the auth service, the engine,
 * the settings service and the tenancy service each through its provider.
 */
async function driveRest(w: World, headers: Record<string, string>): Promise<ExecutionContext | undefined> {
  const provide = (service: unknown) => async () => service;
  const rest = new RestServer(
    { get() {}, post() {}, put() {}, delete() {}, patch() {}, use() {}, async listen() {}, async close() {} } as never,
    {} as never,
    {},
    undefined, // kernelManager
    undefined, // envRegistry
    undefined, // defaultEnvironmentIdProvider
    provide(w.services.auth), // authServiceProvider
    provide(w.ql), // objectQLProvider
    undefined, // emailServiceProvider
    undefined, // sharingServiceProvider
    undefined, // the retired slot
    undefined, // approvalsServiceProvider
    undefined, // sharingRulesServiceProvider
    undefined, // i18nServiceProvider
    undefined, // analyticsServiceProvider
    provide(w.services.settings), // settingsServiceProvider
    undefined, // serviceExistsProvider
    undefined, // securityServiceProvider
    undefined, // requestEnvResolver
    undefined, // metadataServiceProvider
    provide(w.services.tenancy), // tenancyServiceProvider
  );
  const ctx = await rest.resolvePackageRouteExecutionContext({ headers, params: {}, query: {}, method: 'GET', path: '/api/v1/data/task' });
  if (!ctx) return undefined;
  // The door's own additions after the function returns, set aside by name:
  // the resolved kernel (none on this wiring) and the environment whose auth
  // service validated the caller (none named on this wiring).
  const { __kernel, __authEnvironmentId, ...context } = ctx;
  expect(__kernel).toBeUndefined();
  expect(__authEnvironmentId).toBeUndefined();
  return context as ExecutionContext;
}

const DOORS: DoorRow[] = [
  {
    door: 'packages/runtime/src/security/resolve-execution-context.ts',
    drive: (w, headers) => resolveExecutionContext({
      getService: async (name: string) => w.services[name],
      getQl: async () => w.ql,
      request: { headers },
    }),
    parameters: (w, headers) => ({
      tenancy: () => w.services.tenancy as never,
      anonymous: 'guest',
      authGate: 'withhold',
      credentials: 'api-key-and-session',
      sessionApi: 'optional',
      session: 'request',
      localization: { settings: () => w.services.settings },
      requestLocale: preferredLocaleFromHeader(headers.get('accept-language')),
      accessToken: 'carry',
      oauth: undefined,
      onAdmission: undefined,
    }),
  },
  {
    door: 'packages/rest/src/rest-server.ts',
    drive: driveRest,
    parameters: (w, headers) => ({
      tenancy: () => w.services.tenancy as never,
      anonymous: 'fail-closed',
      authGate: 'reread-when-active',
      credentials: 'api-key-and-session',
      sessionApi: 'required',
      session: 'request',
      localization: { settings: () => w.services.settings },
      // REST reads the header first, then `?locale`; no request here carries `?locale`.
      requestLocale: preferredLocaleFromHeader(headers.get('accept-language')),
      accessToken: 'withhold',
      oauth: undefined,
      onAdmission: undefined,
    }),
  },
];

/** The facts that say WHO the caller is; equal at every door that resolves one. */
const IDENTITY = ['userId', 'tenantId', 'email', 'positions', 'permissions', 'systemPermissions', 'posture', 'org_user_ids', 'accessible_org_ids', 'principalKind'] as const;

describe('[ruling 6227928430 item 4] one request, the function and every converted door, one context', () => {
  for (const request of REQUESTS) {
    it(`${request.name}: each door's context IS the function's under the door's declared parameters`, async () => {
      for (const row of DOORS) {
        const w = world({ auth: request.auth, gateActive: request.gateActive });
        const viaDoor = await row.drive(w, request.headers);
        const headers = new Headers(request.headers);
        const parameters = row.parameters(w, headers);
        const viaFunction = await resolveRequestExecutionContext({
          headers,
          ql: w.ql,
          authService: w.services.auth as RequestExecutionContextInput['authService'],
          ...parameters,
        });
        expect(viaDoor, row.door).toEqual(viaFunction);
        expect(viaDoor?.userId, row.door).toBe(expectedPrincipal(request, parameters));
      }
    });
  }

  it('a principal is the same principal at every door that resolves one', async () => {
    for (const request of REQUESTS.filter((r) => r.principal)) {
      const contexts = await Promise.all(DOORS.map((row) => row.drive(world({ auth: request.auth, gateActive: request.gateActive }), request.headers)));
      const identities = contexts
        .filter((ctx): ctx is ExecutionContext => ctx !== undefined)
        .map((ctx) => Object.fromEntries(IDENTITY.map((k) => [k, ctx[k]])));
      // Which doors resolve one is the first case's to assert; this one needs
      // at least one, or it would compare nothing.
      expect(identities.length, request.name).toBeGreaterThan(0);
      for (const identity of identities) expect(identity, request.name).toEqual(identities[0]);
    }
  });

  it('CONTROL: the requests tell the runtime door\'s named parameters apart', async () => {
    // Without this, a fixture in which every parameter answered alike would
    // make the equality above hold for any declared set. Each reading below is
    // a parameter the session request or the anonymous one discriminates.
    const w = world({ auth: true });
    const session = await DOORS[0]!.drive(w, REQUESTS[1]!.headers);
    expect(session).toMatchObject({ userId: 'u_ses', principalKind: 'human', accessToken: 'sess_bearer', locale: 'zh-CN', timezone: 'Europe/Paris', tenantId: ORG });
    // `authGate: 'withhold'`: the gated user's posture is not on the envelope.
    expect(session?.authGate).toBeUndefined();
    const anonymous = await DOORS[0]!.drive(w, REQUESTS[0]!.headers);
    expect(anonymous?.principalKind).toBe('guest');
    // And the function answers differently when a parameter is flipped.
    const headers = new Headers(REQUESTS[1]!.headers);
    const flipped = await resolveRequestExecutionContext({
      headers,
      ql: w.ql,
      authService: w.services.auth as RequestExecutionContextInput['authService'],
      ...DOORS[0]!.parameters(w, headers),
      authGate: 'resolved',
      accessToken: 'withhold',
    });
    expect(flipped?.authGate).toEqual({ code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' });
    expect(flipped?.accessToken).toBeUndefined();
  });

  it('CONTROL: the requests tell the REST door\'s named parameters apart', async () => {
    const rest = DOORS[1]!;
    const w = world({ auth: true });
    // `authGate: 'reread-when-active'` under an active gate, `accessToken: 'withhold'`,
    // the request locale and the settings lookup.
    const session = await rest.drive(w, REQUESTS[1]!.headers);
    expect(session).toMatchObject({ userId: 'u_ses', principalKind: 'human', locale: 'zh-CN', timezone: 'Europe/Paris', tenantId: ORG });
    expect(session?.authGate).toEqual({ code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' });
    expect(session?.accessToken).toBeUndefined();
    // `anonymous: 'fail-closed'`: no context at all.
    expect(await rest.drive(w, REQUESTS[0]!.headers)).toBeUndefined();
    // `reread-when-active` and not `'resolved'`: no active gate, no posture.
    const inactive = world({ auth: true, gateActive: false });
    expect((await rest.drive(inactive, REQUESTS[2]!.headers))?.authGate).toBeUndefined();
    const headers = new Headers(REQUESTS[2]!.headers);
    const resolved = await resolveRequestExecutionContext({
      headers,
      ql: inactive.ql,
      authService: inactive.services.auth as RequestExecutionContextInput['authService'],
      ...rest.parameters(inactive, headers),
      authGate: 'resolved',
    });
    expect(resolved?.authGate).toEqual({ code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' });
    // `sessionApi: 'required'`: the key the runtime door admits on a host with
    // no auth service is not admitted here, and `'optional'` would admit it.
    const noAuth = world({ auth: false });
    expect(await rest.drive(noAuth, REQUESTS[REQUESTS.length - 1]!.headers)).toBeUndefined();
    const optional = await resolveRequestExecutionContext({
      headers: new Headers(REQUESTS[REQUESTS.length - 1]!.headers),
      ql: noAuth.ql,
      authService: undefined,
      ...rest.parameters(noAuth, new Headers()),
      sessionApi: 'optional',
    });
    expect(optional?.userId).toBe('u_key');
  });
});
