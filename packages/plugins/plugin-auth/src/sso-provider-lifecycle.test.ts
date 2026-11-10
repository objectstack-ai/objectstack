// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32085] The SSO provider lifecycle — see `sso-provider-lifecycle.ts` and the
 * edit bridge in `register-sso-provider.ts` for the rules this file pins.
 *
 * Everything is real except the IdP, which no case needs: a real ObjectQL
 * engine over better-sqlite3, the real `AuthManager` with the real `sso()`
 * plugin, real sign-ups and session cookies, and the real `AuthPlugin` route
 * registration on a Hono app for the `/admin/sso/*` doors. The harness is the
 * one `sso-register-platform-admin-gate.test.ts` runs on (its RBAC objects
 * declared locally, the platform admin granted the ADR-0068 way), with the
 * grant table carrying the `reason` column the projection writes.
 *
 * Pinned:
 *
 *  1. Deleting a provider names what it removes, before (the delete action's
 *     preflight read) and after (the delete's own answer): the users it
 *     unlinks and those of them with no other sign-in method; and after a
 *     delete the vendor admitted, the provider's group mappings and the
 *     grants whose reason is exactly its projection marker are gone, while a
 *     grant by hand, another provider's, and another provider's mapping stay.
 *     A refused delete removes nothing; a count that cannot be read refuses
 *     the delete; a cleanup that fails is said in the answer and at `error`.
 *  2. One email domain, one provider: register (both doors) and a domain edit
 *     onto a served domain are refused `409 RESOURCE_CONFLICT` on `domain`,
 *     naming the holder to a platform administrator; a subdomain beside its
 *     parent is accepted.
 *  3. The edit door: a SAML signing certificate rotates with users linked (and
 *     may overlap the current one), an identity change with users linked is
 *     refused with that reason, an OIDC client secret is replaced without ever
 *     being answered, and a field of the other protocol is refused naming the
 *     right action.
 */

import { describe, it, expect, afterEach, vi, beforeAll } from 'vitest';
import { generateKeyPairSync, sign, X509Certificate, type KeyObject } from 'node:crypto';
import { Hono } from 'hono';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { ADMIN_FULL_ACCESS_CAPABILITIES } from '@objectstack/spec';
import { SysSecret } from '@objectstack/platform-objects';
import { SysSsoProvider } from '@objectstack/platform-objects/identity';
import type { PluginContext } from '@objectstack/core';
import type { CryptoHandle, ICryptoProvider } from '@objectstack/spec/contracts';
import { AuthManager } from './auth-manager.js';
import { AuthPlugin } from './auth-plugin.js';
import { authIdentityObjects, authObjectExtensions } from './manifest.js';
import { createTenancyService } from './tenancy-service.js';
import { inviteForAudienceGate } from './audience-gate-test-support';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';
import { ssoGroupProjectionReason } from './scim-group-projection.js';
import { createEngineSsoProviderConfigReader } from './register-sso-provider.js';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-32085';
const PASSWORD = 'S3cure!Passw0rd-32085';
const SYSTEM = { context: { isSystem: true } } as const;
const ORG = 'org_acme_32085';
const ADMIN_EMAIL = 'platformadmin@example.com';

// ── Fixture objects (the `sso-register-platform-admin-gate.test.ts` set) ────

const sysPermissionSet = {
  name: 'sys_permission_set',
  label: 'Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
  },
};

/** The grant table, with the `reason` column the SSO projection writes its marker to. */
const sysUserPermissionSet = {
  name: 'sys_user_permission_set',
  label: 'User Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    user_id: { name: 'user_id', type: 'text' as const },
    permission_set_id: { name: 'permission_set_id', type: 'text' as const },
    permission_set: { name: 'permission_set', type: 'text' as const },
    organization_id: { name: 'organization_id', type: 'text' as const },
    reason: { name: 'reason', type: 'text' as const },
  },
};

const sysPosition = {
  name: 'sys_position',
  label: 'Position',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    active: { name: 'active', type: 'boolean' as const },
    organization_id: { name: 'organization_id', type: 'text' as const },
  },
};

const sysUserPosition = {
  name: 'sys_user_position',
  label: 'User Position',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    user_id: { name: 'user_id', type: 'text' as const },
    position: { name: 'position', type: 'text' as const },
    organization_id: { name: 'organization_id', type: 'text' as const },
  },
};

