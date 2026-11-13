// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0151 D6] The AI service account's lifecycle doors
 * (`service-account-lifecycle.ts`) and the owner-leaves suspension
 * (`service-account-owner-leaves.ts`), on a REAL ObjectQL engine over
 * better-sqlite3 `:memory:` with the real `sys_user` row rules registered, so
 * the engine dispatches the hooks each write must pass.
 *
 * What is pinned, each refusal beside its CONTROL:
 *
 *  - suspend: the owner or an administrator writes the ban state; another
 *    member, an administrator of another organization, and a person's id do not;
 *  - resume: an administrator only (never the owner), never a retired account,
 *    never an account whose owner has left until a new owner is named;
 *  - set-owner: an administrator only; the new owner a member of the account's
 *    organization and a person; it does not resume;
 *  - retire: an administrator only; the memberships end and every key carries
 *    the terminal reason, the row stays, and nothing mints after;
 *  - revoke-key / restore-key: the owner or an administrator, one key only;
 *    the restore guard's reasons (a platform administrator's stop, a
 *    membership that ended) hold here as they do on the generic door;
 *  - the owner's leaving the account's organization suspends it, leaving
 *    another organization does not, and a stop already in place keeps its reason;
 *  - an unreadable membership is an outage (503), never a verdict.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { isAuthzStoreUnavailableError } from '@objectstack/core';

import {
  runCreateServiceAccountKey, runRegisterServiceAccount,
  type ServiceAccountCaller, type ServiceAccountDoorDeps,
} from './service-account-doors.js';
import {
  runRestoreServiceAccountKey, runResumeServiceAccount, runRetireServiceAccount, runRevokeServiceAccountKey,
  runSetServiceAccountOwner, runSuspendServiceAccount, SERVICE_ACCOUNT_SUSPENDED_REASON,
  type ServiceAccountLifecycleDeps,
} from './service-account-lifecycle.js';
import {
  directoryDeactivatedOwnerSuspensionIncompleteMessage, isOwnedAccountSuspensionComplete,
  registerServiceAccountOwnerLeavesTrigger, SERVICE_ACCOUNT_OWNER_DEACTIVATED_REASON, SERVICE_ACCOUNT_OWNER_LEFT_REASON,
  suspendAccountsOfDirectoryDeactivatedOwner, type ServiceAccountOwnerLeavesEngine,
} from './service-account-owner-leaves.js';
import { SCIM_DEACTIVATION_BAN_REASON } from './user-ban-write.js';
import { registerServiceAccountRowGuard } from './service-account-identity.js';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';

const SYSTEM = { context: { isSystem: true } } as const;
const ORG = 'org_a';
const OTHER_ORG = 'org_b';
const NOW = Date.parse('2026-11-09T12:00:00.000Z');

const text = (name: string) => ({ name, type: 'text' as const });
const bool = (name: string) => ({ name, type: 'boolean' as const });
const OBJECTS = [
  {
    name: 'sys_user',
    label: 'User',
    fields: {
      id: { ...text('id'), primaryKey: true },
      name: text('name'),
      email: text('email'),
      email_verified: bool('email_verified'),
      principal_kind: text('principal_kind'),
      accountable_user_id: text('accountable_user_id'),
      source: text('source'),
      banned: bool('banned'),
      ban_reason: text('ban_reason'),
      ban_expires: text('ban_expires'),
    },
  },
  {
    name: 'sys_member',
    label: 'Member',
    fields: { id: { ...text('id'), primaryKey: true }, user_id: text('user_id'), organization_id: text('organization_id'), role: text('role') },
  },
  {
    name: 'sys_api_key',
    label: 'API Key',
    fields: {
      id: { ...text('id'), primaryKey: true },
      name: text('name'),
      key: text('key'),
      prefix: text('prefix'),
      user_id: text('user_id'),
      revoked: bool('revoked'),
      revoked_reason: text('revoked_reason'),
      expires_at: text('expires_at'),
      active_organization_id: text('active_organization_id'),
    },
  },
];

let engine: ObjectQL;
let failMemberReads = false;

type FindArgs = Parameters<ObjectQL['find']>;
type InsertArgs = Parameters<ObjectQL['insert']>;

