// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// TEMPORARY premise measurement for issue #10103 — NOT committed to any PR.
// Re-establishes the card's readings behaviourally on this branch, on a real
// ObjectQL + better-sqlite3 SqlDriver, through the REAL shipped seeders.

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { bootstrapBuiltinRoles } from './bootstrap-builtin-positions.js';
import { bootstrapDeclaredPositions } from './bootstrap-declared-positions.js';
import { bootstrapDeclaredPermissions } from './bootstrap-declared-permissions.js';
import { SysPosition } from './objects/sys-position.object.js';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import { SysPositionPermissionSet } from './objects/sys-position-permission-set.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysOrganization } from '@objectstack/platform-objects/identity';

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

const ORGS = ['org_jia', 'org_yi'] as const;

async function boot(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.premise-10103',
    name: 'Premise',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPosition, SysOrganization],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);
  for (const org of ORGS) {
    await (engine as any).insert('sys_organization', { id: org, name: org }, { context: { isSystem: true } });
  }
  return engine;
}

/** Ground truth reads, past tenancy, straight off knex. */
async function stored(engine: ObjectQL, table: string): Promise<any[]> {
  const driver: any = (engine as any).getDriver(table);
  return driver.knex(table).select('*');
}

/** A registry stub carrying one declared position + one packaged permission set. */
const STUB_REGISTRY = {
  listItems: (type: string) => {
    if (type === 'position') return [{ name: 'sales_manager', label: 'Sales Manager' }];
    if (type === 'permission') return [{ name: 'sales_readonly', label: 'Sales RO', _packageId: 'com.acme.crm', objects: {} }];
    return [];
  },
};

/** The engine, faced with the stub registry (ObjectQL.registry is a getter). */
function withRegistry(engine: any): any {
  return {
    find: (o: string, q?: any, opt?: any) => engine.find(o, q, opt),
    insert: (o: string, d: any, opt?: any) => engine.insert(o, d, opt),
    update: (o: string, d: any, opt?: any) => engine.update(o, d, opt),
    delete: (o: string, opt?: any) => engine.delete(o, opt),
    registry: STUB_REGISTRY,
  };
}

