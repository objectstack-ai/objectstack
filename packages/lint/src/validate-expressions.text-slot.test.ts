// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22110 — the `objectstack validate` half of the flow TEXT slots reading
 * ADR-0032 §3's `{{ }}` holes: a notify `title` / `message`, a screen `title` /
 * `description`, a refusing `end` node's `message`.
 *
 * Driven through the REGISTRY, the way `os validate` runs it (normalize, parse
 * with `ObjectStackDefinitionSchema`, `runAuthoringRules('validate', …)`), so a
 * registry adapter that dropped or re-graded the finding reddens here. Two
 * checks, in the order `registerFlow` runs them on the same config:
 *
 *  1. a single-brace `{…}` token left from the 17.x dialect — a located `error`
 *     under `expression-invalid`, led by `TEXT_SLOT_TEMPLATE_REFUSAL` and naming
 *     the hole spelling of each token;
 *  2. a slot with none is compiled as a `template` — a hole holding logic or an
 *     unknown formatter is an `error` too.
 *
 * Every other notify / screen string keeps the single-brace dialect and gets
 * nothing here. The `end` message is refused one door earlier, at the flow
 * parse (`EndConfigSchema`), so it is pinned on `validateStackExpressions`
 * directly — the pass that answers for a stack handed to it with no parse in
 * front.
 */

import { describe, expect, it } from 'vitest';
import { ObjectStackDefinitionSchema, normalizeStackInput } from '@objectstack/spec';
import { TEXT_SLOT_TEMPLATE_REFUSAL } from '@objectstack/spec/automation';
import { runAuthoringRules, EXPRESSION_INVALID } from './authoring-rules.js';
import { validateStackExpressions } from './validate-expressions.js';

function stackWith(nodeType: string, config: Record<string, unknown>) {
  return {
    objects: [{ name: 'deal', label: 'Deal', fields: { name: { type: 'text', label: 'Name' }, amount: { type: 'number', label: 'Amount' } } }],
    flows: [{
      name: 'deal_won',
      label: 'Deal won',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'w', type: nodeType, label: 'Text', config },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'w' },
        { id: 'e2', source: 'w', target: 'end' },
      ],
    }],
  };
}

/** `os validate`'s own sequence, minus the file loader — this node's `expression-invalid` findings. */
function validate(nodeType: string, config: Record<string, unknown>) {
  const normalized = normalizeStackInput(stackWith(nodeType, config) as Record<string, unknown>);
  const parsed = ObjectStackDefinitionSchema.parse(normalized);
  return runAuthoringRules('validate', {
    normalized: normalized as Record<string, unknown>,
    parsed: parsed as Record<string, unknown>,
  }).filter((f) => f.rule === EXPRESSION_INVALID && f.where.includes("node 'w'"));
}

describe('`objectstack validate` — a flow text slot reads `{{ }}` holes (#22110)', () => {
  it('refuses a single-brace token in a notify title / message and a screen title / description, at `error`, with the hole spelling', () => {
    const cases: Array<[string, Record<string, unknown>, string, string]> = [
      ['notify', { recipients: ['u1'], title: 'Deal {record.name} won' }, 'notify title at config.title', '`Deal {{ record.name }} won`'],
      ['notify', { recipients: ['u1'], title: 'Won', message: { dialect: 'template', source: 'By {$error.message}' } }, 'notify message at config.message', '`By {{ $error.message }}`'],
      ['screen', { waitForInput: true, title: 'Hi {name}' }, 'screen title at config.title', '`Hi {{ name }}`'],
      ['screen', { waitForInput: true, description: 'About {record.name}' }, 'screen description at config.description', '`About {{ record.name }}`'],
    ];
    for (const [nodeType, config, where, spelling] of cases) {
      const findings = validate(nodeType, config);
      expect(findings, JSON.stringify(config)).toHaveLength(1);
      expect(findings[0]!.severity).toBe('error');
      expect(findings[0]!.where).toContain(where);
      expect(findings[0]!.message.startsWith(TEXT_SLOT_TEMPLATE_REFUSAL)).toBe(true);
      expect(findings[0]!.message).toContain(spelling);
    }
  });

  it('compiles a slot with no single-brace token — logic, an unknown formatter or an unbalanced hole is an `error`', () => {
    for (const title of ['Total {{ amount * 2 }}', 'Total {{ amount | bogus }}', 'Total {{ amount']) {
      const findings = validate('notify', { recipients: ['u1'], title });
      expect(findings, title).toHaveLength(1);
      expect(findings[0]!.severity, title).toBe('error');
      expect(findings[0]!.message, title).toContain('invalid template');
    }
  });

  it('passes holes, formatters and a `$`-named variable — and every single-brace slot that is not text', () => {
    expect(validate('notify', {
      recipients: ['{record.owner}'],
      sourceObject: 'deal',
      sourceId: '{record.id}',
      actionUrl: '/deal/{record.id}',
      title: 'Deal {{ record.name }} won: {{ record.amount | currency }}',
      message: 'Failed: {{ $error.message }}',
    })).toEqual([]);
    expect(validate('screen', { objectName: 'deal', mode: 'edit', recordId: '{record.id}', title: 'Edit {{ record.name }}' })).toEqual([]);
  });

  it('judges an `end` message too, for a stack handed to `validateStackExpressions` with no parse in front of it', () => {
    const issues = validateStackExpressions(stackWith('end', { outcome: 'refused', message: 'No: {record.name}' }) as never)
      .filter((i) => i.where.includes("node 'w'"));
    expect(issues.map((i) => i.severity)).toEqual(['error']);
    expect(issues[0]!.where).toContain('end message at config.message');
    expect(issues[0]!.message).toContain('`No: {{ record.name }}`');
  });
});
