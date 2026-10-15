// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { FieldSchema } from './field.zod';
import { ObjectSchema } from './object.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { ObjectStackDefinitionSchema } from '../stack.zod';

// ---------------------------------------------------------------------------
// [objectui#12489 ruling 6203737086, letter A] `referenceDeletedWhen:
// { field, value }` rides beside `referenceVia`: on rows where the sibling
// `select` field `field` holds the option `value`, the record the pointer names
// was deleted by the platform. Any other shape is refused at parse:
//
//  - field half (`FieldSchema`): the key without `referenceVia`, an unknown
//    key inside the predicate, a non-snake_case `field`;
//  - sibling half (`ObjectSchema`): `field` naming itself, nothing, a
//    non-`select`, a `multiple: true` select, a select with no inline
//    `options`; `value` naming no declared option.
//
// The pins bear weight in both directions: the producer's own shape
// (`sys_approval_request.record_id` with `cancel_reason` / `record_deleted`)
// parses clean, and each refused shape is ONE located `custom` issue naming
// the field and the option an author greps for — never the prose around them.
// ---------------------------------------------------------------------------

const CANCEL_OPTIONS = [{ label: 'Related record deleted', value: 'record_deleted' }];

const request = (
  predicate: unknown,
  overrides: Record<string, unknown> = {},
) => ({
  name: 'sys_approval_request',
  fields: {
    object_name: { type: 'text', label: 'Object' },
    record_id: {
      type: 'text',
      label: 'Record ID',
      referenceVia: 'object_name',
      ...(predicate === undefined ? {} : { referenceDeletedWhen: predicate }),
    },
    cancel_reason: { type: 'select', label: 'Cancellation Reason', options: CANCEL_OPTIONS },
    status: { type: 'text', label: 'Status' },
    ...overrides,
  },
});

/** The one issue a refused object must carry, located under the predicate. */
function refusedAt(input: unknown, leaf: 'field' | 'value') {
  const parsed = ObjectSchema.safeParse(input);
  expect(parsed.success, 'the declaration must NOT parse clean').toBe(false);
  if (parsed.success) throw new Error('unreachable');
  expect(parsed.error.issues.map((i) => [i.code, i.path])).toEqual([
    ['custom', ['fields', 'record_id', 'referenceDeletedWhen', leaf]],
  ]);
  return parsed.error.issues[0];
}

describe('`referenceDeletedWhen` — field half (FieldSchema)', () => {
  it('accepts the predicate beside `referenceVia` (control)', () => {
    const parsed = FieldSchema.safeParse({
      type: 'text',
      referenceVia: 'object_name',
      referenceDeletedWhen: { field: 'cancel_reason', value: 'record_deleted' },
    });
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.referenceDeletedWhen).toEqual({ field: 'cancel_reason', value: 'record_deleted' });
  });

  it('leaves the key absent when it is not authored (control)', () => {
    const parsed = FieldSchema.safeParse({ type: 'text', referenceVia: 'object_name' });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect('referenceDeletedWhen' in parsed.data).toBe(false);
  });

  it('refuses the predicate on a field that declares no `referenceVia`, naming the field and the option', () => {
    const parsed = FieldSchema.safeParse({
      type: 'text',
      referenceDeletedWhen: { field: 'cancel_reason', value: 'record_deleted' },
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((i) => [i.code, i.path])).toEqual([['custom', ['referenceDeletedWhen']]]);
    expect(parsed.error.issues[0].message).toContain('referenceVia');
    expect(parsed.error.issues[0].message).toContain('cancel_reason');
    expect(parsed.error.issues[0].message).toContain('record_deleted');
  });

  it('refuses an unknown key inside the predicate (closed shape)', () => {
    const parsed = FieldSchema.safeParse({
      type: 'text',
      referenceVia: 'object_name',
      referenceDeletedWhen: { field: 'cancel_reason', value: 'record_deleted', label: 'Deleted' },
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((i) => i.path)).toEqual([['referenceDeletedWhen']]);
    expect(parsed.error.issues[0].message).toContain('label');
  });

  it('refuses a predicate missing `value`, and a non-snake_case `field`', () => {
    const missing = FieldSchema.safeParse({
      type: 'text',
      referenceVia: 'object_name',
      referenceDeletedWhen: { field: 'cancel_reason' },
    });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.issues.map((i) => i.path)).toEqual([['referenceDeletedWhen', 'value']]);

    const badName = FieldSchema.safeParse({
      type: 'text',
      referenceVia: 'object_name',
      referenceDeletedWhen: { field: 'CancelReason', value: 'record_deleted' },
    });
    expect(badName.success).toBe(false);
    if (!badName.success) expect(badName.error.issues.map((i) => i.path)).toEqual([['referenceDeletedWhen', 'field']]);
  });
});

