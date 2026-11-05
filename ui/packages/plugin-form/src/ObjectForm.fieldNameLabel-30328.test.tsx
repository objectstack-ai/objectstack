// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30328 — a declared field with no `label` reads the same in the
 * form as in the list.
 *
 * `FieldSchema.label` is optional, so a field without one is valid metadata
 * (an object synced from an external datasource declares only `type`). The
 * list draws such a field under its name with the first letter capitalised
 * and underscores as spaces (`part_no` → `Part no`, `objectGridGenerateColumns`
 * in plugin-grid); the form drew the raw name (`part_no`).
 *
 * What is pinned:
 *  - (a) the generated form (no sections) labels a label-less field `Part no`;
 *  - (b) a sectioned form does the same (`fromObjectSchema`);
 *  - (c) CONTROL: an authored label is drawn as authored, in both paths.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from './ObjectForm';
import { fieldNameLabel, fromObjectSchema, type SectionFieldsContext } from './sectionFields';

registerAllFields();

const PARTS_SCHEMA = {
  name: 'spare_parts',
  label: 'Spare Parts',
  fields: {
    part_no: { type: 'text' },
    unit_price: { type: 'number' },
    supplier_code: { type: 'text', label: 'Supplier' },
  },
};

function dataSource() {
  return {
    getObjectSchema: vi.fn().mockResolvedValue(PARTS_SCHEMA),
    create: vi.fn(),
    update: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn().mockResolvedValue({ data: [] }),
  } as any;
}

describe('a label-less field reads the same in the form as in the list (objectstack#30328)', () => {
  it('the rule is the list header rule', () => {
    expect(fieldNameLabel('part_no')).toBe('Part no');
    expect(fieldNameLabel('unit_price')).toBe('Unit price');
    expect(fieldNameLabel('in_stock_qty')).toBe('In stock qty');
  });

  it('(a) the generated form labels a label-less field by the list rule', async () => {
    render(
      <ObjectForm schema={{ type: 'object-form', objectName: 'spare_parts', mode: 'create' }} dataSource={dataSource()} />,
    );
    await waitFor(() => expect(screen.queryByText('Part no')).toBeTruthy());
    expect(screen.getByText('Unit price')).toBeTruthy();
    expect(screen.queryByText('part_no')).toBeNull();
    expect(screen.queryByText('unit_price')).toBeNull();
    // (c) CONTROL: the authored label stays.
    expect(screen.getByText('Supplier')).toBeTruthy();
  });

  it('(b) a sectioned form labels a label-less field by the same rule; (c) an authored label stays', () => {
    const ctx = {
      objectSchema: PARTS_SCHEMA,
      objectName: 'spare_parts',
      fieldLabel: (_object: string, _field: string, fallback: string) => fallback,
    } as unknown as SectionFieldsContext;
    expect(fromObjectSchema('part_no', ctx)?.label).toBe('Part no');
    expect(fromObjectSchema('supplier_code', ctx)?.label).toBe('Supplier');
  });
});
