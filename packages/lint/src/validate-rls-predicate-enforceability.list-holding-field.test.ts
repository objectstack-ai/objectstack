// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19886] A field compared with a field that holds a LIST or an OBJECT is
 * refused at authoring time, judged by the DECLARED type the rule's object
 * graph carries.
 *
 * `record.status != record.tags` (`tags` a `json` field or a `multiple` lookup)
 * lowers to a legal `{ status: { $ne: { $field: 'tags' } } }`, and before this
 * arm nothing refused it when it was written: measured at `os validate` and at
 * the metadata save door, every cell of the table below was clean. The runtime
 * refuses every one of them — the write check per record (`INVALID_FILTER` /
 * 400), driver-sql on the read by declared type (400), and the by-id update or
 * delete a `using` scopes fails closed (403) — so each is a policy that can
 * never do what it says.
 *
 * One table: operator × clause × column class × operand order, then the scalar
 * field-to-field controls, which stay clean. Both doors are pinned with a real
 * engine in `packages/cli/test/rls-policy-authoring-admission.test.ts`.
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

const COLUMNS = [
  { column: 'a json field', field: 'tags', declared: "`tags` is declared `type: 'json'`" },
  { column: 'a multiple lookup', field: 'reviewers', declared: "`reviewers` is declared `type: 'lookup'`, `multiple: true`" },
] as const;

const CLASS_SENTENCE =
  'A column that holds a list or an object is not one comparable value, on either side of a field-to-field ' +
  'comparison, so the platform refuses the comparison instead of evaluating it';

describe('validateRlsPredicateEnforceability — a field compared with a json / multiple field is REFUSED (#19886)', () => {
  for (const { clause, operation } of CLAUSES) {
    for (const { op, spell, quoted } of OPERATORS) {
      for (const { column, field, declared } of COLUMNS) {
        for (const order of ['scalar first', 'list first'] as const) {
          const [left, right] = order === 'scalar first' ? ['status', field] : [field, 'status'];
          const predicate = spell(left, right);
          it(`${clause} on ${operation} · ${op} · ${column} · ${order}: \`${predicate}\``, () => {
            const findings = validateRlsPredicateEnforceability(stackWith({ operation, [clause]: predicate }));
            expect(findings.map((f) => ({ severity: f.severity, rule: f.rule, path: f.path }))).toEqual([
              { severity: 'error', rule: RLS_PREDICATE_UNENFORCEABLE, path: `permissions[0].rowLevelSecurity[0].${clause}` },
            ]);
            const [finding] = findings;
            expect(finding.where).toBe('permission set "sales" policy "p" on object "deal"');
            expect(finding.message).toContain(
              `RLS ${clause} \`${predicate}\` lowers, but compares a field with a field that holds a list or an ` +
                `object: \`record.${left} ${quoted} record.${right}\`, where ${declared}. ${CLASS_SENTENCE}: `,
            );
            expect(finding.hint).toMatch(/^A field compared with a `json` or `multiple` field has no row-filter form/);
          });
        }
      }
    }
  }

  it('the table covers every clause-operation, every field-to-field operator, both classes, both orders', () => {
    expect(CLAUSES.length * OPERATORS.length * COLUMNS.length * 2).toBe(224);
  });

  it('states the consequence of its own clause — the read and the fail-closed write for `using`, the write for `check`', () => {
    const using = validateRlsPredicateEnforceability(stackWith({ operation: 'select', using: 'record.status != record.tags' }))[0];
    expect(using.message).toContain(
      'every read this policy scopes is refused on the SQL drivers (`INVALID_FILTER` / 400: driver-sql refuses a ' +
        'cross-field comparison against such a column by its declared type), and every by-id update or delete it ' +
        'scopes fails closed (`PERMISSION_DENIED` / 403).',
    );
    expect(using.message).toContain('the same `using` is also the write check whenever no applicable policy');

    const check = validateRlsPredicateEnforceability(stackWith({ operation: 'insert', check: 'record.status != record.tags' }))[0];
    expect(check.message).toContain(
      'every single-record insert and by-id update whose record holds a list or an object in that column is ' +
        'refused (`INVALID_FILTER` / 400) and stores nothing',
    );
    expect(check.message).not.toContain('every read this policy scopes');
  });
});

describe('validateRlsPredicateEnforceability — every declared list-or-object class, read from the spec (#19886)', () => {
  // The spec's two value-shape classes: `STRUCTURED_JSON_TYPES` and
  // `isMultiValueField` (an inherently-multi option type, or a multi-capable
  // type flagged `multiple: true`).
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
  for (const [label, def, declared] of LIST_HOLDING) {
    it(`${label}: refused, naming the declaration`, () => {
      const objects = [{ ...deal, fields: { ...deal.fields, subject: { label: 'Subject', ...def } } }, account];
      const findings = validateRlsPredicateEnforceability(
        stackWith({ operation: 'select', using: 'record.status != record.subject' }, objects),
      );
      expect(findings.map((f) => f.rule)).toEqual([RLS_PREDICATE_UNENFORCEABLE]);
      expect(findings[0].message).toContain(`\`record.status != record.subject\`, where \`subject\` is declared ${declared}.`);
    });
  }
});

