/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * "Add group field" adds no field by itself (objectstack#36204).
 *
 * It used to add the first field no level used, at once: in a list the first
 * column, a name as a rule, so the first click grouped the records one per
 * group. With `askFieldOnAdd` the click writes nothing and opens a row whose
 * field dropdown is already open; the level is written only once a field is
 * picked there, and closing the dropdown without a pick writes nothing.
 * With no field to offer the button stays, disabled, and `labels.noFields`
 * says why; while `fieldOptionsLoading` it is disabled without a reason.
 *
 * DIRECTION: every pin but the CONTROLs fails on the old editor (the button
 * wrote the first field at once, no pending row existed, and with no option
 * the button was simply not drawn). The CONTROLs are the old behaviour, kept
 * for a host that passes none of the new props.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GroupingEditor, type GroupingConfigValue, type GroupingEditorProps } from '../custom/grouping-editor';

const FIELD_OPTIONS = [
  { value: 'status', label: 'Status' },
  { value: 'owner', label: 'Owner' },
  { value: 'vip', label: 'VIP' },
];

function renderEditor(value: GroupingConfigValue | undefined, extra: Partial<GroupingEditorProps> = {}) {
  const onChange = vi.fn();
  const props: GroupingEditorProps = { value, onChange, fieldOptions: FIELD_OPTIONS, askFieldOnAdd: true, ...extra };
  const utils = render(<GroupingEditor {...props} />);
  return { ...utils, onChange, props };
}

const labels = (options: HTMLElement[]) => options.map((o) => o.textContent ?? '');

describe('"Add group field" opens the field dropdown and writes nothing until a pick', () => {
  it('opens a row with its dropdown open, writes nothing, and hides the add button', async () => {
    const { onChange } = renderEditor(undefined);
    fireEvent.click(screen.getByTestId('grouping-add'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('grouping-field-pending')).toBeInTheDocument();
    expect(screen.queryByTestId('grouping-add')).toBeNull();
    // No level yet: the list is not grouped.
    expect(screen.queryByTestId('grouping-field-0')).toBeNull();
    const listbox = await screen.findByRole('listbox');
    expect(labels(within(listbox).getAllByRole('option'))).toEqual(['Status', 'Owner', 'VIP']);
  });

  it('a pick writes the level and the row becomes that level', async () => {
    const { onChange, rerender, props } = renderEditor(undefined);
    fireEvent.click(screen.getByTestId('grouping-add'));
    const listbox = await screen.findByRole('listbox');
    fireEvent.click(within(listbox).getAllByRole('option').find((o) => o.textContent === 'Owner')!);
    expect(onChange).toHaveBeenCalledTimes(1);
    const written = onChange.mock.calls[0][0];
    expect(written).toStrictEqual({ fields: [{ field: 'owner', order: 'asc', collapsed: false }] });
    rerender(<GroupingEditor {...props} value={written} />);
    await waitFor(() => expect(screen.queryByTestId('grouping-field-pending')).toBeNull());
    expect(screen.getByTestId('grouping-field-0')).toHaveTextContent('Owner');
    expect(screen.getByTestId('grouping-add')).toBeInTheDocument();
  });

  it('a second level offers only the fields no level uses and appends', async () => {
    const { onChange } = renderEditor({ fields: [{ field: 'status', order: 'desc', collapsed: true }] });
    fireEvent.click(screen.getByTestId('grouping-add'));
    const listbox = await screen.findByRole('listbox');
    expect(labels(within(listbox).getAllByRole('option'))).toEqual(['Owner', 'VIP']);
    fireEvent.click(within(listbox).getAllByRole('option').find((o) => o.textContent === 'VIP')!);
    expect(onChange.mock.calls[0][0]).toStrictEqual({
      fields: [
        { field: 'status', order: 'desc', collapsed: true },
        { field: 'vip', order: 'asc', collapsed: false },
      ],
    });
  });

  it('closing the dropdown without a pick drops the row and writes nothing', async () => {
    const { onChange } = renderEditor(undefined);
    fireEvent.click(screen.getByTestId('grouping-add'));
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('grouping-field-pending')).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('grouping-add')).toBeInTheDocument();
  });

  it('CONTROL: without `askFieldOnAdd` the first unused field is added at once, as before', () => {
    const { onChange } = renderEditor(undefined, { askFieldOnAdd: undefined });
    fireEvent.click(screen.getByTestId('grouping-add'));
    expect(onChange.mock.calls[0][0]).toStrictEqual({
      fields: [{ field: 'status', order: 'asc', collapsed: false }],
    });
  });
});

describe('no field to offer: the button stays, disabled, and says why', () => {
  it('with `labels.noFields` the button is disabled and described by the reason', () => {
    const { onChange } = renderEditor(undefined, { fieldOptions: [], labels: { noFields: 'Nothing can group this' } });
    const button = screen.getByTestId('grouping-add');
    expect(button).toBeDisabled();
    const reason = screen.getByTestId('grouping-no-fields');
    expect(reason).toHaveTextContent('Nothing can group this');
    expect(button).toHaveAttribute('aria-describedby', reason.id);
    fireEvent.click(button);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId('grouping-field-pending')).toBeNull();
  });

  it('while the options load the button is disabled without a reason', () => {
    renderEditor(undefined, { fieldOptions: [], fieldOptionsLoading: true, labels: { noFields: 'Nothing can group this' } });
    const button = screen.getByTestId('grouping-add');
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByTestId('grouping-no-fields')).toBeNull();
  });

  it('once the options arrive the button is enabled', async () => {
    const { rerender, props } = renderEditor(undefined, { fieldOptions: [], fieldOptionsLoading: true });
    expect(screen.getByTestId('grouping-add')).toBeDisabled();
    rerender(<GroupingEditor {...props} fieldOptions={FIELD_OPTIONS} fieldOptionsLoading={false} />);
    expect(screen.getByTestId('grouping-add')).toBeEnabled();
    fireEvent.click(screen.getByTestId('grouping-add'));
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
  });

  it('CONTROL: with no option and no `noFields`, no add button is drawn, as before', () => {
    renderEditor(undefined, { fieldOptions: [], askFieldOnAdd: undefined });
    expect(screen.queryByTestId('grouping-add')).toBeNull();
    expect(screen.queryByTestId('grouping-no-fields')).toBeNull();
  });
});

describe('a level grouped by a field the host does not offer', () => {
  it('shows the label `fieldLabel` gives', () => {
    renderEditor({ fields: [{ field: 'customer_name', order: 'asc', collapsed: false }] }, {
      fieldLabel: (f) => (f === 'customer_name' ? 'Customer name' : undefined),
    });
    expect(screen.getByTestId('grouping-field-0')).toHaveTextContent('Customer name');
  });

  it('CONTROL: without `fieldLabel` it shows the field name', () => {
    renderEditor({ fields: [{ field: 'customer_name', order: 'asc', collapsed: false }] });
    expect(screen.getByTestId('grouping-field-0')).toHaveTextContent('customer_name');
  });
});
