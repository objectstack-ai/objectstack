// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The delegated-admin gate counts a `sys_user_position` holding only where the
 * runtime would grant it — pinned over a real engine, one witness per read.
 *
 * ## The defect this exists to keep closed
 *
 * `sys_user_position.position` is a position NAME, the same string in every
 * organization that holds it (ADR-0131 D3: one environment catalog), so in a
 * single-database multi-org posture
 * (ADR-0105 D1 `group` / `isolated`) two organizations' holdings of the same
 * name are the same string. Two gate reads selected holdings by that name under
 * a bare `{ isSystem: true }` context with no organization condition. The one
 * that remains is `activeHoldings` — does the delegator CURRENTLY and
 * DIRECTLY hold the position (ADR-0091 D3 rule 4)? A holding stamped for
 * ANOTHER organization answered yes, so a user self-delegated a position in an
 * organization where they held nothing. (The other, the binding blast radius,
 * retired with the `sys_position_permission_set` binding rows, ADR-0131 D3.)
 *
 * ## The rule the read now follows — the runtime's own
 *
 * `resolveAuthzContext` (step 4, `@objectstack/core`) keeps a holding only
 * when its `organization_id` equals the active organization. The gate agrees: a
 * holding stamped for another organization never counts; an organization-less
 * holding counts nowhere, exactly as it grants nowhere (the 18.0 ownership
 * ceremony, ADR-0131 D10, attributes every such row before an upgraded database
 * boots, so one is invalid state); and a caller whose context carries no
 * organization holds nothing to delegate.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { DelegatedAdminGate } from './delegated-admin-gate.js';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';
import { relaxEveryTenantColumn } from './pre-18-tenant-column.testkit.js';

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
  object('sys_user_position', [
    'user_id', 'position', 'business_unit_id', 'granted_by', 'delegated_from', 'valid_until', 'reason',
  ]),
  object('sys_business_unit_member', ['user_id', 'business_unit_id']),
  object('sys_user', ['primary_business_unit_id']),
];

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
  // The organization-less holdings and rows below exist only on a store built
  // before 18.x (ADR-0131 D1 makes a fresh tenant column NOT NULL): this is it.
  await relaxEveryTenantColumn(engine, OBJECTS);
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
  // [ADR-0131 D3/D4] The position and the set are the security catalog's
  // definitions (environment-level); the rows above are each organization's.
  bindTestSecurityCatalog(engine, {
    positions: [{ name: 'field_lead', delegatable: true }],
    permissions: [{ name: 'sales_user' }],
  });
  return new DelegatedAdminGate({
    ql: engine,
    resolveSets: async () => [],
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

  it('an organization-less holding counts nowhere — not in org A, where the runtime grants it nothing', async () => {
    const engine = await bootEngine();
    await seedOrganization(engine, ORG_B, '0');
    await seedOrganization(engine, ORG_A, 'a');
    await hold(engine, undefined, [{ id: 'up_none', user_id: USER }]);

    await expectRefused(selfDelegate(gateOn(engine), ORG_A), /you do not currently hold 'field_lead'/);
    await expectRefused(selfDelegate(gateOn(engine), ORG_B), /you do not currently hold 'field_lead'/);
    // Control: the same user's holding OWNED by org A makes the same request stand.
    await hold(engine, ORG_A, [{ id: 'up_a', user_id: USER }]);
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

  it('a caller whose context carries no organization counts no holding — owned or organization-less', async () => {
    const engine = await bootEngine();
    await seedOrganization(engine, ORG_B, '0');
    await hold(engine, ORG_B, [{ id: 'up_b', user_id: USER }]);
    await hold(engine, undefined, [{ id: 'up_none', user_id: USER }]);

    await expectRefused(selfDelegate(gateOn(engine), undefined), /you do not currently hold 'field_lead'/);
    // Control: the same holding counts once the request runs in the organization that owns it.
    await expect(selfDelegate(gateOn(engine), ORG_B)).resolves.toBeUndefined();
  });
});
