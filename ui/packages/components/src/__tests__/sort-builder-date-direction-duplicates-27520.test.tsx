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
import { cleanup, render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
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

describe('SortBuilder words a direction by the field\'s type: size, time or the alphabet', () => {
  const NUMERIC: Fields = [
    { value: 'title', label: 'Title', type: 'text' },
    { value: 'due_date', label: 'Due Date', type: 'date' },
    { value: 'estimate_hours', label: 'Estimate', type: 'number' },
    { value: 'progress', label: 'Progress', type: 'progress' },
    { value: 'completion', label: 'Completion', type: 'percent' },
    { value: 'budget', label: 'Budget', type: 'currency' },
    { value: 'active', label: 'Active', type: 'boolean' },
    { value: 'starts_at', label: 'Starts At', type: 'time' },
  ];
  const optionLabels = (i: number) => optionsOf(directionTriggers()[i]).map((o) => o.label);

  it('number, progress, percent and currency rows read "Low → High" / "High → Low"', () => {
    mount([asc('estimate_hours'), asc('progress'), asc('completion'), { field: 'budget', order: 'desc' }], NUMERIC);
    for (const i of [0, 1, 2, 3]) expect(optionLabels(i)).toEqual(['Low → High', 'High → Low']);
    expect(directionTriggers()[3]).toHaveTextContent('High → Low');
  });

  it('a boolean row reads as size and a time row as time', () => {
    mount([asc('active'), asc('starts_at')], NUMERIC);
    expect(optionLabels(0)).toEqual(['Low → High', 'High → Low']);
    expect(optionLabels(1)).toEqual(['Oldest → Newest', 'Newest → Oldest']);
  });

  it('CONTROL: beside them a date keeps time and text keeps the alphabet', () => {
    mount([asc('due_date'), asc('title'), asc('estimate_hours')], NUMERIC);
    expect(optionLabels(0)).toEqual(['Oldest → Newest', 'Newest → Oldest']);
    expect(optionLabels(1)).toEqual(['A → Z', 'Z → A']);
  });
});

describe('SortBuilder reads its direction words from the locale pack', () => {
  const PACK_FIELDS: Fields = [
    { value: 'title', label: 'Title', type: 'text' },
    { value: 'estimate_hours', label: 'Estimate', type: 'number' },
    { value: 'progress', label: 'Progress', type: 'progress' },
  ];
  const inLanguage = (language: string, initial: Row[]) =>
    render(
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
        <Harness fields={PACK_FIELDS} initial={initial} onChange={() => {}} />
      </I18nProvider>,
    );
  const labelsAt = (i: number) => optionsOf(directionTriggers()[i]).map((o) => o.label);

  it('zh: a number and a progress row read 「小 → 大」 / 「大 → 小」', async () => {
    inLanguage('zh', [asc('estimate_hours'), asc('progress')]);
    await waitFor(() => expect(directionTriggers()[0]).toHaveTextContent('小 → 大'));
    expect(labelsAt(0)).toEqual(['小 → 大', '大 → 小']);
    expect(labelsAt(1)).toEqual(['小 → 大', '大 → 小']);
  });

  it('ar: a text row reads the Latin pair left to right, "A → Z" / "Z → A"', async () => {
    inLanguage('ar', [asc('title'), asc('estimate_hours')]);
    // The Arabic pack is in once the number row reads in Arabic; only then is
    // the text row's pair the pack's and not the built-in English default.
    await waitFor(() => expect(directionTriggers()[1]).toHaveTextContent('الأصغر ← الأكبر'));
    expect(labelsAt(0)).toEqual(['A → Z', 'Z → A']);
  });
});
