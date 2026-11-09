// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30958] The platform-admin door that mints and revokes SCIM connection
 * credentials — `POST /api/v1/auth/admin/scim/mint-credential` and
 * `POST /api/v1/auth/admin/scim/revoke-credential` — end to end.
 *
 * ## What is real
 *
 * The two mounts are the plugin's REAL route registration on a real Hono app
 * (the `request-json-body-refusal.test.ts` harness), so the shared
 * `judgePlatformAdmin` gate in front of them is inside the system under test.
 * Behind them sits a real `AuthManager` with SCIM on, over a real `ObjectQL` on
 * better-sqlite3 `:memory:`: the bearer the mint answers is driven into the
 * vendor's own `POST /scim/v2/Users`, verified by the production
 * `verifyBearerToken` wiring, so a mint that digested with the wrong key, or a
 * revoke that wrote nothing, fails at the IdP's door and not at a helper.
 *
 * Only the session is chosen per case: the gate reads it through the auth
 * service's in-process `getSession`, which the harness answers with a platform
 * admin, a signed-in member, or nobody.
 *
 * ## The secret is shown once
 *
 * Every case that mints asserts the plaintext bearer is in the mint's answer
 * and NOWHERE else this file can see: not in the credential row, not in any
 * `sys_audit_log` row, not in any line the plugin logger or the console was
 * handed. The keyed digest is held to the same absence everywhere but its own
 * column.
 */

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { Hono } from 'hono';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { envelopeViolations } from '@objectstack/spec/api';
import type { PluginContext } from '@objectstack/core';
import { AuthPlugin } from './auth-plugin.js';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { createTenancyService } from './tenancy-service.js';
import { SCIM_BEARER_PREFIX, SCIM_CREDENTIAL_OBJECT, digestScimBearerToken } from './scim-connection-service.js';
// The mounts load this module with a dynamic `import()` on first request; paid
// here at collection instead of inside the first case.
import './scim-connection-admin.js';
import 'better-auth';
import 'better-auth/plugins';
import 'better-auth/plugins/admin';
import 'better-auth/plugins/organization';
import '@better-auth/scim';

const ORIGIN = 'http://localhost:3000';
const AUTH = `${ORIGIN}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-30958';
const SYSTEM = { context: { isSystem: true } } as const;
const DEFAULT_ORG = 'org_default';
const OTHER_ORG = 'org_other';

const ADMIN = { user: { id: 'usr_platform_admin', email: 'admin@example.test', isPlatformAdmin: true }, session: {} };
const MEMBER = { user: { id: 'usr_member', email: 'member@example.test', isPlatformAdmin: false, role: 'user' }, session: {} };

/**
 * The columns `sys_audit_log` declares that this door writes — the fixture the
 * plugin-auth harness carries, since plugin-audit (the object's owner) is not a
 * dependency of this package.
 */
const sysAuditLog = {
  name: 'sys_audit_log',
  label: 'Audit Log',
  // As the real object declares it (ADR-0131 D7): a deployment-level ledger
  // with no injected organization column.
  systemFields: { tenant: false },
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    action: { name: 'action', type: 'text' as const },
    user_id: { name: 'user_id', type: 'text' as const },
    actor: { name: 'actor', type: 'text' as const },
    object_name: { name: 'object_name', type: 'text' as const },
    record_id: { name: 'record_id', type: 'text' as const },
    metadata: { name: 'metadata', type: 'textarea' as const },
  },
};

let engine: ObjectQL;
let manager: AuthManager;
let app: Hono;
let session: unknown = ADMIN;
const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeAll(async () => {
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const object of [...authIdentityObjects, sysAuditLog]) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();
  await engine.insert('sys_organization', { id: DEFAULT_ORG, name: 'Default Organization', slug: 'default' }, SYSTEM);
  await engine.insert('sys_organization', { id: OTHER_ORG, name: 'Other Organization', slug: 'other' }, SYSTEM);

  manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine as never,
    getTenancy: () => createTenancyService({ requested: 'isolated', probeIsolation: () => true }),
    plugins: { scim: true, organization: true },
  } as never);
  // The gate reads the caller through the auth service's in-process session read.
  vi.spyOn(manager, 'getApi').mockImplementation(async () => ({ getSession: async () => session }) as never);

  const ctx = {
    registerService: vi.fn(),
    getService: vi.fn((name: string) => (name === 'manifest' ? { register: vi.fn() } : undefined)),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger,
    getKernel: vi.fn(),
  } as unknown as PluginContext;
  const plugin = new AuthPlugin({ secret: SECRET, plugins: { oidcProvider: false } });
  await plugin.init(ctx);
  (plugin as unknown as { authManager: AuthManager }).authManager = manager;
  app = new Hono();
  (plugin as unknown as { registerAuthRoutes(server: unknown, c: PluginContext): void })
    .registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);

  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    consoleSpies.push(vi.spyOn(console, method));
  }
}, 60_000);

afterEach(() => {
  session = ADMIN;
});

afterAll(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

// ── Requests ────────────────────────────────────────────────────────────────

async function door(path: 'mint-credential' | 'revoke-credential', body: unknown): Promise<{ status: number; body: any; cacheControl: string | null }> {
  const res = await app.request(`${AUTH}/admin/scim/${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json(), cacheControl: res.headers.get('cache-control') };
}

