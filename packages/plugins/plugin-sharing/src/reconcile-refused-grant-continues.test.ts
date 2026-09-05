// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14754] One refused grant no longer takes a rule's whole reconcile pass with
 * it — and, above all, no longer takes that pass's STALE-ROW REVOCATIONS.
 *
 * ## The shape, and which half of it is the security half
 *
 * After #14484 `sys_record_share` is `tenant-scoped` in the #13491 ledger, so
 * on a walled install an organization-less system insert on it is refused
 * loudly with `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` (#8844).
 * `SharingService.grant` resolves the organization on every path that can; a
 * platform-global rule (`organization_id = null`, its sweep unscoped)
 * materialising onto an organization-LESS record resolves none, and meets the
 * refusal.
 *
 * Before this card the refusal propagated out of the reconcile loop and that
 * rule's pass ABORTED mid-loop. Two things were lost, and they are not equally
 * serious:
 *
 *  - the remaining grants — recoverable, the next pass writes them;
 *  - **the stale-row revocations of that pass** — NOT recoverable by waiting,
 *    because every subsequent pass meets the same organization-less record and
 *    dies at the same place. A stale over-grant of that rule therefore persists
 *    indefinitely. That is the security half, and it is pinned SEPARATELY
 *    below: a catch that swallowed the refusal and then skipped the revocation
 *    anyway would satisfy the "pass continued" half while leaving the defect
 *    exactly where it was.
 *
 * ## Why a real driver and a real engine
 *
 * The refusal under test is the ENGINE's, raised inside
 * `Engine.resolveSystemInsertOrganization` from the ledger classification and
 * the deployment posture. A fake engine would have to imitate the very thing
 * whose behaviour decides the case. So these cases run a real `SqlDriver` on
 * better-sqlite3 `:memory:` behind a real `ObjectQL` on an `isolated` posture,
 * the way `record-share-organization-stamp.test.ts` does for the #14484 stamp.
 *
 * ## Why the fixture's organization-less record is in the MIDDLE
 *
 * "The pass continued" is only observable if a grant was still ATTEMPTED after
 * the refused one. The sweep returns the matched records in insertion order, so
 * the fixture inserts `rec_orgless` second of three matching records — and the
 * attempt order is asserted rather than assumed, because a fixture that
 * silently reordered would turn this pin into a tautology.
 *
 * ## The catch is NARROW, and one case here holds that line
 *
 * Only `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` is absorbed. The last case
 * feeds the loop a DIFFERENT engine error and pins that it still propagates —
 * the same direction `record-share-organization-stamp.test.ts` pins for the
 * scoped-update `RECORD_NOT_FOUND` shape the 2026-09-02 review left standing.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { ExecutionContext } from '@objectstack/spec/kernel';

import { SharingService } from './sharing-service.js';
import { SharingRuleService } from './sharing-rule-service.js';

const OBJECT = 'os14754_deal';
const ORG_A = 'org_a';
const ORG_B = 'org_b';

const SYSTEM: ExecutionContext = { isSystem: true, positions: [], permissions: [] };
const WON = { stage: 'won' };

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

interface ShareRow {
  id: string;
  record_id: string;
  recipient_id: string;
  organization_id: string | null;
  source_id: string | null;
}

const open: SqlDriver[] = [];

/**
 * Five records. MEASURED sweep order (not insertion order — see below):
 *
 *   rec_first     ORG_A   won    grant lands
 *   rec_last      ORG_B   won    grant lands
 *   rec_orgless   (null)  won    grant REFUSED on a walled posture
 *   rec_orgless_2 (null)  won    grant REFUSED — attempted ONLY if the pass continued
 *   rec_stale     ORG_A   lost   not matched; carries the stale row that must be REVOKED
 *
 * ⚠️ Measured on this fixture: the engine returns the organization-LESS rows
 * LAST, after every organization-carrying row, whatever the insertion order
 * (raw driver order is `rec_first, rec_orgless, rec_last, …`; the engine's
 * filtered read answers `rec_first, rec_last, rec_orgless, …`). That is the
 * driver's NULL-org compatibility arm being appended to the scoped arm, the
 * same "and — through the driver's compatibility arm — deal_p1, in that order"
 * `record-share-organization-stamp.test.ts` records.
 *
 * The consequence matters for this card and is why the fixture holds TWO
 * organization-less records: on the real shape a refused grant is usually one
 * of the LAST attempts of the pass, so what an abort destroyed was hardly ever
 * "the remaining grants" — it was almost entirely the STALE-ROW REVOCATIONS
 * that run after the whole upsert loop. The security half is not merely the
 * more serious half, it is very nearly the ONLY half. A second refusal is
 * therefore the order-independent witness that the loop survived the first.
 */
async function boot(posture: 'single' | 'isolated' | 'group' = 'isolated') {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  open.push(driver);

  const ql = new ObjectQL();
  ql.registerDriver(driver as never, true);
  await ql.init();
  ql.setTenancyPostureProvider(() => posture);
  ql.registerObject({ name: OBJECT, label: 'Deal', sharingModel: 'private', fields: DEAL_FIELDS } as never);
  ql.registerObject({ name: 'sys_record_share', label: 'Record Share', isSystem: true, fields: SHARE_FIELDS } as never);
  ql.registerObject({ name: 'sys_sharing_rule', label: 'Sharing Rule', isSystem: true, fields: RULE_FIELDS } as never);
  await driver.initObjects([
    { name: OBJECT, fields: DEAL_FIELDS } as never,
    { name: 'sys_record_share', fields: SHARE_FIELDS } as never,
    { name: 'sys_sharing_rule', fields: RULE_FIELDS } as never,
  ]);

  await driver.create(OBJECT, { id: 'rec_first', stage: 'won', owner_id: 'u_a', organization_id: ORG_A } as never);
  await driver.create(OBJECT, { id: 'rec_orgless', stage: 'won', owner_id: 'u_p' } as never);
  await driver.create(OBJECT, { id: 'rec_last', stage: 'won', owner_id: 'u_b', organization_id: ORG_B } as never);
  await driver.create(OBJECT, { id: 'rec_orgless_2', stage: 'won', owner_id: 'u_p' } as never);
  await driver.create(OBJECT, { id: 'rec_stale', stage: 'lost', owner_id: 'u_a', organization_id: ORG_A } as never);

  const warn = vi.fn();
  const sharing = new SharingService({ engine: ql as never });
  const rules = new SharingRuleService({ engine: ql as never, sharing, logger: { warn } });

  return {
    driver,
    ql,
    sharing,
    rules,
    warn,
    /** Every `sys_record_share` row, read straight off the driver. */
    shares: async (): Promise<ShareRow[]> => {
      const rows = (await driver.find('sys_record_share', {} as never)) as any[];
      return rows
        .map((r) => ({
          id: String(r.id),
          record_id: String(r.record_id),
          recipient_id: String(r.recipient_id),
          organization_id: r.organization_id ?? null,
          source_id: r.source_id ?? null,
        }))
        .sort((a, b) => a.record_id.localeCompare(b.record_id) || a.recipient_id.localeCompare(b.recipient_id));
    },
    /** A pre-existing rule grant the next pass should find stale and revoke. */
    seedStaleRow: (id: string, recordId: string, ruleId: string, recipientId = 'u_plat', organizationId: string | null = ORG_A) =>
      driver.create('sys_record_share', {
        id,
        object_name: OBJECT,
        record_id: recordId,
        recipient_type: 'user',
        recipient_id: recipientId,
        access_level: 'read',
        source: 'rule',
        source_id: ruleId,
        ...(organizationId ? { organization_id: organizationId } : {}),
        created_at: '2026-01-01T00:00:00Z',
      } as never),
    /** Records the recordId of every grant ATTEMPT, in order, and calls through. */
    traceGrants: () => {
      const attempted: string[] = [];
      const original = sharing.grant.bind(sharing);
      vi.spyOn(sharing, 'grant').mockImplementation((async (input: any, ctx: any) => {
        attempted.push(String(input.recordId));
        return original(input, ctx);
      }) as never);
      return attempted;
    },
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  while (open.length) await open.pop()?.disconnect?.();
});

const platformGlobalRule = (rules: SharingRuleService, name: string, accessLevel: 'read' | 'edit' = 'read') =>
  rules.defineRule(
    {
      name,
      label: 'Platform won',
      object: OBJECT,
      criteria: WON,
      recipientType: 'user',
      recipientId: 'u_plat',
      accessLevel,
    } as never,
    SYSTEM,
  );

describe('[#14754] reconcile: a refused grant is counted and the pass CONTINUES', () => {
  it('CONTROL: on an `isolated` posture the organization-less record really is refused — the precondition, measured', async () => {
    const { ql, shares } = await boot('isolated');
    await expect(
      ql.insert(
        'sys_record_share',
        {
          id: 'shr_bare',
          object_name: OBJECT,
          record_id: 'rec_orgless',
          recipient_type: 'user',
          recipient_id: 'u_plat',
          access_level: 'read',
          source: 'rule',
        },
        { context: SYSTEM } as never,
      ),
    ).rejects.toMatchObject({ code: 'ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED', status: 500 });
    expect(await shares()).toEqual([]);
  });

  it('HALF 1 — the pass does not abort: the refusal is counted, and the grant AFTER it still lands', async () => {
    const { rules, shares } = await boot('isolated');
    const rule = await platformGlobalRule(rules, 'os14754_continues');
    expect(rule.organization_id).toBeNull();

    const result = await rules.evaluateRule(rule.id, SYSTEM);

    // It RESOLVED. Before this card it REJECTED with the engine's refusal.
    expect(result.grantsRefused).toBe(2);
    expect(result.grantsCreated).toBe(2);
    expect(result.matchedRecords).toBe(4);

    // Both organization-carrying records got their grant; neither refused one has any.
    const rows = await shares();
    expect(rows.map((r) => [r.record_id, r.organization_id])).toEqual([
      ['rec_first', ORG_A],
      ['rec_last', ORG_B],
    ]);
  });

  it('HALF 1, continuation witness — a grant is still ATTEMPTED after the first refusal', async () => {
    const booted = await boot('isolated');
    const rule = await platformGlobalRule(booted.rules, 'os14754_order');
    const attempted = booted.traceGrants();

    const result = await booted.rules.evaluateRule(rule.id, SYSTEM);

    // The measured order — organization-carrying rows first, the NULL-org
    // compatibility arm appended. Asserted rather than assumed, so a change in
    // the engine's read shape shows up here instead of quietly turning the
    // relation below into a tautology.
    expect(attempted).toEqual(['rec_first', 'rec_last', 'rec_orgless', 'rec_orgless_2']);

    // The load-bearing relation: the FIRST refusal is not the last attempt of
    // the pass, and the attempt after it was made. A pass that aborted at the
    // first refusal could not have attempted `rec_orgless_2` at all, and could
    // not have counted two refusals.
    const firstRefusalAt = attempted.indexOf('rec_orgless');
    expect(firstRefusalAt).toBeLessThan(attempted.length - 1);
    expect(result.grantsRefused).toBe(2);
  });

  it('HALF 2 (the security half) — the STALE ROW of that same pass is REVOKED', async () => {
    const { rules, shares, seedStaleRow } = await boot('isolated');
    const rule = await platformGlobalRule(rules, 'os14754_revokes');

    // `rec_stale` is `lost`, so the rule does not match it: a completed pass
    // revokes its leftover grant. It is the witness that the pass reached its
    // revoke loop at all.
    await seedStaleRow('shr_stale', 'rec_stale', rule.id);
    expect((await shares()).map((r) => r.id)).toEqual(['shr_stale']);

    const result = await rules.evaluateRule(rule.id, SYSTEM);

    expect(result.grantsRevoked).toBe(1);
    expect(result.grantsRefused).toBe(2);
    // The row is GONE from the table — not merely counted.
    const rows = await shares();
    expect(rows.map((r) => r.id)).not.toContain('shr_stale');
    expect(rows.map((r) => r.record_id)).toEqual(['rec_first', 'rec_last']);
  });

  it('the refusal is LOGGED with the rule, object, record and the engine code', async () => {
    const { rules, warn } = await boot('isolated');
    const rule = await platformGlobalRule(rules, 'os14754_logs');

    await rules.evaluateRule(rule.id, SYSTEM);

    const refusals = warn.mock.calls.filter((c) => String(c[0]).includes('refused by the engine organization rule'));
    // One line per refused GRANT, naming the record — the operator's only route
    // from "this rule reports refusals" to "these are the records to repair".
    expect(refusals).toHaveLength(2);
    expect(refusals.map((c) => (c[1] as any).record)).toEqual(['rec_orgless', 'rec_orgless_2']);
    expect(refusals[0]![1]).toMatchObject({
      rule: 'os14754_logs',
      object: OBJECT,
      record: 'rec_orgless',
      recipient: 'u_plat',
      code: 'ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED',
    });
  });

  it('MEASURED BOUNDARY — the refusal gates the INSERT half only: an organization-less row that ALREADY exists is UPDATED, not refused', async () => {
    const { driver, rules, shares } = await boot('isolated');
    const rule = await platformGlobalRule(rules, 'os14754_update_half', 'read');

    // A pre-existing rule grant on the organization-less record, carrying no
    // organization (which is how it got there before #14484). The pass wants
    // to raise it to `edit`.
    await driver.create('sys_record_share', {
      id: 'shr_orgless_old', object_name: OBJECT, record_id: 'rec_orgless', recipient_type: 'user',
      recipient_id: 'u_plat', access_level: 'read', source: 'rule', source_id: rule.id,
      created_at: '2026-01-01T00:00:00Z',
    } as never);

    const raised = await rules.defineRule(
      { name: 'os14754_update_half', label: 'Platform won', object: OBJECT, criteria: WON, recipientType: 'user', recipientId: 'u_plat', accessLevel: 'edit' } as never,
      SYSTEM,
    );
    expect(raised.id).toBe(rule.id);

    const result = await rules.evaluateRule(rule.id, SYSTEM);

    // The engine's rule refuses an INSERT ("Insert on '<object>' was
    // REFUSED"); the update half is not gated by it, and `grant` sends an
    // organization-less update UNSCOPED (`tenantId: undefined`), which reaches
    // the NULL row. So `rec_orgless` is UPDATED here while `rec_orgless_2` —
    // which has no row yet — is refused. Measured, and recorded because it
    // bounds this card: a refusal cannot reach the `cur` (update) branch of
    // either loop today.
    const rows = await shares();
    const updatedRow = rows.find((r) => r.id === 'shr_orgless_old');
    expect(updatedRow).toBeDefined();
    expect(result.grantsUpdated).toBe(1);
    expect(result.grantsRefused).toBe(1);
    expect(result.grantsRevoked).toBe(0);
  });

  it('an unrelated engine error is NOT absorbed — the catch is narrow, and stays narrow', async () => {
    const { ql, rules } = await boot('isolated');
    const rule = await platformGlobalRule(rules, 'os14754_narrow');

    // A different failure on the same seam: the grant's own insert blows up
    // with something that is not the organization refusal.
    const originalInsert = ql.insert.bind(ql);
    vi.spyOn(ql, 'insert').mockImplementation((async (object: string, doc: any, options?: any) => {
      if (object === 'sys_record_share') {
        const err: any = new Error('simulated driver outage');
        err.code = 'ERR_DRIVER_UNAVAILABLE';
        throw err;
      }
      return originalInsert(object, doc, options);
    }) as never);

    await expect(rules.evaluateRule(rule.id, SYSTEM)).rejects.toMatchObject({ code: 'ERR_DRIVER_UNAVAILABLE' });
  });
});

describe('[#14754] reconcileForRecord: the same two halves on the per-record hook path', () => {
  it('HALF 2 — the refused grant does not stop that record\'s OWN stale revocation', async () => {
    const { rules, shares, seedStaleRow } = await boot('isolated');
    const rule = await platformGlobalRule(rules, 'os14754_hook_revokes');

    // A recipient the rule no longer expands to, on the organization-less
    // record itself. The pass's grant for `u_plat` is refused; `u_gone`'s row
    // is stale and must still go.
    await seedStaleRow('shr_hook_stale', 'rec_orgless', rule.id, 'u_gone', null);
    expect((await shares()).map((r) => r.id)).toEqual(['shr_hook_stale']);

    const [result] = await rules.evaluateAllForRecord(OBJECT, 'rec_orgless', SYSTEM);

    expect(result).toMatchObject({ grantsRefused: 1, grantsRevoked: 1, grantsCreated: 0 });
    expect(await shares()).toEqual([]);
  });

  it('HALF 1 — one rule refused no longer aborts the whole per-record sweep: the NEXT rule still reconciles', async () => {
    const { rules, shares, seedStaleRow } = await boot('isolated');
    const refusing = await platformGlobalRule(rules, 'os14754_hook_a');
    const following = await platformGlobalRule(rules, 'os14754_hook_b', 'edit');

    // The second rule's own stale row on the same record — reachable only if
    // the first rule's refusal did not abort `evaluateAllForRecord`.
    await seedStaleRow('shr_hook_b_stale', 'rec_orgless', following.id, 'u_gone', null);

    const results = await rules.evaluateAllForRecord(OBJECT, 'rec_orgless', SYSTEM);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.ruleId)).toEqual([refusing.id, following.id]);
    expect(results.every((r) => r.grantsRefused === 1)).toBe(true);
    expect(results[1]!.grantsRevoked).toBe(1);
    expect(await shares()).toEqual([]);
  });

  it('an organization-CARRYING record on the same posture is untouched by any of this', async () => {
    const { rules, shares } = await boot('isolated');
    const rule = await platformGlobalRule(rules, 'os14754_hook_control');

    const [result] = await rules.evaluateAllForRecord(OBJECT, 'rec_first', SYSTEM);

    expect(result).toMatchObject({ grantsRefused: 0, grantsCreated: 1 });
    expect((await shares()).map((r) => [r.record_id, r.organization_id, r.source_id])).toEqual([
      ['rec_first', ORG_A, rule.id],
    ]);
  });
});
