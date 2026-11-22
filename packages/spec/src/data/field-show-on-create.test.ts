// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `showOnCreate` — whether a field is asked for when a record is created.
 *
 * The key is an authorable field key (absent = asked for), and the one pair it
 * cannot form is `showOnCreate: false` beside `required: true`: every create
 * surface would leave the field out and the write door would refuse every
 * insert without it. The refusal is asserted as a full `safeParse` failure
 * located at `['showOnCreate']`; every control is a full `safeParse` success,
 * never mere absence of `unrecognized_keys`.
 */

import { describe, expect, it } from 'vitest';
import { FieldSchema } from './field.zod';
import { ObjectSchema } from './object.zod';

type Issue = { code: string; path: PropertyKey[]; message: string };

function showOnCreateIssues(result: { success: boolean; error?: { issues: Issue[] } }): Issue[] {
  if (result.success) return [];
  return (result.error?.issues ?? []).filter((issue) => issue.path[issue.path.length - 1] === 'showOnCreate');
}

describe('Field.showOnCreate', () => {
  it('parses on an optional field, switched off or on, and stays absent when not authored', () => {
    for (const showOnCreate of [false, true]) {
      const parsed = FieldSchema.safeParse({ name: 'notes', type: 'text', showOnCreate });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.showOnCreate).toBe(showOnCreate);
    }
    const untouched = FieldSchema.safeParse({ name: 'notes', type: 'text' });
    expect(untouched.success).toBe(true);
    expect(untouched.success && 'showOnCreate' in untouched.data).toBe(false);
  });

  it('refuses `showOnCreate: false` on a `required: true` field, at the key, naming both remedies', () => {
    const issues = showOnCreateIssues(
      FieldSchema.safeParse({ name: 'amount', type: 'number', required: true, showOnCreate: false }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('custom');
    expect(issues[0].message).toMatch(/^`showOnCreate: false` leaves this field off every create surface/);
  });

  it('refuses the pair when the field declares a `defaultValue` too', () => {
    const issues = showOnCreateIssues(
      FieldSchema.safeParse({ name: 'stage', type: 'text', required: true, defaultValue: 'new', showOnCreate: false }),
    );
    expect(issues).toHaveLength(1);
  });

  it('accepts the controls beside the refused pair', () => {
    const controls = [
      { name: 'amount', type: 'number', required: true, showOnCreate: true },
      { name: 'amount', type: 'number', required: true },
      { name: 'amount', type: 'number', required: false, showOnCreate: false },
      // A conditional requirement is a predicate the parse cannot judge: the
      // write door still refuses a create born inside it.
      { name: 'amount', type: 'number', requiredWhen: "record.stage == 'won'", showOnCreate: false },
    ];
    for (const field of controls) {
      expect(FieldSchema.safeParse(field).success, JSON.stringify(field)).toBe(true);
    }
  });

  it('refuses the pair through the object door too, located under the field', () => {
    const result = ObjectSchema.safeParse({
      name: 'deal',
      label: 'Deal',
      fields: {
        name: { type: 'text', label: 'Name' },
        amount: { type: 'number', label: 'Amount', required: true, showOnCreate: false },
      },
    });
    const issues = showOnCreateIssues(result as never);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['fields', 'amount', 'showOnCreate']);
  });
});
