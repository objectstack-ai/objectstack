// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36167] The publish lint hands the shared validator the object's
 * list-valued fields (`ExprSchemaHint.multiValueFields`, read through
 * `isMultiValueField`), so `==` / `!=` between such a field and a scalar is
 * refused at every CEL site that types the object's fields — an action's
 * `visible`, a validation rule, a formula — including a `user` field declared
 * `multiple: true`, which its type alone does not mark as a list.
 *
 * Every fixture goes through `ObjectStackSchema.safeParse` first, so no case
 * pins a branch an author cannot reach.
 */

import { describe, it, expect } from 'vitest';

import { ObjectStackSchema } from '@objectstack/spec';

import { validateStackExpressions } from './validate-expressions.js';

const MANIFEST = { id: 'com.example.list-equality', name: 'list_equality_probe', version: '1.0.0', type: 'app' } as const;

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
  { label: 'Frontend', value: 'frontend' },
  { label: 'QA', value: 'qa' },
];

const ticket = {
  name: 'ticket_probe',
  label: 'Ticket probe',
  fields: {
    name: { type: 'text', label: 'Name' },
    labels: { type: 'multiselect', label: 'Labels', options: OPTIONS },
    stage: { type: 'select', label: 'Stage', options: OPTIONS },
    watchers: { type: 'user', label: 'Watchers', multiple: true },
    owner: { type: 'user', label: 'Owner' },
  },
};

/** The errors the lint reports for one action `visible` predicate on the probe object. */
function visibleErrors(visible: string) {
  return validateStackExpressions(
    specValid({
      objects: [ticket],
      actions: [{ name: 'probe_action', label: 'Probe', objectName: 'ticket_probe', type: 'script', target: 'fn', visible }],
    }),
  ).filter((i) => i.severity === 'error');
}

describe('publish lint — list-equality at a CEL site', () => {
  it.each([
    ["record.labels == 'frontend'", 'record.labels', 'record.labels != null && "frontend" in record.labels'],
    ["record.labels != 'frontend'", 'record.labels', 'record.labels == null || !("frontend" in record.labels)'],
    ["'u1' == record.watchers", 'record.watchers', 'record.watchers != null && "u1" in record.watchers'],
  ])('refuses %s, naming the field and the `in` rewrite', (source, reference, rewrite) => {
    const errors = visibleErrors(source);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain(`\`${reference}\` holds a list`);
    expect(errors[0].message).toContain(rewrite);
  });

  it.each([
    'record.labels == null',
    'record.watchers != null',
    "'frontend' in record.labels",
    "record.stage == 'frontend'",
    "record.owner == 'u1'",
    "record.name != 'x'",
  ])('accepts %s', (source) => {
    expect(visibleErrors(source)).toEqual([]);
  });

  it('refuses at a validation rule and in a formula too', () => {
    const issues = validateStackExpressions(
      specValid({
        objects: [
          {
            ...ticket,
            fields: {
              ...ticket.fields,
              is_frontend: { type: 'formula', label: 'Is frontend', expression: "record.labels == 'frontend'" },
            },
            validations: [
              {
                name: 'watcher_rule',
                type: 'script',
                severity: 'error',
                message: 'm',
                condition: "record.watchers != 'u1'",
              },
            ],
          },
        ],
      }),
    ).filter((i) => i.severity === 'error' && i.message.includes('holds a list'));
    expect(issues.map((i) => i.source).sort()).toEqual(["record.labels == 'frontend'", "record.watchers != 'u1'"]);
  });
});