const dataEngine = () => ({
  find: (object: string, query?: unknown, options?: unknown) => {
    if (failMemberReads && object === 'sys_member') return Promise.reject(new Error('sys_member is unreachable'));
    return engine.find(object, query as FindArgs[1], options as FindArgs[2]);
  },
  insert: (object: string, data: Record<string, unknown>, options?: unknown) =>
    engine.insert(object, data, options as InsertArgs[2]),
  // The real engine's own write methods: no looser stand-in.
  update: engine.update.bind(engine),
  delete: engine.delete.bind(engine),
});

const deps = (): ServiceAccountDoorDeps & ServiceAccountLifecycleDeps => ({
  getDataEngine: dataEngine,
  addMember: async ({ userId, organizationId }) => {
    await engine.insert('sys_member', { user_id: userId, organization_id: organizationId, role: 'member' }, SYSTEM);
  },
  runAtomically: (work) => engine.transaction(async () => work()),
  resolveApiKeyLifecyclePolicy: () => ({ defaultExpiryDays: 90, maxExpiryDays: 365, inactivityDays: 90 }) as never,
  now: () => NOW,
});

const caller = (id: string, opts: Partial<ServiceAccountCaller> = {}): ServiceAccountCaller => ({
  id, isPlatformAdmin: false, activeOrganizationId: ORG, ...opts,
});
const ADMIN = caller('usr_admin');
const OWNER = caller('usr_owner');
const MEMBER = caller('usr_member');
const OTHER_ADMIN = caller('usr_other_admin', { activeOrganizationId: OTHER_ORG });
const PLATFORM = caller('usr_platform', { isPlatformAdmin: true });

const post = (body: unknown) =>
  new Request('http://localhost/api/v1/auth/service-account/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const rows = async (object: string, where: Record<string, unknown> = {}) =>
  (await engine.find(object, { where, ...SYSTEM })) as Array<Record<string, any>>;
const userRow = async (id: string) => (await rows('sys_user', { id }))[0];
const keyRow = async (id: string) => (await rows('sys_api_key', { id }))[0];

const DENIED = { status: 403, body: { error: { code: 'PERMISSION_DENIED' } } };
const CONFLICT = { status: 409, body: { error: { code: 'RESOURCE_CONFLICT' } } };
const UNKNOWN = { status: 404, body: { error: { code: 'RESOURCE_NOT_FOUND' } } };

beforeEach(async () => {
  failMemberReads = false;
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const o of OBJECTS) engine.registry.registerObject(o as never);
  await engine.syncSchemas();
  await relaxTenantColumns(engine, ['sys_user', 'sys_member', 'sys_api_key']);
  registerServiceAccountRowGuard(engine, { packageId: 'test.service-account-lifecycle.rows' });
  registerServiceAccountOwnerLeavesTrigger(engine as unknown as ServiceAccountOwnerLeavesEngine, {
    packageId: 'test.service-account-lifecycle.owner-leaves',
  });

  for (const id of ['usr_admin', 'usr_owner', 'usr_member', 'usr_other_admin', 'usr_platform']) {
    await engine.insert('sys_user', { id, name: id, email: `${id}@a.example`, email_verified: true, principal_kind: 'human' }, SYSTEM);
  }
  const members: Array<[string, string, string]> = [
    ['usr_admin', ORG, 'admin'],
    ['usr_owner', ORG, 'member'],
    ['usr_owner', OTHER_ORG, 'member'],
    ['usr_member', ORG, 'member'],
    ['usr_other_admin', OTHER_ORG, 'owner'],
  ];
  for (const [user_id, organization_id, role] of members) {
    await engine.insert('sys_member', { user_id, organization_id, role }, SYSTEM);
  }
});

afterEach(async () => {
  try { await engine.destroy(); } catch { /* noop */ }
});

/** An account in ORG owned by `usr_owner`, registered by the organization administrator. */
async function account(name = 'Invoice bot'): Promise<string> {
  const r = await runRegisterServiceAccount(deps(), ADMIN, post({ name, ownerId: 'usr_owner' }));
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return String(r.body.data!.userId);
}

async function keyOf(userId: string, by: ServiceAccountCaller = OWNER): Promise<string> {
  const r = await runCreateServiceAccountKey(deps(), by, post({ userId, name: 'k' }));
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return String(r.body.data!.id);
}

