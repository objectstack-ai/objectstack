// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D2/D8/D9, #31698; #32538] An organization administrator grants a
 * permission set two packages of two namespaces hold, naming one of them.
 *
 * The unit pins of #32538 (`delegated-admin-gate.test.ts`) and #32164
 * (`grant-permission-set-package.test.ts`) read two holders from a stand-in
 * registry, because a real registry refused a second holder of a name until
 * the namespace narrowing. This file reads them from the REAL `SchemaRegistry`
 * of a REAL `ObjectQL` engine over a real SQL driver: two packages installed
 * with their namespaces, each registering its own `shared_reader` through the
 * item seam. Three pieces meet on it:
 *
 *  - the gate — `DelegatedAdminGate`, the organization-boundary judgement of
 *    the grant, over the catalog bound to the engine;
 *  - the seam — the grant-name hook and the package stamp
 *    (`registerGrantPermissionSetNameHooks`, `registerPermissionSetPackageStamp`)
 *    on the engine's write path, over the same registry;
 *  - the reader — `resolveUserAuthzGrants`, which grants the stored row.
 *
 * The holder `crm` is inside the organization boundary; `hr`'s set reads every
 * record (`objects['*'].viewAllRecords`), which an organization administrator
 * may not grant (condition (a)). Each refusal is read by its envelope, and
 * asserts nothing was stored.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { bindSecurityCatalogReader, createSecurityCatalogReader, resolveUserAuthzGrants } from '@objectstack/core';
import { resolveThrownHttpError } from '@objectstack/types';
import { SysUser, SysMember } from '@objectstack/platform-objects/identity';

import { DelegatedAdminGate } from './delegated-admin-gate.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { registerGrantPermissionSetNameHooks } from './grant-permission-set-name.js';
import { registerPermissionSetPackageStamp } from './stored-permission-set-package-stamp.js';

const ORG = 'org_a';
const SYS = { isSystem: true, tenantId: ORG } as const;
const GRANTS = 'sys_user_permission_set';
const CRM = 'com.acme.crm';
const HR = 'com.acme.hr';
const IN = { crm_account: { allowRead: true } };
const WILD = { '*': { allowRead: true, viewAllRecords: true } };

/** The organization administrator's own sets, as the resolver would answer them (both variants). */
const ADMIN_SETS: Record<string, unknown[]> = {
  org_admin: [{ name: 'organization_admin', objects: { '*': { allowRead: true, modifyAllRecords: true } } }],
  org_admin_nb: [{ name: 'organization_admin_no_bypass', objects: { '*': { allowRead: true } } }],
};
const adminCtx = (principal: string) => ({ principal, userId: `u_${principal}`, tenantId: ORG });

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
    id: 'com.objectstack.qa.org-admin-grant-two-holders',
    name: 'Organization administrator grants a set two namespaces hold',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysUser, SysMember, SysUserPosition, SysUserPermissionSet],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);
  vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);

  // Two packages of two namespaces, each holding its own `shared_reader` —
  // admitted by the item seam since the namespace narrowing; `crm_only` one holder.
  const registry = engine.registry;
  registry.logLevel = 'silent';
  for (const [id, namespace] of [[CRM, 'crm'], [HR, 'hr']] as const) {
    registry.installPackage({ id, name: id, version: '1.0.0', namespace } as any, 'authored');
  }
  registry.registerItem('permission', { name: 'shared_reader', label: 'crm reader', objects: IN } as any, 'name' as never, CRM);
  registry.registerItem('permission', { name: 'shared_reader', label: 'hr reader', objects: WILD } as any, 'name' as never, HR);
  registry.registerItem('permission', { name: 'crm_only', label: 'crm only', objects: IN } as any, 'name' as never, CRM);
  // The end of the cold boot: the seam judges a grant's package once the holders are sealed.
  registry.sealBareNameHolders();
  expect(registry.bareNameHoldersAreSealed).toBe(true);

  const metadata = { get: async () => undefined, list: async () => [] };
  expect(bindSecurityCatalogReader(engine, createSecurityCatalogReader({ registry: registry as never, metadata }))).toBe(true);
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

  const gate = new DelegatedAdminGate({ ql: engine as never, resolveSets: async (c: any) => (ADMIN_SETS[c?.principal ?? ''] ?? []) as never });
  return { engine, gate };
}

