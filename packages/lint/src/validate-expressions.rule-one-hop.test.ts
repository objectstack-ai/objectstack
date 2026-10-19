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
