// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The authorization pin for the datasource-admin HTTP family.
 *
 * ## Why all three postures, and why on ONE boot
 *
 * This family mounts straight onto `IHttpServer` from a plugin `init()`, which
 * is outside every seam that produces the platform's 401s and 403s — the REST
 * server's `enforceAuth` and the dispatcher domains' anonymous floor both sit
 * on routes this registrar never passes through. A guard added here is
 * therefore the only thing standing between an unentitled caller and datasource
 * lifecycle management, and a test that only asserts the refusals cannot tell
 * "guarded" apart from "broken": an unconditional 401 (or 403) would pass a
 * refusal-only suite perfectly while taking the Setup → Datasources console
 * offline for everyone.
 *
 * So every route below is asserted THREE times against the SAME mounted app —
 * `family` is built once at module scope, so all three answers come from one
 * boot of one registrar, not from differently-wired fixtures that could
 * disagree for reasons other than the caller's identity and grants:
 *
 *  1. **anonymous** → `401 UNAUTHENTICATED` (#9391's floor, unchanged);
 *  2. **authenticated but unentitled** → `403 PERMISSION_DENIED` (#9593);
 *  3. **entitled** → the route's own success status.
 *
 * The three are separate `it`s rather than one, deliberately: that is what
 * makes the red/green split countable when either half of the guard is
 * reverted — removing the capability check turns posture 2 red and leaves 1 and
 * 3 green, which is a different signature from removing the whole guard — and a
 * single combined case would hide every later fact behind the first failure.
 *
 * ## What "entitled" means here, and how it is granted
 *
 * Two things now: the caller is AUTHENTICATED **and** holds
 * `manage_platform_settings` — the capability the sibling Setup-admin families
 * gate on and the one this plugin's own Setup nav entry already declares
 * (`DATASOURCE_ADMIN_CAPABILITY` in the registrar carries the measurement).
 *
 * The grant is delivered the way a deployment delivers it — a
 * `sys_user_permission_set` row binding the user to a `sys_permission_set`
 * whose `system_permissions` names the capability, read by the platform's
 * shared `resolveAuthzContext` off the `objectql` engine — and it is delivered
 * from `entitled-caller.fixture.ts`, which carries that chain once for the
 * three suites in this package that need an entitled caller, and the reasoning
 * behind each of its choices (including why the set is deliberately not
 * `admin_full_access`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { registerDatasourceAdminRoutes, DATASOURCE_ADMIN_CAPABILITY } from '../admin-routes.js';
import {
  ENTITLED_CREDENTIAL as ENTITLED,
  UNENTITLED_CREDENTIAL as UNENTITLED,
  createSessionAuthService,
  createGrantsEngine,
} from './entitled-caller.fixture.js';

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
 * Mount the family once, with the shared `auth` service double — it admits two
 * distinct credentials, one whose user holds the capability and one whose user
 * holds nothing — and the shared grants engine as `objectql`, so the capability
 * half of the guard resolves through the platform's own aggregation.
 */
function mountFamily() {
  const service = createServiceDouble();
  const auth = createSessionAuthService();
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

describe('datasource-admin family — the authenticated caller WITHOUT the capability is refused', () => {
  for (const c of ALL_CASES) {
    it(`${c.name} answers 403 PERMISSION_DENIED without \`${DATASOURCE_ADMIN_CAPABILITY}\``, async () => {
      const { status, body } = await drive(c, UNENTITLED);
      // Status AND the machine-readable code (ADR-0112 envelope). "Not 200"
      // would be satisfied by the 401 the anonymous half already covers and by
      // the 503 an unwired service gives — neither of which is this refusal,
      // and one of which would mean the credential was not read at all.
      expect(status).toBe(403);
      expect(body?.error?.code).toBe('PERMISSION_DENIED');
      // The message names the grant to ask for, and nothing else.
      expect(body?.error?.message).toContain(DATASOURCE_ADMIN_CAPABILITY);
      // Refused BEFORE dispatch, for the reason the anonymous half gives: a
      // DELETE refused after the service ran has already removed the row.
      if (c.dispatches) expect(family.service[c.dispatches]).not.toHaveBeenCalled();
    });
  }
});

describe('datasource-admin family — the entitled caller still succeeds', () => {
  for (const c of ALL_CASES) {
    it(`${c.name} answers ${c.okStatus} for a caller holding \`${DATASOURCE_ADMIN_CAPABILITY}\``, async () => {
      const { status } = await drive(c, ENTITLED);
      expect(status).toBe(c.okStatus);
      if (c.dispatches) expect(family.service[c.dispatches]).toHaveBeenCalled();
    });
  }
});
