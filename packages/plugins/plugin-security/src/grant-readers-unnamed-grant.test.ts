// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D4] The grant that names nothing, as each `plugin-security` grant
 * reader treats it once the readers key on `sys_user_permission_set.permission_set`.
 *
 * Such a grant is real state: a grant written before the name column existed
 * carries `NULL` until the one-time backfill names it, and the backfill runs at
 * `kernel:bootstrapped` — after the `kernel:ready` passes (the platform-admin
 * bootstrap, the organization-admin backfill) that read grants. On an upgraded
 * deployment's first boot every grant is unnamed when those passes run. The
 * backfill also leaves a grant unnamed for good when its id names no set row,
 * or a set row of another organization.
 *
 * Each reader takes its fail-closed direction:
 *
 * - **explain** reports nothing about it — it names no set;
 * - **the platform-admin bootstrap** reads an unscoped one on the admin set row
 *   as an administrator who may already exist, and withholds the promotion —
 *   without naming it as the holder;
 * - **the organization-administrator reconcile** still reaches it through its
 *   id to revoke it, and never inserts a duplicate beside it.
 *
 * Real ObjectQL over the SQL driver with the real `SecurityPlugin`; a grant is
 * unnamed by writing `NULL` with the name hooks unbound, the state the backfill
 * leaves, then the hooks are bound again.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';
import { SysUser, SysAccount, SysMember, SysOrganization } from '@objectstack/platform-objects/identity';

import { SecurityPlugin } from './security-plugin.js';
import { bootstrapPlatformAdmin, findExistingPlatformAdmin } from './bootstrap-platform-admin.js';
import { backfillOrgAdminGrants, reconcileOrgAdminGrant } from './auto-org-admin-grant.js';
import { buildContextForUser } from './explain-engine.js';
import {
  GRANT_SET_NAME_HOOK_PACKAGE,
  registerGrantPermissionSetNameHooks,
} from './grant-permission-set-name.js';
import { SysPosition } from './objects/sys-position.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import { SysPositionPermissionSet } from './objects/sys-position-permission-set.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const SYS = { isSystem: true } as const;
const ORG = 'org_un';
const orgCtx = { isSystem: true, tenantId: ORG };

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  resetPlatformAdminEmailMemo();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(): Promise<ObjectQL> {
  resetPlatformAdminEmailMemo();
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.grant-readers-unnamed',
    name: 'Grant readers — unnamed grant',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysUser, SysAccount, SysMember, SysOrganization,
      SysPosition, SysUserPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPermissionSet,
    ],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [...defaultPermissionSets],
    },
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
  await plugin.start(ctx);
  vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);
  await engine.insert('sys_organization', { id: ORG, name: 'Unnamed Org', slug: 'un' }, { context: SYS } as any);
  return engine;
}

async function user(engine: ObjectQL, id: string, createdAt: string): Promise<void> {
  await engine.insert(
    'sys_user', { id, email: `${id}@un.example`, name: id, created_at: createdAt, email_verified: true }, { context: SYS } as any,
  );
  await engine.insert(
    'sys_account', { id: `acc_${id}`, user_id: id, account_id: `${id}@un.example`, provider_id: 'credential' },
    { context: SYS } as any,
  );
}

const setIdOf = async (engine: ObjectQL, name: string): Promise<string> =>
  String(((await engine.find('sys_permission_set', { where: { name, organization_id: null }, context: SYS })) as any[])[0]?.id);

/** The state the backfill leaves on a grant it has not named: `NULL`, written with the name hooks unbound. */
async function unname(engine: ObjectQL, where: Record<string, unknown>): Promise<void> {
  (engine as any).unregisterHooksByPackage(GRANT_SET_NAME_HOOK_PACKAGE);
  await engine.update('sys_user_permission_set', { permission_set: null }, { where, multi: true, context: SYS } as any);
  registerGrantPermissionSetNameHooks(engine as any);
  const rows = (await engine.find('sys_user_permission_set', { where, context: SYS })) as any[];
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => r.permission_set == null)).toBe(true);
}

const grantsOf = async (engine: ObjectQL, userId: string): Promise<any[]> =>
  (await engine.find('sys_user_permission_set', { where: { user_id: userId }, context: SYS })) as any[];

describe('[ADR-0131 D4] a grant that names nothing — explain', () => {
  it('reports no dropped grant for it: an unnamed grant names no set to report', async () => {
    const engine = await boot();
    await bootstrapPlatformAdmin(engine, defaultPermissionSets);
    await user(engine, 'usr_member', '2025-03-01T00:00:00.000Z');
    await engine.insert('sys_permission_set', { id: 'ps_off', name: 'legacy_reports', label: 'Legacy', active: false }, { context: SYS } as any);
    await engine.insert('sys_user_permission_set', [
      { id: 'g_off', user_id: 'usr_member', permission_set_id: 'ps_off', organization_id: ORG },
      {
        id: 'g_expired', user_id: 'usr_member', permission_set_id: await setIdOf(engine, 'viewer_readonly'),
        organization_id: ORG, valid_until: '2020-01-01T00:00:00.000Z',
      },
    ], { context: orgCtx } as any);

    const named = await buildContextForUser(engine, 'usr_member', Date.now(), ORG);
    expect(named.droppedGrants.map((g: any) => `${g.state}:${g.name}`).sort())
      .toEqual(['deactivated:legacy_reports', 'expired:viewer_readonly']);

    await unname(engine, { user_id: 'usr_member' });
    const unnamed = await buildContextForUser(engine, 'usr_member', Date.now(), ORG);
    expect(unnamed.droppedGrants).toEqual([]);
  });
});

