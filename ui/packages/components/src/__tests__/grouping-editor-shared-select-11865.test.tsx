/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The list Group panel picks its field with the shared `Select` (objectui#11865).
 *
 * `GroupingEditor` used to render a browser-native select for each level's
 * field, beside the Filter and Sort panels that pick a field with the shared
 * Radix `Select`. The card asks for one control for one kind of
 * choice, surface by surface; this suite covers the Group panel's surface.
 *
 * What is pinned:
 *   - the field control IS the primitive (a Radix combobox trigger, not a
 *     native select);
 *   - the selection round trip writes exactly the `GroupingConfigValue` the
 *     native control wrote, per-row option filtering and order included;
 *   - the empty state, the add button and removing the last level;
 *   - a level grouped by a field the options do not carry shows that field in
 *     its trigger instead of a blank one (the objectui#4874 invariant);
 *   - selection works from the keyboard alone, through the primitive.
 *
 * DIRECTION, observed against the native control: only the empty-state and
 * add / remove pins are green there. Every other pin is red, the
 * round-trip ones included, because they open the primitive's listbox, which a
 * native select does not have. What makes them guards of "the conversion
 * changed nothing the panel writes" is the literal they compare against: a
 * `change` event on the native control wrote that same JSON, and its per-row
 * option list was the same, read once on the pre-conversion component.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GroupingEditor, type GroupingConfigValue } from '../custom/grouping-editor';

const FIELD_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'status', label: 'Status' },
  { value: 'owner', label: 'Owner' },
];

function renderEditor(value: GroupingConfigValue | undefined, fieldOptions = FIELD_OPTIONS) {
  const onChange = vi.fn();
  const utils = render(
    <GroupingEditor value={value} onChange={onChange} fieldOptions={fieldOptions} />,
  );
  return { ...utils, onChange };
}

/** Open level `idx`'s dropdown and return the labels it lists, in order. */
async function openLevel(idx: number): Promise<HTMLElement[]> {
  fireEvent.keyDown(screen.getByTestId(`grouping-field-${idx}`), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option');
}

function labelsOf(options: HTMLElement[]): string[] {
  return options.map((o) => o.textContent ?? '');
}

describe('the Group panel field control is the shared Select (objectui#11865)', () => {
  it('renders each level’s field as the Radix combobox trigger, not a native select', () => {
    renderEditor({ fields: [{ field: 'name', order: 'asc', collapsed: false }] });
    const trigger = screen.getByTestId('grouping-field-0');
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('role', 'combobox');
    // What the trigger shows is the selected field's label.
    expect(trigger).toHaveTextContent('Name');
  });
});

describe('the value written is the one the native control wrote', () => {
  it('picking a field writes the level with only `field` changed', async () => {
    const { onChange } = renderEditor({
      fields: [{ field: 'name', order: 'desc', collapsed: true }],
    });
    const options = await openLevel(0);
    fireEvent.click(options.find((o) => o.textContent === 'Status')!);

    expect(onChange).toHaveBeenCalledTimes(1);
    const written = onChange.mock.calls[0][0];
    expect(written).toStrictEqual({ fields: [{ field: 'status', order: 'desc', collapsed: true }] });
    // Byte-identical serialisation, key order included: the shape the native
    // control's `{ ...g, field: e.target.value }` produced.
    expect(JSON.stringify(written)).toBe(
      '{"fields":[{"field":"status","order":"desc","collapsed":true}]}',
    );
  });

  it('leaves the other levels untouched when one level changes', async () => {
    const { onChange } = renderEditor({
      fields: [
        { field: 'name', order: 'asc', collapsed: false },
        { field: 'status', order: 'desc', collapsed: true },
      ],
    });
    const options = await openLevel(1);
    fireEvent.click(options.find((o) => o.textContent === 'Owner')!);

    expect(onChange.mock.calls[0][0]).toStrictEqual({
      fields: [
        { field: 'name', order: 'asc', collapsed: false },
        { field: 'owner', order: 'desc', collapsed: true },
      ],
    });
  });

  it('lists a row its own field plus the unused ones, in `fieldOptions` order', async () => {
    renderEditor({
      fields: [
        { field: 'status', order: 'asc', collapsed: false },
        { field: 'name', order: 'asc', collapsed: false },
      ],
    });
    // Level 0 holds `status`; `name` is taken by level 1, so it is not offered.
    expect(labelsOf(await openLevel(0))).toEqual(['Status', 'Owner']);
  });

  it('re-picking the field a level already holds writes nothing', async () => {
    const { onChange } = renderEditor({
      fields: [{ field: 'name', order: 'asc', collapsed: false }],
    });
    const options = await openLevel(0);
    fireEvent.click(options.find((o) => o.textContent === 'Name')!);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('the empty state and the add / remove buttons', () => {
  it('with no grouping, shows no level and an add button that appends the first field', () => {
    const { onChange } = renderEditor(undefined);
    expect(screen.queryByTestId('grouping-field-0')).toBeNull();

    fireEvent.click(screen.getByTestId('grouping-add'));
    expect(onChange.mock.calls[0][0]).toStrictEqual({
      fields: [{ field: 'name', order: 'asc', collapsed: false }],
    });
  });

  it('with no field to group by, renders neither a level nor an add button', () => {
    renderEditor(undefined, []);
    expect(screen.getByTestId('grouping-editor')).toBeEmptyDOMElement();
  });

  it('removing the last level writes `undefined`, the consumer’s "no grouping"', () => {
    const { onChange } = renderEditor({
      fields: [{ field: 'name', order: 'asc', collapsed: false }],
    });
    fireEvent.click(screen.getByTestId('grouping-remove-0'));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});

describe('a level grouped by a field the options do not carry (objectui#4874 invariant)', () => {
  it('shows that field in the trigger, not a blank one and not another field', () => {
    // A view grouped by a column it does not show: `ListView` builds the
    // options from the view's columns and the grouping from `schema.grouping`.
    renderEditor({ fields: [{ field: 'region', order: 'asc', collapsed: false }] });
    expect(screen.getByTestId('grouping-field-0')).toHaveTextContent('region');
  });

  it('lists that field first, ahead of the options, and moving off it writes the pick', async () => {
    const { onChange } = renderEditor({
      fields: [{ field: 'region', order: 'asc', collapsed: false }],
    });
    const options = await openLevel(0);
    expect(labelsOf(options)).toEqual(['region', 'Name', 'Status', 'Owner']);
    expect(screen.getByTestId('grouping-field-outside-options-0')).toBe(options[0]);

    fireEvent.click(options.find((o) => o.textContent === 'Owner')!);
    expect(onChange.mock.calls[0][0]).toStrictEqual({
      fields: [{ field: 'owner', order: 'asc', collapsed: false }],
    });
  });

  it('mounts no extra item when the field is one of the options', async () => {
    renderEditor({ fields: [{ field: 'owner', order: 'asc', collapsed: false }] });
    await openLevel(0);
    expect(screen.queryByTestId('grouping-field-outside-options-0')).toBeNull();
  });
});

describe('keyboard selection works through the primitive', () => {
  it('opens from the trigger and selects an option with Enter, no pointer involved', async () => {
    const { onChange } = renderEditor({
      fields: [{ field: 'name', order: 'asc', collapsed: false }],
    });
    const trigger = screen.getByTestId('grouping-field-0');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    const status = within(listbox).getAllByRole('option').find((o) => o.textContent === 'Status')!;
    fireEvent.keyDown(status, { key: 'Enter' });

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0][0]).toStrictEqual({
      fields: [{ field: 'status', order: 'asc', collapsed: false }],
    });
  });
});
