// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D4] The grant that names nothing, as each `plugin-security` grant
 * reader treats it once the readers key on `sys_user_permission_set.permission_set`.
 *
 * Such a grant is real state on a database the v18 ceremony has not run on: a
 * grant written before the name column existed carries `NULL` until the
 * ceremony's verified rewrite (`os migrate organization-ownership --apply`,
 * ADR-0131 D10) names it from the legacy `permission_set_id`, a column no
 * runtime reader declares any more (C7b).
 *
 * Each reader takes its fail-closed direction:
 *
 * - **explain** reports nothing about it — it names no set;
 * - **the platform-admin bootstrap** reads a Default Organization one as an administrator
 *   who may already exist, and withholds the promotion — without naming it as
 *   the holder;
 * - **the organization-administrator reconcile** reads grants by name alone:
 *   it neither counts such a grant nor revokes it, and writes NOTHING for a
 *   qualifying pair holding one in that organization (the ceremony's rename
 *   needs its key); once the rewrite names it, the boot sweep revokes it where
 *   its pair no longer qualifies.
 *
 * Real ObjectQL over the SQL driver with the real `SecurityPlugin`; a grant is
 * unnamed by writing `NULL` beneath the engine.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';
import { SysUser, SysAccount, SysMember, SysOrganization } from '@objectstack/platform-objects/identity';
import { SysMetadataActivation } from '@objectstack/platform-objects/system';

import { SecurityPlugin } from './security-plugin.js';
import { bootstrapPlatformAdmin, findExistingPlatformAdmin } from './bootstrap-platform-admin.js';
import { seedLegacyPlatformBucket } from './__tests__/legacy-catalog-rows.testkit.js';
import { backfillOrgAdminGrants, reconcileOrgAdminGrant } from './auto-org-admin-grant.js';
import { buildContextForUser } from './explain-engine.js';
import { SysPosition } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { relaxEveryRegisteredTenantColumn } from './pre-18-tenant-column.testkit.js';

const SYS = { isSystem: true } as const;
const CATALOG_SETS: Array<{ name: string; label?: string }> = [...defaultPermissionSets, { name: 'legacy_reports', label: 'Legacy' }];
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
      // The activation ledger the explainer reads deactivation from (ADR-0131 D3).
      SysMetadataActivation,
    ],
  } as any);
  await engine.syncSchemas();
  // The organization-less rows below (global sets, positions, grants) exist only
  // on a store built before 18.x (ADR-0131 D1 makes a fresh tenant column NOT
  // NULL): this is that store.
  await relaxEveryRegisteredTenantColumn(engine);
  engines.push(engine);
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    // [ADR-0131 D3/D4] The security catalog: the platform's sets plus the
    // environment-authored `legacy_reports` the explain case grants.
    metadata: {
      get: async (type: string, name: string) =>
        (type === 'permission' ? CATALOG_SETS.find((p) => p.name === name) : engine.getSchema(name)) ?? null,
      list: async () => [...CATALOG_SETS],
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

const knexOf = (engine: ObjectQL): any => ((engine as any).getDriver('sys_user_permission_set') as any).knex;

/**
 * The state a grant written before the name column carries until the v18
 * ceremony's rewrite names it: a `NULL` name. Grants are written by name
 * today (ADR-0131 D4) and the engine refuses one naming nothing, so it is
 * written beneath it.
 */
async function unname(engine: ObjectQL, where: Record<string, unknown>): Promise<void> {
  await knexOf(engine)('sys_user_permission_set').where(where).update({ permission_set: null });
  const rows = (await engine.find('sys_user_permission_set', { where, context: SYS })) as any[];
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => r.permission_set == null)).toBe(true);
}

/** What the ceremony's verified rewrite does to such a grant: it names it. */
async function rename(engine: ObjectQL, id: string, name: string): Promise<void> {
  await knexOf(engine)('sys_user_permission_set').where({ id }).update({ permission_set: name });
}

const grantsOf = async (engine: ObjectQL, userId: string): Promise<any[]> =>
  (await engine.find('sys_user_permission_set', { where: { user_id: userId }, context: SYS })) as any[];

