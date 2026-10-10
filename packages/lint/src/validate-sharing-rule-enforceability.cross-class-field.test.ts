// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20347] A sharing rule whose `condition` compares two fields that share no
 * comparison class — text vs number, text vs a single image, text vs a formula
 * field — is refused at authoring time: the sharing-rule twin of the RLS arm
 * pinned in `validate-rls-predicate-enforceability.cross-class-field.test.ts`,
 * through the same classification (`crossClassComparisons`, which reads the
 * spec's `crossFieldComparisonVerdict`).
 *
 * `record.status != record.amount` lowers to a legal
 * `{ status: { $ne: { $field: 'amount' } } }`, so the seeder seeds the rule —
 * and every criteria query it runs meets driver-sql's cross-field check, which
 * refuses a comparison across classes (or against the file family, or a
 * formula field) with the same `INVALID_FILTER` / 400 it gives a list-holding
 * column. Before this arm every cell below was clean at `os validate`.
 */

import { describe, expect, it } from 'vitest';

import {
  validateSharingRuleEnforceability as validateSharingRuleEnforceabilityUnrecorded,
  SHARING_RULE_UNLOWERABLE_CONDITION,
} from './validate-sharing-rule-enforceability.js';
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
    signed_at: { type: 'datetime', label: 'Signed at' },
    photo: { type: 'image', label: 'Photo' },
    is_open: {
      type: 'formula',
      label: 'Is open',
      expression: { dialect: 'cel', source: "record.status != 'closed'" },
      returnType: 'boolean',
    },
    tags: { type: 'json', label: 'Tags' },
  },
};
const account = { name: 'account', label: 'Account', sharingModel: 'private', fields: { region: { type: 'text', label: 'Region' } } };

/** One criteria sharing rule on `deal`, the condition swapped in. */
const stackWith = (condition: unknown, objects: unknown[] = [deal, account]) => ({
  objects,
  sharingRules: [
    {
      name: 'deal_desk_share',
      type: 'criteria',
      object: 'deal',
      accessLevel: 'read',
      sharedWith: { type: 'team', value: 'deal_desk' },
      condition,
    },
  ],
});

const OPERATORS: ReadonlyArray<{ op: string; spell: (a: string, b: string) => string; quoted: string }> = [
  { op: '!=', spell: (a, b) => `record.${a} != record.${b}`, quoted: '!=' },
  { op: '!(==)', spell: (a, b) => `!(record.${a} == record.${b})`, quoted: '==' },
  { op: '==', spell: (a, b) => `record.${a} == record.${b}`, quoted: '==' },
  { op: '>', spell: (a, b) => `record.${a} > record.${b}`, quoted: '>' },
  { op: '<=', spell: (a, b) => `record.${a} <= record.${b}`, quoted: '<=' },
];

/** How the finding names each cell's column: its class, or why it has none. */
const CELLS = [
  { cell: 'text vs number', field: 'amount', side: 'a number' },
  { cell: 'text vs a single image', field: 'photo', side: 'a file field' },
  { cell: 'text vs a formula field', field: 'is_open', side: 'a formula field' },
] as const;

describe('validateSharingRuleEnforceability — a field compared with a field of another class is REFUSED (#20347)', () => {
  for (const { op, spell, quoted } of OPERATORS) {
    for (const { cell, field, side } of CELLS) {
      for (const order of ['text first', 'text second'] as const) {
        const [left, right] = order === 'text first' ? ['status', field] : [field, 'status'];
        const condition = spell(left, right);
        it(`${op} · ${cell} · ${order}: \`${condition}\``, () => {
          const findings = validateSharingRuleEnforceability(stackWith(condition));
          expect(findings.map((f) => ({ severity: f.severity, rule: f.rule, path: f.path }))).toEqual([
            { severity: 'error', rule: SHARING_RULE_UNLOWERABLE_CONDITION, path: 'sharingRules[0].condition' },
          ]);
          const [finding] = findings;
          expect(finding.where).toBe('sharing rule "deal_desk_share" on object "deal"');
          const why = order === 'text first' ? `text vs ${side}` : `${side} vs text`;
          expect(finding.message).toBe(
            `condition compares \`record.${left} ${quoted} record.${right}\`, which no comparison class spans ` +
              `(${why}), so its criteria query is refused (INVALID_FILTER / 400) and it grants nothing`,
          );
          expect(finding.hint).toMatch(/^Compare a field only with a field of the same comparison class: /);
        });
      }
    }
  }

  it('the envelope form `os validate` hands in — `{ dialect, source }` — is judged the same', () => {
    const findings = validateSharingRuleEnforceability(stackWith({ dialect: 'cel', source: 'record.status != record.amount' }));
    expect(findings.map((f) => f.rule)).toEqual([SHARING_RULE_UNLOWERABLE_CONDITION]);
  });
});

