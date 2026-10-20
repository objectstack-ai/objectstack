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
 * `DriverOptions.tenantId` into `organization_id = ?`, and the engine threads it as the projection of the tenant wall's
 * verdict (ADR-0131 D8, `ObjectQLEngine.buildDriverOptions`) — so only under
 * a walled posture: the org-stamped cases boot `isolated`, and under `single`
 * there is no organization scope for a sweep to keep.
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
 * killing the deployment-wide sweep a DECLARED rule performs under `single`.
 * So each org-stamped case is stated beside the deployment-wide case it must
 * not become.
 *
 * ## [ADR-0131 D2/D8] Deployment-wide is a typed marker, never a NULL
 *
 * The rule class these cases used to pin beside the org-stamped one was the
 * "platform-global" `organization_id = null` row (#7795), swept unscoped.
 * That branch is retired. A declared rule is deployment-wide by nature (D2)
 * and carries a typed marker on its `single` projection; under a wall it is
 * served once per organization, each projection inside that organization's
 * one predicate (D8). A STORED row with no organization, in a deployment that
 * has organizations, is invalid state (certification leaves none): it sweeps
 * nothing and grants nothing, said once, loudly. Only a composition with no
 * organization object at all (a lean embedding) has no organization to scope
 * by, and there every rule is the deployment's.
 *
 * The NULL-org RECORD is here for the third direction. [ADR-0131 D1, D14]
 * NULL is not an owner: `applyTenantScope` emits `field = ?` alone, since 18.x
 * retired the v17 `OR field IS NULL` arm after the upgrade ceremony, so an
 * org-stamped sweep routed through the chokepoint does NOT reach `deal_p1`,
 * while the platform-global sweep, which carries no scope, still does. A sweep
 * that kept its own copy of the retired arm would grant it.
 *
 * ## What `deal_p1` does and does NOT assert (#10103)
 *
 * It used to be justified as the platform bucket: a NULL organization marked a
 * platform row that had to stay visible to every tenant (#2734, ADR-0120 D3).
 * The ruling on #10103 superseded that reading (a row belonging to no
 * organization is INVALID STATE, never a platform-wide default) and kept the
 * arm as a driver-level compatibility note; ADR-0131 D14 retired the note with
 * the ceremony that removes the rows it served. `deal_p1` stays as the record
 * no organization's sweep reaches: a certified database holds no such row, so
 * this is the shape a stray one would take, not a population a tenant relies on.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { ExecutionContext } from '@objectstack/spec/kernel';

import { SharingService } from './sharing-service.js';
import { SharingRuleService } from './sharing-rule-service.js';
import type { DeclaredSharingRule } from './declared-sharing-rules.js';

const OBJECT = 'os10119_deal';

const DEAL_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id', label: 'Id', primary: true },
  stage: { type: 'text', name: 'stage', label: 'Stage' },
  owner_id: { type: 'text', name: 'owner_id', label: 'Owner' },
  organization_id: { type: 'text', name: 'organization_id', label: 'Org' },
};

const SHARE_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id', label: 'Id', primary: true },
  // [commit 3f64fe6c6] The tenant column the registry provisions on every platform
  // object (`applySystemFields`); this hand-built table must declare it too,
  // now that the writer stamps it — the fixture was never spec-faithful
  // without it, the omission just had no reader.
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
  /** `[record_id, organization_id]` of every `sys_record_share` row, sorted. */
  grantsAtRest: () => Promise<Array<[string, unknown]>>;
  /** What the rule service logged at `error`. */
  errors: string[];
}

/** A DECLARED rule, as the registry serves it: `won` deals to `u_decl`. */
const DECLARED: DeclaredSharingRule = {
  name: 'os10119_declared_won',
  label: 'Declared won deals',
  description: null,
  object: OBJECT,
  criteria: { stage: 'won' },
  recipientType: 'user',
  recipientId: 'u_decl',
  accessLevel: 'read',
  active: true,
};

