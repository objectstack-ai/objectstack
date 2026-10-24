/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The grid widget's eight field-level keys draw under their camelCase names,
 * and a field still carrying a retired snake_case spelling is REFUSED BY NAME
 * instead of drawn (objectui#11610).
 *
 * objectui#11610 renamed `min_rows`, `max_rows`, `allow_add`, `allow_delete`,
 * `allow_reorder`, `total_field`, `add_label` and `sort_field` to `minRows`,
 * `maxRows`, `allowAdd`, `allowDelete`, `allowReorder`, `totalField`,
 * `addLabel` and `sortField`, with no dual read. The widget is the third face
 * of that retirement (the type's tombstones and the zod mirror's alias
 * refusals are pinned in `packages/types`): a snake_case key reaching it
 * through a document the compiler and the validator never saw must not be
 * dropped in silence, because a grid drawn without the author's
 * `allow_add: false` looks like it worked.
 *
 * What each block pins, all through the real `GridField`:
 *
 *   1. each camelCase key changes what the grid draws, against a lit control
 *      without the key (the minimum rows lock Remove, the maximum locks Add,
 *      the three switches remove their controls, the total shows, the label
 *      shows, the sort field stamps positions);
 *   2. each snake_case key, alone, draws the named refusal INSTEAD of the
 *      grid: an alert naming the retired key and its camelCase replacement,
 *      and the same text once on `console.error`; the rows are untouched;
 *   3. the refusal's edges: several keys in one alert, a key holding
 *      `undefined` is not refused (no JSON document carries one, and the TS
 *      and zod faces accept it too), and a refused grid that mounts twice
 *      logs once.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { GRID_FIELD_RETIRED_KEYS, type GridFieldMetadata, type GridFieldRetiredKey } from '@object-ui/types';
import { GridField } from './GridField';

const columns: NonNullable<GridFieldMetadata['columns']> = [
  { name: 'description', label: 'Description', type: 'text' },
  { name: 'amount', label: 'Amount', type: 'currency' },
];

const rows = [
  { description: 'A', amount: 10 },
  { description: 'B', amount: 20 },
];

function grid(keys: Partial<Omit<GridFieldMetadata, 'type' | 'name' | 'columns'>> = {}, name = 'lines'): GridFieldMetadata {
  return { type: 'grid', name, columns, ...keys };
}

/** A field carrying a retired key, reaching the widget the way a document the compiler never saw would. */
function withRetired(extra: Record<string, unknown>, name = 'lines'): GridFieldMetadata {
  return { ...grid({}, name), ...extra } as GridFieldMetadata;
}

function show(field: GridFieldMetadata, onChange: (next: unknown) => void = () => {}) {
  return render(<GridField value={rows} onChange={onChange} field={field} />);
}

const removeButtons = () => screen.queryAllByTestId(/^line-items-remove-/) as HTMLButtonElement[];
const duplicateButtons = () => screen.queryAllByTestId(/^line-items-duplicate-/) as HTMLButtonElement[];
const dragHandles = () => screen.queryAllByTestId(/^line-items-drag-/);
const addButton = () => screen.queryByTestId('line-items-add') as HTMLButtonElement | null;

/** Drag the second row onto the first, and return the rows the change handed back. */
function dragSecondOntoFirst(field: GridFieldMetadata): Array<Record<string, unknown>> {
  const onChange = vi.fn();
  show(field, onChange);
  const target = screen.getByTestId('line-items-drag-0').closest('tr')!;
  fireEvent.dragStart(screen.getByTestId('line-items-drag-1'));
  fireEvent.dragOver(target);
  fireEvent.drop(target);
  expect(onChange).toHaveBeenCalledTimes(1);
  return onChange.mock.calls[0][0];
}

describe('objectui#11610 — the eight camelCase keys draw', () => {
  it('`minRows`: at the minimum, every Remove action is disabled (control: no key, all enabled)', () => {
    const { unmount } = show(grid());
    expect(removeButtons()).toHaveLength(rows.length);
    expect(removeButtons().every((b) => !b.disabled), 'CONTROL').toBe(true);
    unmount();
    show(grid({ minRows: rows.length }));
    expect(removeButtons()).toHaveLength(rows.length);
    expect(removeButtons().every((b) => b.disabled)).toBe(true);
  });

  it('`maxRows`: at the maximum, Add and every Duplicate are disabled (control: no key, all enabled)', () => {
    const { unmount } = show(grid());
    expect(addButton()!.disabled, 'CONTROL').toBe(false);
    expect(duplicateButtons().every((b) => !b.disabled), 'CONTROL').toBe(true);
    unmount();
    show(grid({ maxRows: rows.length }));
    expect(addButton()!.disabled).toBe(true);
    expect(duplicateButtons()).toHaveLength(rows.length);
    expect(duplicateButtons().every((b) => b.disabled)).toBe(true);
  });

  it('`allowAdd: false` removes Add and every Duplicate (control: no key, both drawn)', () => {
    const { unmount } = show(grid());
    expect(addButton(), 'CONTROL').not.toBeNull();
    expect(duplicateButtons(), 'CONTROL').toHaveLength(rows.length);
    unmount();
    show(grid({ allowAdd: false }));
    expect(addButton()).toBeNull();
    expect(duplicateButtons()).toHaveLength(0);
  });

  it('`allowDelete: false` removes every Remove action (control: no key, one per row)', () => {
    const { unmount } = show(grid());
    expect(removeButtons(), 'CONTROL').toHaveLength(rows.length);
    unmount();
    show(grid({ allowDelete: false }));
    expect(removeButtons()).toHaveLength(0);
  });

  it('`allowReorder: false` removes every drag handle (control: no key, one per row)', () => {
    const { unmount } = show(grid());
    expect(dragHandles(), 'CONTROL').toHaveLength(rows.length);
    unmount();
    show(grid({ allowReorder: false }));
    expect(dragHandles()).toHaveLength(0);
  });

  it('`totalField` shows the footer total of that child column (control: no key, no total)', () => {
    const { unmount } = show(grid());
    expect(screen.queryByTestId('line-items-total'), 'CONTROL').toBeNull();
    unmount();
    show(grid({ totalField: 'amount' }));
    expect(screen.getByTestId('line-items-total').textContent).toContain('30');
  });

  it('`addLabel` labels the Add button (control: no key, the locale default)', () => {
    const { unmount } = show(grid());
    expect(addButton()!.textContent, 'CONTROL').toBe('Add line');
    unmount();
    show(grid({ addLabel: 'Add invoice line' }));
    expect(addButton()!.textContent).toBe('Add invoice line');
  });

  it('`sortField` stamps each row with its index after a drag-reorder (control: no key, no position)', () => {
    const control = dragSecondOntoFirst(grid());
    expect(control.map((r) => r.description), 'CONTROL: the reorder lands').toEqual(['B', 'A']);
    expect(control.every((r) => !('position' in r)), 'CONTROL').toBe(true);
    document.body.innerHTML = '';
    const next = dragSecondOntoFirst(grid({ sortField: 'position' }));
    expect(next.map((r) => [r.description, r.position])).toEqual([
      ['B', 0],
      ['A', 1],
    ]);
  });
});

/** A value each snake_case key used to carry: the camelCase key's declared type. */
const VALUE: Record<GridFieldRetiredKey, unknown> = {
  min_rows: 1,
  max_rows: 20,
  allow_add: false,
  allow_delete: false,
  allow_reorder: false,
  total_field: 'amount',
  add_label: 'Add line',
  sort_field: 'position',
};
const RETIRED = Object.entries(GRID_FIELD_RETIRED_KEYS) as Array<[GridFieldRetiredKey, string]>;

describe('objectui#11610 — a retired snake_case key is refused by name, never dropped', () => {
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    error.mockRestore();
  });

  it('LIT CONTROL: the same field with no retired key draws the grid and logs nothing', () => {
    show(grid({}, 'lit-control'));
    expect(screen.getByTestId('line-items')).toBeTruthy();
    expect(screen.queryByTestId('grid-field-retired-keys')).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });

  it.each(RETIRED)('`%s` draws the refusal naming `%s` instead of the grid', (snake, camel) => {
    const onChange = vi.fn();
    // A field name per key: the console line is logged once per message, and
    // the name is part of the message.
    show(withRetired({ [snake]: VALUE[snake] }, `lines_${snake}`), onChange);
    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('data-testid')).toBe('grid-field-retired-keys');
    expect(alert.getAttribute('data-retired-keys')).toBe(snake);
    expect(alert.textContent).toContain(`Grid field \`lines_${snake}\``);
    expect(alert.textContent).toContain(`\`${snake}\` → \`${camel}\``);
    // Refused, not drawn: no grid, no rows, no controls.
    expect(screen.queryByTestId('line-items')).toBeNull();
    expect(addButton()).toBeNull();
    // The same text, once, for whoever reads the console instead of the page.
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(alert.textContent);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('several retired keys are named in ONE alert, in the rename map\'s order', () => {
    show(withRetired({ sort_field: 'position', min_rows: 1, allow_add: false }, 'lines_several'));
    const alert = screen.getByTestId('grid-field-retired-keys');
    expect(alert.getAttribute('data-retired-keys')).toBe('min_rows allow_add sort_field');
    expect(alert.textContent).toContain('`min_rows` → `minRows`, `allow_add` → `allowAdd`, `sort_field` → `sortField`');
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('a retired key beside its camelCase twin is still refused: there is no precedence to pick a winner', () => {
    show(withRetired({ minRows: 1, min_rows: 2 }, 'lines_both'));
    expect(screen.getByTestId('grid-field-retired-keys').getAttribute('data-retired-keys')).toBe('min_rows');
    expect(screen.queryByTestId('line-items')).toBeNull();
  });

  it('a retired key holding `undefined` is not refused, as on the TS and zod faces', () => {
    show(withRetired({ min_rows: undefined, allow_add: undefined }, 'lines_undefined'));
    expect(screen.queryByTestId('grid-field-retired-keys')).toBeNull();
    expect(screen.getByTestId('line-items')).toBeTruthy();
    expect(error).not.toHaveBeenCalled();
  });

  it('a field with no name is refused as "This grid field"', () => {
    render(<GridField value={rows} onChange={() => {}} field={{ columns, total_field: 'amount' } as never} />);
    expect(screen.getByTestId('grid-field-retired-keys').textContent).toContain('This grid field carries');
  });

  it('a refused grid that mounts twice logs its prescription once', () => {
    const field = withRetired({ max_rows: 3 }, 'lines_twice');
    const first = show(field);
    first.unmount();
    show(field);
    expect(screen.getByTestId('grid-field-retired-keys')).toBeTruthy();
    expect(error).toHaveBeenCalledTimes(1);
  });
});
