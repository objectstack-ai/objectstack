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
import { EndConfigSchema, ScreenConfigSchema } from './builtin-node-config.zod';
import { NotifyConfigSchema } from './io-node-config.zod';
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
  it('passes text with no single-brace token: plain text, `{{ }}` holes, a hole over an engine-bound `$` variable, a formatter', () => {
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

  it('names an assignment whose value slot still reads it for a date macro', () => {
    for (const token of ['{TODAY() + 7}', '{NOW()}']) {
      const message = textSlotTemplateRefusal(`Due ${token}`)!;
      expect(message.startsWith(TEXT_SLOT_TEMPLATE_REFUSAL), token).toBe(true);
      expect(message, token).toContain(`assignments: { v: '${token}' }`);
      // …and that value-slot spelling is one the value slot does keep (#19939).
      expect(valueSlotTemplateRefusals(token), token).toEqual([]);
    }
  });

  // #19939 pass 2: the value slots refuse `{$User.*}`, so the run user's id is
  // computed with the CEL envelope the value-slot refusal names, never with a
  // value-slot spelling that is refused in turn.
  it('names an assignment with the CEL envelope `current_user.id` for the run user\'s id, and its guard', () => {
    const message = textSlotTemplateRefusal('By {$User.Id}')!;
    expect(message.startsWith(TEXT_SLOT_TEMPLATE_REFUSAL)).toBe(true);
    expect(message).toContain("assignments: { v: { dialect: 'cel', source: 'current_user.id' } }");
    expect(message).toContain('`current_user != null ? current_user.id : null`');
    expect(message).toContain('`{{ v }}`');
    expect(message).not.toContain("assignments: { v: '{$User.Id}' }");
    expect(valueSlotTemplateRefusals('{$User.Id}')).toHaveLength(1);
  });

  it('says every other run-user path never resolved, and names the read of the user record', () => {
    for (const token of ['{$User.Email}', '{$User.Name}']) {
      const message = textSlotTemplateRefusal(`Contact ${token}`)!;
      expect(message, token).toContain(`\`${token}\` never resolved in any shipped run`);
      expect(message, token).toContain("objectName: 'sys_user'");
      expect(message, token).toContain('`{{ me.email }}`');
      expect(message, token).not.toContain(`assignments: { v: '${token}' }`);
    }
  });

  // A hole with one brace missing is not an old single-brace token: doubling it
  // would prescribe `{{{ amount }}` / `{{ amount }}}`, which the engine refuses
  // too. The judge stays silent and the compile step every door runs next names
  // the unbalanced hole (pinned at the `objectstack validate` door in
  // `@objectstack/lint`'s `validate-expressions.text-slot.test.ts`).
  it('prescribes no rewrite for a token touching exactly one brace — an unbalanced hole is the compile step\'s', () => {
    for (const text of ['Total {{ amount }', 'Total { amount }}', '{{x}', '{x}}']) {
      expect(textSlotTemplateRefusal(text), text).toBeUndefined();
    }
    // …while a genuine single-brace token beside one still gets its rewrite, and nothing three-braced.
    const message = textSlotTemplateRefusal('Total {{ amount } by {owner}')!;
    expect(message).toContain('`Total {{ amount } by {{ owner }}`');
    expect(message).not.toMatch(/\{\{\{|\}\}\}/);
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

/**
 * #22477 — a `{{ $… }}` hole over a root the flow engine does not bind is
 * refused at the same door as the single brace, with the remedy `{$User.Id}`
 * already gets; the `$` roots the engine binds stay admitted. The list itself
 * is pinned against the engine's sources in `service-automation`'s
 * `text-slot-template.test.ts`.
 */
describe('textSlotTemplateRefusal — a `{{ }}` hole over a `$` root the engine does not bind', () => {
  /** The remedy part of a single-brace refusal — what follows the shared lead sentence. */
  const singleBraceRemedy = (text: string) => textSlotTemplateRefusal(text)!.slice(TEXT_SLOT_TEMPLATE_REFUSAL.length + 1);

  it('refuses `By {{ $User.Id }}` with the very remedy `{$User.Id}` gets — the two spellings answer alike', () => {
    const message = textSlotTemplateRefusal('By {{ $User.Id }}');
    expect(message).toBeDefined();
    // Not the single-brace rule: the author wrote a hole.
    expect(message!.startsWith(TEXT_SLOT_TEMPLATE_REFUSAL)).toBe(false);
    const remedy = singleBraceRemedy('By {$User.Id}');
    expect(remedy).toContain("assignments: { v: { dialect: 'cel', source: 'current_user.id' } }");
    expect(remedy).toContain('`{{ v }}`');
    expect(message!.endsWith(remedy)).toBe(true);
  });

  it('gives every `$User.<path>` hole its single-brace remedy, formatter or not', () => {
    for (const [text, single] of [
      ['{{$User.Email}}', '{$User.Email}'],
      ['Owner: {{ $User.Name | upper }}', '{$User.Name}'],
    ] as const) {
      expect(textSlotTemplateRefusal(text), text).toContain(`\`${single}\` never resolved in any shipped run`);
    }
  });

  it('admits a hole over each `$` variable the engine binds, a formatter and an index included', () => {
    for (const text of [
      '{{ $error.message }}',
      'Failed: {{ $error.code | upper }}',
      '{{ $record.name }}',
      'Run {{ $runId }} of {{ $flowName }} ({{ $flowLabel }})',
      '{{ $loopItems[0] }} at {{ $loopIndex }}',
    ]) {
      expect(textSlotTemplateRefusal(text), text).toBeUndefined();
    }
  });

  it('control: an ordinary hole and a node output are unchanged', () => {
    expect(textSlotTemplateRefusal('Deal won: {{ record.name }}')).toBeUndefined();
    expect(textSlotTemplateRefusal('{{ lookup.result }} / {{ rows[0].subject }}')).toBeUndefined();
  });

  it('refuses any other `$` root — a bare `$User`, a case slip, an invented name — naming the root and the engine\'s variables', () => {
    for (const [text, root] of [
      ['{{ $User }}', '$User'],
      ['{{ $Error.message }}', '$Error'],
      ['{{ $org.id | upper }}', '$org'],
      ['{{ $caught[0] }}', '$caught'],
    ] as const) {
      const message = textSlotTemplateRefusal(text)!;
      expect(message, text).toBeDefined();
      expect(message, text).toContain(`\`${text}\` names \`${root}\``);
      expect(message, text).toContain('`$error`');
      expect(message, text).toContain('`{{ v }}`');
      expect(message, text).not.toContain("assignments: { v: '");
    }
  });

  it('names each such hole once, and judges a text holding a single-brace token too — single brace first', () => {
    const message = textSlotTemplateRefusal('{{ $User.Id }} and {{ $User.Id }} for {owner}')!;
    expect(message.startsWith(TEXT_SLOT_TEMPLATE_REFUSAL)).toBe(true);
    expect(message).toContain('`{{ $User.Id }} and {{ $User.Id }} for {{ owner }}`');
    expect(message.split("assignments: { v: { dialect: 'cel', source: 'current_user.id' } }")).toHaveLength(2);
  });

  it('leaves a hole that does not compile as a path to the compile step', () => {
    for (const text of ['{{ $User.Id + 1 }}', '{{ $User. Id }}', '{{{ $User.Id }}']) {
      expect(textSlotTemplateRefusal(text), text).toBeUndefined();
    }
  });

  // The single-brace rewrite must never prescribe a hole this judge refuses.
  it('prescribes no `{{ }}` rewrite for a single-brace path over such a root — its remedy instead', () => {
    const message = textSlotTemplateRefusal('Failed: {$caught.message}')!;
    expect(message.startsWith(TEXT_SLOT_TEMPLATE_REFUSAL)).toBe(true);
    expect(message).not.toContain('{{ $caught.message }}');
    expect(message).not.toContain('Write `');
    expect(message).toContain('`{$caught.message}` names `$caught`');
    // …while a path beside it is still rewritten, and an engine-bound one is doubled as before.
    expect(textSlotTemplateRefusal('{name}: {$Foo}')).toContain('`{{ name }}: {$Foo}`');
    expect(textSlotTemplateRefusal('Failed: {$error.message}')).toContain('`Failed: {{ $error.message }}`');
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

  it('refuses a `{{ $User.Id }}` hole in `title` or `description` at the key, with its remedy', () => {
    for (const key of ['title', 'description'] as const) {
      const refused = ScreenConfigSchema.safeParse({ [key]: 'By {{ $User.Id }}' });
      expect(refused.success, key).toBe(false);
      expect(refused.error?.issues.map((i) => [i.code, i.path.join('.')]), key).toEqual([['custom', key]]);
      expect(refused.error?.issues[0]!.message, key).toContain("assignments: { v: { dialect: 'cel', source: 'current_user.id' } }");
    }
  });

  it('keeps the single-brace dialect on the value-like keys — a `recordId` names a record, not text', () => {
    expect(ScreenConfigSchema.safeParse({ objectName: 'account', mode: 'edit', recordId: '{account_id}', defaults: { name: '{lead.company}' } }).success)
      .toBe(true);
  });
});

describe('the node contracts — `By {{ $User.Id }}` is refused at the schema (#22477)', () => {
  it('refuses it in a notify `title` / `message` (a bare string or a template envelope), at the key, with its remedy', () => {
    for (const config of [
      { recipients: ['u1'], title: 'By {{ $User.Id }}' },
      { recipients: ['u1'], title: 'Closed', message: tmpl`By {{ $User.Id }}` },
    ]) {
      const key = 'message' in config ? 'message' : 'title';
      const refused = NotifyConfigSchema.safeParse(config);
      expect(refused.success, key).toBe(false);
      expect(refused.error?.issues.map((i) => [i.code, i.path.join('.')]), key).toEqual([['custom', key]]);
      expect(refused.error?.issues[0]!.message, key).toContain("assignments: { v: { dialect: 'cel', source: 'current_user.id' } }");
    }
  });

  it('refuses it in a refusing `end` node\'s `message`', () => {
    const refused = EndConfigSchema.safeParse({ outcome: 'refused', message: 'Refused by {{ $User.Id }}' });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues.map((i) => [i.code, i.path.join('.')])).toEqual([['custom', 'message']]);
    expect(refused.error?.issues[0]!.message).toContain("assignments: { v: { dialect: 'cel', source: 'current_user.id' } }");
  });

  it('control: `{{ $error.message }}` and `{{ record.name }}` still parse in every text slot', () => {
    for (const text of ['Failed: {{ $error.message }}', 'Deal won: {{ record.name }}']) {
      expect(NotifyConfigSchema.safeParse({ recipients: ['u1'], title: text, message: tmpl`${text}` }).success, text).toBe(true);
      expect(ScreenConfigSchema.safeParse({ title: text, description: text }).success, text).toBe(true);
      expect(EndConfigSchema.safeParse({ outcome: 'refused', message: text }).success, text).toBe(true);
    }
  });
});
