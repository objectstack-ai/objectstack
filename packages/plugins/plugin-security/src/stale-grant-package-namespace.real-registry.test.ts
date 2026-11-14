// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D2/D8, #31698] A stored grant whose package no longer serves its
 * set is read inside that package's namespace only.
 *
 * Read from the REAL `SchemaRegistry` of a REAL `ObjectQL` engine over a real
 * SQL driver, with the grant stored through the engine's write path (the
 * grant-name hook and the package stamp). Three packages: `crm`, a second
 * package of the `crm` namespace that declares `crm` (a co-owner), and `hr`.
 * A grant of `crm`'s set is stored, then `crm` stops serving it:
 *
 *  - the set's holder is the co-owner (same namespace): the grant reads it;
 *  - the set's holder is `hr` (another namespace): the grant confers nothing,
 *    and the boot report lists it with that holder.
 *
 * Read by the authorization resolver (`resolveUserAuthzGrants`) and the boot
 * report (`collectCatalogReferences`), the one catalog read under both.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { bindSecurityCatalogReader, createSecurityCatalogReader, resolveUserAuthzGrants, securityCatalogReaderOf } from '@objectstack/core';
import { SysUser, SysMember } from '@objectstack/platform-objects/identity';

import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { registerGrantPermissionSetNameHooks } from './grant-permission-set-name.js';
import { registerPermissionSetPackageStamp } from './stored-permission-set-package-stamp.js';
import { collectCatalogReferences } from './catalog-reference-report.js';

const ORG = 'org_a';
const SYS = { isSystem: true, tenantId: ORG } as const;
const GRANTS = 'sys_user_permission_set';
const CRM = 'com.acme.crm';
/** A second package of the `crm` namespace: it declares `crm`, so the two co-own it. */
const CRM_EXT = 'com.acme.crm-ext';
const HR = 'com.acme.hr';

/** `moved_reader` moves from `crm` to its co-owner; `qa_reader` is held by `crm` and by `hr`. */
const set = (name: string, cap: string) => ({ name, label: name, systemPermissions: [cap], objects: {} });

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot() {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.stale-grant-package-namespace',
    name: 'A stored grant whose package no longer serves its set',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysUser, SysMember, SysUserPosition, SysUserPermissionSet],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);
  vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);

  const registry = engine.registry;
  registry.logLevel = 'silent';
  registry.installPackage({ id: CRM, name: CRM, version: '1.0.0', namespace: 'crm' } as any, 'authored');
  registry.installPackage({ id: CRM_EXT, name: CRM_EXT, version: '1.0.0', namespace: 'crm', dependencies: { [CRM]: '^1.0.0' } } as any, 'authored');
  registry.installPackage({ id: HR, name: HR, version: '1.0.0', namespace: 'hr' } as any, 'authored');
  registry.registerItem('permission', set('moved_reader', 'cap_crm_moved') as any, 'name' as never, CRM);
  registry.registerItem('permission', set('qa_reader', 'cap_crm') as any, 'name' as never, CRM);
  registry.registerItem('permission', set('qa_reader', 'cap_hr') as any, 'name' as never, HR);
  registry.sealBareNameHolders();

  const warn = vi.fn();
  const metadata = { get: async () => undefined, list: async () => [] };
  expect(bindSecurityCatalogReader(engine, createSecurityCatalogReader({ registry: registry as never, metadata, logger: { warn } }))).toBe(true);
  expect(registerGrantPermissionSetNameHooks(engine as never)).toBe(true);
  expect(registerPermissionSetPackageStamp({
    registry: registry as never,
    getSchema: engine.getSchema.bind(engine),
    registerHook: engine.registerHook.bind(engine),
    unregisterHooksByPackage: engine.unregisterHooksByPackage.bind(engine),
    find: engine.find.bind(engine),
  })).toBe(true);

  await engine.insert('sys_user', { id: 'u_member', name: 'Member', email: 'member@example.com' }, { context: SYS });
  await engine.insert('sys_member', { id: 'm_a', user_id: 'u_member', organization_id: ORG, role: 'member' }, { context: SYS });
  // Each grant names crm's set, as the write path stores it.
  await engine.insert(GRANTS, { id: 'g_moved', user_id: 'u_member', permission_set: 'moved_reader', permission_set_package: CRM }, { context: SYS });
  await engine.insert(GRANTS, { id: 'g_qa', user_id: 'u_member', permission_set: 'qa_reader', permission_set_package: CRM }, { context: SYS });
  return { engine, registry, warn };
}

