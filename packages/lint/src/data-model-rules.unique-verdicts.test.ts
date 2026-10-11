// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#22161] The three ADR-0120 uniqueness rules print one verdict sentence per
// finding; the reasoning they used to carry is each id's `os explain` entry.
// Their behaviour is pinned in `packages/cli/test/data-model-rules.test.ts` and
// their `where` slot in `data-model-rule-where-slot.test.ts`; this file pins the
// verdict SHAPE over every arm the three rules have — each spelling, a named
// and an unnamed index, a declared tenant column, and all four scope quadrants
// of the double declaration — and the explanation that took the rest.

import { describe, expect, it } from 'vitest';

import {
  lintLegacyOrganizationComposites,
  lintUniqueDeclarations,
  lintUnscopedDeclaredIndexes,
  UNIQUE_DOUBLE_DECLARATION,
  UNIQUE_LEGACY_ORGANIZATION_COMPOSITE,
  UNIQUE_UNSCOPED_DECLARED_INDEX,
} from './data-model-rules.js';
import { explainRule } from './rule-explanations.js';

const CONVERTED = [UNIQUE_UNSCOPED_DECLARED_INDEX, UNIQUE_DOUBLE_DECLARATION, UNIQUE_LEGACY_ORGANIZATION_COMPOSITE];

const fired: Array<{ rule: string; message: string }> = [];
const record = <T extends { rule: string; message: string }>(issues: T[]): T[] => {
  fired.push(...issues);
  return issues;
};

/** One object whose single column carries a field-level `unique` and a one-column unique index. */
const twice = (fieldUnique: unknown, indexUnique: unknown, indexName?: string) => [
  {
    name: 'crm_product',
    fields: { sku: { type: 'text', unique: fieldUnique } },
    indexes: [{ ...(indexName ? { name: indexName } : {}), fields: ['sku'], unique: indexUnique }],
  },
];

describe('[#22161] one-line verdicts — the ADR-0120 uniqueness rules', () => {
  it('unique/unscoped-declared-index: the index, the spelling, the refusal and what it built', () => {
    const issues = record(
      lintUnscopedDeclaredIndexes([
        {
          name: 'sys_account',
          fields: {},
          indexes: [
            { name: 'uniq_org_email', fields: ['organization_id', 'email'], unique: true },
            { fields: ['provider_id', 'account_id'], unique: true },
          ],
        },
      ]),
    );
    expect(issues.map((i) => i.message)).toEqual([
      '"sys_account" index \'uniq_org_email\' [organization_id, email] has bare `unique: true`, an unstated ' +
        'scope protocol 18 refuses (ADR-0120): it built the index installation-wide',
      '"sys_account" index [provider_id, account_id] has bare `unique: true`, an unstated scope protocol 18 ' +
        'refuses (ADR-0120): it built the index installation-wide',
    ]);
  });

  it('unique/legacy-organization-composite: the index and the NULL rows it does not hold', () => {
    const issues = record(
      lintLegacyOrganizationComposites([
        {
          name: 'sys_team',
          fields: {},
          indexes: [
            { name: 'uk_team', fields: ['name', 'organization_id'], unique: true },
            { fields: ['code', 'organization_id'], unique: 'global' },
          ],
        },
        {
          name: 'legacy_thing',
          tenancy: { tenantField: 'tenant_ref' },
          fields: {},
          indexes: [{ fields: ['code', 'tenant_ref'], unique: true }],
        },
      ]),
    );
    expect(issues.map((i) => i.message)).toEqual([
      '"sys_team" index \'uk_team\' [name, organization_id] lists the organization column, and SQL UNIQUE is ' +
        "NULL-distinct: on every row whose 'organization_id' is NULL it enforces nothing",
      '"sys_team" index [code, organization_id] lists the organization column, and SQL UNIQUE is ' +
        "NULL-distinct: on every row whose 'organization_id' is NULL it enforces nothing",
      '"legacy_thing" index [code, tenant_ref] lists the organization column, and SQL UNIQUE is ' +
        "NULL-distinct: on every row whose 'tenant_ref' is NULL it enforces nothing",
    ]);
  });

  it('unique/double-declaration: all four scope quadrants, both spellings named', () => {
    const verdict = (fieldUnique: unknown, indexUnique: unknown, name?: string) =>
      record(lintUniqueDeclarations(twice(fieldUnique, indexUnique, name)))[0]!.message;
    expect(verdict(true, 'global', 'uniq_product_sku')).toBe(
      '"crm_product.sku" field `unique: true` and index \'uniq_product_sku\' `unique: \'global\'` CONTRADICT: ' +
        'the installation-wide one wins, so the per-organization intent is silently dead',
    );
    expect(verdict('global', 'organization')).toBe(
      '"crm_product.sku" field `unique: \'global\'` and index `unique: \'organization\'` CONTRADICT: the ' +
        'installation-wide one wins, so the per-organization intent is silently dead',
    );
    expect(verdict('organization', 'organization')).toBe(
      '"crm_product.sku" field `unique: \'organization\'` and index `unique: \'organization\'` both ask for ' +
        'per-organization uniqueness: the same index declared twice',
    );
    expect(verdict('global', 'global')).toBe(
      '"crm_product.sku" field `unique: \'global\'` and index `unique: \'global\'` both ask for ' +
        'installation-wide uniqueness: the same index declared twice',
    );
  });

  it('every verdict the cases above fired is one line of at most 200 characters', () => {
    // The coverage control first: all three ids fired, so the shape assertion
    // below cannot pass over an empty or partial record.
    expect([...new Set(fired.map((f) => f.rule))].sort()).toEqual([...CONVERTED].sort());
    for (const f of fired) {
      expect(f.message, f.rule).not.toContain('\n');
      expect(f.message.length, `${f.rule}: ${f.message}`).toBeLessThanOrEqual(200);
    }
  });

  it('`os explain` carries what the verdicts no longer say', () => {
    const facts: Record<string, string[]> = {
      [UNIQUE_UNSCOPED_DECLARED_INDEX]: [
        'ADR-0120 D5a',
        'no tenancy inference',
        'ADR-0120 D7',
        '`IndexSchema.unique`',
        '`os lint`, which judges the normalized stack',
        "converts to `unique: 'global'`",
      ],
      [UNIQUE_DOUBLE_DECLARATION]: [
        'ADR-0120 D5b',
        'physically stricter and wins',
        'REDUNDANT',
        '`unique/legacy-organization-composite`',
      ],
      [UNIQUE_LEGACY_ORGANIZATION_COMPOSITE]: [
        'ADR-0120 S6',
        '`tenancy.tenantField`',
        'single-organization deployment is every row',
        "`COALESCE(organization_id, '__global__')`",
        'ADR-0120 D5c',
        'D4 ceremony',
      ],
    };
    for (const [rule, list] of Object.entries(facts)) {
      const entry = explainRule(rule);
      expect(entry, `no \`os explain ${rule}\` entry`).toBeDefined();
      const text = entry!.paragraphs.join('\n');
      for (const fact of list) expect(text, `${rule} explanation names ${fact}`).toContain(fact);
    }
    // The scope words are one paragraph, printed under both spellings it explains.
    const scopeWords = (rule: string) => explainRule(rule)!.paragraphs.find((p) => p.startsWith('ADR-0120 gives'));
    expect(scopeWords(UNIQUE_UNSCOPED_DECLARED_INDEX)).toBeDefined();
    expect(scopeWords(UNIQUE_DOUBLE_DECLARATION)).toBe(scopeWords(UNIQUE_UNSCOPED_DECLARED_INDEX));
  });
});
