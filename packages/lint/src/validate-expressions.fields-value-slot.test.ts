// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `create_record` / `update_record` `fields.*` and `assignment` values — the
 * `objectstack validate` half of the value slots (#19938 declared `fields.*`,
 * the contract half of #11182 ruling D; #19939 retired the `{…}` template
 * dialect from every value slot, its C half).
 *
 * Driven through the REGISTRY, the way `os validate` runs it: the stack is
 * normalized, parsed by `ObjectStackDefinitionSchema`, and handed to
 * `runAuthoringRules('validate', …)`. A pin on `validateStackExpressions`
 * alone would stay green through a registry adapter that dropped or re-graded
 * the finding.
 *
 * Two halves:
 *
 *  1. **The malformed envelope** — a located `error` under the rule id
 *     `expression-invalid`, led by the slot-neutral `VALUE_ENVELOPE_REFUSAL`
 *     (never "an assignment value"), the same verdict `registerFlow` throws
 *     on. A valid envelope and a literal are clean.
 *  2. **The retired template dialect** (#19939) — a `{…}` token in a value
 *     slot is a located `error` under the same rule id, led by
 *     `VALUE_SLOT_TEMPLATE_REFUSAL` and naming the token's CEL spelling — in
 *     every value slot and both legacy `assignment` shapes. It replaced the
 *     `warning` hint ruling D point 1 put there for 17.x. The two spellings
 *     CEL cannot write yet (date macros, `$User` paths) and non-value slots
 *     get nothing.
 */

import { describe, expect, it } from 'vitest';
import { ObjectStackDefinitionSchema, normalizeStackInput } from '@objectstack/spec';
import {
  ASSIGNMENT_VALUE_ENVELOPE_REFUSAL,
  VALUE_ENVELOPE_REFUSAL,
  VALUE_SLOT_TEMPLATE_REFUSAL,
} from '@objectstack/spec/automation';
import { EVALUATED_EXPRESSION_SOURCE_REQUIRED } from '@objectstack/spec';
import { runAuthoringRules, splitBySeverity, EXPRESSION_INVALID } from './authoring-rules.js';

type NodeType = 'create_record' | 'update_record' | 'assignment';

/** One flow, one writing node — `config` is the node's whole config. */
function stackWith(nodeType: NodeType, config: Record<string, unknown>) {
  return {
    objects: [{
      name: 'quote',
      label: 'Quote',
      fields: { total: { type: 'number', label: 'Total' }, subject: { type: 'text', label: 'Subject' } },
    }],
    flows: [{
      name: 'price_quote',
      label: 'Price Quote',
      type: 'autolaunched',
      variables: [{ name: 'price', type: 'number', isInput: true }],
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'w', type: nodeType, label: 'Write', config },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'w' },
        { id: 'e2', source: 'w', target: 'end' },
      ],
    }],
  };
}

/** `os validate`'s own sequence, minus the file loader. */
function validate(nodeType: NodeType, config: Record<string, unknown>) {
  const normalized = normalizeStackInput(stackWith(nodeType, config) as Record<string, unknown>);
  const parsed = ObjectStackDefinitionSchema.parse(normalized);
  const findings = runAuthoringRules('validate', {
    normalized: normalized as Record<string, unknown>,
    parsed: parsed as Record<string, unknown>,
  });
  // Only what this node's value slots produce — the rest of the stack is scaffolding.
  return findings.filter((f) => f.rule === EXPRESSION_INVALID && f.where.includes("node 'w'"));
}

const crud = (nodeType: 'create_record' | 'update_record', fields: Record<string, unknown>) =>
  nodeType === 'create_record'
    ? { objectName: 'quote', fields }
    : { objectName: 'quote', filter: { id: '{quoteId}' }, fields };

const NODE_TYPES = ['create_record', 'update_record'] as const;

