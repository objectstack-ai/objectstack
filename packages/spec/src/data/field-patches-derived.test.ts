// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D10 — `ObjectExtensionSchema.fieldPatches` reads its keys FROM
 * `BASE_FIELD_DISPLAY_WHITELIST`, never from a restated list: widening the
 * whitelist widens the slot.
 *
 * Proven end to end by widening the constant itself (a module mock, file-scoped
 * by vitest) and parsing through the real `ObjectExtensionSchema`: a key the
 * shipped whitelist refuses is accepted once the constant admits it, and the
 * refusal prose names the widened member. `rows` and an option's `color` are
 * the display-only keys the constant's docblock names as candidates that "enter
 * by a recorded decision" — chosen so the widened slot stays a real
 * `FieldSchema` / option key.
 */

import { describe, expect, it, vi } from 'vitest';
// `vi.mock` is hoisted above this import, so the schema is built against the widened constant.
import { ObjectExtensionSchema } from './object.zod';

vi.mock('./field-customization', async (importOriginal) => {
  const original = await importOriginal<typeof import('./field-customization')>();
  return {
    ...original,
    BASE_FIELD_DISPLAY_WHITELIST: Object.freeze({
      field: Object.freeze([...original.BASE_FIELD_DISPLAY_WHITELIST.field, 'rows']),
      option: Object.freeze([...original.BASE_FIELD_DISPLAY_WHITELIST.option, 'color']),
    }),
  };
});

describe('a widened whitelist widens the field patch slot', () => {
  it('accepts a field key only the widened constant admits', () => {
    const r = ObjectExtensionSchema.safeParse({ extend: 'crm_account', fieldPatches: { notes: { rows: 6 } } });
    expect(r.success).toBe(true);
  });

  it('accepts an option key only the widened constant admits', () => {
    const r = ObjectExtensionSchema.safeParse({
      extend: 'crm_account',
      fieldPatches: { industry: { options: { tech: { label: 'Technology', color: '#2563eb' } } } },
    });
    expect(r.success).toBe(true);
  });

  it('takes the widened key\'s value schema from FieldSchema, so a wrong type is still refused', () => {
    const r = ObjectExtensionSchema.safeParse({ extend: 'crm_account', fieldPatches: { notes: { rows: 'six' } } });
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toEqual(['fieldPatches.notes.rows']);
  });

  it('the refusal prose lists the widened member, read from the constant', () => {
    const r = ObjectExtensionSchema.safeParse({ extend: 'crm_account', fieldPatches: { notes: { required: true } } });
    expect(r.success).toBe(false);
    const message = r.success ? '' : r.error.issues[0]!.message;
    expect(message).toContain('`rows`');
    expect(message).toContain('`color`');
  });
});
