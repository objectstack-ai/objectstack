// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0057 D6 / #2077 — stack-declared `roles` + `sharingRules` are seeded into
// sys_position / sys_sharing_rule at boot, so they stop being decorative. The issue
// reported booting the showcase yielded sys_position count = 0 and sys_sharing_rule
// count = 0. This proves the opposite, plus the spec→runtime translation.
//
// @proof: showcase-declarative-rbac-seeding
//
// ADR-0056 D10 — the authz-conformance matrix row this file is the cited proof
// for; `authz-conformance.test.ts` asserts the pairing is mutual (#7976).
// authz-row: declarative-rbac-seeding

import { describe, it, expect, beforeAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { getSharedShowcase } from './shared-showcase.js';

describe('showcase: declarative RBAC seeding (ADR-0057 D6 / #2077)', () => {
  let stack: VerifyStack;
  let ql: any;

  beforeAll(async () => {
    stack = await getSharedShowcase();
    await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 60_000);

  it('declared roles land in sys_position (was count = 0)', async () => {
    const roles = await ql.find('sys_position', { where: {}, context: { isSystem: true } });
    const names = (roles ?? []).map((r: any) => r.name);
    expect(names, 'showcase declares contributor/manager/exec').toEqual(
      expect.arrayContaining(['contributor', 'manager', 'exec']),
    );
  });

  it('declared criteria sharing rule lands in sys_sharing_rule, CEL→criteria_json translated', async () => {
    const rules = await ql.find('sys_sharing_rule', { where: {}, context: { isSystem: true } });
    const inquiry = (rules ?? []).find((r: any) => r.name === 'share_new_inquiries_with_field_ops');
    expect(inquiry, 'criteria rule seeded (was count = 0)').toBeTruthy();
    expect(inquiry.object_name).toBe('showcase_inquiry');
    expect(inquiry.recipient_type).toBe('unit_and_subordinates');
    expect(inquiry.recipient_id).toBe('bu_field_ops');
    // condition "record.status == 'new'" → JSON FilterCondition { status: 'new' }
    const criteria = JSON.parse(inquiry.criteria_json);
    expect(criteria).toEqual({ status: 'new' });
  });

  it('every retired demonstration rule stays gone; the position demo seeds where it enforces', async () => {
    const rules = await ql.find('sys_sharing_rule', { where: {}, context: { isSystem: true } });
    // Three generations of the same ADR-0078 lesson, each retired for being
    // inert in a different way, none of which may reappear:
    //   • `type: 'owner'` never parsed — silently skipped at seed time;
    //   • its criteria replacement on `showcase_task`, and the two rules on
    //     `showcase_project`, seeded fine and then had every grant REFUSED
    //     (`SHARING_NOT_ENABLED`) because those objects are `public_read_write`
    //     — sharing has nothing to widen there (#9237).
    for (const retired of [
      'share_contributor_tasks_with_manager',
      'share_open_tasks_with_manager',
      'share_red_projects_with_execs',
      'share_high_value_red_projects_with_managers',
    ]) {
      expect(
        (rules ?? []).find((r: any) => r.name === retired),
        `retired rule must not reappear: ${retired}`,
      ).toBeFalsy();
    }
    // The surviving `position`-recipient demonstration lives on an object under
    // record-sharing enforcement, so its grant is one the gates consult.
    const contacts = (rules ?? []).find(
      (r: any) => r.name === 'share_key_account_qualified_contacts_with_managers',
    );
    expect(contacts, 'position-recipient rule seeded').toBeTruthy();
    expect(contacts.object_name).toBe('showcase_contact');
    expect(contacts.recipient_type).toBe('position');
    expect(contacts.recipient_id).toBe('manager');
    const criteria = JSON.parse(contacts.criteria_json);
    expect(criteria).toEqual({ $and: [{ stage: 'qualified' }, { company: 'Northwind' }] });
  });

  it('re-seed is idempotent (no duplicate rows on a second boot)', async () => {
    const roles = await ql.find('sys_position', { where: { name: 'manager' }, context: { isSystem: true } });
    expect((roles ?? []).length, 'exactly one manager role').toBe(1);
  });
});
