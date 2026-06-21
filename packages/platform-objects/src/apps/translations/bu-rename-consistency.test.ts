// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Regression guard for ADR-0057 (sys_department → sys_business_unit). The rename
// once half-landed: the object label said "业务单元" while field labels still said
// "上级部门" / "部门负责人". This asserts the object/plural label AND every FIELD
// label across all locales no longer retains the old term.
//
// Scope is LABELS only — intentionally NOT field descriptions/help, NOT the `kind`
// enum value `department` (a business unit can be OF KIND department), and NOT the
// multi-concept node descriptions that list kinds. Those legitimately keep the word.

import { describe, it, expect } from 'vitest';
import { enObjects } from './en.objects.generated.js';
import { zhCNObjects } from './zh-CN.objects.generated.js';
import { jaJPObjects } from './ja-JP.objects.generated.js';
import { esESObjects } from './es-ES.objects.generated.js';

const LOCALES = [
  { name: 'en', objs: enObjects as Record<string, any>, old: /\bDepartment\b/ },
  { name: 'zh-CN', objs: zhCNObjects as Record<string, any>, old: /部门/ },
  { name: 'ja-JP', objs: jaJPObjects as Record<string, any>, old: /部門/ },
  { name: 'es-ES', objs: esESObjects as Record<string, any>, old: /Departamento/ },
];
const OBJECTS = ['sys_business_unit', 'sys_business_unit_member'];

describe('ADR-0057 BU rename — no stale "department" in object/field labels', () => {
  for (const { name, objs, old } of LOCALES) {
    for (const objName of OBJECTS) {
      it(`${name}: ${objName} object + field labels are fully renamed`, () => {
        const o = objs[objName];
        expect(o, `${objName} missing from ${name} bundle`).toBeTruthy();
        for (const key of ['label', 'pluralLabel'] as const) {
          if (o[key]) expect(String(o[key]), `${name} ${objName}.${key}`).not.toMatch(old);
        }
        for (const [fname, field] of Object.entries(o.fields ?? {})) {
          const label = (field as any)?.label;
          if (label) expect(String(label), `${name} ${objName}.fields.${fname}.label`).not.toMatch(old);
        }
      });
    }
  }
});