/** `POST /Users` as an identity provider sends it, with `token` as the bearer. */
async function provision(token: string, localPart: string): Promise<Response> {
  const email = `${localPart}@example.com`;
  return manager.handleRequest(
    new Request(`${AUTH}/scim/v2/Users`, {
      method: 'POST',
      headers: { origin: ORIGIN, authorization: `Bearer ${token}`, 'content-type': 'application/scim+json' },
      body: JSON.stringify({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: email,
        name: { givenName: localPart, familyName: 'Example' },
        emails: [{ value: email, primary: true, type: 'work' }],
        active: true,
      }),
    }),
  );
}

// ── Reads ───────────────────────────────────────────────────────────────────

async function credentialRows(connectionId: string): Promise<Array<Record<string, unknown>>> {
  return (await engine.find(SCIM_CREDENTIAL_OBJECT, { where: { connection_id: connectionId } }, SYSTEM)) as never;
}

async function auditRows(credentialId: string): Promise<Array<Record<string, unknown>>> {
  return (await engine.find('sys_audit_log', { where: { record_id: credentialId } }, SYSTEM)) as never;
}

/** Every line the plugin logger and the console were handed, as one string. */
function everythingLogged(): string {
  const calls: unknown[][] = [
    ...Object.values(logger).flatMap((fn) => fn.mock.calls),
    ...consoleSpies.flatMap((spy) => spy.mock.calls),
  ];
  return calls.map((args) => args.map((a: unknown) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')).join('\n');
}

/** The bearer and its digest appear in no audit row and no log line. */
async function expectSecretNowhereElse(token: string, credentialId: string): Promise<void> {
  const digest = digestScimBearerToken(SECRET, token);
  const audit = JSON.stringify(await engine.find('sys_audit_log', {}, SYSTEM));
  expect(audit).not.toContain(token);
  expect(audit).not.toContain(digest);
  const logged = everythingLogged();
  expect(logged).not.toContain(token);
  expect(logged).not.toContain(digest);
  // At rest (read below the engine, as `credential-at-rest-posture.test.ts`
  // does) the row holds the digest and never the bearer.
  const driver = (engine as unknown as { getDriver(o: string): { find(o: string, q: unknown): Promise<unknown> } })
    .getDriver(SCIM_CREDENTIAL_OBJECT);
  const atRest = ((await driver.find(SCIM_CREDENTIAL_OBJECT, { where: { id: credentialId } })) as Array<Record<string, unknown>>)[0];
  expect(atRest.token_digest).toBe(digest);
  expect(JSON.stringify(atRest)).not.toContain(token);
  // Through the engine — even a system read — the digest column is not served
  // at all (`internal: true`), so no read the data API builds on can return it.
  const served = JSON.stringify(await engine.find(SCIM_CREDENTIAL_OBJECT, { where: { id: credentialId } }, SYSTEM));
  expect(served).toContain(credentialId);
  expect(served).not.toContain(digest);
  expect(served).not.toContain(token);
}

// ── The cases ───────────────────────────────────────────────────────────────

describe('[#30958] mint: the platform admin gets a bearer the SCIM plugin accepts, shown once', () => {
  it('an admin mints, and SCIM POST /Users with that bearer answers 201', async () => {
    const minted = await door('mint-credential', { connectionId: 'okta-30958', label: 'first rotation' });
    expect(minted.status, JSON.stringify(minted.body)).toBe(200);
    expect(envelopeViolations(minted.body)).toEqual([]);
    expect(minted.cacheControl).toBe('no-store');
    const { token, credentialId, connectionId, expiresAt } = minted.body.data;
    expect(typeof token).toBe('string');
    expect(token.startsWith(SCIM_BEARER_PREFIX)).toBe(true);
    expect(connectionId).toBe('okta-30958');
    expect(expiresAt).toBeNull();

    const created = await provision(token, 'mint-30958');
    expect(created.status, `SCIM POST /Users: ${await created.clone().text()}`).toBe(201);

    // The row the mint stored: owned by the Default Organization, minted by the admin, active.
    const [row] = await credentialRows('okta-30958');
    expect(row.id).toBe(credentialId);
    expect(row.organization_id).toBe(DEFAULT_ORG);
    expect(row.user_id).toBe(ADMIN.user.id);
    expect(row.label).toBe('first rotation');
    expect(Boolean(row.active)).toBe(true);

    // One audit row, naming the admin and the connection.
    const audit = await auditRows(credentialId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'create', user_id: ADMIN.user.id, actor: ADMIN.user.id, object_name: SCIM_CREDENTIAL_OBJECT });
    expect(JSON.parse(String(audit[0].metadata))).toEqual({ event: 'scim_credential_minted', connectionId: 'okta-30958' });

    await expectSecretNowhereElse(token, credentialId);
  }, 30_000);

  it('a mint on an impersonation session names the administrator at the keyboard in its audit row', async () => {
    // The gate reads `impersonatedBy` off the session, never off the body.
    session = { user: ADMIN.user, session: { impersonatedBy: 'usr_support_admin' } };
    const minted = await door('mint-credential', { connectionId: 'okta-impersonated', impersonatedBy: 'usr_forged' });
    expect(minted.status, JSON.stringify(minted.body)).toBe(200);
    const { token, credentialId } = minted.body.data;
    const audit = await auditRows(credentialId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'create', user_id: ADMIN.user.id, actor: ADMIN.user.id });
    expect(JSON.parse(String(audit[0].metadata))).toEqual({
      event: 'scim_credential_minted',
      connectionId: 'okta-impersonated',
      impersonated_by: 'usr_support_admin',
    });
    await expectSecretNowhereElse(token, credentialId);
  }, 30_000);

  it('the owning organization is the one the request names, which must exist', async () => {
    const named = await door('mint-credential', { connectionId: 'entra-other-org', organizationId: OTHER_ORG });
    expect(named.status, JSON.stringify(named.body)).toBe(200);
    expect((await credentialRows('entra-other-org'))[0].organization_id).toBe(OTHER_ORG);

    const unknown = await door('mint-credential', { connectionId: 'entra-nowhere', organizationId: 'org_missing' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('INVALID_REQUEST');
    expect(await credentialRows('entra-nowhere')).toEqual([]);
  });

  it('a malformed request is refused before anything is stored', async () => {
    for (const body of [
      {},
      { connectionId: '' },
      { connectionId: ' padded ' },
      { connectionId: 42 },
      { connectionId: 'x'.repeat(247) },
      { connectionId: 'okta-bad-expiry', expiresAt: 'not-a-date' },
      { connectionId: 'okta-bad-expiry', expiresAt: new Date(Date.now() - 60_000).toISOString() },
      { connectionId: 'okta-bad-label', label: 7 },
    ]) {
      const res = await door('mint-credential', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REQUEST');
    }
    expect(await credentialRows('okta-bad-expiry')).toEqual([]);
    expect(await credentialRows('okta-bad-label')).toEqual([]);
  });

  it('a connection id leaves room for the svc:scim: audit actor: 246 characters mint, 247 are refused', async () => {
    // A SCIM connection's own writes are audited as `svc:scim:<connectionId>`
    // (#30960) in `sys_audit_log.actor`, which holds 255 characters.
    expect('svc:scim:'.length + 246).toBe(255);
    const longest = 'c'.repeat(246);
    const minted = await door('mint-credential', { connectionId: longest });
    expect(minted.status, JSON.stringify(minted.body)).toBe(200);
    expect(minted.body.data.connectionId).toBe(longest);
    expect(await credentialRows(longest)).toHaveLength(1);

    const tooLong = 'c'.repeat(247);
    const refused = await door('mint-credential', { connectionId: tooLong });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('INVALID_REQUEST');
    expect(refused.body.error.message).toContain('at most 246 characters');
    expect(await credentialRows(tooLong)).toEqual([]);
  });

  it('a future expiry is stored and answered', async () => {
    const at = new Date(Date.now() + 86_400_000).toISOString();
    const res = await door('mint-credential', { connectionId: 'okta-expiring', expiresAt: at });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.expiresAt).toBe(at);
    expect(new Date(String((await credentialRows('okta-expiring'))[0].expires_at)).toISOString()).toBe(at);
  });

  it('refused 503 while SCIM is off, and nothing is stored', async () => {
    const off = vi.spyOn(manager, 'isScimWired').mockReturnValue(false);
    try {
      const res = await door('mint-credential', { connectionId: 'okta-scim-off' });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(await credentialRows('okta-scim-off')).toEqual([]);
    } finally {
      off.mockRestore();
    }
  });
});

describe('[#30958] only the platform admin mints or revokes', () => {
  it('a signed-in non-admin is refused 403 and an anonymous caller 401, on both doors, and nothing moves', async () => {
    const minted = await door('mint-credential', { connectionId: 'okta-gate' });
    expect(minted.status).toBe(200);
    const { credentialId, token } = minted.body.data;

    for (const [caller, status, code] of [[MEMBER, 403, 'PERMISSION_DENIED'], [null, 401, 'UNAUTHENTICATED']] as const) {
      session = caller;
      const mint = await door('mint-credential', { connectionId: 'okta-gate-refused' });
      expect(mint.status, JSON.stringify(mint.body)).toBe(status);
      expect(mint.body.error.code).toBe(code);
      expect(mint.body.data).toBeUndefined();
      const revoke = await door('revoke-credential', { credentialId });
      expect(revoke.status, JSON.stringify(revoke.body)).toBe(status);
      expect(revoke.body.error.code).toBe(code);
    }
    session = ADMIN;

    expect(await credentialRows('okta-gate-refused')).toEqual([]);
    expect(Boolean((await credentialRows('okta-gate'))[0].active)).toBe(true);
    expect(await auditRows(credentialId)).toHaveLength(1); // the mint's own, nothing more
    expect((await provision(token, 'gate-30958')).status).toBe(201);
  }, 30_000);
});

describe('[#30958] revoke: the bearer is refused from the next request on; rotate = mint + revoke', () => {
  it('a revoked bearer answers 401, its rotation successor still provisions, and each revoke is audited once', async () => {
    const old = (await door('mint-credential', { connectionId: 'okta-rotate' })).body.data;
    const next = (await door('mint-credential', { connectionId: 'okta-rotate', label: 'rotation 2' })).body.data;
    expect(old.credentialId).not.toBe(next.credentialId);
    expect((await provision(old.token, 'rotate-before')).status).toBe(201);

    const revoked = await door('revoke-credential', { credentialId: old.credentialId });
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(200);
    expect(envelopeViolations(revoked.body)).toEqual([]);
    expect(revoked.body.data).toEqual({ credentialId: old.credentialId, connectionId: 'okta-rotate', active: false });

    const refused = await provision(old.token, 'rotate-after-old');
    expect(refused.status).toBe(401);
    expect(String(((await refused.json()) as { status?: unknown }).status)).toBe('401');
    expect((await provision(next.token, 'rotate-after-new')).status).toBe(201);

    // The row is kept, switched off.
    const rows = await credentialRows('okta-rotate');
    expect(rows).toHaveLength(2);
    expect(Boolean(rows.find((r) => r.id === old.credentialId)!.active)).toBe(false);
    expect(Boolean(rows.find((r) => r.id === next.credentialId)!.active)).toBe(true);

    const audit = await auditRows(old.credentialId);
    expect(audit.map((r) => r.action).sort()).toEqual(['create', 'update']);
    const revokeRow = audit.find((r) => r.action === 'update')!;
    expect(revokeRow).toMatchObject({ user_id: ADMIN.user.id, actor: ADMIN.user.id, object_name: SCIM_CREDENTIAL_OBJECT });
    expect(JSON.parse(String(revokeRow.metadata))).toEqual({ event: 'scim_credential_revoked', connectionId: 'okta-rotate' });

    // Already revoked: 409, nothing written, no second audit row.
    const again = await door('revoke-credential', { credentialId: old.credentialId });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('RESOURCE_CONFLICT');
    expect(await auditRows(old.credentialId)).toHaveLength(2);

    await expectSecretNowhereElse(old.token, old.credentialId);
    await expectSecretNowhereElse(next.token, next.credentialId);
  }, 30_000);

  it('an unknown credential is 404, a missing id 400, and revoke serves while SCIM is off', async () => {
    const unknown = await door('revoke-credential', { credentialId: 'cred_missing' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('RESOURCE_NOT_FOUND');
    const missing = await door('revoke-credential', {});
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('INVALID_REQUEST');

    const minted = (await door('mint-credential', { connectionId: 'okta-revoke-while-off' })).body.data;
    const off = vi.spyOn(manager, 'isScimWired').mockReturnValue(false);
    try {
      const res = await door('revoke-credential', { credentialId: minted.credentialId });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    } finally {
      off.mockRestore();
    }
    expect((await provision(minted.token, 'revoked-while-off')).status).toBe(401);
  }, 30_000);
});
