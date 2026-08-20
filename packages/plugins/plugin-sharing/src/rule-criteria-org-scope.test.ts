// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10119] A sharing rule's CRITERIA sweep is scoped to the rule's own
 * organization — and a platform-global rule's is still not.
 *
 * ## The defect
 *
 * `SharingRuleService.findMatchingRecords` / `recordMatches` ran the rule's
 * criteria query under a bare `SYSTEM_CTX` carrying no tenant, for EVERY rule.
 * The recipient half was already org-aware (`expandRecipient` threads
 * `rule.organization_id` into `TeamGraphService` / `BusinessUnitGraphService` /
 * `PositionGraphService`), so an org-stamped rule expanded recipients inside
 * its own organization and then swept every organization's records for
 * matches. `reconcile` materialised the cross product: `sys_record_share` rows
 * granting one org's users access to another org's records.
 *
 * ## Why this asserts rows AT REST rather than a read probe
 *
 * Those rows are INERT today. The Layer-0 tenant wall AND-composes over
 * sharing's Layer-1 widening, so a cross-org grant cannot open a read across
 * the wall. A "can this principal read it" probe therefore shows nothing on
 * either side of the fix and would read as "no defect". What is wrong is the
 * materialised population itself — `sys_record_share` bloat now, and rows that
 * become load-bearing the day anything reads that table directly or the wall
 * softens. So every assertion below reads `sys_record_share` straight off the
 * driver, unscoped, and asks which records were granted.
 *
 * ## Why a real driver
 *
 * The scope is a DRIVER decision: `SqlDriver.applyTenantScope` turns
 * `DriverOptions.tenantId` into `(organization_id = ? OR organization_id IS
 * NULL)`, and the engine only threads it when `execCtx.tenantId` is set on a
 * non-federated, tenancy-enabled object (`ObjectQLEngine.buildDriverOptions`).
 * A hand-written engine double proves none of that chain — it would report
 * green on a `tenantId` the real stack never applies. So these cases run a real
 * `SqlDriver` on better-sqlite3 `:memory:` behind a real `ObjectQL`, the way
 * `share-link-eligibility.test.ts` and `read-scope-provenance-mark.test.ts`
 * already do in this package.
 *
 * ## Both directions, deliberately
 *
 * A suite that only pinned "an org-stamped rule stops sweeping other orgs"
 * would stay green against an implementation that scoped EVERY rule — silently
 * killing the platform-global sweep that `organization_id = null` rules are
 * declared to perform (#7795, documented at the `deleteRule` guard). So each
 * org-stamped case is stated beside the null-org case it must not become.
 *
 * The NULL-org RECORD is here for the third direction: `applyTenantScope`
 * emits `field = ? OR field IS NULL` on purpose (#2734 — a bare equality hid
 * every platform-seeded row from every tenant). A scope "fixed" with a bare
 * equality would pass the cross-org assertions and silently lose the platform
 * record, so `deal_p1` is what distinguishes routing through the chokepoint
 * from reimplementing a worse copy of it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { ExecutionContext } from '@objectstack/spec/kernel';

import { SharingService } from './sharing-service.js';
import { SharingRuleService } from './sharing-rule-service.js';

const OBJECT = 'os10119_deal';

const DEAL_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id', label: 'Id', primary: true },
  stage: { type: 'text', name: 'stage', label: 'Stage' },
  owner_id: { type: 'text', name: 'owner_id', label: 'Owner' },
  organization_id: { type: 'text', name: 'organization_id', label: 'Org' },
};

const SHARE_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id', label: 'Id', primary: true },
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

/** The evaluator's own elevation — what every internal pass already carries. */
const SYSTEM: ExecutionContext = { isSystem: true, positions: [], permissions: [] };

/** An ORG_A sharing administrator — what stamps `organization_id` on a rule. */
const ORG_A_ADMIN = {
  tenantId: ORG_A,
  positions: [],
  permissions: [],
  systemPermissions: ['manage_sharing'],
} as unknown as ExecutionContext;

interface Booted {
  driver: SqlDriver;
  ql: ObjectQL;
  rules: SharingRuleService;
  /** Every `sys_record_share` row in the database, read straight off the driver. */
  sharedRecordIds: () => Promise<string[]>;
}

const open: SqlDriver[] = [];

/**
 * A fresh database, engine and rule service, seeded with the same five deals
 * every case reasons about:
 *
 *   deal_a1  ORG_A   stage=won    <- ORG_A's own match
 *   deal_a2  ORG_A   stage=lost   <- ORG_A's own non-match (criteria still bite)
 *   deal_b1  ORG_B   stage=won    <- the cross-org match this card is about
 *   deal_b2  ORG_B   stage=won    <- second one, so a count cannot pass by luck
 *   deal_p1  (null)  stage=won    <- platform row: belongs to no tenant, so it
 *                                    belongs to no OTHER tenant either (#2734)
 */
