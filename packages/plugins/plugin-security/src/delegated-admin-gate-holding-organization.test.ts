// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The delegated-admin gate counts a `sys_user_position` holding only where the
 * runtime would grant it — pinned over a real engine, one witness per read.
 *
 * ## The defect this exists to keep closed
 *
 * `sys_user_position.position` is a position NAME, and `sys_position.name` is
 * unique per organization only, so in a single-database multi-org posture
 * (ADR-0105 D1 `group` / `isolated`) two organizations' holdings of the same
 * name are the same string. Two gate reads selected holdings by that name under
 * a bare `{ isSystem: true }` context with no organization condition:
 *
 *   - `activeHoldings` — does the delegator CURRENTLY and DIRECTLY hold the
 *     position (ADR-0091 D3 rule 4)? A holding stamped for ANOTHER
 *     organization answered yes, so a user self-delegated a position in an
 *     organization where they held nothing.
 *   - `assignmentAnchorsOfPosition` — whose capability does re-binding the
 *     position re-compose (the ADR-0090 D12 blast radius)? Another
 *     organization's same-named assignments entered it, so a delegate was
 *     refused over holders their binding never reaches.
 *
 * ## The rule both reads now follow — the runtime's own
 *
 * `resolveAuthzContext` (step 4, `@objectstack/core`) keeps a holding when its
 * `organization_id` is empty OR equals the active organization, and drops it
 * when it names a DIFFERENT one. The gate agrees: a holding stamped for another
 * organization never counts; an organization-less holding counts in every
 * organization, exactly as it grants in every organization. An
 * organization-less caller (`single` posture) drops nothing, as before.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { PermissionSet } from '@objectstack/spec/security';
import { DelegatedAdminGate } from './delegated-admin-gate.js';

const ORG_A = 'org_a_acme';
/** Sorts BEFORE every `org_a` / `*_a_*` id, like the sibling suites. */
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

/** A binding delegate's scope: the unit NAMED `sales`, may bind `sales_user` only. */
const BIND_SCOPE = {
  businessUnit: 'sales',
  includeSubtree: true,
  manageAssignments: false,
  manageBindings: true,
  authorEnvironmentSets: false,
  assignablePermissionSets: ['sales_user'],
};

