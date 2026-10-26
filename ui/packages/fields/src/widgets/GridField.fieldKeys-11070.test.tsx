/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The grid widget's FIELD-level keys: one spelling each, and that spelling is
 * the one `GridFieldMetadata` (`@object-ui/types`) declares (objectui#11070,
 * rounds 8 and 9). objectui#11610 renamed the eight keys to camelCase; this
 * file uses the new spellings, and the retired snake_case ones are pinned in
 * `GridField.retiredSnakeKeys-11610.test.tsx`.
 *
 * Before this round the published type and the widget disagreed in both
 * directions: `GridFieldMetadata.allow_reorder` was declared and taught by the
 * docs while the widget read `reorderable`, so `allow_reorder: false` still
 * drew a drag handle on every row; the total was read under three spellings
 * (`total_field`, `amount_field`, `amountField`); and four keys were read that
 * no face declared (`allow_duplicate`, `show_line_numbers`, `add_label` and
 * `sort_field`). Round 8 settled the first three; round 9 declared
 * `sort_field`, the last read key no face declared.
 *
 * What each block pins:
 *
 *   - reorder — `allowReorder: false` removes the drag handle from every row,
 *     against a no-key control that draws one per row; the retired
 *     `reorderable` changes nothing;
 *   - total — `totalField` names the CHILD column summed into the footer
 *     (the spec's `amountField`, not the PARENT field the spec's own
 *     `totalField` names); `amount_field` and `amountField` change nothing;
 *   - `addLabel` — declared, and it labels the Add button;
 *   - `sortField` — declared (round 9): it names the CHILD field each row is
 *     stamped with its index in, on every change that adds, removes or moves a
 *     row, so a drag-reorder persists; with no key the rows carry no position
 *     (a cell edit leaves positions alone: `GridField.sortFieldCellEdit-12286`);
 *   - `allow_duplicate` and `show_line_numbers` — retired under ADR-0049 (no
 *     producer in either repository wrote them): the widget keeps the
 *     behaviour their defaults gave, a duplicate action whenever rows can be
 *     added and a line-number column always.
 *
 * Every fixture is typed `GridFieldMetadata`, so `tsc -p tsconfig.test.json`
 * (this package's `type-check`) also holds the declared key set: a declared
 * key that stopped being a member reddens the fixture that writes it, and a
 * retired key that came back as a member reddens its `@ts-expect-error`.
 * A retired key reaches the widget only through a cast, which is how a
 * document the compiler never saw would reach it.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import type { GridFieldMetadata } from '@object-ui/types';
import { GridField } from './GridField';

const columns: NonNullable<GridFieldMetadata['columns']> = [
  { name: 'description', label: 'Description', type: 'text' },
  { name: 'amount', label: 'Amount', type: 'currency' },
];

const rows = [
  { description: 'A', amount: 10 },
  { description: 'B', amount: 20 },
];

/** A grid field as `GridFieldMetadata` declares it, plus the keys under test. */
function grid(keys: Partial<Omit<GridFieldMetadata, 'type' | 'name' | 'columns'>> = {}): GridFieldMetadata {
  return { type: 'grid', name: 'lines', columns, ...keys };
}

/** A key the type does not declare, reaching the widget the way an unchecked document would. */
function withUndeclared(extra: Record<string, unknown>): GridFieldMetadata {
  return { ...grid(), ...extra } as GridFieldMetadata;
}

function show(field: GridFieldMetadata) {
  return render(<GridField value={rows} onChange={() => {}} field={field} />);
}

const dragHandles = () => screen.queryAllByTestId(/^line-items-drag-/).length;

describe('GridField field-level keys: the declared spelling is the read spelling (objectui#11070 round 8)', () => {
  describe('reorder: `allowReorder`', () => {
    it('CONTROL: with no key, every row draws a drag handle', () => {
      show(grid());
      expect(dragHandles()).toBe(rows.length);
    });

    it('`allowReorder: false` draws no drag handle on any row', () => {
      show(grid({ allowReorder: false }));
      expect(dragHandles()).toBe(0);
    });

    it('the retired `reorderable` is not read: `reorderable: false` still draws every handle', () => {
      show(withUndeclared({ reorderable: false }));
      expect(dragHandles()).toBe(rows.length);
    });
  });

  describe('total: `totalField` names the child column summed', () => {
    it('`totalField` shows the footer total of that child column', () => {
      show(grid({ totalField: 'amount' }));
      expect(screen.getByTestId('line-items-total').textContent).toContain('30');
    });

    it('CONTROL: with no key there is no footer total', () => {
      show(grid());
      expect(screen.queryByTestId('line-items-total')).toBeNull();
    });

    it.each(['amount_field', 'amountField'])('the retired `%s` is not read: no footer total', (key) => {
      show(withUndeclared({ [key]: 'amount' }));
      expect(screen.queryByTestId('line-items-total')).toBeNull();
    });
  });

  describe('`addLabel`', () => {
    it('labels the Add button', () => {
      show(grid({ addLabel: 'Add invoice line' }));
      expect(screen.getByTestId('line-items-add').textContent).toContain('Add invoice line');
    });
  });

  describe('`sortField`: the child field stamped with each row\'s index (objectui#11070 round 9)', () => {
    /** Drag the second row onto the first, and return the rows the change handed back. */
    function dragSecondOntoFirst(field: GridFieldMetadata): Array<Record<string, unknown>> {
      const onChange = vi.fn();
      render(<GridField value={rows} onChange={onChange} field={field} />);
      const target = screen.getByTestId('line-items-drag-0').closest('tr')!;
      fireEvent.dragStart(screen.getByTestId('line-items-drag-1'));
      fireEvent.dragOver(target);
      fireEvent.drop(target);
      expect(onChange).toHaveBeenCalledTimes(1);
      return onChange.mock.calls[0][0];
    }

    it('`sortField` stamps each row with its new index after a drag-reorder', () => {
      const next = dragSecondOntoFirst(grid({ sortField: 'position' }));
      expect(next.map((r) => [r.description, r.position])).toEqual([
        ['B', 0],
        ['A', 1],
      ]);
    });

    it('CONTROL: with no key the reorder still lands, and no row carries a position', () => {
      const next = dragSecondOntoFirst(grid());
      expect(next.map((r) => r.description)).toEqual(['B', 'A']);
      expect(next.every((r) => !('position' in r))).toBe(true);
    });
  });

  describe('`allow_duplicate` is retired: duplicate follows whether rows can be added', () => {
    it('`allow_duplicate: false` is not read: each row keeps its duplicate action', () => {
      show(withUndeclared({ allow_duplicate: false }));
      expect(screen.queryAllByTestId(/^line-items-duplicate-/)).toHaveLength(rows.length);
    });

    it('CONTROL: `allowAdd: false` removes the duplicate action with the Add action', () => {
      show(grid({ allowAdd: false }));
      expect(screen.queryAllByTestId(/^line-items-duplicate-/)).toHaveLength(0);
    });
  });

  describe('`show_line_numbers` is retired: the line-number column always shows', () => {
    it('`show_line_numbers: false` is not read: the `#` column stays', () => {
      show(withUndeclared({ show_line_numbers: false }));
      expect(screen.getByRole('columnheader', { name: '#' })).toBeTruthy();
    });
  });
});

// ── The declared key set, held by the compiler (`tsc -p tsconfig.test.json`) ──

/** Every field-level key the widget reads, each typed as `GridFieldMetadata` declares it. */
const declared: GridFieldMetadata = {
  type: 'grid',
  name: 'lines',
  columns,
  minRows: 1,
  maxRows: 50,
  allowAdd: true,
  allowDelete: true,
  allowReorder: false,
  totalField: 'amount',
  addLabel: 'Add line',
  sortField: 'position',
};
void declared;

// @ts-expect-error objectui#11070 round 8: `reorderable` is retired; the reorder key is `allowReorder`.
const retiredReorderable: GridFieldMetadata = { type: 'grid', name: 'lines', reorderable: false };
// @ts-expect-error objectui#11070 round 8: `amount_field` is retired; the summed child column is `totalField`.
const retiredAmountSnake: GridFieldMetadata = { type: 'grid', name: 'lines', amount_field: 'amount' };
// @ts-expect-error objectui#11070 round 8: `amountField` is retired on the widget; the summed child column is `totalField`.
const retiredAmountCamel: GridFieldMetadata = { type: 'grid', name: 'lines', amountField: 'amount' };
// @ts-expect-error objectui#11070 round 8: `allow_duplicate` is retired (ADR-0049); duplicate follows `allowAdd`.
const retiredDuplicate: GridFieldMetadata = { type: 'grid', name: 'lines', allow_duplicate: false };
// @ts-expect-error objectui#11070 round 8: `show_line_numbers` is retired (ADR-0049); the line-number column always shows.
const retiredLineNumbers: GridFieldMetadata = { type: 'grid', name: 'lines', show_line_numbers: false };
void [retiredReorderable, retiredAmountSnake, retiredAmountCamel, retiredDuplicate, retiredLineNumbers];
