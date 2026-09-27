// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The delegated-admin gate resolves a position NAME inside the caller's own
 * organization — pinned over a real engine, one witness per authority read.
 *
 * ## The defect this exists to keep closed
 *
 * `sys_position` is a per-organization catalog upserted by
 * `(name, organization_id)`, and `name` carries no installation-wide
 * uniqueness, so in a single-database multi-org posture — ADR-0105 D1
 * `group` / `isolated`, which ADR-0132 ships open — two organizations may each
 * hold a position of the same name. Two gate reads looked the position up by
 * NAME alone, `limit: 1`, under a bare `{ isSystem: true }` context carrying no
 * tenant, so whichever id the driver ordered first answered:
 *
 *   - `positionIsDelegatable` — may this position be SELF-DELEGATED
 *     (ADR-0091 D3 rule 5)?
 *   - `setsBoundToPosition` — which permission sets does it distribute (the
 *     allowlist and containment tests of a delegated assignment, and D3 rule 6)?
 *
 * The sibling half — a scope's business-unit anchor — is pinned in
 * `delegated-admin-gate-cross-organization.test.ts`; this file reuses its
 * harness and its id ordering: the OTHER organization's ids sort first
 * (`*_0_*` before `*_a_*`), and the SQL driver's `limit` read is
 * `ORDER BY id ASC`, so under the old resolution every organization-A answer
 * below was organization B's.
 *
 * Fail closed: a position name with no row in the caller's organization is not
 * delegatable and distributes no permission sets — never another
 * organization's row, never an unscoped read. That matches the runtime
 * resolver, which reads position-bound sets through the caller's tenant.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { PermissionSet } from '@objectstack/spec/security';
import { DelegatedAdminGate } from './delegated-admin-gate.js';

const ORG_A = 'org_a_acme';
/** Deliberately sorts BEFORE every `org_a` / `*_a_*` id — the side the old read picked. */
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
  object('sys_user_position', [
    'user_id', 'position', 'business_unit_id', 'granted_by', 'delegated_from', 'valid_until', 'reason',
  ]),
  object('sys_business_unit_member', ['user_id', 'business_unit_id']),
  object('sys_user', ['primary_business_unit_id']),
];

/** The delegate's scope: anchored at the unit NAMED `sales`, handing out `sales_user` only. */
const SALES_SCOPE = {
  businessUnit: 'sales',
  includeSubtree: true,
  manageAssignments: true,
  manageBindings: false,
  authorEnvironmentSets: false,
  assignablePermissionSets: ['sales_user'],
};

const DELEGATE_SETS = [
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
    id: 'com.objectstack.qa.delegated-admin-position-organization',
    name: 'Delegated admin position organization scope',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as any);
  await engine.syncSchemas();
  engines.push(engine);
  return engine;
}

/** How one organization configured one position name. */
interface PositionSpec {
  name: string;
  delegatable: boolean;
  /** Permission-set NAMES the position distributes in this organization. */
  sets: string[];
  /** Those of `sets` that carry an `adminScope` in this organization. */
  adminSets?: string[];
}

/**
 * One organization's slice: a unit named `sales` with one child, one member,
 * a holder who DIRECTLY holds every position (for self-delegation), and the
 * positions exactly as this organization configured them. `idPrefix` decides
 * how this organization's ids sort.
 */
