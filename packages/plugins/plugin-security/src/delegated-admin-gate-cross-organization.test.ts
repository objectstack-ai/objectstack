// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The delegated-admin gate resolves a scope's business-unit anchor INSIDE the
 * caller's own organization — pinned over a real engine, at the crossing.
 *
 * ## The defect this exists to keep closed
 *
 * `sys_business_unit.name` carries no uniqueness (the object's only unique
 * index is `(code, organization_id)`), so in a single-database multi-org
 * posture — ADR-0105 D1 `group` / `isolated`, which ADR-0132 ships open — two
 * organizations may each hold a unit called `sales`. The gate looked the
 * anchor up by NAME alone under a bare `{ isSystem: true }` context, which
 * carries no tenant: the engine threads a tenant to the driver only when
 * `execCtx.tenantId` is defined, and `SqlDriver.applyTenantScope` returns
 * early without one. So nothing scoped that read, `limit: 1` answered
 * whichever id the driver ordered first, and which organization won was an id
 * ordering.
 *
 * Both directions were wrong at once, and both are pinned below:
 *   - the org A delegate LOST its own subtree (denied inside its own unit);
 *   - the gate APPROVED a delegated write anchored in org B, and
 *     `describeDelegableScope` handed org B's unit ids to the org A caller.
 *
 * ## Why a real engine and a real driver
 *
 * The crossing IS the tenant scoping, so a fake `ql` that ignores `context`
 * cannot exercise it — it would only re-assert this file's own beliefs. Here
 * the ids are ordered so org B's sort first (`bu_0_*` before `bu_a_*`): under
 * the old resolution every assertion below flips, and insertion order makes no
 * difference because the SQL driver's `limit` read is `ORDER BY id ASC`.
 * `delegated-admin-gate.test.ts` pins the complementary half on a fake `ql`
 * that scopes NOTHING — the row-level arm that stands even where a driver has
 * no tenant scoping at all.
 *
 * Harness lineage: `tenant-layer0-verdict-end-to-end.test.ts` (a real
 * `ObjectQL` over a real `SqlDriver` on in-memory SQLite).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { PermissionSet } from '@objectstack/spec/security';
import { DelegatedAdminGate } from './delegated-admin-gate.js';

const ORG_A = 'org_a_acme';
/** Deliberately sorts BEFORE every `org_a`/`bu_a` id — the losing side of the defect. */
const ORG_B = 'org_0_globex';

const text = (name: string) => ({ name, type: 'text' as const });
const object = (name: string, fields: string[]) => ({
  name,
  label: name,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    organization_id: text('organization_id'),
    ...Object.fromEntries(fields.map((f) => [f, text(f)])),
  },
});

const OBJECTS = [
  object('sys_business_unit', ['name', 'parent_business_unit_id']),
  object('sys_position', ['name', 'delegatable']),
  object('sys_permission_set', ['name', 'admin_scope']),
  object('sys_position_permission_set', ['position_id', 'permission_set_id']),
  object('sys_user_position', ['user_id', 'position', 'business_unit_id', 'granted_by', 'delegated_from']),
  object('sys_business_unit_member', ['user_id', 'business_unit_id']),
  object('sys_user', ['primary_business_unit_id']),
];

/** The delegate's scope: anchored at the unit NAMED `sales`, subtree included. */
const SALES_SCOPE = {
  businessUnit: 'sales',
  includeSubtree: true,
  manageAssignments: true,
  manageBindings: false,
  authorEnvironmentSets: false,
  assignablePermissionSets: ['sales_user'],
};

const DELEGATE_SETS = [
  { name: 'member_default', objects: {} },
  {
    name: 'sales_admin',
    objects: { sys_user_position: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    adminScope: SALES_SCOPE,
  },
] as unknown as PermissionSet[];

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

const sysCtx = (organizationId: string) => ({ isSystem: true, tenantId: organizationId });

async function bootEngine() {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.delegated-admin-cross-organization',
    name: 'Delegated admin cross-organization anchor',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as any);
  await engine.syncSchemas();
  engines.push(engine);
  return engine;
}

