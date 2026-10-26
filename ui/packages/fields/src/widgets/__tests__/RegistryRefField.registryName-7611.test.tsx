/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `position-ref` / `permission-ref` — the record-form field that names one
 * registry item by name (objectui#7611, ruling B2 on objectstack#22865).
 *
 * A grant names its position or its permission set by machine name
 * (ADR-0131 D4). These pins hold what the widget promises about that name:
 *
 *  - the LOADED catalog is listed by name, with the label beside the name;
 *  - a pick writes the NAME, never the label (`stores the name only`);
 *  - a stored name the loaded registry lacks stays, flagged "not found";
 *  - the catalog's other arms — IDLE, LOADING, FAILED, LOADED-but-empty —
 *    each render what `ref:dataset` / `ref-multi:<type>` render for them, and
 *    none of them writes anything but what the person typed;
 *  - each key reads its own registry type.
 *
 * The catalog arrives through `DataSource.listMetadataItems`, stubbed here as
 * the contract declares it: a promise that resolves the headers or rejects.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PositionRefField, PermissionRefField } from '../RegistryRefField';

const POSITIONS = [
  { name: 'sales_rep', label: 'Sales Representative' },
  { name: 'sales_manager', label: 'Sales Manager' },
  // An item whose author wrote no label reads as its name alone.
  { name: 'auditor' },
];

function lister(answer: () => Promise<Array<{ name: string; label?: string }>>) {
  return { listMetadataItems: vi.fn(answer), find: vi.fn() } as any;
}

function mount(
  Widget: typeof PositionRefField,
  {
    dataSource,
    value = '',
    onChange = vi.fn(),
    readonly = false,
  }: { dataSource?: unknown; value?: string; onChange?: any; readonly?: boolean } = {},
) {
  render(
    <Widget
      value={value}
      onChange={onChange}
      readonly={readonly}
      field={{ name: 'position', type: 'text', label: 'Position' } as any}
      dataSource={dataSource}
      id="f-position"
    />,
  );
  return { onChange };
}

afterEach(() => cleanup());

