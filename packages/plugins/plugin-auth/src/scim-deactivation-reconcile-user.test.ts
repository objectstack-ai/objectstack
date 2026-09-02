// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14360] SCIM `active: false` disables the account again — end to end,
 * through `@better-auth/scim` itself.
 *
 * ## The defect
 *
 * `@better-auth/scim` 1.6.x mapped a SCIM `active: false` onto the admin
 * plugin's `banned` column. 1.7.0 removed that write (the substring `ban`
 * occurs zero times in the installed 1.7.2 package) and replaced it with an
 * OPTIONAL host callback, `identity.reconcileUser`, followed by the vendor's
 * own `deleteUserSessions`. `plugin-auth` passed no `identity` member, so an
 * identity provider deactivating a user revoked sessions and wrote nothing:
 * `sys_user.banned` stayed false, and a user holding a local password signed
 * straight back in. `auth-manager.ts` now passes the callback and routes it
 * to the platform's own ban write (`admin-ban-endpoints.ts`).
 *
 * ## Why every case drives the vendor and none simulates the write
 *
 * `last-admin-guard.test.ts`'s `deprovision()` helper writes `banned: true`
 * through the adapter in the vendor's NAME — and it stayed green across the
 * very release that stopped the vendor writing it (triage on #14360: ⛔ do not
 * extend it). So every case below goes through `AuthManager.handleRequest()`
 * with a real SCIM bearer: the `scim({ identity: { reconcileUser } })` wiring
 * in `auth-manager.ts` is inside the system under test, and so are the
 * vendor's transaction, its session revocation and its error mapping.
 *
 * ## Backend
 *
 * A real `ObjectQL` over `@objectstack/driver-sql` + better-sqlite3
 * `:memory:` — the backend `credential-at-rest-posture.test.ts` already boots
 * SCIM on. The break-glass last-administrator guard (ADR-0024 D5.2) and the
 * ADR-0092 identity write guard are registered on the engine the way
 * `auth-plugin.ts` registers them at `kernel:ready`, so the refusal in (c) is
 * the production hook, not a stand-in.
 *
 * ## Faces
 *
 *  (a) `active: false` ⇒ `sys_user.banned`, sessions revoked, sign-in refused
 *      with the vendor's `BANNED_USER` (status AND code, never a bare throw).
 *  (b) `active: true` ⇒ unbanned, sign-in accepted again.
 *  (c) the last administrator: refused THROUGH SCIM as a 403 SCIM error, the
 *      account stays active — plus the positive control (a second
 *      administrator makes the same request succeed) that proves the guard
 *      was the thing refusing.
 *  (d) negative controls: a PATCH that does not change `active` touches no
 *      ban column and revokes nothing; an administrator's ban survives an
 *      IdP attribute sync and an explicit `active: true`.
 *  (e) a host that declines the admin plugin beside SCIM is still refused at
 *      construction (#13816 — unchanged by this card).
 *  (f) `DELETE /Users/{id}` leaves the tombstoned account disabled (the
 *      vendor no longer deletes the better-auth user on 1.7.2).
 *  (g) `POST /Users` with `active: false` provisions the account disabled.
 *      And, under (d): a deactivation makes an administrator's EXPIRING ban
 *      permanent, so the vendor's auto-lift cannot re-admit a deactivated
 *      principal.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import {
  SysUser,
  SysSession,
  SysAccount,
  SysVerification,
  SysOrganization,
  SysMember,
  SysInvitation,
  SysTeam,
  SysTeamMember,
  SysScimConnectionBinding,
  SysScimConnectionCredential,
  SysScimGroup,
  SysScimGroupMember,
  SysScimIdentityTombstone,
  SysScimProjectionGrant,
  SysScimSubject,
  SysScimUser,
  SysJwks,
} from '@objectstack/platform-objects';
import { AuthManager } from './auth-manager.js';
import { createTenancyService } from './tenancy-service.js';
import { mintScimConnectionCredential } from './scim-connection-service.js';
import { registerLastAdminGuard, type LastAdminGuardEngine } from './last-admin-guard.js';
import { registerIdentityWriteGuard, registerManagedUpdateWhitelist } from './identity-write-guard.js';
import { SYS_USER_PROFILE_EDIT_FIELDS } from './sys-user-writable-fields.js';
import { SCIM_DEACTIVATION_BAN_REASON } from './user-ban-write.js';
import { CREDENTIAL_ISSUER } from './backfill-account-issuer.js';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-14360';
const PASSWORD = 'correct-horse-battery-staple-14360';

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

/** Every read below is a safety-proof read, never RLS-scoped to a caller. */
const SYSTEM = { context: { isSystem: true } } as const;

/** The identity surface the org + admin (forced by SCIM) + scim plugins touch. */
const AUTH_OBJECTS = [
  SysUser,
  SysSession,
  SysAccount,
  SysVerification,
  SysOrganization,
  SysMember,
  SysInvitation,
  SysTeam,
  SysTeamMember,
  SysScimConnectionBinding,
  SysScimConnectionCredential,
  SysScimGroup,
  SysScimGroupMember,
  SysScimIdentityTombstone,
  SysScimProjectionGrant,
  SysScimSubject,
  SysScimUser,
  SysJwks,
];

/**
 * The two tables the break-glass guard enumerates platform administrators
 * from, declared down to the columns it reads — the same minimal fixtures
 * `last-admin-guard.test.ts` uses, so the guard's enumeration runs against
 * real tables rather than a hand-written `where` matcher.
 */
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
    organization_id: { name: 'organization_id', type: 'text' as const },
    valid_from: { name: 'valid_from', type: 'datetime' as const },
    valid_until: { name: 'valid_until', type: 'datetime' as const },
  },
};

