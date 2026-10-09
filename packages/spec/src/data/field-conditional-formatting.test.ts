// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22228] `FieldSchema.conditionalFormatting` — a field's cell formatting
 * rules, `[{ condition, style }]`, at the parse seam.
 *
 * The rule element is the list view's own (`ConditionalFormattingRuleSchema`,
 * declared once in `shared/conditional-formatting.zod.ts`), so the field adds
 * no second style vocabulary. These pins hold that identity, the accepted
 * shape, and the refusals the parse gives. The CEL half of the authoring gate
 * (it parses, the scope is `value` and `record`) is `@objectstack/lint`'s,
 * pinned in `validate-expressions.field-conditional-formatting.test.ts`.
 */

import { describe, it, expect } from 'vitest';

import { FieldSchema } from './field.zod';
import { ListViewSchema } from '../ui/view.zod';
import { ConditionalFormattingRuleSchema } from '../shared/conditional-formatting.zod';
import { EVALUATED_EXPRESSION_SOURCE_REQUIRED } from '../shared/expression.zod';

const RED = { color: '#b91c1c' };
const amount = (conditionalFormatting: unknown) => ({ name: 'amount', label: 'Amount', type: 'currency', conditionalFormatting });

/** The first sentence of a message — the part a pin may hold without pinning prose. */
const firstSentence = (message: string) => message.split(/(?<=\.)\s/)[0];

describe('the rule element is the list view\'s own — one declaration, no second copy', () => {
  it('FieldSchema and ListViewSchema mount the same element schema', () => {
    const fieldElement = FieldSchema.shape.conditionalFormatting.unwrap().element;
    const rowElement = ListViewSchema.shape.conditionalFormatting.unwrap().element;
    expect(fieldElement).toBe(ConditionalFormattingRuleSchema);
    expect(rowElement).toBe(ConditionalFormattingRuleSchema);
  });

  it('a rule list parses to the same value on both members', () => {
    const rules = [{ condition: 'value < 0', style: RED }, { condition: { dialect: 'cel', source: 'record.paid == true' }, style: { fontWeight: '600' } }];
    const onField = FieldSchema.parse(amount(rules)).conditionalFormatting;
    const onRow = ListViewSchema.parse({ type: 'grid', columns: ['amount'], conditionalFormatting: rules }).conditionalFormatting;
    expect(onField).toStrictEqual(onRow);
  });
});

describe('FieldSchema accepts conditionalFormatting', () => {
  it('accepts a rule with a parsing condition and a style map — the card\'s worked example', () => {
    const result = FieldSchema.safeParse(amount([{ condition: 'value < 0', style: RED }]));
    expect(result.success).toBe(true);
    if (result.success) {
      // The bare string normalizes to the evaluated envelope, like every CEL slot.
      expect(result.data.conditionalFormatting).toEqual([{ condition: { dialect: 'cel', source: 'value < 0' }, style: RED }]);
    }
  });

  it('keeps the rules in authored order', () => {
    const rules = [
      { condition: 'value < record.safety_level', style: { color: '#b45309' } },
      { condition: 'value < 0', style: RED },
    ];
    const parsed = FieldSchema.parse({ name: 'stock', label: 'Stock', type: 'number', conditionalFormatting: rules });
    expect(parsed.conditionalFormatting?.map((r) => (r.condition as { source: string }).source))
      .toEqual(['value < record.safety_level', 'value < 0']);
  });

  it.each(['text', 'number', 'select', 'date', 'boolean', 'lookup'])('is not scoped to a type — accepted on `%s`', (type) => {
    const extra = type === 'select' ? { options: [{ label: 'High', value: 'high' }] } : type === 'lookup' ? { reference: 'account' } : {};
    const result = FieldSchema.safeParse({ name: 'f', label: 'F', type, ...extra, conditionalFormatting: [{ condition: "value == 'high'", style: RED }] });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('control: a field without the key parses, and the key stays absent', () => {
    const result = FieldSchema.safeParse({ name: 'amount', label: 'Amount', type: 'currency' });
    expect(result.success).toBe(true);
    if (result.success) expect('conditionalFormatting' in result.data).toBe(false);
  });

  it('an empty list is a list — accepted and kept', () => {
    expect(FieldSchema.parse(amount([])).conditionalFormatting).toEqual([]);
  });
});

describe('FieldSchema refuses a malformed rule, located at the rule', () => {
  const REFUSED: Array<[string, unknown, { code: string; path: Array<string | number>; first?: string }]> = [
    ['one rule not in a list', { condition: 'value < 0', style: RED }, { code: 'invalid_type', path: ['conditionalFormatting'] }],
    ['a rule with no `style`', [{ condition: 'value < 0' }], { code: 'invalid_type', path: ['conditionalFormatting', 0, 'style'] }],
    ['a non-string style value', [{ condition: 'value < 0', style: { fontWeight: 600 } }], { code: 'invalid_type', path: ['conditionalFormatting', 0, 'style', 'fontWeight'] }],
    ['a colour beside `style`', [{ condition: 'value < 0', style: RED, color: 'red' }], {
      code: 'unrecognized_keys',
      path: ['conditionalFormatting', 0],
      first: 'Unrecognized key(s) on this conditional formatting rule: `color`.',
    }],
    ['the `when` alias for `condition`', [{ when: 'value < 0', style: RED }], {
      code: 'unrecognized_keys',
      path: ['conditionalFormatting', 0],
      first: 'Unrecognized key(s) on this conditional formatting rule: `when`.',
    }],
  ];

  it.each(REFUSED)('refuses %s', (_label, rules, expected) => {
    const result = FieldSchema.safeParse(amount(rules));
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.code === expected.code && JSON.stringify(i.path) === JSON.stringify(expected.path));
    expect(issue, JSON.stringify(result.error!.issues)).toBeDefined();
    if (expected.first) expect(firstSentence(issue!.message)).toBe(expected.first);
  });

  it('the `when` refusal names the canonical key', () => {
    const result = FieldSchema.safeParse(amount([{ when: 'value < 0', style: RED }]));
    const issue = result.error!.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue!.message).toContain('Did you mean `when` → `condition`?');
  });

  it('refuses a blank condition with the evaluated-slot sentence', () => {
    const result = FieldSchema.safeParse(amount([{ condition: '   ', style: RED }]));
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => JSON.stringify(i.path) === JSON.stringify(['conditionalFormatting', 0, 'condition']));
    expect(issue, JSON.stringify(result.error!.issues)).toBeDefined();
    expect(JSON.stringify(result.error!.issues)).toContain(firstSentence(EVALUATED_EXPRESSION_SOURCE_REQUIRED).slice(0, 60));
  });
});
