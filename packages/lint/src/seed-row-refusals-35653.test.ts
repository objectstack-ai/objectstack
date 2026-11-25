// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The WALK of `judgeSeedRowRefusals` (#35653, folding #35486): which seed
 * (record, rule) pairs reach the injected evaluator, which are counted as not
 * judged, and the blank-key refusal. The evaluator here is a recording double
 * that refuses by the predicate it is told; the verdicts of the real one
 * (`evaluateValidationRules`, `@objectstack/objectql`, which depends on this
 * package) are pinned in `packages/cli/test/seed-row-refusals-35653.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  judgeSeedRowRefusals,
  seedRowPairsNotJudged,
  SEED_RECORD_KEY_FIELD_BLANK,
  SEED_ROW_REFUSED_BY_VALIDATION_RULE,
  type SeedRowJudgeInput,
  type SeedRuleObjectSchema,
} from './index.js';

type AnyRec = Record<string, unknown>;

interface Call {
  rule: string;
  record: AnyRec;
  fields: string[];
}

/** A double that records each call and refuses when `refuses(rule, record)` says so, as the write does. */
function evaluator(refuses: (rule: AnyRec, record: AnyRec) => boolean): {
  calls: Call[];
  evaluateValidationRules: SeedRowJudgeInput['evaluateValidationRules'];
} {
  const calls: Call[] = [];
  return {
    calls,
    evaluateValidationRules(schema: SeedRuleObjectSchema, data: AnyRec) {
      const rule = schema.validations[0] as AnyRec;
      calls.push({ rule: String(rule.name), record: data, fields: Object.keys(schema.fields) });
      if (refuses(rule, data)) {
        throw Object.assign(new Error('Validation failed'), {
          code: 'VALIDATION_FAILED',
          fields: [{ field: '_record', code: 'rule_violation', message: String(rule.message) }],
        });
      }
      return [];
    },
  };
}

const payment = {
  name: 'xt_payment',
  fields: {
    name: { type: 'text' },
    amount: { type: 'currency' },
    invoice: { type: 'lookup', reference: 'xt_invoice' },
    invoice_balance: { type: 'summary' },
    method: { type: 'select', options: [{ value: 'card', label: 'Card', default: true }, { value: 'wire', label: 'Wire' }] },
    note: { type: 'text', requiredWhen: 'record.amount > 1000' },
  },
  validations: [
    { type: 'script', name: 'amount_positive', condition: 'record.amount <= 0', message: 'A payment amount must be positive.' },
  ],
};

const stackWith = (obj: AnyRec, extra: AnyRec = {}): AnyRec => ({ objects: [obj], ...extra });

const datasetOf = (records: AnyRec[], extra: AnyRec = {}): { dataset: AnyRec; location: string } => ({
  dataset: { object: 'xt_payment', externalId: 'name', mode: 'ignore', records, ...extra },
  location: 'data[0]',
});

/**
 * The tenancy resolver the doors inject (`resolveTenantFieldName`,
 * `@objectstack/core`), as a double: a declared `tenancy.tenantField` the
 * object has, else `organization_id` when the object declares it, else none.
 * The real one is pinned against the real loader in `packages/cli`.
 */
const tenantColumnOf = (schema: unknown): string | null => {
  const s = schema as { fields?: AnyRec; tenancy?: { tenantField?: unknown } };
  const declared = s?.tenancy?.tenantField;
  if (typeof declared === 'string' && s?.fields && declared in s.fields) return declared;
  return s?.fields && 'organization_id' in s.fields ? 'organization_id' : null;
};

/** `record.amount <= 0`, as the double reads it. */
const nonPositive = (_rule: AnyRec, record: AnyRec) => typeof record.amount === 'number' && record.amount <= 0;

describe('judgeSeedRowRefusals: a record its own validation rule refuses', () => {
  it('names the dataset location, the record and the refusing rule, with the rule\'s message', () => {
    const judge = evaluator(nonPositive);
    const out = judgeSeedRowRefusals({
      datasets: [datasetOf([{ name: 'P1', amount: 50 }, { name: 'P2', amount: -5 }])],
      stack: stackWith(payment),
      evaluateValidationRules: judge.evaluateValidationRules,
      resolveTenantFieldName: tenantColumnOf,
    });
    expect(out.refusals).toEqual([{
      rule: SEED_ROW_REFUSED_BY_VALIDATION_RULE,
      location: 'data[0].records[1]',
      object: 'xt_payment',
      recordIndex: 1,
      validationRule: 'amount_positive',
      message: "Seed record #1 of 'xt_payment' is refused by its validation rule 'amount_positive': A payment amount must be positive.",
    }]);
    // The passing record was judged too, and admitted.
    expect(judge.calls.map((c) => c.record.name)).toEqual(['P1', 'P2']);
    expect(seedRowPairsNotJudged(out)).toBe(0);
  });

  it('hands the evaluator one rule and the declared fields without their field-level predicates', () => {
    const judge = evaluator(() => false);
    judgeSeedRowRefusals({
      datasets: [datasetOf([{ name: 'P1', amount: 50 }])],
      stack: stackWith(payment),
      evaluateValidationRules: judge.evaluateValidationRules,
      resolveTenantFieldName: tenantColumnOf,
    });
    expect(judge.calls).toHaveLength(1);
    expect(judge.calls[0].fields.sort()).toEqual(Object.keys(payment.fields).sort());
    let handed: SeedRuleObjectSchema | undefined;
    judgeSeedRowRefusals({
      datasets: [datasetOf([{ name: 'P1', amount: 50 }])],
      stack: stackWith(payment),
      evaluateValidationRules: (schema) => { handed = schema; return []; },
      resolveTenantFieldName: tenantColumnOf,
    });
    expect(handed!.validations).toHaveLength(1);
    expect(handed!.fields.note).toEqual({ type: 'text' });
    expect(payment.fields.note.requiredWhen).toBe('record.amount > 1000');
  });

  it('a throw that is not the write\'s VALIDATION_FAILED propagates: a broken judge is not a verdict', () => {
    expect(() => judgeSeedRowRefusals({
      datasets: [datasetOf([{ name: 'P1', amount: 50 }])],
      stack: stackWith(payment),
      evaluateValidationRules: () => { throw new TypeError('boom'); },
      resolveTenantFieldName: tenantColumnOf,
    })).toThrow(TypeError);
  });
});

describe('judgeSeedRowRefusals: a pair the record\'s own values cannot decide is counted, never refused', () => {
  const rule = (name: string, condition: string) => ({ type: 'script', name, condition, message: `${name} refused` });
  const everything = () => true;

  const cases: Array<[string, AnyRec, AnyRec, 'rule-reads' | 'field-value']> = [
    ['a roll-up (summary) field', rule('over_balance', 'record.amount > record.invoice_balance'), { name: 'P', amount: 5, invoice_balance: 1 }, 'field-value'],
    ['a reference resolved from its natural key', rule('needs_invoice', 'record.invoice == "INV-1"'), { name: 'P', invoice: 'INV-1' }, 'field-value'],
    ['an absent field the load fills from an option default', rule('card_only', 'record.method != "wire"'), { name: 'P' }, 'field-value'],
    ['a platform-injected column', rule('owned', 'record.owner_id == null'), { name: 'P' }, 'field-value'],
    ['an expression envelope', rule('amount_positive', 'record.amount <= 0'), { name: 'P', amount: { dialect: 'cel', source: '0 - 1' } }, 'field-value'],
    ['a numeric string the load normalizes', rule('amount_positive', 'record.amount <= 0'), { name: 'P', amount: '-1' }, 'field-value'],
    ['an empty string the load stores as null', rule('named', 'record.note == ""'), { name: 'P', note: '' }, 'field-value'],
    ['a hop through a reference', rule('hop', 'record.invoice.status == "void"'), { name: 'P' }, 'rule-reads'],
    ['the previous root', rule('prev', 'previous != null && record.amount < 0'), { name: 'P', amount: 1 }, 'rule-reads'],
    ['a source that does not parse', rule('broken', 'record.amount <<<'), { name: 'P', amount: 1 }, 'rule-reads'],
  ];

  for (const [what, r, record, reason] of cases) {
    it(`${what}: not handed to the evaluator, counted under '${reason}'`, () => {
      const judge = evaluator(everything);
      const out = judgeSeedRowRefusals({
        datasets: [datasetOf([record])],
        stack: stackWith({ ...payment, validations: [r] }),
        evaluateValidationRules: judge.evaluateValidationRules,
        resolveTenantFieldName: tenantColumnOf,
      });
      expect(out.refusals).toEqual([]);
      expect(judge.calls).toEqual([]);
      expect(out.notJudged[reason]).toBe(1);
    });
  }

  it('an update-mode dataset and a beforeInsert hook leave every pair to the load', () => {
    const judge = evaluator(everything);
    const update = judgeSeedRowRefusals({
      datasets: [datasetOf([{ name: 'P', amount: -1 }], { mode: 'update' })],
      stack: stackWith(payment),
      evaluateValidationRules: judge.evaluateValidationRules,
      resolveTenantFieldName: tenantColumnOf,
    });
    const hooked = judgeSeedRowRefusals({
      datasets: [datasetOf([{ name: 'P', amount: -1 }])],
      stack: stackWith(payment, { hooks: [{ name: 'derive', object: ['xt_payment'], events: ['beforeInsert'] }] }),
      evaluateValidationRules: judge.evaluateValidationRules,
      resolveTenantFieldName: tenantColumnOf,
    });
    expect([update.refusals, hooked.refusals]).toEqual([[], []]);
    expect([update.notJudged['update-mode'], hooked.notJudged.hook]).toEqual([1, 1]);
    expect(judge.calls).toEqual([]);
  });

  it('skips, without a count, what the load skips: state_machine, inactive, advisory and update-only rules', () => {
    const judge = evaluator(everything);
    const out = judgeSeedRowRefusals({
      datasets: [datasetOf([{ name: 'P', amount: -1 }])],
      stack: stackWith({
        ...payment,
        validations: [
          { type: 'state_machine', name: 'fsm', field: 'method', transitions: { card: ['wire'] }, message: 'm' },
          { ...payment.validations[0], name: 'off', active: false },
          { ...payment.validations[0], name: 'advisory', severity: 'warning' },
          { ...payment.validations[0], name: 'on_update', events: ['update'] },
        ],
      }),
      evaluateValidationRules: judge.evaluateValidationRules,
      resolveTenantFieldName: tenantColumnOf,
    });
    expect(out.refusals).toEqual([]);
    expect(judge.calls).toEqual([]);
    expect(seedRowPairsNotJudged(out)).toBe(0);
  });
});

describe('judgeSeedRowRefusals: a keyed record with a blank key field (#35486)', () => {
  it('names the object, the record index and the field, in the loader\'s sentence, and judges no rule on it', () => {
    const judge = evaluator(nonPositive);
    const out = judgeSeedRowRefusals({
      datasets: [datasetOf([{ name: 'P1', amount: 5 }, { name: '', amount: -5 }], { mode: 'upsert' })],
      stack: stackWith(payment),
      evaluateValidationRules: judge.evaluateValidationRules,
      resolveTenantFieldName: tenantColumnOf,
    });
    expect(out.refusals).toEqual([{
      rule: SEED_RECORD_KEY_FIELD_BLANK,
      location: 'data[0].records[1]',
      object: 'xt_payment',
      recordIndex: 1,
      field: 'name',
      message:
        "Seed record #1 of 'xt_payment' was NOT loaded: it is keyed on externalId 'name' (also the key a dataset gets " +
        "when it names none) and leaves 'name' blank (no value, null or an empty string), so no load can ever match it " +
        "to a row it wrote: written, it would be inserted again on every load. Give the record a value for 'name', or " +
        'key the dataset on fields every record carries: a field the object declares, a list of fields when no single ' +
        "field names a row, or 'id' when the records carry their own ids.",
    }]);
    expect(judge.calls.map((c) => c.record.name)).toEqual(['P1']);
  });

  it('every blank component of a composite key, on an object the stack does not declare too', () => {
    const out = judgeSeedRowRefusals({
      datasets: [{ dataset: { object: 'xt_member', externalId: ['team', 'person'], mode: 'update', records: [{ team: 'a', person: 'b' }, { team: null }] }, location: 'packages[0].manifest.data[3]' }],
      stack: {},
      evaluateValidationRules: () => [],
      resolveTenantFieldName: tenantColumnOf,
    });
    expect(out.refusals.map(({ location, field, message }) => ({ location, field, update: message.includes('so an update load can never find the row it names') })))
      .toEqual([{ location: 'packages[0].manifest.data[3].records[1]', field: 'team, person', update: true }]);
  });

  it('a key field holding an expression, and the organization column, are left to the load', () => {
    const out = judgeSeedRowRefusals({
      datasets: [{ dataset: { object: 'xt_member', externalId: ['code', 'organization_id'], records: [{ code: { dialect: 'cel', source: '"A"' } }] }, location: 'data[0]' }],
      stack: {},
      evaluateValidationRules: () => [],
      resolveTenantFieldName: tenantColumnOf,
    });
    expect(out.refusals).toEqual([]);
  });

  it('the organization column is the object\'s own: a declared tenancy.tenantField is left to the load, organization_id is then a key like any other', () => {
    const walled = {
      name: 'xt_member',
      tenancy: { tenantField: 'workspace_id' },
      fields: { code: { type: 'text' }, workspace_id: { type: 'text' }, organization_id: { type: 'text' } },
    };
    const out = judgeSeedRowRefusals({
      datasets: [
        { dataset: { object: 'xt_member', externalId: ['workspace_id', 'code'], records: [{ code: 'A' }] }, location: 'data[0]' },
        { dataset: { object: 'xt_member', externalId: ['organization_id', 'code'], records: [{ code: 'B' }] }, location: 'data[1]' },
      ],
      stack: stackWith(walled),
      evaluateValidationRules: () => [],
      resolveTenantFieldName: tenantColumnOf,
    });
    expect(out.refusals.map(({ location, field }) => ({ location, field })))
      .toEqual([{ location: 'data[1].records[0]', field: 'organization_id' }]);
  });
});