async function boot(): Promise<Booted> {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  open.push(driver);

  const ql = new ObjectQL();
  ql.registerDriver(driver as never, true);
  await ql.init();
  ql.registerObject({
    name: OBJECT,
    label: 'Deal',
    sharingModel: 'private',
    fields: DEAL_FIELDS,
  } as never);
  ql.registerObject({
    name: 'sys_record_share',
    label: 'Record Share',
    isSystem: true,
    fields: SHARE_FIELDS,
  } as never);
  ql.registerObject({
    name: 'sys_sharing_rule',
    label: 'Sharing Rule',
    isSystem: true,
    fields: RULE_FIELDS,
  } as never);
  await driver.initObjects([
    { name: OBJECT, fields: DEAL_FIELDS } as never,
    { name: 'sys_record_share', fields: SHARE_FIELDS } as never,
    { name: 'sys_sharing_rule', fields: RULE_FIELDS } as never,
  ]);

  // Seeded through the driver, not the engine: the fixture is the DATA at
  // rest, and routing it through the engine's write path would drag the
  // system-write organization rules (#8844) into a card about reads.
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
    rules,
    sharedRecordIds: async () => {
      const rows = await driver.find('sys_record_share', {} as never);
      return rows.map((r: any) => String(r.record_id)).sort();
    },
  };
}

afterEach(async () => {
  while (open.length) await open.pop()?.disconnect?.();
});

/** `criteria` every seeded `won` deal matches, in every organization. */
const WON = { stage: 'won' };

describe('[#10119] sharing-rule criteria sweep is scoped to the rule\'s organization', () => {
  describe('findMatchingRecords — the whole-rule evaluation pass', () => {
    it('an ORG-STAMPED rule materialises NO grant on another organization\'s records', async () => {
      const { rules, sharedRecordIds } = await boot();

      const rule = await rules.defineRule(
        {
          name: 'os10119_org_a_won',
          label: 'ORG_A won deals',
          object: OBJECT,
          criteria: WON,
          recipientType: 'user',
          recipientId: 'u_a',
          accessLevel: 'read',
        } as never,
        ORG_A_ADMIN,
      );
      expect(rule.organization_id).toBe(ORG_A);

      const result = await rules.evaluateRule(rule.id, ORG_A_ADMIN);
      const granted = await sharedRecordIds();

      // ORG_B's records are the defect. Stated as their own assertion so a
      // failure names them rather than printing a set diff.
      expect(granted).not.toContain('deal_b1');
      expect(granted).not.toContain('deal_b2');
      // ORG_A's own match, plus the null-org platform row the tenant
      // chokepoint deliberately keeps visible (#2734). `deal_a2` is absent
      // because the CRITERIA still bite — scoping did not replace them.
      expect(granted).toEqual(['deal_a1', 'deal_p1']);
      expect(result.matchedRecords).toBe(2);
    });

    it('a NULL-ORG (platform-global) rule still sweeps EVERY organization', async () => {
      const { rules, sharedRecordIds } = await boot();

      // Defined under the system context, which is what stamps
      // `organization_id: null` — the platform-global class (#7795).
      const rule = await rules.defineRule(
        {
          name: 'os10119_platform_won',
          label: 'Platform won deals',
          object: OBJECT,
          criteria: WON,
          recipientType: 'user',
          recipientId: 'u_plat',
          accessLevel: 'read',
        } as never,
        SYSTEM,
      );
      expect(rule.organization_id).toBeNull();

      const result = await rules.evaluateRule(rule.id, SYSTEM);
      const granted = await sharedRecordIds();

      // The declared platform-global behaviour, pinned so scoping the
      // org-stamped case above cannot quietly take it away.
      expect(granted).toEqual(['deal_a1', 'deal_b1', 'deal_b2', 'deal_p1']);
      expect(result.matchedRecords).toBe(4);
    });
  });

  describe('recordMatches — the per-record write-hook pass', () => {
    it('an ORG-STAMPED rule does not match another organization\'s record', async () => {
      const { rules, sharedRecordIds } = await boot();

      await rules.defineRule(
        {
          name: 'os10119_org_a_won_hook',
          label: 'ORG_A won deals',
          object: OBJECT,
          criteria: WON,
          recipientType: 'user',
          recipientId: 'u_a',
          accessLevel: 'read',
        } as never,
        ORG_A_ADMIN,
      );

      // The afterInsert/afterUpdate shape: one record, every rule on the
      // object. `deal_b1` belongs to ORG_B and this rule to ORG_A.
      const results = await rules.evaluateAllForRecord(OBJECT, 'deal_b1', SYSTEM);

      expect(results).toHaveLength(1);
      expect(results[0]!.grantsCreated).toBe(0);
      expect(await sharedRecordIds()).toEqual([]);
    });

    it('a NULL-ORG rule still matches every organization\'s record', async () => {
      const { rules, sharedRecordIds } = await boot();

      await rules.defineRule(
        {
          name: 'os10119_platform_won_hook',
          label: 'Platform won deals',
          object: OBJECT,
          criteria: WON,
          recipientType: 'user',
          recipientId: 'u_plat',
          accessLevel: 'read',
        } as never,
        SYSTEM,
      );

      const results = await rules.evaluateAllForRecord(OBJECT, 'deal_b1', SYSTEM);

      expect(results).toHaveLength(1);
      expect(results[0]!.grantsCreated).toBe(1);
      expect(await sharedRecordIds()).toEqual(['deal_b1']);
    });
  });
});
