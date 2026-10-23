// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24798 (ruling B) — a bulk action's `confirmText` is an ADR-0032 `template`
 * slot over a CLOSED scope: `count` and the def's params by name. These pins
 * hold the slot's accept set (a bare string is shorthand for the envelope, a
 * holeless sentence still parses, a blank one still parses in 18.x) and the
 * roots the spec declares. The holes themselves are judged at the doors
 * through `closedScopeTemplateRefusal` (`automation/flow-text-slot-template.ts`,
 * pinned beside the flow judge) — `@objectstack/lint`'s `validate-expressions`
 * pins the door.
 */
import { describe, expect, it } from 'vitest';

import { BULK_CONFIRM_COUNT_ROOT, BulkActionDefSchema, bulkConfirmTemplateRoots } from './bulk-action.zod';
import { closedScopeTemplateRefusal } from '../automation/flow-text-slot-template';

const def = (confirmText: unknown) => ({
  name: 'update_tier',
  label: 'Update Tier',
  operation: 'update',
  confirmText,
  params: [{ name: 'tier', type: 'select', options: [{ label: 'Gold', value: 'gold' }] }],
});

const parsed = (confirmText: unknown) => {
  const r = BulkActionDefSchema.safeParse(def(confirmText));
  if (!r.success) throw new Error(r.error.issues.map((i) => i.message).join('\n'));
  return r.data.confirmText;
};

const refusal = (confirmText: unknown) => {
  const r = BulkActionDefSchema.safeParse(def(confirmText));
  return r.success ? undefined : r.error.issues;
};

describe('BulkActionDef.confirmText — a template slot (ADR-0032 Decisions 2–3)', () => {
  it('reads a bare string as shorthand for `{ dialect: \'template\', source }` — the HotCRM sentence included', () => {
    const source = 'Update tier on {{count}} account(s) to {{tier}}?';
    expect(parsed(source)).toEqual({ dialect: 'template', source });
  });

  it('accepts the envelope itself', () => {
    expect(parsed({ dialect: 'template', source: '{{ count | number }} selected' }))
      .toEqual({ dialect: 'template', source: '{{ count | number }} selected' });
  });

  it('still parses a stored sentence with no hole — as the template it now is, text unchanged', () => {
    expect(parsed('Set these labels on every selected project?'))
      .toEqual({ dialect: 'template', source: 'Set these labels on every selected project?' });
  });

  it('still parses a blank string, verbatim: refusing it is a narrowing, a warning at the doors', () => {
    // `confirmText` was `z.string()`, so `''` passed. The shared template
    // input refuses a blank source; this slot keeps the accept instead.
    expect(parsed('')).toBe('');
    expect(parsed('  \t')).toBe('  \t');
  });

  it('refuses a foreign-dialect envelope and a non-string with the slot\'s own sentence, prescribing `{{ count }}`', () => {
    for (const value of [{ dialect: 'cel', source: 'record.amount > 1' }, { dialect: 'cron', source: '0 9 * * *' }, 42]) {
      const issues = refusal(value);
      expect(issues, JSON.stringify(value)).toHaveLength(1);
      expect(issues![0]!.path).toEqual(['confirmText']);
      expect(issues![0]!.code).toBe('invalid_union');
      expect(issues![0]!.message).toMatch(/^A bulk action's `confirmText` is a template-typed slot/);
      expect(issues![0]!.message).toContain('{{ count }}');
      expect(issues![0]!.message).not.toContain('record.name');
    }
  });

  it('judges no hole at parse: an unbound hole and a single-brace token both parse (the doors name them)', () => {
    expect(parsed('Update {{ x }}')).toEqual({ dialect: 'template', source: 'Update {{ x }}' });
    expect(parsed('Update {count}')).toEqual({ dialect: 'template', source: 'Update {count}' });
  });

  it('keeps the `confirm` / `confirmmessage` near-misses pointing at `confirmText`', () => {
    for (const key of ['confirm', 'confirmmessage']) {
      const { confirmText: _drop, ...rest } = def('x');
      const r = BulkActionDefSchema.safeParse({ ...rest, [key]: 'Sure {{ count }}?' });
      expect(r.success, key).toBe(false);
      const issue = r.success ? undefined : r.error.issues[0];
      expect(issue?.code).toBe('unrecognized_keys');
      expect(issue?.message).toContain(`\`${key}\` → \`confirmText\``);
    }
  });
});

describe('bulkConfirmTemplateRoots — the closed scope the spec declares', () => {
  it('is `count`, then each param by name, in declaration order, bare', () => {
    expect(BULK_CONFIRM_COUNT_ROOT).toBe('count');
    expect(bulkConfirmTemplateRoots({ params: [{ name: 'tier' }, { name: 'owner_id' }] })).toEqual(['count', 'tier', 'owner_id']);
  });

  it('is `count` alone on a def with no params', () => {
    expect(bulkConfirmTemplateRoots({})).toEqual(['count']);
    expect(bulkConfirmTemplateRoots({ params: 'nonsense' })).toEqual(['count']);
  });

  it('lets `count` win over a param of that name, and skips a nameless param', () => {
    expect(bulkConfirmTemplateRoots({ params: [{ name: 'count' }, {}, null, { name: 'tier' }] })).toEqual(['count', 'tier']);
  });

  it('binds every hole the HotCRM sentences write, and nothing else', () => {
    const roots = bulkConfirmTemplateRoots(def('x'));
    const scope = { slot: "A bulk action's `confirmText`", roots };
    expect(closedScopeTemplateRefusal('Update tier on {{count}} account(s) to {{tier}}?', scope)).toBeUndefined();
    expect(closedScopeTemplateRefusal('将 {{count}} 个客户的等级更新为 {{tier}}？', scope)).toBeUndefined();
    expect(closedScopeTemplateRefusal('Transfer {{count}} account(s) to {{ owner }}?', scope)).toContain('`{{ owner }}`');
  });
});
