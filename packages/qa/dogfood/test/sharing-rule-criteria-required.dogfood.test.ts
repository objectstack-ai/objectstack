// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #3896 — `POST /api/v1/sharing/rules` must not turn a missing criteria into
// "share every record of this object". (The issue calls the route
// `/data/sharing/rules`; sharing-rule routes are actually anchored on the API
// base, since they administer rules tenant-wide rather than acting on one CRUD
// object. Same handler, same bug.)
//
// The endpoint plucks its body field-by-field into
// `SharingRuleService.defineRule`; `SharingRuleSchema` is never on that path.
// So a rule authored with a MISSPELLED criteria key (`criterias`) — or none at
// all — used to be stored with `criteria_json: null`, answered 201 with no
// warning, and then evaluated as `find(object, { filter: {} })` under the
// system context: every record of the object, granted to the recipient.
// `SharingRuleSchema` forbids exactly that shape ("never seeded as a
// permissive match-all", ADR-0049); the seed path honoured it and this entry
// did not.
//
// Driven over real HTTP against a booted stack, because the bug lived in the
// gap between the schema and the transport — a unit test on the schema is what
// missed it the first time.
//
// @proof: sharing-rule-criteria-required

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

// Sharing-rule routes are anchored on the API base, not under `/data/:object`
// (they administer rules tenant-wide) — `/api/v1/sharing/rules`.
const RULES = '/sharing/rules';
const SYS = { isSystem: true } as const;
const OBJECT = 'showcase_project';

describe('#3896 — a sharing rule POSTed without criteria is rejected, never made match-all', () => {
  let stack: VerifyStack;
  let ql: any;
  let admin: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    admin = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 90_000);

  afterAll(async () => { await stack?.stop(); });

  /** Rule rows currently stored for the target object. */
  const storedRules = async () =>
    (await ql.find('sys_sharing_rule', { where: { object_name: OBJECT }, context: SYS })) ?? [];

  it('THE REPORTED CASE: `criterias` (typo) is a 400, not a 201 sharing the whole object', async () => {
    const before = (await storedRules()).length;
    const res = await stack.apiAs(admin, 'POST', RULES, {
      name: 'won_deals_3896',
      label: 'Won Deals',
      object: OBJECT,
      recipientType: 'position',
      recipientId: 'sales_rep',
      // The typo from the issue: intent is "share red projects", but the key
      // the endpoint reads is `criteria`, so this one is dropped.
      criterias: { health: 'red' },
    });

    expect(res.status, 'misspelled criteria must not be accepted').toBe(400);
    const body: any = await res.json();
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(String(body.error)).toMatch(/criteria/i);

    // Nothing was stored, so nothing can be evaluated into grants later.
    expect(await storedRules()).toHaveLength(before);
  });

  it('an omitted criteria is a 400 too (the forgot-a-field and half-filled-form cases)', async () => {
    for (const body of [
      { name: 'no_criteria_3896', label: 'No criteria', object: OBJECT, recipientType: 'position', recipientId: 'sales_rep' },
      { name: 'null_criteria_3896', label: 'Null criteria', object: OBJECT, recipientType: 'position', recipientId: 'sales_rep', criteria: null },
      { name: 'empty_criteria_3896', label: 'Empty criteria', object: OBJECT, recipientType: 'position', recipientId: 'sales_rep', criteria: {} },
    ]) {
      const res = await stack.apiAs(admin, 'POST', RULES, body);
      expect(res.status, `${body.name} must be rejected`).toBe(400);
      expect((await res.json() as any).code).toBe('VALIDATION_FAILED');
    }
  });

  it('a rule WITH a criteria still saves and evaluates (the gate is not a blanket refusal)', async () => {
    const res = await stack.apiAs(admin, 'POST', RULES, {
      name: 'red_projects_3896',
      label: 'Red projects',
      object: OBJECT,
      recipientType: 'position',
      recipientId: 'sales_rep',
      criteria: { health: 'red' },
      accessLevel: 'read',
    });
    expect(res.status, 'a real predicate is accepted').toBe(201);
    const row: any = await res.json();
    expect(row.criteria).toEqual({ health: 'red' });

    const evaluated = await stack.apiAs(admin, 'POST', `${RULES}/${row.id}/evaluate`, {});
    expect(evaluated.status).toBeLessThan(300);

    // Every record it shared actually satisfies the predicate — the rule did
    // not quietly widen to the whole object.
    const shares = await ql.find('sys_record_share', {
      where: { source: 'rule', source_id: row.id }, context: SYS,
    });
    for (const share of shares ?? []) {
      const rec = await ql.findOne(OBJECT, { where: { id: share.record_id }, context: SYS });
      expect(rec?.health, 'every shared record satisfies the predicate').toBe('red');
    }
  });

  it('the criteria guard is live on the real engine — a direct insert is refused too', async () => {
    // This is the Setup UI's authoring path: a plain data insert that never
    // reaches defineRule.
    await expect(ql.insert('sys_sharing_rule', {
      id: 'srule_3896_direct',
      name: 'direct_match_all_3896',
      label: 'Direct match-all',
      object_name: OBJECT,
      recipient_type: 'position',
      recipient_id: 'sales_rep',
      access_level: 'read',
      active: true,
    }, { context: SYS })).rejects.toThrow(/criteria is required/);
  });

  it('a criteria-less rule already IN the table shares nothing and loses its grants', async () => {
    // Reproduce a row from BEFORE the gate existed. Since ADR-0113 P2 the
    // engine path is DOUBLY closed — the hook guard and the declarative
    // `required: true` (record validator) — so unbinding the hook is no longer
    // enough to author this shape through the engine, which is exactly the
    // defense-in-depth the flip bought. A true legacy row predates all of it:
    // write it at the DRIVER seam, the same level a pre-gate deployment's
    // storage actually holds it.
    const id = 'srule_3896_legacy';
    const driver = (ql as any).getDriverForObject('sys_sharing_rule');
    expect(driver, 'sys_sharing_rule driver must be resolvable').toBeTruthy();
    await driver.create('sys_sharing_rule', {
      id,
      name: 'legacy_match_all_3896',
      label: 'Legacy match-all',
      object_name: OBJECT,
      criteria_json: null,
      recipient_type: 'position',
      recipient_id: 'sales_rep',
      access_level: 'read',
      active: true,
    });

    const res = await stack.apiAs(admin, 'POST', `${RULES}/${id}/evaluate`, {});
    expect(res.status).toBeLessThan(300);
    const result: any = await res.json();
    expect(result.matchedRecords ?? result.data?.matchedRecords, 'matches NO records, not every record').toBe(0);

    const shares = await ql.find('sys_record_share', {
      where: { source: 'rule', source_id: id }, context: SYS,
    });
    expect(shares ?? [], 'no grants materialised from a match-all rule').toHaveLength(0);
  });
});
