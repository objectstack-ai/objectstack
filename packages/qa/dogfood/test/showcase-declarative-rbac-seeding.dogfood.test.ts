// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0057 D6 / #2077 — stack-declared positions + `sharingRules` are not
// decorative. The issue reported booting the showcase yielded sys_position
// count = 0 and sys_sharing_rule count = 0. Both are served from the registry
// now — ADR-0131 D2 retired their seeders, so the boot writes no sys_position
// and no sys_sharing_rule row for a declaration. Declared positions are served
// by the security catalog; declared sharing rules by the sharing-rule service,
// with the spec→runtime translation (CEL `condition` → `criteria`).
//
// @proof: showcase-declarative-rbac-seeding
//
// ADR-0056 D10 — the authz-conformance matrix row this file is the cited proof
// for; `authz-conformance.test.ts` asserts the pairing is mutual (#7976).
// authz-row: declarative-rbac-seeding

import { describe, it, expect, beforeAll } from 'vitest';
import { createSecurityCatalogReader } from '@objectstack/core';
import type { ISharingRuleService, SharingRuleRow } from '@objectstack/spec/contracts';
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

  it('declared positions are served by the security catalog (was count = 0)', async () => {
    const reader = createSecurityCatalogReader({ registry: ql.registry, metadata: stack.kernel.getService('metadata') });
    const names = (await reader.list('position')).map((e) => e.name);
    expect(names, 'showcase declares contributor/manager/exec').toEqual(
      expect.arrayContaining(['contributor', 'manager', 'exec']),
    );
  });

  /** Every rule the sharing-rule service serves, as the enforcement paths list them. */
  const servedRules = async (): Promise<SharingRuleRow[]> =>
    stack.kernel.getService<ISharingRuleService>('sharingRules').listRules({}, { isSystem: true, positions: [], permissions: [] });

  it('declared criteria sharing rule is served from the registry, CEL→criteria translated — and no row is written for it', async () => {
    const rules = await servedRules();
    const inquiry = (rules ?? []).find((r: any) => r.name === 'share_new_inquiries_with_field_ops');
    expect(inquiry, 'criteria rule served (was count = 0)').toBeTruthy();
    expect(inquiry?.id, 'a declared rule\'s id is its name').toBe('share_new_inquiries_with_field_ops');
    expect(inquiry?.object_name).toBe('showcase_inquiry');
    expect(inquiry?.recipient_type).toBe('unit_and_subordinates');
    expect(inquiry?.recipient_id).toBe('bu_field_ops');
    // condition "record.status == 'new'" → JSON FilterCondition { status: 'new' }
    expect(inquiry?.criteria).toEqual({ status: 'new' });
    const stored = await ql.find('sys_sharing_rule', { where: {}, context: { isSystem: true } });
    expect((stored ?? []).filter((r: any) => r.managed_by === 'package'), 'the boot writes no declared-rule row').toEqual([]);
  });

  it('every retired demonstration rule stays gone; the position demo is served where it enforces', async () => {
    const rules = await servedRules();
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
    expect(contacts, 'position-recipient rule served').toBeTruthy();
    expect(contacts?.object_name).toBe('showcase_contact');
    expect(contacts?.recipient_type).toBe('position');
    expect(contacts?.recipient_id).toBe('manager');
    expect(contacts?.criteria).toEqual({ $and: [{ stage: 'qualified' }, { company: 'Northwind' }] });
  });
});