async function seedOrganization(
  engine: ObjectQL,
  organizationId: string,
  idPrefix: string,
  positions: PositionSpec[],
) {
  const ctx = sysCtx(organizationId);
  const ids = {
    sales: `bu_${idPrefix}_sales`,
    salesEast: `bu_${idPrefix}_sales_east`,
    member: `usr_${idPrefix}_member`,
    holder: `usr_${idPrefix}_holder`,
    positionId: (name: string) => `pos_${idPrefix}_${name}`,
  };
  await engine.insert('sys_business_unit', [
    { id: ids.sales, name: 'sales', parent_business_unit_id: null },
    { id: ids.salesEast, name: 'sales_east', parent_business_unit_id: ids.sales },
  ], { context: ctx } as any);
  await engine.insert('sys_user', [
    { id: ids.member, primary_business_unit_id: ids.salesEast },
    { id: ids.holder, primary_business_unit_id: ids.salesEast },
  ], { context: ctx } as any);
  await engine.insert('sys_business_unit_member', [
    { id: `mem_${idPrefix}_member`, user_id: ids.member, business_unit_id: ids.salesEast },
    { id: `mem_${idPrefix}_holder`, user_id: ids.holder, business_unit_id: ids.salesEast },
  ], { context: ctx } as any);

  const setNames = [...new Set(positions.flatMap((p) => p.sets))];
  const adminSets = new Set(positions.flatMap((p) => p.adminSets ?? []));
  if (setNames.length > 0) {
    await engine.insert('sys_permission_set', setNames.map((n) => ({
      id: `ps_${idPrefix}_${n}`,
      name: n,
      admin_scope: adminSets.has(n) ? JSON.stringify(SALES_SCOPE) : null,
    })), { context: ctx } as any);
  }
  for (const p of positions) {
    await engine.insert('sys_position', [
      { id: ids.positionId(p.name), name: p.name, delegatable: p.delegatable ? '1' : '0' },
    ], { context: ctx } as any);
    if (p.sets.length > 0) {
      await engine.insert('sys_position_permission_set', p.sets.map((n) => ({
        id: `bind_${idPrefix}_${p.name}_${n}`,
        position_id: ids.positionId(p.name),
        permission_set_id: `ps_${idPrefix}_${n}`,
      })), { context: ctx } as any);
    }
    // The holder holds it directly — self-delegation rule 4 is satisfied, so
    // rules 5 and 6 are what decide.
    await engine.insert('sys_user_position', [
      { id: `up_${idPrefix}_holder_${p.name}`, user_id: ids.holder, position: p.name, business_unit_id: ids.salesEast },
    ], { context: ctx } as any);
  }
  return ids;
}

function gateOn(engine: ObjectQL) {
  return new DelegatedAdminGate({
    ql: engine,
    resolveSets: async (context: any) => (context?.principal === 'delegate' ? DELEGATE_SETS : []),
  });
}

const DAY = 24 * 60 * 60 * 1000;

/** A holder delegates their OWN position to a colleague, inside their organization. */
const selfDelegate = (
  gate: DelegatedAdminGate,
  organizationId: string,
  ids: { holder: string; member: string },
  position: string,
) =>
  gate.assert({
    object: 'sys_user_position',
    operation: 'insert',
    data: {
      user_id: ids.member,
      position,
      delegated_from: ids.holder,
      valid_until: new Date(Date.now() + 7 * DAY).toISOString(),
      reason: 'annual leave',
    },
    context: { principal: 'holder', userId: ids.holder, tenantId: organizationId },
  });

/** A delegated administrator assigns a position inside their `sales` subtree. */
const assignAsDelegate = (
  gate: DelegatedAdminGate,
  organizationId: string,
  ids: { salesEast: string; member: string },
  position: string,
) =>
  gate.assert({
    object: 'sys_user_position',
    operation: 'insert',
    data: { user_id: ids.member, position, business_unit_id: ids.salesEast },
    context: { principal: 'delegate', userId: 'usr_delegate', tenantId: organizationId },
  });

// ── positionIsDelegatable ─────────────────────────────────────────────────

