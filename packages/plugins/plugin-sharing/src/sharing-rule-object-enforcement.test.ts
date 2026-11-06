// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30621] A sharing rule is refused at save when its object is not under
 * record-sharing enforcement.
 *
 * Before: an administrator could save a `sys_sharing_rule` on an object no
 * sharing gate consults (measured: `sys_session`, `sys_account`,
 * `sys_api_key`). The save answered `201`; the reconcile then met the ADR-0111
 * D7 inert-grant guard (`SHARING_NOT_ENABLED`) and wrote no `sys_record_share`,
 * so the rule sat in Setup looking active and never applied.
 *
 * Now: both save doors refuse it with `SHARING_NOT_ENABLED` (422), the code
 * the per-record share routes and `POST .../evaluate` already answer for the
 * same verdict, and nothing is saved:
 *
 *  - the `/data` door (Setup's New and edit forms) through the
 *    `sys_sharing_rule` hook guard;
 *  - `SharingRuleService.defineRule` (`POST /api/v1/sharing/rules`).
 *
 * The verdict is the reconcile's own (`SharingService.sharingRuleObjectRefusal`
 * reads the same `inertGrantReason` the grant pre-flight throws on), so the
 * save door and the reconcile cannot disagree about which objects are
 * enforced. A public object WITH an owner column stays admitted: there the
 * grant service still admits an external member of the record's organization
 * (#25549), so a rule on it is not inert as a whole.
 *
 * Real `ObjectQL` + `SqlDriver` (better-sqlite3 `:memory:`), so the hook runs
 * on the engine's own write path and `ctx.previous` is the engine's pre-image.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { ExecutionContext } from '@objectstack/spec/kernel';

import { SharingService } from './sharing-service.js';
import { SharingRuleService } from './sharing-rule-service.js';
import { bindRuleObjectEnforcementGuard } from './rule-hooks.js';

const ORG = 'org_30621';
const ENFORCED = 'os30621_deal';
const OWNERLESS = 'os30621_session';
const PUBLIC_OWNED = 'os30621_notice';

const SYSTEM: ExecutionContext = { isSystem: true, positions: [], permissions: [] };
const ADMIN = {
  userId: 'usr_admin',
  organizationId: ORG,
  tenantId: ORG,
  positions: [],
  permissions: [],
  systemPermissions: ['manage_sharing'],
} as unknown as ExecutionContext;

const text = (name: string) => ({ type: 'text', name, label: name });

const RULE_FIELDS = Object.fromEntries(
  ['organization_id', 'name', 'label', 'description', 'object_name', 'criteria_json', 'recipient_type',
    'recipient_id', 'access_level', 'managed_by', 'created_at', 'updated_at'].map((f) => [f, text(f)]),
);

const open: SqlDriver[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.disconnect().catch(() => undefined);
});

async function boot() {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  open.push(driver);
  const ql = new ObjectQL();
  ql.registerDriver(driver as never, true);
  await ql.init();
  ql.setTenancyPostureProvider(() => 'single');
  const recordFields = {
    id: { ...text('id'), primary: true },
    stage: text('stage'),
    organization_id: text('organization_id'),
  };
  ql.registerObject({
    name: ENFORCED, label: 'Deal', sharingModel: 'private',
    fields: { ...recordFields, owner_id: text('owner_id') },
  } as never);
  // The `sys_session` shape as the registry holds it: no `owner_id`, no
  // declared model (`ownership: 'none'`, so the registry injects no owner).
  ql.registerObject({ name: OWNERLESS, label: 'Session', ownership: 'none', fields: recordFields } as never);
  ql.registerObject({
    name: PUBLIC_OWNED, label: 'Notice', sharingModel: 'public_read_write',
    fields: { ...recordFields, owner_id: text('owner_id') },
  } as never);
  ql.registerObject({
    name: 'sys_sharing_rule', label: 'Sharing Rule', isSystem: true,
    fields: {
      id: { ...text('id'), primary: true },
      ...RULE_FIELDS,
      active: { type: 'boolean', name: 'active', label: 'Active' },
      customized: { type: 'boolean', name: 'customized', label: 'Customized' },
    },
  } as never);
  await driver.initObjects([ENFORCED, OWNERLESS, PUBLIC_OWNED, 'sys_sharing_rule']
    .map((name) => ({ name, fields: (ql as any).getSchema(name).fields }) as never));
  const sharing = new SharingService({ engine: ql as never });
  const rules = new SharingRuleService({ engine: ql as never, sharing });
  bindRuleObjectEnforcementGuard(ql as never, sharing);
  return { ql, rules };
}

const rowFor = (object: string, name: string) => ({
  id: `srule_${name}`,
  organization_id: ORG,
  name,
  label: name,
  object_name: object,
  criteria_json: '{"stage":"won"}',
  recipient_type: 'position',
  recipient_id: 'sales_rep',
  access_level: 'read',
  active: true,
  managed_by: 'admin',
});