/**
 * One organization's slice of the fixture: a unit named `sales` with one
 * child, a `sales_rep` position distributing the allowlisted `sales_user`
 * set, and one member. `idPrefix` decides how this organization's ids sort.
 */
async function seedOrganization(engine: ObjectQL, organizationId: string, idPrefix: string) {
  const ctx = sysCtx(organizationId);
  const ids = {
    sales: `bu_${idPrefix}_sales`,
    salesEast: `bu_${idPrefix}_sales_east`,
    position: `pos_${idPrefix}_sales_rep`,
    set: `ps_${idPrefix}_sales_user`,
    user: `usr_${idPrefix}_member`,
  };
  await engine.insert('sys_business_unit', [
    { id: ids.sales, name: 'sales', parent_business_unit_id: null },
    { id: ids.salesEast, name: 'sales_east', parent_business_unit_id: ids.sales },
  ], { context: ctx } as any);
  await engine.insert('sys_position', [{ id: ids.position, name: 'sales_rep' }], { context: ctx } as any);
  await engine.insert('sys_permission_set', [{ id: ids.set, name: 'sales_user' }], { context: ctx } as any);
  await engine.insert('sys_position_permission_set', [
    { id: `bind_${idPrefix}`, position_id: ids.position, permission_set_id: ids.set },
  ], { context: ctx } as any);
  await engine.insert('sys_user', [{ id: ids.user, primary_business_unit_id: ids.salesEast }], { context: ctx } as any);
  await engine.insert('sys_business_unit_member', [
    { id: `mem_${idPrefix}`, user_id: ids.user, business_unit_id: ids.salesEast },
  ], { context: ctx } as any);
  return ids;
}

function gateOn(engine: ObjectQL) {
  return new DelegatedAdminGate({
    ql: engine,
    resolveSets: async (context: any) => (context?.principal === 'delegate' ? DELEGATE_SETS : []),
  });
}

/** The org A delegate's own execution context, as a transport would carry it. */
const delegateCtx = (organizationId: string) => ({
  principal: 'delegate',
  userId: 'usr_delegate',
  tenantId: organizationId,
  positions: ['sales_admin'],
});

const assignInto = (gate: DelegatedAdminGate, organizationId: string, businessUnitId: string, userId: string) =>
  gate.assert({
    object: 'sys_user_position',
    operation: 'insert',
    data: { user_id: userId, position: 'sales_rep', business_unit_id: businessUnitId },
    context: delegateCtx(organizationId),
  });

