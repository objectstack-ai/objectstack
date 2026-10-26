// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3/D4] `ISecurityService.describePositionGrants` — each position as
 * the resolver enforces it for a holder, which the position catalog's list
 * serves.
 *
 * The pin is the AGREEMENT with enforcement: a position's described sets are
 * exactly the sets `resolvePermissionSetsForContext` grants a holder of that
 * position alone (no baseline): the sets its definition names, each `via:
 * 'definition'`. A set that merely shares the position's name is granted by
 * nothing since #24757 retired the position-name fold, so it is not listed, and
 * `via: 'name'` is never served. And the holder count is served only to a
 * caller who may read the assignment rows.
 */

import { describe, it, expect, vi } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';
import type { PermissionSet } from '@objectstack/spec/security';
import type { ISecurityService, PositionGrantSummary } from '@objectstack/spec/contracts';

const ORG = 'org_a';

function set(name: string, objects: Record<string, unknown> = {}): PermissionSet {
  return { name, label: name, objects, fields: {}, systemPermissions: [], tabPermissions: {} } as any;
}

/** The permission sets the evaluator resolves names against. */
const SETS: PermissionSet[] = [
  set('member_default'),
  set('crm_sales_user'),
  set('forecasting'),
  // Same name as the position, declared by no definition: granted by nothing.
  set('sales_manager'),
  // Same name as a position that DECLARES it: a declared binding.
  set('service_agent'),
  // Same name as a position, switched off in the ledger, declared by none.
  set('marketing_user'),
  // Same name as the guest anchor, declared by none.
  set('guest'),
];

/** The position definitions the catalog holds. */
const POSITIONS = [
  { name: 'sales_rep', permissionSets: ['crm_sales_user'] },
  { name: 'sales_manager', permissionSets: ['crm_sales_user', 'forecasting'] },
  { name: 'service_agent', permissionSets: ['service_agent'] },
  { name: 'marketing_user', permissionSets: [] },
  { name: 'switched_off', permissionSets: ['forecasting'] },
  { name: 'guest', permissionSets: [] },
];

const TABLES: Record<string, Array<Record<string, unknown>>> = {
  sys_member: [
    { user_id: 'u1', organization_id: ORG, role: 'member' },
    { user_id: 'u2', organization_id: ORG, role: 'member' },
    { user_id: 'u3', organization_id: ORG, role: 'member' },
  ],
  sys_user_position: [
    { user_id: 'u1', organization_id: ORG, position: 'sales_manager' },
    { user_id: 'u2', organization_id: ORG, position: 'sales_rep' },
    { user_id: 'u3', organization_id: ORG, position: 'sales_rep' },
    { user_id: 'u3', organization_id: ORG, position: 'switched_off' },
  ],
  sys_user_permission_set: [],
  sys_metadata_activation: [
    { metadata_type: 'permission', name: 'marketing_user', package_id: null, active: false },
    { metadata_type: 'position', name: 'switched_off', package_id: null, active: false },
  ],
};

function matches(row: Record<string, unknown>, where: Record<string, any> | undefined): boolean {
  for (const [key, cond] of Object.entries(where ?? {})) {
    // The reads under test filter by equality and `$in` only; a combinator is refused, never read as a field.
    if (key.startsWith('$')) throw new Error(`describe-position-grants double: unsupported combinator ${key}`);
    if (cond && typeof cond === 'object' && Array.isArray(cond.$in)) {
      if (!cond.$in.includes(row[key])) return false;
    } else if (row[key] !== cond) return false;
  }
  return true;
}

async function boot() {
  const definitions = (type: string) =>
    type === 'position' ? POSITIONS : type === 'permission' ? SETS.map((s) => ({ ...s })) : [];
  const ql: any = {
    registerMiddleware: () => {},
    getSchema: () => null,
    registry: {
      getItem: (type: string, name: string) => definitions(type).find((d: any) => d.name === name),
      listItems: (type: string) => definitions(type),
      isPackageDisabled: () => false,
      getObject: (name: string) => (name in TABLES ? { name } : undefined),
    },
    find: async (object: string, query: any) =>
      (TABLES[object] ?? []).filter((r) => matches(r, query?.where)).slice(0, query?.limit ?? Infinity),
  };
  const metadata: any = { get: async () => null, list: async () => SETS };
  const services: Record<string, any> = { manifest: { register: vi.fn() }, objectql: ql, metadata };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' } as any);
  await plugin.init(ctx);
  await plugin.start(ctx);
  const svc = ctx.registerService.mock.calls.find((c: any[]) => c[0] === 'security')?.[1] as ISecurityService;
  return { svc };
}

