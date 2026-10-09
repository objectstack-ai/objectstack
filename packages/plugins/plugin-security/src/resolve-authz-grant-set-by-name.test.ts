// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D4] The authorization resolver (`resolveUserAuthzGrants`,
 * `@objectstack/core`) finds a user grant's permission set BY NAME, on a real
 * ObjectQL engine over the SQL driver with the real `SecurityPlugin` — the
 * driver's tenant scope and the write hooks included, which the core suite's
 * recording double answers for neither of.
 *
 * - **Another organization's set.** A grant whose id names another
 *   organization's set row confers nothing, whether it is left unnamed (what
 *   the write hook and the backfill leave it) or carries that set's name (what
 *   the hook could write before it judged the set row's organization).
 * - **An unnamed grant** confers nothing through the resolver, and its id
 *   still restricts where it restricted: the organization-administrator
 *   reconcile still revokes it through its id.
 * - **The upgrade boot.** Grants stored before the name column existed are
 *   unnamed until the one-time backfill at `kernel:bootstrapped` names them.
 *   No request reaches the resolver before then: the HTTP socket opens at
 *   `kernel:listening`, strictly after every `kernel:bootstrapped` handler,
 *   and by then the grant confers again. A `kernel:ready` handler — boot code,
 *   never a request — still sees it unnamed.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { LiteKernel, resetPlatformAdminEmailMemo, resolveUserAuthzGrants } from '@objectstack/core';
import { SysUser, SysAccount, SysMember, SysOrganization } from '@objectstack/platform-objects/identity';
import { SysMigration } from '@objectstack/platform-objects/system';

import { SecurityPlugin } from './security-plugin.js';
import { bootstrapPlatformAdmin } from './bootstrap-platform-admin.js';
import { reconcileOrgAdminGrant } from './auto-org-admin-grant.js';
import { SysPosition } from './objects/sys-position.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import { SysPositionPermissionSet } from './objects/sys-position-permission-set.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import {
  registerGrantPermissionSetNameHooks,
  unregisterGrantPermissionSetNameHooks,
} from './grant-permission-set-name.js';

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
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
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
  unregisterGrantPermissionSetNameHooks(engine);
  try {
    await engine.insert('sys_user_permission_set', row, { context: SYS } as any);
  } finally {
    registerGrantPermissionSetNameHooks(engine);
  }
}

async function grant(engine: Engine, id: string): Promise<Record<string, any> | null> {
  return (await engine.findOne('sys_user_permission_set', { where: { id }, context: SYS })) as any;
}

describe('[ADR-0131 D4] a grant whose id names another organization’s set confers nothing through the resolver', () => {
  async function world(): Promise<Engine> {
    const engine = await boot({ walled: true });
    await insertUser(engine, 'usr_x');
    await engine.insert('sys_permission_set',
      { id: 'ps_b_tools', name: 'b_tools', label: 'B tools', system_permissions: '["cap_b"]', active: true },
      { context: { isSystem: true, tenantId: ORG_B } } as any);
    return engine;
  }

  it('left unnamed (what the write hook and the backfill leave it): nothing, in either organization or none', async () => {
    const engine = await world();
    await insertGrantUnhooked(engine, { id: 'g_x', user_id: 'usr_x', permission_set_id: 'ps_b_tools', organization_id: null });
    for (const tenantId of [undefined, ORG_A, ORG_B]) {
      const out = await resolveUserAuthzGrants(engine, 'usr_x', tenantId ? { tenantId } : {});
      expect(out.permissions, String(tenantId)).not.toContain('b_tools');
      expect(out.systemPermissions, String(tenantId)).not.toContain('cap_b');
    }
  });

  it('carrying that set’s name: nothing either — no row the grant may name bears it', async () => {
    const engine = await world();
    await insertGrantUnhooked(engine, {
      id: 'g_y', user_id: 'usr_x', permission_set_id: 'ps_b_tools', permission_set: 'b_tools', organization_id: null,
    });
    await insertGrantUnhooked(engine, {
      id: 'g_z', user_id: 'usr_x', permission_set_id: 'ps_b_tools', permission_set: 'b_tools', organization_id: ORG_A,
    });
    for (const tenantId of [undefined, ORG_A, ORG_B]) {
      const out = await resolveUserAuthzGrants(engine, 'usr_x', tenantId ? { tenantId } : {});
      expect(out.permissions, String(tenantId)).not.toContain('b_tools');
      expect(out.systemPermissions, String(tenantId)).not.toContain('cap_b');
    }
  });

  it('CONTROL — an organization’s own grant of that set confers it, in that organization only', async () => {
    const engine = await world();
    await engine.insert('sys_user_permission_set',
      { id: 'g_own', user_id: 'usr_x', permission_set_id: 'ps_b_tools', organization_id: ORG_B },
      { context: SYS } as any);
    expect((await grant(engine, 'g_own'))?.permission_set).toBe('b_tools');
    expect((await resolveUserAuthzGrants(engine, 'usr_x', { tenantId: ORG_B })).systemPermissions).toContain('cap_b');
    expect((await resolveUserAuthzGrants(engine, 'usr_x', { tenantId: ORG_A })).systemPermissions).not.toContain('cap_b');
  });
});