/** An object with the fields plugin-auth's manifest adds to it (`authObjectExtensions`), e.g. `oidc_client_secret`. */
function withAuthExtensions(object: { name?: string; fields?: Record<string, unknown> }): unknown {
  const extension = authObjectExtensions.find((e) => e.extend === object.name);
  return extension ? { ...object, fields: { ...object.fields, ...extension.fields } } : object;
}

/** A stand-in `ICryptoProvider`: base64 is enough to round-trip the OIDC client secret column. */
function base64Crypto(): ICryptoProvider {
  let n = 0;
  return {
    async encrypt(plain: string): Promise<CryptoHandle> {
      n += 1;
      return { id: `sec_${n}`, kmsKeyId: 'local', alg: 'test-b64', version: 1, ciphertext: Buffer.from(plain, 'utf8').toString('base64') };
    },
    async decrypt(handle: CryptoHandle): Promise<string> { return Buffer.from(handle.ciphertext, 'base64').toString('utf8'); },
    async rotateKey(handle: CryptoHandle): Promise<CryptoHandle> { return { ...handle, version: handle.version + 1 }; },
    digest(plain: string): string { return `d:${plain.length}`; },
    async keyedDigest(plain: string): Promise<string> { return `k:${plain.length}`; },
  };
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    const e = engines.pop();
    try {
      await (e as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
});

async function bootEngine(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const object of [...authIdentityObjects, SysSecret]) {
    engine.registry.registerObject(withAuthExtensions(object) as never, '@objectstack/plugin-auth');
  }
  for (const object of [sysPermissionSet, sysUserPermissionSet, sysPosition, sysUserPosition]) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();
  await relaxTenantColumns(engine, ['sys_permission_set']);
  engine.setCryptoProvider(base64Crypto());
  return bindTestSecurityCatalog(engine, { permissions: [{ name: ADMIN_FULL_ACCESS, ...ADMIN_FULL_ACCESS_CAPABILITIES }] });
}

const mockCtx = (): PluginContext =>
  ({
    registerService: vi.fn(),
    getService: vi.fn((name: string) => (name === 'manifest' ? { register: vi.fn() } : undefined)),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(),
  }) as any;

const cookiesFrom = (res: Response): string =>
  (res.headers.get('set-cookie') ?? '')
    .split(',')
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');

interface Stage {
  engine: ObjectQL;
  manager: AuthManager;
  app: Hono;
  error: ReturnType<typeof vi.fn>;
  adminId: string;
  adminCookie: string;
  send: (r: Request) => Promise<Response>;
  signUp: (email: string) => Promise<string>;
  userIdOf: (email: string) => Promise<string>;
}