async function storedRules(ql: ObjectQL) {
  return ((await ql.find('sys_sharing_rule', { context: SYSTEM } as never)) ?? []) as Array<Record<string, any>>;
}

describe('[#30621] the /data door refuses a sharing rule on an object without record sharing', () => {
  it('an insert on an owner-less object (the sys_session shape) is refused and nothing is saved', async () => {
    const { ql } = await boot();
    const err = await ql.insert('sys_sharing_rule', rowFor(OWNERLESS, 'session_rule'), { context: ADMIN } as never)
      .catch((x: unknown) => x as any);
    expect(err?.code).toBe('SHARING_NOT_ENABLED');
    expect(err?.status).toBe(422);
    // The sentence names the object and how to turn record sharing on for it.
    expect(String(err?.message)).toContain(`'${OWNERLESS}'`);
    expect(String(err?.message)).toMatch(/sharingModel/);
    expect(String(err?.message)).toMatch(/owner_id/);
    expect(await storedRules(ql)).toHaveLength(0);
  });

  it('CONTROL: an insert on an enforced object saves as before', async () => {
    const { ql } = await boot();
    await ql.insert('sys_sharing_rule', rowFor(ENFORCED, 'deal_rule'), { context: ADMIN } as never);
    expect((await storedRules(ql)).map((r) => r.name)).toEqual(['deal_rule']);
  });

  it('CONTROL: a public object WITH an owner column is admitted (the reconcile still grants its external members)', async () => {
    const { ql } = await boot();
    await ql.insert('sys_sharing_rule', rowFor(PUBLIC_OWNED, 'notice_rule'), { context: ADMIN } as never);
    expect((await storedRules(ql)).map((r) => r.name)).toEqual(['notice_rule']);
  });

  it('an update that moves a rule onto a non-enforced object is refused and the row keeps its object', async () => {
    const { ql } = await boot();
    await ql.insert('sys_sharing_rule', rowFor(ENFORCED, 'deal_rule'), { context: ADMIN } as never);
    const err = await ql.update('sys_sharing_rule', { id: 'srule_deal_rule', object_name: OWNERLESS }, { context: ADMIN } as never)
      .catch((x: unknown) => x as any);
    expect(err?.code).toBe('SHARING_NOT_ENABLED');
    expect(err?.status).toBe(422);
    expect((await storedRules(ql))[0]?.object_name).toBe(ENFORCED);
  });

  it('an update that leaves a legacy rule on its object passes, so it can still be switched off', async () => {
    const { ql } = await boot();
    // A row saved before this guard existed: written under the system context.
    await ql.insert('sys_sharing_rule', rowFor(OWNERLESS, 'legacy_rule'), { context: SYSTEM } as never);
    await ql.update('sys_sharing_rule', { id: 'srule_legacy_rule', object_name: OWNERLESS, active: false }, { context: ADMIN } as never);
    const [row] = await storedRules(ql);
    expect(row?.active === false || row?.active === 0).toBe(true);
  });
});

describe('[#30621] defineRule (POST /api/v1/sharing/rules) refuses the same rule', () => {
  const input = (object: string, name: string) => ({
    name, label: name, object, recipientType: 'position', recipientId: 'sales_rep', criteria: { stage: 'won' },
  });

  it('a rule on an owner-less object is refused with SHARING_NOT_ENABLED 422 and nothing is saved', async () => {
    const { ql, rules } = await boot();
    const err = await rules.defineRule(input(OWNERLESS, 'session_rule') as never, ADMIN).catch((x: unknown) => x as any);
    expect(err?.code).toBe('SHARING_NOT_ENABLED');
    expect(err?.status).toBe(422);
    expect(String(err?.message)).toContain(`'${OWNERLESS}'`);
    expect(await storedRules(ql)).toHaveLength(0);
  });

  it('CONTROL: a rule on an enforced object is saved', async () => {
    const { ql, rules } = await boot();
    const row = await rules.defineRule(input(ENFORCED, 'deal_rule') as never, ADMIN);
    expect(row.object_name).toBe(ENFORCED);
    expect((await storedRules(ql)).map((r) => r.name)).toEqual(['deal_rule']);
  });

  it('an upsert that moves an existing rule onto a non-enforced object is refused', async () => {
    const { ql, rules } = await boot();
    await rules.defineRule(input(ENFORCED, 'deal_rule') as never, ADMIN);
    const err = await rules.defineRule(input(OWNERLESS, 'deal_rule') as never, ADMIN).catch((x: unknown) => x as any);
    expect(err?.code).toBe('SHARING_NOT_ENABLED');
    expect(err?.status).toBe(422);
    expect((await storedRules(ql))[0]?.object_name).toBe(ENFORCED);
  });
});