describe('`fields.*` value slot — the malformed envelope is a located error at `os validate` (#19938)', () => {
  it.each(NODE_TYPES.flatMap((t) => [
    [t, 'no `source`', { dialect: 'cel' }, EVALUATED_EXPRESSION_SOURCE_REQUIRED],
    [t, 'a whitespace-only `source`', { dialect: 'cel', source: '   ' }, EVALUATED_EXPRESSION_SOURCE_REQUIRED],
    [t, 'a `template` dialect', { dialect: 'template', source: 'Hi {name}' }, 'only the `cel` dialect'],
    [t, 'CEL that does not parse', { dialect: 'cel', source: 'price *' }, ''],
    [t, 'an unknown function', { dialect: 'cel', source: 'nosuchfn(price)' }, ''],
  ] as const))('%s: %s — rule `expression-invalid`, severity `error`, at `config.fields.total`', (nodeType, _what, envelope, detail) => {
    const findings = validate(nodeType, crud(nodeType, { subject: 'Quote', total: envelope }));
    expect(findings).toHaveLength(1);
    const [f] = findings;
    // The envelope a gate reads: the rule id and the severity.
    expect(f!.rule).toBe(EXPRESSION_INVALID);
    expect(f!.severity).toBe('error');
    expect(f!.where).toContain(`node 'w' (${nodeType}) ${nodeType} field value at config.fields.total`);
    // The rule before the detail — the slot-neutral published sentence, and a
    // FIELD value is never told it is an assignment.
    expect(f!.message.startsWith(VALUE_ENVELOPE_REFUSAL)).toBe(true);
    expect(f!.message).not.toMatch(/assignment/i);
    if (detail) expect(f!.message).toContain(detail);
    // It gates: `os validate` exits non-zero on it.
    expect(splitBySeverity(findings).errors).toHaveLength(1);
  });

  it.each(NODE_TYPES)('%s: a valid envelope, the two kept spellings and literals are clean', (nodeType) => {
    expect(validate(nodeType, crud(nodeType, {
      total: { dialect: 'cel', source: 'round(price * 100) / 100.0' },
      subject: { dialect: 'cel', source: "'Quote for ' + string(price)" },
      label: 'Quote',
      owner: '{$User.Id}',
      due: '{TODAY() + 7}',
      n: 3, ok: true, nothing: null,
      payload: { nested: { dialect: 'cel' } },   // a nested envelope is data
    }))).toEqual([]);
  });

  it('the assignment slot answers with the SAME sentence — one refusal notion for every value slot', () => {
    expect(ASSIGNMENT_VALUE_ENVELOPE_REFUSAL).toBe(VALUE_ENVELOPE_REFUSAL);
    const [f] = validate('assignment', { assignments: { total: { dialect: 'cel' } } });
    expect(f!.severity).toBe('error');
    expect(f!.message.startsWith(VALUE_ENVELOPE_REFUSAL)).toBe(true);
  });
});

describe('the retired template dialect — a `{…}` token in a value slot is a located error (#19939)', () => {
  const REFUSED: ReadonlyArray<[string, NodeType, Record<string, unknown>, string, string]> = [
    ['a template expression (the 17.x hint\'s own case)', 'create_record', crud('create_record', { total: '{round(price * 100) / 100}' }), 'config.fields.total', "source: 'round(price * 100) / 100.0'"],
    ['arithmetic', 'update_record', crud('update_record', { total: '{price * 2}' }), 'config.fields.total', "source: 'price * 2'"],
    ['a function inside text', 'create_record', crud('create_record', { subject: 'Total: {max(price, 10)}' }), 'config.fields.subject', "\"'Total: ' + (max(price, 10))\""],
    ['a plain reference', 'update_record', crud('update_record', { subject: '{record.name}' }), 'config.fields.subject', "source: 'record.name'"],
    ['text with a reference hole', 'create_record', crud('create_record', { subject: 'Follow up on {record.name}' }), 'config.fields.subject', "\"'Follow up on ' + record.name\""],
    ['a nested literal string', 'create_record', crud('create_record', { payload: { note: '{price}' } }), 'config.fields.payload.note', "source: 'price'"],
    ['the canonical assignment map', 'assignment', { assignments: { total: '{floor(price)}' } }, 'config.assignments.total', "source: 'floor(price)'"],
    ['the legacy assignment array', 'assignment', { assignments: [{ variable: 'total', value: '{price}' }] }, 'config.assignments[0].value', "source: 'price'"],
    ['the legacy bare assignment config', 'assignment', { total: '{price}' }, 'config.total', "source: 'price'"],
  ];

  it.each(REFUSED)('%s — rule `expression-invalid`, severity `error`, located, with the CEL spelling', (_what, nodeType, config, at, spelling) => {
    const findings = validate(nodeType, config);
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f!.rule).toBe(EXPRESSION_INVALID);
    expect(f!.severity).toBe('error');
    expect(f!.where).toContain(` at ${at}`);
    expect(f!.message.startsWith(VALUE_SLOT_TEMPLATE_REFUSAL)).toBe(true);
    expect(f!.message).toContain(spelling);
    // It gates: `os validate` exits non-zero on it.
    expect(splitBySeverity(findings).errors).toHaveLength(1);
  });

  it.each([
    ['a date macro — CEL has no string form of a Timestamp yet', '{NOW()}'],
    ['a date macro with an offset', '{TODAY() + 7}'],
    ['a `$User` path — the flow CEL scope binds no user yet', '{$User.Id}'],
    ['plain text', 'approved'],
  ])('says nothing for %s', (_why, value) => {
    for (const nodeType of NODE_TYPES) {
      expect(validate(nodeType, crud(nodeType, { v: value })), `${nodeType}: ${value}`).toEqual([]);
    }
    expect(validate('assignment', { assignments: { v: value } })).toEqual([]);
  });

  it('says nothing outside a value slot — `update_record.filter` is a match map, not a value', () => {
    expect(validate('update_record', { objectName: 'quote', filter: { total: '{round(price)}' }, fields: { subject: 'x' } }))
      .toEqual([]);
  });
});