describe('position-ref — LOADED (objectui#7611)', () => {
  it('lists the registry items by name, with the label beside the name', async () => {
    const ds = lister(async () => POSITIONS);
    mount(PositionRefField, { dataSource: ds });

    fireEvent.click(await screen.findByRole('combobox'));
    expect(await screen.findByText('Sales Manager (sales_manager)')).toBeInTheDocument();
    expect(screen.getByText('Sales Representative (sales_rep)')).toBeInTheDocument();
    // No label: the name alone, not "auditor (auditor)".
    expect(screen.getByText('auditor')).toBeInTheDocument();
    expect(screen.queryByText('auditor (auditor)')).toBeNull();
  });

  it('stores the picked item NAME, never its label', async () => {
    const ds = lister(async () => POSITIONS);
    const { onChange } = mount(PositionRefField, { dataSource: ds });

    fireEvent.click(await screen.findByRole('combobox'));
    fireEvent.click(await screen.findByText('Sales Manager (sales_manager)'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('sales_manager');
  });

  it('shows a stored name the registry lists by its label beside the name', async () => {
    const ds = lister(async () => POSITIONS);
    mount(PositionRefField, { dataSource: ds, value: 'sales_rep' });

    const trigger = await screen.findByRole('combobox');
    expect(trigger).toHaveTextContent('Sales Representative (sales_rep)');
    expect(trigger).not.toHaveAttribute('data-not-found');
  });

  it('keeps a stored name the loaded registry lacks, flagged not found', async () => {
    const ds = lister(async () => POSITIONS);
    const { onChange } = mount(PositionRefField, { dataSource: ds, value: 'retired_role' });

    const trigger = await screen.findByRole('combobox');
    expect(trigger).toHaveTextContent('retired_role (not found)');
    expect(trigger).toHaveAttribute('data-not-found', 'true');
    // Rendering it wrote nothing: the stored name is neither dropped nor
    // replaced by a listed one.
    expect(onChange).not.toHaveBeenCalled();

    // It stays a selectable option of its own, beside the listed items.
    fireEvent.click(trigger);
    expect(await screen.findAllByText('retired_role (not found)')).not.toHaveLength(0);
    expect(screen.getByText('Sales Manager (sales_manager)')).toBeInTheDocument();
  });
});

describe('position-ref — the other catalog arms (objectui#7611)', () => {
  it('FAILED: names the failure and its cause; the typed-name box stays enabled and writes the typed name', async () => {
    const ds = lister(async () => {
      throw new Error('HTTP 503 Service Unavailable');
    });
    const { onChange } = mount(PositionRefField, { dataSource: ds, value: 'sales_rep' });

    const notice = await screen.findByTestId('registry-ref-position-load-failed');
    expect(notice).toHaveAttribute('role', 'status');
    expect(notice).toHaveTextContent('The list could not be loaded');
    expect(screen.getByTestId('registry-ref-position-load-failed-cause')).toHaveTextContent(
      'HTTP 503 Service Unavailable',
    );
    // A failure is not an empty registry: no picker, and the stored name is
    // neither flagged nor dropped.
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText(/not found/)).toBeNull();

    const box = screen.getByRole('textbox');
    expect(box).toBeEnabled();
    expect(box).toHaveValue('sales_rep');
    fireEvent.change(box, { target: { value: 'sales_manager' } });
    expect(onChange).toHaveBeenLastCalledWith('sales_manager');
  });

  it('LOADING: the stored name in a disabled box', async () => {
    const ds = lister(() => new Promise(() => {}));
    const { onChange } = mount(PositionRefField, { dataSource: ds, value: 'sales_rep' });

    const box = await screen.findByRole('textbox');
    expect(box).toBeDisabled();
    expect(box).toHaveValue('sales_rep');
    expect(box).toHaveAttribute('placeholder', 'Loading…');
    expect(screen.queryByTestId('registry-ref-position-load-failed')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('IDLE: with no data source that can list a registry, a text box writes the typed name', async () => {
    // A data source without the member is the same answer as none at all.
    for (const dataSource of [undefined, { find: vi.fn() }]) {
      const { onChange } = mount(PositionRefField, { dataSource });
      const box = screen.getByRole('textbox');
      expect(box).toBeEnabled();
      expect(screen.queryByTestId('registry-ref-position-load-failed')).toBeNull();
      fireEvent.change(box, { target: { value: 'sales_rep' } });
      expect(onChange).toHaveBeenLastCalledWith('sales_rep');
      cleanup();
    }
  });

  it('LOADED but empty: a text box writes the typed name, and nothing reads as a failure', async () => {
    const ds = lister(async () => []);
    const { onChange } = mount(PositionRefField, { dataSource: ds });

    await waitFor(() => expect(ds.listMetadataItems).toHaveBeenCalled());
    const box = await screen.findByRole('textbox');
    await waitFor(() => expect(box).toBeEnabled());
    expect(screen.queryByTestId('registry-ref-position-load-failed')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.change(box, { target: { value: 'sales_rep' } });
    expect(onChange).toHaveBeenLastCalledWith('sales_rep');
  });
});

describe('registry-ref — read-only, and one registry type per key (objectui#7611)', () => {
  it('read-only: the label beside the name, and a name the registry lacks flagged', async () => {
    const ds = lister(async () => POSITIONS);
    mount(PositionRefField, { dataSource: ds, value: 'sales_manager', readonly: true });
    expect(await screen.findByText('Sales Manager (sales_manager)')).toBeInTheDocument();
    cleanup();

    mount(PositionRefField, { dataSource: lister(async () => POSITIONS), value: 'retired_role', readonly: true });
    const shown = await screen.findByText('retired_role (not found)');
    expect(shown).toHaveAttribute('data-not-found', 'true');
  });

  it('position-ref reads the `position` registry and permission-ref the `permission` one', async () => {
    const positions = lister(async () => POSITIONS);
    mount(PositionRefField, { dataSource: positions });
    await waitFor(() => expect(positions.listMetadataItems).toHaveBeenCalledTimes(1));
    expect(positions.listMetadataItems).toHaveBeenCalledWith('position');
    cleanup();

    const sets = lister(async () => [{ name: 'sales_user', label: 'Sales User' }]);
    const { onChange } = mount(PermissionRefField, { dataSource: sets });
    await waitFor(() => expect(sets.listMetadataItems).toHaveBeenCalledTimes(1));
    expect(sets.listMetadataItems).toHaveBeenCalledWith('permission');

    fireEvent.click(await screen.findByRole('combobox'));
    fireEvent.click(await screen.findByText('Sales User (sales_user)'));
    expect(onChange).toHaveBeenCalledWith('sales_user');
  });
});