describe('validateRlsPredicateEnforceability — the one-value spellings stay CLEAN (#19886 controls)', () => {
  const CONTROLS: ReadonlyArray<[string, string]> = [
    ['text != text', 'record.status != record.owner'],
    ['text == text', 'record.status == record.owner'],
    ['!(text == text)', '!(record.status == record.owner)'],
    ['number > number', 'record.amount > record.budget'],
    ['date <= date', 'record.close_date <= record.signed_date'],
    ['a single lookup == text', 'record.account == record.owner'],
    ['a single select != text', 'record.stage != record.status'],
    ['a json field against a literal (not a field-to-field comparison)', "record.tags == 'a'"],
    ['a json field null test', 'record.tags != null'],
    ['a flat literal list', "record.status in ['open', 'pending']"],
    ['a membership set', 'record.owner in current_user.org_user_ids'],
  ];
  for (const { clause, operation } of CLAUSES) {
    for (const [label, predicate] of CONTROLS) {
      it(`${clause} on ${operation} · ${label}: \`${predicate}\``, () => {
        expect(validateRlsPredicateEnforceability(stackWith({ operation, [clause]: predicate }))).toEqual([]);
      });
    }
  }

  it('a single-valued field of a multi-capable type is one value: `select`, `lookup`, `user`, `file`', () => {
    for (const def of [{ type: 'select' }, { type: 'lookup', reference: 'account' }, { type: 'user' }, { type: 'file' }]) {
      const objects = [{ ...deal, fields: { ...deal.fields, subject: { label: 'Subject', ...def } } }, account];
      expect(
        validateRlsPredicateEnforceability(stackWith({ operation: 'select', using: 'record.status != record.subject' }, objects)),
        def.type,
      ).toEqual([]);
    }
  });
});

describe('validateRlsPredicateEnforceability — the arm is the graph\'s, and reports once (#19886)', () => {
  it('names every offending comparison of one clause in ONE finding', () => {
    const findings = validateRlsPredicateEnforceability(
      stackWith({ operation: 'select', using: 'record.status != record.tags || record.reviewers == record.tags' }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain(
      "object: `record.status != record.tags`, where `tags` is declared `type: 'json'`; " +
        "`record.reviewers == record.tags`, where `reviewers` is declared `type: 'lookup'`, `multiple: true` and " +
        "`tags` is declared `type: 'json'`. ",
    );
  });

  it('judges nothing the graph cannot answer: an object outside the stack, a field map it cannot read', () => {
    expect(validateRlsPredicateEnforceability(stackWith({ operation: 'select', using: 'record.status != record.tags' }, [account]))).toEqual([]);
    expect(
      validateRlsPredicateEnforceability(stackWith({ operation: 'select', using: 'record.status != record.tags' }, [{ name: 'deal' }])),
    ).toEqual([]);
  });

  it('an undeclared column is the unknown-field finding alone — this arm never doubles it', () => {
    const findings = validateRlsPredicateEnforceability(stackWith({ operation: 'select', using: 'record.status != record.nope' }));
    expect(findings.map((f) => f.rule)).toEqual([RLS_PREDICATE_UNKNOWN_FIELD]);
  });

  it('one defect, one finding: a read scope this arm refused is not handed to the engine judge', () => {
    const calls: unknown[] = [];
    const judgeFilter = (object: string, where: unknown, options?: EngineFilterJudgementOptions): EngineFilterJudgement => {
      calls.push({ object, where, options });
      return { ok: true };
    };
    const refused = validateRlsPredicateEnforceability(stackWith({ operation: 'select', using: 'record.status != record.tags' }), {
      judgeFilter,
    });
    expect(refused.map((f) => f.rule)).toEqual([RLS_PREDICATE_UNENFORCEABLE]);
    expect(calls).toEqual([]);

    // CONTROL: the scalar spelling reaches the judge, as every clean read scope does.
    expect(
      validateRlsPredicateEnforceability(stackWith({ operation: 'select', using: 'record.status != record.owner' }), { judgeFilter }),
    ).toEqual([]);
    expect(calls).toEqual([
      { object: 'deal', where: { status: { $ne: { $field: 'owner' } } }, options: { operation: 'find' } },
    ]);
  });

  it('reaches the author through `os validate`\'s rule table and the runtime publish gate alike', () => {
    const stack = stackWith({ operation: 'insert', check: 'record.tags != record.status' });
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
