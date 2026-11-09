// #30259 — `ActionParamSchema.widget`: an action param can name the widget that
// draws it, with the same key, vocabulary and meaning as `FieldSchema.widget`.
// The case that asked for it is the permission-set picker ADR-0131 D4 gives the
// grant column `sys_user_permission_set.permission_set` (`widget:
// 'permission-ref'`): before this key no param could ask for that picker, so
// Create User's `permissionSet` param was a box for a typed machine name
// (#30117).
//
// These pins hold the widening: a param that declares the key parses and keeps
// it; an unregistered name is KEPT, exactly as the field key keeps it (both
// degrade to the `type` renderer at draw time); a non-string is refused; and a
// param that does not declare the key parses exactly as it did before.
import { describe, it, expect } from 'vitest';
import { ActionParamSchema } from './action.zod';
import { FieldSchema } from '../data/field.zod';

describe('ActionParamSchema.widget — a param names the widget that draws it (#30259)', () => {
  it('accepts permission-ref on an inline text param and keeps it, with `type` unchanged', () => {
    const r = ActionParamSchema.safeParse({
      name: 'permissionSet',
      label: 'Permission Set',
      type: 'text',
      widget: 'permission-ref',
    });
    expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    if (!r.success) return;
    expect(r.data.widget).toBe('permission-ref');
    // `type` stays the VALUE's type: the widget changes how it is picked only.
    expect(r.data.type).toBe('text');
  });

  it('accepts the key on a field-backed param (an authored override, as every inline value is)', () => {
    const r = ActionParamSchema.safeParse({ field: 'permission_set', widget: 'permission-ref' });
    expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    if (!r.success) return;
    expect(r.data.widget).toBe('permission-ref');
  });

  it('is a declared key, not an unrecognized one', () => {
    const r = ActionParamSchema.safeParse({ name: 'p', type: 'text', widget: 'permission-ref' });
    const issues = r.success ? [] : r.error.issues;
    expect(issues.filter((i) => i.code === 'unrecognized_keys')).toEqual([]);
  });

  describe('value — an open string, matching FieldSchema.widget', () => {
    // The field key is `z.string().optional()`: an unregistered name is kept and
    // the renderer falls back to the `type` default. The param key makes the same
    // promise, so each value below must get the same verdict on both surfaces.
    const values: unknown[] = ['permission-ref', 'position-ref', 'object-ref', 'no-such-widget', 42, true, null];

    for (const value of values) {
      it(`gives ${JSON.stringify(value)} the verdict the field key gives it`, () => {
        const onParam = ActionParamSchema.safeParse({ name: 'p', type: 'text', widget: value });
        const onField = FieldSchema.safeParse({ name: 'p', type: 'text', widget: value });
        expect(onParam.success).toBe(onField.success);
        if (onParam.success && onField.success) {
          expect(onParam.data.widget).toBe(value);
          expect(onField.data.widget).toBe(value);
        }
      });
    }

    it('keeps an unregistered name rather than refusing it (it degrades at draw time)', () => {
      const r = ActionParamSchema.safeParse({ name: 'p', type: 'text', widget: 'no-such-widget' });
      expect(r.success).toBe(true);
      if (!r.success) return;
      expect(r.data.widget).toBe('no-such-widget');
    });

    it('refuses a non-string on the widget path', () => {
      const r = ActionParamSchema.safeParse({ name: 'p', type: 'text', widget: 42 });
      expect(r.success).toBe(false);
      if (r.success) return;
      expect(r.error.issues.some((i) => i.path.join('.') === 'widget' && i.code === 'invalid_type')).toBe(true);
    });
  });

  describe('existing params parse unchanged', () => {
    const existing: Array<Record<string, unknown>> = [
      // Create User's param as it stands on main (sys-user.object.ts): inline text.
      { name: 'permissionSet', label: 'Permission Set', type: 'text', required: false },
      { field: 'email' },
      { field: 'role', objectOverride: 'sys_member' },
      { name: 'inspector', label: 'Inspector', type: 'lookup', reference: 'sys_user' },
      { name: 'tier', type: 'select', options: [{ label: 'Gold', value: 'gold' }] },
    ];

    for (const param of existing) {
      it(`parses ${JSON.stringify(param)} with no widget member added`, () => {
        const r = ActionParamSchema.safeParse(param);
        expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
        if (!r.success) return;
        expect('widget' in r.data).toBe(false);
      });
    }
  });
});
