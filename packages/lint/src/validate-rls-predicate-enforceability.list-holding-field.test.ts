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
  validateRlsPredicateEnforceability as validateRlsPredicateEnforceabilityUnrecorded,
  RLS_PREDICATE_UNENFORCEABLE,
  RLS_PREDICATE_UNKNOWN_FIELD,
} from './validate-rls-predicate-enforceability.js';
import { runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import { explainRule } from './rule-explanations.js';

// [#22161] Each finding is one verdict sentence; the reasoning it used to
// carry is the id's `os explain` entry. Every call below records what it
// fired, and the last case in this file holds each recorded verdict to one
// line of at most 200 characters. Run the whole file: that case reads what the
// cases above fired.
const fired: Array<{ rule: string; message: string }> = [];
const validateRlsPredicateEnforceability: typeof validateRlsPredicateEnforceabilityUnrecorded = (...args) => {
  const findings = validateRlsPredicateEnforceabilityUnrecorded(...args);
  fired.push(...findings);
  return findings;
};

/** The `os explain` text of `rule`, one string. */
const explanationOf = (rule: string): string => explainRule(rule)?.paragraphs.join('\n') ?? '';

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
  { column: 'a json field', field: 'tags' },
  { column: 'a multiple lookup', field: 'reviewers' },
] as const;

/** What the refusal costs, per clause — the verdict's closing clause. */
const REFUSED = {
  using: 'so the SQL drivers refuse every read it scopes (INVALID_FILTER / 400)',
  check: 'so the write check refuses the writes it judges (INVALID_FILTER / 400)',
} as const;

describe('validateRlsPredicateEnforceability — a field compared with a json / multiple field is REFUSED (#19886)', () => {
  for (const { clause, operation } of CLAUSES) {
    for (const { op, spell, quoted } of OPERATORS) {
      for (const { column, field } of COLUMNS) {
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
            expect(finding.message).toBe(
              `RLS ${clause} compares \`record.${left} ${quoted} record.${right}\`, where \`${field}\` holds a list ` +
                `or an object, ${REFUSED[clause]}`,
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

  it('states the consequence of its own clause — the read for `using`, the write for `check`', () => {
    const using = validateRlsPredicateEnforceability(stackWith({ operation: 'select', using: 'record.status != record.tags' }))[0];
    expect(using.message.endsWith(REFUSED.using)).toBe(true);

    const check = validateRlsPredicateEnforceability(stackWith({ operation: 'insert', check: 'record.status != record.tags' }))[0];
    expect(check.message.endsWith(REFUSED.check)).toBe(true);
    expect(check.message).not.toContain('every read it scopes');
  });

  it('`os explain` carries the class and both clauses\' measured consequence the verdict no longer states', () => {
    const text = explanationOf(RLS_PREDICATE_UNENFORCEABLE);
    expect(text).toContain(
      'is not one comparable value, on either side of a field-to-field comparison, so the platform refuses the ' +
        'comparison instead of evaluating it',
    );
    expect(text).toContain('every by-id update or delete it scopes fails closed (`PERMISSION_DENIED` / 403)');
    expect(text).toContain('where the `using` is the write check');
    expect(text).toContain(
      'against a list-holding column every single-record insert and by-id update whose record holds a list or an ' +
        'object there',
    );
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
  for (const [label, def] of LIST_HOLDING) {
    it(`${label}: refused, naming the column`, () => {
      const objects = [{ ...deal, fields: { ...deal.fields, subject: { label: 'Subject', ...def } } }, account];
      const findings = validateRlsPredicateEnforceability(
        stackWith({ operation: 'select', using: 'record.status != record.subject' }, objects),
      );
      expect(findings.map((f) => f.rule)).toEqual([RLS_PREDICATE_UNENFORCEABLE]);
      expect(findings[0].message).toContain('`record.status != record.subject`, where `subject` holds a list or an object,');
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

  it('a single-valued field of a multi-capable type is one value: `select`, `lookup`, `user`', () => {
    for (const def of [{ type: 'select' }, { type: 'lookup', reference: 'account' }, { type: 'user' }]) {
      const objects = [{ ...deal, fields: { ...deal.fields, subject: { label: 'Subject', ...def } } }, account];
      expect(
        validateRlsPredicateEnforceability(stackWith({ operation: 'select', using: 'record.status != record.subject' }, objects)),
        def.type,
      ).toEqual([]);
    }
  });

  it('a single-valued `file` field is one value too — not this arm\'s; the comparison-class arm refuses it (#20347)', () => {
    // It holds no list, so this arm stays silent; but the file family has no
    // comparison class at all, so the #20347 arm refuses the comparison, once.
    const objects = [{ ...deal, fields: { ...deal.fields, subject: { label: 'Subject', type: 'file' } } }, account];
    const findings = validateRlsPredicateEnforceability(
      stackWith({ operation: 'select', using: 'record.status != record.subject' }, objects),
    );
    expect(findings.map((f) => f.rule)).toEqual([RLS_PREDICATE_UNENFORCEABLE]);
    expect(findings[0].message).not.toContain('holds a list or an object');
    expect(findings[0].message).toContain('which no comparison class spans (text vs a file field)');
  });
});

describe('validateRlsPredicateEnforceability — the arm is the graph\'s, and reports once (#19886)', () => {
  it('reports every offending comparison of one clause in ONE finding: the first quoted, the rest counted', () => {
    const findings = validateRlsPredicateEnforceability(
      stackWith({ operation: 'select', using: 'record.status != record.tags || record.reviewers == record.tags' }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain(
      'compares `record.status != record.tags`, where `tags` holds a list or an object (and 1 more), ',
    );
    // Both columns of one comparison are named when both hold a list.
    const both = validateRlsPredicateEnforceability(stackWith({ operation: 'select', using: 'record.reviewers == record.tags' }));
    expect(both[0].message).toContain('where `reviewers` and `tags` hold a list or an object, ');
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

describe('[#22161] one-line verdicts', () => {
  it('every verdict the cases above fired is one line of at most 200 characters', () => {
    // The coverage control first: the cases above fired the list-holding and
    // the cross-class verdicts, so the shape assertion cannot pass over an
    // empty record.
    expect(fired.some((f) => f.message.includes('holds a list or an object'))).toBe(true);
    expect(fired.some((f) => f.message.includes('which no comparison class spans'))).toBe(true);
    for (const f of fired) {
      expect(f.message, f.rule).not.toContain('\n');
      expect(f.message.length, `${f.rule}: ${f.message}`).toBeLessThanOrEqual(200);
    }
  });
});
