// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32148] SCIM adopts an account that SSO JIT already created — only when
 * the three ruled conditions hold — end to end, through `@better-auth/scim`.
 *
 * ## The defect
 *
 * "Turn on SSO first, add SCIM later" is the usual rollout. A user who signed
 * in through the organization's SSO provider before SCIM was turned on has an
 * account the directory then cannot reach: Entra ID and Okta look the user up
 * (`GET /Users?filter=userName eq "…"` answers 0 — SCIM sees only its own
 * resources) and then create it, and the create answered 409 "A Better Auth
 * User already uses this email". The IdP marks the user failed, so a later
 * deactivation never reaches that account.
 *
 * ## The rule this pins (ruling A, triage 6810486663)
 *
 * The create links the existing account to the connection when — and only
 * when — every part of `judgeScimSsoAdoption` (`scim-sso-adoption.ts`) holds:
 * the account is directory-managed (`idp_provisioned`, no local password), no
 * SCIM directory holds it yet, it is linked to an SSO provider of the
 * connection's organization, and its email domain is that provider's verified
 * domain. Anything else answers 409 as before, in words that no longer name
 * the vendor. ⛔ A bare email match is never a link.
 *
 * ## Why every case drives the vendor
 *
 * The seam is the vendor's `identity.resolveUser` host callback, and what it
 * returns is only half the behaviour: the vendor's transaction, its profile
 * claim and its uniqueness checks decide the answer the IdP reads. So every
 * case goes through `AuthManager.handleRequest()` with a real SCIM bearer, on
 * a real `ObjectQL` over better-sqlite3, and each refusal is a single-cause
 * fixture: the adopt fixture with exactly one fact changed.
 */

import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { createTenancyService } from './tenancy-service.js';
import { mintScimConnectionCredential } from './scim-connection-service.js';
import { registerLastAdminGuard, type LastAdminGuardEngine } from './last-admin-guard.js';
import { registerIdentityWriteGuard, registerManagedUpdateWhitelist } from './identity-write-guard.js';
import { SYS_USER_PROFILE_EDIT_FIELDS } from './sys-user-writable-fields.js';
import { SCIM_DEACTIVATION_BAN_REASON } from './user-ban-write.js';
import {
  judgeScimSsoAdoption,
  type ScimSsoAdoptionRefusal,
} from './scim-sso-adoption.js';
import { SCIM_CONFLICT_DETAIL_TRANSLATIONS, translateScimConflictDetail } from './scim-conflict-detail.js';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';
import { sqliteEnginePool, type BootedSqliteEngine } from './__tests__/sqlite-engine-pool.testkit.js';
// Clocked windows measure behaviour, never loading (AGENTS.md, Build & Test):
// the vendor modules `AuthManager` reaches through a lazy `await import()` are
// paid here, at module load, not inside the first case.
import 'better-auth';
import 'better-auth/api';
import 'better-auth/db';
import 'better-auth/plugins';
import 'better-auth/plugins/admin';
import 'better-auth/plugins/bearer';
import 'better-auth/plugins/organization';
import 'better-auth/plugins/organization/access';
import '@better-auth/core/context';
import '@better-auth/core/error';
import '@better-auth/oauth-provider';
import '@better-auth/scim';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-32148';

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';

const SYSTEM = { context: { isSystem: true } } as const;

/** The organization the SCIM connection and (in the adopt fixture) the SSO provider belong to. */
const ORG = 'org_acme_32148';
const OTHER_ORG = 'org_other_32148';
const CONNECTION = 'entra-32148';
const OTHER_CONNECTION = 'okta-32148';
const PROVIDER = 'acme-entra';
const DOMAIN = 'acme.com';

/** The platform's 409 wording — the vendor's name is gone (the card's own words). */
const EMAIL_CONFLICT_DETAIL = 'An account with this email already exists';

const DEFAULT_ORG = 'org_default';

const sysPermissionSet = {
  name: 'sys_permission_set',
  label: 'Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    label: { name: 'label', type: 'text' as const },
    active: { name: 'active', type: 'boolean' as const },
  },
};

