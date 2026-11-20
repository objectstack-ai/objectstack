/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35876 — the order of the sort levels is the sort's priority,
 * and each level's handle changes it: a drag onto another row, or ArrowUp /
 * ArrowDown on the focused handle. A single level has nothing to reorder.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SortBuilder, type SortItem } from '../custom/sort-builder';

const FIELDS = [
  { value: 'name', label: 'Name' },
  { value: 'stage', label: 'Stage' },
  { value: 'amount', label: 'Amount' },
];
const THREE: SortItem[] = [
  { id: 'a', field: 'name', order: 'asc' },
  { id: 'b', field: 'stage', order: 'desc' },
  { id: 'c', field: 'amount', order: 'asc' },
];

afterEach(cleanup);

/** The builder under a host that keeps what it hands back, as a list does. */
function mount(initial: SortItem[]) {
  const onChange = vi.fn();
  function Host() {
    const [value, setValue] = React.useState(initial);
    return (
      <SortBuilder
        fields={FIELDS}
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Host />);
  return onChange;
}
const fieldsOf = (items: SortItem[]) => items.map((i) => `${i.field}:${i.order}`);

describe('SortBuilder — reordering the levels (objectstack#35876)', () => {
  it('every level has a named handle', () => {
    mount(THREE);
    const handles = screen.getAllByRole('button', { name: 'Drag to reorder' });
    expect(handles).toHaveLength(3);
    for (const h of handles) expect(h).toHaveAttribute('draggable', 'true');
  });

  it('ArrowUp on the second handle makes it the first level; ArrowDown on the first moves it down', () => {
    const onChange = mount(THREE);
    fireEvent.keyDown(screen.getAllByTestId('sort-builder-handle')[1], { key: 'ArrowUp' });
    expect(fieldsOf(onChange.mock.calls.at(-1)![0])).toEqual(['stage:desc', 'name:asc', 'amount:asc']);
    fireEvent.keyDown(screen.getAllByTestId('sort-builder-handle')[0], { key: 'ArrowDown' });
    expect(fieldsOf(onChange.mock.calls.at(-1)![0])).toEqual(['name:asc', 'stage:desc', 'amount:asc']);
  });

  it('an arrow past either end changes nothing', () => {
    const onChange = mount(THREE);
    fireEvent.keyDown(screen.getAllByTestId('sort-builder-handle')[0], { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getAllByTestId('sort-builder-handle')[2], { key: 'ArrowDown' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a drag of the third handle onto the first row puts that level first', () => {
    const onChange = mount(THREE);
    const handle = screen.getAllByTestId('sort-builder-handle')[2];
    const first = screen.getAllByTestId('sort-builder-row')[0];
    fireEvent.dragStart(handle);
    fireEvent.dragOver(first);
    fireEvent.drop(first);
    fireEvent.dragEnd(handle);
    expect(fieldsOf(onChange.mock.calls.at(-1)![0])).toEqual(['amount:asc', 'name:asc', 'stage:desc']);
  });

  it('a drop with no drag of this list in flight changes nothing and is left to the host', () => {
    const onChange = mount(THREE);
    const hostDrop = vi.fn();
    const row = screen.getAllByTestId('sort-builder-row')[0];
    row.parentElement!.addEventListener('drop', hostDrop);
    fireEvent.drop(row);
    expect(onChange).not.toHaveBeenCalled();
    expect(hostDrop).toHaveBeenCalled();
  });

  it('a single level: the handle is drawn but disabled, and drags nothing', () => {
    mount([THREE[0]]);
    const handle = screen.getByTestId('sort-builder-handle');
    expect(handle).toBeDisabled();
    expect(handle).toHaveAttribute('draggable', 'false');
  });
});