const BINDER_SETS = [
  {
    name: 'sales_binder',
    objects: { sys_position_permission_set: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    adminScope: BIND_SCOPE,
  },
] as unknown as PermissionSet[];

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

const sysCtx = (organizationId?: string) =>
  organizationId ? { isSystem: true, tenantId: organizationId } : { isSystem: true };

async function bootEngine() {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.delegated-admin-holding-organization',
    name: 'Delegated admin holding organization scope',
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
 * One organization's slice: a unit named `sales` with one child, a delegatable
 * `field_lead` position, and a plain `sales_user` permission set. No holdings —
 * each witness writes exactly the holdings it is about.
 */
async function seedOrganization(engine: ObjectQL, organizationId: string, idPrefix: string) {
  const ctx = sysCtx(organizationId);
  const ids = {
    sales: `bu_${idPrefix}_sales`,
    salesEast: `bu_${idPrefix}_sales_east`,
    fieldLead: `pos_${idPrefix}_field_lead`,
    salesUser: `ps_${idPrefix}_sales_user`,
  };
  await engine.insert('sys_business_unit', [
    { id: ids.sales, name: 'sales', parent_business_unit_id: null },
    { id: ids.salesEast, name: 'sales_east', parent_business_unit_id: ids.sales },
  ], { context: ctx } as any);
  await engine.insert('sys_position', [
    { id: ids.fieldLead, name: 'field_lead', delegatable: '1' },
  ], { context: ctx } as any);
  await engine.insert('sys_permission_set', [
    { id: ids.salesUser, name: 'sales_user', admin_scope: null },
  ], { context: ctx } as any);
  return ids;
}

/** Write holdings of `field_lead`, stamped for `organizationId` (undefined = organization-less). */
async function hold(
  engine: ObjectQL,
  organizationId: string | undefined,
  rows: Array<{ id: string; user_id: string; business_unit_id?: string | null; delegated_from?: string }>,
) {
  // Chunked: SQLite caps one compound INSERT … SELECT at 500 terms.
  for (let i = 0; i < rows.length; i += 100) {
    await engine.insert('sys_user_position', rows.slice(i, i + 100).map((r) => ({
      position: 'field_lead',
      business_unit_id: null,
      ...r,
    })), { context: sysCtx(organizationId) } as any);
  }
}

function gateOn(engine: ObjectQL) {
  return new DelegatedAdminGate({
    ql: engine,
    resolveSets: async (context: any) => (context?.principal === 'binder' ? BINDER_SETS : []),
  });
}

const DAY = 24 * 60 * 60 * 1000;
const USER = 'usr_u';
const COLLEAGUE = 'usr_colleague';

/** USER self-delegates `field_lead` to a colleague, in `organizationId` (undefined = `single` posture). */
const selfDelegate = (gate: DelegatedAdminGate, organizationId: string | undefined, businessUnitId?: string) =>
  gate.assert({
    object: 'sys_user_position',
    operation: 'insert',
    data: {
      user_id: COLLEAGUE,
      position: 'field_lead',
      delegated_from: USER,
      valid_until: new Date(Date.now() + 7 * DAY).toISOString(),
      reason: 'annual leave',
      ...(businessUnitId ? { business_unit_id: businessUnitId } : {}),
    },
    context: organizationId
      ? { principal: 'holder', userId: USER, tenantId: organizationId }
      : { principal: 'holder', userId: USER },
  });

/** A binding delegate in `organizationId` binds `sales_user` to the position row `positionId`. */
const bind = (gate: DelegatedAdminGate, organizationId: string, positionId: string, permissionSetId: string) =>
  gate.assert({
    object: 'sys_position_permission_set',
    operation: 'insert',
    data: { position_id: positionId, permission_set_id: permissionSetId },
    context: { principal: 'binder', userId: 'usr_binder', tenantId: organizationId },
  });

/** A gate refusal: the ADR-0112 envelope, then the first sentence that names why. */
async function expectRefused(p: Promise<unknown>, why: RegExp) {
  const err: any = await p.then(() => null, (e) => e);
  expect(err, 'expected a refusal').not.toBeNull();
  expect(err).toMatchObject({ code: 'PERMISSION_DENIED', statusCode: 403 });
  expect(String(err.message)).toMatch(why);
}

// ── activeHoldings — self-delegation rule 4 ───────────────────────────────

describe('DelegatedAdminGate — rule 4 counts only holdings the caller\'s organization grants', () => {
  it('ground truth: the organization-less holding is stored with no organization', async () => {
    const engine = await bootEngine();
    await seedOrganization(engine, ORG_A, 'a');
    await hold(engine, ORG_B, [{ id: 'up_b', user_id: USER }]);
    await hold(engine, undefined, [{ id: 'up_none', user_id: USER }]);

    const driver: any = (engine as any).getDriver('sys_user_position');
    const raw = await driver.knex('sys_user_position').where({ position: 'field_lead' }).orderBy('id', 'asc');
    expect(raw.map((r: any) => [r.id, r.organization_id ?? null])).toEqual([['up_b', ORG_B], ['up_none', null]]);
  });

  it('a user whose ONLY holding is in org B cannot self-delegate org A\'s same-named position', async () => {
    const engine = await bootEngine();
    await seedOrganization(engine, ORG_B, '0');
    await seedOrganization(engine, ORG_A, 'a');
    await hold(engine, ORG_B, [{ id: 'up_b', user_id: USER }]);

    await expectRefused(selfDelegate(gateOn(engine), ORG_A), /you do not currently hold 'field_lead'/);
    // …and in org B, where the holding lives, it stands.
    await expect(selfDelegate(gateOn(engine), ORG_B)).resolves.toBeUndefined();
  });

  it('a user holding it in org A can self-delegate it in org A', async () => {
    const engine = await bootEngine();
    await seedOrganization(engine, ORG_B, '0');
    await seedOrganization(engine, ORG_A, 'a');
    await hold(engine, ORG_A, [{ id: 'up_a', user_id: USER }]);

    await expect(selfDelegate(gateOn(engine), ORG_A)).resolves.toBeUndefined();
  });

  it('an organization-less holding counts in org A — the runtime grants it in every organization', async () => {
    const engine = await bootEngine();
    await seedOrganization(engine, ORG_B, '0');
    await seedOrganization(engine, ORG_A, 'a');
    await hold(engine, undefined, [{ id: 'up_none', user_id: USER }]);

    await expect(selfDelegate(gateOn(engine), ORG_A)).resolves.toBeUndefined();
  });

  it('a DIRECT holding in org B does not make org A\'s delegated holding re-delegatable', async () => {
    const engine = await bootEngine();
    await seedOrganization(engine, ORG_B, '0');
    await seedOrganization(engine, ORG_A, 'a');
    await hold(engine, ORG_B, [{ id: 'up_b', user_id: USER }]);
    await hold(engine, ORG_A, [{ id: 'up_a', user_id: USER, delegated_from: 'usr_boss' }]);

    await expectRefused(
      selfDelegate(gateOn(engine), ORG_A),
      /you hold 'field_lead' only via delegation — a delegated grant is not re-delegatable/,
    );
  });

  it('rule 4b: an org B holding\'s anchor does not widen what an org A delegation may hand out', async () => {
    const engine = await bootEngine();
    const b = await seedOrganization(engine, ORG_B, '0');
    const a = await seedOrganization(engine, ORG_A, 'a');
    await hold(engine, ORG_B, [{ id: 'up_b', user_id: USER, business_unit_id: b.sales }]);
    await hold(engine, ORG_A, [{ id: 'up_a', user_id: USER, business_unit_id: a.salesEast }]);

    await expectRefused(
      selfDelegate(gateOn(engine), ORG_A, b.salesEast),
      /business unit anchor 'bu_0_sales_east' is outside your own effective anchor for 'field_lead'/,
    );
    await expect(selfDelegate(gateOn(engine), ORG_A, a.salesEast)).resolves.toBeUndefined();
  });

  it('a `single`-posture caller (no organization in context) keeps counting every holding', async () => {
    const engine = await bootEngine();
    await seedOrganization(engine, ORG_B, '0');
    await hold(engine, ORG_B, [{ id: 'up_b', user_id: USER }]);

    await expect(selfDelegate(gateOn(engine), undefined)).resolves.toBeUndefined();
  });
});

// ── assignmentAnchorsOfPosition — the binding blast radius ────────────────

describe('DelegatedAdminGate — a binding\'s blast radius is the holders the bound position reaches', () => {
  it('org B\'s same-named assignments do not refuse org A\'s binding (outside-subtree anchor)', async () => {
    const engine = await bootEngine();
    const b = await seedOrganization(engine, ORG_B, '0');
    const a = await seedOrganization(engine, ORG_A, 'a');
    await hold(engine, ORG_A, [{ id: 'up_a', user_id: 'usr_a1', business_unit_id: a.salesEast }]);
    await hold(engine, ORG_B, [{ id: 'up_b', user_id: 'usr_b1', business_unit_id: b.salesEast }]);

    await expect(bind(gateOn(engine), ORG_A, a.fieldLead, a.salesUser)).resolves.toBeUndefined();
  });

  it('org B\'s same-named assignments do not push org A\'s binding over the blast-radius cap', async () => {
    const engine = await bootEngine();
    const b = await seedOrganization(engine, ORG_B, '0');
    const a = await seedOrganization(engine, ORG_A, 'a');
    await hold(engine, ORG_A, [{ id: 'up_a', user_id: 'usr_a1', business_unit_id: a.salesEast }]);
    await hold(engine, ORG_B, Array.from({ length: 501 }, (_, i) => ({
      id: `up_b_${String(i).padStart(3, '0')}`,
      user_id: `usr_b_${i}`,
      business_unit_id: b.salesEast,
    })));

    await expect(bind(gateOn(engine), ORG_A, a.fieldLead, a.salesUser)).resolves.toBeUndefined();
  });

  it('an organization-less holding IS in org A\'s blast radius — the runtime grants it org A\'s binding', async () => {
    const engine = await bootEngine();
    await seedOrganization(engine, ORG_B, '0');
    const a = await seedOrganization(engine, ORG_A, 'a');
    await hold(engine, ORG_A, [{ id: 'up_a', user_id: 'usr_a1', business_unit_id: a.salesEast }]);
    await hold(engine, undefined, [{ id: 'up_none', user_id: 'usr_x' }]);

    await expectRefused(
      bind(gateOn(engine), ORG_A, a.fieldLead, a.salesUser),
      /position 'field_lead' has 1 unanchored assignment\(s\)/,
    );
  });

  it('the radius follows the BOUND row\'s organization — org B\'s holders still guard org B\'s row', async () => {
    const engine = await bootEngine();
    const b = await seedOrganization(engine, ORG_B, '0');
    const a = await seedOrganization(engine, ORG_A, 'a');
    await hold(engine, ORG_A, [{ id: 'up_a', user_id: 'usr_a1', business_unit_id: a.salesEast }]);
    await hold(engine, ORG_B, [{ id: 'up_b', user_id: 'usr_b1', business_unit_id: b.salesEast }]);

    await expectRefused(
      bind(gateOn(engine), ORG_A, b.fieldLead, a.salesUser),
      /position 'field_lead' is held in business unit 'bu_0_sales_east', outside the delegated subtree/,
    );
  });

  it('control (dark) — org A\'s own holder outside the subtree still refuses', async () => {
    const engine = await bootEngine();
    const a = await seedOrganization(engine, ORG_A, 'a');
    await engine.insert('sys_business_unit', [
      { id: 'bu_a_ops', name: 'ops', parent_business_unit_id: null },
    ], { context: sysCtx(ORG_A) } as any);
    await hold(engine, ORG_A, [{ id: 'up_a', user_id: 'usr_a1', business_unit_id: 'bu_a_ops' }]);

    await expectRefused(
      bind(gateOn(engine), ORG_A, a.fieldLead, a.salesUser),
      /position 'field_lead' is held in business unit 'bu_a_ops', outside the delegated subtree/,
    );
  });
});
