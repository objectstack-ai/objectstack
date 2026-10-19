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
 * A door that hands onward a projection of the context rather than the context
 * itself (the settings door's `SettingsContext`) declares that projection as
 * its row's {@link DoorRow.project}, and the door's answer must equal the
 * projection of the function's context. The projection is the door's own
 * output consumption, not the composition, so it is written here as the row's
 * statement of what the door hands on, and the equality holds it to the door.
 *
 * Who a request resolves to is the request's {@link Request.principal} at every
 * door, except where a door's declared parameters authenticate nobody for it
 * ({@link expectedPrincipal}: a door that requires a session API, on a host
 * with no auth service; a door that reads only the session, for a request that
 * carries no session). Across rows, every door that resolves a principal
 * resolves the SAME one ({@link IDENTITY}): the named parameters decide what a
 * door withholds or adds around the identity, and whether it admits at all,
 * never who the caller is.
 *
 * A door's own additions after the function returns (REST's `__kernel` and
 * `__authEnvironmentId`, see its `drive`) are not the composition and are
 * set aside before the comparison, by name.
 *
 * A projection can drop a parameter's whole effect: the settings context
 * carries no locale, time zone or session bearer, so no request tells that
 * door's `localization`, `requestLocale` or `accessToken` apart, and its row
 * declares the values the door passes. Its CONTROL names the parameters the
 * requests do tell apart there.
 *
 * A door can answer a request BEFORE its composition runs, from a fact that
 * is the door's own wiring rather than the composition: the storage door's
 * family gate reader refuses a held session while a gate is active, and a host
 * with no auth service binds no storage download authorizer at all. Such a
 * door declares those requests ({@link DoorRow.answeredBeforeComposition}),
 * hands nothing on for them, and its CONTROL reads the answer the door gave
 * instead.
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
 * | a session read naming its user by `session.userId` alone | none: it holds every door to the one reading of who a session names (ruling record 6257816853 item 1), which a door re-reading the session its own way would break |
 * | an API key on a host with no auth service | `sessionApi` |
 *
 * The storage door binds no authorizer on a host with no auth service, so its
 * `sessionApi` is told apart in its CONTROL instead, on a host whose auth
 * service exposes no session read.
 *
 * The `/auth/me` door reads only the session and no tenancy posture, so no
 * request above tells its `tenancy` apart (the ex-member's key never reaches
 * a session-only door): its CONTROL adds a session claiming an organization
 * its user is not a member of, under the walled posture. Its `sessionApi` is
 * not observable at all, and its CONTROL says why.
 *
 * The runtime door's `/mcp` face (an OAuth access token) is not a row: its
 * verification and scope interpretation are the door's own, ahead of the call,
 * and its pins are `resolve-execution-context.oauth-organization.test.ts` and
 * the agent-principal cases of `resolve-execution-context.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { preferredLocaleFromHeader } from '@objectstack/spec/system';
import { resolveRequestExecutionContext, type RequestExecutionContextInput } from '@objectstack/core';

import { RestServer } from '@objectstack/rest';
import { SettingsServicePlugin, type SettingsContext } from '@objectstack/service-settings';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { HonoHttpServer, registerCurrentUserEndpoints } from '@objectstack/plugin-hono-server';

import { hashApiKey } from './api-key.js';
import { resolveExecutionContext } from './resolve-execution-context.js';
import { bindCatalogFromTables } from './security-catalog.testkit.js';

/**
 * Every context the settings family door hands its ADR-0069 check, read
 * through a PASS-THROUGH of `@objectstack/core`'s `evaluateAuthGate`: the
 * export answers exactly as it does unmocked, and the record is how
 * {@link driveSettings} reads the context the settings door produced.
 */
const authGateReads = vi.hoisted(() => [] as Array<{ context: unknown; path: string }>);

vi.mock('@objectstack/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@objectstack/core')>();
  return {
    ...real,
    evaluateAuthGate: (...args: Parameters<typeof real.evaluateAuthGate>) => {
      authGateReads.push({ context: args[0], path: args[1] });
      return real.evaluateAuthGate(...args);
    },
  };
});

const ORG = 'org_alpha';
const COOKIE = 'better-auth.session_token=tok3n.c2ln';
/** A session whose read names its user by `session.userId` alone, with no user object. */
const SESSION_USER_ID_COOKIE = 'better-auth.session_token=tok3n_session_user_id.c2ln';
/** A session claiming an organization its user is not a member of. */
const NON_MEMBER_COOKIE = 'better-auth.session_token=tok3n_non_member.c2ln';
const NON_MEMBER_ORG = 'org_beta';
const KEY = 'osk_conformance_key';
const EX_MEMBER_KEY = 'osk_conformance_ex_member';
const FUTURE = '2999-01-01T00:00:00Z';

/** The private field-owned file the storage drive downloads, and the record that owns it. */
const OWNED_FILE = 'file_conformance';
const OWNER_OBJECT = 'contract';
const OWNER_RECORD = 'rec_conformance';

/** One deployment every row is driven against: its engine and its kernel services. */
interface World {
  ql: unknown;
  services: Record<string, unknown>;
  /** The context each read of {@link OWNER_OBJECT} received: the storage door's verdict read. */
  ownerReads: unknown[];
}

function world(opts: { auth: boolean; gateActive?: boolean; sessionApi?: boolean }): World {
  const ownerReads: unknown[] = [];
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
    // The storage drive's download: a private file one record owns, uploaded
    // by nobody a request signs in as, so only the owner read decides.
    sys_file: [{
      id: OWNED_FILE, key: 'files/conformance.pdf', name: 'conformance.pdf', mime_type: 'application/pdf', size: 1,
      scope: 'record', status: 'committed', acl: 'private', owner_id: 'u_uploader',
      ref_object: OWNER_OBJECT, ref_id: OWNER_RECORD, ref_field: 'attachment',
    }],
    [OWNER_OBJECT]: [{ id: OWNER_RECORD }],
  };
  const find = async (object: string, q: { where?: Record<string, unknown>; limit?: number; context?: unknown } | undefined) => {
    if (object === OWNER_OBJECT) ownerReads.push(q?.context);
    const rows = (tables[object] ?? []).filter((row) => Object.entries(q?.where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fixture: unsupported combinator ${k}`);
      if (v !== null && typeof v === 'object') {
        return Array.isArray((v as { $in?: unknown[] }).$in) ? (v as { $in: unknown[] }).$in.includes(row[k]) : true;
      }
      return (v ?? null) === (row[k] ?? null);
    }));
    return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
  };
  const ql = bindCatalogFromTables({
    find,
    // The storage door reads `sys_file` by id.
    async findOne(object: string, q: { where?: Record<string, unknown> } | undefined) {
      return (await find(object, { where: q?.where, limit: 1 }))[0] ?? null;
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
      // `sessionApi: false`: an auth service that exposes no session read.
      ...(opts.sessionApi === false ? {} : {
        api: {
          async getSession(input: { headers: Headers }) {
            const cookie = input.headers.get('cookie');
            if (cookie === SESSION_USER_ID_COOKIE) {
              return { session: { id: 'sess_2', userId: 'u_ses', token: 'sess_bearer_2', activeOrganizationId: ORG } };
            }
            if (cookie === NON_MEMBER_COOKIE) {
              return {
                user: { id: 'u_ses', email: 'ses@example.com' },
                session: { id: 'sess_3', userId: 'u_ses', token: 'sess_bearer_3', activeOrganizationId: NON_MEMBER_ORG },
              };
            }
            if (cookie !== COOKIE) return undefined;
            return {
              user: { id: 'u_ses', email: 'ses@example.com', authGate: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' } },
              session: { id: 'sess_1', userId: 'u_ses', token: 'sess_bearer', activeOrganizationId: ORG },
            };
          },
        },
      }),
      isAuthGateActive: () => opts.gateActive ?? true,
      resolveUserAuthGates: async () => [],
    };
  }
  return { ql, services, ownerReads };
}

interface Request {
  name: string;
  headers: Record<string, string>;
  auth: boolean;
  /** Whether the auth service says a gate feature is active (default: active). */
  gateActive?: boolean;
  /** The session user's ADR-0069 posture holds it (the world's session user is gated). */
  held?: true;
  /** Who the request resolves to, or `undefined` for none; see {@link expectedPrincipal}. */
  principal: string | undefined;
}

const REQUESTS: Request[] = [
  { name: 'no credential', headers: {}, auth: true, principal: undefined },
  {
    name: 'a session cookie for a gated user, with a language preference',
    headers: { cookie: COOKIE, 'accept-language': 'zh-CN,zh;q=0.9' },
    auth: true,
    held: true,
    principal: 'u_ses',
  },
  {
    name: 'the same session while no gate is active',
    headers: { cookie: COOKIE, 'accept-language': 'zh-CN,zh;q=0.9' },
    auth: true,
    gateActive: false,
    held: true,
    principal: 'u_ses',
  },
  { name: 'an API key', headers: { 'x-api-key': KEY }, auth: true, principal: 'u_key' },
  { name: "an ex-member's organization-stamped key under the walled posture", headers: { 'x-api-key': EX_MEMBER_KEY }, auth: true, principal: undefined },
  { name: 'a session read naming its user by session.userId alone', headers: { cookie: SESSION_USER_ID_COOKIE }, auth: true, principal: 'u_ses' },
  // Last, as the CONTROLs below read it.
  { name: 'an API key on a host with no auth service', headers: { 'x-api-key': KEY }, auth: false, principal: 'u_key' },
];

/**
 * A converted door: its own entry, and the named parameters it declares to the
 * function. `Answer` is what the door hands onward: the context itself, or the
 * door's projection of it.
 */
interface DoorRow<Answer = ExecutionContext | undefined> {
  door: string;
  drive(w: World, headers: Record<string, string>): Promise<Answer>;
  parameters(w: World, headers: Headers): Omit<RequestExecutionContextInput, 'headers' | 'ql' | 'authService'>;
  /**
   * What the door hands onward, from the function's context, for a door that
   * hands onward a projection rather than the context itself. Absent: the
   * door's answer IS the context.
   */
  project?(context: ExecutionContext | undefined): Answer;
  /** The facts that say WHO the caller is, as this door hands them on. Default: {@link IDENTITY}. */
  identity?: readonly string[];
  /**
   * The door fact that answers `request` before the door's composition runs,
   * or `undefined` when the composition decides it. The door hands nothing on
   * for such a request. Absent: the composition decides every request.
   */
  answeredBeforeComposition?(request: Request): string | undefined;
}

/** The caller a door's answer names, whatever its shape. */
const principalOf = (answer: unknown): string | undefined => (answer as { userId?: string } | undefined)?.userId;

/**
 * Who `request` resolves to at a door declaring `parameters`: its principal,
 * unless the door requires a session API and the host has no auth service, in
 * which case the door authenticates nobody, the API-key door included; or
 * unless the door reads only the session and the request carries none, in
 * which case an API key alone admits nobody there.
 */
function expectedPrincipal(
  request: Request,
  parameters: Pick<RequestExecutionContextInput, 'sessionApi' | 'credentials'>,
): string | undefined {
  if (!request.auth && parameters.sessionApi === 'required') return undefined;
  if (parameters.credentials === 'session-only' && request.headers.cookie === undefined) return undefined;
  return request.principal;
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

/**
 * The settings door, `SettingsServicePlugin`'s `verifiedContextFromRequest`
 * (`@objectstack/service-settings`), through its public entry: the plugin
 * booted on a plugin context over the world's services, and one request to
 * the family's listing route, `GET /api/settings`. The door hands its context
 * to no caller. The family door's first read of it is the ADR-0069 check
 * (`evaluateAuthGate(context, '')`), on every route and every request, ahead
 * of the anonymous floor, so the drive reads the context there
 * ({@link authGateReads}).
 */
async function driveSettings(w: World, headers: Record<string, string>): Promise<SettingsContext> {
  const routes = new Map<string, RouteHandler>();
  const mount = (verb: string) => (path: string, handler: RouteHandler) => { routes.set(`${verb} ${path}`, handler); };
  const http = {
    get: mount('GET'), post: mount('POST'), put: mount('PUT'), delete: mount('DELETE'), patch: mount('PATCH'),
    use() {}, async listen() {}, async close() {},
  };
  const services: Record<string, unknown> = { ...w.services, objectql: w.ql, 'http-server': http };
  let ready: (() => Promise<void>) | undefined;
  const context = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    registerService() {},
    getService: (name: string) => services[name],
    hook: (event: string, fn: () => Promise<void>) => { if (event === 'kernel:ready') ready = fn; },
    // The async registry the door reaches the `tenancy` service through.
    getKernel: () => ({ getServiceAsync: async (name: string) => services[name] }),
  };
  const plugin = new SettingsServicePlugin({ manifests: [], env: {}, actionHandlers: {} });
  await plugin.init(context as never);
  await plugin.start(context as never);
  await ready!();
  const listing = routes.get('GET /api/settings');
  if (!listing) throw new Error('fixture: the settings family did not mount its listing route');
  const res = { status: () => res, json: () => res, send: () => res, header: () => res };
  authGateReads.length = 0;
  await listing({ params: {}, query: {}, headers, method: 'GET', path: '/api/settings' } as unknown as IHttpRequest, res as unknown as IHttpResponse);
  const reads = authGateReads.filter((read) => read.path === '');
  expect(reads, 'the family door asks the gate once, without a path').toHaveLength(1);
  return reads[0]!.context as SettingsContext;
}

/**
 * The settings door's projection: the caller, its organization, its system
 * capabilities and grants as one list (a manifest's read and write gates name
 * either kind), `enforced` (the context crossed the HTTP trust boundary) and
 * the ADR-0069 posture when one holds. No context: the door's fail-closed
 * answer, `{ enforced: true }`.
 */
function projectSettings(context: ExecutionContext | undefined): SettingsContext {
  if (!context) return { enforced: true };
  return {
    userId: context.userId,
    tenantId: context.tenantId,
    permissions: [...(context.systemPermissions ?? []), ...(context.permissions ?? [])],
    enforced: true,
    ...(context.authGate ? { authGate: context.authGate } : {}),
  };
}

const RUNTIME_ROW: DoorRow = {
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
};

const REST_ROW: DoorRow = {
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
};

const SETTINGS_ROW: DoorRow<SettingsContext> = {
  door: 'packages/services/service-settings/src/settings-service-plugin.ts',
  drive: driveSettings,
  parameters: (w) => ({
    tenancy: () => w.services.tenancy as never,
    anonymous: 'fail-closed',
    authGate: 'resolved',
    credentials: 'api-key-and-session',
    sessionApi: 'optional',
    session: 'request',
    localization: 'withhold',
    requestLocale: undefined,
    accessToken: 'withhold',
    oauth: undefined,
    onAdmission: undefined,
  }),
  project: projectSettings,
  identity: ['userId', 'tenantId', 'permissions'],
};

/** The storage family's base path, as the plugin mounts it by default. */
const STORAGE_BASE = '/api/v1/storage';

/**
 * The storage door, the download authorizer `composeStorageRoutes` binds
 * (`@objectstack/service-storage`), through its public entry: the plugin
 * booted on a plugin context over the world's services, and one download of a
 * private field-owned file, `GET /files/:fileId/url`. The authorizer answers a
 * verdict, not a context, so the drive reads the context where the door hands
 * it on: the read of the record that owns the file ({@link World.ownerReads}),
 * asked once for a caller the door resolved and never for one it did not.
 */
async function storageDownload(w: World, headers: Record<string, string>): Promise<{
  status: number;
  code: string | undefined;
  handedOn: ExecutionContext | undefined;
}> {
  const routes = new Map<string, RouteHandler>();
  const mount = (verb: string) => (path: string, handler: RouteHandler) => { routes.set(`${verb} ${path}`, handler); };
  const http = {
    get: mount('GET'), post: mount('POST'), put: mount('PUT'), delete: mount('DELETE'), patch: mount('PATCH'),
    use() {}, async listen() {}, async close() {},
  };
  const services: Record<string, unknown> = { ...w.services, objectql: w.ql, 'http-server': http };
  const ready: Array<() => Promise<void> | void> = [];
  const context = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    registerService(name: string, service: unknown) { services[name] = service; },
    getService: (name: string) => services[name],
    hook: (event: string, fn: () => Promise<void> | void) => { if (event === 'kernel:ready') ready.push(fn); },
    // The async registry the door reaches the `tenancy` service through.
    getKernel: () => ({ getServiceAsync: async (name: string) => services[name] }),
  };
  const rootDir = mkdtempSync(join(tmpdir(), 'os-conformance-storage-'));
  try {
    const plugin = new StorageServicePlugin({
      adapter: 'local',
      basePath: STORAGE_BASE,
      local: { rootDir, signingSecret: 'conformance-storage' },
      bindToSettings: false,
    });
    await plugin.init(context as never);
    await plugin.start(context as never);
    for (const fn of ready) await fn();
    const download = routes.get(`GET ${STORAGE_BASE}/files/:fileId/url`);
    if (!download) throw new Error('fixture: the storage family did not mount its download route');
    const answer: { status: number; body?: { error?: { code?: string } } } = { status: 200 };
    const res = {
      status(code: number) { answer.status = code; return res; },
      json(body: typeof answer.body) { answer.body = body; return res; },
      send() { return res; },
      header() { return res; },
    };
    w.ownerReads.length = 0;
    await download(
      { params: { fileId: OWNED_FILE }, query: {}, headers, method: 'GET', path: `${STORAGE_BASE}/files/${OWNED_FILE}/url` } as unknown as IHttpRequest,
      res as unknown as IHttpResponse,
    );
    expect(w.ownerReads.length, 'the door reads the owner record at most once').toBeLessThanOrEqual(1);
    return { status: answer.status, code: answer.body?.error?.code, handedOn: w.ownerReads[0] as ExecutionContext | undefined };
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

const STORAGE_ROW: DoorRow = {
  door: 'packages/services/service-storage/src/storage-service-plugin.ts',
  drive: async (w, headers) => (await storageDownload(w, headers)).handedOn,
  parameters: (w) => ({
    tenancy: () => w.services.tenancy as never,
    anonymous: 'fail-closed',
    authGate: 'resolved',
    credentials: 'api-key-and-session',
    sessionApi: 'optional',
    session: 'request',
    localization: 'withhold',
    requestLocale: undefined,
    accessToken: 'carry',
    oauth: undefined,
    onAdmission: undefined,
  }),
  answeredBeforeComposition: (request) => {
    if (!request.auth) return 'a host with no auth service binds no download authorizer, so the download is served unasked';
    if (request.held && request.gateActive !== false) {
      return "the family door's ADR-0069 gate reader refuses the held session before the authorizer runs";
    }
    return undefined;
  },
};

/** The current-user routes' prefix, as the endpoints mount by default. */
const AUTH_ME_PERMISSIONS = '/api/v1/auth/me/permissions';

/**
 * The `/auth/me` door, `makeExecutionContextResolver`
 * (`@objectstack/plugin-hono-server`), through its public entry: the three
 * current-user routes registered on a Hono app over the world's services, a
 * metadata service and a security service, and one request to
 * `GET /auth/me/permissions`. The route hands the context the door resolved
 * to the security service (`resolvePermissionSetsForContext`) for the
 * caller's sets, and answers its own signed-out body without asking it for a
 * request the door resolved nobody for, so the drive reads the context there.
 */
async function authMePermissions(w: World, headers: Record<string, string>): Promise<{
  status: number;
  body: { authenticated?: boolean; userId?: string } | undefined;
  handedOn: ExecutionContext | undefined;
}> {
  const asked: ExecutionContext[] = [];
  const services: Record<string, unknown> = {
    ...w.services,
    objectql: w.ql,
    metadata: { list: async () => [] },
    security: {
      async resolvePermissionSetsForContext(context: ExecutionContext) {
        asked.push(context);
        return [];
      },
    },
  };
  const server = new HonoHttpServer(0);
  registerCurrentUserEndpoints({
    rawApp: server.getRawApp(),
    ctx: { logger: { debug() {}, warn() {} }, getService: <T,>(name: string) => services[name] as T | undefined },
  });
  const res: Response = await server.getRawApp().request(`http://localhost${AUTH_ME_PERMISSIONS}`, { headers });
  expect(asked.length, 'the route asks the security service at most once').toBeLessThanOrEqual(1);
  return { status: res.status, body: (await res.json()) as { authenticated?: boolean; userId?: string }, handedOn: asked[0] };
}

const HONO_ROW: DoorRow = {
  door: 'packages/plugins/plugin-hono-server/src/current-user-endpoints.ts',
  drive: async (w, headers) => (await authMePermissions(w, headers)).handedOn,
  parameters: () => ({
    tenancy: undefined,
    anonymous: 'fail-closed',
    authGate: 'withhold',
    credentials: 'session-only',
    sessionApi: 'required',
    session: 'request',
    localization: 'withhold',
    requestLocale: undefined,
    accessToken: 'withhold',
    oauth: undefined,
    onAdmission: undefined,
  }),
};

const DOORS: ReadonlyArray<DoorRow<unknown>> = [RUNTIME_ROW, REST_ROW, SETTINGS_ROW, STORAGE_ROW, HONO_ROW];

/** The facts that say WHO the caller is; equal at every door that resolves one. */
const IDENTITY = ['userId', 'tenantId', 'email', 'positions', 'permissions', 'systemPermissions', 'posture', 'org_user_ids', 'accessible_org_ids', 'principalKind'] as const;

describe('[ruling 6227928430 item 4] one request, the function and every converted door, one context', () => {
  for (const request of REQUESTS) {
    it(`${request.name}: each door's context IS the function's under the door's declared parameters`, async () => {
      for (const row of DOORS) {
        const w = world({ auth: request.auth, gateActive: request.gateActive });
        const viaDoor = await row.drive(w, request.headers);
        const first = row.answeredBeforeComposition?.(request);
        if (first) {
          // The door's own fact answered; its CONTROL reads that answer.
          expect(viaDoor, `${row.door}: ${first}`).toBeUndefined();
          continue;
        }
        const headers = new Headers(request.headers);
        const parameters = row.parameters(w, headers);
        const viaFunction = await resolveRequestExecutionContext({
          headers,
          ql: w.ql,
          authService: w.services.auth as RequestExecutionContextInput['authService'],
          ...parameters,
        });
        expect(viaDoor, row.door).toEqual(row.project ? row.project(viaFunction) : viaFunction);
        expect(principalOf(viaDoor), row.door).toBe(expectedPrincipal(request, parameters));
      }
    });
  }

  it('a principal is the same principal at every door that resolves one', async () => {
    const pick = (answer: unknown, keys: readonly string[]) =>
      Object.fromEntries(keys.map((k) => [k, (answer as Record<string, unknown>)[k]]));
    for (const request of REQUESTS.filter((r) => r.principal)) {
      const resolved: Array<{ row: DoorRow<unknown>; answer: unknown }> = [];
      for (const row of DOORS) {
        const answer = await row.drive(world({ auth: request.auth, gateActive: request.gateActive }), request.headers);
        if (principalOf(answer)) resolved.push({ row, answer });
      }
      // Which doors resolve one is the first case's to assert; this one needs
      // a door that hands on the context itself, or it would compare nothing.
      const reference = resolved.find(({ row }) => !row.project);
      expect(reference, request.name).toBeDefined();
      for (const { row, answer } of resolved) {
        // A door that hands on a projection presents the same principal through it.
        const keys = row.identity ?? IDENTITY;
        const expected = row.project ? row.project(reference!.answer as ExecutionContext) : reference!.answer;
        expect(pick(answer, keys), `${request.name} · ${row.door}`).toEqual(pick(expected, keys));
      }
    }
  });

  it('CONTROL: the requests tell the runtime door\'s named parameters apart', async () => {
    // Without this, a fixture in which every parameter answered alike would
    // make the equality above hold for any declared set. Each reading below is
    // a parameter the session request or the anonymous one discriminates.
    const w = world({ auth: true });
    const session = await RUNTIME_ROW.drive(w, REQUESTS[1]!.headers);
    expect(session).toMatchObject({ userId: 'u_ses', principalKind: 'human', accessToken: 'sess_bearer', locale: 'zh-CN', timezone: 'Europe/Paris', tenantId: ORG });
    // `authGate: 'withhold'`: the gated user's posture is not on the envelope.
    expect(session?.authGate).toBeUndefined();
    const anonymous = await RUNTIME_ROW.drive(w, REQUESTS[0]!.headers);
    expect(anonymous?.principalKind).toBe('guest');
    // And the function answers differently when a parameter is flipped.
    const headers = new Headers(REQUESTS[1]!.headers);
    const flipped = await resolveRequestExecutionContext({
      headers,
      ql: w.ql,
      authService: w.services.auth as RequestExecutionContextInput['authService'],
      ...RUNTIME_ROW.parameters(w, headers),
      authGate: 'resolved',
      accessToken: 'withhold',
    });
    expect(flipped?.authGate).toEqual({ code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' });
    expect(flipped?.accessToken).toBeUndefined();
  });

  it('CONTROL: the requests tell the REST door\'s named parameters apart', async () => {
    const rest = REST_ROW;
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

  it('CONTROL: the requests tell the settings door\'s named parameters apart', async () => {
    const settings = SETTINGS_ROW;
    const viaFunction = (w: World, headers: Headers, flip: Partial<RequestExecutionContextInput>) => resolveRequestExecutionContext({
      headers,
      ql: w.ql,
      authService: w.services.auth as RequestExecutionContextInput['authService'],
      ...settings.parameters(w, headers),
      ...flip,
    });
    const w = world({ auth: true });
    // The projection's union: the key owner's system capability reaches the
    // settings context beside its grants.
    const key = await settings.drive(w, REQUESTS[3]!.headers);
    expect(key).toMatchObject({ userId: 'u_key', tenantId: ORG, enforced: true });
    expect(key.permissions).toContain('export_reports');
    // `credentials: 'api-key-and-session'`: a door reading no key admits nobody here.
    expect(await viaFunction(w, new Headers(REQUESTS[3]!.headers), { credentials: 'session-only' })).toBeUndefined();
    // `anonymous: 'fail-closed'`: no context, so the door's own fail-closed
    // answer, and the guest entry would have handed on a different one.
    expect(await settings.drive(w, REQUESTS[0]!.headers)).toEqual({ enforced: true });
    expect(projectSettings(await viaFunction(w, new Headers(), { anonymous: 'guest' }))).not.toEqual({ enforced: true });
    // `authGate: 'resolved'`: with no gate active, the posture the admitting
    // read decided is still carried, and `'reread-when-active'` would drop it.
    const inactive = world({ auth: true, gateActive: false });
    expect(await settings.drive(inactive, REQUESTS[2]!.headers)).toMatchObject({
      userId: 'u_ses',
      authGate: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' },
    });
    const reread = await viaFunction(inactive, new Headers(REQUESTS[2]!.headers), { authGate: 'reread-when-active' });
    expect(reread?.userId).toBe('u_ses');
    expect(reread?.authGate).toBeUndefined();
    // `tenancy`: the ex-member's key is refused under the walled posture, and
    // a door reading no posture would admit it.
    expect(await settings.drive(w, REQUESTS[4]!.headers)).toEqual({ enforced: true });
    expect((await viaFunction(w, new Headers(REQUESTS[4]!.headers), { tenancy: undefined }))?.userId).toBe('u_ex');
    // `sessionApi: 'optional'`: a key on a host with no auth service is
    // admitted, and `'required'` would admit nobody.
    const noAuth = world({ auth: false });
    const lastRequest = REQUESTS[REQUESTS.length - 1]!;
    expect(principalOf(await settings.drive(noAuth, lastRequest.headers))).toBe('u_key');
    expect(await viaFunction(noAuth, new Headers(lastRequest.headers), { sessionApi: 'required' })).toBeUndefined();
  });

  it('CONTROL: the requests tell the storage door\'s named parameters apart, and its door facts answer what they declare', async () => {
    const storage = STORAGE_ROW;
    const viaFunction = (w: World, headers: Headers, flip: Partial<RequestExecutionContextInput>) => resolveRequestExecutionContext({
      headers,
      ql: w.ql,
      authService: w.services.auth as RequestExecutionContextInput['authService'],
      ...storage.parameters(w, headers),
      ...flip,
    });
    // `anonymous: 'fail-closed'`: nothing is handed on and the door answers
    // 401, and the guest entry would have handed on a guest context.
    const w = world({ auth: true });
    expect(await storageDownload(w, REQUESTS[0]!.headers)).toMatchObject({ status: 401, code: 'AUTH_REQUIRED', handedOn: undefined });
    expect((await viaFunction(w, new Headers(), { anonymous: 'guest' }))?.principalKind).toBe('guest');
    // `authGate: 'resolved'`, `accessToken: 'carry'`, `localization` and
    // `requestLocale` withheld: with no gate active the held session is served,
    // and the context it is read with carries the posture the admitting read
    // decided and the session bearer, and no locale or time zone.
    const inactive = world({ auth: true, gateActive: false });
    const session = await storageDownload(inactive, REQUESTS[2]!.headers);
    expect(session.status).toBe(200);
    expect(session.handedOn).toMatchObject({
      userId: 'u_ses',
      principalKind: 'human',
      accessToken: 'sess_bearer',
      authGate: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' },
    });
    expect(session.handedOn?.locale).toBeUndefined();
    expect(session.handedOn?.timezone).toBeUndefined();
    const flipped = await viaFunction(inactive, new Headers(REQUESTS[2]!.headers), {
      authGate: 'reread-when-active',
      accessToken: 'withhold',
      localization: { settings: () => inactive.services.settings },
    });
    expect(flipped?.authGate).toBeUndefined();
    expect(flipped?.accessToken).toBeUndefined();
    expect(flipped?.timezone).toBe('Europe/Paris');
    // `credentials: 'api-key-and-session'`: a door reading no key admits nobody here.
    expect(principalOf((await storageDownload(w, REQUESTS[3]!.headers)).handedOn)).toBe('u_key');
    expect(await viaFunction(w, new Headers(REQUESTS[3]!.headers), { credentials: 'session-only' })).toBeUndefined();
    // `tenancy`: the ex-member's key is refused under the walled posture, and
    // a door reading no posture would admit it.
    expect(await storageDownload(w, REQUESTS[4]!.headers)).toMatchObject({ status: 401, handedOn: undefined });
    expect((await viaFunction(w, new Headers(REQUESTS[4]!.headers), { tenancy: undefined }))?.userId).toBe('u_ex');
    // `sessionApi: 'optional'`: a key on a host whose auth service exposes no
    // session read is admitted, and `'required'` would admit nobody.
    const noSessionApi = world({ auth: true, sessionApi: false });
    const key = REQUESTS[3]!.headers;
    expect(principalOf((await storageDownload(noSessionApi, key)).handedOn)).toBe('u_key');
    expect(await viaFunction(noSessionApi, new Headers(key), { sessionApi: 'required' })).toBeUndefined();
    // The door facts its row declares: the held session is refused by the
    // family's gate before the authorizer runs, and a host with no auth
    // service serves the download unasked.
    expect(await storageDownload(w, REQUESTS[1]!.headers)).toMatchObject({ status: 403, code: 'PASSWORD_EXPIRED', handedOn: undefined });
    expect(await storageDownload(world({ auth: false }), REQUESTS[REQUESTS.length - 1]!.headers))
      .toMatchObject({ status: 200, handedOn: undefined });
  });

  it('CONTROL: the requests tell the /auth/me door\'s named parameters apart', async () => {
    const authMe = HONO_ROW;
    const viaFunction = (w: World, headers: Headers, flip: Partial<RequestExecutionContextInput>) => resolveRequestExecutionContext({
      headers,
      ql: w.ql,
      authService: w.services.auth as RequestExecutionContextInput['authService'],
      ...authMe.parameters(w, headers),
      ...flip,
    });
    const w = world({ auth: true });
    // `anonymous: 'fail-closed'`: the route answers its own signed-out body
    // and hands nothing on, and the guest entry would have handed on a guest
    // context.
    expect(await authMePermissions(w, REQUESTS[0]!.headers)).toEqual({ status: 200, body: { authenticated: false }, handedOn: undefined });
    expect((await viaFunction(w, new Headers(), { anonymous: 'guest' }))?.principalKind).toBe('guest');
    // `authGate`, `accessToken`, `localization` and `requestLocale` withheld:
    // the gated session with a language preference is served (these routes
    // are allow-listed for a gated user), and its context carries no posture,
    // bearer, locale or time zone. Flipped, each is carried.
    const session = await authMePermissions(w, REQUESTS[1]!.headers);
    expect(session.status).toBe(200);
    expect(session.body).toMatchObject({ authenticated: true, userId: 'u_ses' });
    expect(session.handedOn).toMatchObject({ userId: 'u_ses', principalKind: 'human', tenantId: ORG });
    expect(session.handedOn?.authGate).toBeUndefined();
    expect(session.handedOn?.accessToken).toBeUndefined();
    expect(session.handedOn?.locale).toBeUndefined();
    expect(session.handedOn?.timezone).toBeUndefined();
    const headers = new Headers(REQUESTS[1]!.headers);
    const flipped = await viaFunction(w, headers, {
      authGate: 'resolved',
      accessToken: 'carry',
      localization: { settings: () => w.services.settings },
      requestLocale: preferredLocaleFromHeader(headers.get('accept-language')),
    });
    expect(flipped).toMatchObject({
      authGate: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' },
      accessToken: 'sess_bearer',
      locale: 'zh-CN',
      timezone: 'Europe/Paris',
    });
    // `credentials: 'session-only'`: an API key alone admits nobody here, and
    // a door reading keys would admit its owner.
    expect(await authMePermissions(w, REQUESTS[3]!.headers)).toEqual({ status: 200, body: { authenticated: false }, handedOn: undefined });
    expect((await viaFunction(w, new Headers(REQUESTS[3]!.headers), { credentials: 'api-key-and-session' }))?.userId).toBe('u_key');
    // `tenancy: undefined`: a session claiming an organization its user is not
    // a member of keeps its claim here, and a door reading the walled posture
    // drops the claim and keeps the caller.
    const claim = await authMePermissions(w, { cookie: NON_MEMBER_COOKIE });
    expect(claim.handedOn).toMatchObject({ userId: 'u_ses', tenantId: NON_MEMBER_ORG });
    const walled = await viaFunction(w, new Headers({ cookie: NON_MEMBER_COOKIE }), { tenancy: () => w.services.tenancy as never });
    expect(walled?.userId).toBe('u_ses');
    expect(walled?.tenantId).toBeUndefined();
    // `sessionApi: 'required'` is declared, and no request can tell it apart
    // at a session-only door: without a session read this door reads no
    // credential at all, so `'optional'` admits nobody either. The key on a
    // host with no auth service is the request that tells it apart at a door
    // that reads keys.
    const noAuth = world({ auth: false });
    const lastKey = REQUESTS[REQUESTS.length - 1]!.headers;
    expect((await authMePermissions(noAuth, lastKey)).handedOn).toBeUndefined();
    expect(await viaFunction(noAuth, new Headers(lastKey), { sessionApi: 'optional' })).toBeUndefined();
  });
});