const PS_ADMIN = 'ps_admin_full_access';

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    const e = engines.pop();
    try {
      await (e as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
});

interface Harness {
  engine: ObjectQL;
  manager: AuthManager;
  token: string;
  send: (request: Request) => Promise<Response>;
}

/**
 * The manager under test — built the way a deployment with SCIM turned on
 * builds it (`plugins.scim: true` forces the admin plugin on, which is what
 * supplies the `banned` column and the `BANNED_USER` sign-in refusal). The
 * `identity.reconcileUser` wiring comes from `AuthManager.buildPluginList()`;
 * nothing here names it.
 */
async function boot(): Promise<Harness> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }),
    true,
  );
  await engine.init();
  for (const object of AUTH_OBJECTS) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  for (const object of [sysPermissionSet, sysUserPermissionSet]) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();

  // The two engine guards `auth-plugin.ts` registers at `kernel:ready`, in
  // the same order (ADR-0092 at priority 10, break-glass at 20).
  registerManagedUpdateWhitelist('sys_user', SYS_USER_PROFILE_EDIT_FIELDS);
  registerIdentityWriteGuard(engine, { packageId: 'test.identity-write-guard' });
  registerLastAdminGuard(engine as unknown as LastAdminGuardEngine, {
    packageId: 'test.last-admin-guard',
  });

  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as never,
    getTenancy: () => createTenancyService({ requested: 'isolated', probeIsolation: () => true }),
    plugins: { scim: true, organization: true },
  } as never);

  const { token } = await mintScimConnectionCredential(engine as never, SECRET, {
    connectionId: 'okta-14360',
  });

  return { engine, manager, token, send: (request) => manager.handleRequest(request) };
}

// ---------------------------------------------------------------------------
// SCIM 2.0 requests — the shapes an identity provider actually sends
// ---------------------------------------------------------------------------