const suspend = (by: ServiceAccountCaller, body: unknown) => runSuspendServiceAccount(deps(), by, post(body));
const resume = (by: ServiceAccountCaller, userId: string) => runResumeServiceAccount(deps(), by, post({ userId }));
const setOwner = (by: ServiceAccountCaller, userId: string, ownerId: string) =>
  runSetServiceAccountOwner(deps(), by, post({ userId, ownerId }));
const retire = (by: ServiceAccountCaller, userId: string) => runRetireServiceAccount(deps(), by, post({ userId }));
const revokeKey = (by: ServiceAccountCaller, keyId: string) => runRevokeServiceAccountKey(deps(), by, post({ keyId }));
const restoreKey = (by: ServiceAccountCaller, keyId: string) => runRestoreServiceAccountKey(deps(), by, post({ keyId }));

describe('[ADR-0151 D6] suspend: the ban state, written by the owner or an administrator', () => {
  it('the owner suspends the account: banned, with the default reason and no expiry', async () => {
    const id = await account();
    const r = await suspend(OWNER, { userId: id });
    expect(r).toMatchObject({ status: 200, body: { data: { userId: id, suspended: true } } });
    expect(await userRow(id)).toMatchObject({ banned: true, ban_reason: SERVICE_ACCOUNT_SUSPENDED_REASON, ban_expires: null });
  });

  it('an organization administrator and a platform administrator suspend it, with a reason of their own', async () => {
    const a = await account('A');
    const b = await account('B');
    expect((await suspend(ADMIN, { userId: a, reason: 'Runaway loop' })).status).toBe(200);
    expect((await suspend(PLATFORM, { userId: b })).status).toBe(200);
    expect((await userRow(a)).ban_reason).toBe(`${SERVICE_ACCOUNT_SUSPENDED_REASON}: Runaway loop`);
    expect((await userRow(b)).banned).toBe(true);
  });

  it('another member and an administrator of another organization are refused 403, and nothing is written', async () => {
    const id = await account();
    expect(await suspend(MEMBER, { userId: id })).toMatchObject(DENIED);
    expect(await suspend(OTHER_ADMIN, { userId: id })).toMatchObject(DENIED);
    expect((await userRow(id)).banned).not.toBe(true);
  });

  it('a person\'s id is answered as unknown: this door never bans a person', async () => {
    expect(await suspend(PLATFORM, { userId: 'usr_member' })).toMatchObject(UNKNOWN);
    expect((await userRow('usr_member')).banned).not.toBe(true);
  });

  it('a reason over 500 characters is refused at the field', async () => {
    const id = await account();
    expect(await suspend(OWNER, { userId: id, reason: 'x'.repeat(501) })).toMatchObject({
      status: 400, body: { error: { code: 'VALIDATION_FAILED', fields: [{ field: 'reason', code: 'max_length' }] } },
    });
  });

  it('an unreadable membership is an outage, never a verdict', async () => {
    const id = await account();
    failMemberReads = true;
    await expect(suspend(OWNER, { userId: id })).rejects.toSatisfy(isAuthzStoreUnavailableError);
    failMemberReads = false;
    expect((await userRow(id)).banned).not.toBe(true);
  });
});

