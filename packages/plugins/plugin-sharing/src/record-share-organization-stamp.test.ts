// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14484] Every `sys_record_share` row carries `organization_id` — on a REAL
 * engine over a REAL driver, both write paths, plus the backfill and the
 * engine rule the ledger flip switches on.
 *
 * ## Why a real driver
 *
 * The service-level pins (`sharing-service.test.ts`) prove what `grant` puts on
 * the row. What they cannot prove is the chain a system write now crosses:
 * `sys_record_share` is `tenant-scoped` in the #13491 ledger, so
 * `Engine.resolveSystemInsertOrganization` (#8844) reads every organization-
 * less system insert on it — deriving on a `single` install, REFUSING on a
 * walled one — and `SqlDriver.applyTenantScope` decides which row the update
 * half's `tenantId` lands on. A double proves none of that. So these cases run
 * a real `SqlDriver` on better-sqlite3 `:memory:` behind a real `ObjectQL`,
 * the way `rule-criteria-org-scope.test.ts` does for the sweep's scope.
 *
 * ## The two organizations a grant can carry, stated side by side
 *
 * Ruled 2026-09-02: a rule-materialised grant carries the RULE's organization,
 * a direct grant the RECORD's. `deal_p1` — an organization-less record an
 * org-A rule still matches through the driver's compatibility arm — is what
 * separates the two: under the org-A rule its grant carries ORG_A (the rule's),
 * under the platform-global rule it carries nothing (the record's).
 *
 * ## The P4 measurement, pinned
 *
 * Flipping the ledger row ALONE does not repair the writer: on a walled
 * posture it turns every organization-less system insert into a loud
 * `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED`. The last block pins both halves —
 * the refusal a bare insert now meets, and the repaired writer sailing through
 * it because it carries the organization.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { ExecutionContext } from '@objectstack/spec/kernel';

import { SharingService } from './sharing-service.js';
import { SharingRuleService } from './sharing-rule-service.js';
import { runSysRecordShareOrganizationBackfill } from './backfill-sys-record-share-organizations.js';

const OBJECT = 'os14484_deal';

const DEAL_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id', label: 'Id', primary: true },
  stage: { type: 'text', name: 'stage', label: 'Stage' },
  owner_id: { type: 'text', name: 'owner_id', label: 'Owner' },
  organization_id: { type: 'text', name: 'organization_id', label: 'Org' },
};

const SHARE_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id', label: 'Id', primary: true },
  organization_id: { type: 'text', name: 'organization_id', label: 'Org' },
  object_name: { type: 'text', name: 'object_name', label: 'Object' },
  record_id: { type: 'text', name: 'record_id', label: 'Record' },
  recipient_type: { type: 'text', name: 'recipient_type', label: 'Recipient type' },
  recipient_id: { type: 'text', name: 'recipient_id', label: 'Recipient' },
  access_level: { type: 'text', name: 'access_level', label: 'Access' },
  source: { type: 'text', name: 'source', label: 'Source' },
  source_id: { type: 'text', name: 'source_id', label: 'Source id' },
  reason: { type: 'text', name: 'reason', label: 'Reason' },
  granted_by: { type: 'text', name: 'granted_by', label: 'Grantor' },
  created_at: { type: 'text', name: 'created_at', label: 'Created' },
  updated_at: { type: 'text', name: 'updated_at', label: 'Updated' },
};

const RULE_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id', label: 'Id', primary: true },
  organization_id: { type: 'text', name: 'organization_id', label: 'Org' },
  name: { type: 'text', name: 'name', label: 'Name' },
  label: { type: 'text', name: 'label', label: 'Label' },
  description: { type: 'text', name: 'description', label: 'Description' },
  object_name: { type: 'text', name: 'object_name', label: 'Object' },
  criteria_json: { type: 'text', name: 'criteria_json', label: 'Criteria' },
  recipient_type: { type: 'text', name: 'recipient_type', label: 'Recipient type' },
  recipient_id: { type: 'text', name: 'recipient_id', label: 'Recipient' },
  access_level: { type: 'text', name: 'access_level', label: 'Access' },
  active: { type: 'boolean', name: 'active', label: 'Active' },
  managed_by: { type: 'text', name: 'managed_by', label: 'Managed by' },
  customized: { type: 'boolean', name: 'customized', label: 'Customized' },
  created_at: { type: 'text', name: 'created_at', label: 'Created' },
  updated_at: { type: 'text', name: 'updated_at', label: 'Updated' },
};

