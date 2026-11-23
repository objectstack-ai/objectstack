// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36237] The publish lint refuses `==` / `!=` between a list-valued field
 * reached through a lookup hop (`record.account.labels`) and a scalar, at the
 * two sites that serve a hop — a validation rule's hydrated `condition` /
 * `when` and a formula's `expression` — in the root case's words
 * (`validate-expressions.list-equality-36167.test.ts`). The hop loader
 * hydrates the related row, so the read is the stored list and the
 * comparison answers one constant on every row.
 *
 * Every fixture goes through `ObjectStackSchema.safeParse` first, so no case
 * pins a branch an author cannot reach.
 */

import { describe, it, expect } from 'vitest';

import { ObjectStackSchema } from '@objectstack/spec';

import { runStackExpressionPasses, validateStackExpressions } from './validate-expressions.js';

const MANIFEST = { id: 'com.example.hop-list-equality', name: 'hop_list_equality_probe', version: '1.0.0', type: 'app' } as const;

function specValid(stack: Record<string, unknown>): Record<string, unknown> {
  const result = ObjectStackSchema.safeParse({ manifest: MANIFEST, ...stack });
  if (!result.success) {
    throw new Error(
      'fixture is not spec-valid: ' +
        result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    );
  }
  return result.data as unknown as Record<string, unknown>;
}

const OPTIONS = [
  { label: 'VIP', value: 'vip' },
  { label: 'EU', value: 'eu' },
];

const account = {
  name: 'hop_account',
  label: 'Account',
  fields: {
    name: { type: 'text', label: 'Name' },
    tier: { type: 'select', label: 'Tier', options: OPTIONS },
    labels: { type: 'multiselect', label: 'Labels', options: OPTIONS },
    owners: { type: 'user', label: 'Owners', multiple: true },
    owner: { type: 'user', label: 'Owner' },
  },
};

function contactWith(extra: { validations?: unknown[]; fields?: Record<string, unknown> }) {
  return {
    name: 'hop_contact',
    label: 'Contact',
    fields: {
      name: { type: 'text', label: 'Name' },
      account: { type: 'lookup', label: 'Account', reference: 'hop_account' },
      accounts: { type: 'lookup', label: 'Accounts', reference: 'hop_account', multiple: true },
      ...extra.fields,
    },
    ...(extra.validations ? { validations: extra.validations } : {}),
  };
}

const listEqualityErrors = (stack: Record<string, unknown>) =>
  validateStackExpressions(specValid(stack)).filter((i) => i.severity === 'error' && i.message.includes('holds a list'));

/** The list-equality errors the lint reports for one validation rule `condition` on the contact. */
function ruleErrors(condition: string) {
  return listEqualityErrors({
    objects: [account, contactWith({ validations: [{ name: 'probe_rule', type: 'script', severity: 'error', message: 'm', condition }] })],
  });
}

/** Every error the lint reports for the same rule — to read a rewrite as accepted. */
function allRuleErrors(condition: string) {
  return validateStackExpressions(specValid({
    objects: [account, contactWith({ validations: [{ name: 'probe_rule', type: 'script', severity: 'error', message: 'm', condition }] })],
  })).filter((i) => i.severity === 'error');
}

describe('publish lint — list-equality through a lookup hop', () => {
  it.each([
    // An inherently multi-value type on the target.
    ["record.account.labels == 'vip'", 'record.account.labels', '(has(record.account.labels) && record.account.labels != null && "vip" in record.account.labels)'],
    // One hop to a field declared `multiple: true` — a type alone does not mark it a list.
    ["record.account.owners != 'u1'", 'record.account.owners', '(!has(record.account.owners) || record.account.owners == null || !("u1" in record.account.owners))'],
  ])('refuses the validation rule %s, naming the hop read and the `in` rewrite', (condition, reference, rewrite) => {
    const errors = ruleErrors(condition);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.where).toContain("validation 'probe_rule'");
    expect(errors[0]!.path).toBe('objects[1].validations[0].condition');
    expect(errors[0]!.message).toContain(`\`${reference}\` holds a list`);
    expect(errors[0]!.message).toContain(`write \`${rewrite}\``);
    // The prescribed text is itself accepted where it was prescribed.
    expect(allRuleErrors(rewrite)).toEqual([]);
  });

  it.each([
    // One hop to a scalar field.
    "record.account.tier == 'vip'",
    "record.account.owner == 'u1'",
    "record.account.labels == null",
    "'vip' in record.account.labels",
  ])('CONTROL — accepts the validation rule %s', (condition) => {
    expect(allRuleErrors(condition)).toEqual([]);
  });

  it('refuses a conditional rule\'s `when` and a formula `expression` too', () => {
    const errors = listEqualityErrors({
      objects: [
        account,
        contactWith({
          fields: { is_vip: { type: 'formula', label: 'Is VIP', expression: "record.account.labels == 'vip'" } },
          validations: [
            {
              name: 'guarded',
              type: 'conditional',
              severity: 'error',
              message: 'm',
              when: "record.account.owners == 'u1'",
              then: { name: 'inner', type: 'script', severity: 'error', message: 'm', condition: "record.name == ''" },
            },
          ],
        }),
      ],
    });
    expect(errors.map((e) => e.source).sort()).toEqual(["record.account.labels == 'vip'", "record.account.owners == 'u1'"]);
  });

  it('the object save door (`runtimeWriteType: object`) refuses the same hop, rule and formula', () => {
    const stack = specValid({
      objects: [
        account,
        contactWith({
          fields: { is_vip: { type: 'formula', label: 'Is VIP', expression: "record.account.labels == 'vip'" } },
          validations: [{ name: 'probe_rule', type: 'script', severity: 'error', message: 'm', condition: "record.account.owners != 'u1'" }],
        }),
      ],
    });
    const errors = runStackExpressionPasses(stack, { runtimeWriteType: 'object' })
      .filter((i) => i.severity === 'error' && i.message.includes('holds a list'));
    expect(errors.map((e) => e.source).sort()).toEqual(["record.account.labels == 'vip'", "record.account.owners != 'u1'"]);
  });

  // A reference that is itself multi-valued holds a list of ids: its hop is
  // not this check's shape, and the target's leaf is not judged through it.
  it('CONTROL — a multi-valued reference is not judged', () => {
    expect(ruleErrors("record.accounts.labels == 'vip'")).toEqual([]);
  });

  // An action's `visible` serves no hop: `record.account` is the stored id
  // there, so the list-equality prescription would not apply.
  it('CONTROL — a site that serves no hop is not judged', () => {
    expect(listEqualityErrors({
      objects: [account, contactWith({})],
      actions: [{ name: 'probe_action', label: 'Probe', objectName: 'hop_contact', type: 'script', target: 'fn', visible: "record.account.labels == 'vip'" }],
    })).toEqual([]);
  });
});