describe('[ADR-0131 D4] a grant that names nothing — explain', () => {
  it('reports no dropped grant for it: an unnamed grant names no set to report', async () => {
    const engine = await boot();
    // An existing database: the platform-bucket rows an earlier release seeded.
    await seedLegacyPlatformBucket(engine, defaultPermissionSets);
    await bootstrapPlatformAdmin(engine, defaultPermissionSets);
    await user(engine, 'usr_member', '2025-03-01T00:00:00.000Z');
    await engine.insert('sys_permission_set', { id: 'ps_off', name: 'legacy_reports', label: 'Legacy' }, { context: SYS } as any);
    // Switched off where the resolver and the explainer read it: the ledger.
    await engine.insert('sys_metadata_activation', {
      metadata_type: 'permission', name: 'legacy_reports', package_id: 'com.objectstack.qa.grant-readers-unnamed', active: false,
    }, { context: SYS } as any);
    await engine.insert('sys_user_permission_set', [
      { id: 'g_off', user_id: 'usr_member', permission_set: 'legacy_reports', organization_id: ORG },
      {
        id: 'g_expired', user_id: 'usr_member', permission_set: 'viewer_readonly',
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
    // An existing database: the platform-bucket rows an earlier release seeded.
    await seedLegacyPlatformBucket(engine, defaultPermissionSets);
    expect((await bootstrapPlatformAdmin(engine, defaultPermissionSets)).reason).toBe('no_users');
    await user(engine, 'usr_oldest', '2024-01-01T00:00:00.000Z');
    await user(engine, 'usr_admin', '2025-01-01T00:00:00.000Z');
    await engine.insert(
      'sys_user_permission_set',
      { id: 'g_admin', user_id: 'usr_admin', permission_set: 'admin_full_access' },
      { context: SYS } as any,
    );
    expect((await grantsOf(engine, 'usr_admin'))[0]?.permission_set).toBe('admin_full_access');
    return engine;
  }

  it('control — named, the grant is the holder: no promotion, and it names the claim target', async () => {
    const engine = await standingAdminUnnamed();
    // An existing database: the platform-bucket rows an earlier release seeded.
    await seedLegacyPlatformBucket(engine, defaultPermissionSets);
    const report = await bootstrapPlatformAdmin(engine, defaultPermissionSets);
    expect(report).toMatchObject({ adminPromoted: false, reason: 'already_have_admin', adminUserId: 'usr_admin' });
    expect(await findExistingPlatformAdmin(engine, defaultPermissionSets)).toBe('usr_admin');
  });

  it('unnamed, the promotion is WITHHELD — no second anchoring grant is minted for the oldest account', async () => {
    const engine = await standingAdminUnnamed();
    await unname(engine, { id: 'g_admin' });
    // An existing database: the platform-bucket rows an earlier release seeded.
    await seedLegacyPlatformBucket(engine, defaultPermissionSets);
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

  // The one wording pin on the withheld-promotion warning. It ends with the
  // ownership migration's id-to-name rewrite, which names the grant (the
  // ceremony is open, #24581); it never says to keep the database on 17.x.
  // Everything before the sentence is the warning's own: what is withheld, why,
  // and that this pass mints no second grant.
  const REWRITE_SENTENCE = 'The organization-ownership migration\'s id-to-name rewrite (ADR-0131 D10) names it; the next '
    + 'pass after that reads it by name.';

  it('unnamed, the withheld warning keeps what is withheld and why, and ends with the rewrite that names the grant', async () => {
    const engine = await standingAdminUnnamed();
    await unname(engine, { id: 'g_admin' });
    // An existing database: the platform-bucket rows an earlier release seeded.
    await seedLegacyPlatformBucket(engine, defaultPermissionSets);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const report = await bootstrapPlatformAdmin(engine, defaultPermissionSets, { logger });

    // Anti-vacuity: the pass took the unnamed-holder branch and logged its warning exactly once.
    expect(report).toMatchObject({ adminPromoted: false, reason: 'admin_grant_unnamed' });
    const withheld = logger.warn.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.startsWith('[security] platform-admin promotion WITHHELD'));
    expect(withheld).toHaveLength(1);
    const [message] = withheld;

    expect(message).toBe(
      '[security] platform-admin promotion WITHHELD: a Default Organization grant exists whose permission-set name '
      + '(sys_user_permission_set.permission_set) was never written — a grant from a release before that '
      + 'column existed. Which set it holds can no longer be read, and it may be the platform administrator\'s, '
      + 'so this pass will not mint a second one. ' + REWRITE_SENTENCE,
    );
    expect(message.endsWith(REWRITE_SENTENCE), 'the sentence closes the warning').toBe(true);
    expect(message).not.toMatch(/fresh installs only|on a 17\.x release|carries the upgrade path/);
  });
});

describe('[ADR-0131 D4] a grant that names nothing — the organization-administrator reconcile', () => {
  async function orgAdmin(): Promise<ObjectQL> {
    const engine = await boot();
    // An existing database: the platform-bucket rows an earlier release seeded.
    await seedLegacyPlatformBucket(engine, defaultPermissionSets);
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

  it('[Q-S3b (ii)] a qualifying pair holding it is written nothing — a named grant beside it would hold the key the ceremony\'s rename needs — and it confers nothing meanwhile', async () => {
    const engine = await orgAdmin();
    expect(await reconcileOrgAdminGrant(engine, 'usr_orgadmin', ORG)).toEqual({ action: 'skipped', reason: 'unnamed_grant_awaits_ceremony' });
    expect(await backfillOrgAdminGrants(engine)).toMatchObject({ granted: 0 });
    expect((await grantsOf(engine, 'usr_orgadmin')).map((g) => g.permission_set ?? null)).toEqual([null]);
  });

  it('a demotion does not reach it while it is unnamed; once the rewrite names it, the boot sweep revokes it', async () => {
    const engine = await orgAdmin();
    await engine.update('sys_member', { id: 'm_owner', role: 'member' }, { context: orgCtx } as any);
    await reconcileOrgAdminGrant(engine, 'usr_orgadmin', ORG);
    const [left] = await grantsOf(engine, 'usr_orgadmin');
    expect(left).toMatchObject({ permission_set: null });

    await rename(engine, String(left.id), 'organization_admin_no_bypass');
    await backfillOrgAdminGrants(engine);
    expect(await grantsOf(engine, 'usr_orgadmin')).toEqual([]);
  });

  it('the boot sweep does not reach it while its pair has no membership and it is unnamed; once named, it revokes it', async () => {
    const engine = await orgAdmin();
    await user(engine, 'usr_orphan', '2025-05-01T00:00:00.000Z');
    await engine.insert(
      'sys_user_permission_set',
      {
        id: 'g_orphan', user_id: 'usr_orphan', organization_id: ORG,
        permission_set: 'organization_admin_no_bypass',
      },
      { context: orgCtx } as any,
    );
    await unname(engine, { id: 'g_orphan' });
    expect((await backfillOrgAdminGrants(engine)).revoked).toBe(0);
    expect(await grantsOf(engine, 'usr_orphan')).toHaveLength(1);

    await rename(engine, 'g_orphan', 'organization_admin_no_bypass');
    expect((await backfillOrgAdminGrants(engine)).revoked).toBe(1);
    expect(await grantsOf(engine, 'usr_orphan')).toEqual([]);
  });
});