describe('[ADR-0131 D4] an unnamed grant confers nothing through the resolver; its id still restricts', () => {
  it('an unnamed organization-administrator grant confers nothing, and the reconcile still revokes it through its id', async () => {
    const engine = await boot();
    await insertUser(engine, 'usr_admin');
    await insertUser(engine, 'usr_owner');
    await bootstrapPlatformAdmin(engine, defaultPermissionSets);
    await engine.insert('sys_organization', { id: ORG_A, name: 'A', slug: 'a' }, { context: SYS } as any);
    // A plain member holding an organization-administrator grant the backfill
    // has not named — what a demoted owner's left-behind grant looks like.
    await engine.insert('sys_member',
      { id: 'm_owner', user_id: 'usr_owner', organization_id: ORG_A, role: 'member' },
      { context: { isSystem: true, tenantId: ORG_A } } as any);
    const [set] = (await engine.find('sys_permission_set', {
      where: { name: 'organization_admin_no_bypass', organization_id: null }, context: SYS,
    })) as any[];
    await insertGrantUnhooked(engine, { id: 'g_oa', user_id: 'usr_owner', permission_set_id: set.id, organization_id: ORG_A });

    const out = await resolveUserAuthzGrants(engine, 'usr_owner', { tenantId: ORG_A });
    expect(out.permissions).not.toContain('organization_admin_no_bypass');
    expect(out.posture).toBe('MEMBER');

    const demotion = await reconcileOrgAdminGrant(engine, 'usr_owner', ORG_A, { posture: 'single' });
    expect(demotion.action).toBe('revoked');
    expect(await grant(engine, 'g_oa')).toBeNull();
  });
});

describe('[ADR-0131 D4] the upgrade boot — no request reaches the resolver before the backfill names the grants', () => {
  it('a grant stored before the name column: unnamed at kernel:ready, named and conferring at kernel:listening', async () => {
    const engine = await newEngine();
    for (const ps of defaultPermissionSets) {
      engine.registry.registerItem('permission', structuredClone(ps) as any, 'name' as any, CATALOG_PACKAGE);
    }
    engine.registry.registerItem(
      'permission', { name: 'upgrade_reviewer', label: 'Reviewer', objects: {} } as any, 'name' as any, CATALOG_PACKAGE,
    );
    // Stored before this boot: the set row, and a grant with no name.
    await engine.insert('sys_permission_set',
      { id: 'ps_up', name: 'upgrade_reviewer', label: 'Reviewer', system_permissions: '["cap_review"]', active: true },
      { context: SYS } as any);
    await insertUser(engine, 'usr_member');
    await engine.insert('sys_user_permission_set',
      { id: 'g_up', user_id: 'usr_member', permission_set_id: 'ps_up' },
      { context: SYS } as any);
    expect((await grant(engine, 'g_up'))?.permission_set).toBeNull();

    const seen: Record<string, string[]> = {};
    const metadata = {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [...defaultPermissionSets],
    };
    const kernel = new LiteKernel({ logger: { level: 'silent' } });
    kernel.use({
      name: 'com.objectstack.engine.objectql',
      init: async (ctx: any) => {
        ctx.registerService('objectql', engine);
        ctx.registerService('metadata', metadata);
        ctx.registerService('manifest', { register: () => undefined });
      },
      start: async () => undefined,
    } as any);
    kernel.use(new SecurityPlugin({ fallbackPermissionSet: 'member_default' }));
    // Registered after SecurityPlugin, so each of its handlers runs after
    // SecurityPlugin's own handler for the same hook.
    kernel.use({
      name: 'com.objectstack.qa.resolver-probe',
      dependencies: ['com.objectstack.security'],
      init: async () => undefined,
      start: async (ctx: any) => {
        const probe = (phase: string) => async () => {
          seen[phase] = (await resolveUserAuthzGrants(engine, 'usr_member', { bypassGrantsCache: true })).systemPermissions;
        };
        ctx.hook('kernel:ready', probe('ready'));
        ctx.hook('kernel:listening', probe('listening'));
      },
    } as any);
    try {
      await kernel.bootstrap();
      expect(seen.ready).not.toContain('cap_review');
      expect((await grant(engine, 'g_up'))?.permission_set).toBe('upgrade_reviewer');
      expect(seen.listening).toContain('cap_review');
    } finally {
      await kernel.shutdown();
    }
  });
});
