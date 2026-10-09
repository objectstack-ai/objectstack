// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D4] Grant-equivalence goldens for the `plugin-auth` grant readers
 * that key on `sys_user_permission_set.permission_set`, the grant's permission
 * set BY NAME, instead of `permission_set_id`.
 *
 * The readers change their key and not their answer. This suite boots a real
 * ObjectQL engine over the SQL driver with the real `SecurityPlugin` (its
 * objects, and the engine hooks that keep the grant's two columns in step) and
 * records the platform standing each reader in this package derives:
 *
 * - **the last-administrator guard** (`registerLastAdminGuard`), through the
 *   verdicts of the writes that probe its administrator enumeration: banning
 *   a member, banning every administrator at once, and — once the platform
 *   administrator is the only one left — revoking that standing by its grant
 *   row, by deactivating `admin_full_access`, or by banning the account;
 * - **the default-organization bootstrap** (`ensureDefaultOrganization`):
 *   which account it finds as the platform administrator and binds as owner.
 *
 * Principals: the platform administrator (`single`: the promoted first user, a
 * grant row; walled: the declared `OS_PLATFORM_OWNER_EMAIL` owner, no row), the
 * organization administrator (the owner membership), a member and an agent
 * (each holding a direct grant). Three postures: `single`, `group` and
 * `isolated`.
 *
 * The golden below was recorded on the tree BEFORE the readers moved to the
 * name (the PR record carries that run) and is unchanged after it. Pointing the
 * platform administrator's grant name column at a different set turns it red —
 * the PR record carries that ablation too.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';
import { SecurityPlugin, bootstrapPlatformAdmin, reconcileOrgAdminGrant } from '@objectstack/plugin-security';
import { SysUser, SysAccount, SysMember, SysOrganization } from '@objectstack/platform-objects/identity';

import { registerLastAdminGuard, type LastAdminGuardEngine } from './last-admin-guard.js';
import { ensureDefaultOrganization } from './ensure-default-organization.js';

const SYS = { isSystem: true } as const;
const POSTURE_ENV = 'OS_TENANCY_POSTURE';
const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';
const ORG = 'org_gra';
const FUTURE = '2099-01-01T00:00:00.000Z';

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env[POSTURE_ENV];
  delete process.env[OWNER_ENV];
  resetPlatformAdminEmailMemo();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

type Posture = 'single' | 'group' | 'isolated';

/** A write's verdict: `permitted`, or the refusal's code. */
async function verdict(write: () => Promise<unknown>): Promise<string> {
  try {
    await write();
    return 'permitted';
  } catch (e) {
    return `refused:${String((e as { code?: unknown })?.code ?? (e as Error)?.message)}`;
  }
}

async function standingByReader(posture: Posture): Promise<Record<string, unknown>> {
  const walled = posture !== 'single';
  if (walled) {
    process.env[POSTURE_ENV] = posture;
    process.env[OWNER_ENV] = 'admin@gra.example';
  }
  resetPlatformAdminEmailMemo();

  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engines.push(engine);

  // The SecurityPlugin's own manifest supplies its objects and bootstrap sets.
  let manifest: { objects?: unknown[]; permissions?: unknown[] } = {};
  const services: Record<string, unknown> = {
    manifest: { register: (m: any) => { manifest = m; } },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [...((manifest.permissions as unknown[]) ?? [])],
    },
    ...(walled
      ? { 'org-scoping': { name: 'com.objectstack.org-scoping' }, tenancy: { posture } }
      : {}),
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    hook: vi.fn(),
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx);
  const securityObjects = (manifest.objects ?? []).filter((o: any) =>
    ['sys_position', 'sys_user_position', 'sys_permission_set', 'sys_position_permission_set', 'sys_user_permission_set']
      .includes(o?.name));
  engine.registerApp({
    id: 'com.objectstack.qa.grant-readers-by-name-auth',
    name: 'Grant readers by name (auth)',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysUser, SysAccount, SysMember, SysOrganization, ...securityObjects],
  } as any);
  await engine.syncSchemas();
  await plugin.start(ctx);
  vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);
  registerLastAdminGuard(engine as unknown as LastAdminGuardEngine, {
    packageId: 'test.grant-readers-by-name',
    logger: { info: () => undefined, warn: () => undefined },
  });
  const bootstrapSets = (manifest.permissions ?? []) as any[];

  const orgCtx = { isSystem: true, tenantId: ORG };
  await engine.insert('sys_organization', { id: ORG, name: 'GRA Org', slug: 'gra' }, { context: SYS } as any);
  const user = async (id: string, email: string, createdAt: string) => {
    await engine.insert(
      'sys_user', { id, email, name: id, created_at: createdAt, email_verified: true, banned: false }, { context: SYS } as any,
    );
    await engine.insert(
      'sys_account', { id: `acc_${id}`, user_id: id, account_id: email, provider_id: 'credential' }, { context: SYS } as any,
    );
  };
  await user('usr_admin', 'admin@gra.example', '2025-01-01T00:00:00.000Z');
  await user('usr_orgadmin', 'orgadmin@gra.example', '2025-02-01T00:00:00.000Z');
  await user('usr_member', 'member@gra.example', '2025-03-01T00:00:00.000Z');
  await user('usr_agent', 'agent@gra.example', '2025-04-01T00:00:00.000Z');

  const boot = await bootstrapPlatformAdmin(engine, bootstrapSets);
  expect(boot.adminPromoted).toBe(posture === 'single');
  if (walled) {
    for (const name of ['organization_admin', 'organization_admin_no_bypass']) {
      const [bucket] = await engine.find('sys_permission_set', { where: { name }, context: SYS });
      const { id: _id, created_at: _c, updated_at: _u, ...rest } = bucket as any;
      await engine.insert('sys_permission_set', { ...rest, id: `ps_${name}_${ORG}`, organization_id: ORG }, { context: orgCtx } as any);
    }
  }
  await engine.insert('sys_member', [
    { id: 'm_owner', user_id: 'usr_orgadmin', organization_id: ORG, role: 'owner', created_at: '2025-02-01T00:00:00.000Z' },
    { id: 'm_member', user_id: 'usr_member', organization_id: ORG, role: 'member', created_at: '2025-03-01T00:00:00.000Z' },
    { id: 'm_agent', user_id: 'usr_agent', organization_id: ORG, role: 'member', created_at: '2025-04-01T00:00:00.000Z' },
  ], { context: orgCtx } as any);
  expect((await reconcileOrgAdminGrant(engine, 'usr_orgadmin', ORG, { posture })).action).toBe('granted');
  const setId = async (name: string) =>
    String(((await engine.find('sys_permission_set', { where: { name, organization_id: null }, context: SYS })) as any[])[0]?.id);
  await engine.insert('sys_user_permission_set', [
    { id: 'ups_member_viewer', user_id: 'usr_member', permission_set_id: await setId('viewer_readonly'), organization_id: ORG },
    {
      id: 'ups_agent_read', user_id: 'usr_agent', permission_set_id: await setId('mcp_agent_data_read'),
      organization_id: ORG, valid_until: FUTURE,
    },
  ], { context: orgCtx } as any);

  // The default-organization bootstrap: which account it finds as the
  // platform administrator, and binds as the owner of the Default Organization.
  const defaultOrg = await ensureDefaultOrganization(engine as any, {
    logger: { info: () => undefined, warn: () => undefined },
  });
  const defaultOwners = defaultOrg.defaultOrgId
    ? ((await engine.find('sys_member', {
      where: { organization_id: defaultOrg.defaultOrgId, role: 'owner' },
      context: SYS,
    })) as any[]).map((m) => String(m.user_id)).sort()
    : [];

  // The last-administrator guard's enumeration, read through its verdicts.
  const sys = { context: SYS } as any;
  const guard: Record<string, string> = {};
  guard.banMember = await verdict(() => engine.update('sys_user', { id: 'usr_member', banned: true }, sys));
  guard.banEveryAdministrator = await verdict(() => engine.update(
    'sys_user', { banned: true }, { where: { id: { $in: ['usr_admin', 'usr_orgadmin'] } }, multi: true, ...sys },
  ));
  // The organization administrator steps down — the default-organization bind
  // above made the platform administrator an owner too, so that membership goes
  // as well; what remains is the platform administrator's own standing.
  guard.demoteOrganizationOwners = await verdict(() => engine.update(
    'sys_member', { role: 'member' }, { where: { role: 'owner' }, multi: true, ...sys },
  ));
  const [adminGrant] = (await engine.find('sys_user_permission_set', {
    where: { user_id: 'usr_admin', organization_id: null }, context: SYS,
  })) as any[];
  guard.revokeSoleAdministratorGrant = adminGrant
    ? await verdict(() => engine.delete('sys_user_permission_set', { where: { id: adminGrant.id }, ...sys }))
    : 'no-grant-row';
  const [adminSet] = (await engine.find('sys_permission_set', {
    where: { name: 'admin_full_access', organization_id: null }, context: SYS,
  })) as any[];
  guard.deactivateAdministratorSet = await verdict(() =>
    engine.update('sys_permission_set', { id: adminSet.id, active: false }, sys));
  guard.banSoleAdministrator = await verdict(() => engine.update('sys_user', { id: 'usr_admin', banned: true }, sys));

  return {
    defaultOrganization: {
      memberCreated: defaultOrg.memberCreated,
      reason: defaultOrg.reason ?? null,
      owners: defaultOwners,
    },
    lastAdminGuard: guard,
  };
}