describe('[ADR-0151 D6] resume: an administrator only, and never with nobody accountable', () => {
  it('the owner cannot lift a stop: 403, the account stays suspended', async () => {
    const id = await account();
    await suspend(ADMIN, { userId: id });
    expect(await resume(OWNER, id)).toMatchObject(DENIED);
    expect((await userRow(id)).banned).toBe(true);
  });

  it('CONTROL: an organization administrator resumes it, clearing the ban state', async () => {
    const id = await account();
    await suspend(OWNER, { userId: id, reason: 'Paused' });
    expect(await resume(ADMIN, id)).toMatchObject({ status: 200, body: { data: { suspended: false } } });
    expect(await userRow(id)).toMatchObject({ banned: false, ban_reason: null, ban_expires: null });
  });

  it('an account whose owner left is not resumed until a new owner is named; then it is', async () => {
    const id = await account();
    await engine.delete('sys_member', { where: { user_id: 'usr_owner', organization_id: ORG }, multi: true, ...SYSTEM });
    expect((await userRow(id)).banned).toBe(true);
    expect(await resume(ADMIN, id)).toMatchObject(CONFLICT);
    expect((await userRow(id)).banned).toBe(true);

    expect((await setOwner(ADMIN, id, 'usr_member')).status).toBe(200);
    expect((await userRow(id)).banned, 'naming an owner does not resume').toBe(true);
    expect((await resume(ADMIN, id)).status).toBe(200);
    expect((await userRow(id)).banned).toBe(false);
  });

  it('a platform administrator\'s ban is not an organization administrator\'s to lift: 403, the account stays banned', async () => {
    const id = await account();
    // The state `/admin/ban-user` writes, with a reason of its own.
    await engine.update('sys_user', { id, banned: true, ban_reason: 'Abuse report', ban_expires: null }, SYSTEM);
    expect(await resume(ADMIN, id)).toMatchObject(DENIED);
    expect(await userRow(id)).toMatchObject({ banned: true, ban_reason: 'Abuse report' });

    expect((await resume(PLATFORM, id)).status, 'CONTROL: a platform administrator lifts it').toBe(200);
    expect((await userRow(id)).banned).toBe(false);
  });

  it('suspending an account already banned leaves its ban exactly as it is: the reason is never relabelled', async () => {
    const id = await account();
    await engine.update('sys_user', { id, banned: true, ban_reason: 'Abuse report', ban_expires: null }, SYSTEM);
    expect((await suspend(OWNER, { userId: id, reason: 'mine now' })).status).toBe(200);
    expect(await userRow(id)).toMatchObject({ banned: true, ban_reason: 'Abuse report' });
    expect(await resume(ADMIN, id)).toMatchObject(DENIED);
  });

  it('a retired account is not resumed', async () => {
    const id = await account();
    await retire(ADMIN, id);
    expect(await resume(PLATFORM, id)).toMatchObject(CONFLICT);
  });
});

describe('[ADR-0151 D6] set-owner: an administrator names another person of the organization', () => {
  it('an administrator names a new owner; the owner, another member and another organization\'s administrator are refused', async () => {
    const id = await account();
    expect(await setOwner(OWNER, id, 'usr_member')).toMatchObject(DENIED);
    expect(await setOwner(MEMBER, id, 'usr_member')).toMatchObject(DENIED);
    expect(await setOwner(OTHER_ADMIN, id, 'usr_other_admin')).toMatchObject(DENIED);
    expect((await userRow(id)).accountable_user_id).toBe('usr_owner');

    expect(await setOwner(ADMIN, id, 'usr_member')).toMatchObject({ status: 200, body: { data: { ownerId: 'usr_member' } } });
    expect((await userRow(id)).accountable_user_id).toBe('usr_member');
  });

  it('the new owner must be a member of the account\'s organization', async () => {
    const id = await account();
    expect(await setOwner(ADMIN, id, 'usr_other_admin')).toMatchObject({
      status: 400, body: { error: { code: 'VALIDATION_FAILED', fields: [{ field: 'ownerId', code: 'invalid_value' }] } },
    });
    expect((await userRow(id)).accountable_user_id).toBe('usr_owner');
  });

  it('another AI service account is never an owner: the row rules refuse it', async () => {
    const id = await account('A');
    const other = await account('B');
    expect(await setOwner(ADMIN, id, other)).toMatchObject({
      status: 400, body: { error: { code: 'VALIDATION_FAILED', fields: [{ field: 'accountable_user_id', code: 'invalid_value' }] } },
    });
    expect((await userRow(id)).accountable_user_id).toBe('usr_owner');
  });
});

