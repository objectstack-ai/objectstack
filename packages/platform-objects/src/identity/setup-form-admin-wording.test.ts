// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The help on Setup's New business unit, Edit organization and user forms
 * speaks to the administrator filling them in.
 *
 * A field's help tooltip is the served translation of its `description`.
 * These used to describe the implementation: the org tree as a graph
 * ("graph semantics", "expanded by graph queries"), a null value
 * ("Null = root of tenant"), an acronym for the upstream system ("HRIS"), a
 * boolean literal ("When true", zh-CN 「为 true 时」) and an HTTP status code.
 * What the administrator needs is what turning the field on does, and what to
 * fill in. This pins the served zh-CN text and the English source.
 */

import { describe, expect, it } from 'vitest';
import { SetupAppTranslations } from '../apps/translations/setup.translation.js';
import { SysBusinessUnit } from './sys-business-unit.object.js';
import { SysOrganization } from './sys-organization.object.js';
import { SysUser } from './sys-user.object.js';

/** Implementation vocabulary an administrator's field help must not carry. */
const DEVELOPER_TERMS: ReadonlyArray<readonly [string, RegExp]> = [
  ['graph vocabulary', /图谱|\bgraph\b/i],
  ['a null literal', /\bNull\b|为空 =/],
  ['an acronym for the upstream system', /\bHRIS\b/],
  ['a boolean literal', /为 ?(true|false) ?时|\bWhen (true|false)\b/i],
  ['an HTTP status code', /\b[45]\d\d [A-Z][A-Z_]{3,}\b/],
];

const FORMS = {
  sys_business_unit: {
    schema: SysBusinessUnit,
    fields: ['kind', 'parent_business_unit_id', 'active', 'effective_from', 'effective_to', 'external_ref'],
  },
  sys_organization: { schema: SysOrganization, fields: ['require_mfa'] },
  sys_user: { schema: SysUser, fields: ['banned', 'must_change_password'] },
} as const;

function termsIn(text: string): string[] {
  return DEVELOPER_TERMS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

type ObjectCopy = { fields?: Record<string, { help?: string }> };

describe('Setup forms: business unit, organization and user help reads as administrator wording', () => {
  const zhCN = (SetupAppTranslations['zh-CN'] as { objects: Record<string, ObjectCopy> }).objects;

  for (const [object, { schema, fields }] of Object.entries(FORMS)) {
    for (const field of fields) {
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
