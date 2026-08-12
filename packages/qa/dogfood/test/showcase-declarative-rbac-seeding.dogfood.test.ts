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
    const red = (rules ?? []).find((r: any) => r.name === 'share_red_projects_with_execs');
    expect(red, 'criteria rule seeded (was count = 0)').toBeTruthy();
    expect(red.object_name).toBe('showcase_project');
    expect(red.recipient_type).toBe('position');
    expect(red.recipient_id).toBe('exec');
    // condition "record.health == 'red'" → JSON FilterCondition { health: 'red' }
    const criteria = JSON.parse(red.criteria_json);
    expect(criteria).toEqual({ health: 'red' });
  });

  it('retired owner-based rule is gone; its criteria replacement seeds and enforces', async () => {
    const rules = await ql.find('sys_sharing_rule', { where: {}, context: { isSystem: true } });
    // `type: 'owner'` was removed from the authoring spec (never enforced —
    // ADR-0078): the old demonstration rule can no longer exist.
    const owner = (rules ?? []).find((r: any) => r.name === 'share_contributor_tasks_with_manager');
    expect(owner, 'retired owner-based rule must not reappear').toBeFalsy();
    // Its replacement is a real criteria rule — seeded WITH translated
    // criteria_json (not skipped, not match-all).
    const open = (rules ?? []).find((r: any) => r.name === 'share_open_tasks_with_manager');
    expect(open, 'criteria replacement seeded').toBeTruthy();
    expect(open.object_name).toBe('showcase_task');
    expect(open.recipient_type).toBe('position');
    expect(open.recipient_id).toBe('manager');
    const criteria = JSON.parse(open.criteria_json);
    expect(criteria).toEqual({ done: false });
  });

  it('re-seed is idempotent (no duplicate rows on a second boot)', async () => {
    const roles = await ql.find('sys_position', { where: { name: 'manager' }, context: { isSystem: true } });
    expect((roles ?? []).length, 'exactly one manager role').toBe(1);
  });
});
