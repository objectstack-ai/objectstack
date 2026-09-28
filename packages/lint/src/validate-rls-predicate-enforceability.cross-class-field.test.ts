// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20347] A field compared with a field of ANOTHER comparison class is refused
 * at authoring time, judged by the DECLARED types the rule's object graph
 * carries and the spec's classification (`crossFieldComparisonVerdict`).
 *
 * `record.status != record.amount` (text vs number) and
 * `record.status != record.photo` (text vs a single image) lower to legal
 * `{ status: { $ne: { $field: … } } }` shapes, and before this arm nothing
 * refused them when they were written: measured at the real `os validate`,
 * both were valid. At run time the same policy gave two more answers: the read
 * its `using` scopes answered `INVALID_FILTER` / 400 on driver-sql, and the
 * insert its `check` judges was admitted and stored.
 *
 * One table for the three measured cells (text vs number, text vs image, text
 * vs a formula field): operator × clause × operand order. Then every class
 * against every other class, the same-class controls, and the seams with the
 * neighbouring arms. Both doors are pinned with a real engine in
 * `packages/cli/test/rls-policy-authoring-admission.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import type { EngineFilterJudgement, EngineFilterJudgementOptions } from '@objectstack/spec/contracts';

import {
  validateRlsPredicateEnforceability,
  RLS_PREDICATE_UNENFORCEABLE,
  RLS_PREDICATE_UNKNOWN_FIELD,
} from './validate-rls-predicate-enforceability.js';
import { runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';

const deal = {
  name: 'deal',
  label: 'Deal',
  fields: {
    status: { type: 'text', label: 'Status' },
    owner: { type: 'text', label: 'Owner' },
    stage: { type: 'select', label: 'Stage', options: [{ label: 'Open', value: 'open' }] },
    account: { type: 'lookup', label: 'Account', reference: 'account' },
    amount: { type: 'number', label: 'Amount' },
    budget: { type: 'currency', label: 'Budget' },
    is_won: { type: 'boolean', label: 'Won' },
    is_hot: { type: 'toggle', label: 'Hot' },
    close_date: { type: 'date', label: 'Close date' },
    signed_date: { type: 'date', label: 'Signed date' },
    signed_at: { type: 'datetime', label: 'Signed at' },
    call_time: { type: 'time', label: 'Call time' },
    photo: { type: 'image', label: 'Photo' },
    contract: { type: 'file', label: 'Contract' },
    is_open: {
      type: 'formula',
      label: 'Is open',
      expression: { dialect: 'cel', source: "record.status != 'closed'" },
      returnType: 'boolean',
    },
    tags: { type: 'json', label: 'Tags' },
  },
};
const account = { name: 'account', label: 'Account', fields: { region: { type: 'text', label: 'Region' } } };

/** One permission set, one policy on `deal`. */
const stackWith = (policy: Record<string, unknown>, objects: unknown[] = [deal, account]) => ({
  objects,
  permissions: [{ name: 'sales', label: 'Sales', rowLevelSecurity: [{ name: 'p', object: 'deal', ...policy }] }],
});

/** Every clause, on every operation it can be authored on. */
const CLAUSES = [
  { clause: 'using', operation: 'select' },
  { clause: 'using', operation: 'all' },
  { clause: 'using', operation: 'update' },
  { clause: 'using', operation: 'delete' },
  { clause: 'using', operation: 'insert' },
  { clause: 'check', operation: 'insert' },
  { clause: 'check', operation: 'update' },
  { clause: 'check', operation: 'all' },
] as const;

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

/**
 * The three measured cells, each against `status` (text). `declared` is what
 * the finding says about the column at fault: for a cross-class pair BOTH
 * columns and their classes, for a column with no class that column alone.
 */
const CELLS = [
  {
    cell: 'text vs number',
    field: 'amount',
    declared: (statusFirst: boolean) =>
      statusFirst
        ? "`status` is declared `type: 'text'`, compared as text and `amount` is declared `type: 'number'`, compared as a number"
        : "`amount` is declared `type: 'number'`, compared as a number and `status` is declared `type: 'text'`, compared as text",
  },
  {
    cell: 'text vs a single image',
    field: 'photo',
    declared: () => "`photo` is declared `type: 'image'`, a file field, which no row filter can compare with another column",
  },
  {
    cell: 'text vs a formula field',
    field: 'is_open',
    declared: () => "`is_open` is declared `type: 'formula'`, a formula field, which has no stored column a row filter can read",
  },
] as const;

const CLASS_SENTENCE =
  'Two columns are compared only within one comparison class — the class decides how their stored values order ' +
  'and equal, and across classes SQL and the in-memory evaluator answer differently — and a file field or a ' +
  'formula field has no class at all, so the platform defines no comparison between these columns';

describe('validateRlsPredicateEnforceability — a field compared with a field of another class is REFUSED (#20347)', () => {
  for (const { clause, operation } of CLAUSES) {
    for (const { op, spell, quoted } of OPERATORS) {
      for (const { cell, field, declared } of CELLS) {
        for (const order of ['text first', 'text second'] as const) {
          const statusFirst = order === 'text first';
          const [left, right] = statusFirst ? ['status', field] : [field, 'status'];
          const predicate = spell(left, right);
          it(`${clause} on ${operation} · ${op} · ${cell} · ${order}: \`${predicate}\``, () => {
            const findings = validateRlsPredicateEnforceability(stackWith({ operation, [clause]: predicate }));
            expect(findings.map((f) => ({ severity: f.severity, rule: f.rule, path: f.path }))).toEqual([
              { severity: 'error', rule: RLS_PREDICATE_UNENFORCEABLE, path: `permissions[0].rowLevelSecurity[0].${clause}` },
            ]);
            const [finding] = findings;
            expect(finding.where).toBe('permission set "sales" policy "p" on object "deal"');
            expect(finding.message).toContain(
              `RLS ${clause} \`${predicate}\` lowers, but compares two fields that share no comparison class: ` +
                `\`record.${left} ${quoted} record.${right}\`, where ${declared(statusFirst)}. ${CLASS_SENTENCE}: `,
            );
            expect(finding.hint).toMatch(/^Compare a field only with a field of the same comparison class: /);
          });
        }
      }
    }
  }

  it('the table covers every clause-operation, every field-to-field operator, the three cells, both orders', () => {
    expect(CLAUSES.length * OPERATORS.length * CELLS.length * 2).toBe(336);
  });

  it('states the consequence of its own clause — the refused read and the write check for `using`, the write for `check`', () => {
    const using = validateRlsPredicateEnforceability(stackWith({ operation: 'select', using: 'record.status != record.amount' }))[0];
    expect(using.message).toContain(
      'every read this policy scopes is refused on the SQL drivers (`INVALID_FILTER` / 400: driver-sql refuses the ' +
        "comparison by the two columns' declared types), and every by-id update or delete it scopes fails closed " +
        '(`PERMISSION_DENIED` / 403).',
    );
    expect(using.message).toContain('the same `using` is also the write check whenever no applicable policy');

    const check = validateRlsPredicateEnforceability(stackWith({ operation: 'insert', check: 'record.status != record.amount' }))[0];
    expect(check.message).toContain('every insert or update it judges is refused and nothing is stored');
    expect(check.message).not.toContain('every read this policy scopes');
  });

  it('the prescription names every class with the declared types it holds, read from the spec', () => {
    const [finding] = validateRlsPredicateEnforceability(stackWith({ operation: 'select', using: 'record.status != record.amount' }));
    expect(finding.hint).toContain('a number only with a number (`number`, `currency`, `percent`, `rating`, `slider`, `progress`, `summary`)');
    expect(finding.hint).toContain('a boolean only with a boolean (`boolean`, `toggle`)');
    expect(finding.hint).toContain('a date only with a date (`date`)');
    expect(finding.hint).toContain('a datetime only with a datetime (`datetime`)');
    expect(finding.hint).toContain('a time of day only with a time of day (`time`)');
    for (const t of ['text', 'autonumber', 'select', 'radio', 'lookup', 'master_detail', 'user', 'tree']) {
      expect(finding.hint).toMatch(new RegExp(`text only with text \\([^)]*\`${t}\``));
    }
  });
});

