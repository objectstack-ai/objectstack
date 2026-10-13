// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10103] The cross-organization grant bleed stays closed on the REAL
 * resolver.
 *
 * Cases 1–5 of this file pinned the per-organization materialization of the
 * permission-set catalog rows. That materialization retired with the
 * declared-permission seeder (ADR-0131 D3: the boot writes no catalog row, and
 * every organization reads the same registry), so they went with it. What
 * remains is the enforcement-plane half: an existing database still holds the
 * per-organization `everyone` copies and junction rows the retired seeders
 * wrote, and no organization's member may collect another organization's
 * binding through them.
 *
 * ## Why a real driver, and a real engine
 *
 * The defect lived in the interaction between a scope the ENGINE threads and a
 * predicate the DRIVER emits, so this case runs a real `SqlDriver` on
 * better-sqlite3 `:memory:` behind a real `ObjectQL`, and imports the REAL
 * `resolveUserAuthzGrants` from `@objectstack/core`. That import resolves
 * through the package's `exports` to core's `dist/`, so core must be BUILT for
 * this case to mean anything; the suite's `pnpm test` run is preceded by a
 * dependency-closure build for exactly that reason.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveUserAuthzGrants } from '@objectstack/core';

import { SysPosition } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';

const ORG_JIA = 'org_jia';
const ORG_YI = 'org_yi';
const ORGS = [ORG_JIA, ORG_YI] as const;

const engines: ObjectQL[] = [];
afterEach(async () => {
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
    id: 'com.objectstack.per-org-catalog-10103',
    name: 'Per-org catalog',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet,
      SysUserPosition, SysUserPermissionSet, SysOrganization,
      // Registered so the resolver's own reads SUCCEED. `tryFind` swallows a
      // failed read into `[]`, so an unregistered table would make case 6's
      // negative assertion pass for the wrong reason — nothing resolving at
      // all rather than the sweep being scoped. Its positive control catches
      // that too, but a fixture that makes the resolver work is the better
      // instrument.
      SysUser, SysMember,
    ],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);
  for (const org of ORGS) {
    await (engine as any).insert('sys_organization', { id: org, name: org }, { context: { isSystem: true } });
  }
  return engine;
}

/** Ground truth: every stored row, straight off knex, past all tenancy. */
async function stored(engine: ObjectQL, table: string): Promise<any[]> {
  const driver: any = (engine as any).getDriver(table);
  return driver.knex(table).select('*');
}

const orgOf = (r: any): string | null => (r.organization_id ?? null);

describe('[#10103] per-organization RBAC catalog — the resolver', () => {
  it('6. the cross-organization grant bleed is closed: the REAL resolver collects no organization’s junction binding', async () => {
    const engine = await boot();
    // [ADR-0131 D2] No boot seeder writes `everyone` rows any more; an existing
    // database still holds the per-organization copies the retired seeder
    // wrote, and that is what an admin's junction row points at.
    for (const org of ORGS) {
      await (engine as any).insert('sys_position',
        { id: `pos_everyone_${org}`, name: 'everyone', label: 'Everyone', managed_by: 'platform' },
        { context: { isSystem: true, tenantId: org } });
    }

    const positions = await stored(engine, 'sys_position');
    const everyoneOf = (org: string) => positions.find((r) => r.name === 'everyone' && orgOf(r) === org);
    const jiaEveryone = everyoneOf(ORG_JIA);
    const yiEveryone = everyoneOf(ORG_YI);
    expect(jiaEveryone?.id).toBeTruthy();
    expect(yiEveryone?.id).toBeTruthy();
    expect(jiaEveryone.id).not.toBe(yiEveryone.id);

    // org_jia's admin binds a private set to org_jia's own `everyone`.
    await (engine as any).insert('sys_permission_set',
      { id: 'ps_jia_secret', name: 'jia_wide_grant', label: 'Jia', active: true },
      { context: { isSystem: true, tenantId: ORG_JIA } });
    await (engine as any).insert('sys_position_permission_set',
      { id: 'pps_jia', position_id: jiaEveryone.id, permission_set_id: 'ps_jia_secret' },
      { context: { isSystem: true, tenantId: ORG_JIA } });

    // A member of org_yi resolves. `everyone` is implicit for every
    // authenticated member (ADR-0090 D5), so this is the ordinary path, not a
    // contrived one — and it is the path that used to sweep `sys_position` by
    // name across every organization and pick up org_jia's binding.
    const yiGrants = await resolveUserAuthzGrants(engine as any, 'u_yi', { tenantId: ORG_YI });
    expect(yiGrants.permissions).not.toContain('jia_wide_grant');

    // [ADR-0131 D3/D4] …and org_jia's own member does not get it either: the
    // resolver reads a position's sets from its catalog definition, so a
    // junction row binds nothing anywhere (#15196 Q3 A).
    await (engine as any).insert('sys_user_position',
      { id: 'up_jia', user_id: 'u_jia', position: 'everyone' },
      { context: { isSystem: true, tenantId: ORG_JIA } });
    const jiaGrants = await resolveUserAuthzGrants(engine as any, 'u_jia', { tenantId: ORG_JIA });
    expect(jiaGrants.permissions).not.toContain('jia_wide_grant');

    // Positive control on the same resolver, from the same fixture: a set the
    // `everyone` DEFINITION names reaches both organizations' members. Without
    // it the assertions above would pass on a resolver that had simply stopped
    // resolving anything.
    bindTestSecurityCatalog(engine, {
      positions: [{ name: 'everyone', permissionSets: ['jia_wide_grant'] }],
      permissions: [{ name: 'jia_wide_grant' }],
    });
    for (const [user, org] of [['u_yi', ORG_YI], ['u_jia', ORG_JIA]] as const) {
      expect((await resolveUserAuthzGrants(engine as any, user, { tenantId: org })).permissions).toContain('jia_wide_grant');
    }
  });
});
