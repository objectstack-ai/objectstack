// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `create_record` / `update_record` `fields.*` — the `objectstack validate` half
 * of the value slot #19938 declares (the contract half of #11182 ruling D).
 *
 * Driven through the REGISTRY, the way `os validate` runs it: the stack is
 * normalized, parsed by `ObjectStackDefinitionSchema`, and handed to
 * `runAuthoringRules('validate', …)`. A pin on `validateStackExpressions`
 * alone would stay green through a registry adapter that dropped or re-graded
 * the finding.
 *
 * Two halves:
 *
 *  1. **Refusal** — a malformed envelope in `fields.*` is a located `error`
 *     under the rule id `expression-invalid`, led by the slot-neutral
 *     `VALUE_ENVELOPE_REFUSAL` (never "an assignment value"), the same verdict
 *     `registerFlow` throws on. A valid envelope, a `{token}` template and a
 *     literal are clean.
 *  2. **The hint** (ruling D point 1) — a `{…}` template EXPRESSION in any
 *     `value` slot is pointed at the envelope, at `warning` only, with the one
 *     conversion trap (`/ 100` → `/ 100.0`) stated. Plain references, date
 *     macros, `$User` paths and non-value slots get nothing.
 */

import { describe, expect, it } from 'vitest';
import { ObjectStackDefinitionSchema, normalizeStackInput } from '@objectstack/spec';
import { ASSIGNMENT_VALUE_ENVELOPE_REFUSAL, VALUE_ENVELOPE_REFUSAL } from '@objectstack/spec/automation';
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
    const findings = validate(nodeType, crud(nodeType, { subject: 'Quote {price}', total: envelope }));
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

  it.each(NODE_TYPES)('%s: a valid envelope, `{token}` templates and literals are clean', (nodeType) => {
    expect(validate(nodeType, crud(nodeType, {
      total: { dialect: 'cel', source: 'round(price * 100) / 100.0' },
      subject: 'Quote for {price}',
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

describe('the author-time hint — a `{…}` template expression in a value slot points at the envelope (#11182 ruling D)', () => {
  const HINTED: ReadonlyArray<[NodeType, Record<string, unknown>, string]> = [
    ['create_record', crud('create_record', { total: '{round(price * 100) / 100}' }), 'config.fields.total'],
    ['update_record', crud('update_record', { total: '{price * 2}' }), 'config.fields.total'],
    ['create_record', crud('create_record', { subject: 'Total: {max(price, 10)}' }), 'config.fields.subject'],
    ['assignment', { assignments: { total: '{floor(price)}' } }, 'config.assignments.total'],
  ];

  it.each(HINTED)('%s: warns at the slot, never errors — the template form keeps its meaning', (nodeType, config, at) => {
    const findings = validate(nodeType, config);
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f!.severity).toBe('warning');
    expect(f!.rule).toBe(EXPRESSION_INVALID);
    expect(f!.where).toContain(at);
    expect(f!.message).toContain("{ dialect: 'cel', source: '…' }");
    // The one conversion trap, stated where the author reads the hint.
    expect(f!.message).toContain('`round(x * 100) / 100.0`');
    // Advisory: `os validate` still passes.
    expect(splitBySeverity(findings).errors).toEqual([]);
  });

  it.each([
    ['a plain reference — CEL adds nothing, and an absent key would start faulting', '{record.name}'],
    ['text with a reference hole', 'Follow up on {record.name}'],
    ['a date macro — CEL has no string form of a Timestamp', '{NOW()}'],
    ['a date macro with an offset', '{TODAY() + 7}'],
    ['a `$User` path — the flow CEL scope binds no user', '{$User.Id}'],
    ['an unknown function — a run-time refusal, not a candidate to move', '{ROUND(price)}'],
    ['a string literal token', '{"fixed"}'],
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
