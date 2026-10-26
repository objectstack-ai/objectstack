/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11943 — `SortBuilder` honours `disabled` on a `fields` entry.
 *
 * A host sometimes has to list a field it must not offer: the field a row
 * already sorts by, kept so that row is not blank and can be removed, while no
 * other row may pick it (the ListView Sort picker's in-use exception). Before
 * this the entries were `{ value, label }` only, and one shared list fed every
 * row's dropdown and "Add sort", so a kept field was choosable everywhere.
 *
 * Every case reads the real `SortBuilder` and its real Radix `Select`, and sits
 * beside a control that runs the same interaction on the same entry WITHOUT the
 * flag: a negative such as "onChange was not called" is otherwise satisfied by a
 * dropdown that never opened or an option that was never there.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SortBuilder, type SortBuilderProps, type SortItem } from '../custom/sort-builder';

type Fields = NonNullable<SortBuilderProps['fields']>;

/** `secret` is the kept entry: flagged here, and listed FIRST so "Add sort" would seed it. */
const FLAGGED: Fields = [
  { value: 'secret', label: 'Secret', disabled: true },
  { value: 'title', label: 'Title' },
  { value: 'status', label: 'Status' },
];

/** The control: the same entries, in the same order, with no flag. */
const PLAIN: Fields = FLAGGED.map(({ value, label }) => ({ value, label }));

type Row = Pick<SortItem, 'field' | 'order'>;

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

function mount(fields: Fields, initial: Row[] = []) {
  const onChange = vi.fn();
  render(<Harness fields={fields} initial={initial} onChange={onChange} />);
  return onChange;
}

/** Each row is `[field select, direction select]`; these are the field selects. */
function fieldTriggers(): HTMLElement[] {
  return screen.getAllByRole('combobox').filter((_, i) => i % 2 === 0);
}

/** Open a row's field dropdown and return its option elements. */
async function open(trigger: HTMLElement): Promise<HTMLElement[]> {
  fireEvent.click(trigger);
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option');
}

function option(options: HTMLElement[], label: string): HTMLElement {
  const found = options.find((o) => o.textContent?.trim() === label);
  if (!found) throw new Error(`no option "${label}"`);
  return found;
}

const asc = (field: string): Row => ({ field, order: 'asc' });

afterEach(() => {
  cleanup();
});

