// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10103] The RBAC catalog is materialized PER ORGANIZATION.
 *
 * ## What was measured, and why these cases exist
 *
 * On a walled deployment every principal — org owner and platform admin alike —
 * listed ZERO positions, permission sets and sharing rules while the tables held
 * rows. The rows were all organization-less: this plugin's Layer 0 composes a
 * strict `organization_id = :tenant`, the middleware ANDs it over the driver's
 * `(organization_id = :tenant OR organization_id IS NULL)`, and the conjunction
 * of the two is the strict equality alone. Nothing could be administered and a
 * declared `hierarchy-security` could never be armed.
 *
 * The repair does not touch the wall at either layer. It gives the rows an
 * owner. So every case here asserts about ROWS AND THEIR ORGANIZATION, through
 * the real shipped seeders, never about a wall predicate.
 *
 * ## Why a real driver, and a real engine
 *
 * The whole defect lives in the interaction between a scope the ENGINE threads
 * and a predicate the DRIVER emits. A hand-written engine double implements
 * neither, so it reports green on a `tenantId` the real stack never applies —
 * and it is precisely a double's silence that let the shipped behaviour read as
 * correct for as long as it did. These cases therefore run a real `SqlDriver` on
 * better-sqlite3 `:memory:` behind a real `ObjectQL`, and call the SHIPPED
 * seeder functions rather than re-implementing their upserts.
 *
 * `case 6` additionally imports the REAL `resolveUserAuthzGrants` from
 * `@objectstack/core` — the enforcement-plane half of this change — so the
 * cross-organization grant bleed is pinned against the shipped resolver rather
 * than a transcription of its shape. That import resolves through the package's
 * `exports` to core's `dist/`, so core must be BUILT for this case to mean
 * anything; the suite's `pnpm test` run is preceded by a dependency-closure
 * build for exactly that reason.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveUserAuthzGrants } from '@objectstack/core';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';

import { bootstrapBuiltinRoles } from './bootstrap-builtin-positions.js';
import { bootstrapDeclaredPositions } from './bootstrap-declared-positions.js';
import { bootstrapDeclaredPermissions } from './bootstrap-declared-permissions.js';
import { SysPosition } from './objects/sys-position.object.js';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import { SysPositionPermissionSet } from './objects/sys-position-permission-set.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';

const ORG_JIA = 'org_jia';
const ORG_YI = 'org_yi';
const ORGS = [ORG_JIA, ORG_YI] as const;

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/** One declared position and one packaged permission set to seed. */
const STUB_REGISTRY = {
  listItems: (type: string) => {
    if (type === 'position') return [{ name: 'sales_manager', label: 'Sales Manager' }];
    if (type === 'permission') return [{ name: 'sales_readonly', label: 'Sales RO', _packageId: 'com.acme.crm', objects: {} }];
    return [];
  },
};

/** A logger that records what the seeders said, so a LOUD guard can be asserted. */
function recordingLogger() {
  const warns: Array<{ message: string; meta: any }> = [];
  const infos: Array<{ message: string; meta: any }> = [];
  return {
    warns,
    infos,
    logger: {
      info: (message: string, meta?: any) => { infos.push({ message, meta }); },
      warn: (message: string, meta?: any) => { warns.push({ message, meta }); },
    },
  };
}

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

/**
 * The REAL engine, faced with the stub registry (`ObjectQL.registry` is a
 * getter, so it cannot simply be assigned).
 *
 * A delegating pass-through, not a fake: every verb reaches the real ObjectQL
 * behind it, which is the whole point of this suite. `update` still opens with
 * the PRODUCER's own dispatch predicate (#4550 / #5480 / #6277) rather than a
 * hand-mirrored guard, because a seam that merely forwards is exactly the shape
 * that reads as "not a double" and then admits a call the real engine would
 * reject. `delete` is not declared at all — none of the three seeders deletes,
 * and a verb no caller exercises would be a contract this seam does not have to
 * make.
 */
function withRegistry(engine: any): any {
  return {
    find: (o: string, q?: any, opt?: any) => engine.find(o, q, opt),
    insert: (o: string, d: any, opt?: any) => engine.insert(o, d, opt),
    update: (o: string, d: any, opt?: any) => {
      assertEngineUpdateDispatch(d, opt);
      return engine.update(o, d, opt);
    },
    registry: STUB_REGISTRY,
  };
}