const ORG_A = 'org_a';
const ORG_B = 'org_b';

const SYSTEM: ExecutionContext = { isSystem: true, positions: [], permissions: [] };

const ORG_A_ADMIN = {
  tenantId: ORG_A,
  positions: [],
  permissions: [],
  systemPermissions: ['manage_sharing'],
} as unknown as ExecutionContext;

interface ShareRow {
  id: string;
  record_id: string;
  organization_id: string | null;
}

interface Booted {
  driver: SqlDriver;
  ql: ObjectQL;
  sharing: SharingService;
  rules: SharingRuleService;
  /** Every `sys_record_share` row, read straight off the driver, keyed by record then id. */
  shares: () => Promise<ShareRow[]>;
}

const open: SqlDriver[] = [];

/**
 * The same five deals `rule-criteria-org-scope.test.ts` reasons about:
 *
 *   deal_a1  ORG_A   stage=won
 *   deal_a2  ORG_A   stage=lost
 *   deal_b1  ORG_B   stage=won
 *   deal_b2  ORG_B   stage=won
 *   deal_p1  (null)  stage=won   <- organization-less; the discriminating record
 */
async function boot(posture?: 'single' | 'isolated' | 'group'): Promise<Booted> {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  open.push(driver);

  const ql = new ObjectQL();
  ql.registerDriver(driver as never, true);
  await ql.init();
  if (posture) ql.setTenancyPostureProvider(() => posture);
  ql.registerObject({ name: OBJECT, label: 'Deal', sharingModel: 'private', fields: DEAL_FIELDS } as never);
  ql.registerObject({ name: 'sys_record_share', label: 'Record Share', isSystem: true, fields: SHARE_FIELDS } as never);
  ql.registerObject({ name: 'sys_sharing_rule', label: 'Sharing Rule', isSystem: true, fields: RULE_FIELDS } as never);
  await driver.initObjects([
    { name: OBJECT, fields: DEAL_FIELDS } as never,
    { name: 'sys_record_share', fields: SHARE_FIELDS } as never,
    { name: 'sys_sharing_rule', fields: RULE_FIELDS } as never,
  ]);

  // Seeded through the driver: the fixture is the DATA at rest.
  await driver.create(OBJECT, { id: 'deal_a1', stage: 'won', owner_id: 'u_a', organization_id: ORG_A } as never);
  await driver.create(OBJECT, { id: 'deal_a2', stage: 'lost', owner_id: 'u_a', organization_id: ORG_A } as never);
  await driver.create(OBJECT, { id: 'deal_b1', stage: 'won', owner_id: 'u_b', organization_id: ORG_B } as never);
  await driver.create(OBJECT, { id: 'deal_b2', stage: 'won', owner_id: 'u_b', organization_id: ORG_B } as never);
  await driver.create(OBJECT, { id: 'deal_p1', stage: 'won', owner_id: 'u_p' } as never);

  const sharing = new SharingService({ engine: ql as never });
  const rules = new SharingRuleService({ engine: ql as never, sharing });

  return {
    driver,
    ql,
    sharing,
    rules,
    shares: async () => {
      const rows = await driver.find('sys_record_share', {} as never);
      return rows
        .map((r: any) => ({ id: String(r.id), record_id: String(r.record_id), organization_id: r.organization_id ?? null }))
        .sort((a, b) => a.record_id.localeCompare(b.record_id) || a.id.localeCompare(b.id));
    },
  };
}

afterEach(async () => {
  while (open.length) await open.pop()?.disconnect?.();
});

