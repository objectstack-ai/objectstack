// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24468] A validation rule's `condition` reads ONE hop through a reference
 * field, and the validation-rule pass judges the hop's COLUMN against the
 * target's field index, as the field-formula pass does for a formula (#24410).
 *
 * ObjectQL's predicate read loads only the columns the target declares; a rule
 * naming one it does not declare has no verdict and refuses every write it
 * judges. So the build, `os validate` and the object save door refuse it,
 * naming the field and the target, under the existing `expression-invalid`
 * rule. The runtime half is `packages/objectql/src/engine-predicate-relationship.test.ts`.
 * Every fixture goes through `specValid`.
 */
import { describe, expect, it } from 'vitest';
import { ObjectStackSchema } from '@objectstack/spec';

import { validateStackExpressions } from './validate-expressions.js';

const MANIFEST = { id: 'com.example.rule-hop', name: 'rule_hop', version: '1.0.0', type: 'app' } as const;

/** A fixture is only a fixture if the spec accepts it. */
function specValid(stack: Record<string, unknown>): Record<string, unknown> {
  const result = ObjectStackSchema.safeParse({ manifest: MANIFEST, ...stack });
  if (!result.success) {
    throw new Error(
      'fixture is not spec-valid: '
        + result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    );
  }
  return result.data as unknown as Record<string, unknown>;
}

const account = { name: 'hop_account', label: 'Account', fields: { status: { type: 'text', label: 'Status' } } };
const order = (condition: string, reference = 'hop_account') => ({
  name: 'hop_order',
  label: 'Order',
  fields: {
    amount: { type: 'number', label: 'Amount' },
    account: { type: 'lookup', label: 'Account', reference },
  },
  validations: [{ name: 'r', type: 'script', severity: 'error', message: 'x', condition }],
});

const WHERE = "object 'hop_order' · validation 'r'";

const errorsOf = (condition: string, reference?: string) =>
  validateStackExpressions(specValid({ objects: [account, order(condition, reference)] }))
    .filter((i) => i.where === WHERE && (i.severity ?? 'error') === 'error');

describe('[#24468] a validation rule reads one hop through a reference', () => {
  it('admits a read of a field the target declares', () => {
    expect(errorsOf("record.account.status == 'closed'")).toEqual([]);
  });

  it('refuses a read of a field the target does not declare, naming the field and the target', () => {
    const errors = errorsOf("record.account.region == 'north' && record.account.status == 'open'");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/^unknown field `region` on `hop_account`/);
    expect(errors[0].message).toContain('through the reference `record.account`');
    expect(errors[0].message).toContain("declare 'region' on 'hop_account' — not on 'hop_order', the object carrying this rule");
    expect(errors[0].source).toBe("record.account.region == 'north' && record.account.status == 'open'");
  });

  it('admits the primary key and a column the platform injects on the target', () => {
    expect(errorsOf("record.account.id != ''")).toEqual([]);
    expect(errorsOf('record.account.created_at != null')).toEqual([]);
  });

  it('does not judge a target the stack does not carry', () => {
    expect(errorsOf("record.account.region == 'north'", 'hop_elsewhere')).toEqual([]);
  });
});

/**
 * [#24512] A `conditional` rule's `when` is hydrated one hop by ObjectQL's
 * `checkConditional`, as a `condition` is by `checkPredicate`, so the same hop
 * checks judge it — at the top level and in a nested `conditional` — under the
 * same `expression-invalid` rule.
 */
describe('[#24512] a `conditional` rule\'s `when` reads one hop through a reference', () => {
  const WHEN_WHERE = "object 'hop_order' · validation 'gate' when";
  const NESTED_WHERE = "object 'hop_order' · validation rule 'outer' then → 'gate' when-predicate";
  const gate = (when: string) => ({
    name: 'gate', type: 'conditional', severity: 'error', message: 'x', when,
    then: { name: 'cap', type: 'script', severity: 'error', message: 'y', condition: 'record.amount != null && record.amount > 100' },
  });
  const withRule = (rule: Record<string, unknown>) => ({ ...order('true'), validations: [rule] });
  const errorsAt = (rule: Record<string, unknown>) =>
    validateStackExpressions(specValid({ objects: [account, withRule(rule)] }))
      .filter((i) => (i.severity ?? 'error') === 'error');
  const outer = (when: string) => ({
    name: 'outer', type: 'conditional', severity: 'error', message: 'x', when: 'record.amount != null', then: gate(when),
  });

  it('admits a `when` reading a field the target declares, top level and nested', () => {
    expect(errorsAt(gate("record.account.status == 'active'"))).toEqual([]);
    expect(errorsAt(outer("record.account.status == 'active'"))).toEqual([]);
  });

  it('refuses a `when` reading a field the target does not declare, naming the slot, the field and the target', () => {
    for (const [rule, where] of [[gate("record.account.region == 'north'"), WHEN_WHERE], [outer("record.account.region == 'north'"), NESTED_WHERE]] as const) {
      const errors = errorsAt(rule);
      expect(errors.map((e) => e.where)).toEqual([where]);
      expect(errors[0].message).toMatch(/^unknown field `region` on `hop_account`/);
      expect(errors[0].message).toContain('through the reference `record.account`');
    }
  });

  it('refuses a `when` reading a second hop, naming the slot', () => {
    for (const [rule, where] of [[gate("record.account.owner.email == 'x'"), WHEN_WHERE], [outer("record.account.owner.email == 'x'"), NESTED_WHERE]] as const) {
      const errors = errorsAt(rule);
      expect(errors.map((e) => e.where)).toEqual([where]);
      expect(errors[0].message).toContain('read through more than one relationship hop');
    }
  });

  it('refuses a `when` reading the reference both through it and as a value, naming the guard', () => {
    const errors = errorsAt(gate("record.account != null && record.account.status == 'active'"));
    expect(errors.map((e) => e.where)).toEqual([WHEN_WHERE]);
    expect(errors[0].message).toContain('is read BOTH through the relationship');
    expect(errors[0].message).toContain('`conditional` rule whose `when` is `record.account != null`');
  });

  it('CONTROL — the guard spelling reads the stored id and is admitted', () => {
    expect(errorsAt(gate('record.account != null'))).toEqual([]);
  });
});