/** The gate, then the engine's write path under the administrator's own context — the order the plugin runs them in. */
async function grantAs(o: Awaited<ReturnType<typeof boot>>, principal: string, row: Record<string, unknown>) {
  const ctx = adminCtx(principal);
  const data: Record<string, unknown> = { ...row };
  await o.gate.assert({ object: GRANTS, operation: 'insert', data, context: ctx });
  await o.engine.insert(GRANTS, data, { context: { userId: ctx.userId, tenantId: ORG } });
  return data;
}

async function storedGrants(engine: ObjectQL) {
  const rows = (await engine.find(GRANTS, { where: {}, context: SYS })) as Array<Record<string, unknown>>;
  return rows.map((r) => ({ id: r.id, set: r.permission_set, package: r.permission_set_package ?? null, organization: r.organization_id }));
}

async function refusalOf(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (e) {
    const thrown = resolveThrownHttpError(e);
    return { envelope: [thrown.code, thrown.status], message: String((e as Error)?.message ?? '') };
  }
  throw new Error('expected the grant to be refused, but it was admitted');
}

for (const principal of ['org_admin', 'org_admin_nb']) {
  describe(`[#31698 + #32538] ${principal} grants a set two namespaces hold, over the real registry`, () => {
    it('the in-boundary holder named: the gate admits, the seam keeps that package, and the reader grants that holder\'s set alone', async () => {
      const o = await boot();
      await grantAs(o, principal, { id: 'g_crm', user_id: 'u_member', permission_set: 'shared_reader', permission_set_package: CRM });
      expect(await storedGrants(o.engine)).toEqual([{ id: 'g_crm', set: 'shared_reader', package: CRM, organization: ORG }]);
      const granted = await resolveUserAuthzGrants(o.engine, 'u_member', { tenantId: ORG });
      expect(granted.permissionSetAddresses?.filter((a) => a.name === 'shared_reader')).toEqual([{ packageId: CRM, name: 'shared_reader' }]);
    });

    it('the holder outside the boundary named: refused 403 on that holder (condition (a)); nothing stored', async () => {
      const o = await boot();
      const refusal = await refusalOf(() => grantAs(o, principal, { id: 'g_hr', user_id: 'u_member', permission_set: 'shared_reader', permission_set_package: HR }));
      expect(refusal.envelope).toEqual(['PERMISSION_DENIED', 403]);
      expect(refusal.message).toMatch(/'shared_reader'.*condition \(a\)/);
      expect(await storedGrants(o.engine)).toEqual([]);
    });

    it('no package named: refused 403 naming both holders; nothing stored', async () => {
      const o = await boot();
      const refusal = await refusalOf(() => grantAs(o, principal, { id: 'g_none', user_id: 'u_member', permission_set: 'shared_reader' }));
      expect(refusal.envelope).toEqual(['PERMISSION_DENIED', 403]);
      expect(refusal.message).toContain(CRM);
      expect(refusal.message).toContain(HR);
      expect(await storedGrants(o.engine)).toEqual([]);
    });

    it('CONTROL: a one-holder set, no package named: admitted, stamped with its holder, and granted', async () => {
      const o = await boot();
      await grantAs(o, principal, { id: 'g_one', user_id: 'u_member', permission_set: 'crm_only' });
      expect(await storedGrants(o.engine)).toEqual([{ id: 'g_one', set: 'crm_only', package: CRM, organization: ORG }]);
      const granted = await resolveUserAuthzGrants(o.engine, 'u_member', { tenantId: ORG });
      expect(granted.permissionSetAddresses?.filter((a) => a.name === 'crm_only')).toEqual([{ packageId: CRM, name: 'crm_only' }]);
    });
  });
}
