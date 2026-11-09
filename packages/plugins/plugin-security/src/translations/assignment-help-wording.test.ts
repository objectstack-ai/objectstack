// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The validity-window and reason help on a permission set assignment and a
 * position assignment speaks to the administrator filling in the form.
 *
 * Setup opens `sys_user_permission_set` (New permission set assignment) and
 * `sys_user_position` from a user's record, and each field's help tooltip is
 * the served translation of its `description`. The help used to describe the
 * implementation: an enforcement posture ("fail-closed"), interval notation
 * ("half-open [from, until)") and an internal grant class ("agent grants").
 * What the administrator needs is when the assignment starts and stops, and
 * what to write down. This pins the served zh-CN text and the English source.
 */

import { describe, expect, it } from 'vitest';
import { SecurityTranslations } from './index.js';
import { SysUserPermissionSet, SysUserPosition } from '../objects/index.js';

/** Implementation vocabulary an administrator's field help must not carry. */
const DEVELOPER_TERMS: ReadonlyArray<readonly [string, RegExp]> = [
  ['an enforcement posture', /fail-closed/i],
  ['interval notation', /半开区间|half-open|\[from, until\)/i],
  ['an internal grant class', /智能体授权|\bagent grants?\b|task\/run attribution/i],
];

const FORMS = {
  sys_user_permission_set: SysUserPermissionSet,
  sys_user_position: SysUserPosition,
} as const;
const FIELDS = ['valid_from', 'valid_until', 'reason'] as const;

function termsIn(text: string): string[] {
  return DEVELOPER_TERMS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

type FieldCopy = { help?: string };
type ObjectCopy = { fields?: Record<string, FieldCopy> };

describe('assignment forms: validity and reason help reads as administrator wording', () => {
  const zhCN = (SecurityTranslations['zh-CN'] as { objects: Record<string, ObjectCopy> }).objects;

  for (const [object, schema] of Object.entries(FORMS)) {
    for (const field of FIELDS) {
      it(`${object}.${field}: the served zh-CN help is Chinese and names no implementation term`, () => {
        const help = zhCN[object]?.fields?.[field]?.help ?? '';
        expect(help).toMatch(/[一-鿿]/);
        expect(termsIn(help), help).toEqual([]);
      });

      it(`${object}.${field}: the English source names no implementation term`, () => {
        const description = (schema.fields as Record<string, { description?: string }>)[field]?.description ?? '';
        expect(description.length).toBeGreaterThan(0);
        expect(termsIn(description), description).toEqual([]);
      });
    }
  }
});