describe('validateRlsPredicateEnforceability — every class against every other class (#20347)', () => {
  // One column per class, plus the two single-valued families with none. The
  // expectation is written from THIS table's labels — same label, same class —
  // never from the verdict function under test.
  const REPRESENTATIVES: ReadonlyArray<[label: string, field: string]> = [
    ['text', 'status'],
    ['text', 'stage'],
    ['text', 'account'],
    ['numeric', 'amount'],
    ['numeric', 'budget'],
    ['boolean', 'is_won'],
    ['boolean', 'is_hot'],
    ['date', 'close_date'],
    ['datetime', 'signed_at'],
    ['time', 'call_time'],
    ['file', 'photo'],
    ['file', 'contract'],
    ['formula', 'is_open'],
  ];
  const hasClass = (label: string) => label !== 'file' && label !== 'formula';

  for (const [leftLabel, left] of REPRESENTATIVES) {
    for (const [rightLabel, right] of REPRESENTATIVES) {
      if (left === right) continue;
      const refused = !(hasClass(leftLabel) && leftLabel === rightLabel);
      it(`${left} (${leftLabel}) != ${right} (${rightLabel}) → ${refused ? 'refused' : 'clean'}`, () => {
        const findings = validateRlsPredicateEnforceability(
          stackWith({ operation: 'select', using: `record.${left} != record.${right}` }),
        );
        expect(findings.map((f) => f.rule)).toEqual(refused ? [RLS_PREDICATE_UNENFORCEABLE] : []);
      });
    }
  }

  it('a column compared with itself is judged by its own class: a number is comparable, a file field is not', () => {
    expect(validateRlsPredicateEnforceability(stackWith({ operation: 'select', using: 'record.amount == record.amount' }))).toEqual([]);
    const [finding] = validateRlsPredicateEnforceability(stackWith({ operation: 'select', using: 'record.photo == record.photo' }));
    expect(finding.message).toContain(
      "`record.photo == record.photo`, where `photo` is declared `type: 'image'`, a file field, which no row filter can compare with another column.",
    );
  });

  it('a registry-injected column is judged by the definition the registry provisions: `created_at` is a datetime', () => {
    const [finding] = validateRlsPredicateEnforceability(stackWith({ operation: 'select', using: 'record.status != record.created_at' }));
    expect(finding.rule).toBe(RLS_PREDICATE_UNENFORCEABLE);
    expect(finding.message).toContain("`created_at` is declared `type: 'datetime'`, compared as a datetime");
    expect(validateRlsPredicateEnforceability(stackWith({ operation: 'select', using: 'record.signed_at > record.created_at' }))).toEqual([]);
  });
});

