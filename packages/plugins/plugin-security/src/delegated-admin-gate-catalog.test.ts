// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0090 D12 × ADR-0131 D3/D4] The delegated-administration gate judges a
 * position by its DEFINITION in the security catalog.
 *
 * The authorization resolver grants a held position the sets its definition's
 * `permissionSets` names, read from the environment registry, and reads no
 * `sys_position_permission_set` junction row. The gate's containment check and
 * the assignable-positions listing must judge exactly that binding, or a
 * delegate could hand out (and a picker could offer) a position whose real
 * grant the gate never saw. These pins hold the gate to the catalog:
 *
 *  - a binding declared only on the definition is judged;
 *  - a junction row binds nothing, so it neither refuses nor launders;
 *  - a position declared only in the registry (no `sys_position` row) is
 *    assignable and listed;
 *  - a set name the definition carries but the catalog does not hold yet must
 *    be allowlisted too (it starts granting the moment it is authored);
 *  - a catalog read that fails refuses the write instead of approving it as
 *    "distributes nothing".
 */

import { describe, it, expect } from 'vitest';
import { AuthzStoreUnavailableError, bindSecurityCatalogReader } from '@objectstack/core';
import { DelegatedAdminGate } from './delegated-admin-gate.js';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';

const EAST_SCOPE = {
  businessUnit: 'east',
  includeSubtree: true,
  manageAssignments: true,
  manageBindings: false,
  authorEnvironmentSets: false,
  assignablePermissionSets: ['sales_user'],
};

const SETS: Record<string, any[]> = {
  tenant_admin: [{ name: 'admin_full', objects: { '*': { allowRead: true, modifyAllRecords: true } } }],
  delegate: [{ name: 'east_admin', objects: {}, adminScope: EAST_SCOPE }],
};

const CATALOG = {
  positions: [
    // Declared only on the definition: no junction row binds anything below.
    { name: 'rep', permissionSets: ['sales_user'] },
    { name: 'mixed', permissionSets: ['sales_user', 'finance_admin'] },
    // No `sys_position` row carries this one.
    { name: 'registry_only', permissionSets: ['sales_user'] },
    // Names a set nobody has authored yet.
    { name: 'pending', permissionSets: ['sales_user', 'not_yet_authored'] },
    { name: 'everyone', permissionSets: ['member_default'] },
  ],
  permissions: [{ name: 'sales_user' }, { name: 'finance_admin' }, { name: 'member_default' }],
};

function makeQl(tables: Record<string, any[]> = {}) {
  const all: Record<string, any[]> = {
    sys_business_unit: [
      { id: 'bu_hq', name: 'hq', parent_business_unit_id: null },
      { id: 'bu_east', name: 'east', parent_business_unit_id: 'bu_hq' },
      { id: 'bu_west', name: 'west', parent_business_unit_id: 'bu_hq' },
    ],
    // Rows say something else on purpose: `rep` is bound to the set NOT on
    // the allowlist, and `mixed` to nothing at all.
    sys_position: [
      { id: 'pos_rep', name: 'rep' },
      { id: 'pos_mixed', name: 'mixed' },
      { id: 'pos_pending', name: 'pending' },
    ],
    sys_permission_set: [
      { id: 'ps_sales', name: 'sales_user' },
      { id: 'ps_fin', name: 'finance_admin' },
    ],
    sys_position_permission_set: [{ id: 'b1', position_id: 'pos_rep', permission_set_id: 'ps_fin' }],
    sys_user_position: [],
    sys_business_unit_member: [],
    sys_user: [],
    ...tables,
  };
  const matches = (row: any, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (v && typeof v === 'object' && Array.isArray((v as any).$in)) return (v as any).$in.includes(row[k]);
      if (v && typeof v === 'object') throw new Error(`fake driver: unsupported condition on ${k}`);
      return row[k] === v;
    });
  return {
    async find(object: string, opts: any) {
      const rows = (all[object] ?? []).filter((r) => matches(r, opts?.where));
      return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
    async findOne(object: string, opts: any) {
      return (all[object] ?? []).filter((r) => matches(r, opts?.where))[0] ?? null;
    },
  } as any;
}