/** Ground truth: every stored row, straight off knex, past all tenancy. */
async function stored(engine: ObjectQL, table: string): Promise<any[]> {
  const driver: any = (engine as any).getDriver(table);
  return driver.knex(table).select('*');
}

/** Run the three catalog seeders for one organization (walled), or none (single). */
async function seedCatalog(engine: ObjectQL, logger: any, organizationId?: string): Promise<void> {
  const ql = withRegistry(engine);
  await bootstrapDeclaredPositions(ql, null, { logger, organizationId });
  await bootstrapDeclaredPermissions(ql, null, { logger, organizationId });
  await bootstrapBuiltinRoles(ql, { logger, organizationId });
}

const orgOf = (r: any): string | null => (r.organization_id ?? null);

describe('[#10103] per-organization RBAC catalog materialization', () => {
  it('1. walled: every seeded catalog row is STAMPED with its organization, and each organization holds its own copy', async () => {
    const engine = await boot();
    const { logger } = recordingLogger();
    for (const org of ORGS) await seedCatalog(engine, logger, org);

    const positions = await stored(engine, 'sys_position');
    const sets = await stored(engine, 'sys_permission_set');

    // The inversion of the shipped behaviour: no row belongs to nobody.
    expect(positions.filter((r) => orgOf(r) === null)).toEqual([]);
    expect(sets.filter((r) => orgOf(r) === null)).toEqual([]);

    // Stated per organization so a failure names the tenant that lost its
    // catalog rather than printing a set diff.
    for (const org of ORGS) {
      const names = positions.filter((r) => orgOf(r) === org).map((r) => r.name).sort();
      expect(names).toEqual([
        'everyone', 'guest', 'org_admin', 'org_member', 'org_owner', 'platform_admin', 'sales_manager',
      ]);
      expect(sets.filter((r) => orgOf(r) === org).map((r) => r.name)).toEqual(['sales_readonly']);
    }
  });

  it('2. walled: the read that measured ZERO over the whole catalog now returns the organization’s own rows', async () => {
    const engine = await boot();
    const { logger } = recordingLogger();
    for (const org of ORGS) await seedCatalog(engine, logger, org);

    // The AST plugin-security's Layer 0 AND-composes for `isolated`: a strict
    // `organization_id = <active org>`, over which the driver adds its own
    // predicate. This is the exact read that returned nothing.
    const walled = await (engine as any).find('sys_position', {
      where: { organization_id: ORG_JIA },
      context: { isSystem: true, tenantId: ORG_JIA },
    });
    const names = (walled as any[]).map((r) => r.name).sort();
    expect(names).toContain('everyone');
    expect(names).toContain('sales_manager');
    expect(names).toHaveLength(7);

    // And the wall still walls: org_yi's copies are not in org_jia's read.
    for (const row of walled as any[]) expect(orgOf(row)).toBe(ORG_JIA);
  });

  it('3. THE silent no-op is gone: a per-organization pass over a PRE-FIX organization-less row creates the organization’s own copy AND says so loudly, by name', async () => {
    const engine = await boot();
    const { logger, warns } = recordingLogger();

    // Reproduce a pre-fix deployment exactly: one organization-less pass, the
    // shipped behaviour, writing the rows every deployment that booted the old
    // code carries.
    await seedCatalog(engine, logger, undefined);
    const before = await stored(engine, 'sys_position');
    expect(before.every((r) => orgOf(r) === null)).toBe(true);
    const everyoneBefore = before.filter((r) => r.name === 'everyone');
    expect(everyoneBefore).toHaveLength(1);

    warns.length = 0;
    for (const org of ORGS) await seedCatalog(engine, logger, org);

    // (a) NOT a no-op. The measured failure was: the tenant-threaded pass sees
    // the organization-less row through the driver's compatibility arm, reads
    // the name as already represented, takes the update branch and creates
    // nothing — leaving the deployment as broken as before while reporting
    // success. Each organization now has its OWN `everyone`.
    const after = await stored(engine, 'sys_position');
    const everyoneAfter = after.filter((r) => r.name === 'everyone');
    // Sorted with `null` spelled explicitly rather than left to the default
    // comparator, which stringifies and orders `null` first.
    expect(everyoneAfter.map(orgOf).sort((a, b) => `${a}`.localeCompare(`${b}`)))
      .toEqual([ORG_JIA, ORG_YI, null].sort((a, b) => `${a}`.localeCompare(`${b}`)));
    expect(everyoneAfter.filter((r) => orgOf(r) === ORG_JIA)).toHaveLength(1);
    expect(everyoneAfter.filter((r) => orgOf(r) === ORG_YI)).toHaveLength(1);

    // (b) LOUD. Named rows, named remedy — this is what stands in place of the
    // reap, so a warning that merely counted would not discharge it.
    const guard = warns.filter((w) => w.message.includes('pre-fix organization-less'));
    expect(guard.length).toBeGreaterThanOrEqual(2); // at least once per organization
    for (const org of ORGS) {
      const forOrg = guard.filter((w) => w.meta?.organization === org);
      expect(forOrg.length).toBeGreaterThan(0);
      const names = forOrg.flatMap((w) => w.meta?.names ?? []);
      expect(names).toContain('everyone');
      expect(names).toContain('sales_manager');
    }
    // The remedy is spelled out, and the reason nothing is deleted with it.
    const text = guard.map((w) => w.message).join(' ');
    expect(text).toContain('re-initialize');
    expect(text).toContain('adopt');
    expect(text).toContain('NOT deleted');

    // (c) and nothing was reaped — the organization-less row that grants point
    // at is still there, which is why the guard is a warning and not a delete.
    expect(everyoneAfter.filter((r) => orgOf(r) === null)).toHaveLength(1);
  });

  it('4. `single`-posture carve-out: exactly ONE organization-less pass, no copies, and NO warning', async () => {
    const engine = await boot();
    const { logger, warns } = recordingLogger();

    await seedCatalog(engine, logger, undefined);
    await seedCatalog(engine, logger, undefined); // idempotent re-run, as at boot

    const positions = await stored(engine, 'sys_position');
    expect(positions.every((r) => orgOf(r) === null)).toBe(true);
    expect(positions.filter((r) => r.name === 'everyone')).toHaveLength(1);
    // An organization-less row is the CORRECT shape here, so the guard that
    // calls it invalid state must stay silent.
    expect(warns.filter((w) => w.message.includes('pre-fix organization-less'))).toEqual([]);
  });

  it('5. boot reconciliation is O(changed declarations): a second pass over unchanged declarations writes NOTHING', async () => {
    const engine = await boot();
    const { logger } = recordingLogger();
    for (const org of ORGS) await seedCatalog(engine, logger, org);

    // `updated_at` is the observable a blind re-write would move. Snapshot the
    // whole row set, re-run every pass, and require byte-equality — a pass that
    // re-wrote unchanged rows would fail here even if the VALUES matched.
    const snapshot = JSON.stringify((await stored(engine, 'sys_position')).map((r) => ({ ...r })).sort((a, b) => `${a.id}`.localeCompare(`${b.id}`)));
    const setSnapshot = JSON.stringify((await stored(engine, 'sys_permission_set')).map((r) => ({ ...r })).sort((a, b) => `${a.id}`.localeCompare(`${b.id}`)));

    for (const org of ORGS) await seedCatalog(engine, logger, org);

    const again = JSON.stringify((await stored(engine, 'sys_position')).map((r) => ({ ...r })).sort((a, b) => `${a.id}`.localeCompare(`${b.id}`)));
    const setAgain = JSON.stringify((await stored(engine, 'sys_permission_set')).map((r) => ({ ...r })).sort((a, b) => `${a.id}`.localeCompare(`${b.id}`)));
    expect(again).toBe(snapshot);
    expect(setAgain).toBe(setSnapshot);
  });

  it('6. the cross-organization grant bleed is closed: the REAL resolver no longer collects another organization’s binding', async () => {
    const engine = await boot();
    const { logger } = recordingLogger();
    for (const org of ORGS) await seedCatalog(engine, logger, org);

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

    // Positive control on the same resolver, from the same fixture: org_jia's
    // own member DOES get it. Without this the assertion above would pass on a
    // resolver that had simply stopped resolving anything.
    await (engine as any).insert('sys_user_position',
      { id: 'up_jia', user_id: 'u_jia', position: 'everyone' },
      { context: { isSystem: true, tenantId: ORG_JIA } });
    const jiaGrants = await resolveUserAuthzGrants(engine as any, 'u_jia', { tenantId: ORG_JIA });
    expect(jiaGrants.permissions).toContain('jia_wide_grant');
  });
});