describe('DelegatedAdminGate — whether a position is delegatable is answered by the caller\'s own organization', () => {
  /** Same name, opposite answers: only org B opted `field_lead` in to delegation. */
  const seedBoth = async (engine: ObjectQL) => {
    const b = await seedOrganization(engine, ORG_B, '0', [{ name: 'field_lead', delegatable: true, sets: [] }]);
    const a = await seedOrganization(engine, ORG_A, 'a', [{ name: 'field_lead', delegatable: false, sets: [] }]);
    return { a, b };
  };

  it('ground truth: both organizations hold `field_lead`, org B\'s row sorts first and is the delegatable one', async () => {
    const engine = await bootEngine();
    const { a, b } = await seedBoth(engine);

    const driver: any = (engine as any).getDriver('sys_position');
    const raw = await driver.knex('sys_position').where({ name: 'field_lead' }).orderBy('id', 'asc');
    expect(raw.map((r: any) => r.id)).toEqual([b.positionId('field_lead'), a.positionId('field_lead')]);
    expect(raw.map((r: any) => [r.organization_id, r.delegatable])).toEqual([[ORG_B, '1'], [ORG_A, '0']]);
  });

  it('org A, which did NOT opt in, refuses the self-delegation — org B\'s opt-in does not answer for it', async () => {
    const engine = await bootEngine();
    const { a } = await seedBoth(engine);

    await expect(selfDelegate(gateOn(engine), ORG_A, a, 'field_lead')).rejects.toThrow(
      /position 'field_lead' is not delegatable/,
    );
  });

  it('org B, which opted in, approves the self-delegation', async () => {
    const engine = await bootEngine();
    const { b } = await seedBoth(engine);

    await expect(selfDelegate(gateOn(engine), ORG_B, b, 'field_lead')).resolves.toBeUndefined();
  });

  it('a position with NO row in the caller\'s organization is not delegatable (fail closed)', async () => {
    const engine = await bootEngine();
    // `night_shift` exists — delegatable — in org B only. The org A holder's
    // assignment row names it, but org A's catalog has no such position.
    await seedOrganization(engine, ORG_B, '0', [{ name: 'night_shift', delegatable: true, sets: [] }]);
    const a = await seedOrganization(engine, ORG_A, 'a', []);
    await engine.insert('sys_user_position', [
      { id: 'up_a_holder_night_shift', user_id: a.holder, position: 'night_shift', business_unit_id: a.salesEast },
    ], { context: sysCtx(ORG_A) } as any);

    await expect(selfDelegate(gateOn(engine), ORG_A, a, 'night_shift')).rejects.toThrow(
      /position 'night_shift' is not delegatable/,
    );
  });
});

// ── setsBoundToPosition ───────────────────────────────────────────────────

describe('DelegatedAdminGate — the sets a position distributes are the caller\'s own organization\'s bindings', () => {
  /**
   * Two names, each bound differently per organization. The delegate's scope
   * allowlists `sales_user` only, in both organizations.
   *   - `lead`   — org A binds `sales_user` (allowlisted); org B binds `finance_user` (not).
   *   - `closer` — org A binds `finance_user` (not);      org B binds `sales_user` (allowlisted).
   */
  const seedBoth = async (engine: ObjectQL) => {
    const b = await seedOrganization(engine, ORG_B, '0', [
      { name: 'lead', delegatable: false, sets: ['finance_user'] },
      { name: 'closer', delegatable: false, sets: ['sales_user'] },
    ]);
    const a = await seedOrganization(engine, ORG_A, 'a', [
      { name: 'lead', delegatable: false, sets: ['sales_user'] },
      { name: 'closer', delegatable: false, sets: ['finance_user'] },
    ]);
    return { a, b };
  };

  it('org A judges `lead` by its OWN binding (allowlisted) — approved', async () => {
    const engine = await bootEngine();
    const { a } = await seedBoth(engine);

    await expect(assignAsDelegate(gateOn(engine), ORG_A, a, 'lead')).resolves.toBeUndefined();
  });

  it('org A judges `closer` by its OWN binding (not allowlisted) — refused, org B\'s binding does not launder it', async () => {
    const engine = await bootEngine();
    const { a } = await seedBoth(engine);

    await expect(assignAsDelegate(gateOn(engine), ORG_A, a, 'closer')).rejects.toThrow(
      /position 'closer' distributes permission set 'finance_user', which is not in the scope's allowlist/,
    );
  });

  it('org B gets the mirror-image answers from its own bindings', async () => {
    const engine = await bootEngine();
    const { b } = await seedBoth(engine);
    const gate = gateOn(engine);

    await expect(assignAsDelegate(gate, ORG_B, b, 'closer')).resolves.toBeUndefined();
    await expect(assignAsDelegate(gate, ORG_B, b, 'lead')).rejects.toThrow(
      /position 'lead' distributes permission set 'finance_user', which is not in the scope's allowlist/,
    );
  });

  it('describeDelegableScope offers each organization only the positions its OWN bindings allow', async () => {
    const engine = await bootEngine();
    await seedBoth(engine);
    const gate = gateOn(engine);

    const reportA = await gate.describeDelegableScope(DELEGATE_SETS, { userId: 'usr_delegate', tenantId: ORG_A });
    const reportB = await gate.describeDelegableScope(DELEGATE_SETS, { userId: 'usr_delegate', tenantId: ORG_B });
    expect(reportA.assignablePositions).toEqual(['lead']);
    expect(reportB.assignablePositions).toEqual(['closer']);
  });

  it('self-delegation rule 6 reads the caller\'s own bindings — an admin set bound only in org B does not block org A', async () => {
    const engine = await bootEngine();
    // Both opted `relief` in; only org B's `relief` distributes an ADMIN set.
    const b = await seedOrganization(engine, ORG_B, '0', [
      { name: 'relief', delegatable: true, sets: ['relief_admin'], adminSets: ['relief_admin'] },
    ]);
    const a = await seedOrganization(engine, ORG_A, 'a', [{ name: 'relief', delegatable: true, sets: ['sales_user'] }]);
    const gate = gateOn(engine);

    await expect(selfDelegate(gate, ORG_A, a, 'relief')).resolves.toBeUndefined();
    await expect(selfDelegate(gate, ORG_B, b, 'relief')).rejects.toThrow(
      /distributes the admin set 'relief_admin' — administration cannot be self-delegated/,
    );
  });

  it('a position with NO row in the caller\'s organization distributes no sets — org B\'s bindings never judge org A', async () => {
    const engine = await bootEngine();
    // `ghost` exists only in org B, bound to a set org A's scope does not allowlist.
    await seedOrganization(engine, ORG_B, '0', [{ name: 'ghost', delegatable: false, sets: ['finance_user'] }]);
    const a = await seedOrganization(engine, ORG_A, 'a', []);
    const gate = gateOn(engine);

    // Nothing to offer: org A's catalog has no `ghost`.
    const report = await gate.describeDelegableScope(DELEGATE_SETS, { userId: 'usr_delegate', tenantId: ORG_A });
    expect(report.assignablePositions).toEqual([]);
    // And the write is judged against the empty binding set org A actually has —
    // org B's `finance_user` is not what refuses or approves it. The assignment
    // grants nothing at runtime either: the resolver reads position-bound sets
    // through the caller's tenant.
    await expect(assignAsDelegate(gate, ORG_A, a, 'ghost')).resolves.toBeUndefined();
  });
});

