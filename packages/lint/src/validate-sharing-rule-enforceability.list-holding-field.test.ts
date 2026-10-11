// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19886] A sharing rule whose `condition` compares a field with a field that
 * holds a LIST or an OBJECT is refused at authoring time, judged by the
 * DECLARED type the stack's object graph carries — the sharing-rule twin of the
 * RLS arm pinned in `validate-rls-predicate-enforceability.list-holding-field.test.ts`,
 * through the same classification (`listHoldingComparisons`).
 *
 * `record.status != record.tags` (`tags` a `json` field or a `multiple` lookup)
 * lowers to a legal `{ status: { $ne: { $field: 'tags' } } }`, so the seeder
 * seeds the rule — and every criteria query it runs is then refused by
 * driver-sql by declared type (`INVALID_FILTER` / 400), which
 * `SharingRuleService` reads as "matches no record". Measured through the real
 * plugin-sharing: the rule is seeded and grants nothing, at boot and on every
 * later write. Before this arm every cell of the table below was clean at
 * `os validate`.
 *
 * One table: operator × column class × operand order, then the scalar
 * field-to-field controls, which stay clean.
 */

import { describe, expect, it } from 'vitest';

import {
  validateSharingRuleEnforceability as validateSharingRuleEnforceabilityUnrecorded,
  SHARING_RULE_UNLOWERABLE_CONDITION,
} from './validate-sharing-rule-enforceability.js';
import { validateRlsPredicateEnforceability } from './validate-rls-predicate-enforceability.js';
import { runAuthoringRules } from './authoring-rules.js';
import { explainRule } from './rule-explanations.js';

// [#22161] Each finding is one verdict sentence; the reasoning it used to
// carry is the id's `os explain` entry. Every call below records what it
// fired, and the last case in this file holds each recorded verdict to one
// line of at most 200 characters. Run the whole file: that case reads what the
// cases above fired.
const fired: Array<{ rule: string; message: string }> = [];
const validateSharingRuleEnforceability: typeof validateSharingRuleEnforceabilityUnrecorded = (...args) => {
  const findings = validateSharingRuleEnforceabilityUnrecorded(...args);
  fired.push(...findings);
  return findings;
};

const deal = {
  name: 'deal',
  label: 'Deal',
  sharingModel: 'private',
  fields: {
    status: { type: 'text', label: 'Status' },
    owner_name: { type: 'text', label: 'Owner name' },
    amount: { type: 'number', label: 'Amount' },
    budget: { type: 'number', label: 'Budget' },
    close_date: { type: 'date', label: 'Close date' },
    signed_date: { type: 'date', label: 'Signed date' },
    account: { type: 'lookup', label: 'Account', reference: 'account' },
    stage: { type: 'select', label: 'Stage', options: [{ label: 'Open', value: 'open' }] },
    tags: { type: 'json', label: 'Tags' },
    reviewers: { type: 'lookup', label: 'Reviewers', reference: 'account', multiple: true },
  },
};
const account = { name: 'account', label: 'Account', sharingModel: 'private', fields: { region: { type: 'text', label: 'Region' } } };

/** One criteria sharing rule on `deal`, the condition swapped in. */
const stackWith = (condition: unknown, objects: unknown[] = [deal, account], extra: Record<string, unknown> = {}) => ({
  objects,
  sharingRules: [
    {
      name: 'deal_desk_share',
      type: 'criteria',
      object: 'deal',
      accessLevel: 'read',
      sharedWith: { type: 'team', value: 'deal_desk' },
      condition,
      ...extra,
    },
  ],
});

/** Each operator an author can write between two fields, and what the finding quotes back. */
const OPERATORS: ReadonlyArray<{ op: string; spell: (a: string, b: string) => string; quoted: string }> = [
  { op: '!=', spell: (a, b) => `record.${a} != record.${b}`, quoted: '!=' },
  { op: '!(==)', spell: (a, b) => `!(record.${a} == record.${b})`, quoted: '==' },
  { op: '==', spell: (a, b) => `record.${a} == record.${b}`, quoted: '==' },
  { op: '>', spell: (a, b) => `record.${a} > record.${b}`, quoted: '>' },
  { op: '>=', spell: (a, b) => `record.${a} >= record.${b}`, quoted: '>=' },
  { op: '<', spell: (a, b) => `record.${a} < record.${b}`, quoted: '<' },
  { op: '<=', spell: (a, b) => `record.${a} <= record.${b}`, quoted: '<=' },
];

