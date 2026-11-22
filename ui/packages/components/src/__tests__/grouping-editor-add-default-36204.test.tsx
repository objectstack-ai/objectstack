/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * "Add group field" asks its host which field to add (objectstack#36204).
 *
 * It used to add the first field no level used, at once: in a list the first
 * column, a name as a rule, so the first click grouped the records one per
 * group. `pickAddField` lets the host choose; when it has no field to offer
 * the editor writes nothing and opens a row whose field dropdown is already
 * open, and the level is written only once a field is picked there.
 *
 * DIRECTION: without the prop every pin but the CONTROL fails on the old
 * editor (the button wrote the first field at once, and no pending row
 * existed); the CONTROL is the old behaviour, kept for a host that passes
 * no `pickAddField`.
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

function renderEditor(
  value: GroupingConfigValue | undefined,
  pickAddField?: (remaining: Array<{ value: string; label: string }>) => string | undefined,
) {
  const onChange = vi.fn();
  const utils = render(
    <GroupingEditor value={value} onChange={onChange} fieldOptions={FIELD_OPTIONS} pickAddField={pickAddField} />,
  );
  return { ...utils, onChange };
}

const labels = (options: HTMLElement[]) => options.map((o) => o.textContent ?? '');

describe('"Add group field" adds the field the host picks', () => {
  it('adds the picked field at once', () => {
    const { onChange } = renderEditor(undefined, () => 'status');
    fireEvent.click(screen.getByTestId('grouping-add'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toStrictEqual({
      fields: [{ field: 'status', order: 'asc', collapsed: false }],
    });
  });

  it('is asked with the fields no level uses, in `fieldOptions` order, and appends the level', () => {
    const pick = vi.fn((remaining: Array<{ value: string }>) => remaining[remaining.length - 1].value);
    const { onChange } = renderEditor({ fields: [{ field: 'status', order: 'desc', collapsed: true }] }, pick);
    fireEvent.click(screen.getByTestId('grouping-add'));
    expect(pick.mock.calls[0][0].map((o) => o.value)).toEqual(['name', 'owner']);
    expect(onChange.mock.calls[0][0]).toStrictEqual({
      fields: [
        { field: 'status', order: 'desc', collapsed: true },
        { field: 'owner', order: 'asc', collapsed: false },
      ],
    });
  });

  it('CONTROL: without `pickAddField` the first unused field is added at once, as before', () => {
    const { onChange } = renderEditor(undefined);
    fireEvent.click(screen.getByTestId('grouping-add'));
    expect(onChange.mock.calls[0][0]).toStrictEqual({
      fields: [{ field: 'name', order: 'asc', collapsed: false }],
    });
  });
});

describe('no field picked: the field dropdown opens and nothing is written until a pick', () => {
  it('opens a row with its dropdown open, writes nothing, and hides the add button', async () => {
    const { onChange } = renderEditor(undefined, () => undefined);
    fireEvent.click(screen.getByTestId('grouping-add'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('grouping-field-pending')).toBeInTheDocument();
    expect(screen.queryByTestId('grouping-add')).toBeNull();
    // No level yet: the list is not grouped.
    expect(screen.queryByTestId('grouping-field-0')).toBeNull();
    const listbox = await screen.findByRole('listbox');
    expect(labels(within(listbox).getAllByRole('option'))).toEqual(['Name', 'Status', 'Owner']);
  });

  it('a pick writes the level and the row becomes that level', async () => {
    const { onChange, rerender } = renderEditor(undefined, () => undefined);
    fireEvent.click(screen.getByTestId('grouping-add'));
    const listbox = await screen.findByRole('listbox');
    fireEvent.click(within(listbox).getAllByRole('option').find((o) => o.textContent === 'Owner')!);
    expect(onChange).toHaveBeenCalledTimes(1);
    const written = onChange.mock.calls[0][0];
    expect(written).toStrictEqual({ fields: [{ field: 'owner', order: 'asc', collapsed: false }] });
    rerender(<GroupingEditor value={written} onChange={onChange} fieldOptions={FIELD_OPTIONS} pickAddField={() => undefined} />);
    await waitFor(() => expect(screen.queryByTestId('grouping-field-pending')).toBeNull());
    expect(screen.getByTestId('grouping-field-0')).toHaveTextContent('Owner');
    expect(screen.getByTestId('grouping-add')).toBeInTheDocument();
  });

  it('offers only the fields no level uses', async () => {
    renderEditor({ fields: [{ field: 'name', order: 'asc', collapsed: false }] }, () => undefined);
    fireEvent.click(screen.getByTestId('grouping-add'));
    const listbox = await screen.findByRole('listbox');
    expect(labels(within(listbox).getAllByRole('option'))).toEqual(['Status', 'Owner']);
  });

  it('closing the dropdown without a pick drops the row and writes nothing', async () => {
    const { onChange } = renderEditor(undefined, () => undefined);
    fireEvent.click(screen.getByTestId('grouping-add'));
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('grouping-field-pending')).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('grouping-add')).toBeInTheDocument();
  });
});