const byPosition = (summaries: PositionGrantSummary[]) =>
  Object.fromEntries(summaries.map((s) => [s.position, s]));

const NAMES = POSITIONS.map((p) => p.name);

describe('[ADR-0131 D3/D4] describePositionGrants — what a position grants, as enforced', () => {
  it('names each set its definition grants, in force, and no set that only shares its name', async () => {
    const { svc } = await boot();
    const out = byPosition(await svc.describePositionGrants!(NAMES, { isSystem: true, tenantId: ORG } as any));
    expect(out.sales_rep.permissionSets).toEqual([{ name: 'crm_sales_user', via: 'definition' }]);
    // The #24757 case: a set named after the position exists, and the
    // definition does not list it — so it is granted by nothing, and not listed.
    // (In the evaluator's resolution order, which is the catalog's.)
    expect(out.sales_manager.permissionSets).toEqual([
      { name: 'crm_sales_user', via: 'definition' },
      { name: 'forecasting', via: 'definition' },
    ]);
    // Declared under its own name: a declaration, granted through it.
    expect(out.service_agent.permissionSets).toEqual([{ name: 'service_agent', via: 'definition' }]);
    // Shares its name with a set, declares none: nothing.
    expect(out.marketing_user.permissionSets).toEqual([]);
    // A switched-off position grants nothing at all.
    expect(out.switched_off.permissionSets).toEqual([]);
    // The anonymous principal's anchor declares nothing here.
    expect(out.guest.permissionSets).toEqual([]);
    // `via: 'name'` is never served.
    expect(Object.values(out).flatMap((s) => s.permissionSets).filter((p) => p.via !== 'definition')).toEqual([]);
  });

  it('agrees, position by position, with the sets the resolver grants a holder of that position alone', async () => {
    const { svc } = await boot();
    const out = byPosition(await svc.describePositionGrants!(NAMES, { isSystem: true, tenantId: ORG } as any));
    for (const position of ['sales_rep', 'sales_manager', 'service_agent', 'marketing_user']) {
      // What core's §6a hands the resolver as `permissions` for this holder: the
      // definition's sets in force (none is switched off among these).
      const declared = POSITIONS.find((p) => p.name === position)!.permissionSets;
      // No `userId`: the additive baseline is every member's, not this position's.
      const enforced = await svc.resolvePermissionSetsForContext!({ positions: [position], permissions: declared } as any);
      expect(out[position].permissionSets.map((p) => p.name).sort(), position).toEqual(enforced.map((s) => s.name).sort());
    }
  });

  it('counts holders in the caller\'s organization for a caller who may read the assignment rows', async () => {
    const { svc } = await boot();
    const out = byPosition(await svc.describePositionGrants!(NAMES, { isSystem: true, tenantId: ORG } as any));
    expect(out.sales_rep.holderCount).toBe(2);
    expect(out.sales_manager.holderCount).toBe(1);
    expect(out.service_agent.holderCount).toBe(0);
    // Holding is the assignment: a switched-off position keeps its holder.
    expect(out.switched_off.holderCount).toBe(1);
    expect(out.guest.holderCount).toBeNull();
  });

  it('serves no count — null, never 0 — with no organization or to a caller who may not read the assignments', async () => {
    const { svc } = await boot();
    const orgless = await svc.describePositionGrants!(['sales_rep'], { isSystem: true } as any);
    expect(orgless[0].holderCount).toBeNull();
    // A member holding only the baseline (no read on `sys_user_position`).
    const member = await svc.describePositionGrants!(['sales_rep'], { userId: 'u2', tenantId: ORG, positions: [], permissions: [] } as any);
    expect(member[0].holderCount).toBeNull();
    // …and the sets are the catalog's, the same for every caller.
    expect(member[0].permissionSets).toEqual([{ name: 'crm_sales_user', via: 'definition' }]);
  });
});