const gateOver = (ql: any) =>
  new DelegatedAdminGate({ ql, resolveSets: async (ctx: any) => SETS[ctx?.principal ?? ''] ?? [] });

const assign = (gate: DelegatedAdminGate, position: string) =>
  gate.assert({
    object: 'sys_user_position',
    operation: 'insert',
    data: { user_id: 'u_east_1', position, business_unit_id: 'bu_east' },
    context: { principal: 'delegate', userId: 'u_delegate' },
  });

async function refusal(p: Promise<unknown>): Promise<any> {
  const err: any = await p.then(() => null, (e) => e);
  expect(err, 'expected a refusal').not.toBeNull();
  return err;
}

describe('DelegatedAdminGate — a position distributes what its definition declares', () => {
  it('a binding declared only on the definition is judged: a non-allowlisted set refuses the assignment', async () => {
    const err = await refusal(assign(gateOver(bindTestSecurityCatalog(makeQl(), CATALOG)), 'mixed'));
    expect(err).toMatchObject({ code: 'PERMISSION_DENIED', statusCode: 403 });
    expect(String(err.message)).toMatch(/position 'mixed' distributes permission set 'finance_admin', which is not in the scope's allowlist/);
  });

  it("a junction row binds nothing: `rep`'s row binding finance_admin neither refuses nor counts", async () => {
    await expect(assign(gateOver(bindTestSecurityCatalog(makeQl(), CATALOG)), 'rep')).resolves.toBeUndefined();
  });

  it('a position declared only in the registry (no sys_position row) is assignable', async () => {
    await expect(assign(gateOver(bindTestSecurityCatalog(makeQl(), CATALOG)), 'registry_only')).resolves.toBeUndefined();
  });

  it('a set name the definition carries but the catalog does not hold yet must be allowlisted too', async () => {
    const err = await refusal(assign(gateOver(bindTestSecurityCatalog(makeQl(), CATALOG)), 'pending'));
    expect(String(err.message)).toMatch(/position 'pending' distributes permission set 'not_yet_authored', which is not in the scope's allowlist/);
  });

  it('a catalog read that fails refuses the write; it is never read as "distributes nothing"', async () => {
    const ql = makeQl();
    bindSecurityCatalogReader(ql, {
      resolve: async () => {
        throw new AuthzStoreUnavailableError('security catalog: registry (position)');
      },
      list: async () => [],
    });
    const err = await refusal(assign(gateOver(ql), 'rep'));
    expect(err).toBeInstanceOf(AuthzStoreUnavailableError);
  });
});

describe('DelegatedAdminGate — describeDelegableScope lists the catalog positions', () => {
  it('a delegate is offered exactly the positions whose declared sets are all allowlisted (anchors excluded)', async () => {
    const gate = gateOver(bindTestSecurityCatalog(makeQl(), CATALOG));
    const report = await gate.describeDelegableScope(SETS.delegate, { userId: 'u_delegate' });
    expect(report.assignablePositions.sort()).toEqual(['registry_only', 'rep']);
  });

  it('a tenant administrator is offered every position the catalog holds, a registry-only one included', async () => {
    const gate = gateOver(bindTestSecurityCatalog(makeQl(), CATALOG));
    const report = await gate.describeDelegableScope(SETS.tenant_admin, { userId: 'u_admin' });
    expect(report.assignablePositions.sort()).toEqual(['mixed', 'pending', 'registry_only', 'rep']);
  });

  it('with no catalog bound, nothing is offered (fail closed) — a row is not a position', async () => {
    const report = await gateOver(makeQl()).describeDelegableScope(SETS.tenant_admin, { userId: 'u_admin' });
    expect(report.assignablePositions).toEqual([]);
  });
});