describe('[ADR-0151 D6] retire: terminal, the row kept', () => {
  it('an administrator retires it: no membership, every key revoked for the terminal reason, the row kept, and no key mints after', async () => {
    const id = await account();
    const live = await keyOf(id);
    const ownerRevoked = await keyOf(id);
    await revokeKey(OWNER, ownerRevoked);

    expect(await retire(ADMIN, id)).toMatchObject({ status: 200, body: { data: { retired: true, keysRevoked: 2 } } });
    expect(await rows('sys_member', { user_id: id })).toEqual([]);
    for (const k of [live, ownerRevoked]) {
      expect(await keyRow(k)).toMatchObject({ revoked: true, revoked_reason: 'organization_membership_ended' });
    }
    expect(await userRow(id)).toMatchObject({ principal_kind: 'agent' });

    expect(await runCreateServiceAccountKey(deps(), PLATFORM, post({ userId: id }))).toMatchObject(CONFLICT);
    expect(await retire(PLATFORM, id)).toMatchObject(CONFLICT);
  });

  it('every key present at commit is revoked, one written after the membership ends included', async () => {
    const id = await account();
    await keyOf(id);
    // A key landing between the membership's end and the key read: written
    // from inside the unit of work, after the delete.
    const pkg = 'test.service-account-lifecycle.late-key';
    engine.registerHook('afterDelete', async (ctx: any) => {
      if (ctx?.previous?.user_id !== id) return;
      await engine.insert('sys_api_key', { id: 'key_late', name: 'late', key: 'h', prefix: 'p', user_id: id, revoked: false }, SYSTEM);
    }, { object: 'sys_member', packageId: pkg });
    try {
      expect(await retire(ADMIN, id)).toMatchObject({ status: 200, body: { data: { keysRevoked: 2 } } });
    } finally {
      engine.unregisterHooksByPackage(pkg);
    }
    expect(await keyRow('key_late')).toMatchObject({ revoked: true, revoked_reason: 'organization_membership_ended' });
  });

  it('the owner and another member cannot retire it', async () => {
    const id = await account();
    expect(await retire(OWNER, id)).toMatchObject(DENIED);
    expect(await retire(MEMBER, id)).toMatchObject(DENIED);
    expect(await rows('sys_member', { user_id: id })).toHaveLength(1);
  });
});

describe('[ADR-0151 D6] revoke-key and restore-key: one key, under the restore guard\'s reasons', () => {
  it('the owner revokes one key and restores it; the account\'s other key is untouched', async () => {
    const id = await account();
    const k1 = await keyOf(id);
    const k2 = await keyOf(id);
    expect(await revokeKey(OWNER, k1)).toMatchObject({ status: 200, body: { data: { revoked: true } } });
    expect(await keyRow(k1)).toMatchObject({ revoked: true, revoked_reason: null });
    expect((await keyRow(k2)).revoked).toBe(false);
    expect(await restoreKey(OWNER, k1)).toMatchObject({ status: 200, body: { data: { revoked: false } } });
    expect((await keyRow(k1)).revoked).toBe(false);
  });

  it('a platform administrator\'s revoke records administrator_suspended, which the owner cannot lift and a platform administrator can', async () => {
    const id = await account();
    const k = await keyOf(id);
    await revokeKey(PLATFORM, k);
    expect(await keyRow(k)).toMatchObject({ revoked: true, revoked_reason: 'administrator_suspended' });
    expect(await restoreKey(OWNER, k)).toMatchObject(DENIED);
    expect(await restoreKey(ADMIN, k)).toMatchObject(DENIED);
    expect((await keyRow(k)).revoked).toBe(true);
    expect((await restoreKey(PLATFORM, k)).status).toBe(200);
    expect(await keyRow(k)).toMatchObject({ revoked: false, revoked_reason: null });
  });

  it('a reason already on the key is never overwritten by a later revoke', async () => {
    const id = await account();
    const k = await keyOf(id);
    await engine.update('sys_api_key', { id: k, revoked: true, revoked_reason: 'admin_password_reset' }, SYSTEM);
    await revokeKey(PLATFORM, k);
    expect((await keyRow(k)).revoked_reason).toBe('admin_password_reset');
  });

  it('a key revoked because the membership ended is never restored, not by a platform administrator either', async () => {
    const id = await account();
    const k = await keyOf(id);
    await retire(ADMIN, id);
    expect(await restoreKey(PLATFORM, k)).toMatchObject(DENIED);
    expect(await keyRow(k)).toMatchObject({ revoked: true, revoked_reason: 'organization_membership_ended' });
  });

  it('a key the directory deactivation revoked is never restored, not by the owner and not by a platform administrator', async () => {
    const id = await account();
    const k = await keyOf(id);
    await engine.update('sys_api_key', { id: k, revoked: true, revoked_reason: 'scim_deactivated' }, SYSTEM);
    for (const by of [OWNER, ADMIN, PLATFORM]) {
      const refused = await restoreKey(by, k);
      expect(refused).toMatchObject(DENIED);
      expect(JSON.stringify(refused.body)).toMatch(/directory deactivated .* cannot be restored\. Create a new key instead\./);
    }
    expect(await keyRow(k)).toMatchObject({ revoked: true, revoked_reason: 'scim_deactivated' });
  });

  it('another member cannot touch the key; a person\'s key is answered as unknown', async () => {
    const id = await account();
    const k = await keyOf(id);
    expect(await revokeKey(MEMBER, k)).toMatchObject(DENIED);
    expect(await revokeKey(OTHER_ADMIN, k)).toMatchObject(DENIED);
    expect((await keyRow(k)).revoked).toBe(false);

    await engine.insert('sys_api_key', { id: 'key_person', name: 'p', key: 'h', prefix: 'p', user_id: 'usr_member', revoked: false }, SYSTEM);
    expect(await revokeKey(PLATFORM, 'key_person')).toMatchObject(UNKNOWN);
    expect((await keyRow('key_person')).revoked).toBe(false);
  });
});

