/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Selection mode ↔ spec vocabulary parity + behavior (#2941).
 *
 * `SelectionConfigSchema.type` (`ui/view.zod.ts`) publishes three names:
 * `none | single | multiple`. The table used to treat `selectable` as a bare
 * truthy, so a view authored with `selection.type: 'single'` rendered the full
 * multi-select UX — per-row checkboxes that accumulate AND a select-all
 * header. The output looked right and wasn't: `single` was never
 * distinguished from `multiple`.
 *
 * Contract under test:
 * - parity: the table's declared mode set equals the spec enum, both ways;
 * - `single` offers no select-all and replaces the selection on each pick;
 * - `multiple` (and legacy `true`) keeps the accumulate + select-all UX.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SelectionConfigSchema } from '@objectstack/spec/ui';
import { shapeEnumOptions } from '@object-ui/test-support';
import { renderComponent } from './test-utils';
import { SUPPORTED_SELECTION_MODES } from '../renderers/complex/data-table';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

const baseSchema = {
  type: 'data-table' as const,
  columns: [{ header: 'Name', accessorKey: 'name' }],
  data: [
    { id: '1', name: 'Alice' },
    { id: '2', name: 'Bob' },
    { id: '3', name: 'Carol' },
  ],
  pagination: false,
  searchable: false,
};

describe('data-table selection mode covers the spec selection vocabulary', () => {
  const specNames = shapeEnumOptions(SelectionConfigSchema, 'type');

  it('reads a non-empty enum from the spec', () => {
    expect(specNames, 'could not read SelectionConfigSchema.shape.type options from the spec').not.toEqual([]);
  });

  it('implements every selection mode the spec accepts', () => {
    const unimplemented = specNames.filter((name) => !SUPPORTED_SELECTION_MODES.has(name));
    expect(
      unimplemented,
      'these pass schema validation but render an undistinguished selection UX — implement them in data-table',
    ).toEqual([]);
  });

  it('does not accept selection modes the spec rejects', () => {
    const extra = [...SUPPORTED_SELECTION_MODES].filter((name) => !specNames.includes(name));
    expect(
      extra,
      'these are renderer-local dialect — promote them into @objectstack/spec instead',
    ).toEqual([]);
  });
});

describe('data-table selection behavior per mode', () => {
  it("'single' renders no select-all header and replaces the selection on each pick", () => {
    const onSelectionChange = vi.fn();
    const { getAllByRole } = renderComponent({
      ...baseSchema,
      selectable: 'single',
      onSelectionChange,
    } as any);

    // 3 rows → exactly 3 checkboxes; a select-all header would make it 4.
    const checkboxes = getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(3);

    fireEvent.click(checkboxes[0]);
    expect(onSelectionChange).toHaveBeenLastCalledWith([expect.objectContaining({ name: 'Alice' })]);

    // Picking Bob must REPLACE Alice, never accumulate to two rows.
    fireEvent.click(checkboxes[1]);
    expect(onSelectionChange).toHaveBeenLastCalledWith([expect.objectContaining({ name: 'Bob' })]);
  });

  it("'single' allows deselecting the picked row", () => {
    const onSelectionChange = vi.fn();
    const { getAllByRole } = renderComponent({
      ...baseSchema,
      selectable: 'single',
      onSelectionChange,
    } as any);

    const checkboxes = getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[0]);
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it("'multiple' keeps the select-all header and accumulates picks", () => {
    const onSelectionChange = vi.fn();
    const { getAllByRole } = renderComponent({
      ...baseSchema,
      selectable: 'multiple',
      onSelectionChange,
    } as any);

    // 3 rows + the select-all header.
    const checkboxes = getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(4);

    // First checkbox is the header select-all; rows follow.
    fireEvent.click(checkboxes[1]);
    fireEvent.click(checkboxes[2]);
    expect(onSelectionChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ name: 'Alice' }),
      expect.objectContaining({ name: 'Bob' }),
    ]);
  });

  it('legacy `selectable: true` still means multi-select', () => {
    const { getAllByRole } = renderComponent({
      ...baseSchema,
      selectable: true,
    } as any);
    expect(getAllByRole('checkbox')).toHaveLength(4);
  });

  it("'none' renders no selection column", () => {
    const { queryAllByRole } = renderComponent({
      ...baseSchema,
      selectable: 'none',
    } as any);
    expect(queryAllByRole('checkbox')).toHaveLength(0);
  });
});
