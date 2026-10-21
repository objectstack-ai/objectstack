// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, expectTypeOf } from 'vitest';
import { ObjectSchema, ObjectExtensionSchema } from './object.zod';
import { Field, FieldSchema } from './field.zod';
import { referenceTargetOf } from './field-value.zod';
import { defineStack } from '../stack.zod';

// ---------------------------------------------------------------------------
// [#24952] A `user` field's target is FIXED to `sys_user` by the type
// (#24808, ruled A on #24854; shipped in an 18.x minor under the amended 「甲」
// ruling). Three halves, pinned together so none can drift from the others:
//
//  - the parse refuses a `user` field whose `reference` names another object,
//    at every door that parses a field map, with the `lookup` spelling in the
//    prescription;
//  - `referenceTargetOf` answers `sys_user` for a `user` field whatever the
//    carrier says (a body that reached it unparsed);
//  - `Field.user()` writes `sys_user` after the config spread.
//
// Controls: the two legal spellings (no `reference`, `reference: 'sys_user'`)
// parse, and a `lookup` on the same object parses.
// ---------------------------------------------------------------------------

const task = (owner: Record<string, unknown>) => ({
  name: 'probe_task',
  fields: { name: { type: 'text', label: 'Name' }, owner },
});

const FOREIGN = { type: 'user', label: 'Owner', reference: 'probe_account' };

describe('a `user` field whose `reference` names another object is refused', () => {
  it('FieldSchema refuses it, located at `reference`, naming the `lookup` spelling', () => {
    const parsed = FieldSchema.safeParse(FOREIGN);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issues = parsed.error.issues.filter((i) => i.path.join('.') === 'reference');
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('custom');
    expect(issues[0].message).toContain('sys_user');
    expect(issues[0].message).toContain("{ type: 'lookup', reference: 'probe_account' }");
    expect(issues[0].message).toContain('deleteBehavior');
  });

  it('ObjectSchema refuses it, at the field path', () => {
    const parsed = ObjectSchema.safeParse(task(FOREIGN));
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((i) => i.path)).toEqual([['fields', 'owner', 'reference']]);
  });

  it('ObjectExtensionSchema refuses it too — an extension cannot merge the shape the object refuses', () => {
    const parsed = ObjectExtensionSchema.safeParse({ extend: 'sys_user_profile', fields: { mentor: FOREIGN } });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((i) => i.path)).toEqual([['fields', 'mentor', 'reference']]);
  });

  it('defineStack refuses it', () => {
    expect(() =>
      defineStack({
        manifest: { id: 'com.example.probe', namespace: 'probe', version: '0.0.1', type: 'app', name: 'Probe' },
        objects: [
          { name: 'probe_account', fields: { name: { type: 'text' } } },
          task(FOREIGN) as never,
        ],
      }),
    ).toThrow(/target is fixed to `sys_user`/);
  });

  it('control: no `reference`, `reference: "sys_user"` and a blank carrier parse', () => {
    for (const owner of [
      { type: 'user', label: 'Owner' },
      { type: 'user', label: 'Owner', reference: 'sys_user' },
      { type: 'user', label: 'Owner', reference: '' },
      Field.user({ label: 'Owner' }),
    ]) {
      const parsed = ObjectSchema.safeParse(task(owner));
      expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    }
  });

  it('control: a `lookup` on the same object — the canonical spelling — parses', () => {
    for (const owner of [{ type: 'lookup', label: 'Owner', reference: 'probe_account' }, Field.lookup('probe_account', { label: 'Owner' })]) {
      const parsed = ObjectSchema.safeParse(task(owner));
      expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    }
  });
});

describe('the target of a `user` field is `sys_user` whatever the carrier says', () => {
  it('referenceTargetOf answers the constant for a foreign carrier', () => {
    expect(referenceTargetOf(FOREIGN)).toBe('sys_user');
  });

  it('Field.user() writes `sys_user` after the spread, and keeps the key in second position', () => {
    // An untyped caller is the only one that can still pass a foreign value.
    const field = Field.user({ label: 'Owner', reference: 'probe_account' as never });
    expect(field.reference).toBe('sys_user');
    expect(Object.keys(field)).toEqual(['type', 'reference', 'label']);
    expect(Object.keys(Field.user({ label: 'Owner' }))).toEqual(['type', 'reference', 'label']);
  });

  it('Field.user() keeps its literal output types (checked by the test typecheck)', () => {
    expectTypeOf(Field.user({ label: 'Owner' }).type).toEqualTypeOf<'user'>();
    expectTypeOf(Field.user({ label: 'Owner' }).reference).toEqualTypeOf<'sys_user'>();
  });
});