/** A deployment with SSO on, a signed-in platform administrator, and the real route registration. */
async function stage(): Promise<Stage> {
  const engine = await bootEngine();
  const error = vi.fn();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as never,
    getTenancy: () => createTenancyService({ requested: 'isolated', probeIsolation: () => true }),
    plugins: { organization: true, sso: true },
    logger: { error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  } as never);
  const send = (r: Request) => manager.handleRequest(r);
  const signUp = async (email: string): Promise<string> => {
    const invitationId = await inviteForAudienceGate(engine, email);
    const res = await send(
      new Request(`${AUTH}/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify({ email, password: PASSWORD, name: email.split('@')[0], invitationId }),
      }),
    );
    expect(res.status, `sign-up ${email}: ${await res.clone().text()}`).toBeLessThan(400);
    return cookiesFrom(res);
  };
  const userIdOf = async (email: string): Promise<string> => {
    const row = (await engine.findOne('sys_user', { where: { email } }, SYSTEM as never)) as Record<string, unknown> | null;
    expect(row, `no sys_user row for ${email}`).toBeTruthy();
    return String(row!.id);
  };

  const adminCookie = await signUp(ADMIN_EMAIL);
  const adminId = await userIdOf(ADMIN_EMAIL);
  // ADR-0068 D2: an `admin_full_access` link owned by the Default Organization.
  await engine.insert('sys_organization', { id: 'org_default', name: 'Default Organization', slug: 'default' }, SYSTEM as never);
  await engine.insert('sys_organization', { id: ORG, name: 'Acme', slug: 'acme-32085' }, SYSTEM as never);
  await residue(engine, 'sys_permission_set', { id: 'ps_admin_full_access', name: ADMIN_FULL_ACCESS });
  await residue(engine, 'sys_user_permission_set', {
    id: 'ups_platform_admin',
    user_id: adminId,
    permission_set_id: 'ps_admin_full_access',
    permission_set: 'admin_full_access',
    organization_id: 'org_default',
  });

  const app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET });
  await plugin.init(ctx);
  (plugin as any).authManager = manager;
  (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);

  return { engine, manager, app, error, adminId, adminCookie, send, signUp, userIdOf };
}

/** A fixture row written beneath the engine (no hooks), as the platform admin grant is. */
function residue(engine: ObjectQL, object: string, row: Record<string, unknown>): Promise<unknown> {
  return (engine as any).getDriver(object).create(object, row);
}

/** A provider stored through better-auth's own adapter, as the vendor's register writes it. */
async function storeProvider(
  s: Stage,
  provider: { providerId: string; domain: string; userId?: string; issuer?: string; oidcConfig?: Record<string, unknown>; samlConfig?: Record<string, unknown> },
): Promise<void> {
  const auth: any = await s.manager.getAuthInstance();
  const ctx = await auth.$context;
  const issuer = provider.issuer ?? `https://${provider.providerId}.idp.example`;
  await ctx.adapter.create({
    model: 'ssoProvider',
    data: {
      providerId: provider.providerId,
      issuer,
      domain: provider.domain,
      userId: provider.userId ?? s.adminId,
      ...(provider.samlConfig
        ? { samlConfig: JSON.stringify(provider.samlConfig) }
        : { oidcConfig: JSON.stringify(provider.oidcConfig ?? { issuer, clientId: `${provider.providerId}-client`, clientSecret: 'stored-secret', pkce: true }) }),
    },
  });
}

/** Link `userId` to `providerId` the way a sign-in through it does: an `account` row of that provider. */
async function link(s: Stage, userId: string, providerId: string, accountId: string): Promise<void> {
  const auth: any = await s.manager.getAuthInstance();
  const ctx = await auth.$context;
  await ctx.adapter.create({ model: 'account', data: { accountId, providerId, userId } });
}

/** A user with no password, who has only ever signed in through an identity provider. */
async function ssoOnlyUser(s: Stage, email: string): Promise<string> {
  const auth: any = await s.manager.getAuthInstance();
  const ctx = await auth.$context;
  const user = await ctx.adapter.create({ model: 'user', data: { email, name: email.split('@')[0], emailVerified: true } });
  return String(user.id);
}

const postJson = (s: Stage, path: string, body: unknown, cookie: string | undefined = s.adminCookie) =>
  s.send(
    new Request(`${AUTH}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );

const bridge = (s: Stage, method: 'GET' | 'POST', path: string, body?: unknown, cookie: string = s.adminCookie) =>
  s.app.request(`${AUTH}${path}`, {
    method,
    headers: { 'content-type': 'application/json', origin: BASE, cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function rows(s: Stage, object: string, where: Record<string, unknown> = {}): Promise<Record<string, unknown>[]> {
  return (await s.engine.find(object, { where }, SYSTEM as never)) as Record<string, unknown>[];
}

// ── 1. Deleting a provider ──────────────────────────────────────────────────

const PROVIDER = 'acme-okta';
const OTHER = 'globex-entra';
const MARKER = ssoGroupProjectionReason(PROVIDER);

describe('deleting an SSO provider names what it removes, and removes what the provider left behind', () => {
  /**
   * `acme-okta` with two linked users — Mia, who has only that sign-in, and
   * Ann, who also has a password — two group mappings, and the two grants
   * they projected; beside them a grant made by hand, a grant and a mapping of
   * another provider, and a SCIM mapping, none of which the delete may touch.
   */
  async function arrange() {
    const s = await stage();
    await storeProvider(s, { providerId: PROVIDER, domain: 'acme.example' });
    await storeProvider(s, { providerId: OTHER, domain: 'globex.example' });
    const mia = await ssoOnlyUser(s, 'mia@acme.example');
    await s.signUp('ann@acme.example');
    const ann = await s.userIdOf('ann@acme.example');
    await link(s, mia, PROVIDER, 'idp-sub-mia');
    await link(s, ann, PROVIDER, 'idp-sub-ann');

    const mapping = (id: string, kind: string, source: string, set: string) =>
      residue(s.engine, 'sys_idp_group_mapping', {
        id, source_kind: kind, source_id: source, group_display_name: `${set} group`, permission_set: set, organization_id: ORG,
      });
    await mapping('map_acme_sales', 'sso', PROVIDER, 'sales_reader');
    await mapping('map_acme_support', 'sso', PROVIDER, 'support_agent');
    await mapping('map_globex_sales', 'sso', OTHER, 'sales_reader');
    await mapping('map_scim_sales', 'scim', 'scim_conn_1', 'sales_reader');

    const grant = (id: string, userId: string, set: string, reason: string | null) =>
      residue(s.engine, 'sys_user_permission_set', { id, user_id: userId, permission_set: set, organization_id: ORG, reason });
    await grant('ups_mia_sales', mia, 'sales_reader', MARKER);
    await grant('ups_ann_support', ann, 'support_agent', MARKER);
    await grant('ups_ann_by_hand', ann, 'sales_reader', null);
    await grant('ups_ann_globex', ann, 'sales_reader', ssoGroupProjectionReason(OTHER));
    return { s, mia, ann };
  }

  const remove = (s: Stage, providerId: string, cookie?: string) => postJson(s, '/sso/delete-provider', { providerId }, cookie);

  it('the preflight read names the users unlinked, those who lose access, and the mappings and grants removed', async () => {
    const { s } = await arrange();
    const res = await bridge(s, 'GET', `/admin/sso/delete-impact?providerId=${PROVIDER}`);
    const body = (await res.json()) as any;
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        providerId: PROVIDER,
        linkedUsers: 2,
        usersWithoutOtherSignIn: 1,
        groupMappings: 2,
        projectedGrants: 2,
        summary:
          "Deleting SSO provider 'acme-okta' unlinks 2 users from it; 1 of them has no password or other sign-in method linked and loses access. "
          + 'It also removes 2 IdP group mappings and the 2 permission-set grants they gave.',
      },
    });
    // A read: nothing moved.
    expect(await rows(s, 'sys_account', { provider_id: PROVIDER })).toHaveLength(2);
    expect(await rows(s, 'sys_user_permission_set', { reason: MARKER })).toHaveLength(2);
  }, 30_000);

  it('the preflight read refuses an unknown provider 404 and an unknown or repeated parameter 400', async () => {
    const { s } = await arrange();
    const unknown = await bridge(s, 'GET', '/admin/sso/delete-impact?providerId=nobody');
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as any).error.code).toBe('RESOURCE_NOT_FOUND');
    const extra = await bridge(s, 'GET', `/admin/sso/delete-impact?providerId=${PROVIDER}&userId=x`);
    expect(extra.status).toBe(400);
    expect(((await extra.json()) as any).error.code).toBe('VALIDATION_ERROR');
    const repeated = await bridge(s, 'GET', `/admin/sso/delete-impact?providerId=${PROVIDER}&providerId=${OTHER}`);
    expect(repeated.status).toBe(400);
    const missing = await bridge(s, 'GET', '/admin/sso/delete-impact');
    expect(missing.status).toBe(400);
  }, 30_000);

  it('the delete answers the counts, and removes the provider mappings and the grants carrying its marker only', async () => {
    const { s, ann } = await arrange();
    const res = await remove(s, PROVIDER);
    const body = (await res.json()) as any;
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        providerId: PROVIDER,
        unlinkedUsers: 2,
        usersWithoutOtherSignIn: 1,
        removedGroupMappings: 2,
        removedGrants: 2,
        dependentsRemoved: true,
        message:
          "Deleting SSO provider 'acme-okta' unlinked 2 users from it; 1 of them has no password or other sign-in method linked and lost access. "
          + 'It removed 2 IdP group mappings and the 2 permission-set grants they gave.',
      },
    });

    // The vendor's half: the provider and its accounts are gone; Ann's password stays.
    expect(await rows(s, 'sys_sso_provider', { provider_id: PROVIDER })).toHaveLength(0);
    expect(await rows(s, 'sys_account', { provider_id: PROVIDER })).toHaveLength(0);
    expect((await rows(s, 'sys_account', { user_id: ann })).map((r) => r.provider_id)).toEqual(['credential']);

    // Ours: the provider's mappings and marker grants are gone; nothing else moved.
    expect((await rows(s, 'sys_idp_group_mapping')).map((r) => r.id).sort()).toEqual(['map_globex_sales', 'map_scim_sales']);
    expect((await rows(s, 'sys_user_permission_set')).map((r) => r.id).sort()).toEqual([
      'ups_ann_by_hand',
      'ups_ann_globex',
      'ups_platform_admin',
    ]);
    expect(s.error).not.toHaveBeenCalled();
  }, 30_000);

  it('a delete the vendor refuses removes nothing and carries no counts', async () => {
    const { s } = await arrange();
    const memberCookie = await s.signUp('member@example.com');
    const refused = await remove(s, PROVIDER, memberCookie);
    const body = (await refused.json()) as any;
    expect(refused.status, JSON.stringify(body)).toBe(403);
    expect(body.data).toBeUndefined();
    const unknown = await remove(s, 'nobody');
    expect(unknown.status).toBe(404);

    expect(await rows(s, 'sys_sso_provider', { provider_id: PROVIDER })).toHaveLength(1);
    expect(await rows(s, 'sys_account', { provider_id: PROVIDER })).toHaveLength(2);
    expect(await rows(s, 'sys_idp_group_mapping')).toHaveLength(4);
    expect(await rows(s, 'sys_user_permission_set', { reason: MARKER })).toHaveLength(2);
  }, 30_000);

  it('a count that cannot be read refuses the delete 503, and nothing is deleted', async () => {
    const { s } = await arrange();
    const find = s.engine.find.bind(s.engine);
    vi.spyOn(s.engine, 'find').mockImplementation(async (object: string, ...rest: unknown[]) => {
      if (object === 'sys_idp_group_mapping') throw new Error('mapping table unreachable');
      return (find as any)(object, ...rest);
    });
    const res = await remove(s, PROVIDER);
    const body = (await res.json()) as any;
    expect(res.status, JSON.stringify(body)).toBe(503);
    expect(body.code).toBe('SERVICE_UNAVAILABLE');
    vi.restoreAllMocks();
    expect(await rows(s, 'sys_sso_provider', { provider_id: PROVIDER })).toHaveLength(1);
    expect(await rows(s, 'sys_account', { provider_id: PROVIDER })).toHaveLength(2);
  }, 30_000);

  it('a cleanup that fails after the delete is said in the answer and once at error', async () => {
    const { s } = await arrange();
    const del = s.engine.delete.bind(s.engine);
    vi.spyOn(s.engine, 'delete').mockImplementation(async (object: string, ...rest: unknown[]) => {
      if (object === 'sys_user_permission_set') throw new Error('grant table read-only');
      return (del as any)(object, ...rest);
    });
    const res = await remove(s, PROVIDER);
    const body = (await res.json()) as any;
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data).toMatchObject({ providerId: PROVIDER, unlinkedUsers: 2, dependentsRemoved: false, removedGrants: 0 });
    expect(body.data.message).toContain('could NOT be removed');
    expect(s.error).toHaveBeenCalledTimes(1);
    expect(String(s.error.mock.calls[0][0])).toContain(MARKER);
  }, 30_000);
});

// ── 2. One domain, one provider ─────────────────────────────────────────────

describe('an email domain another provider serves is refused on register and on a domain edit', () => {
  const oidcRegister = (providerId: string, domain: string) => ({
    providerId,
    issuer: `https://${providerId}.idp.example`,
    domain,
    oidcConfig: { clientId: 'cid', clientSecret: 'csecret', mapping: { email: 'email', name: 'name' } },
  });

  it('direct /sso/register onto a served domain: 409 RESOURCE_CONFLICT on domain, naming the provider; nothing written', async () => {
    const s = await stage();
    await storeProvider(s, { providerId: PROVIDER, domain: 'acme.example, acme.io' });
    for (const domain of ['acme.example', 'ACME.IO', 'https://acme.example/', 'other.example,acme.io']) {
      const res = await postJson(s, '/sso/register', oidcRegister('second', domain));
      const body = (await res.json()) as any;
      expect(res.status, `${domain}: ${JSON.stringify(body)}`).toBe(409);
      expect(body).toMatchObject({ code: 'RESOURCE_CONFLICT', field: 'domain', heldBy: PROVIDER });
      expect(body.message).toContain(`SSO provider '${PROVIDER}'`);
    }
    expect((await rows(s, 'sys_sso_provider')).map((r) => r.provider_id)).toEqual([PROVIDER]);
  }, 30_000);

  it('the register bridge relays the located refusal as it came', async () => {
    const s = await stage();
    await storeProvider(s, { providerId: PROVIDER, domain: 'acme.example' });
    const res = await bridge(s, 'POST', '/admin/sso/register-saml', {
      providerId: 'second-saml',
      issuer: 'https://saml.acme.example/entity',
      domain: 'acme.example',
      entryPoint: 'https://saml.acme.example/sso',
      cert: certificate(),
    });
    const body = (await res.json()) as any;
    expect(res.status, JSON.stringify(body)).toBe(409);
    expect(body.error).toMatchObject({ code: 'RESOURCE_CONFLICT', field: 'domain', heldBy: PROVIDER });
  }, 30_000);

  it('control: a subdomain beside its parent is a working configuration, and is registered', async () => {
    const s = await stage();
    await storeProvider(s, { providerId: PROVIDER, domain: 'acme.example' });
    const res = await bridge(s, 'POST', '/admin/sso/register-saml', {
      providerId: 'eng-saml',
      issuer: 'https://saml.eng.acme.example/entity',
      domain: 'eng.acme.example',
      entryPoint: 'https://saml.eng.acme.example/sso',
      cert: certificate(),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await rows(s, 'sys_sso_provider')).map((r) => r.provider_id).sort()).toEqual([PROVIDER, 'eng-saml']);

    // And the other way round: a parent beside a provider for one of its subdomains.
    await storeProvider(s, { providerId: OTHER, domain: 'eng.globex.example' });
    const parent = await bridge(s, 'POST', '/admin/sso/register-saml', {
      providerId: 'globex-saml',
      issuer: 'https://saml.globex.example/entity',
      domain: 'globex.example',
      entryPoint: 'https://saml.globex.example/sso',
      cert: certificate(),
    });
    expect(parent.status, await parent.clone().text()).toBe(200);
  }, 30_000);

  it('a domain edit onto a served domain is refused; re-saving the provider own domain is not', async () => {
    const s = await stage();
    await storeProvider(s, { providerId: PROVIDER, domain: 'acme.example' });
    await storeProvider(s, { providerId: OTHER, domain: 'globex.example' });
    const onto = await postJson(s, '/sso/update-provider', { providerId: OTHER, domain: 'acme.example' });
    const body = (await onto.json()) as any;
    expect(onto.status, JSON.stringify(body)).toBe(409);
    expect(body).toMatchObject({ code: 'RESOURCE_CONFLICT', field: 'domain', heldBy: PROVIDER });
    expect((await rows(s, 'sys_sso_provider', { provider_id: OTHER }))[0].domain).toBe('globex.example');

    const own = await postJson(s, '/sso/update-provider', { providerId: OTHER, domain: 'globex.example, globex.io' });
    expect(own.status, await own.clone().text()).toBe(200);
  }, 30_000);

  it('a caller who is not a platform administrator is told the domain is served, not by which provider', async () => {
    const s = await stage();
    await storeProvider(s, { providerId: PROVIDER, domain: 'acme.example' });
    const memberCookie = await s.signUp('owner@globex.example');
    await storeProvider(s, { providerId: OTHER, domain: 'globex.example', userId: await s.userIdOf('owner@globex.example') });
    const res = await postJson(s, '/sso/update-provider', { providerId: OTHER, domain: 'acme.example' }, memberCookie);
    const body = (await res.json()) as any;
    expect(res.status, JSON.stringify(body)).toBe(409);
    expect(body).toMatchObject({ code: 'RESOURCE_CONFLICT', field: 'domain' });
    expect(body.heldBy).toBeUndefined();
    expect(body.message).toContain('another SSO provider');
    expect(body.message).not.toContain(PROVIDER);
  }, 30_000);
});

