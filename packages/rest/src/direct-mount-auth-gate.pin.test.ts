// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0069 at REST's direct mounts: a session the authentication policy HOLDS
 * (an expired password, enforced MFA not yet enrolled) is refused at the
 * publish door (`registerPackageRoutes`) and the federation floor
 * (`registerExternalDatasourceRoutes`), with the answer `enforceAuth` gives.
 *
 * ## Why through the real composition
 *
 * Both registrars are mounted straight onto the host server by
 * `mountAndRecordDirectRoutes`, so they pass through none of `RestServer`'s own
 * handlers and never meet `enforceAuth`. The posture reaches them only because
 * the composition hands them the `RestServer`'s resolver, which lifts the
 * session's `authGate` onto the context it returns (`computeExecCtx`, only
 * while a gate feature is active). A pin that mounted a registrar with a
 * hand-built context would verify the read and not the wiring. This file boots
 * `createRestApiPlugin(...).start(ctx)`, as the federation floor's own suite
 * does, and drives the mounted handler table.
 *
 * ## The cases
 *
 *  - HELD: under both postures, all six routes answer `403` with the gate's
 *    `code` and `message` and no `data`, and the service is never reached (the
 *    publish, and both federation writes, included). The caller holds every
 *    capability the family asks for, so the refusal is the gate's alone.
 *  - UN-HELD: the same caller and grants, without a posture, get each route's
 *    own success status, and the service runs.
 *  - ALLOW-LISTED: the one allow-listed route this composition mounts, the
 *    discovery document, answers a held session as it answers an un-held one.
 *  - OUTAGE (publish): an active gate whose session re-read fails answers the
 *    REST seam's `503 SERVICE_UNAVAILABLE`, through the door's existing rethrow.
 */

import { describe, it, expect, vi } from 'vitest';
import { isAuthGateAllowlisted } from '@objectstack/core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { createRestApiPlugin } from './rest-api-plugin.js';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';

const BASE = '/api/v1';
const DS = 'pg_main';
const USER = 'u_gate_pin';

const PASSWORD_EXPIRED = { code: 'PASSWORD_EXPIRED', message: 'You must change your password before continuing.' };
const MFA_REQUIRED = {
  code: 'MFA_REQUIRED',
  message: 'Multi-factor authentication is required. Please set up an authenticator app to continue.',
};

/** Session bearer → the posture that session's user carries. */
const SESSIONS: Record<string, { code: string; message: string } | undefined> = {
  'sess-held-pw': PASSWORD_EXPIRED,
  'sess-held-mfa': MFA_REQUIRED,
  'sess-member': undefined,
  // Its identity read succeeds, its gate re-read fails (see `bootDirectMounts`).
  'sess-outage': undefined,
};
const HELD = [
  { token: 'sess-held-pw', gate: PASSWORD_EXPIRED },
  { token: 'sess-held-mfa', gate: MFA_REQUIRED },
] as const;

const MANIFEST = { id: 'com.acme.gate_pin', version: '1.0.0' };

/** The six direct-mounted routes, each with its success status and the service method it reaches. */
const ROUTES = [
  { method: 'POST', url: `${BASE}/packages/publish`, ok: 200, service: 'package', call: 'publish', body: { manifest: MANIFEST, metadata: {} } },
  { method: 'GET', url: `${BASE}/datasources/${DS}/external/tables`, ok: 200, service: 'external-datasource', call: 'listRemoteTables' },
  { method: 'POST', url: `${BASE}/datasources/${DS}/external/tables/customers/draft`, ok: 200, service: 'external-datasource', call: 'generateObjectDraft' },
  { method: 'POST', url: `${BASE}/datasources/${DS}/external/tables/customers/import`, ok: 201, service: 'external-datasource', call: 'importObject' },
  { method: 'POST', url: `${BASE}/datasources/${DS}/external/refresh-catalog`, ok: 200, service: 'external-datasource', call: 'refreshCatalog' },
  { method: 'POST', url: `${BASE}/datasources/${DS}/external/validate`, ok: 200, service: 'external-datasource', call: 'validateDatasource' },
] as const;

/** Every capability the six routes ask for between them. */
const GRANTS = ['manage_metadata', 'manage_platform_settings'];

type Handler = (req: any, res: any) => any;

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

function resolveRoute(table: Map<string, Handler>, method: string, url: string) {
  const urlSegs = url.split('/');
  for (const [key, handler] of table) {
    const [m, pattern] = key.split(' ');
    if (m !== method) continue;
    const patSegs = pattern!.split('/');
    if (patSegs.length !== urlSegs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < patSegs.length; i++) {
      if (patSegs[i]!.startsWith(':')) params[patSegs[i]!.slice(1)] = urlSegs[i]!;
      else if (patSegs[i] !== urlSegs[i]) { ok = false; break; }
    }
    if (ok) return { handler, params };
  }
  return undefined;
}