describe('validateSharingRuleEnforceability — same-class comparisons stay CLEAN (#20347 controls)', () => {
  const CONTROLS: ReadonlyArray<[string, string]> = [
    ['text != text', 'record.status != record.owner_name'],
    ['number > number', 'record.amount > record.budget'],
    ['a file field null test', 'record.photo != null'],
    ['a number against a literal', 'record.amount > 1000'],
  ];
  for (const [label, condition] of CONTROLS) {
    it(`${label}: \`${condition}\``, () => {
      expect(validateSharingRuleEnforceability(stackWith(condition))).toEqual([]);
    });
  }
});

describe('validateSharingRuleEnforceability — one comparison, one finding (#20347)', () => {
  it('a comparison against a list or an object stays the list-holding arm\'s', () => {
    const findings = validateSharingRuleEnforceability(stackWith('record.photo != record.tags'));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('holds a list or an object');
    expect(findings[0].message).not.toContain('which no comparison class spans');
  });

  it('two defects in one condition — a list and a class mismatch — earn one finding each', () => {
    const findings = validateSharingRuleEnforceability(stackWith('record.status != record.tags && record.close_date < record.signed_at'));
    expect(findings.map((f) => f.rule)).toEqual([SHARING_RULE_UNLOWERABLE_CONDITION, SHARING_RULE_UNLOWERABLE_CONDITION]);
    expect(findings[0].message).toContain('holds a list or an object');
    expect(findings[1].message).toContain(
      'compares `record.close_date < record.signed_at`, which no comparison class spans (a date vs a datetime)',
    );
  });

  it('judges nothing the graph cannot answer: an anchor outside the stack, a field map it cannot read', () => {
    expect(validateSharingRuleEnforceability(stackWith('record.status != record.amount', [account]))).toEqual([]);
    expect(validateSharingRuleEnforceability(stackWith('record.status != record.amount', [{ name: 'deal', sharingModel: 'private' }]))).toEqual([]);
  });

  it('reaches the author through `os validate`\'s rule table', () => {
    const stack = stackWith('record.amount > record.status');
    const cli = runAuthoringRules('validate', { normalized: stack, parsed: stack }).filter((f) => f.rule.startsWith('sharing-rule-'));
    expect(cli.map((f) => ({ rule: f.rule, path: f.path }))).toEqual([
      { rule: SHARING_RULE_UNLOWERABLE_CONDITION, path: 'sharingRules[0].condition' },
    ]);
  });
});

describe('[#22161] one-line verdicts', () => {
  it('every verdict the cases above fired is one line of at most 200 characters', () => {
    // The coverage control first: the cases above fired the cross-class
    // verdict, so the shape assertion cannot pass over an empty record.
    expect(fired.some((f) => f.message.includes('which no comparison class spans'))).toBe(true);
    for (const f of fired) {
      expect(f.message, f.rule).not.toContain('\n');
      expect(f.message.length, `${f.rule}: ${f.message}`).toBeLessThanOrEqual(200);
    }
  });

  it('`os explain` carries the class rule and the seeded-but-refused consequence the verdict no longer states', () => {
    const text = explainRule(SHARING_RULE_UNLOWERABLE_CONDITION)?.paragraphs.join('\n') ?? '';
    expect(text).toContain('Two columns are compared only within one comparison class');
    expect(text).toContain('so the rule IS seeded into `sys_sharing_rule`, but every criteria query it runs is refused');
    expect(text).toContain('The rule is declared and grants nothing.');
  });
});
