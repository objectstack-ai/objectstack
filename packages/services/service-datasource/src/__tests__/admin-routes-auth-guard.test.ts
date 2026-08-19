// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The authentication pin for the datasource-admin HTTP family.
 *
 * ## Why both halves, and why on ONE boot
 *
 * This family mounts straight onto `IHttpServer` from a plugin `init()`, which
 * is outside every seam that produces the platform's 401s — the REST server's
 * `enforceAuth` and the dispatcher domains' anonymous floor both sit on routes
 * this registrar never passes through. A guard added here is therefore the only
 * thing standing between an anonymous caller and datasource lifecycle
 * management, and a test that only asserts the refusal cannot tell "guarded"
 * apart from "broken": an unconditional 401 would pass it perfectly while
 * taking the Setup → Datasources console offline for everyone.
 *
 * So every route below is asserted TWICE against the SAME mounted app —
 * `family` is built once at module scope, so the anonymous refusal and the
 * entitled success are answers from one boot of one registrar, not from two
 * differently-wired fixtures that could disagree for reasons other than the
 * caller's identity.
 *
 * The two halves are separate `it`s rather than one, deliberately: that is what
 * makes the red/green split countable when the guard is reverted — the
 * anonymous half must go red and the entitled half must stay green, and a
 * single combined case would hide the second fact behind the first failure.
 *
 * ## What "entitled" means here, and what it does not
 *
 * Exactly one thing: the caller is AUTHENTICATED. This family's guard is an
 * authentication floor, and nothing in this file asserts a capability — whether
 * these routes should further require something like `manage_platform_settings`
 * is a separate, separately-ruled question (#9593) and deliberately has no
 * scaffolding here.
 *
 * Identity is resolved by the registrar through the platform's shared
 * `resolveAuthzContext`, so the fake `auth` service below is the real seam a
 * session arrives through, not a test-only bypass.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { registerDatasourceAdminRoutes } from '../admin-routes.js';

/** The credential the fake `auth` service below admits. */
const ENTITLED = 'Bearer entitled-session';

/** Every service method the family dispatches to, as spies. */
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
    // `testConnection` is claimed by BOTH services this module dispatches to
    // (an unsaved draft on `datasource-admin`, a saved name on
    // `external-datasource`); one double serves both lookups.
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
  };
}

/**
 * Mount the family once, with a fake `auth` service that admits exactly one
 * credential. `objectql` resolves to `undefined` — the shared resolver reads it
 * only to aggregate permissions, and this pin asserts authentication, so an
 * absent engine must not change who is admitted.
 */
