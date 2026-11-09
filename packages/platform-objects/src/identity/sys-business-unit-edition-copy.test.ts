// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The Business Unit page says what a unit does in the open edition, and what
// needs the enterprise edition (#30210 row 1). It used to say units are "used
// to scope data and reports", while scoping a permission set's read access by
// unit (`readScope: 'unit'` and the other hierarchy scopes) is refused at
// compile without `requires: ['hierarchy-security']`, which only
// `@objectstack/security-enterprise` provides. What does work in the open
// edition is a sharing rule naming a unit (or a unit and the units under it),
// whose access follows membership in and out.
//
// The unit's `timezone` help used to say date boundaries are computed in it.
// Nothing reads the column (the same reading as `sys_organization.timezone`,
// pinned in `sys-organization-name-timezone-help.test.ts`), so the help says
// which setting is in effect instead.
import { describe, expect, it } from 'vitest';
import { SysBusinessUnit } from './sys-business-unit.object.js';
import { zhCNObjects } from '../apps/translations/zh-CN.objects.generated.js';

const zhUnit = () =>
  (zhCNObjects as unknown as Record<string, { description?: string; fields?: Record<string, { help?: string }> }>)
    .sys_business_unit;

describe('sys_business_unit: the page says what the open edition gives and what needs enterprise (#30210)', () => {
  it('names sharing rules as what a unit drives, and the enterprise requirement for unit-scoped read access', () => {
    const d = SysBusinessUnit.description ?? '';
    expect(d).toMatch(/[Ss]haring rules/);
    expect(d).toMatch(/enterprise edition/);
    expect(d).not.toMatch(/used to scope data and reports/);
  });

  it('the zh-CN page text says the same, not the old scoping claim', () => {
    const d = zhUnit()?.description ?? '';
    expect(d).toMatch(/共享规则/);
    expect(d).toMatch(/企业版/);
    expect(d).not.toMatch(/划定数据和报表的范围/);
  });

  it('the zh-CN timezone help no longer says date boundaries are computed in it', () => {
    const help = zhUnit()?.fields?.timezone?.help ?? '';
    expect(help).toMatch(/不会改变任何日期计算/);
    expect(help).not.toMatch(/计算日期边界所用/);
  });

  it("the timezone help says it changes no date calculation and that Localization's Default timezone wins", () => {
    const help = (SysBusinessUnit.fields as Record<string, { description?: string }>).timezone.description ?? '';
    expect(help).toMatch(/does not change any date calculation/);
    expect(help).toMatch(/Settings → Localization → Default timezone/);
    expect(help).not.toMatch(/are computed in/);
  });
});