describe('[ADR-0151 D6] the owner leaves: the account is suspended', () => {
  it('the owner\'s membership of the account\'s organization ends: the account is suspended for that reason', async () => {
    const id = await account();
    await engine.delete('sys_member', { where: { user_id: 'usr_owner', organization_id: ORG }, multi: true, ...SYSTEM });
    expect(await userRow(id)).toMatchObject({ banned: true, ban_reason: SERVICE_ACCOUNT_OWNER_LEFT_REASON });
  });

  it('CONTROL: the owner leaving ANOTHER organization suspends nothing here', async () => {
    const id = await account();
    await engine.delete('sys_member', { where: { user_id: 'usr_owner', organization_id: OTHER_ORG }, multi: true, ...SYSTEM });
    expect((await userRow(id)).banned).not.toBe(true);
  });

  it('CONTROL: another member leaving suspends nothing', async () => {
    const id = await account();
    await engine.delete('sys_member', { where: { user_id: 'usr_member' }, multi: true, ...SYSTEM });
    expect((await userRow(id)).banned).not.toBe(true);
  });

  it('a membership moved to another organization ends it there just the same', async () => {
    const id = await account();
    const [m] = await rows('sys_member', { user_id: 'usr_owner', organization_id: ORG });
    await engine.update('sys_member', { id: m.id, organization_id: 'org_c' }, SYSTEM);
    expect((await userRow(id)).banned).toBe(true);
  });

  it('an account already suspended keeps its own reason', async () => {
    const id = await account();
    await suspend(ADMIN, { userId: id, reason: 'Runaway loop' });
    await engine.delete('sys_member', { where: { user_id: 'usr_owner', organization_id: ORG }, multi: true, ...SYSTEM });
    expect((await userRow(id)).ban_reason).toBe(`${SERVICE_ACCOUNT_SUSPENDED_REASON}: Runaway loop`);
  });
});

