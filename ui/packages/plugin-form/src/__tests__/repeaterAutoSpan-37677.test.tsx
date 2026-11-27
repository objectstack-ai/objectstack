/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack-ai/objectstack#37677 — a `repeater` field on `span: 'auto'`
 * takes the whole row of a multi-column record form.
 *
 * `FormFieldSchema.span` (`packages/spec/src/ui/view.zod.ts`) lists repeater
 * among the types that resolve to the full column count. It reached it through
 * the wide `field:grid` widget it used to map to; since objectui#11448 it maps
 * to `field:object`, the JSON editor `json`, `object`, `composite` and `record`
 * share, so the type-only rule gave it one cell. The width is now read off the
 * OBJECT field's type, and the shared widget id stays narrow.
 *
 * The named-form page's twin pin is
 * `apps/console/src/components/FormPage.fieldSpan-37559.test.tsx`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import type { FormField } from '@object-ui/types';
import { registerAllFields, preloadGridField, mapFieldTypeToFormType } from '@object-ui/fields';
import { ModalForm } from '../ModalForm';
import { isWideFieldType, resolveColSpan } from '../autoLayout';

await preloadGridField();
registerAllFields();

const OBJECT_FIELDS = {
  name: { type: 'text', label: 'Name' },
  notes: { type: 'textarea', label: 'Notes' },
  lines: { type: 'repeater', label: 'Lines' },
  payload: { type: 'json', label: 'Payload' },
};

function openEditDialog() {
  const ds = {
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'zoo', fields: OBJECT_FIELDS }),
    findOne: vi.fn().mockResolvedValue({ id: 'z1', name: 'x', lines: [{ a: 1 }], payload: { b: 2 } }),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    update: vi.fn(),
  };
  render(
    <ModalForm
      schema={{
        type: 'object-form',
        formType: 'modal',
        objectName: 'zoo',
        mode: 'edit',
        recordId: 'z1',
        open: true,
        columns: 2,
      } as any}
      dataSource={ds as any}
    />,
  );
}

/** The col-span classes on one rendered row. */
async function spanOf(name: string): Promise<string[]> {
  const row = await waitFor(() => {
    const el = document.querySelector(`[data-field="${name}"]`);
    if (!el) throw new Error(`${name} not rendered`);
    return el;
  });
  return (row.getAttribute('class') || '').split(/\s+/).filter((t) => /(^|:)col-span-/.test(t));
}

describe("objectstack#37677 — a repeater on span 'auto' takes the whole row", () => {
  it('record Edit dialog, 2 columns: the repeater row spans both cells, as the textarea does', async () => {
    openEditDialog();
    expect(await spanOf('lines')).toEqual(['@md:col-span-2']);
    expect(await spanOf('notes')).toEqual(['@md:col-span-2']);
  });

  it('CONTROL — a json field, on the same JSON editor widget, stays one cell; so does a text field', async () => {
    openEditDialog();
    expect(await spanOf('payload')).toEqual([]);
    expect(await spanOf('name')).toEqual([]);
  });

  it('the shared widget id alone is not wide: the width comes from the object-field type', () => {
    expect(mapFieldTypeToFormType('repeater')).toBe('field:object');
    expect(isWideFieldType('field:object')).toBe(false);
    const asWidget = { name: 'lines', type: 'field:object' } as FormField;
    expect(resolveColSpan(asWidget, 3)).toBe(1);
    expect(resolveColSpan({ ...asWidget, field: { type: 'repeater' } }, 3)).toBe(3);
    expect(resolveColSpan({ ...asWidget, field: { type: 'json' } }, 3)).toBe(1);
  });

  it('a raw object-field type (the form designer passes one) is wide on its name', () => {
    expect(resolveColSpan({ name: 'lines', type: 'repeater' } as FormField, 2)).toBe(2);
    // …through the declaration rule, not the type-only answer app-shell's
    // `richtextSurfaceParity` holds equal to plugin-detail's.
    expect(isWideFieldType('repeater')).toBe(false);
  });

  it('CONTROL — an authored colSpan still wins over the repeater default', () => {
    const f = { name: 'lines', type: 'field:object', field: { type: 'repeater' }, colSpan: 1 } as FormField;
    expect(resolveColSpan(f, 3)).toBe(1);
  });
});