interface BootOptions {
  /** Register `sys_organization`: a deployment WITH organizations, not a lean embedding. */
  organizations?: boolean;
  /** Declared rules the registry serves. */
  declared?: DeclaredSharingRule[];
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
 *   deal_p1  (null)  stage=won    <- organization-less row: no org-stamped
 *                                    sweep reaches it (ADR-0131 D1), the
 *                                    platform-global one does — see the header.
 */
async function boot(posture?: 'single' | 'isolated' | 'group', opts: BootOptions = {}): Promise<Booted> {
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
  if (opts.organizations) {
    ql.registerObject({
      name: 'sys_organization',
      label: 'Organization',
      isSystem: true,
      fields: { id: { type: 'text', name: 'id', label: 'Id', primary: true }, name: { type: 'text', name: 'name', label: 'Name' } },
    } as never);
  }
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
  const errors: string[] = [];
  const rules = new SharingRuleService({
    engine: ql as never,
    sharing,
    ...(opts.declared ? { declaredRules: { list: async () => opts.declared! } } : {}),
    logger: { warn: () => {}, error: (m: unknown) => { errors.push(String(m)); } },
  });

  return {
    driver,
    ql,
    rules,
    errors,
    sharedRecordIds: async () => {
      const rows = await driver.find('sys_record_share', {} as never);
      return rows.map((r: any) => String(r.record_id)).sort();
    },
    grantsAtRest: async () => {
      const rows = await driver.find('sys_record_share', {} as never);
      return rows
        .map((r: any): [string, unknown] => [String(r.record_id), r.organization_id ?? null])
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
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
      // [ADR-0131 D8] An organization wall is what scopes the sweep: the
      // driver's read scope is the wall's verdict, and under `single` (the
      // env default) there is none — one tenant, one sweep.
      const { rules, sharedRecordIds } = await boot('isolated');

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
      // ORG_A's own match, and not the organization-less row: NULL is not an
      // owner (ADR-0131 D1), so the scope routed through the chokepoint does
      // not reach `deal_p1` — see this file's header. `deal_a2` is absent
      // because the CRITERIA still bite — scoping did not replace them.
      expect(granted).not.toContain('deal_p1');
      expect(granted).toEqual(['deal_a1']);
      expect(result.matchedRecords).toBe(1);
    });

    it('a DECLARED rule under `single` is deployment-wide: it sweeps every organization, each grant its record\'s', async () => {
      // [ADR-0131 D2/D8] The typed marker's sweep carries no tenant — the
      // predicate D8 computes under `single` is none — and each grant is
      // stamped with the organization of the record it shares.
      const { rules, grantsAtRest } = await boot(undefined, { declared: [DECLARED] });

      const result = await rules.evaluateRule(DECLARED.name, SYSTEM);

      expect(result.matchedRecords).toBe(4);
      expect(await grantsAtRest()).toEqual([
        ['deal_a1', ORG_A],
        ['deal_b1', ORG_B],
        ['deal_b2', ORG_B],
        ['deal_p1', null],
      ]);
    });

    it('a DECLARED rule under a wall is served per organization: each projection sweeps only its own', async () => {
      // [ADR-0131 D8] No projection sweeps the deployment under a wall: one
      // per organization, each inside that organization's one predicate, its
      // grants stamped with it. The organization-less RECORD `deal_p1` is
      // removed first: a certified database holds none, and whether one
      // answers a tenant read is the driver's predicate, not the rule service's.
      const { driver, rules, grantsAtRest } = await boot('isolated', { declared: [DECLARED] });
      await driver.delete(OBJECT, 'deal_p1');
      rules.setDeclaredRuleScopes([ORG_A, ORG_B]);

      await rules.evaluateRule(DECLARED.name, SYSTEM);

      expect(await grantsAtRest()).toEqual([
        ['deal_a1', ORG_A],
        ['deal_b1', ORG_B],
        ['deal_b2', ORG_B],
      ]);
    });

    it('a STORED rule with NO organization, in a deployment with organizations, sweeps nothing and says so once', async () => {
      // Invalid state — certification leaves no such row, and the engine
      // stamps or refuses every new one (D9) — so it is planted through the
      // driver. ⛔ It must not become the deployment-wide sweep: that is the
      // NULL arm the marker replaced.
      const { driver, rules, sharedRecordIds, errors } = await boot(undefined, { organizations: true });
      await driver.create('sys_sharing_rule', {
        id: 'srule_orgless', name: 'os10119_orgless_won', label: 'Org-less won deals', object_name: OBJECT,
        criteria_json: JSON.stringify(WON), recipient_type: 'user', recipient_id: 'u_plat', access_level: 'read',
        active: true, managed_by: 'admin', customized: false,
      } as never);

      const result = await rules.evaluateRule('srule_orgless', SYSTEM);
      await rules.evaluateRule('srule_orgless', SYSTEM);

      expect(result.matchedRecords).toBe(0);
      expect(result.grantsCreated).toBe(0);
      expect(await sharedRecordIds()).toEqual([]);
      expect(errors.filter((m) => m.includes("'os10119_orgless_won' is a stored row with no organization"))).toHaveLength(1);
    });

    it('CONTROL: a composition with NO organization object (a lean embedding) sweeps the deployment for that row', async () => {
      // The one composition with no organization to scope by
      // (`no-organization-object`): there every rule is the deployment's.
      const { rules, sharedRecordIds, errors } = await boot();

      const rule = await rules.defineRule(
        {
          name: 'os10119_lean_won',
          label: 'Lean won deals',
          object: OBJECT,
          criteria: WON,
          recipientType: 'user',
          recipientId: 'u_plat',
          accessLevel: 'read',
        } as never,
        SYSTEM,
      );

      const result = await rules.evaluateRule(rule.id, SYSTEM);
      expect(result.matchedRecords).toBe(4);
      expect(await sharedRecordIds()).toEqual(['deal_a1', 'deal_b1', 'deal_b2', 'deal_p1']);
      expect(errors).toEqual([]);
    });
  });

  describe('recordMatches — the per-record write-hook pass', () => {
    it('an ORG-STAMPED rule does not match another organization\'s record', async () => {
      // [ADR-0131 D8] Under a wall — see the whole-rule pass above.
      const { rules, sharedRecordIds } = await boot('isolated');

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

    it('a DECLARED rule under `single` matches every organization\'s record', async () => {
      const { rules, grantsAtRest } = await boot(undefined, { declared: [DECLARED] });

      const results = await rules.evaluateAllForRecord(OBJECT, 'deal_b1', SYSTEM);

      expect(results).toHaveLength(1);
      expect(results[0]!.grantsCreated).toBe(1);
      expect(await grantsAtRest()).toEqual([['deal_b1', ORG_B]]);
    });

    it('a STORED rule with NO organization matches no record where the deployment has organizations', async () => {
      const { driver, rules, sharedRecordIds } = await boot(undefined, { organizations: true });
      await driver.create('sys_sharing_rule', {
        id: 'srule_orgless_hook', name: 'os10119_orgless_won_hook', label: 'Org-less won deals', object_name: OBJECT,
        criteria_json: JSON.stringify(WON), recipient_type: 'user', recipient_id: 'u_plat', access_level: 'read',
        active: true, managed_by: 'admin', customized: false,
      } as never);

      const results = await rules.evaluateAllForRecord(OBJECT, 'deal_b1', SYSTEM);

      expect(results).toHaveLength(1);
      expect(results[0]!.grantsCreated).toBe(0);
      expect(await sharedRecordIds()).toEqual([]);
    });
  });
});
