// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

// Read through the `@objectstack/spec/data` entry, not the module: the pin is
// on the PUBLISHED reader `@objectstack/lint` imports.
import { controlledByParentMasterOf, masterDetailRequiredOmitted } from './index';
import { FieldSchema } from './field.zod';
import { ObjectSchema } from './object.zod';
import { defineStack } from '../stack.zod';

/**
 * [ADR-0055 §1 as amended · maintainer ruling A, record 6687830530] A strict
 * `defineStack` reads an omitted `required` on a `controlled_by_parent`
 * object's `master_detail` as the parsed `false` (the optional master, as
 * ruled) and RECORDS the omission on the field it returns, so `os lint` can
 * still report the omitted spelling (#33940). The parsed value, and every
 * reading of it, is unchanged.
 */

const md = (reference: string, extra: Record<string, unknown> = {}) => ({
  type: 'master_detail',
  label: reference,
  reference,
  ...extra,
});

type BuiltField = { required?: boolean };
type BuiltStack = { objects: Array<{ name: string; fields: Record<string, BuiltField> }> };

/** A strict (default) `defineStack` over a header and one detail; returns the detail's fields. */
function detailFields(
  detailFieldsIn: Record<string, unknown>,
  sharingModel: string = 'controlled_by_parent',
  options?: { strict: boolean },
): Record<string, BuiltField> {
  const stack = defineStack(
    {
      manifest: { id: 'com.example.cbp-omission', namespace: 'cbpom', version: '0.0.1', type: 'app', name: 'CBP' },
      objects: [
        { name: 'cbpom_header', label: 'Header', fields: { name: { type: 'text', label: 'Name' } } },
        { name: 'cbpom_other', label: 'Other', fields: { name: { type: 'text', label: 'Name' } } },
        { name: 'cbpom_line', label: 'Line', sharingModel, fields: detailFieldsIn },
      ],
    } as never,
    options,
  ) as unknown as BuiltStack;
  return stack.objects.find((o) => o.name === 'cbpom_line')!.fields;
}

describe('masterDetailRequiredOmitted — defineStack records an omitted cbp master required (#33940)', () => {
  it('the sole master_detail without required: still the parsed optional master, and recorded as omitted', () => {
    const fields = detailFields({ order: md('cbpom_header') });
    // The ruled reading is unchanged: the parse wrote `false`, the optional master.
    expect(fields.order!.required).toBe(false);
    expect(controlledByParentMasterOf(fields)).toEqual({ field: 'order', optional: true });
    // …and the producer recorded what the author wrote.
    expect(masterDetailRequiredOmitted(fields.order)).toBe(true);
  });

  it('records nothing for an explicit required: false (the optional master as written) or required: true', () => {
    expect(masterDetailRequiredOmitted(detailFields({ order: md('cbpom_header', { required: false }) }).order)).toBe(false);
    expect(masterDetailRequiredOmitted(detailFields({ order: md('cbpom_header', { required: true }) }).order)).toBe(false);
  });

  it('records every master_detail that omits required, beside a required master', () => {
    const fields = detailFields({
      order: md('cbpom_header', { required: true }),
      other: md('cbpom_other'),
    });
    expect(masterDetailRequiredOmitted(fields.order)).toBe(false);
    expect(masterDetailRequiredOmitted(fields.other)).toBe(true);
  });

  it('records nothing off controlled_by_parent, and nothing on a field that is not a master_detail', () => {
    expect(masterDetailRequiredOmitted(detailFields({ order: md('cbpom_header') }, 'private').order)).toBe(false);
    const fields = detailFields({
      order: md('cbpom_header', { required: true }),
      ref: { type: 'lookup', label: 'Ref', reference: 'cbpom_other' },
    });
    expect(masterDetailRequiredOmitted(fields.ref)).toBe(false);
  });

  it('a non-strict defineStack records nothing: its field still lacks the key, as written', () => {
    const fields = detailFields({ order: md('cbpom_header') }, 'controlled_by_parent', { strict: false });
    expect(fields.order!.required).toBeUndefined();
    expect(masterDetailRequiredOmitted(fields.order)).toBe(false);
  });

  it('is invisible to every data reader, and a copy drops it (the pre-record reading)', () => {
    const field = detailFields({ order: md('cbpom_header') }).order!;
    expect(masterDetailRequiredOmitted(field)).toBe(true);
    expect(Object.keys(field)).not.toContain('masterDetailRequiredOmitted');
    expect(JSON.parse(JSON.stringify(field))).toEqual({ ...field });
    expect(masterDetailRequiredOmitted({ ...field })).toBe(false);
    expect(masterDetailRequiredOmitted(JSON.parse(JSON.stringify(field)))).toBe(false);
    // The strict field schema still accepts the built field: the record is no key.
    expect(FieldSchema.safeParse(field).success).toBe(true);
  });

  it('answers false for anything a producer did not stamp', () => {
    for (const value of [undefined, null, 'x', 1, {}, md('x'), md('x', { required: false })]) {
      expect(masterDetailRequiredOmitted(value)).toBe(false);
    }
    // ObjectSchema.safeParse alone is not the producer: it records nothing.
    const parsed = ObjectSchema.safeParse({
      name: 'cbpom_line', label: 'Line', sharingModel: 'controlled_by_parent', fields: { order: md('cbpom_header') },
    });
    expect(parsed.success).toBe(true);
    expect(masterDetailRequiredOmitted(parsed.data!.fields.order)).toBe(false);
  });
});