describe('a directory deactivation of the owner suspends the accounts, and resume waits for the owner', () => {
  const directoryDeactivate = (userId: string) =>
    engine.update('sys_user', { id: userId, banned: true, ban_reason: SCIM_DEACTIVATION_BAN_REASON, ban_expires: null }, SYSTEM);
  const directoryReactivate = (userId: string) =>
    engine.update('sys_user', { id: userId, banned: false, ban_reason: null, ban_expires: null }, SYSTEM);
  const SUSPENDED_BY_DIRECTORY = { banned: true, ban_reason: SERVICE_ACCOUNT_OWNER_DEACTIVATED_REASON };

  it('every account the owner is accountable for is suspended with its own reason, in every organization; another owner\'s is not', async () => {
    const here = await account();
    const r = await runRegisterServiceAccount(deps(), OTHER_ADMIN, post({ name: 'Elsewhere bot', ownerId: 'usr_owner' }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const elsewhere = String(r.body.data!.userId);
    const other = await runRegisterServiceAccount(deps(), ADMIN, post({ name: 'Member bot', ownerId: 'usr_member' }));
    const others = String(other.body.data!.userId);

    const outcome = await suspendAccountsOfDirectoryDeactivatedOwner(dataEngine() as unknown as ServiceAccountOwnerLeavesEngine, 'usr_owner');
    expect(isOwnedAccountSuspensionComplete(outcome)).toBe(true);
    expect([...outcome.suspended].sort()).toEqual([here, elsewhere].sort());
    expect(await userRow(here)).toMatchObject(SUSPENDED_BY_DIRECTORY);
    expect(await userRow(elsewhere)).toMatchObject(SUSPENDED_BY_DIRECTORY);
    expect((await userRow(others)).banned).not.toBe(true);
  });

  it('an account already suspended keeps its own reason, and a second pass writes nothing', async () => {
    const id = await account();
    await suspend(ADMIN, { userId: id, reason: 'Runaway loop' });
    const outcome = await suspendAccountsOfDirectoryDeactivatedOwner(dataEngine() as unknown as ServiceAccountOwnerLeavesEngine, 'usr_owner');
    expect(outcome.suspended).toEqual([]);
    expect((await userRow(id)).ban_reason).toBe(`${SERVICE_ACCOUNT_SUSPENDED_REASON}: Runaway loop`);
  });

  it('resume is refused while the owner is deactivated, by an organization administrator and a platform administrator alike', async () => {
    const id = await account();
    await directoryDeactivate('usr_owner');
    await suspendAccountsOfDirectoryDeactivatedOwner(dataEngine() as unknown as ServiceAccountOwnerLeavesEngine, 'usr_owner');
    for (const by of [ADMIN, PLATFORM]) {
      const refused = await resume(by, id);
      expect(refused).toMatchObject(CONFLICT);
      expect(JSON.stringify(refused.body)).toMatch(/deactivated by the organization's directory/);
    }
    expect(await userRow(id)).toMatchObject(SUSPENDED_BY_DIRECTORY);
  });

  it('after the re-activation an organization administrator resumes it, keeping the owner', async () => {
    const id = await account();
    const k = await keyOf(id);
    await directoryDeactivate('usr_owner');
    await suspendAccountsOfDirectoryDeactivatedOwner(dataEngine() as unknown as ServiceAccountOwnerLeavesEngine, 'usr_owner');
    await directoryReactivate('usr_owner');
    expect(await userRow(id), 'a re-activation of the owner resumes nothing').toMatchObject(SUSPENDED_BY_DIRECTORY);
    expect(await resume(ADMIN, id)).toMatchObject({ status: 200, body: { data: { suspended: false } } });
    expect(await userRow(id)).toMatchObject({ banned: false, ban_reason: null });
    expect((await keyRow(k)).revoked, 'nothing was revoked: the same key works again').toBe(false);
  });

  it('or a new owner is named while the old one stays deactivated, and then it resumes', async () => {
    const id = await account();
    await directoryDeactivate('usr_owner');
    await suspendAccountsOfDirectoryDeactivatedOwner(dataEngine() as unknown as ServiceAccountOwnerLeavesEngine, 'usr_owner');
    expect((await setOwner(ADMIN, id, 'usr_member')).status).toBe(200);
    expect((await resume(ADMIN, id)).status).toBe(200);
  });

  it('a suspension write that is refused is counted, and the outcome names it', async () => {
    const id = await account();
    const refusing = {
      ...dataEngine(),
      update: (...args: Parameters<ObjectQL['update']>) => {
        if (args[0] === 'sys_user' && (args[1] as { id?: unknown }).id === id) return Promise.reject(new Error('write refused (test)'));
        return engine.update(...args);
      },
    };
    const outcome = await suspendAccountsOfDirectoryDeactivatedOwner(refusing as unknown as ServiceAccountOwnerLeavesEngine, 'usr_owner');
    expect(isOwnedAccountSuspensionComplete(outcome)).toBe(false);
    expect(outcome.failed.map((f) => f.accountId)).toEqual([id]);
    expect(directoryDeactivatedOwnerSuspensionIncompleteMessage('usr_owner', outcome)).toMatch(/INCOMPLETE .* 1 AI service account\(s\) .* could not be suspended/);
    expect((await userRow(id)).banned).not.toBe(true);
  });
});