const COLUMNS = [
  { column: 'a json field', field: 'tags' },
  { column: 'a multiple lookup', field: 'reviewers' },
] as const;

/** What the refusal costs on the sharing path — the verdict's closing clause. */
const CONSEQUENCE = 'so its criteria query is refused (INVALID_FILTER / 400) and it grants nothing';

describe('validateSharingRuleEnforceability — a condition comparing a field with a json / multiple field is REFUSED (#19886)', () => {
  for (const { op, spell, quoted } of OPERATORS) {
    for (const { column, field } of COLUMNS) {
      for (const order of ['scalar first', 'list first'] as const) {
        const [left, right] = order === 'scalar first' ? ['status', field] : [field, 'status'];
        const condition = spell(left, right);
        it(`${op} · ${column} · ${order}: \`${condition}\``, () => {
          const findings = validateSharingRuleEnforceability(stackWith(condition));
          expect(findings.map((f) => ({ severity: f.severity, rule: f.rule, path: f.path, where: f.where }))).toEqual([
            {
              severity: 'error',
              rule: SHARING_RULE_UNLOWERABLE_CONDITION,
              path: 'sharingRules[0].condition',
              where: 'sharing rule "deal_desk_share" on object "deal"',
            },
          ]);
          expect(findings[0].message).toBe(
            `condition compares \`record.${left} ${quoted} record.${right}\`, where \`${field}\` holds a list or an ` +
              `object, ${CONSEQUENCE}`,
          );
          expect(findings[0].hint).toMatch(/^A field compared with a `json` or `multiple` field has no row-filter form/);
        });
      }
    }
  }

  it('the table covers every field-to-field operator, both classes, both orders', () => {
    expect(OPERATORS.length * COLUMNS.length * 2).toBe(28);
  });

  it('the parsed tier (`{ dialect, source }`) is refused identically', () => {
    const findings = validateSharingRuleEnforceability(stackWith({ dialect: 'cel', source: 'record.status != record.tags' }));
    expect(findings.map((f) => f.rule)).toEqual([SHARING_RULE_UNLOWERABLE_CONDITION]);
    expect(findings[0].message).toContain('condition compares `record.status != record.tags`, where `tags` holds');
  });

  it('an offending comparison inside a compound condition is refused, and a second one is named in the same finding', () => {
    const one = validateSharingRuleEnforceability(stackWith("record.stage == 'open' && record.status != record.tags"));
    expect(one.map((f) => f.rule)).toEqual([SHARING_RULE_UNLOWERABLE_CONDITION]);

    const two = validateSharingRuleEnforceability(stackWith('record.status != record.tags || record.reviewers == record.tags'));
    expect(two).toHaveLength(1);
    expect(two[0].message).toContain('compares `record.status != record.tags`, where `tags` holds a list or an object (and 1 more), ');
  });

  it('an inactive rule is judged too — the seeder compiles and seeds it regardless of `active`', () => {
    const findings = validateSharingRuleEnforceability(stackWith('record.status != record.tags', [deal, account], { active: false }));
    expect(findings.map((f) => f.rule)).toEqual([SHARING_RULE_UNLOWERABLE_CONDITION]);
  });

  it('speaks the RLS arm\'s verdict and class paragraph, word for word — one class, one sentence, two surfaces', () => {
    const rls = validateRlsPredicateEnforceability({
      objects: [deal, account],
      permissions: [{ name: 'sales', label: 'Sales', rowLevelSecurity: [{ name: 'p', object: 'deal', operation: 'select', using: 'record.status != record.tags' }] }],
    });
    const sharing = validateSharingRuleEnforceability(stackWith('record.status != record.tags'));
    const verdict = 'compares `record.status != record.tags`, where `tags` holds a list or an object, ';
    expect(rls[0].message).toContain(verdict);
    expect(sharing[0].message).toContain(verdict);
    const classParagraph = (rule: string) =>
      explainRule(rule)?.paragraphs.find((p) => p.startsWith('A column that holds a list or an object'));
    expect(classParagraph(SHARING_RULE_UNLOWERABLE_CONDITION)).toBeDefined();
    expect(classParagraph(SHARING_RULE_UNLOWERABLE_CONDITION)).toBe(classParagraph(rls[0].rule));
  });
});