const sysUserPermissionSet = {
  name: 'sys_user_permission_set',
  label: 'User Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    user_id: { name: 'user_id', type: 'text' as const },
    permission_set_id: { name: 'permission_set_id', type: 'text' as const },
    permission_set: { name: 'permission_set', type: 'text' as const },
    organization_id: { name: 'organization_id', type: 'text' as const },
    valid_from: { name: 'valid_from', type: 'datetime' as const },
    valid_until: { name: 'valid_until', type: 'datetime' as const },
  },
};

/**
 * The engine a SCIM deployment's identity objects live on, with the two write
 * guards `auth-plugin.ts` registers at `kernel:ready` — the adoption link
 * rewrites the account's profile, and the deactivation that follows is a ban
 * write, so both run against the production guards.
 */
async function bootEngine(): Promise<BootedSqliteEngine> {
  const engine = new ObjectQL();
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  engine.registerDriver(driver, true);
  await engine.init();
  for (const object of authIdentityObjects) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  for (const object of [sysPermissionSet, sysUserPermissionSet]) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();
  await engine.insert('sys_organization', { id: DEFAULT_ORG, name: 'Default Organization', slug: 'default' }, SYSTEM);
  bindTestSecurityCatalog(engine, { permissions: [{ name: ADMIN_FULL_ACCESS }] });
  registerManagedUpdateWhitelist('sys_user', SYS_USER_PROFILE_EDIT_FIELDS);
  registerIdentityWriteGuard(engine, { packageId: 'test.identity-write-guard' });
  registerLastAdminGuard(engine as unknown as LastAdminGuardEngine, { packageId: 'test.last-admin-guard' });
  return { engine, driver };
}

const enginePool = sqliteEnginePool(bootEngine, { keepBootOrganizations: true });
afterEach(enginePool.release);
afterAll(enginePool.destroy);

interface Harness {
  engine: ObjectQL;
  manager: AuthManager;
  /** The bearer of the connection under test, owned by {@link ORG}. */
  token: string;
  /** A second connection of the same organization — an earlier directory. */
  otherToken: string;
  send: (request: Request) => Promise<Response>;
}

async function boot(): Promise<Harness> {
  const engine = await enginePool.take();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as never,
    getTenancy: () => createTenancyService({ requested: 'isolated', probeIsolation: () => true }),
    plugins: { scim: true, organization: true },
  } as never);
  const { token } = await mintScimConnectionCredential(engine as never, SECRET, {
    connectionId: CONNECTION,
    organizationId: ORG,
  });
  const { token: otherToken } = await mintScimConnectionCredential(engine as never, SECRET, {
    connectionId: OTHER_CONNECTION,
    organizationId: ORG,
  });
  return { engine, manager, token, otherToken, send: (request) => manager.handleRequest(request) };
}

// ---------------------------------------------------------------------------
// Fixtures — the adopt fixture, and one fact changed per refusal
// ---------------------------------------------------------------------------

interface SsoAccountFacts {
  /** The account's email; its domain is what condition 3 reads. */
  email: string;
  /** `sys_user.source` after the link is written (the stamp writes `idp_provisioned`). */
  source: 'idp_provisioned' | 'env_native';
  /** The account also holds a local password. */
  localPassword: boolean;
  /** The provider the account is linked through — `null` for an account with no SSO link at all. */
  linkedProvider: string | null;
  provider: {
    providerId: string;
    domain: string;
    domainVerified: boolean;
    organizationId: string | null;
  };
}

function adoptFacts(localPart: string, change: Partial<SsoAccountFacts> = {}): SsoAccountFacts {
  return {
    email: `${localPart}@${DOMAIN}`,
    source: 'idp_provisioned',
    localPassword: false,
    linkedProvider: PROVIDER,
    provider: { providerId: PROVIDER, domain: DOMAIN, domainVerified: true, organizationId: ORG },
    ...change,
  };
}

/**
 * The account SSO JIT leaves behind: the `sys_user` row, and a `sys_account`
 * row naming the provider it signed in through — the two rows
 * `@better-auth/sso` writes on a first sign-in, with `source` as the
 * platform's identity-source stamp leaves it (`idp_provisioned` for a
 * federated link). Written as rows: a sign-in cannot be driven without an
 * identity provider, and what the rule reads is exactly these rows. Each
 * refusal fixture changes one of them.
 */