describe('DelegatedAdminGate — a scope anchor never crosses an organization', () => {
  it('ground truth: two organizations each hold a unit named `sales`, and org B sorts first', async () => {
    const engine = await bootEngine();
    const b = await seedOrganization(engine, ORG_B, '0');
    const a = await seedOrganization(engine, ORG_A, 'a');

    // Read past every scope: the population the by-name read chose from.
    const driver: any = (engine as any).getDriver('sys_business_unit');
    const raw = await driver.knex('sys_business_unit').where({ name: 'sales' }).orderBy('id', 'asc');
    expect(raw.map((r: any) => r.id)).toEqual([b.sales, a.sales]);
    expect(raw.map((r: any) => r.organization_id)).toEqual([ORG_B, ORG_A]);
  });

  it('the org A delegate KEEPS its own subtree — a write inside org A `sales` is approved', async () => {
    const engine = await bootEngine();
    await seedOrganization(engine, ORG_B, '0');
    const a = await seedOrganization(engine, ORG_A, 'a');
    const gate = gateOn(engine);

    await expect(assignInto(gate, ORG_A, a.salesEast, a.user)).resolves.toBeUndefined();
  });

  it('the org A delegate cannot reach org B — a write anchored in the other organization is REFUSED', async () => {
    const engine = await bootEngine();
    const b = await seedOrganization(engine, ORG_B, '0');
    await seedOrganization(engine, ORG_A, 'a');
    const gate = gateOn(engine);

    await expect(assignInto(gate, ORG_A, b.salesEast, b.user)).rejects.toThrow(
      /outside the delegated subtree/,
    );
  });

  it('describeDelegableScope names the caller\'s own units and NOTHING of the other organization', async () => {
    const engine = await bootEngine();
    const b = await seedOrganization(engine, ORG_B, '0');
    const a = await seedOrganization(engine, ORG_A, 'a');
    const gate = gateOn(engine);

    const report = await gate.describeDelegableScope(DELEGATE_SETS, delegateCtx(ORG_A));

    expect([...report.placeableBusinessUnitIds].sort()).toEqual([a.sales, a.salesEast].sort());
    expect(report.scopes).toHaveLength(1);
    expect([...report.scopes[0].businessUnitIds].sort()).toEqual([a.sales, a.salesEast].sort());
    // The refusal, stated as absence: no org B id appears anywhere in the report.
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(b.sales);
    expect(serialized).not.toContain(b.salesEast);
  });

  it('a tenant admin is unconstrained INSIDE its organization, never across organizations', async () => {
    const engine = await bootEngine();
    const b = await seedOrganization(engine, ORG_B, '0');
    const a = await seedOrganization(engine, ORG_A, 'a');
    const gate = new DelegatedAdminGate({
      ql: engine,
      resolveSets: async () => [
        { name: 'admin_full', objects: { '*': { allowRead: true, modifyAllRecords: true } } },
      ] as unknown as PermissionSet[],
    });

    const report = await gate.describeDelegableScope([
      { name: 'admin_full', objects: { '*': { allowRead: true, modifyAllRecords: true } } },
    ] as unknown as PermissionSet[], { userId: 'usr_admin', tenantId: ORG_A });

    expect(report.isTenantAdmin).toBe(true);
    expect([...report.placeableBusinessUnitIds].sort()).toEqual([a.sales, a.salesEast].sort());
    expect(report.placeableBusinessUnitIds).not.toContain(b.sales);
  });

  // ── Controls: the assertions above must be able to fail, and the
  //    organization-less surface must be untouched. ───────────────────────
  it('control (dark) — one organization holding `sales` resolves it, and the in-org write is approved', async () => {
    const engine = await bootEngine();
    const a = await seedOrganization(engine, ORG_A, 'a');
    const gate = gateOn(engine);

    const report = await gate.describeDelegableScope(DELEGATE_SETS, delegateCtx(ORG_A));
    expect([...report.placeableBusinessUnitIds].sort()).toEqual([a.sales, a.salesEast].sort());
    await expect(assignInto(gate, ORG_A, a.salesEast, a.user)).resolves.toBeUndefined();
  });

  it('control (firing) — an anchor naming no unit in the caller\'s organization approves nothing', async () => {
    const engine = await bootEngine();
    const a = await seedOrganization(engine, ORG_A, 'a');
    const gate = new DelegatedAdminGate({
      ql: engine,
      resolveSets: async (context: any) =>
        context?.principal === 'delegate'
          ? ([{ name: 'sales_admin', objects: {}, adminScope: { ...SALES_SCOPE, businessUnit: 'no_such_unit' } }] as unknown as PermissionSet[])
          : [],
    });

    await expect(assignInto(gate, ORG_A, a.salesEast, a.user)).rejects.toThrow(
      /outside the delegated subtree/,
    );
  });

  it('a `single`-posture caller (no organization in context) keeps the by-name answer', async () => {
    const engine = await bootEngine();
    const a = await seedOrganization(engine, ORG_A, 'a');
    const gate = gateOn(engine);

    const report = await gate.describeDelegableScope(DELEGATE_SETS, {
      principal: 'delegate',
      userId: 'usr_delegate',
    });
    expect([...report.placeableBusinessUnitIds].sort()).toEqual([a.sales, a.salesEast].sort());
  });
});