describe('validateSharingRuleEnforceability — every declared list-or-object class, read from the spec (#19886)', () => {
  // The spec's two value-shape classes: `STRUCTURED_JSON_TYPES` and
  // `isMultiValueField` (an inherently-multi option type, or a multi-capable
  // type flagged `multiple: true`) — the same table the RLS arm pins.
  const LIST_HOLDING: ReadonlyArray<[string, Record<string, unknown>, string]> = [
    ['json', { type: 'json' }, "`type: 'json'`"],
    ['composite', { type: 'composite' }, "`type: 'composite'`"],
    ['repeater', { type: 'repeater' }, "`type: 'repeater'`"],
    ['record', { type: 'record' }, "`type: 'record'`"],
    ['location', { type: 'location' }, "`type: 'location'`"],
    ['address', { type: 'address' }, "`type: 'address'`"],
    ['vector', { type: 'vector' }, "`type: 'vector'`"],
    ['multiselect', { type: 'multiselect' }, "`type: 'multiselect'`"],
    ['checkboxes', { type: 'checkboxes' }, "`type: 'checkboxes'`"],
    ['tags', { type: 'tags' }, "`type: 'tags'`"],
    ['multiple select', { type: 'select', multiple: true }, "`type: 'select'`, `multiple: true`"],
    ['multiple radio', { type: 'radio', multiple: true }, "`type: 'radio'`, `multiple: true`"],
    ['multiple lookup', { type: 'lookup', reference: 'account', multiple: true }, "`type: 'lookup'`, `multiple: true`"],
    ['multiple user', { type: 'user', multiple: true }, "`type: 'user'`, `multiple: true`"],
    ['multiple file', { type: 'file', multiple: true }, "`type: 'file'`, `multiple: true`"],
    ['multiple image', { type: 'image', multiple: true }, "`type: 'image'`, `multiple: true`"],
  ];
  for (const [label, def] of LIST_HOLDING) {
    it(`${label}: refused, naming the column`, () => {
      const objects = [{ ...deal, fields: { ...deal.fields, subject: { label: 'Subject', ...def } } }, account];
      const findings = validateSharingRuleEnforceability(stackWith('record.status != record.subject', objects));
      expect(findings.map((f) => f.rule)).toEqual([SHARING_RULE_UNLOWERABLE_CONDITION]);
      expect(findings[0].message).toContain('`record.status != record.subject`, where `subject` holds a list or an object,');
    });
  }
});

describe('validateSharingRuleEnforceability — the one-value spellings stay CLEAN (#19886 controls)', () => {
  const CONTROLS: ReadonlyArray<[string, string]> = [
    ['text != text', 'record.status != record.owner_name'],
    ['text == text', 'record.status == record.owner_name'],
    ['!(text == text)', '!(record.status == record.owner_name)'],
    ['number > number', 'record.amount > record.budget'],
    ['date <= date', 'record.close_date <= record.signed_date'],
    ['a single lookup == text', 'record.account == record.owner_name'],
    ['a single select != text', 'record.stage != record.status'],
    ['a json field against a literal (not a field-to-field comparison)', "record.tags == 'a'"],
    ['a json field null test', 'record.tags != null'],
    ['a flat literal list', "record.status in ['open', 'pending']"],
  ];
  for (const [label, condition] of CONTROLS) {
    it(`${label}: \`${condition}\``, () => {
      expect(validateSharingRuleEnforceability(stackWith(condition))).toEqual([]);
    });
  }

  it('a single-valued field of a multi-capable type is one value: `select`, `lookup`, `user`', () => {
    for (const def of [{ type: 'select' }, { type: 'lookup', reference: 'account' }, { type: 'user' }]) {
      const objects = [{ ...deal, fields: { ...deal.fields, subject: { label: 'Subject', ...def } } }, account];
      expect(validateSharingRuleEnforceability(stackWith('record.status != record.subject', objects)), def.type).toEqual([]);
    }
  });

  it('a single-valued `file` field is one value too — not this arm\'s; the comparison-class arm refuses it (#20347)', () => {
    // It holds no list, so this arm stays silent; but the file family has no
    // comparison class at all, so the #20347 arm refuses the comparison, once.
    const objects = [{ ...deal, fields: { ...deal.fields, subject: { label: 'Subject', type: 'file' } } }, account];
    const findings = validateSharingRuleEnforceability(stackWith('record.status != record.subject', objects));
    expect(findings.map((f) => f.rule)).toEqual([SHARING_RULE_UNLOWERABLE_CONDITION]);
    expect(findings[0].message).not.toContain('holds a list or');
    expect(findings[0].message).toContain('which no comparison class spans (text vs a file field)');
  });
});