async function seedSsoAccount(h: Harness, facts: SsoAccountFacts): Promise<string> {
  await h.engine.insert(
    'sys_sso_provider',
    {
      id: `ssop_${facts.provider.providerId}`,
      provider_id: facts.provider.providerId,
      issuer: `https://idp.example/${facts.provider.providerId}`,
      domain: facts.provider.domain,
      domain_verified: facts.provider.domainVerified,
      ...(facts.provider.organizationId ? { organization_id: facts.provider.organizationId } : {}),
    },
    SYSTEM,
  );
  const userId = `usr_${facts.email.split('@')[0].replace(/[^a-z0-9]/gi, '_')}`;
  await h.engine.insert(
    'sys_user',
    { id: userId, email: facts.email, name: 'Sso Jit', email_verified: true, source: facts.source },
    SYSTEM,
  );
  if (facts.linkedProvider) await linkAccount(h, userId, facts.linkedProvider);
  if (facts.localPassword) await linkAccount(h, userId, 'credential');
  return userId;
}

/** A `sys_account` row: `credential` is a local password, anything else a federated link. */
async function linkAccount(h: Harness, userId: string, providerId: string): Promise<void> {
  await h.engine.insert(
    'sys_account',
    {
      id: `acc_${providerId}_${userId}`,
      user_id: userId,
      provider_id: providerId,
      account_id: providerId === 'credential' ? userId : `sub-${userId}`,
      ...(providerId === 'credential' ? { password: 'not-a-real-hash-32148' } : {}),
    },
    SYSTEM,
  );
}

// ---------------------------------------------------------------------------
// SCIM — the request shapes Entra ID and Okta send
// ---------------------------------------------------------------------------

