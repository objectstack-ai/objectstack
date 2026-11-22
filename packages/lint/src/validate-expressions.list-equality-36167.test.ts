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
import {
  validateSharingRuleEnforceability,
  SHARING_RULE_UNLOWERABLE_CONDITION,
} from './validate-sharing-rule-enforceability.js';

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
    ["record.labels == 'frontend'", 'record.labels', '(has(record.labels) && record.labels != null && "frontend" in record.labels)'],
    ["record.labels != 'frontend'", 'record.labels', '(!has(record.labels) || record.labels == null || !("frontend" in record.labels))'],
    ["'u1' == record.watchers", 'record.watchers', '(has(record.watchers) && record.watchers != null && "u1" in record.watchers)'],
  ])('refuses %s, naming the field and the `in` rewrite', (source, reference, rewrite) => {
    const errors = visibleErrors(source);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain(`\`${reference}\` holds a list`);
    expect(errors[0].message).toContain(`write \`${rewrite}\``);
    // The prescribed text is itself accepted where it was prescribed.
    expect(visibleErrors(rewrite)).toEqual([]);
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
              is_frontend: { type: 'formula', label: 'Is frontend', expression: "record.watchers == 'u1'" },
            },
            validations: [
              {
                name: 'watcher_rule',
                type: 'script',
                severity: 'error',
                message: 'm',
                condition: "record.labels != 'frontend'",
              },
            ],
          },
        ],
      }),
    ).filter((i) => i.severity === 'error' && i.message.includes('holds a list'));
    expect(issues.map((i) => i.source).sort()).toEqual(["record.labels != 'frontend'", "record.watchers == 'u1'"]);
  });

  // A record-triggered flow's condition reads the trigger record flattened:
  // a bare `labels` is `record.labels`, as the type pass reads it.
  function flowErrors(
    condition: string,
    variables?: Array<Record<string, unknown>>,
    entrance: { type: string; triggerType?: string } = { type: 'autolaunched', triggerType: 'record-after-update' },
  ) {
    return validateStackExpressions(
      specValid({
        objects: [ticket],
        flows: [
          {
            name: 'ticket_flow',
            label: 'Ticket flow',
            type: entrance.type,
            ...(variables ? { variables } : {}),
            nodes: [
              {
                id: 'start',
                type: 'start',
                label: 'Start',
                config: {
                  objectName: 'ticket_probe',
                  ...(entrance.triggerType ? { triggerType: entrance.triggerType } : {}),
                  condition,
                },
              },
              { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'end' }],
          },
        ],
      }),
    ).filter((i) => i.severity === 'error' && i.message.includes('holds a list'));
  }

  it.each([
    ["labels == 'frontend'", 'labels'],
    ["'u1' != watchers", 'watchers'],
    ["record.labels == 'frontend'", 'record.labels'],
  ])('refuses the flow start condition %s, naming %s', (condition, reference) => {
    const errors = flowErrors(condition);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain(`\`${reference}\` holds a list`);
    expect(errors[0].message).toContain(` in ${reference}`);
  });

  it.each([
    "stage == 'frontend'", "owner == 'u1'", "'frontend' in labels", 'watchers != null',
    // A comprehension variable named like a list field holds one item: per row.
    "record.labels.exists(watchers, watchers == 'frontend')",
    "record.labels.all(labels, labels != 'qa')",
  ])(
    'CONTROL — accepts the flow start condition %s',
    (condition) => {
      expect(flowErrors(condition)).toEqual([]);
    },
  );

  it('the prescribed bare-name rewrite is parenthesised whole and accepted at the flow condition', () => {
    const [refusal] = flowErrors("stage == 'qa' && labels != 'frontend'");
    expect(refusal.message).toContain('write `(labels == null || !("frontend" in labels))`');
    expect(flowErrors("stage == 'qa' && (labels == null || !(\"frontend\" in labels))")).toEqual([]);
  });

  // A flow no record write fires runs on what its entrance handed it (an API
  // body, nothing): `labels` there is not proven to be the list field, and
  // `labels == 'frontend'` can be correct code. No verdict.
  it.each([
    ['an API flow', { type: 'api' }],
    ['a trigger-less autolaunched flow', { type: 'autolaunched' }],
    ['a scheduled flow', { type: 'schedule' }],
  ])('CONTROL — %s: no list-equality, bare or record.', (_label, entrance) => {
    expect(flowErrors("labels == 'frontend'", undefined, entrance)).toEqual([]);
    expect(flowErrors("record.labels == 'frontend'", undefined, entrance)).toEqual([]);
  });

  it('CONTROL — a bare name a declared flow variable holds is not the field', () => {
    const variables = [{ name: 'labels', type: 'text', isInput: true, isOutput: false }];
    expect(flowErrors("labels == 'frontend'", variables)).toEqual([]);
    expect(flowErrors("record.labels == 'frontend'", variables)).toHaveLength(1);
  });
});

// A sharing rule's `condition` is compiled to a query filter, not evaluated as
// CEL: the CEL `in` rewrite does not lower there (`in` needs a field on its
// left), so the prescription is `contains`, which lowers to `$contains`.
describe('publish lint — list-equality at a sharing rule condition', () => {
  const stackWith = (condition: string) =>
    specValid({
      objects: [ticket],
      sharingRules: [
        { name: 'sr', type: 'criteria', object: 'ticket_probe', condition, sharedWith: { type: 'team', value: 't' }, accessLevel: 'read' },
      ],
    });
  /** The expression lint's findings and the enforceability pass's (which lowers the condition) together. */
  function sharingIssues(condition: string) {
    const stack = stackWith(condition);
    return [
      ...validateStackExpressions(stack).map((i) => ({ rule: 'expression', severity: i.severity, message: i.message })),
      ...validateSharingRuleEnforceability(stack).map((f) => ({ rule: f.rule, severity: 'error', message: f.message })),
    ];
  }

  it.each([
    ["record.labels == 'frontend'", '(record.labels != null && record.labels.contains("frontend"))'],
    ["record.watchers != 'u1'", '(record.watchers == null || !record.watchers.contains("u1"))'],
  ])('refuses %s, prescribing the `contains` rewrite that lowers', (condition, rewrite) => {
    const errors = sharingIssues(condition).filter((i) => i.severity === 'error' && i.message.includes('holds a list'));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain(`write \`${rewrite}\``);
    // The prescribed text draws no finding at the same site: it lowers.
    expect(sharingIssues(rewrite)).toEqual([]);
  });

  it('CONTROL — the CEL `in` rewrite the other sites get does not lower here', () => {
    const issues = sharingIssues('(has(record.labels) && record.labels != null && "frontend" in record.labels)');
    expect(issues.map((i) => i.rule)).toContain(SHARING_RULE_UNLOWERABLE_CONDITION);
    expect(sharingIssues('record.labels != null && "frontend" in record.labels').map((i) => i.rule))
      .toContain(SHARING_RULE_UNLOWERABLE_CONDITION);
  });
});