// ── 3. The edit door ────────────────────────────────────────────────────────

/** DER, by hand: just enough of X.509 for a self-signed RSA certificate (the `sso-saml-refusal-landing.test.ts` builder). */
function der(tag: number, content: Buffer): Buffer {
  const n = content.length;
  const len = n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]);
  return Buffer.concat([Buffer.from([tag]), len, content]);
}
const seq = (...parts: Buffer[]) => der(0x30, Buffer.concat(parts));

function selfSignedCertificate(privateKey: KeyObject, publicKey: KeyObject, cn: string): string {
  const sha256WithRsa = seq(der(0x06, Buffer.from('2a864886f70d01010b', 'hex')), Buffer.from([0x05, 0x00]));
  const name = seq(der(0x31, seq(der(0x06, Buffer.from('550403', 'hex')), der(0x0c, Buffer.from(cn)))));
  const validity = seq(der(0x17, Buffer.from('200101000000Z')), der(0x17, Buffer.from('491231235959Z')));
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([0x02]))),
    der(0x02, Buffer.from([0x01, 0x23, 0x45])),
    sha256WithRsa,
    name,
    validity,
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
  );
  const signature = sign('sha256', tbs, privateKey);
  const cert = seq(tbs, sha256WithRsa, der(0x03, Buffer.concat([Buffer.from([0x00]), signature])));
  new X509Certificate(cert);
  return cert.toString('base64');
}