describe('SortBuilder honours `disabled` on a fields entry (objectui#11943)', () => {
  it('renders a flagged entry as an unavailable option, and the same entry unflagged as an ordinary one', async () => {
    mount(FLAGGED, [asc('title')]);
    let options = await open(fieldTriggers()[0]);
    expect(options.map((o) => o.textContent?.trim())).toEqual(['Secret', 'Title', 'Status']);
    expect(option(options, 'Secret')).toHaveAttribute('aria-disabled', 'true');
    expect(option(options, 'Secret')).toHaveAttribute('data-disabled');
    expect(option(options, 'Title')).not.toHaveAttribute('aria-disabled');
    expect(option(options, 'Title')).not.toHaveAttribute('data-disabled');

    cleanup();
    mount(PLAIN, [asc('title')]);
    options = await open(fieldTriggers()[0]);
    expect(option(options, 'Secret')).not.toHaveAttribute('aria-disabled');
    expect(option(options, 'Secret')).not.toHaveAttribute('data-disabled');
  });

  it('a flagged entry cannot be chosen by click; unflagged, the same click chooses it', async () => {
    let onChange = mount(FLAGGED, [asc('title')]);
    let secret = option(await open(fieldTriggers()[0]), 'Secret');
    fireEvent.click(secret);
    fireEvent.pointerDown(secret, { pointerType: 'mouse' });
    fireEvent.pointerUp(secret, { pointerType: 'mouse' });
    expect(onChange).not.toHaveBeenCalled();
    // Nothing was chosen, so the list is still open; close it to read the row.
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(fieldTriggers()[0]).toHaveTextContent('Title');

    cleanup();
    onChange = mount(PLAIN, [asc('title')]);
    secret = option(await open(fieldTriggers()[0]), 'Secret');
    fireEvent.click(secret);
    expect(onChange).toHaveBeenLastCalledWith([asc('secret')]);
    expect(fieldTriggers()[0]).toHaveTextContent('Secret');
  });

  it('a flagged entry cannot be chosen from the keyboard; unflagged, the same keys choose it', async () => {
    // Enter on the option itself.
    let onChange = mount(FLAGGED, [asc('title')]);
    fireEvent.keyDown(option(await open(fieldTriggers()[0]), 'Secret'), { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();

    cleanup();
    onChange = mount(PLAIN, [asc('title')]);
    fireEvent.keyDown(option(await open(fieldTriggers()[0]), 'Secret'), { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith([asc('secret')]);

    // Typeahead on the closed trigger, which picks the next entry after the
    // current one whose label starts with the typed key. From `Status` the
    // only other "s" entry is `Secret`.
    cleanup();
    onChange = mount(FLAGGED, [asc('status')]);
    fireEvent.keyDown(fieldTriggers()[0], { key: 's' });
    expect(onChange).not.toHaveBeenCalled();
    expect(fieldTriggers()[0]).toHaveTextContent('Status');

    cleanup();
    onChange = mount(PLAIN, [asc('status')]);
    fireEvent.keyDown(fieldTriggers()[0], { key: 's' });
    expect(onChange).toHaveBeenLastCalledWith([asc('secret')]);
  });

  it('a row whose field is a flagged entry shows its label, and can be changed and removed', async () => {
    let onChange = mount(FLAGGED, [asc('secret'), asc('status')]);
    // Not blank: the label of a value with no entry at all renders nothing,
    // which is what this assertion would read if the flag dropped the entry.
    expect(fieldTriggers()[0]).toHaveTextContent('Secret');

    // Changed to another field.
    fireEvent.click(option(await open(fieldTriggers()[0]), 'Title'));
    expect(onChange).toHaveBeenLastCalledWith([asc('title'), asc('status')]);
    expect(fieldTriggers()[0]).toHaveTextContent('Title');

    // Removed: the row's only button is its remove control.
    cleanup();
    onChange = mount(FLAGGED, [asc('secret'), asc('status')]);
    const row = screen.getByText('Sort by').parentElement as HTMLElement;
    fireEvent.click(within(row).getByRole('button'));
    expect(onChange).toHaveBeenLastCalledWith([asc('status')]);
  });

  it('control: a value with no entry renders a blank row, which the flagged row above is not', () => {
    mount(FLAGGED, [asc('nowhere')]);
    expect(fieldTriggers()[0].textContent?.trim()).toBe('');
  });

  it('"Add sort" seeds the first entry that is not flagged; unflagged, it seeds the first entry', () => {
    let onChange = mount(FLAGGED);
    fireEvent.click(screen.getByRole('button', { name: /add sort/i }));
    expect(onChange).toHaveBeenLastCalledWith([asc('title')]);

    cleanup();
    onChange = mount(PLAIN);
    fireEvent.click(screen.getByRole('button', { name: /add sort/i }));
    expect(onChange).toHaveBeenLastCalledWith([asc('secret')]);
  });

  it('"Add sort" is disabled when no entry can be chosen, and enabled when one can', () => {
    mount(FLAGGED.map((f) => ({ ...f, disabled: true })), [asc('secret')]);
    expect(screen.getByRole('button', { name: /add sort/i })).toBeDisabled();

    cleanup();
    mount(FLAGGED, [asc('secret')]);
    expect(screen.getByRole('button', { name: /add sort/i })).toBeEnabled();

    cleanup();
    mount([]);
    expect(screen.getByRole('button', { name: /add sort/i })).toBeDisabled();
  });
});