describe('`referenceDeletedWhen` — sibling half (ObjectSchema)', () => {
  it("accepts the producer's own shape: `cancel_reason` / `record_deleted` (control)", () => {
    const parsed = ObjectSchema.safeParse(request({ field: 'cancel_reason', value: 'record_deleted' }));
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.fields.record_id.referenceDeletedWhen).toEqual({
      field: 'cancel_reason',
      value: 'record_deleted',
    });
  });

  it('refuses a `field` naming the declaring field itself', () => {
    const issue = refusedAt(request({ field: 'record_id', value: 'record_deleted' }), 'field');
    expect(issue.message).toContain('record_id');
  });

  it('refuses a `field` the object does not declare, naming it', () => {
    const issue = refusedAt(request({ field: 'cancel_reasn', value: 'record_deleted' }), 'field');
    expect(issue.message).toContain('cancel_reasn');
  });

  it('refuses a sibling that is not a `select`, naming its type', () => {
    const issue = refusedAt(request({ field: 'status', value: 'record_deleted' }), 'field');
    expect(issue.message).toContain('status');
    expect(issue.message).toContain('`text`');
  });

  it('refuses a `multiple: true` select sibling', () => {
    const issue = refusedAt(
      request({ field: 'cancel_reason', value: 'record_deleted' }, {
        cancel_reason: { type: 'select', label: 'Reasons', multiple: true, options: CANCEL_OPTIONS },
      }),
      'field',
    );
    expect(issue.message).toContain('multiple: true');
  });

  it('refuses a `picklist`-backed select sibling with no inline options', () => {
    const issue = refusedAt(
      request({ field: 'cancel_reason', value: 'record_deleted' }, {
        cancel_reason: { type: 'select', label: 'Reasons', picklist: 'cancel_reasons' },
      }),
      'field',
    );
    expect(issue.message).toContain('options');
    expect(issue.message).toContain('record_deleted');
  });

  it('refuses a `value` that is not one of the sibling options, naming the option and the declared set', () => {
    const issue = refusedAt(request({ field: 'cancel_reason', value: 'deleted' }), 'value');
    expect(issue.message).toContain('`deleted`');
    expect(issue.message).toContain('cancel_reason');
    expect(issue.message).toContain('`record_deleted`');
  });

  it('`create()` refuses it too — the builder parses through the same door', () => {
    expect(() => ObjectSchema.create(request({ field: 'cancel_reason', value: 'deleted' }) as never)).toThrow(
      /referenceDeletedWhen/,
    );
    const created = ObjectSchema.create(request({ field: 'cancel_reason', value: 'record_deleted' }) as never);
    expect(created.fields.record_id.referenceDeletedWhen).toEqual({ field: 'cancel_reason', value: 'record_deleted' });
  });

  it('the save door (`object` metadata schema) refuses it at the same path', () => {
    const schema = getMetadataTypeSchema('object');
    expect(schema).toBeDefined();
    const bad = schema!.safeParse(request({ field: 'cancel_reason', value: 'deleted' }));
    expect(bad.success).toBe(false);
    if (bad.success) return;
    expect(bad.error.issues.map((i) => [i.code, i.path])).toEqual([
      ['custom', ['fields', 'record_id', 'referenceDeletedWhen', 'value']],
    ]);
    expect(schema!.safeParse(request({ field: 'cancel_reason', value: 'record_deleted' })).success).toBe(true);
  });

  it('the stack door refuses it inside `objects`, located at the predicate', () => {
    const manifest = {
      id: 'com.example.refdeleted',
      name: 'reference-deleted-when-test',
      version: '1.0.0',
      type: 'app' as const,
      namespace: 'crm',
    };
    const bad = ObjectStackDefinitionSchema.safeParse({
      manifest,
      objects: [request({ field: 'status', value: 'record_deleted' })],
    });
    expect(bad.success).toBe(false);
    if (bad.success) return;
    expect(bad.error.issues.map((i) => [i.code, i.path])).toEqual([
      ['custom', ['objects', 0, 'fields', 'record_id', 'referenceDeletedWhen', 'field']],
    ]);
  });
});
