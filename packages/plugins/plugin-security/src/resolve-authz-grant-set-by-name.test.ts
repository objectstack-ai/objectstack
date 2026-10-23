// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D4] The authorization resolver (`resolveUserAuthzGrants`,
 * `@objectstack/core`) finds a user grant's permission set BY NAME, on a real
 * ObjectQL engine over the SQL driver with the real `SecurityPlugin` — the
 * driver's tenant scope and the write hooks included, which the core suite's
 * recording double answers for neither of.
 *
 * - **Another organization's set.** A grant of a set only another
 *   organization's row carries confers nothing, whether it is left unnamed or
 *   carries that set's name.
 * - **An unnamed grant** confers nothing through the resolver, and nothing
 *   reaches it through the retired `permission_set_id` any more (ADR-0131
 *   D10, C7b): the v18 ceremony's verified rewrite names such a grant, or
 *   blocks on it, before the column is dropped — the boot-time backfill that
 *   named it is retired, and so is its pin here (its duplicate is the
 *   ceremony's acceptance fixture, `organization-ownership-apply.test.ts`).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resetPlatformAdminEmailMemo, resolveUserAuthzGrants } from '@objectstack/core';
import { SysUser, SysAccount, SysMember, SysOrganization } from '@objectstack/platform-objects/identity';
import { SysMigration } from '@objectstack/platform-objects/system';

import { SecurityPlugin } from './security-plugin.js';
import { bootstrapPlatformAdmin } from './bootstrap-platform-admin.js';
import { seedLegacyPlatformBucket } from './__tests__/legacy-catalog-rows.testkit.js';
import { reconcileOrgAdminGrant } from './auto-org-admin-grant.js';
import { SysPosition } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';

const SYS = { isSystem: true } as const;
const POSTURE_ENV = 'OS_TENANCY_POSTURE';
const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';
const ORG_A = 'org_a';
const ORG_B = 'org_b';
const CATALOG_PACKAGE = 'com.objectstack.qa.resolve-authz-grant-set-by-name';

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

type Engine = ObjectQL;

async function newEngine(): Promise<Engine> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: CATALOG_PACKAGE,
    name: 'Resolver grant set by name',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysUser, SysAccount, SysMember, SysOrganization, SysMigration,
      SysPosition, SysUserPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPermissionSet,
    ],
  } as any);
  await engine.syncSchemas();
  // The organization-less rows below exist only on a store built before 18.x
  // (ADR-0131 D1 makes a fresh tenant column NOT NULL): this is that store.
  await relaxTenantColumns(engine, ['sys_permission_set', 'sys_user_permission_set']);
  engines.push(engine);
  vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);
  return engine;
}

/** An engine with the real `SecurityPlugin` started on it the way a composition does. */
async function boot(opts: { walled?: boolean } = {}): Promise<Engine> {
  if (opts.walled) process.env[POSTURE_ENV] = 'isolated';
  resetPlatformAdminEmailMemo();
  const engine = await newEngine();
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        type === 'permission'
          ? ([...defaultPermissionSets] as Array<{ name?: string }>).find((s) => s?.name === name) ?? null
          : engine.getSchema(name) ?? null,
      list: async () => [...defaultPermissionSets],
    },
    ...(opts.walled
      ? { 'org-scoping': { name: 'com.objectstack.org-scoping' }, tenancy: { posture: 'isolated' } }
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
  await plugin.start(ctx);
  return engine;
}

async function insertUser(engine: Engine, id: string): Promise<void> {
  await engine.insert('sys_user', { id, email: `${id}@rz.example`, name: id, email_verified: true }, { context: SYS } as any);
}

/**
 * A grant written with the name hooks unbound: with no name, a grant stored
 * before the column existed; with one, a name its set row does not justify —
 * what a write could store before the hook judged organizations.
 */
async function insertGrantUnhooked(engine: Engine, row: Record<string, unknown>): Promise<void> {
  // Beneath the engine: it refuses a grant naming nothing (ADR-0131 D4).
  const driver: any = (engine as any).getDriver('sys_user_permission_set');
  await driver.knex('sys_user_permission_set').insert({ permission_set: null, ...row });
}

async function grant(engine: Engine, id: string): Promise<Record<string, any> | null> {
  return (await engine.findOne('sys_user_permission_set', { where: { id }, context: SYS })) as any;
}