describe('validateSharingRuleEnforceability — the arm is the graph\'s, and reports once (#19886)', () => {
  it('judges nothing the graph cannot answer: an anchor outside the stack, a field map it cannot read, an undeclared name', () => {
    expect(validateSharingRuleEnforceability(stackWith('record.status != record.tags', [account]))).toEqual([]);
    expect(validateSharingRuleEnforceability(stackWith('record.status != record.tags', [{ name: 'deal', sharingModel: 'private' }]))).toEqual([]);
    expect(validateSharingRuleEnforceability(stackWith('record.status != record.nope'))).toEqual([]);
  });

  it('one defect, one finding: a condition the compiler already refuses keeps its own finding alone', () => {
    const findings = validateSharingRuleEnforceability(stackWith('size(record.tags) > 0 && record.status != record.tags'));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SHARING_RULE_UNLOWERABLE_CONDITION);
    expect(findings[0].message).toMatch(/^condition is not lowerable/);
    expect(findings[0].message).not.toMatch(/holds a list or an object/);
  });

  it('reports beside the anchor arm, independently — two fields, two findings', () => {
    const publicDeal = { ...deal, sharingModel: 'public_read_write' };
    const findings = validateSharingRuleEnforceability(stackWith('record.status != record.tags', [publicDeal, account]));
    expect(findings.map((f) => [f.rule, f.path])).toEqual([
      ['sharing-rule-object-not-shareable', 'sharingRules[0].object'],
      [SHARING_RULE_UNLOWERABLE_CONDITION, 'sharingRules[0].condition'],
    ]);
  });

  it('reaches the author through `os validate`\'s rule table', () => {
    const stack = stackWith('record.reviewers == record.status');
    const cli = runAuthoringRules('validate', { normalized: stack, parsed: stack }).filter((f) => f.rule.startsWith('sharing-rule-'));
    expect(cli.map((f) => ({ rule: f.rule, path: f.path }))).toEqual([
      { rule: SHARING_RULE_UNLOWERABLE_CONDITION, path: 'sharingRules[0].condition' },
    ]);
    expect(cli[0].message).toContain('`record.reviewers == record.status`, where `reviewers` holds a list or an object');
  });
});

describe('[#22161] one-line verdicts', () => {
  it('every verdict the cases above fired is one line of at most 200 characters', () => {
    // The coverage control first: the cases above fired the list-holding
    // verdict, so the shape assertion cannot pass over an empty record.
    expect(fired.some((f) => f.message.includes('holds a list or an object'))).toBe(true);
    for (const f of fired) {
      expect(f.message, f.rule).not.toContain('\n');
      expect(f.message.length, `${f.rule}: ${f.message}`).toBeLessThanOrEqual(200);
    }
  });

  it('`os explain` carries the measured consequence the verdict no longer states', () => {
    const text = explainRule(SHARING_RULE_UNLOWERABLE_CONDITION)?.paragraphs.join('\n') ?? '';
    expect(text).toContain('`SharingRuleService` reads a refused query as matching no record');
    expect(text).toContain('at boot or on any later write');
  });
});
