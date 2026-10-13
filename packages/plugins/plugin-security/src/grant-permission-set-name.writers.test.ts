// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D4/D10] Every grant writer in this package writes the grant's
 * permission set BY NAME and nothing else: `permission_set` carries the set's
 * machine name, `permission_set_id` stays empty, and no `sys_permission_set`
 * row is needed for the grant to be written or read back as the holder.
 *
 * Measured on a REAL `ObjectQL` engine over a real SQL driver, with NO
 * `SecurityPlugin` started on it — so what lands is exactly the writer's own
 * payload.
 *
 * The two writers: the platform-admin promotion (`bootstrapPlatformAdmin`, the
 * `single`-posture first-user grant) and the organization-admin reconcile
 * (`reconcileOrgAdminGrant`, walled and `single`), the latter on a database
 * holding ZERO `sys_permission_set` rows. plugin-auth's self-registration
 * grant and the verify RLS persona are pinned in their own packages.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';
import { SysUser, SysAccount, SysMember } from '@objectstack/platform-objects/identity';
import { bootstrapPlatformAdmin, findExistingPlatformAdmin } from './bootstrap-platform-admin.js';
import { reconcileOrgAdminGrant } from './auto-org-admin-grant.js';
import { SysPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const SYS = { isSystem: true } as const;
const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';

const engines: ObjectQL[] = [];
afterEach(async () => {
  delete process.env[OWNER_ENV];
  resetPlatformAdminEmailMemo();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.grant-writers',
    name: 'Grant writers',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysPermissionSet, SysUserPermissionSet, SysUser, SysAccount, SysMember],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);
  return engine;
}

/** The grant names its set and carries no legacy id. */
function expectNamedOnly(grant: any, expectedName: string): void {
  expect(grant?.permission_set).toBe(expectedName);
  expect(grant?.permission_set_id ?? null).toBeNull();
}

async function grantsOf(engine: ObjectQL, userId: string): Promise<any[]> {
  const rows = await engine.find('sys_user_permission_set', { where: { user_id: userId }, context: SYS });
  return Array.isArray(rows) ? rows : [];
}

describe('[ADR-0131 D4] the grant writers in plugin-security write the set by name alone', () => {
  it('the platform-admin promotion (single posture, first authenticable user)', async () => {
    resetPlatformAdminEmailMemo();
    const engine = await boot();
    await engine.insert(
      'sys_user',
      { id: 'usr_first', email: 'first@example.com', name: 'first', created_at: '2025-01-01T00:00:00.000Z', email_verified: true },
      { context: SYS } as any,
    );
    await engine.insert(
      'sys_account',
      { id: 'acc_first', user_id: 'usr_first', account_id: 'first@example.com', provider_id: 'credential' },
      { context: SYS } as any,
    );

    const result = await bootstrapPlatformAdmin(engine, defaultPermissionSets);
    expect(result.adminPromoted).toBe(true);

    const grants = await grantsOf(engine, 'usr_first');
    expect(grants).toHaveLength(1);
    expectNamedOnly(grants[0], 'admin_full_access');

    // [C3 stage 6b-2] The bootstrap wrote no catalog row, and the holder is
    // read by name with none.
    expect(await engine.find('sys_permission_set', { context: SYS })).toEqual([]);
    expect(await findExistingPlatformAdmin(engine, defaultPermissionSets)).toBe('usr_first');
  });

  for (const [posture, setName] of [
    ['isolated', 'organization_admin'],
    ['single', 'organization_admin_no_bypass'],
  ] as const) {
    it(`the organization-admin reconcile (${posture} posture grants ${setName})`, async () => {
      const engine = await boot();
      // ZERO `sys_permission_set` rows: the grant names its set (ADR-0131 D4).
      await engine.insert(
        'sys_member',
        { id: 'm1', user_id: 'u_owner', organization_id: 'o1', role: 'owner', created_at: new Date().toISOString() },
        { context: SYS } as any,
      );

      const result = await reconcileOrgAdminGrant(engine, 'u_owner', 'o1', { posture });
      expect(result.action).toBe('granted');

      const grants = await grantsOf(engine, 'u_owner');
      expect(grants).toHaveLength(1);
      expectNamedOnly(grants[0], setName);
      expect(await engine.find('sys_permission_set', { context: SYS })).toEqual([]);
    });
  }
});