function scimRequest(token: string, method: string, path: string, body?: unknown): Request {
  return new Request(`${AUTH}/scim/v2${path}`, {
    method,
    headers: {
      origin: BASE,
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/scim+json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/** Entra ID's create: the UPN as `userName`, the work email primary, an `externalId`. */
function createBody(email: string, externalId = `ext-${email}`) {
  return {
    schemas: [USER_SCHEMA],
    userName: email,
    externalId,
    name: { givenName: 'Sso', familyName: 'Jit' },
    displayName: 'Sso Jit',
    emails: [{ value: email, type: 'work', primary: true }],
    active: true,
  };
}

async function lookup(h: Harness, token: string, email: string): Promise<{ totalResults: number; ids: string[] }> {
  const filter = encodeURIComponent(`userName eq "${email}"`);
  const res = await h.send(scimRequest(token, 'GET', `/Users?filter=${filter}`));
  expect(res.status, `SCIM lookup failed: ${await res.clone().text()}`).toBe(200);
  const body = (await res.json()) as { schemas: string[]; totalResults: number; Resources?: Array<{ id: string }> };
  expect(body.schemas).toEqual([LIST_SCHEMA]);
  return { totalResults: body.totalResults, ids: (body.Resources ?? []).map((r) => r.id) };
}

async function usersWithEmail(h: Harness, email: string): Promise<Array<{ id: string }>> {
  return (await h.engine.find('sys_user', { where: { email }, fields: ['id'] }, SYSTEM)) as Array<{ id: string }>;
}

async function scimUsersOf(h: Harness, userId: string): Promise<Array<{ connection_id: string }>> {
  return (await h.engine.find(
    'sys_scim_user',
    { where: { user_id: userId }, fields: ['connection_id'] },
    SYSTEM,
  )) as Array<{ connection_id: string }>;
}

/**
 * The refusal the IdP reads: 409, SCIM `uniqueness`, the platform's wording
 * with no vendor name — and nothing written: no second user, no SCIM link.
 */
async function expectRefused(h: Harness, userId: string, email: string, res: Response): Promise<void> {
  const text = await res.text();
  expect(res.status, `expected the 409 refusal, got ${res.status} ${text}`).toBe(409);
  const body = JSON.parse(text) as { scimType?: string; detail?: string; status?: string };
  expect(body.status).toBe('409');
  expect(body.scimType).toBe('uniqueness');
  expect(body.detail).toBe(EMAIL_CONFLICT_DETAIL);
  expect(text).not.toMatch(/better.?auth/i);
  expect((await usersWithEmail(h, email)).map((u) => u.id)).toEqual([userId]);
  expect((await scimUsersOf(h, userId)).filter((s) => s.connection_id === CONNECTION)).toEqual([]);
}

// ---------------------------------------------------------------------------
// The adopt case — lookup, create, lookup, deactivate
// ---------------------------------------------------------------------------

describe('[#32148] SCIM adopts the account SSO JIT created when all three conditions hold', () => {
  it('links it on create: the lookup and the create succeed, no second user exists, a deactivation reaches it', async () => {
    const h = await boot();
    const facts = adoptFacts('adopt');
    const userId = await seedSsoAccount(h, facts);

    // Entra's cycle: the lookup finds nothing (the account is not a SCIM resource yet) …
    expect(await lookup(h, h.token, facts.email)).toEqual({ totalResults: 0, ids: [] });

    // … so it creates, and the create LINKS the existing account.
    const created = await h.send(scimRequest(h.token, 'POST', '/Users', createBody(facts.email)));
    expect(created.status, `adoption create failed: ${await created.clone().text()}`).toBe(201);
    const resource = (await created.json()) as { id: string; userName: string; active: boolean };
    expect(resource.userName).toBe(facts.email);
    expect(resource.active).toBe(true);
    expect((await usersWithEmail(h, facts.email)).map((u) => u.id)).toEqual([userId]);
    expect(await scimUsersOf(h, userId)).toEqual([{ connection_id: CONNECTION }]);

    // The next lookup finds it under the new SCIM id.
    expect(await lookup(h, h.token, facts.email)).toEqual({ totalResults: 1, ids: [resource.id] });

    // The leaver lifecycle now reaches the account.
    const deactivated = await h.send(
      scimRequest(h.token, 'PATCH', `/Users/${resource.id}`, {
        schemas: [PATCH_SCHEMA],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      }),
    );
    expect(deactivated.status, `deactivation failed: ${await deactivated.clone().text()}`).toBe(200);
    const after = (await h.engine.findOne(
      'sys_user',
      { where: { id: userId }, fields: ['banned', 'ban_reason', 'source'] },
      SYSTEM,
    )) as { banned?: unknown; ban_reason?: unknown; source?: unknown };
    expect(after.banned === true || after.banned === 1).toBe(true);
    expect(after.ban_reason).toBe(SCIM_DEACTIVATION_BAN_REASON);
    expect(after.source).toBe('idp_provisioned');
  });

  it('matches the stored address when the directory sends it in another case', async () => {
    const h = await boot();
    const facts = adoptFacts('mixed.case');
    const userId = await seedSsoAccount(h, facts);
    const created = await h.send(scimRequest(h.token, 'POST', '/Users', createBody('Mixed.Case@ACME.com')));
    expect(created.status, `adoption create failed: ${await created.clone().text()}`).toBe(201);
    expect(await scimUsersOf(h, userId)).toEqual([{ connection_id: CONNECTION }]);
  });
});

// ---------------------------------------------------------------------------
// The refusals — each the adopt fixture with ONE fact changed; all 409
// ---------------------------------------------------------------------------

describe('[#32148] SCIM still refuses with 409 when any condition fails', () => {
  const cases: Array<{ name: string; reason: ScimSsoAdoptionRefusal; facts: (local: string) => SsoAccountFacts }> = [
    {
      name: 'the provider has not verified its domain',
      reason: 'domain_not_verified',
      facts: (l) => adoptFacts(l, { provider: { ...adoptFacts(l).provider, domainVerified: false } }),
    },
    {
      name: "the account's email domain is not the provider's domain",
      reason: 'email_domain_not_verified',
      facts: (l) => adoptFacts(l, { email: `${l}@elsewhere.example` }),
    },
    {
      name: "the account's email is on a subdomain of the provider's domain (exact match only)",
      reason: 'email_domain_not_verified',
      facts: (l) => adoptFacts(l, { email: `${l}@eu.${DOMAIN}` }),
    },
    {
      name: 'the account is not idp_provisioned',
      reason: 'not_directory_managed',
      facts: (l) => adoptFacts(l, { source: 'env_native' }),
    },
    {
      name: 'the account holds a local password',
      reason: 'holds_local_password',
      // The platform's stamp would also flip `source` to `env_native`, which
      // refuses on its own; `idp_provisioned` is kept so the password is the
      // one cause (the state a lost stamp leaves).
      facts: (l) => adoptFacts(l, { localPassword: true }),
    },
    {
      name: 'the provider belongs to another organization',
      reason: 'no_provider_of_organization',
      facts: (l) => adoptFacts(l, { provider: { ...adoptFacts(l).provider, organizationId: OTHER_ORG } }),
    },
    {
      name: 'the provider names no organization while the connection does',
      reason: 'no_provider_of_organization',
      facts: (l) => adoptFacts(l, { provider: { ...adoptFacts(l).provider, organizationId: null } }),
    },
    {
      name: '⛔ a bare email match: the account has no SSO link at all',
      reason: 'no_sso_link',
      facts: (l) => adoptFacts(l, { linkedProvider: null }),
    },
    {
      name: '⛔ a bare email match: the account is linked to something that is not an SSO provider',
      reason: 'no_sso_link',
      facts: (l) => adoptFacts(l, { linkedProvider: 'google' }),
    },
  ];

  for (const [i, c] of cases.entries()) {
    it(`409 — ${c.name}`, async () => {
      const h = await boot();
      const facts = c.facts(`refuse${i}`);
      const userId = await seedSsoAccount(h, facts);
      await expectRefused(h, userId, facts.email, await h.send(scimRequest(h.token, 'POST', '/Users', createBody(facts.email))));
      // The judge names THIS fixture's one cause — the 409 above is not some other condition's.
      const verdict = await judgeScimSsoAdoption(h.engine as never, { email: facts.email, organizationId: ORG });
      expect(verdict).toEqual({ adopt: false, reason: c.reason });
    });
  }

  it('409 — the account is already held by another SCIM directory (never a second link)', async () => {
    const h = await boot();
    const facts = adoptFacts('held');
    // An earlier directory of the same organization provisioned the user …
    const first = await h.send(scimRequest(h.otherToken, 'POST', '/Users', createBody(facts.email, 'ext-first')));
    expect(first.status, `first directory's create failed: ${await first.clone().text()}`).toBe(201);
    const [user] = await usersWithEmail(h, facts.email);
    // … and the person later signed in through the organization's SSO provider.
    await h.engine.insert(
      'sys_sso_provider',
      { id: 'ssop_held', provider_id: PROVIDER, issuer: 'https://idp.example/held', domain: DOMAIN, domain_verified: true, organization_id: ORG },
      SYSTEM,
    );
    await linkAccount(h, user.id, PROVIDER);
    await expectRefused(h, user.id, facts.email, await h.send(scimRequest(h.token, 'POST', '/Users', createBody(facts.email))));
    expect(await scimUsersOf(h, user.id)).toEqual([{ connection_id: OTHER_CONNECTION }]);
    const verdict = await judgeScimSsoAdoption(h.engine as never, { email: facts.email, organizationId: ORG });
    expect(verdict).toEqual({ adopt: false, reason: 'held_by_scim' });
  });

  it('409 — the account a directory deleted stays that directory\'s (a second one cannot revive the leaver)', async () => {
    const h = await boot();
    const facts = adoptFacts('leaver');
    const first = await h.send(scimRequest(h.otherToken, 'POST', '/Users', createBody(facts.email, 'ext-leaver')));
    expect(first.status, `first directory's create failed: ${await first.clone().text()}`).toBe(201);
    const { id: firstId } = (await first.json()) as { id: string };
    const deleted = await h.send(scimRequest(h.otherToken, 'DELETE', `/Users/${firstId}`));
    expect(deleted.status, `first directory's delete failed: ${await deleted.clone().text()}`).toBe(204);
    const [user] = await usersWithEmail(h, facts.email);
    await h.engine.insert(
      'sys_sso_provider',
      { id: 'ssop_leaver', provider_id: PROVIDER, issuer: 'https://idp.example/leaver', domain: DOMAIN, domain_verified: true, organization_id: ORG },
      SYSTEM,
    );
    await linkAccount(h, user.id, PROVIDER);
    // The deleted source no longer manages the profile, so nothing in the
    // vendor's transaction would refuse a second link: the subject is the guard.
    await expectRefused(h, user.id, facts.email, await h.send(scimRequest(h.token, 'POST', '/Users', createBody(facts.email))));
    const after = (await h.engine.findOne('sys_user', { where: { id: user.id }, fields: ['banned'] }, SYSTEM)) as {
      banned?: unknown;
    };
    expect(after.banned === true || after.banned === 1).toBe(true);
    expect(await judgeScimSsoAdoption(h.engine as never, { email: facts.email, organizationId: ORG })).toEqual({
      adopt: false,
      reason: 'held_by_scim',
    });
  });

  it('a create for an address no account holds still creates (the rule only ever links or refuses)', async () => {
    const h = await boot();
    const created = await h.send(scimRequest(h.token, 'POST', '/Users', createBody(`fresh@${DOMAIN}`)));
    expect(created.status, `create failed: ${await created.clone().text()}`).toBe(201);
    expect(await usersWithEmail(h, `fresh@${DOMAIN}`)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The 409 wording — no vendor name on any SCIM conflict the vendor words
// ---------------------------------------------------------------------------

describe('[#32148] the SCIM conflict detail never names the vendor', () => {
  it('an email change onto an address another account holds reads the platform wording', async () => {
    const h = await boot();
    const facts = adoptFacts('taken');
    await seedSsoAccount(h, { ...facts, linkedProvider: null });
    const created = await h.send(scimRequest(h.token, 'POST', '/Users', createBody(`mover@${DOMAIN}`)));
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const res = await h.send(
      scimRequest(h.token, 'PATCH', `/Users/${id}`, {
        schemas: [PATCH_SCHEMA],
        Operations: [{ op: 'replace', path: 'emails', value: [{ value: facts.email, type: 'work', primary: true }] }],
      }),
    );
    const text = await res.text();
    expect(res.status, text).toBe(409);
    expect(JSON.parse(text)).toMatchObject({ status: '409', scimType: 'uniqueness', detail: EMAIL_CONFLICT_DETAIL });
    expect(text).not.toMatch(/better.?auth/i);
  });

  it('every vendor detail it translates leaves with no vendor name, and the response keeps its status and media type', async () => {
    for (const [vendor, platform] of Object.entries(SCIM_CONFLICT_DETAIL_TRANSLATIONS)) {
      expect(vendor).toMatch(/Better Auth/);
      expect(platform).not.toMatch(/better.?auth/i);
      const original = new Response(
        JSON.stringify({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: '409', detail: vendor, scimType: 'uniqueness' }),
        { status: 409, headers: { 'content-type': 'application/scim+json', 'x-kept': 'yes' } },
      );
      const translated = await translateScimConflictDetail(original);
      expect(translated.status).toBe(409);
      expect(translated.headers.get('content-type')).toBe('application/scim+json');
      expect(translated.headers.get('x-kept')).toBe('yes');
      expect(await translated.json()).toEqual({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '409',
        detail: platform,
        scimType: 'uniqueness',
      });
    }
  });

  it('leaves every other answer byte-for-byte alone', async () => {
    const other409 = new Response(JSON.stringify({ status: '409', detail: 'SCIM User userName already exists' }), { status: 409 });
    expect(await translateScimConflictDetail(other409)).toBe(other409);
    const created = new Response('{"id":"x"}', { status: 201 });
    expect(await translateScimConflictDetail(created)).toBe(created);
    const notJson = new Response('A Better Auth User already uses this email', { status: 409 });
    expect(await (await translateScimConflictDetail(notJson)).text()).toBe('A Better Auth User already uses this email');
  });
});