describe('[ADR-0131 D4] a grant that names nothing — the platform-admin bootstrap (single)', () => {
  /**
   * The upgraded deployment's first boot: an administrator stands, through a
   * grant the backfill has not named yet, and an OLDER account exists that the
   * age rule would otherwise promote.
   */
  async function standingAdminUnnamed(): Promise<ObjectQL> {
    const engine = await boot();
    expect((await bootstrapPlatformAdmin(engine, defaultPermissionSets)).reason).toBe('no_users');
    await user(engine, 'usr_oldest', '2024-01-01T00:00:00.000Z');
    await user(engine, 'usr_admin', '2025-01-01T00:00:00.000Z');
    await engine.insert(
      'sys_user_permission_set',
      { id: 'g_admin', user_id: 'usr_admin', permission_set_id: await setIdOf(engine, 'admin_full_access') },
      { context: SYS } as any,
    );
    expect((await grantsOf(engine, 'usr_admin'))[0]?.permission_set).toBe('admin_full_access');
    return engine;
  }

  it('control — named, the grant is the holder: no promotion, and it names the claim target', async () => {
    const engine = await standingAdminUnnamed();
    const report = await bootstrapPlatformAdmin(engine, defaultPermissionSets);
    expect(report).toMatchObject({ adminPromoted: false, reason: 'already_have_admin', adminUserId: 'usr_admin' });
    expect(await findExistingPlatformAdmin(engine, defaultPermissionSets)).toBe('usr_admin');
  });

  it('unnamed, the promotion is WITHHELD — no second unscoped grant is minted for the oldest account', async () => {
    const engine = await standingAdminUnnamed();
    await unname(engine, { id: 'g_admin' });
    const report = await bootstrapPlatformAdmin(engine, defaultPermissionSets);
    expect(report.adminPromoted).toBe(false);
    expect(report.reason).toBe('admin_grant_unnamed');
    expect(report.adminUserId).toBeUndefined();
    expect(await grantsOf(engine, 'usr_oldest')).toEqual([]);
  });

  it('unnamed, it names no claim target — it restricts, it confers nothing', async () => {
    const engine = await standingAdminUnnamed();
    await unname(engine, { id: 'g_admin' });
    expect(await findExistingPlatformAdmin(engine, defaultPermissionSets)).toBeUndefined();
  });
});

describe('[ADR-0131 D4] a grant that names nothing — the organization-administrator reconcile', () => {
  async function orgAdmin(): Promise<ObjectQL> {
    const engine = await boot();
    await bootstrapPlatformAdmin(engine, defaultPermissionSets);
    await user(engine, 'usr_orgadmin', '2025-02-01T00:00:00.000Z');
    await engine.insert(
      'sys_member',
      { id: 'm_owner', user_id: 'usr_orgadmin', organization_id: ORG, role: 'owner', created_at: '2025-02-01T00:00:00.000Z' },
      { context: orgCtx } as any,
    );
    // The owner membership's write reconciles on its own; this call makes sure.
    await reconcileOrgAdminGrant(engine, 'usr_orgadmin', ORG);
    const granted = await grantsOf(engine, 'usr_orgadmin');
    expect(granted.map((g) => g.permission_set)).toEqual(['organization_admin_no_bypass']);
    await unname(engine, { user_id: 'usr_orgadmin' });
    return engine;
  }

  it('a qualifying pair holding it is not handed a duplicate grant', async () => {
    const engine = await orgAdmin();
    expect(await reconcileOrgAdminGrant(engine, 'usr_orgadmin', ORG)).toEqual({ action: 'noop' });
    expect(await grantsOf(engine, 'usr_orgadmin')).toHaveLength(1);
  });

  it('a demotion still revokes it — reached through its id', async () => {
    const engine = await orgAdmin();
    await engine.update('sys_member', { id: 'm_owner', role: 'member' }, { context: orgCtx } as any);
    await reconcileOrgAdminGrant(engine, 'usr_orgadmin', ORG);
    expect(await grantsOf(engine, 'usr_orgadmin')).toEqual([]);
  });

  it('the boot backfill still revokes it once its pair has no membership left', async () => {
    const engine = await orgAdmin();
    await user(engine, 'usr_orphan', '2025-05-01T00:00:00.000Z');
    await engine.insert(
      'sys_user_permission_set',
      {
        id: 'g_orphan', user_id: 'usr_orphan', organization_id: ORG,
        permission_set_id: await setIdOf(engine, 'organization_admin_no_bypass'),
      },
      { context: orgCtx } as any,
    );
    await unname(engine, { id: 'g_orphan' });
    const summary = await backfillOrgAdminGrants(engine);
    expect(summary.revoked).toBe(1);
    expect(await grantsOf(engine, 'usr_orphan')).toEqual([]);
  });
});