describe('[ADR-0131 D4] a grant of a set only another organization’s row carries confers nothing through the resolver', () => {
  async function world(): Promise<Engine> {
    const engine = await boot({ walled: true });
    await insertUser(engine, 'usr_x');
    await engine.insert('sys_permission_set',
      { id: 'ps_b_tools', name: 'b_tools', label: 'B tools', system_permissions: '["cap_b"]', active: true },
      { context: { isSystem: true, tenantId: ORG_B } } as any);
    return engine;
  }

  it('left unnamed: nothing, in either organization or none', async () => {
    const engine = await world();
    await insertGrantUnhooked(engine, { id: 'g_x', user_id: 'usr_x', organization_id: null });
    for (const tenantId of [undefined, ORG_A, ORG_B]) {
      const out = await resolveUserAuthzGrants(engine, 'usr_x', tenantId ? { tenantId } : {});
      expect(out.permissions, String(tenantId)).not.toContain('b_tools');
      expect(out.systemPermissions, String(tenantId)).not.toContain('cap_b');
    }
  });

  it('carrying that set’s name: nothing either — no row the grant may name bears it', async () => {
    const engine = await world();
    await insertGrantUnhooked(engine, {
      id: 'g_y', user_id: 'usr_x', permission_set: 'b_tools', organization_id: null,
    });
    await insertGrantUnhooked(engine, {
      id: 'g_z', user_id: 'usr_x', permission_set: 'b_tools', organization_id: ORG_A,
    });
    for (const tenantId of [undefined, ORG_A, ORG_B]) {
      const out = await resolveUserAuthzGrants(engine, 'usr_x', tenantId ? { tenantId } : {});
      expect(out.permissions, String(tenantId)).not.toContain('b_tools');
      expect(out.systemPermissions, String(tenantId)).not.toContain('cap_b');
    }
  });

  // [ADR-0131 D3/D4] The set is the catalog's definition of its name: a set
  // only an organization's ROW carries confers nothing, to that organization's
  // own grant too (#15196 Q3 A) — and declared, it confers.
  it('an organization’s own grant of a set only its row carries confers nothing, even in that organization', async () => {
    const engine = await world();
    await engine.insert('sys_user_permission_set',
      { id: 'g_own', user_id: 'usr_x', permission_set: 'b_tools', organization_id: ORG_B },
      { context: SYS } as any);
    expect((await grant(engine, 'g_own'))?.permission_set).toBe('b_tools');
    expect((await resolveUserAuthzGrants(engine, 'usr_x', { tenantId: ORG_B })).systemPermissions).not.toContain('cap_b');
  });

  it('CONTROL — the same grant of a set the catalog declares confers it, in that organization only', async () => {
    const engine = await world();
    engine.registry.registerItem('permission', { name: 'b_tools', systemPermissions: ['cap_b'] } as any, 'name' as any, CATALOG_PACKAGE);
    await engine.insert('sys_user_permission_set',
      { id: 'g_own', user_id: 'usr_x', permission_set: 'b_tools', organization_id: ORG_B },
      { context: SYS } as any);
    expect((await resolveUserAuthzGrants(engine, 'usr_x', { tenantId: ORG_B })).systemPermissions).toContain('cap_b');
    expect((await resolveUserAuthzGrants(engine, 'usr_x', { tenantId: ORG_A })).systemPermissions).not.toContain('cap_b');
  });
});

describe('[ADR-0131 D4/D10] an unnamed grant confers nothing through the resolver; no id reaches it', () => {
  it('an unnamed grant beside an organization-administrator membership confers nothing, and the reconcile neither grants through it nor reaches it', async () => {
    const engine = await boot();
    await insertUser(engine, 'usr_admin');
    await insertUser(engine, 'usr_owner');
    // An existing database: the platform-bucket rows an earlier release seeded.
    await seedLegacyPlatformBucket(engine, defaultPermissionSets);
    await bootstrapPlatformAdmin(engine, defaultPermissionSets);
    await engine.insert('sys_organization', { id: ORG_A, name: 'A', slug: 'a' }, { context: SYS } as any);
    // A plain member holding a grant that names nothing — a legacy row the v18
    // ceremony's rewrite has not named yet.
    await engine.insert('sys_member',
      { id: 'm_owner', user_id: 'usr_owner', organization_id: ORG_A, role: 'member' },
      { context: { isSystem: true, tenantId: ORG_A } } as any);
    await insertGrantUnhooked(engine, { id: 'g_oa', user_id: 'usr_owner', organization_id: ORG_A });

    const out = await resolveUserAuthzGrants(engine, 'usr_owner', { tenantId: ORG_A });
    expect(out.permissions).not.toContain('organization_admin_no_bypass');
    expect(out.posture).toBe('MEMBER');

    // The reconcile reads grants by name alone: for a plain member there is
    // nothing to revoke, and the unnamed row is the ceremony's, untouched.
    const demotion = await reconcileOrgAdminGrant(engine, 'usr_owner', ORG_A, { posture: 'single' });
    expect(demotion.action).not.toBe('revoked');
    expect(await grant(engine, 'g_oa')).toMatchObject({ id: 'g_oa', permission_set: null });
  });
});
