/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #36806 — the create and edit dialogs read the hand lock: a `uiReadonly`
 * field is left off both dialogs (as `readonly` is) and never rides in the
 * payload a dialog submits, so a UI create falls back to the field's
 * `defaultValue` on the server. A `uiReadonlyWhen` field stays listed — its
 * predicate is judged per record by the form renderer.
 */
import { describe, it, expect } from 'vitest';
import { filterCreateModeFields, filterSystemFields } from '../autoLayout';
import { sanitizeFormData } from '../sanitize';
import { fromObjectSchema, type SectionFieldsContext } from '../sectionFields';
import { deriveColumns, hydrateColumns } from '../deriveMasterDetail';
import type { FormField } from '@object-ui/types';

const objectSchema = {
  fields: {
    title: { type: 'text' },
    status: { type: 'select', uiReadonly: true },
    note: { type: 'text', uiReadonlyWhen: "record.status != 'draft'" },
  },
};
const fields = [
  { name: 'title', type: 'text' },
  { name: 'status', type: 'select' },
  { name: 'note', type: 'text' },
] as FormField[];

describe('dialog hand lock (#36806)', () => {
  it('a uiReadonly field is off the create and the edit dialog; uiReadonlyWhen stays', () => {
    expect(filterCreateModeFields(fields, objectSchema).map((f) => f.name)).toEqual(['title', 'note']);
    expect(filterSystemFields(fields, objectSchema).map((f) => f.name)).toEqual(['title', 'note']);
  });

  it('a uiReadonly field never rides in the submitted payload', () => {
    const out = sanitizeFormData({ title: 'A', status: 'approved', note: 'n' }, objectSchema);
    expect(out).toEqual({ title: 'A', note: 'n' });
  });
});

/**
 * #37402 — the object level: the edit dialog's form fields and the line-item
 * grid's columns carry the EFFECTIVE hand-lock predicate, so the form renderer
 * and the line-item cell (which judge only what a field carries) fold the
 * object's whole-record `uiReadonlyWhen` without reading the object.
 */
describe('the dialog and line-item fields carry the object-level hand lock (#37402)', () => {
  const LOCK = "record.status in ['confirmed', 'done']";
  const order = {
    name: 'order',
    uiReadonlyWhen: LOCK,
    fields: {
      status: { type: 'select' },
      amount: { type: 'number' },
      notes: { type: 'text', uiReadonlyWhen: 'false' },
      parent: { type: 'master_detail', reference: 'head' },
    },
  };
  const ctx = (objectSchema: unknown) => ({
    objectSchema,
    objectName: 'order',
    mode: 'edit',
    fieldLabel: (_o: string, _f: string, fallback: string) => fallback,
  }) as unknown as SectionFieldsContext;

  it('a field that declares no hand lock carries the object predicate; one that does keeps its own', () => {
    expect((fromObjectSchema('amount', ctx(order)) as any)?.uiReadonlyWhen).toBe(LOCK);
    expect((fromObjectSchema('status', ctx(order)) as any)?.uiReadonlyWhen).toBe(LOCK);
    expect((fromObjectSchema('notes', ctx(order)) as any)?.uiReadonlyWhen).toBe('false');
    // The control: the same field of an object without the lock carries none.
    const { uiReadonlyWhen: _drop, ...plain } = order;
    expect((fromObjectSchema('amount', ctx(plain)) as any)?.uiReadonlyWhen).toBeUndefined();
  });

  it('a line-item column carries the CHILD object\'s predicate, derived or authored', () => {
    const derived = deriveColumns(order, { booleanLabel: (v: boolean) => String(v), relationshipField: 'parent' } as never);
    const byName = (cols: any[], n: string) => cols.find((c) => c.name === n);
    expect(byName(derived, 'amount')?.uiReadonlyWhen).toBe(LOCK);
    expect(byName(derived, 'notes')?.uiReadonlyWhen).toBe('false');
    const authored = hydrateColumns([{ name: 'amount', type: 'number' } as never], order, { booleanLabel: (v: boolean) => String(v) } as never);
    expect((authored[0] as any).uiReadonlyWhen).toBe(LOCK);
  });
});