async function bootDirectMounts() {
  const server = createRecordingServer();
  const services: Record<string, any> = {
    'external-datasource': {
      listRemoteTables: vi.fn(async () => [{ name: 'customers' }]),
      generateObjectDraft: vi.fn(async () => ({ name: 'customers' })),
      importObject: vi.fn(async () => ({ name: 'customers' })),
      refreshCatalog: vi.fn(async () => ({ tables: {} })),
      validateAll: vi.fn(async () => ({ results: [] })),
      validateDatasource: vi.fn(async (name: string) => ({ results: [{ datasource: name, ok: true }] })),
    },
    package: { list: async () => [], publish: vi.fn(async () => ({ success: true })) },
  };

  const SET = 'ps_gate_pin';
  const ORG = 'o1';

  /** Session reads per request for the outage token; reset by `call`. */
  const outage = { reads: 0 };
  const auth = {
    isAuthGateActive: () => true,
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const token = headers?.get?.('authorization')?.replace(/^Bearer /, '') ?? '';
        if (!(token in SESSIONS)) return null;
        // The identity read is the request's first; REST's gate re-read is its second.
        if (token === 'sess-outage' && ++outage.reads > 1) throw new Error('session backend unavailable');
        const authGate = SESSIONS[token];
        // The caller acts in `o1`, the organization its grant is stamped with.
        return { user: { id: USER, ...(authGate ? { authGate } : {}) }, session: { userId: USER, activeOrganizationId: ORG } };
      },
    },
  };

  const engine = {
    find: async (object: string, query: any) => {
      if (object === 'sys_user_permission_set') {
        return query?.where?.user_id === USER
          ? [{ id: 'ups_1', user_id: USER, permission_set_id: SET, permission_set: 'gate_pin_caller', organization_id: ORG }]
          : [];
      }
      if (object === 'sys_permission_set') {
        const ids: string[] = query?.where?.id?.$in ?? [];
        const names: string[] = query?.where?.name?.$in ?? [];
        return ids.includes(SET) || names.includes('gate_pin_caller')
          ? [{ id: SET, name: 'gate_pin_caller', system_permissions: JSON.stringify(GRANTS), object_permissions: '{}' }]
          : [];
      }
      return [];
    },
  };
  bindTestSecurityCatalog(engine, { permissions: [{ name: 'gate_pin_caller', systemPermissions: [...GRANTS] }] });

  const protocolServices = new Map<string, any>([['package', services.package]]);
  const protocol = new ObjectStackProtocolImplementation(
    { registry: { getObject: () => undefined, getRegisteredTypes: () => [] } } as any,
    () => protocolServices,
  );
  const all: Record<string, unknown> = { 'http.server': server, protocol, auth, objectql: engine, ...services };
  const ctx = {
    registerService: vi.fn(),
    getService: vi.fn((name: string) => {
      if (name in all) return all[name];
      throw new Error(`Service '${name}' not found`);
    }),
    getServices: vi.fn(() => new Map(Object.entries(all))),
    hook: vi.fn(),
    trigger: vi.fn().mockResolvedValue(undefined),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    getKernel: vi.fn(),
  };
  await createRestApiPlugin(undefined as any).start!(ctx as any);

  async function call(route: { method: string; url: string; body?: unknown }, token?: string) {
    outage.reads = 0;
    const entry = resolveRoute(server.table, route.method, route.url);
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
        body: route.body ?? {},
        method: route.method,
        path: route.url,
        headers: { host: 'example.test', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      },
      res,
    );
    return { statusCode, body };
  }

  function calls(route: (typeof ROUTES)[number]): number {
    return (services[route.service][route.call] as ReturnType<typeof vi.fn>).mock.calls.length;
  }

  return { call, calls, services };
}

describe('ADR-0069 at REST\'s direct mounts (the real composition)', () => {
  for (const { token, gate } of HELD) {
    it(`HELD (${gate.code}): all six routes answer 403 with the gate's code and message, and no service runs`, async () => {
      const { call, calls } = await bootDirectMounts();
      for (const route of ROUTES) {
        const { statusCode, body } = await call(route, token);
        expect(statusCode, `${route.method} ${route.url}`).toBe(403);
        expect(body?.success, route.url).toBe(false);
        expect(body?.error?.code, route.url).toBe(gate.code);
        expect(body?.error?.message, route.url).toBe(gate.message);
        expect(body, route.url).not.toHaveProperty('data');
        expect(calls(route), `${route.call} ran for a held session`).toBe(0);
      }
    });
  }

  it('UN-HELD: the same caller and grants get every route\'s own success status, and each service runs', async () => {
    const { call, calls } = await bootDirectMounts();
    for (const route of ROUTES) {
      const { statusCode, body } = await call(route, 'sess-member');
      expect(statusCode, `${route.method} ${route.url}: ${JSON.stringify(body)}`).toBe(route.ok);
      expect(body?.success, route.url).toBe(true);
      expect(calls(route), route.call).toBe(1);
    }
  });

  it('UN-HELD: an anonymous caller is refused 401 as before, and no service runs', async () => {
    const { call, calls } = await bootDirectMounts();
    for (const route of ROUTES) {
      const { statusCode, body } = await call(route);
      expect(statusCode, route.url).toBe(401);
      expect(body?.error?.code, route.url).toBe('UNAUTHENTICATED');
      expect(calls(route)).toBe(0);
    }
  });

  it('ALLOW-LISTED: the discovery document answers a held session exactly as it answers an un-held one', async () => {
    const { call } = await bootDirectMounts();
    const discovery = { method: 'GET', url: `${BASE}/discovery` };
    expect(isAuthGateAllowlisted(discovery.url)).toBe(true);
    const held = await call(discovery, 'sess-held-pw');
    const unheld = await call(discovery, 'sess-member');
    expect(held.statusCode).toBe(200);
    expect(held).toEqual(unheld);
  });

  it('OUTAGE (publish): an active gate whose session re-read fails answers 503 SERVICE_UNAVAILABLE, and nothing is published', async () => {
    const { call, calls } = await bootDirectMounts();
    const { statusCode, body } = await call(ROUTES[0], 'sess-outage');
    expect(statusCode).toBe(503);
    expect(body?.error?.code).toBe('SERVICE_UNAVAILABLE');
    expect(calls(ROUTES[0])).toBe(0);
  });
});
