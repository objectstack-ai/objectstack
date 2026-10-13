// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0069 — the datasource-admin family refuses a session the
 * authentication policy HOLDS (an expired password, enforced MFA not yet
 * enrolled) with the REST seam's answer, on every route, before any of the
 * family's own logic runs.
 *
 * ## What was open
 *
 * The family's door (`requireDatasourceAdmin`) read the caller's session for
 * the anonymous floor and the capability gate, and never asked the ADR-0069
 * gate about it. The posture rides on the session user (`user.authGate`, set
 * by plugin-auth's `customSession` enrichment), so a held session holding
 * `manage_platform_settings` was served every route as an ordinary signed-in
 * caller — measured on a serve-shaped boot before this change. REST's
 * `enforceAuth` and the dispatcher answer the same session `403` with the
 * gate's `code`.
 *
 * ## The census comes from the registration
 *
 * Every case below is driven over the routes the registrar actually mounted
 * (`getMountedRoutes()` on a real `HonoHttpServer`), with a count asserted, so
 * a route added to the family later is driven held the day it lands and this
 * file turns red until a case is written for it.
 *
 * ## What each refusal asserts
 *
 * The ADR-0112 envelope — `status` AND `error.code` — plus the gate's own
 * message and a service that was never called. A bare "not 200" would be
 * satisfied by the 503 an unwired service gives.
 *
 * ## Controls
 *
 * The same caller un-held is served every route exactly as the auth-guard
 * suite serves it, and a CORS preflight answers the same held or not.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { registerDatasourceAdminRoutes } from '../admin-routes.js';
import { DATASOURCE_ROUTE_LEDGER } from '../datasource-route-ledger.js';
import {
  ENTITLED_CREDENTIAL,
  ENTITLED_USER,
  UNENTITLED_USER,
  createSessionAuthService,
  createGrantsEngine,
} from './entitled-caller.fixture.js';

/** The gate postures plugin-auth's enrichment writes, one per policy. */
const PASSWORD_EXPIRED = { code: 'PASSWORD_EXPIRED', message: 'Your password has expired. Please change it to continue.' };
const MFA_REQUIRED = {
  code: 'MFA_REQUIRED',
  message: 'Multi-factor authentication is required. Please set up an authenticator app to continue.',
};

/** The entitled operator, held by password expiry. */
const HELD_ENTITLED = 'Bearer held-entitled-session';
/** A caller holding nothing, held by enforced MFA. */
const HELD_UNENTITLED = 'Bearer held-unentitled-session';

/**
 * The fixture's two sessions, plus two HELD ones: the same users, the session
 * user carrying `authGate` exactly as `customSession` attaches it.
 */
function createAuthService() {
  const base = createSessionAuthService();
  const held: Record<string, { id: string; authGate: { code: string; message: string } }> = {
    [HELD_ENTITLED]: { id: ENTITLED_USER, authGate: PASSWORD_EXPIRED },
    [HELD_UNENTITLED]: { id: UNENTITLED_USER, authGate: MFA_REQUIRED },
  };
  return {
    api: {
      getSession: async (input: { headers: Headers }) => {
        const user = held[input.headers?.get?.('authorization') ?? ''];
        return user ? { user } : base.api.getSession(input);
      },
    },
  };
}

function createServiceDouble() {
  return {
    listDatasources: vi.fn().mockResolvedValue([{ name: 'pg', origin: 'runtime', health: 'ok' }]),
    getDatasource: vi.fn().mockResolvedValue({ name: 'pg', driver: 'sqlite' }),
    createDatasource: vi.fn().mockResolvedValue({ name: 'created', driver: 'sqlite' }),
    updateDatasource: vi.fn().mockResolvedValue({ name: 'pg', driver: 'sqlite' }),
    removeDatasource: vi.fn().mockResolvedValue(undefined),
    migrateCredential: vi.fn().mockResolvedValue({ status: 'migrated' }),
    listRemoteTables: vi.fn().mockResolvedValue([{ name: 'customers' }]),
    generateObjectDraft: vi.fn().mockResolvedValue({ name: 'customer' }),
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
  };
}

function mountFamily() {
  const service = createServiceDouble();
  const auth = createAuthService();
  const engine = createGrantsEngine();
  const ctx = {
    getService: vi.fn((name: string) => {
      if (name === 'auth') return auth;
      if (name === 'objectql' || name === 'data') return engine;
      return service;
    }),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as any;
  const server = new HonoHttpServer(0);
  registerDatasourceAdminRoutes(server, ctx, '/api/v1');
  return { server, app: server.getRawApp(), service };
}

const family = mountFamily();

/**
 * One case per mounted route: the concrete request, and what an entitled,
 * un-held caller gets (the auth-guard suite's own statuses).
 */
const CASES: Record<string, { path: string; body?: Record<string, unknown>; okStatus: number }> = {
  'GET /api/v1/datasources': { path: '/api/v1/datasources', okStatus: 200 },
  'GET /api/v1/datasources/drivers': { path: '/api/v1/datasources/drivers', okStatus: 200 },
  'GET /api/v1/datasources/:name': { path: '/api/v1/datasources/pg', okStatus: 200 },
  'GET /api/v1/datasources/:name/remote-tables': { path: '/api/v1/datasources/pg/remote-tables', okStatus: 200 },
  'POST /api/v1/datasources': { path: '/api/v1/datasources', body: { name: 'new_ds', driver: 'sqlite' }, okStatus: 201 },
  'PATCH /api/v1/datasources/:name': { path: '/api/v1/datasources/pg', body: { driver: 'sqlite' }, okStatus: 200 },
  'DELETE /api/v1/datasources/:name': { path: '/api/v1/datasources/pg', okStatus: 204 },
  'POST /api/v1/datasources/test': { path: '/api/v1/datasources/test', body: { driver: 'sqlite' }, okStatus: 200 },
  'POST /api/v1/datasources/:name/test': { path: '/api/v1/datasources/pg/test', body: {}, okStatus: 200 },
  'POST /api/v1/datasources/:name/object-draft': {
    path: '/api/v1/datasources/pg/object-draft',
    body: { table: 'customers' },
    okStatus: 200,
  },
  'POST /api/v1/datasources/:name/migrate-credential': {
    path: '/api/v1/datasources/pg/migrate-credential',
    body: {},
    okStatus: 200,
  },
};

const census = (family.server.getMountedRoutes?.() ?? []).map((r) => `${r.method} ${r.pattern}`);

async function drive(key: string, credential?: string, method?: string) {
  const c = CASES[key]!;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (credential) headers.authorization = credential;
  const verb = method ?? key.slice(0, key.indexOf(' '));
  const res = await family.app.fetch(
    new Request(`http://local${c.path}`, {
      method: verb,
      headers,
      body: c.body === undefined || verb === 'OPTIONS' ? undefined : JSON.stringify(c.body),
    }),
  );
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const serviceCalls = () =>
  Object.entries(family.service)
    .filter(([, fn]) => fn.mock.calls.length > 0)
    .map(([name]) => name);

beforeEach(() => {
  for (const fn of Object.values(family.service)) fn.mockClear();
});

describe('the datasource-admin census — read off the registration', () => {
  it('mounts exactly eleven routes, the ledgered ones, and every one has a case below', () => {
    // ⭐ A count, on purpose: a twelfth route has to come through this file.
    expect(census).toHaveLength(11);
    expect([...census].sort()).toEqual(DATASOURCE_ROUTE_LEDGER.map((row) => row.route).sort());
    expect(Object.keys(CASES).sort()).toEqual([...census].sort());
  });
});

describe('ADR-0069 — a held session is refused 403 with the gate code on every route', () => {
  it.each(census)('%s · entitled, held by password expiry → 403 PASSWORD_EXPIRED, nothing dispatched', async (key) => {
    const { status, body } = await drive(key, HELD_ENTITLED);
    expect(status).toBe(403);
    expect(body?.success).toBe(false);
    expect(body?.error?.code).toBe('PASSWORD_EXPIRED');
    expect(body?.error?.message).toBe(PASSWORD_EXPIRED.message);
    expect(body?.data).toBeUndefined();
    expect(serviceCalls()).toEqual([]);
  });

  it.each(census)('%s · unentitled, held by enforced MFA → 403 MFA_REQUIRED, before the capability gate', async (key) => {
    const { status, body } = await drive(key, HELD_UNENTITLED);
    expect(status).toBe(403);
    // Not `PERMISSION_DENIED`: the held caller is told what to remediate, and
    // its capabilities are not consulted.
    expect(body?.error?.code).toBe('MFA_REQUIRED');
    expect(body?.error?.message).toBe(MFA_REQUIRED.message);
    expect(serviceCalls()).toEqual([]);
  });
});

describe('CONTROL — the same caller un-held is served as before', () => {
  it.each(census)('%s · entitled, un-held → its own success status', async (key) => {
    const { status } = await drive(key, ENTITLED_CREDENTIAL);
    expect(status).toBe(CASES[key]!.okStatus);
  });
});

describe('CONTROL — a CORS preflight is answered the same, held or not', () => {
  it.each(census)('%s · OPTIONS held === OPTIONS un-held, and never the gate', async (key) => {
    const held = await drive(key, HELD_ENTITLED, 'OPTIONS');
    const unheld = await drive(key, ENTITLED_CREDENTIAL, 'OPTIONS');
    expect(held).toEqual(unheld);
    expect(held.body?.error?.code).not.toBe('PASSWORD_EXPIRED');
    expect(serviceCalls()).toEqual([]);
  });
});
