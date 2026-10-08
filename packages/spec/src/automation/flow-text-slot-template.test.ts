// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22110 — the flow TEXT slots read ADR-0032 §3's `{{ }}` holes, and a
 * single-brace `{…}` token left from the 17.x dialect is refused with its
 * remedy. These pins hold the one judge (`flow-text-slot-template.ts`): where
 * the text slots are, what it refuses, what it prescribes for each token kind,
 * and that the node contracts compose it. The renderer half (the template
 * engine over the flow's variables) is pinned in `service-automation`'s
 * `text-slot-template.test.ts`; the two doors in that package's registration
 * tests and in `@objectstack/lint`.
 */
import { describe, expect, it } from 'vitest';

import {
  FLOW_NODE_TEXT_SLOTS,
  TEXT_SLOT_TEMPLATE_REFUSAL,
  flowNodeTextSlotSources,
  textSlotTemplateRefusal,
} from './flow-text-slot-template';
import { valueSlotTemplateRefusals } from './flow-value-slot-template';
import { ScreenConfigSchema } from './builtin-node-config.zod';
import { tmpl } from '../shared/expression.zod';

describe('FLOW_NODE_TEXT_SLOTS — where the `{{ }}` text slots are', () => {
  it('names exactly the five slots whose rendered value is only ever text', () => {
    expect(FLOW_NODE_TEXT_SLOTS.map((s) => `${s.nodeType}.${s.key}`)).toEqual([
      'notify.title',
      'notify.message',
      'screen.title',
      'screen.description',
      'end.message',
    ]);
  });
});

describe('textSlotTemplateRefusal — the one judge of the single brace in a text slot', () => {
  it('passes text with no single-brace token: plain text, `{{ }}` holes, a `$`-named hole, a formatter', () => {
    for (const text of [
      'Health dropped to red — please review.',
      'Deal won: {{ record.name }}',
      '{{record.name}}',
      'Failed: {{ $error.message }}',
      '{{ record.amount | currency:EUR }} on {{ rows.0.close_date | date:iso }}',
    ]) {
      expect(textSlotTemplateRefusal(text), text).toBeUndefined();
    }
  });

  it('refuses a path token, leading with the rule and naming the whole text rewritten with holes', () => {
    const message = textSlotTemplateRefusal('Invoice "{record.name}" for {record.account.name}')!;
    expect(message.startsWith(TEXT_SLOT_TEMPLATE_REFUSAL)).toBe(true);
    expect(message).toContain('`Invoice "{{ record.name }}" for {{ record.account.name }}`');
  });

  it('spells a `$`-named variable, an index and a node output as the same path in a hole', () => {
    expect(textSlotTemplateRefusal('Failed: {$error.message}')).toContain('`Failed: {{ $error.message }}`');
    expect(textSlotTemplateRefusal('{rows.0}')).toContain('`{{ rows.0 }}`');
    expect(textSlotTemplateRefusal('{ lookup.result }')).toContain('`{{ lookup.result }}`');
  });

  it('judges a single-brace token beside a hole, and leaves the hole alone', () => {
    const message = textSlotTemplateRefusal('{{ record.name }} owes {amount}')!;
    expect(message).toContain('`{{ record.name }} owes {{ amount }}`');
  });

  it('names an assignment with a CEL value envelope for logic — every integer divisor kept a double', () => {
    const message = textSlotTemplateRefusal('Total {round(amount * 100) / 100}')!;
    expect(message.startsWith(TEXT_SLOT_TEMPLATE_REFUSAL)).toBe(true);
    expect(message).toContain("dialect: 'cel', source: \"round(amount * 100) / 100.0\"");
    expect(message).toContain('`{{ v }}`');
    // No path token, so no "Write … as …" rewrite.
    expect(message).not.toContain('Write `');
  });

  it('names an assignment whose value slot still reads it for a date macro or a run-user path', () => {
    for (const token of ['{TODAY() + 7}', '{NOW()}', '{$User.Id}']) {
      const message = textSlotTemplateRefusal(`Due ${token}`)!;
      expect(message.startsWith(TEXT_SLOT_TEMPLATE_REFUSAL), token).toBe(true);
      expect(message, token).toContain(`assignments: { v: '${token}' }`);
      // …and that value-slot spelling is one the value slot does keep (#19939).
      expect(valueSlotTemplateRefusals(token), token).toEqual([]);
    }
  });

  it('tells an author to delete a token that is neither a path nor an expression', () => {
    expect(textSlotTemplateRefusal('JSON {"a": 1}')).toContain('neither a variable path nor an expression');
  });

  it('names each unspellable token once, after the rewrite of the paths', () => {
    const message = textSlotTemplateRefusal('{name}: {NOW()} / {NOW()}')!;
    expect(message.indexOf('`{{ name }}: {NOW()} / {NOW()}`')).toBeGreaterThan(0);
    expect(message.split("assignments: { v: '{NOW()}' }")).toHaveLength(2);
  });
});

describe('flowNodeTextSlotSources — the text slots one node config carries', () => {
  it('reads the notify pair as a bare string or a template envelope, and nothing else on the node', () => {
    expect(flowNodeTextSlotSources('notify', {
      recipients: ['{record.owner}'],
      sourceId: '{record.id}',
      title: 'Hi {record.name}',
      message: tmpl`Bye {{ record.name }}`,
    })).toEqual([
      { path: 'title', label: 'notify title', source: 'Hi {record.name}' },
      { path: 'message', label: 'notify message', source: 'Bye {{ record.name }}' },
    ]);
  });

  it('reads a screen title / description and an end message, and no slot of any other node', () => {
    expect(flowNodeTextSlotSources('screen', { title: 'T', description: 'D', recordId: '{x}' }).map((s) => s.path))
      .toEqual(['title', 'description']);
    expect(flowNodeTextSlotSources('end', { outcome: 'refused', message: 'M' }).map((s) => s.label)).toEqual(['end message']);
    expect(flowNodeTextSlotSources('http', { url: '/x/{id}', title: 'T' })).toEqual([]);
    expect(flowNodeTextSlotSources('notify', { title: 42, message: { dialect: 'cel', source: 'x' } })).toEqual([]);
    expect(flowNodeTextSlotSources('notify', undefined)).toEqual([]);
  });
});

describe('ScreenConfigSchema — its two text slots compose the judge', () => {
  it('refuses a single-brace token in `title` or `description` at the key, and accepts the hole', () => {
    for (const key of ['title', 'description'] as const) {
      const refused = ScreenConfigSchema.safeParse({ [key]: 'Task "{subject}" created' });
      expect(refused.success, key).toBe(false);
      expect(refused.error?.issues.map((i) => [i.code, i.path.join('.')]), key).toEqual([['custom', key]]);
      expect(refused.error?.issues[0]!.message, key).toContain('`Task "{{ subject }}" created`');
      expect(ScreenConfigSchema.safeParse({ [key]: 'Task "{{ subject }}" created' }).success, key).toBe(true);
    }
  });

  it('keeps the single-brace dialect on the value-like keys — a `recordId` names a record, not text', () => {
    expect(ScreenConfigSchema.safeParse({ objectName: 'account', mode: 'edit', recordId: '{account_id}', defaults: { name: '{lead.company}' } }).success)
      .toBe(true);
  });
});
