/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29074 / #29057 — the list's Sort, Filter and Group builders at
 * phone width.
 *
 * Below `sm` every control the builders draw is a 44 px touch target, and the
 * field select of a sort level or a filter condition takes its row's whole
 * width, so its label is not cut to a few letters. From `sm` up the compact
 * sizes and the one-line rows are unchanged: the `max-sm:` tokens sit beside
 * the desktop ones, which stay.
 *
 * happy-dom applies no Tailwind, so these read the class tokens. A live
 * measurement at 375 and 390 px is in the pull request's run record.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SortBuilder } from '../custom/sort-builder';
import { FilterBuilder } from '../custom/filter-builder';
import { GroupingEditor } from '../custom/grouping-editor';

afterEach(cleanup);

const tokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/);

describe('SortBuilder below sm (objectstack#29057)', () => {
  function mount() {
    render(
      <SortBuilder
        fields={[{ value: 'created_at', label: 'Last Modified At' }, { value: 'name', label: 'Name' }]}
        value={[{ id: 's1', field: 'created_at', order: 'asc' }]}
        onChange={vi.fn()}
      />,
    );
  }

  it('lays a level out on three lines: the words, the field beside Remove, the direction', () => {
    mount();
    const row = screen.getByTestId('sort-builder-row');
    expect(tokens(row)).toEqual(expect.arrayContaining(['flex', 'max-sm:grid', 'max-sm:grid-cols-[minmax(0,1fr)_auto]']));
    const field = screen.getByTestId('sort-builder-field').parentElement!;
    expect(tokens(field)).toEqual(expect.arrayContaining(['flex-1', 'max-sm:row-start-2']));
    const direction = screen.getByTestId('sort-builder-direction').parentElement!;
    expect(tokens(direction)).toEqual(expect.arrayContaining(['w-36', 'max-sm:col-span-2', 'max-sm:row-start-3', 'max-sm:w-auto']));
  });

  it('every control is 44 px below sm and keeps its desktop size', () => {
    mount();
    expect(tokens(screen.getByTestId('sort-builder-field'))).toEqual(expect.arrayContaining(['h-9', 'max-sm:h-11']));
    expect(tokens(screen.getByTestId('sort-builder-direction'))).toEqual(expect.arrayContaining(['h-9', 'max-sm:h-11']));
    expect(tokens(screen.getByRole('button', { name: 'Remove sort' }))).toEqual(
      expect.arrayContaining(['h-9', 'w-9', 'max-sm:h-11', 'max-sm:w-11']),
    );
    expect(tokens(screen.getByRole('button', { name: 'Add sort' }))).toEqual(expect.arrayContaining(['h-8', 'max-sm:h-11']));
  });
});

describe('FilterBuilder below sm (objectstack#29074)', () => {
  it('gives the field select the whole row and makes every control 44 px', () => {
    render(
      <FilterBuilder
        fields={[{ value: 'name', label: 'Account Name', type: 'text' }] as never}
        value={{ id: 'g', logic: 'and', conditions: [{ id: 'c1', field: 'name', operator: 'equals', value: '' }] } as never}
        onChange={vi.fn()}
      />,
    );
    const [field, operator] = screen.getAllByRole('combobox');
    expect(tokens(field.parentElement!)).toEqual(expect.arrayContaining(['col-span-4', 'max-sm:col-span-12']));
    expect(tokens(operator.parentElement!)).toEqual(expect.arrayContaining(['col-span-4', 'max-sm:col-span-6']));
    expect(tokens(field)).toEqual(expect.arrayContaining(['h-9', 'max-sm:h-11']));
    expect(tokens(operator)).toEqual(expect.arrayContaining(['h-9', 'max-sm:h-11']));
    const value = screen.getByPlaceholderText('Value');
    // 16 px text below sm keeps iOS Safari from zooming on focus.
    expect(tokens(value)).toEqual(expect.arrayContaining(['h-9', 'max-sm:h-11', 'max-sm:text-base']));
    expect(tokens(screen.getByRole('button', { name: 'Remove condition' }))).toEqual(
      expect.arrayContaining(['h-9', 'w-9', 'max-sm:h-11', 'max-sm:w-11']),
    );
    expect(tokens(screen.getByRole('button', { name: /Add filter/ }))).toEqual(expect.arrayContaining(['h-8', 'max-sm:h-11']));
    expect(tokens(screen.getByRole('button', { name: /Clear all/ }))).toEqual(expect.arrayContaining(['h-7', 'max-sm:h-11']));
  });
});

describe('GroupingEditor below sm (objectstack#29074)', () => {
  it('makes the level controls and Add group field 44 px', () => {
    render(
      <GroupingEditor
        value={{ fields: [{ field: 'name', order: 'asc', collapsed: false }] } as never}
        onChange={vi.fn()}
        fieldOptions={[{ value: 'name', label: 'Name' }, { value: 'stage', label: 'Stage' }]}
      />,
    );
    expect(tokens(screen.getByTestId('grouping-field-0'))).toEqual(expect.arrayContaining(['h-7', 'max-sm:h-11']));
    for (const id of ['grouping-order-0', 'grouping-remove-0']) {
      expect(tokens(screen.getByTestId(id)), id).toEqual(expect.arrayContaining(['h-7', 'w-7', 'max-sm:h-11', 'max-sm:w-11']));
    }
    expect(tokens(screen.getByTestId('grouping-collapsed-0').closest('label')!)).toEqual(
      expect.arrayContaining(['max-sm:h-11', 'max-sm:w-11']),
    );
    expect(tokens(screen.getByTestId('grouping-add'))).toEqual(expect.arrayContaining(['h-7', 'max-sm:h-11']));
  });
});