describe('#10103 premise — measured on this branch', () => {
  it('M1: the shipped seeders insert with organization_id NULL on every row', async () => {
    const engine = await boot();
    const ql = withRegistry(engine);
    await bootstrapBuiltinRoles(ql);
    await bootstrapDeclaredPositions(ql, null);
    await bootstrapDeclaredPermissions(ql, null);

    const positions = await stored(engine, 'sys_position');
    const sets = await stored(engine, 'sys_permission_set');
    expect(positions.length).toBeGreaterThanOrEqual(7); // 4 built-ins + everyone + guest + sales_manager
    expect(sets.length).toBe(1);
    for (const r of [...positions, ...sets]) {
      expect(r.organization_id ?? null).toBeNull();
    }
    // eslint-disable-next-line no-console
    console.log('[M1] positions:', positions.map((r) => `${r.name}/org=${r.organization_id ?? 'NULL'}`).join(' '));
    // eslint-disable-next-line no-console
    console.log('[M1] sets:', sets.map((r) => `${r.name}/org=${r.organization_id ?? 'NULL'}`).join(' '));
  });

  it("M2: a walled read (Layer-0's strict organization_id = X, AND-composed over the driver's OR-NULL arm) reads ZERO over the seeded catalog; an org-stamped row reads normally", async () => {
    const engine = await boot();
    const ql = withRegistry(engine);
    await bootstrapBuiltinRoles(ql);
    await bootstrapDeclaredPositions(ql, null);
    // Positive control: one org-stamped row.
    await (engine as any).insert(
      'sys_position',
      { id: 'pos_stamped', name: 'stamped_probe', label: 'Stamped' },
      { context: { isSystem: true, tenantId: 'org_jia' } },
    );

    // What plugin-security's Layer 0 AND-composes into the AST for `isolated`:
    // { organization_id: <active org> } — strict equality (tenant-layer.ts:146-147).
    // The driver then adds (org = X OR org IS NULL) on top; conjunction leaves org = X.
    const walled = await (engine as any).find('sys_position', {
      where: { organization_id: 'org_jia' },
      context: { isSystem: true, tenantId: 'org_jia' },
    });
    const names = (walled as any[]).map((r) => r.name).sort();
    // eslint-disable-next-line no-console
    console.log('[M2] walled read sees:', names.join(',') || '(nothing)');
    expect(names).toEqual(['stamped_probe']); // catalog rows: ZERO; stamped control: visible

    // Contrast: without the Layer-0 conjunct the driver's platform bucket DOES
    // return the org-less rows (ADR-0120 D3), proving the annihilation is the cause.
    const unconjoined = await (engine as any).find('sys_position', {
      context: { isSystem: true, tenantId: 'org_jia' },
    });
    expect((unconjoined as any[]).length).toBeGreaterThan(1);
  });

  it('M3 (the migration trap): a per-org pass threaded with tenantId still SEES the org-less row through the OR-NULL arm and updates it in place — no per-org copy is ever created without a reap', async () => {
    const engine = await boot();
    await bootstrapBuiltinRoles(withRegistry(engine)); // pre-fix org-less rows exist

    // A facade threading one org's tenant context into the SECOND argument of
    // find (where the engine actually reads it) — what a naive per-org pass does.
    const runtimeOf = (organizationId: string): any => ({
      find: (object: string, q: any = {}, _opt: any = {}) =>
        (engine as any).find(object, { ...q, context: { isSystem: true, tenantId: organizationId } }),
      insert: (object: string, data: any, _opt: any = {}) =>
        (engine as any).insert(object, data, { context: { isSystem: true, tenantId: organizationId } }),
      update: (object: string, data: any, _opt: any = {}) =>
        (engine as any).update(object, data, { context: { isSystem: true, tenantId: organizationId } }),
      registry: STUB_REGISTRY,
    });

    // NOTE: the shipped seeder passes context as a TRAILING arg its engine
    // ignores, so we call the same upsert shape the facade way, per org.
    for (const org of ORGS) {
      await bootstrapBuiltinRoles(runtimeOf(org));
    }
    const positions = await stored(engine, 'sys_position');
    const everyoneRows = positions.filter((r) => r.name === 'everyone');
    // eslint-disable-next-line no-console
    console.log('[M3] everyone rows after two tenant-threaded passes:',
      everyoneRows.map((r) => `org=${r.organization_id ?? 'NULL'}`).join(' '));
    expect(everyoneRows.length).toBe(1);
    expect(everyoneRows[0].organization_id ?? null).toBeNull();
  });

  it("M4 (post-fix bleed, resolve-authz-context §6a shape): with per-org copies, the name-$in position sweep returns EVERY org's rows, and the junction read then crosses organizations", async () => {
    const engine = await boot();
    // Simulate the post-fix world: per-org copies of `everyone`.
    for (const org of ORGS) {
      await (engine as any).insert('sys_position',
        { id: `pos_everyone_${org}`, name: 'everyone', label: 'Everyone' },
        { context: { isSystem: true, tenantId: org } });
    }
    // org_jia's admin binds a set to org_jia's everyone copy.
    await (engine as any).insert('sys_permission_set',
      { id: 'ps_jia_secret', name: 'jia_wide_grant', label: 'Jia', organization_id: 'org_jia' },
      { context: { isSystem: true, tenantId: 'org_jia' } });
    await (engine as any).insert('sys_position_permission_set',
      { id: 'pps_jia', position_id: 'pos_everyone_org_jia', permission_set_id: 'ps_jia_secret' },
      { context: { isSystem: true, tenantId: 'org_jia' } });

    // resolve-authz-context.ts §6a verbatim shape: name $in under bare isSystem.
    const positionRows: any[] = await (engine as any).find('sys_position', {
      where: { name: { $in: ['everyone'] } }, limit: 100, context: { isSystem: true },
    });
    const positionIds = positionRows.map((r) => r.id);
    const junction: any[] = await (engine as any).find('sys_position_permission_set', {
      where: { position_id: { $in: positionIds } }, limit: 500, context: { isSystem: true },
    });
    // eslint-disable-next-line no-console
    console.log('[M4] name-sweep returned', positionIds.sort().join(','), '→ junction rows:', junction.length);
    // org_yi's resolution (which runs this same read) would pick up org_jia's binding:
    expect(positionIds).toContain('pos_everyone_org_yi');
    expect(positionIds).toContain('pos_everyone_org_jia');
    expect(junction.map((r) => r.permission_set_id)).toContain('ps_jia_secret');
  });
});