/** `crm` stops serving the set `name`, as an upgrade that drops it leaves the registry. */
function crmDrops(registry: ObjectQL['registry'], name: string): void {
  registry.unregisterItem('permission', `${CRM}:${name}`);
  expect(registry.packageScopedHoldersOf('permission', name, null)).not.toContain(CRM);
}

async function granted(engine: ObjectQL) {
  const out = await resolveUserAuthzGrants(engine, 'u_member', { tenantId: ORG });
  return { caps: [...out.systemPermissions].sort(), addresses: out.permissionSetAddresses ?? [] };
}

describe('[#31698] a stored grant whose package no longer serves its set, over the real registry', () => {
  it('CONTROL: while crm serves both sets, each grant confers crm\'s set', async () => {
    const { engine } = await boot();
    const stored = (await engine.find(GRANTS, { where: {}, context: SYS })) as Array<Record<string, unknown>>;
    expect(stored.map((r) => [r.id, r.permission_set_package]).sort()).toEqual([['g_moved', CRM], ['g_qa', CRM]]);
    expect(await granted(engine)).toEqual({
      caps: ['cap_crm', 'cap_crm_moved'],
      addresses: [{ packageId: CRM, name: 'moved_reader' }, { packageId: CRM, name: 'qa_reader' }],
    });
  });

  it('the set moved to a co-owner of crm\'s namespace: the grant reads the co-owner\'s set, and the report lists nothing', async () => {
    const { engine, registry, warn } = await boot();
    crmDrops(registry, 'moved_reader');
    registry.registerItem('permission', set('moved_reader', 'cap_ext') as any, 'name' as never, CRM_EXT);
    expect((await granted(engine)).addresses).toContainEqual({ packageId: CRM_EXT, name: 'moved_reader' });
    expect((await granted(engine)).caps).toContain('cap_ext');
    const report = await collectCatalogReferences(engine as any, { catalog: securityCatalogReaderOf(engine)! });
    expect(report.organizations.flatMap((o) => [...o.staleGrantsOutsideNamespace, ...o.permissionSetGrants])).toEqual([]);
    expect(warn.mock.calls.filter(([, meta]) => meta?.name === 'moved_reader')).toHaveLength(1);
  });

  it('⛔ the set\'s holder is now another namespace\'s: the grant confers nothing, and the report lists it with that holder', async () => {
    const { engine, registry, warn } = await boot();
    crmDrops(registry, 'qa_reader');
    expect(registry.packageScopedHoldersOf('permission', 'qa_reader', null)).toEqual([HR]);
    const out = await granted(engine);
    expect(out.caps).toEqual(['cap_crm_moved']);
    expect(out.addresses.filter((a) => a.name === 'qa_reader')).toEqual([]);
    const report = await collectCatalogReferences(engine as any, { catalog: securityCatalogReaderOf(engine)! });
    expect(report.organizations.map((o) => ({ organizationId: o.organizationId, outside: o.staleGrantsOutsideNamespace, unresolved: o.permissionSetGrants })))
      .toEqual([{
        organizationId: ORG,
        outside: [{ id: 'g_qa', userId: 'u_member', name: 'qa_reader', packageId: CRM, holder: HR }],
        unresolved: [],
      }]);
    const said = warn.mock.calls.filter(([, meta]) => meta?.name === 'qa_reader');
    expect(said).toHaveLength(1);
    expect(String(said[0][0])).toContain('it confers nothing');
  });
});
