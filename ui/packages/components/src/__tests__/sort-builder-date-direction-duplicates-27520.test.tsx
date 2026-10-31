/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27520 row 7, the sort half: `SortBuilder` names a date's
 * direction as time, and keeps one row per field.
 *
 * Observed in the RC walkthrough on the Tasks list toolbar: the direction of a
 * datetime sort read "A → Z", and the same field could be added to the sort
 * twice. The second key on a field the first already orders by changes
 * nothing, so a duplicate row is a control that does nothing.
 *
 * Every case reads the real `SortBuilder` and its real Radix `Select`, and
 * keeps its control beside it: a text field still reads "A → Z", and a field
 * no other row holds is still an ordinary option.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SortBuilder, type SortBuilderProps, type SortItem } from '../custom/sort-builder';

type Fields = NonNullable<SortBuilderProps['fields']>;
type Row = Pick<SortItem, 'field' | 'order'>;

const FIELDS: Fields = [
  { value: 'title', label: 'Title', type: 'text' },
  { value: 'due_date', label: 'Due Date', type: 'date' },
  { value: 'created_at', label: 'Created At', type: 'datetime' },
];

/** Holds the value the way a host does, so a change is rendered back. */
function Harness({ fields, initial, onChange }: { fields: Fields; initial: Row[]; onChange: (rows: Row[]) => void }) {
  const [value, setValue] = React.useState<SortItem[]>(() =>
    initial.map((row, i) => ({ id: `r${i}`, ...row })),
  );
  return (
    <SortBuilder
      fields={fields}
      value={value}
      onChange={(next) => {
        onChange(next.map(({ field, order }) => ({ field, order })));
        setValue(next);
      }}
    />
  );
}

function mount(initial: Row[], fields: Fields = FIELDS) {
  const onChange = vi.fn();
  render(<Harness fields={fields} initial={initial} onChange={onChange} />);
  return onChange;
}

/** Each row is `[field select, direction select]`. */
const fieldTriggers = () => screen.getAllByRole('combobox').filter((_, i) => i % 2 === 0);
const directionTriggers = () => screen.getAllByRole('combobox').filter((_, i) => i % 2 === 1);

/** Open a dropdown and return what it offers, closing it again. */
function optionsOf(trigger: HTMLElement): Array<{ label: string; disabled: boolean }> {
  fireEvent.click(trigger);
  const listbox = screen.getByRole('listbox');
  const options = within(listbox).getAllByRole('option').map((o) => ({
    label: o.textContent?.trim() ?? '',
    disabled: o.getAttribute('aria-disabled') === 'true',
  }));
  fireEvent.keyDown(listbox, { key: 'Escape' });
  return options;
}

const asc = (field: string): Row => ({ field, order: 'asc' });

afterEach(() => {
  cleanup();
});

describe('SortBuilder names a date sort as time (objectstack#27520 row 7)', () => {
  it('a date row reads "Oldest → Newest" / "Newest → Oldest"; a datetime row too', () => {
    mount([asc('due_date'), { field: 'created_at', order: 'desc' }]);
    const [dateDir, datetimeDir] = directionTriggers();
    expect(dateDir).toHaveTextContent('Oldest → Newest');
    expect(datetimeDir).toHaveTextContent('Newest → Oldest');
    expect(optionsOf(dateDir).map((o) => o.label)).toEqual(['Oldest → Newest', 'Newest → Oldest']);
  });

  it('CONTROL: a text row keeps "A → Z" / "Z → A"', () => {
    mount([asc('title')]);
    expect(directionTriggers()[0]).toHaveTextContent('A → Z');
    expect(optionsOf(directionTriggers()[0]).map((o) => o.label)).toEqual(['A → Z', 'Z → A']);
  });

  it('the label follows the row when its field changes from text to date', () => {
    mount([asc('title')]);
    fireEvent.click(fieldTriggers()[0]);
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Due Date' }));
    expect(directionTriggers()[0]).toHaveTextContent('Oldest → Newest');
  });

  it('CONTROL: a field entry with no type keeps "A → Z"', () => {
    mount([asc('due_date')], FIELDS.map(({ value, label }) => ({ value, label })));
    expect(directionTriggers()[0]).toHaveTextContent('A → Z');
  });
});

describe('SortBuilder keeps one row per field (objectstack#27520 row 7)', () => {
  it('a field another row sorts by is unavailable in this row; the row\'s own field and the free ones are not', () => {
    mount([asc('title'), asc('due_date')]);
    expect(optionsOf(fieldTriggers()[1])).toEqual([
      { label: 'Title', disabled: true },
      { label: 'Due Date', disabled: false },
      { label: 'Created At', disabled: false },
    ]);
    // CONTROL: the first row sees the second row's field the same way.
    expect(optionsOf(fieldTriggers()[0])).toEqual([
      { label: 'Title', disabled: false },
      { label: 'Due Date', disabled: true },
      { label: 'Created At', disabled: false },
    ]);
  });

  it('"Add sort" seeds the first field no row holds, not the first field', () => {
    const onChange = mount([asc('title')]);
    fireEvent.click(screen.getByRole('button', { name: /add sort/i }));
    expect(onChange).toHaveBeenLastCalledWith([asc('title'), asc('due_date')]);
  });

  it('"Add sort" is disabled once every field has a row', () => {
    mount([asc('title'), asc('due_date'), asc('created_at')]);
    expect(screen.getByRole('button', { name: /add sort/i })).toBeDisabled();
  });

  it('CONTROL: with a field still free, "Add sort" stays enabled', () => {
    mount([asc('title'), asc('due_date')]);
    expect(screen.getByRole('button', { name: /add sort/i })).toBeEnabled();
  });
});