function scimRequest(h: Harness, method: string, path: string, body?: unknown): Request {
  return new Request(`${AUTH}/scim/v2${path}`, {
    method,
    headers: {
      origin: BASE,
      authorization: `Bearer ${h.token}`,
      ...(body !== undefined ? { 'content-type': 'application/scim+json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

interface Provisioned {
  /** The SCIM resource id (what the IdP addresses). */
  scimId: string;
  /** The better-auth / `sys_user` id. */
  userId: string;
  email: string;
}

/** `POST /Users` — an IdP provisioning a user, active unless the case says otherwise. */
async function provision(h: Harness, localPart: string, active = true): Promise<Provisioned> {
  const email = `${localPart}@example.com`;
  const res = await h.send(
    scimRequest(h, 'POST', '/Users', {
      schemas: [USER_SCHEMA],
      userName: email,
      name: { givenName: localPart, familyName: 'Example' },
      displayName: `${localPart} Example`,
      emails: [{ value: email, primary: true, type: 'work' }],
      active,
    }),
  );
  expect(res.status, `SCIM POST /Users failed: ${await res.clone().text()}`).toBe(201);
  const body = (await res.json()) as { id: string; active?: boolean };
  expect(body.active).toBe(active);
  const row = await userRow(h, email);
  expect(row, 'the SCIM create must have landed a sys_user row').toBeTruthy();
  return { scimId: body.id, userId: String(row!.id), email };
}

async function patchUser(
  h: Harness,
  scimId: string,
  operations: Array<{ op: string; path?: string; value?: unknown }>,
): Promise<Response> {
  return h.send(
    scimRequest(h, 'PATCH', `/Users/${scimId}`, { schemas: [PATCH_SCHEMA], Operations: operations }),
  );
}

const setActive = (h: Harness, scimId: string, active: boolean) =>
  patchUser(h, scimId, [{ op: 'replace', path: 'active', value: active }]);

const setDisplayName = (h: Harness, scimId: string, displayName: string) =>
  patchUser(h, scimId, [{ op: 'replace', path: 'displayName', value: displayName }]);

async function scimActive(h: Harness, scimId: string): Promise<boolean | undefined> {
  const res = await h.send(scimRequest(h, 'GET', `/Users/${scimId}`));
  expect(res.status, `SCIM GET /Users/{id} failed: ${await res.clone().text()}`).toBe(200);
  return ((await res.json()) as { active?: boolean }).active;
}

// ---------------------------------------------------------------------------
// The platform side — rows read as system, the vendor's sign-in driven for real
// ---------------------------------------------------------------------------

async function userRow(h: Harness, email: string): Promise<Record<string, unknown> | null> {
  return h.engine.findOne(
    'sys_user',
    { where: { email }, fields: ['id', 'email', 'banned', 'ban_reason', 'ban_expires'] },
    SYSTEM,
  ) as Promise<Record<string, unknown> | null>;
}

/** sqlite hands the boolean back as 0/1; anything else is NOT a ban. */
const isBanned = (row: Record<string, unknown> | null): boolean =>
  row?.banned === true || row?.banned === 1;

async function sessionCount(h: Harness, userId: string): Promise<number> {
  const rows = await h.engine.find('sys_session', { where: { user_id: userId } }, SYSTEM);
  return Array.isArray(rows) ? rows.length : 0;
}

/**
 * The "local-password user" the card describes: an IdP-provisioned account an
 * administrator later gave a password. Written exactly as the platform's own
 * `/admin/set-user-password` mount writes it for an SSO/invite-onboarded user
 * (`admin-user-endpoints.ts`: hash, then `createAccount` with the local
 * credential issuer — 1.7.2's sign-in accepts no other credential row). The
 * address is marked verified because the IdP asserted it.
 */
async function attachPassword(h: Harness, user: Provisioned): Promise<void> {
  const ctx = await h.manager.getAuthContext();
  const hashed = await ctx.password.hash(PASSWORD);
  await ctx.internalAdapter.createAccount({
    userId: user.userId,
    providerId: 'credential',
    issuer: CREDENTIAL_ISSUER,
    accountId: user.userId,
    password: hashed,
  });
  await h.engine.update('sys_user', { id: user.userId, email_verified: true }, SYSTEM);
}

async function signIn(h: Harness, email: string): Promise<Response> {
  return h.send(
    new Request(`${AUTH}/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );
}

async function expectSignInAccepted(h: Harness, email: string): Promise<void> {
  const res = await signIn(h, email);
  expect(res.status, `sign-in refused: ${await res.clone().text()}`).toBeLessThan(300);
}

/**
 * The vendor's refusal, pinned as status AND code: better-auth's admin
 * plugin throws `FORBIDDEN` / `BANNED_USER` from its `session.create` hook.
 * A bare "not 2xx" would also be satisfied by a wrong password or a broken
 * transport — neither is the fact under test.
 */
async function expectSignInBanned(h: Harness, email: string): Promise<void> {
  const res = await signIn(h, email);
  const body = (await res.json()) as { code?: string; message?: string };
  expect(res.status, `expected BANNED_USER, got ${res.status} ${JSON.stringify(body)}`).toBe(403);
  expect(body.code).toBe('BANNED_USER');
}

/** Give `userId` unscoped `admin_full_access` — a platform administrator. */
async function makePlatformAdmin(h: Harness, userId: string): Promise<void> {
  const existing = await h.engine.findOne(
    'sys_permission_set',
    { where: { id: PS_ADMIN }, fields: ['id'] },
    SYSTEM,
  );
  if (!existing) {
    await h.engine.insert('sys_permission_set', { id: PS_ADMIN, name: ADMIN_FULL_ACCESS }, SYSTEM);
  }
  await h.engine.insert(
    'sys_user_permission_set',
    { id: `ups_${userId}`, user_id: userId, permission_set_id: PS_ADMIN },
    SYSTEM,
  );
}

// ---------------------------------------------------------------------------
// (a) + (b) — the contract: deactivation disables, reactivation re-enables
// ---------------------------------------------------------------------------

describe('[#14360] SCIM active:false disables the account through the platform ban write', () => {
  it('(a) active:false ⇒ banned with the SCIM reason, sessions revoked, sign-in refused as BANNED_USER', async () => {
    const h = await boot();
    const dana = await provision(h, 'dana');
    await attachPassword(h, dana);

    // Control: before the IdP deactivates, the local password works and
    // leaves a session behind — the row this card says must stop working.
    await expectSignInAccepted(h, dana.email);
    expect(await sessionCount(h, dana.userId)).toBeGreaterThan(0);
    expect(isBanned(await userRow(h, dana.email))).toBe(false);

    const res = await setActive(h, dana.scimId, false);
    expect(res.status, `SCIM PATCH active:false failed: ${await res.clone().text()}`).toBe(200);
    expect(((await res.json()) as { active?: boolean }).active).toBe(false);

    const row = await userRow(h, dana.email);
    expect(isBanned(row)).toBe(true);
    expect(row?.ban_reason).toBe(SCIM_DEACTIVATION_BAN_REASON);
    expect(row?.ban_expires ?? null).toBeNull();
    // The vendor's own revocation, after the callback returned.
    expect(await sessionCount(h, dana.userId)).toBe(0);
    // And the enforcement: the vendor's session hook reads `banned`.
    await expectSignInBanned(h, dana.email);
  }, 60_000);

  it('(b) active:true ⇒ the SCIM ban is lifted and sign-in is accepted again', async () => {
    const h = await boot();
    const dana = await provision(h, 'dana');
    await attachPassword(h, dana);

    expect((await setActive(h, dana.scimId, false)).status).toBe(200);
    await expectSignInBanned(h, dana.email);

    const res = await setActive(h, dana.scimId, true);
    expect(res.status, `SCIM PATCH active:true failed: ${await res.clone().text()}`).toBe(200);

    const row = await userRow(h, dana.email);
    expect(isBanned(row)).toBe(false);
    expect(row?.ban_reason ?? null).toBeNull();
    expect(row?.ban_expires ?? null).toBeNull();
    await expectSignInAccepted(h, dana.email);
  }, 60_000);

  it('(a)+(b) are idempotent: repeating the same state writes nothing new and changes nothing', async () => {
    const h = await boot();
    const dana = await provision(h, 'dana');

    expect((await setActive(h, dana.scimId, false)).status).toBe(200);
    // The vendor reports "no change" for an identical PATCH; the callback
    // still runs on the vendor's terms and must leave the row as it is.
    expect((await setActive(h, dana.scimId, false)).status).toBe(200);
    const banned = await userRow(h, dana.email);
    expect(isBanned(banned)).toBe(true);
    expect(banned?.ban_reason).toBe(SCIM_DEACTIVATION_BAN_REASON);

    expect((await setActive(h, dana.scimId, true)).status).toBe(200);
    expect((await setActive(h, dana.scimId, true)).status).toBe(200);
    expect(isBanned(await userRow(h, dana.email))).toBe(false);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// (c) — the break-glass guard holds on the REAL SCIM path
// ---------------------------------------------------------------------------

describe('[#14360] deactivating the last administrator is refused through SCIM, loudly', () => {
  it('(c) the IdP gets a 403 SCIM error naming the invariant, and the account stays active', async () => {
    const h = await boot();
    const owner = await provision(h, 'owner');
    await attachPassword(h, owner);
    await makePlatformAdmin(h, owner.userId);
    await expectSignInAccepted(h, owner.email);

    const res = await setActive(h, owner.scimId, false);
    const body = (await res.json()) as { schemas?: string[]; status?: string; detail?: string };
    // The SCIM 2.0 error envelope, status AND detail — never an opaque 500:
    // the guard's whole product is the explanation the IdP operator reads.
    expect(res.status, `expected the guard's 403, got ${res.status} ${JSON.stringify(body)}`).toBe(403);
    expect(body.schemas ?? []).toContain(SCIM_ERROR_SCHEMA);
    expect(String(body.status)).toBe('403');
    expect(body.detail).toMatch(/last administrator/i);
    expect(body.detail).toMatch(/ADR-0024 D5\.2/);
    expect(body.detail).toMatch(/SCIM deprovision is too broad/);

    // The ban did not land and the administrator still signs in — the
    // invariant the guard exists for.
    const row = await userRow(h, owner.email);
    expect(isBanned(row)).toBe(false);
    expect(row?.ban_reason ?? null).toBeNull();
    await expectSignInAccepted(h, owner.email);

    // [#14522] The vendor's own `scimUser.active = false` write, made BEFORE
    // the callback inside its transaction, is rolled back WITH the refusal:
    // the adapter's #3653 SCIM transaction scoping opens a real engine
    // transaction now that the scope is opened at `handleRequest` (it was
    // stamped with `enterWith` inside `verifyBearerToken` and never reached
    // the writes — measured as 0 `engine.transaction` calls across POST +
    // PATCH /Users). So the SCIM resource keeps reporting `active: true` for
    // the account that stayed enabled. This line read `false` on purpose
    // while that residual was open and was flipped DELIBERATELY with the fix;
    // the positive control below is the genuine `false`.
    expect(await scimActive(h, owner.scimId)).toBe(true);
  }, 60_000);

  it('(c) positive control: with a second administrator left behind, the same request succeeds', async () => {
    const h = await boot();
    const owner = await provision(h, 'owner');
    await makePlatformAdmin(h, owner.userId);
    // The survivor — provisioned by the same IdP, holding the same standing.
    const deputy = await provision(h, 'deputy');
    await makePlatformAdmin(h, deputy.userId);

    const res = await setActive(h, owner.scimId, false);
    expect(res.status, `expected the deactivation to proceed: ${await res.clone().text()}`).toBe(200);
    expect(isBanned(await userRow(h, owner.email))).toBe(true);
    expect(await scimActive(h, owner.scimId)).toBe(false);

    // …and the deputy is now the last one: refused.
    const last = await setActive(h, deputy.scimId, false);
    expect(last.status).toBe(403);
    expect(isBanned(await userRow(h, deputy.email))).toBe(false);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// (d) — negative controls
// ---------------------------------------------------------------------------

describe('[#14360] a SCIM update that does not change `active` touches no ban column', () => {
  it('(d) an attribute-only PATCH on an active user leaves `banned` alone and revokes nothing', async () => {
    const h = await boot();
    const erin = await provision(h, 'erin');
    await attachPassword(h, erin);
    await expectSignInAccepted(h, erin.email);
    const sessionsBefore = await sessionCount(h, erin.userId);
    expect(sessionsBefore).toBeGreaterThan(0);

    const res = await setDisplayName(h, erin.scimId, 'Erin Renamed');
    expect(res.status, `SCIM PATCH displayName failed: ${await res.clone().text()}`).toBe(200);

    const row = await userRow(h, erin.email);
    expect(isBanned(row)).toBe(false);
    expect(row?.ban_reason ?? null).toBeNull();
    // Still active ⇒ the vendor revoked nothing either.
    expect(await sessionCount(h, erin.userId)).toBe(sessionsBefore);
    await expectSignInAccepted(h, erin.email);
  }, 60_000);

  it("(d) an administrator's ban survives an IdP attribute sync AND an explicit active:true", async () => {
    const h = await boot();
    const frank = await provision(h, 'frank');
    await attachPassword(h, frank);

    // The ban an administrator placed for cause — the platform ban write's
    // effect, with a reason that is not the IdP's.
    await h.engine.update(
      'sys_user',
      { id: frank.userId, banned: true, ban_reason: 'Policy violation' },
      SYSTEM,
    );
    await expectSignInBanned(h, frank.email);

    // Every IdP PUT carries `active: true`; an attribute sync must not
    // silently re-admit a user banned for cause.
    expect((await setDisplayName(h, frank.scimId, 'Frank Renamed')).status).toBe(200);
    let row = await userRow(h, frank.email);
    expect(isBanned(row)).toBe(true);
    expect(row?.ban_reason).toBe('Policy violation');

    // Nor may an explicit reactivation: the reason is not SCIM's, so the ban
    // is not SCIM's to lift.
    expect((await setActive(h, frank.scimId, true)).status).toBe(200);
    row = await userRow(h, frank.email);
    expect(isBanned(row)).toBe(true);
    expect(row?.ban_reason).toBe('Policy violation');
    await expectSignInBanned(h, frank.email);

    // And a deactivation on an already-banned row overwrites nothing: the
    // administrator's reason is the record of why.
    expect((await setActive(h, frank.scimId, false)).status).toBe(200);
    row = await userRow(h, frank.email);
    expect(isBanned(row)).toBe(true);
    expect(row?.ban_reason).toBe('Policy violation');
  }, 60_000);

  it("(d) a deactivation makes an administrator's EXPIRING ban permanent — the expiry cannot re-admit a deactivated principal", async () => {
    const h = await boot();
    const hana = await provision(h, 'hana');
    await attachPassword(h, hana);

    // A timed administrator ban: the vendor's session hook auto-lifts it the
    // moment `banExpires` is in the past, and nothing re-invokes the SCIM
    // callback until the IdP mutates the user again — so an expiry left in
    // place would ADMIT a principal the IdP still holds deactivated.
    const expiresAt = new Date(Date.now() + 1_500);
    await h.engine.update(
      'sys_user',
      { id: hana.userId, banned: true, ban_reason: 'Policy violation', ban_expires: expiresAt },
      SYSTEM,
    );
    expect((await userRow(h, hana.email))?.ban_expires ?? null).not.toBeNull();
    await expectSignInBanned(h, hana.email);

    const res = await setActive(h, hana.scimId, false);
    expect(res.status, `SCIM PATCH active:false failed: ${await res.clone().text()}`).toBe(200);
    let row = await userRow(h, hana.email);
    expect(isBanned(row)).toBe(true);
    // The administrator's reason is kept — the ban stays theirs to lift.
    expect(row?.ban_reason).toBe('Policy violation');
    // …and only the expiry is gone.
    expect(row?.ban_expires ?? null).toBeNull();

    // Let the administrator's expiry pass, then prove the refusal still holds
    // (status AND code): without the clearing above the vendor would have
    // auto-unbanned here and answered 2xx.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(Date.now()).toBeGreaterThan(expiresAt.getTime());
    await expectSignInBanned(h, hana.email);
    row = await userRow(h, hana.email);
    expect(isBanned(row)).toBe(true);
    expect(row?.ban_reason).toBe('Policy violation');
  }, 60_000);
});

// ---------------------------------------------------------------------------
// (e) — the #13816 construction-time refusal is untouched
// ---------------------------------------------------------------------------

describe('[#14360] a host that declines the admin plugin beside SCIM is still refused at construction', () => {
  it('(e) plugins.admin:false + plugins.scim:true throws the #13816 conflict', () => {
    expect(
      () =>
        new AuthManager({
          secret: SECRET,
          baseUrl: BASE,
          plugins: { scim: true, admin: false },
        } as never),
    ).toThrow(/conflicting auth plugin configuration/);
  });
});

// ---------------------------------------------------------------------------
// (g) — POST with active:false: provisioned disabled from the first write
// ---------------------------------------------------------------------------

describe('[#14360] POST /Users with active:false provisions the account disabled', () => {
  it('(g) the created user is banned with the SCIM reason and refused at sign-in', async () => {
    const h = await boot();
    // The vendor invokes the callback on create too; 1.6.x banned at
    // creation as well, so this is restored behaviour, pinned so it is
    // declared rather than incidental.
    const ivan = await provision(h, 'ivan', false);

    const row = await userRow(h, ivan.email);
    expect(isBanned(row)).toBe(true);
    expect(row?.ban_reason).toBe(SCIM_DEACTIVATION_BAN_REASON);
    expect(row?.ban_expires ?? null).toBeNull();

    // Even with a local password attached afterwards, the refusal holds —
    // status AND code.
    await attachPassword(h, ivan);
    await expectSignInBanned(h, ivan.email);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// (f) — DELETE: the tombstoned account is disabled, not left signing in
// ---------------------------------------------------------------------------

describe('[#14360] DELETE /Users/{id} leaves the tombstoned account disabled', () => {
  it('(f) the sys_user row survives the vendor tombstone, banned with the SCIM reason, sign-in refused', async () => {
    const h = await boot();
    const gus = await provision(h, 'gus');
    await attachPassword(h, gus);
    await expectSignInAccepted(h, gus.email);

    const res = await h.send(scimRequest(h, 'DELETE', `/Users/${gus.scimId}`));
    expect(res.status, `SCIM DELETE /Users/{id} failed: ${await res.clone().text()}`).toBe(204);

    // 1.7.2 no longer deletes the better-auth user — it tombstones the SCIM
    // source and reports the aggregate state as inactive. Without this card
    // that account kept its password and kept signing in.
    const row = await userRow(h, gus.email);
    expect(row, 'the better-auth user row is tombstoned, not deleted, on 1.7.2').toBeTruthy();
    expect(isBanned(row)).toBe(true);
    expect(row?.ban_reason).toBe(SCIM_DEACTIVATION_BAN_REASON);
    expect(await sessionCount(h, gus.userId)).toBe(0);
    await expectSignInBanned(h, gus.email);
  }, 60_000);
});