const WON = { stage: 'won' };
const byRecord = (rows: ShareRow[]) => Object.fromEntries(rows.map((r) => [r.record_id, r.organization_id]));

describe("[#14484] a rule-materialised grant carries the RULE's organization", () => {
  it("an ORG-STAMPED rule's grants all carry ORG_A — the organization-less record included", async () => {
    const { rules, shares } = await boot();
    const rule = await rules.defineRule(
      { name: 'os14484_org_a_won', label: 'ORG_A won', object: OBJECT, criteria: WON, recipientType: 'user', recipientId: 'u_a', accessLevel: 'read' } as never,
      ORG_A_ADMIN,
    );
    expect(rule.organization_id).toBe(ORG_A);

    await rules.evaluateRule(rule.id, ORG_A_ADMIN);
    const rows = await shares();

    // `deal_p1` is the discriminating row: the RECORD carries no organization,
    // the RULE does, and the ruling says the grant is the rule's.
    expect(byRecord(rows)).toEqual({ deal_a1: ORG_A, deal_p1: ORG_A });
    expect(rows.every((r) => r.organization_id === ORG_A)).toBe(true);
  });

  it("a PLATFORM-GLOBAL rule carries none, so each grant belongs where its RECORD does", async () => {
    const { rules, shares } = await boot();
    const rule = await rules.defineRule(
      { name: 'os14484_platform_won', label: 'Platform won', object: OBJECT, criteria: WON, recipientType: 'user', recipientId: 'u_plat', accessLevel: 'read' } as never,
      SYSTEM,
    );
    expect(rule.organization_id).toBeNull();

    await rules.evaluateRule(rule.id, SYSTEM);

    // Record by record. `deal_p1` stays NULL: nothing to derive from, and on a
    // `single` install with no organization yet the engine has nothing to
    // stamp either (#8844 'no-organization-yet').
    expect(byRecord(await shares())).toEqual({ deal_a1: ORG_A, deal_b1: ORG_B, deal_b2: ORG_B, deal_p1: null });
  });

  it('the per-record hook pass stamps the same way as the whole-rule pass', async () => {
    const { rules, shares } = await boot();
    await rules.defineRule(
      { name: 'os14484_org_a_won_hook', label: 'ORG_A won', object: OBJECT, criteria: WON, recipientType: 'user', recipientId: 'u_a', accessLevel: 'read' } as never,
      ORG_A_ADMIN,
    );
    await rules.evaluateAllForRecord(OBJECT, 'deal_a1', SYSTEM);
    expect(byRecord(await shares())).toEqual({ deal_a1: ORG_A });
  });
});

describe("[#14484] a direct grant carries the RECORD's organization", () => {
  it("an owner sharing their record stamps the record's organization, whatever the caller carries", async () => {
    const { sharing, shares } = await boot();
    // The caller threads NO organization at all — the only place ORG_A can
    // come from is the record.
    await sharing.grant({ object: OBJECT, recordId: 'deal_a1', recipientId: 'u_x' }, { userId: 'u_a' } as never);
    expect(byRecord(await shares())).toEqual({ deal_a1: ORG_A });
  });

  it("an organization-less record falls back to the acting session's organization", async () => {
    const { sharing, shares } = await boot();
    // `deal_p1` is reachable to an ORG_B session through the driver's
    // compatibility arm; the record has nothing to give, the session does.
    await sharing.grant(
      { object: OBJECT, recordId: 'deal_p1', recipientId: 'u_x' },
      { userId: 'u_p', tenantId: ORG_B } as never,
    );
    expect(byRecord(await shares())).toEqual({ deal_p1: ORG_B });
  });

  it('the update half stamps a pre-repair NULL row in place', async () => {
    const { driver, sharing, shares } = await boot();
    await driver.create('sys_record_share', {
      id: 'shr_legacy', object_name: OBJECT, record_id: 'deal_a1', recipient_type: 'user', recipient_id: 'u_x',
      access_level: 'read', source: 'manual', created_at: '2026-01-01T00:00:00Z',
    } as never);
    expect(byRecord(await shares())).toEqual({ deal_a1: null });

    const r = await sharing.grant(
      { object: OBJECT, recordId: 'deal_a1', recipientId: 'u_x', accessLevel: 'edit' },
      { userId: 'u_a' } as never,
    );
    expect(r.id).toBe('shr_legacy');
    const rows = await shares();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organization_id).toBe(ORG_A);
  });
});