function mountFamily() {
  const service = createServiceDouble();
  const auth = {
    api: {
      getSession: async ({ headers }: { headers: Headers }) =>
        headers?.get?.('authorization') === ENTITLED ? { user: { id: 'u_entitled' } } : null,
    },
  };
  const ctx = {
    getService: vi.fn((name: string) => {
      if (name === 'auth') return auth;
      if (name === 'objectql' || name === 'data') return undefined;
      return service;
    }),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as any;
  const server = new HonoHttpServer(0);
  registerDatasourceAdminRoutes(server, ctx, '/api/v1');
  return { app: server.getRawApp(), service };
}

/** One mount for the whole file — the "same boot" both halves are asserted on. */
const family = mountFamily();

interface RouteCase {
  /** Reads as a sentence in the test name. */
  name: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
  /** The status an ENTITLED caller gets. */
  okStatus: number;
  /**
   * The service method this route dispatches to, if any. Asserted uncalled on
   * the anonymous half: refusing AFTER dispatch would still leak the write.
   * `GET /drivers` is static metadata and dispatches to nothing.
   */
  dispatches?: keyof ReturnType<typeof createServiceDouble>;
}

/** Reads. */
const READ_CASES: RouteCase[] = [
  { name: 'GET /datasources (list)', method: 'GET', path: '/api/v1/datasources', okStatus: 200, dispatches: 'listDatasources' },
  { name: 'GET /datasources/drivers (driver catalog)', method: 'GET', path: '/api/v1/datasources/drivers', okStatus: 200 },
  { name: 'GET /datasources/:name (read)', method: 'GET', path: '/api/v1/datasources/pg', okStatus: 200, dispatches: 'getDatasource' },
  { name: 'GET /datasources/:name/remote-tables (remote-table introspection)', method: 'GET', path: '/api/v1/datasources/pg/remote-tables', okStatus: 200, dispatches: 'listRemoteTables' },
];

/**
 * Writes — every state-changing verb spelled out. The card's acceptance names
 * create, patch and remove explicitly because a list-only assertion would have
 * left the three routes that actually mutate the deployment unpinned.
 */
const WRITE_CASES: RouteCase[] = [
  { name: 'POST /datasources (create)', method: 'POST', path: '/api/v1/datasources', body: { name: 'new_ds', driver: 'sqlite' }, okStatus: 201, dispatches: 'createDatasource' },
  { name: 'PATCH /datasources/:name (patch)', method: 'PATCH', path: '/api/v1/datasources/pg', body: { driver: 'sqlite' }, okStatus: 200, dispatches: 'updateDatasource' },
  { name: 'DELETE /datasources/:name (remove)', method: 'DELETE', path: '/api/v1/datasources/pg', okStatus: 204, dispatches: 'removeDatasource' },
  { name: 'POST /datasources/test (probe an unsaved draft)', method: 'POST', path: '/api/v1/datasources/test', body: { driver: 'sqlite' }, okStatus: 200, dispatches: 'testConnection' },
  { name: 'POST /datasources/:name/test (probe a saved datasource)', method: 'POST', path: '/api/v1/datasources/pg/test', body: {}, okStatus: 200, dispatches: 'testConnection' },
  { name: 'POST /datasources/:name/object-draft (introspect + draft)', method: 'POST', path: '/api/v1/datasources/pg/object-draft', body: { table: 'customers' }, okStatus: 200, dispatches: 'generateObjectDraft' },
  { name: 'POST /datasources/:name/migrate-credential (re-home a stored credential)', method: 'POST', path: '/api/v1/datasources/pg/migrate-credential', body: {}, okStatus: 200, dispatches: 'migrateCredential' },
];

const ALL_CASES = [...READ_CASES, ...WRITE_CASES];

async function drive(c: RouteCase, credential?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (credential) headers.authorization = credential;
  const res = await family.app.fetch(
    new Request(`http://local${c.path}`, {
      method: c.method,
      headers,
      body: c.body === undefined ? undefined : JSON.stringify(c.body),
    }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

beforeEach(() => {
  for (const fn of Object.values(family.service)) fn.mockClear();
});

describe('datasource-admin family — the anonymous caller is refused (read AND write)', () => {
  for (const c of ALL_CASES) {
    it(`${c.name} answers 401 UNAUTHENTICATED with no session`, async () => {
      const { status, body } = await drive(c);
      // The status AND the machine-readable code, not merely "not 200": the
      // contract this restores is the one the sibling families answer, and a
      // bare "not 200" would be satisfied by the 503 an unwired service gives.
      expect(status).toBe(401);
      expect(body?.error?.code).toBe('UNAUTHENTICATED');
      // The refusal precedes dispatch — an anonymous DELETE that reached the
      // service and was refused afterwards would already have removed the row.
      if (c.dispatches) expect(family.service[c.dispatches]).not.toHaveBeenCalled();
    });
  }
});

describe('datasource-admin family — the entitled caller still succeeds', () => {
  for (const c of ALL_CASES) {
    it(`${c.name} answers ${c.okStatus} for an authenticated caller`, async () => {
      const { status } = await drive(c, ENTITLED);
      expect(status).toBe(c.okStatus);
      if (c.dispatches) expect(family.service[c.dispatches]).toHaveBeenCalled();
    });
  }
});
