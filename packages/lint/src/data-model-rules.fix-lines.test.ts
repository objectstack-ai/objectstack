// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#22161] Every `data-model-rules.ts` finding's `fix` is one remedy line of at
// most 200 characters. `os lint --fix` prints it as the `→ fix:` line, and the
// three ADR-0120 uniqueness ids carry it as the `hint` `os validate` and
// `os build` print. What the hints used to explain is `os explain` text.
//
// The three `lintDataModel` sweep ids (`object/missing-name-field`,
// `field/select-missing-options`, `rollup/non-numeric-aggregand`) are never
// adapted into an `AuthoringFinding`, so a census that reads `hint` never sees
// them. This file reads `fix` directly, over every arm each rule has, with long
// object and field names where a name is interpolated.

import { describe, expect, it } from 'vitest';

import {
  lintDataModel,
  lintLegacyOrganizationComposites,
  lintUniqueDeclarations,
  lintUnscopedDeclaredIndexes,
  ROLLUP_NON_NUMERIC_AGGREGAND,
  UNIQUE_DOUBLE_DECLARATION,
  UNIQUE_LEGACY_ORGANIZATION_COMPOSITE,
  UNIQUE_UNSCOPED_DECLARED_INDEX,
  type LintIssue,
} from './data-model-rules.js';
import { explainRule } from './rule-explanations.js';

const MISSING_NAME_FIELD = 'object/missing-name-field';
const SELECT_MISSING_OPTIONS = 'field/select-missing-options';

const IDS = [
  UNIQUE_UNSCOPED_DECLARED_INDEX,
  UNIQUE_DOUBLE_DECLARATION,
  UNIQUE_LEGACY_ORGANIZATION_COMPOSITE,
  MISSING_NAME_FIELD,
  SELECT_MISSING_OPTIONS,
  ROLLUP_NON_NUMERIC_AGGREGAND,
];

const LONG_OBJECT = 'acme_customer_purchase_order_header';
const LONG_FIELD = 'primary_contact_email_address';

const fired: LintIssue[] = [];
const record = <T extends LintIssue>(issues: T[]): T[] => {
  fired.push(...issues.filter((i) => IDS.includes(i.rule)));
  return issues;
};
const fixOf = (issues: LintIssue[], rule: string): string => {
  const hit = issues.find((i) => i.rule === rule);
  expect(hit, `${rule} fired`).toBeDefined();
  return hit!.fix ?? '';
};

const twice = (fieldUnique: unknown, indexUnique: unknown, field = 'sku') => [
  {
    name: LONG_OBJECT,
    fields: { [field]: { type: 'text', unique: fieldUnique } },
    indexes: [{ name: 'uniq_sku', fields: [field], unique: indexUnique }],
  },
];

const rollup = (childType: string, parent = 'invoice', fn = 'max') => [
  {
    name: parent,
    fields: {
      name: { type: 'text' },
      rolled_up: { type: 'summary', summaryOperations: { object: 'invoice_line', field: 'f', function: fn } },
    },
  },
  {
    name: 'invoice_line',
    fields: {
      name: { type: 'text' },
      inv: { type: 'master_detail', reference: parent, required: true, deleteBehavior: 'cascade' },
      f: { type: childType },
    },
  },
];