describe('[#14484] the backfill on a real driver — derived from the record, orphans left NULL and counted', () => {
  it('stamps every row that references a live organization-scoped record, twice is a no-op', async () => {
    const { driver, ql, shares } = await boot();
    const legacy = (id: string, record: string) => ({
      id, object_name: OBJECT, record_id: record, recipient_type: 'user', recipient_id: 'u_x',
      access_level: 'read', source: 'manual', created_at: '2026-01-01T00:00:00Z',
    });
    await driver.create('sys_record_share', legacy('shr_a1', 'deal_a1') as never);
    await driver.create('sys_record_share', legacy('shr_b1', 'deal_b1') as never);
    await driver.create('sys_record_share', legacy('shr_gone', 'deal_gone') as never);
    await driver.create('sys_record_share', legacy('shr_p1', 'deal_p1') as never);

    const warn = vi.fn();
    const first = await runSysRecordShareOrganizationBackfill(ql as never, { dryRun: false, logger: { warn } });
    expect(first.scanned).toBe(4);
    expect(first.written).toBe(2);
    expect(first.residue).toMatchObject({ recordNotFound: 1, recordHasNoOrganization: 1 });
    expect(first.totals).toMatchObject({ orphans: 1, residualNull: 2 });
    // The orphan count is LOGGED, as the ruling asks, and the row is NOT deleted.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/1 grant row\(s\) reference a record that no longer exists/);

    const rows = await shares();
    expect(rows.map((r) => [r.id, r.organization_id])).toEqual([
      ['shr_a1', ORG_A],
      ['shr_b1', ORG_B],
      ['shr_gone', null],
      ['shr_p1', null],
    ]);

    // Idempotent: the repaired rows no longer match `IS NULL`; the residue is re-reported, not re-written.
    const second = await runSysRecordShareOrganizationBackfill(ql as never, { dryRun: false });
    expect(second).toMatchObject({ scanned: 2, planned: 0, written: 0 });
    expect(second.totals.orphans).toBe(1);
  });
});

describe('[#14484] the ledger flip alone would REFUSE walled-posture grants — the repaired writer carries through it', () => {
  it.each(['isolated', 'group'] as const)(
    '%s posture: a bare system insert with no organization is refused loudly',
    async (posture) => {
      const { ql, shares } = await boot(posture);
      await expect(
        ql.insert(
          'sys_record_share',
          { id: 'shr_bare', object_name: OBJECT, record_id: 'deal_a1', recipient_type: 'user', recipient_id: 'u_x', access_level: 'read', source: 'manual' },
          { context: SYSTEM } as never,
        ),
      ).rejects.toMatchObject({ code: 'ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED', status: 500 });
      expect(await shares()).toEqual([]);
    },
  );

  it.each(['isolated', 'group'] as const)(
    "%s posture: the rule evaluator's grant carries the rule's organization and is NOT refused",
    async (posture) => {
      const { sharing, shares } = await boot(posture);
      await sharing.grant(
        { object: OBJECT, recordId: 'deal_a1', recipientId: 'u_x', source: 'rule', sourceId: 'rule_1' },
        { ...SYSTEM, tenantId: ORG_A } as never,
      );
      expect(byRecord(await shares())).toEqual({ deal_a1: ORG_A });
    },
  );

  it("isolated posture: an owner's direct grant carries the record's organization and is NOT refused", async () => {
    const { sharing, shares } = await boot('isolated');
    await sharing.grant(
      { object: OBJECT, recordId: 'deal_a1', recipientId: 'u_x' },
      { userId: 'u_a', tenantId: ORG_A } as never,
    );
    expect(byRecord(await shares())).toEqual({ deal_a1: ORG_A });
  });
});
