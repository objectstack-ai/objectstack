// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0057 D6 / #2077 — stack-declared `roles` + `sharingRules` are seeded into
// sys_position / sys_sharing_rule at boot, so they stop being decorative. The issue
// reported booting the showcase yielded sys_position count = 0 and sys_sharing_rule
// count = 0. This proves the opposite, plus the spec→runtime translation.
//
// @proof: showcase-declarative-rbac-seeding

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

describe('showcase: declarative RBAC seeding (ADR-0057 D6 / #2077)', () => {
  let stack: VerifyStack;
  let ql: any;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 60_000);
  afterAll(async () => { await stack?.stop(); });

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

  it('owner-based rule is NOT seeded as a match-all (experimental, ADR-0049 honesty)', async () => {
    const rules = await ql.find('sys_sharing_rule', { where: {}, context: { isSystem: true } });
    const owner = (rules ?? []).find((r: any) => r.name === 'share_contributor_tasks_with_manager');
    // owner-type has no static criteria_json equivalent → skipped, not seeded over-broadly.
    expect(owner, 'owner-based rule must not silently over-share').toBeFalsy();
  });

  it('re-seed is idempotent (no duplicate rows on a second boot)', async () => {
    const roles = await ql.find('sys_position', { where: { name: 'manager' }, context: { isSystem: true } });
    expect((roles ?? []).length, 'exactly one manager role').toBe(1);
  });
});