const certs: string[] = [];
beforeAll(() => {
  for (const cn of ['idp-current', 'idp-next', 'idp-after']) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    certs.push(selfSignedCertificate(privateKey, publicKey, cn));
  }
});
const certificate = (i = 0) => certs[i]!;

describe('a registered provider is edited in place, without unlinking anyone', () => {
  const SAML = 'acme-saml';
  const ENTITY = 'https://saml.acme.example/entity';

  async function samlStage(opts: { linked: boolean }) {
    const s = await stage();
    await storeProvider(s, {
      providerId: SAML,
      domain: 'acme.example',
      issuer: ENTITY,
      samlConfig: {
        issuer: ENTITY,
        entryPoint: 'https://saml.acme.example/sso',
        cert: certificate(0),
        callbackUrl: `${AUTH}/sso/saml2/sp/acs/${SAML}`,
        idpMetadata: { entityID: ENTITY },
        spMetadata: { entityID: `${AUTH}/sso/saml2/sp/metadata?providerId=${SAML}` },
      },
    });
    if (opts.linked) {
      const mia = await ssoOnlyUser(s, 'mia@acme.example');
      await link(s, mia, SAML, 'saml-nameid-mia');
    }
    const stored = async () => {
      const read = createEngineSsoProviderConfigReader(() => s.engine as never);
      const configs = await read(SAML);
      return { issuer: configs?.issuer, saml: JSON.parse(String(configs?.samlConfig)) as Record<string, any> };
    };
    const edit = (body: Record<string, unknown>) => bridge(s, 'POST', '/admin/sso/update-provider', { providerId: SAML, ...body });
    return { s, stored, edit };
  }

  it('a SAML signing certificate rotates while users are linked; the answer names the field, not the value', async () => {
    const { s, stored, edit } = await samlStage({ linked: true });
    const res = await edit({ cert: certificate(1), issuer: ENTITY, keepCurrentCert: false });
    const text = await res.clone().text();
    expect(res.status, text).toBe(200);
    expect(JSON.parse(text)).toEqual({
      success: true,
      data: { providerId: SAML, protocol: 'saml', updated: ['cert'], message: `SSO provider "${SAML}" updated: cert.` },
    });
    expect(text).not.toContain(certificate(1).slice(0, 40));
    expect((await stored()).saml.cert).toBe(certificate(1));
    // Nobody was unlinked.
    expect(await rows(s, 'sys_account', { provider_id: SAML })).toHaveLength(1);
  }, 30_000);

  it('keepCurrentCert trusts both certificates while the IdP switches over; a later edit without it drops the old one', async () => {
    const { stored, edit } = await samlStage({ linked: true });
    const overlap = await edit({ cert: certificate(1), keepCurrentCert: true });
    expect(overlap.status, await overlap.clone().text()).toBe(200);
    expect((await stored()).saml.cert).toEqual([certificate(0), certificate(1)]);

    const settle = await edit({ cert: certificate(1) });
    expect(settle.status, await settle.clone().text()).toBe(200);
    expect((await stored()).saml.cert).toBe(certificate(1));
  }, 30_000);

  it('the SSO URL, part of the provider identity, is refused while users are linked, with that reason; nothing changes', async () => {
    const { stored, edit } = await samlStage({ linked: true });
    const res = await edit({ entryPoint: 'https://saml.acme.example/sso-v2' });
    const body = (await res.json()) as any;
    expect(res.status, JSON.stringify(body)).toBe(409);
    expect(body.error.code).toBe('RESOURCE_CONFLICT');
    expect(body.error.message).toContain('only while no user is linked');
    expect((await stored()).saml.entryPoint).toBe('https://saml.acme.example/sso');
  }, 30_000);

  it('with no user linked, the entity ID and SSO URL change, on the row and in the IdP descriptor', async () => {
    const { stored, edit } = await samlStage({ linked: false });
    const next = 'https://saml.acme.example/entity-v2';
    const res = await edit({ issuer: next, entryPoint: 'https://saml.acme.example/sso-v2' });
    const body = (await res.json()) as any;
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.updated).toEqual(['issuer', 'entryPoint']);
    const after = await stored();
    expect(after.issuer).toBe(next);
    expect(after.saml.idpMetadata.entityID).toBe(next);
    expect(after.saml.entryPoint).toBe('https://saml.acme.example/sso-v2');
    expect(after.saml.cert).toBe(certificate(0));
  }, 30_000);

  it('a certificate that is not X.509, an OIDC field, and an empty edit are refused 400 before anything is written', async () => {
    const { stored, edit } = await samlStage({ linked: true });
    const bad = await edit({ cert: 'not-a-certificate' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error.field).toBe('cert');

    const oidc = await edit({ clientSecret: 'oops' });
    const oidcBody = (await oidc.json()) as any;
    expect(oidc.status).toBe(400);
    expect(oidcBody.error).toMatchObject({ code: 'INVALID_REQUEST', field: 'clientSecret' });
    expect(oidcBody.error.message).toContain('Use "Edit SAML Settings"');

    const empty = await edit({ issuer: ENTITY });
    expect(empty.status).toBe(400);
    expect((await stored()).saml.cert).toBe(certificate(0));
  }, 30_000);

  it('an OIDC client secret is replaced while users are linked and is never answered; scopes are replaced', async () => {
    const s = await stage();
    const OIDC = 'acme-oidc';
    await storeProvider(s, {
      providerId: OIDC,
      domain: 'acme.example',
      oidcConfig: {
        issuer: `https://${OIDC}.idp.example`,
        clientId: 'acme-client',
        clientSecret: 'old-client-secret-32085',
        authorizationEndpoint: `https://${OIDC}.idp.example/authorize`,
        tokenEndpoint: `https://${OIDC}.idp.example/token`,
        jwksEndpoint: `https://${OIDC}.idp.example/jwks`,
        pkce: true,
        scopes: ['openid', 'email'],
      },
    });
    const mia = await ssoOnlyUser(s, 'mia@acme.example');
    await link(s, mia, OIDC, 'oidc-sub-mia');

    const res = await bridge(s, 'POST', '/admin/sso/update-provider', {
      providerId: OIDC,
      clientId: '',
      clientSecret: 'new-client-secret-32085',
      scopes: 'openid email profile groups',
    });
    const text = await res.clone().text();
    expect(res.status, text).toBe(200);
    expect(JSON.parse(text).data).toEqual({
      providerId: OIDC,
      protocol: 'oidc',
      updated: ['clientSecret', 'scopes'],
      message: `SSO provider "${OIDC}" updated: clientSecret, scopes.`,
    });
    expect(text).not.toContain('new-client-secret-32085');
    expect(text).not.toContain('old-client-secret-32085');

    // What sign-in reads back: the new secret, the new scopes, the client ID kept.
    const auth: any = await s.manager.getAuthInstance();
    const ctx = await auth.$context;
    const provider = await ctx.adapter.findOne({ model: 'ssoProvider', where: [{ field: 'providerId', value: OIDC }] });
    const oidc = JSON.parse(provider.oidcConfig);
    expect(oidc).toMatchObject({ clientId: 'acme-client', clientSecret: 'new-client-secret-32085', scopes: ['openid', 'email', 'profile', 'groups'] });
    expect(await rows(s, 'sys_account', { provider_id: OIDC })).toHaveLength(1);

    // The client ID is the provider identity: refused while Mia is linked.
    const identity = await bridge(s, 'POST', '/admin/sso/update-provider', { providerId: OIDC, clientId: 'another-client' });
    expect(identity.status, await identity.clone().text()).toBe(409);
    // A SAML field on an OIDC provider names the right action.
    const saml = await bridge(s, 'POST', '/admin/sso/update-provider', { providerId: OIDC, entryPoint: 'https://x.example/sso' });
    expect(saml.status).toBe(400);
    expect(((await saml.json()) as any).error.message).toContain('Use "Edit OIDC Settings"');
  }, 30_000);

  it('the two edit actions post the fields the bridge reads, and neither reads a secret back into its form', () => {
    const actions = (SysSsoProvider as any).actions as Array<Record<string, any>>;
    const saml = actions.find((a) => a.name === 'edit_saml_provider')!;
    const oidc = actions.find((a) => a.name === 'edit_oidc_provider')!;
    for (const action of [saml, oidc]) {
      expect(action.target).toBe('/api/v1/auth/admin/sso/update-provider');
      expect(action.visible).toMatchObject({ source: 'current_user.isPlatformAdmin == true' });
    }
    expect(saml.params.map((p: any) => p.name)).toEqual(['providerId', 'issuer', 'entryPoint', 'cert', 'keepCurrentCert']);
    expect(oidc.params.map((p: any) => p.name)).toEqual(['providerId', 'clientId', 'clientSecret', 'scopes']);
    const secret = oidc.params.find((p: any) => p.name === 'clientSecret');
    expect(secret.type).toBe('password');
    expect(secret.defaultFromRow).toBeUndefined();

    const del = actions.find((a) => a.name === 'delete_sso_provider')!;
    expect(del.preflight.read.url).toBe('/api/v1/auth/admin/sso/delete-impact?providerId=${ctx.record.provider_id}');
    expect(del.preflight.fields.map((f: any) => f.path)).toEqual(['summary', 'linkedUsers', 'usersWithoutOtherSignIn']);
  });
});