describe('validateRlsPredicateEnforceability — same-class comparisons stay CLEAN (#20347 controls)', () => {
  const CONTROLS: ReadonlyArray<[string, string]> = [
    ['text != text', 'record.status != record.owner'],
    ['a select == a lookup (both text)', 'record.stage == record.account'],
    ['number > currency (both numeric)', 'record.amount > record.budget'],
    ['boolean == toggle', 'record.is_won == record.is_hot'],
    ['date <= date', 'record.close_date <= record.signed_date'],
    ['a file field null test (not a field-to-field comparison)', 'record.photo != null'],
    ['a number against a literal', 'record.amount > 5'],
    ['text against a current_user value', 'record.owner == current_user.id'],
  ];
  for (const { clause, operation } of CLAUSES) {
    for (const [label, predicate] of CONTROLS) {
      it(`${clause} on ${operation} · ${label}: \`${predicate}\``, () => {
        expect(validateRlsPredicateEnforceability(stackWith({ operation, [clause]: predicate }))).toEqual([]);
      });
    }
  }
});

describe('validateRlsPredicateEnforceability — the arm is the graph\'s, and reports once (#20347)', () => {
  it('names every offending comparison of one clause in ONE finding', () => {
    const findings = validateRlsPredicateEnforceability(
      stackWith({ operation: 'select', using: 'record.status != record.amount || record.close_date < record.signed_at' }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain(
      "class: `record.status != record.amount`, where `status` is declared `type: 'text'`, compared as text and " +
        "`amount` is declared `type: 'number'`, compared as a number; `record.close_date < record.signed_at`, where " +
        "`close_date` is declared `type: 'date'`, compared as a date and `signed_at` is declared `type: 'datetime'`, " +
        'compared as a datetime. ',
    );
  });

  it('a comparison against a list or an object stays the list-holding arm\'s — never reported twice', () => {
    for (const predicate of ['record.status != record.tags', 'record.photo != record.tags', 'record.is_open == record.tags']) {
      const findings = validateRlsPredicateEnforceability(stackWith({ operation: 'select', using: predicate }));
      expect(findings, predicate).toHaveLength(1);
      expect(findings[0].message, predicate).toContain('compares a field with a field that holds a list or an object');
      expect(findings[0].message, predicate).not.toContain('share no comparison class');
    }
  });

  it('two defects in one clause — a list and a class mismatch — earn one finding each', () => {
    const findings = validateRlsPredicateEnforceability(
      stackWith({ operation: 'select', using: 'record.status != record.tags && record.status != record.amount' }),
    );
    expect(findings.map((f) => f.rule)).toEqual([RLS_PREDICATE_UNENFORCEABLE, RLS_PREDICATE_UNENFORCEABLE]);
    expect(findings[0].message).toContain('holds a list or an object: `record.status != record.tags`');
    expect(findings[1].message).toContain('share no comparison class: `record.status != record.amount`');
  });

  it('judges nothing the graph cannot answer: an object outside the stack, a field map it cannot read, `id`', () => {
    expect(validateRlsPredicateEnforceability(stackWith({ operation: 'select', using: 'record.status != record.amount' }, [account]))).toEqual([]);
    expect(
      validateRlsPredicateEnforceability(stackWith({ operation: 'select', using: 'record.status != record.amount' }, [{ name: 'deal' }])),
    ).toEqual([]);
    expect(validateRlsPredicateEnforceability(stackWith({ operation: 'select', using: 'record.amount != record.id' }))).toEqual([]);
  });

  it('a declared type outside FieldType is Zod\'s to refuse, not this arm\'s', () => {
    const objects = [{ ...deal, fields: { ...deal.fields, subject: { type: 'integer', label: 'Subject' } } }, account];
    expect(
      validateRlsPredicateEnforceability(stackWith({ operation: 'select', using: 'record.status != record.subject' }, objects)),
    ).toEqual([]);
  });

  it('an undeclared column is the unknown-field finding alone — this arm never doubles it', () => {
    const findings = validateRlsPredicateEnforceability(stackWith({ operation: 'select', using: 'record.amount != record.nope' }));
    expect(findings.map((f) => f.rule)).toEqual([RLS_PREDICATE_UNKNOWN_FIELD]);
  });

  it('one defect, one finding: a read scope this arm refused is not handed to the engine judge', () => {
    const calls: unknown[] = [];
    const judgeFilter = (object: string, where: unknown, options?: EngineFilterJudgementOptions): EngineFilterJudgement => {
      calls.push({ object, where, options });
      return { ok: true };
    };
    for (const predicate of ['record.status != record.amount', 'record.status != record.photo', 'record.status != record.is_open']) {
      const refused = validateRlsPredicateEnforceability(stackWith({ operation: 'select', using: predicate }), { judgeFilter });
      expect(refused.map((f) => f.rule), predicate).toEqual([RLS_PREDICATE_UNENFORCEABLE]);
    }
    expect(calls).toEqual([]);

    // CONTROL: the same-class spelling reaches the judge, as every clean read scope does.
    expect(
      validateRlsPredicateEnforceability(stackWith({ operation: 'select', using: 'record.amount > record.budget' }), { judgeFilter }),
    ).toEqual([]);
    expect(calls).toEqual([
      { object: 'deal', where: { amount: { $gt: { $field: 'budget' } } }, options: { operation: 'find' } },
    ]);
  });

  it('reaches the author through `os validate`\'s rule table and the runtime publish gate alike', () => {
    const stack = stackWith({ operation: 'insert', check: 'record.amount > record.status' });
    const cli = runAuthoringRules('validate', { normalized: stack, parsed: stack }).filter((f) =>
      f.rule.startsWith('rls-predicate-'),
    );
    expect(cli.map((f) => ({ rule: f.rule, path: f.path }))).toEqual([
      { rule: RLS_PREDICATE_UNENFORCEABLE, path: 'permissions[0].rowLevelSecurity[0].check' },
    ]);

    const saved = runRuntimeAuthoringRules({
      type: 'permission',
      item: stack.permissions[0],
      context: { objects: [deal, account], permissions: [] },
    });
    const refused = saved.errors.filter((f) => f.rule.startsWith('rls-predicate-'));
    expect(refused.map((f) => ({ rule: f.rule, path: f.path }))).toEqual([
      { rule: RLS_PREDICATE_UNENFORCEABLE, path: 'permissions.sales.rowLevelSecurity[0].check' },
    ]);
    expect(refused[0].message).toBe(cli[0].message);
  });
});