describe('[ADR-0131 D4] grant readers by name (plugin-auth) — platform standing answers the recorded golden', () => {
  for (const posture of ['single', 'group', 'isolated'] as const) {
    it(`${posture}: the last-administrator guard and the default-organization bootstrap`, async () => {
      const actual = await standingByReader(posture);
      expect(actual).toEqual(GOLDEN[posture]);
    });
  }
});

/**
 * Recorded on the tree before the readers moved to the name; `group` and
 * `isolated` were recorded identical, so they share one literal. `single` and the two walled postures differ where platform standing does: under
 * `single` the platform administrator is a grant row, so revoking it or
 * deactivating `admin_full_access` takes the last administrator away and is
 * refused; under a wall the declared owner carries no grant row and outlives
 * the set's deactivation, so only banning the account itself is refused.
 */
const SINGLE: unknown = {
  defaultOrganization: { memberCreated: true, reason: null, owners: ['usr_admin'] },
  lastAdminGuard: {
    banMember: 'permitted',
    banEveryAdministrator: 'refused:PERMISSION_DENIED',
    demoteOrganizationOwners: 'permitted',
    revokeSoleAdministratorGrant: 'refused:PERMISSION_DENIED',
    deactivateAdministratorSet: 'refused:PERMISSION_DENIED',
    banSoleAdministrator: 'refused:PERMISSION_DENIED',
  },
};

const WALLED: unknown = {
  defaultOrganization: { memberCreated: true, reason: null, owners: ['usr_admin'] },
  lastAdminGuard: {
    banMember: 'permitted',
    banEveryAdministrator: 'refused:PERMISSION_DENIED',
    demoteOrganizationOwners: 'permitted',
    revokeSoleAdministratorGrant: 'no-grant-row',
    deactivateAdministratorSet: 'permitted',
    banSoleAdministrator: 'refused:PERMISSION_DENIED',
  },
};

const GOLDEN: Record<Posture, unknown> = { single: SINGLE, group: WALLED, isolated: WALLED };