describe('[#22161] data-model-rules.ts — one remedy line per fix', () => {
  it('unique/unscoped-declared-index: the two scope words, nothing else', () => {
    const issues = record(
      lintUnscopedDeclaredIndexes([
        {
          name: LONG_OBJECT,
          fields: {},
          indexes: [
            { name: 'uniq_org_email', fields: ['organization_id', 'email'], unique: true },
            { fields: ['provider_id', 'account_id', 'region', 'channel'], unique: true },
          ],
        },
      ]),
    );
    expect(issues).toHaveLength(2);
    for (const issue of issues) {
      expect(issue.fix).toBe(
        "State the scope: `unique: 'global'` (installation-wide — the exact index bare `true` built) or " +
          "`unique: 'organization'` (one holder per organization).",
      );
    }
  });

  it('unique/double-declaration: one line per quadrant', () => {
    expect(fixOf(record(lintUniqueDeclarations(twice('global', 'global'))), UNIQUE_DOUBLE_DECLARATION)).toBe(
      "Keep ONE spelling of installation-wide uniqueness: `unique: 'global'` on 'sku', or the declared index — not both.",
    );
    expect(fixOf(record(lintUniqueDeclarations(twice(true, 'organization'))), UNIQUE_DOUBLE_DECLARATION)).toBe(
      "Keep ONE spelling of per-organization uniqueness: `unique: 'organization'` on 'sku' (preferred), or the " +
        'declared index — not both.',
    );
    const contradiction =
      "Pick ONE scope and say it once: keep `unique: 'global'` and drop the per-organization side, or set " +
      "`unique: 'organization'` and drop the installation-wide one.";
    expect(fixOf(record(lintUniqueDeclarations(twice(true, 'global'))), UNIQUE_DOUBLE_DECLARATION)).toBe(contradiction);
    expect(fixOf(record(lintUniqueDeclarations(twice('global', 'organization'))), UNIQUE_DOUBLE_DECLARATION)).toBe(
      contradiction,
    );
    // Long column names, on the two arms that name the column.
    record(lintUniqueDeclarations(twice('global', 'global', LONG_FIELD)));
    record(lintUniqueDeclarations(twice('organization', 'organization', LONG_FIELD)));
    record(lintUniqueDeclarations(twice(true, 'global', LONG_FIELD)));
  });

  it('unique/legacy-organization-composite: the respelling and its cost, whatever the columns', () => {
    const issues = record(
      lintLegacyOrganizationComposites([
        {
          name: LONG_OBJECT,
          fields: {},
          indexes: [{ name: 'uk_team', fields: ['name', 'organization_id'], unique: true }],
        },
        {
          name: LONG_OBJECT,
          tenancy: { tenantField: 'tenant_reference_column' },
          fields: {},
          indexes: [{ fields: ['tenant_reference_column', 'code', 'region', 'channel'], unique: 'global' }],
        },
      ]),
    );
    expect(issues).toHaveLength(2);
    for (const issue of issues) {
      expect(issue.fix).toBe(
        "Respell it `unique: 'organization'` and keep `fields` exactly as they are; opting in is a " +
          '`recreate_index` gated by the duplicate pre-flight probe (ADR-0120 D4).',
      );
    }
  });

  it('object/missing-name-field: the pointer, and where the titleFormat reasoning lives', () => {
    const fix = fixOf(record(lintDataModel([{ name: LONG_OBJECT, fields: { amount: { type: 'number' } } }])), MISSING_NAME_FIELD);
    expect(fix).toBe(
      "Set `nameField`; a composite title to import, sort or search by is a text field with an `expression` " +
        "(a text formula is display-only); `titleFormat` never counts (`os explain title-format-retired`).",
    );
    // The command the line names answers, and says why `titleFormat` does not count.
    expect(explainRule('title-format-retired')!.paragraphs.join('\n')).toContain('render-only');
  });

  it('field/select-missing-options: one line on every option-field type', () => {
    for (const type of ['select', 'multiselect', 'radio', 'enum']) {
      const fix = fixOf(
        record(lintDataModel([{ name: LONG_OBJECT, nameField: 'name', fields: { name: { type: 'text' }, [LONG_FIELD]: { type } } }])),
        SELECT_MISSING_OPTIONS,
      );
      expect(fix, type).toBe(
        "Give the field ONE options source: inline `options: [{ label: '…', value: '…' }]` or " +
          "`picklist: '<name>'` naming a shared list — never both: `options` beside `picklist` is refused.",
      );
    }
  });

  it('rollup/non-numeric-aggregand: one line naming the child type, not the parent', () => {
    expect(fixOf(record(lintDataModel(rollup('datetime', LONG_OBJECT))), ROLLUP_NON_NUMERIC_AGGREGAND)).toBe(
      "Aggregate a numeric or boolean child field, or use function: 'count'; a roll-up cannot store a " +
        'datetime, so declare a datetime field and maintain it from a flow.',
    );
    for (const type of ['date', 'time', 'text', 'select', 'multiselect', 'lookup', 'json', 'autonumber', 'textarea']) {
      for (const fn of ['min', 'max']) record(lintDataModel(rollup(type, LONG_OBJECT, fn)));
    }
  });

  it('every fix the cases above fired is one line of at most 200 characters', () => {
    // The coverage control first: all six ids fired.
    expect([...new Set(fired.map((f) => f.rule))].sort()).toEqual([...IDS].sort());
    for (const f of fired) {
      expect(f.fix, f.rule).toBeTruthy();
      expect(f.fix, f.rule).not.toContain('\n');
      expect(f.fix!.length, `${f.rule}: ${f.fix}`).toBeLessThanOrEqual(200);
    }
  });

  it('`os explain` carries what the uniqueness fixes no longer say', () => {
    const facts: Record<string, string[]> = {
      [UNIQUE_UNSCOPED_DECLARED_INDEX]: [
        'prepend the NULL-safe organization key part at registration',
        'Run `os migrate meta --from 17` to list the mechanical edits for existing sources',
      ],
      [UNIQUE_DOUBLE_DECLARATION]: ['preferably field-level on the column, or on the declared index'],
      [UNIQUE_LEGACY_ORGANIZATION_COMPOSITE]: [
        'NULL-safe in place rather than prepending a second organization key part',
        '"one email per organization"',
        '`recreate_index` drift op',
        'block it with a report rather than failing a boot',
      ],
    };
    for (const [rule, list] of Object.entries(facts)) {
      const text = explainRule(rule)!.paragraphs.join('\n');
      for (const fact of list) expect(text, `${rule} explanation names ${fact}`).toContain(fact);
    }
  });
});
