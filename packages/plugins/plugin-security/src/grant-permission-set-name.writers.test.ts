// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D4] Every grant writer in this package writes BOTH columns of
 * `sys_user_permission_set` — `permission_set_id` and `permission_set` — and
 * the two agree: the name is the `name` of the catalog row the id points at.
 *
 * Measured on a REAL `ObjectQL` engine over a real SQL driver, with NO
 * `SecurityPlugin` started on it — so the name hooks (`grant-permission-set-
 * name.ts`) are not bound and nothing stamps a name the writer left out. What
 * lands is exactly the writer's own payload, which is the thing pinned: a
 * writer that drops the name turns its case red here even though, in a full
 * composition, the hook would have filled the column behind it.
 *
 * The two writers: the platform-admin promotion (`bootstrapPlatformAdmin`, the
 * `single`-posture first-user grant) and the organization-admin reconcile
 * (`reconcileOrgAdminGrant`, walled and `single`). plugin-auth's
 * self-registration grant and the verify RLS persona are pinned in their own
 * packages.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';
import { SysUser, SysAccount, SysMember } from '@objectstack/platform-objects/identity';
import { bootstrapPlatformAdmin } from './bootstrap-platform-admin.js';
import { reconcileOrgAdminGrant } from './auto-org-admin-grant.js';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
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

/** The grant carries both columns, and the name is the name of the row its id points at. */
async function expectBothColumnsAgree(engine: ObjectQL, grant: any, expectedName: string): Promise<void> {
  expect(typeof grant?.permission_set_id).toBe('string');
  expect(grant?.permission_set).toBe(expectedName);
  const [setRow] = await engine.find('sys_permission_set', { where: { id: grant.permission_set_id }, context: SYS });
  expect(setRow?.name).toBe(grant.permission_set);
}

async function grantsOf(engine: ObjectQL, userId: string): Promise<any[]> {
  const rows = await engine.find('sys_user_permission_set', { where: { user_id: userId }, context: SYS });
  return Array.isArray(rows) ? rows : [];
}

describe('[ADR-0131 D4] the grant writers in plugin-security write both columns, and they agree', () => {
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
    await expectBothColumnsAgree(engine, grants[0], 'admin_full_access');
  });

  for (const [posture, setName] of [
    ['isolated', 'organization_admin'],
    ['single', 'organization_admin_no_bypass'],
  ] as const) {
    it(`the organization-admin reconcile (${posture} posture grants ${setName})`, async () => {
      const engine = await boot();
      const set = (id: string, name: string, organization_id?: string) => ({
        id, name, label: name, object_permissions: '{}', field_permissions: '{}', system_permissions: '[]', active: true,
        ...(organization_id ? { organization_id } : {}),
      });
      // The organization-less platform bucket, and (walled) the organization's own copies.
      await engine.insert('sys_permission_set', [
        set('ps_oa', 'organization_admin'),
        set('ps_oa_nb', 'organization_admin_no_bypass'),
        ...(posture === 'isolated'
          ? [set('ps_oa_o1', 'organization_admin', 'o1'), set('ps_oa_nb_o1', 'organization_admin_no_bypass', 'o1')]
          : []),
      ], { context: SYS } as any);
      await engine.insert(
        'sys_member',
        { id: 'm1', user_id: 'u_owner', organization_id: 'o1', role: 'owner', created_at: new Date().toISOString() },
        { context: SYS } as any,
      );

      const result = await reconcileOrgAdminGrant(engine, 'u_owner', 'o1', { posture });
      expect(result.action).toBe('granted');

      const grants = await grantsOf(engine, 'u_owner');
      expect(grants).toHaveLength(1);
      await expectBothColumnsAgree(engine, grants[0], setName);
      if (posture === 'isolated') expect(grants[0].permission_set_id).toBe('ps_oa_o1');
    });
  }
});
