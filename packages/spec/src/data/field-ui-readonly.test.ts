// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36806] The hand lock — `uiReadonly` and `uiReadonlyWhen` — the lower tier
 * of the two-tier field-lock model (ruling record 7180466652): no person edits
 * the field at the console, while API, import, action and flow writes keep it.
 *
 * Both keys are authorable field keys with no default (absent = unlocked), and
 * the one pair refused is `uiReadonly: true` beside `readonly: true`, located
 * at `['uiReadonly']`. `uiReadonlyWhen` beside `readonlyWhen` is accepted. The
 * refusal is asserted as a full `safeParse` failure at the key; every control
 * is a full `safeParse` success, never mere absence of `unrecognized_keys`.
 * The line-item grid's column rule (`deriveInlineGridColumns`) skips a
 * `uiReadonly` child field, as it skips a `readonly` one.
 */

import { describe, expect, it } from 'vitest';
import { FieldSchema } from './field.zod';
import { ObjectSchema } from './object.zod';
import { deriveInlineGridColumns } from './inline-grid-columns';

type Issue = { code: string; path: PropertyKey[]; message: string };

function uiReadonlyIssues(result: { success: boolean; error?: { issues: Issue[] } }): Issue[] {
  if (result.success) return [];
  return (result.error?.issues ?? []).filter((issue) => issue.path[issue.path.length - 1] === 'uiReadonly');
}

describe('Field.uiReadonly / Field.uiReadonlyWhen', () => {
  it('parse, and stay absent when not authored (no default is materialised)', () => {
    const locked = FieldSchema.safeParse({ name: 'status', type: 'text', uiReadonly: true });
    expect(locked.success).toBe(true);
    expect(locked.success && locked.data.uiReadonly).toBe(true);

    const when = FieldSchema.safeParse({ name: 'status', type: 'text', uiReadonlyWhen: "record.stage != 'draft'" });
    expect(when.success).toBe(true);
    expect(when.success && when.data.uiReadonlyWhen).toBeDefined();

    const untouched = FieldSchema.safeParse({ name: 'status', type: 'text' });
    expect(untouched.success).toBe(true);
    expect(untouched.success && ('uiReadonly' in untouched.data || 'uiReadonlyWhen' in untouched.data)).toBe(false);
  });

  it('refuses `uiReadonly: true` beside `readonly: true`, at the key, naming both locks', () => {
    const issues = uiReadonlyIssues(
      FieldSchema.safeParse({ name: 'status', type: 'text', readonly: true, uiReadonly: true }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('custom');
    expect(issues[0].message).toMatch(/^`uiReadonly: true` locks the field against editing by hand at the console/);
  });

  it('refuses the pair through the object door too', () => {
    const parsed = ObjectSchema.safeParse({
      name: 'sales_order',
      fields: { status: { type: 'text', readonly: true, uiReadonly: true } },
    });
    expect(parsed.success).toBe(false);
    expect(uiReadonlyIssues(parsed as never)).toHaveLength(1);
  });

  it('accepts the controls beside the refused pair', () => {
    const controls = [
      { name: 'status', type: 'text', uiReadonly: true },
      { name: 'status', type: 'text', uiReadonly: true, readonly: false },
      { name: 'status', type: 'text', uiReadonly: false, readonly: true },
      // The conditional pair is allowed: the server lock is the stricter one.
      { name: 'status', type: 'text', readonlyWhen: "record.stage == 'paid'", uiReadonlyWhen: "record.stage != 'draft'" },
      { name: 'status', type: 'text', readonly: true, uiReadonlyWhen: "record.stage != 'draft'" },
      { name: 'status', type: 'text', uiReadonly: true, uiReadonlyWhen: "record.stage != 'draft'" },
    ];
    for (const field of controls) {
      const parsed = FieldSchema.safeParse(field);
      expect(parsed.success, JSON.stringify(field)).toBe(true);
    }
  });

  it('the line-item grid skips a `uiReadonly` child field, as it skips a `readonly` one', () => {
    const columns = deriveInlineGridColumns({
      fields: {
        product: { type: 'text' },
        status: { type: 'text', uiReadonly: true },
        locked: { type: 'text', readonly: true },
        note: { type: 'text', uiReadonlyWhen: "record.product == 'x'" },
      },
    } as never);
    const names = columns.map((c: { name: string }) => c.name);
    expect(names).toContain('product');
    expect(names).toContain('note');
    expect(names).not.toContain('status');
    expect(names).not.toContain('locked');
  });
});