// ── Controls ──────────────────────────────────────────────────────────────

describe('DelegatedAdminGate — position reads: controls', () => {
  it('control (dark) — one organization: its own delegatable + bound answers stand', async () => {
    const engine = await bootEngine();
    const a = await seedOrganization(engine, ORG_A, 'a', [
      { name: 'field_lead', delegatable: true, sets: [] },
      { name: 'lead', delegatable: false, sets: ['sales_user'] },
      { name: 'closer', delegatable: false, sets: ['finance_user'] },
    ]);
    const gate = gateOn(engine);

    await expect(selfDelegate(gate, ORG_A, a, 'field_lead')).resolves.toBeUndefined();
    await expect(assignAsDelegate(gate, ORG_A, a, 'lead')).resolves.toBeUndefined();
    await expect(assignAsDelegate(gate, ORG_A, a, 'closer')).rejects.toThrow(/not in the scope's allowlist/);
  });

  it('a `single`-posture caller (no organization in context) keeps the by-name answer', async () => {
    const engine = await bootEngine();
    const a = await seedOrganization(engine, ORG_A, 'a', [
      { name: 'field_lead', delegatable: true, sets: [] },
      { name: 'closer', delegatable: false, sets: ['finance_user'] },
    ]);
    const gate = gateOn(engine);

    await expect(gate.assert({
      object: 'sys_user_position',
      operation: 'insert',
      data: {
        user_id: a.member,
        position: 'field_lead',
        delegated_from: a.holder,
        valid_until: new Date(Date.now() + 7 * DAY).toISOString(),
        reason: 'annual leave',
      },
      context: { principal: 'holder', userId: a.holder },
    })).resolves.toBeUndefined();
    const report = await gate.describeDelegableScope(DELEGATE_SETS, { userId: 'usr_delegate' });
    expect(report.assignablePositions).toEqual(['field_lead']);
  });
});
