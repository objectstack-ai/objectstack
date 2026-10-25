/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * RecipientPickerField — the sharing-rule recipient picker (objectstack#3821).
 *
 * Two regressions are pinned here:
 *  1. the candidate query must use the STRUCTURED `$orderby` form. It used to
 *     pass the clause string `'name asc'`, which ApiDataSource walked
 *     character by character into `0 n,1 a,2 m,…`; the server then sorted by
 *     columns that don't exist and every recipient list came back empty, so
 *     the control read "No matches" forever and no rule could be saved.
 *  2. the placeholder must come from a per-type i18n key, not from
 *     interpolating the enum value into an English sentence.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { RecipientPickerField } from './RecipientPickerField';

const USERS = [
  { id: 'usr_1', name: 'Ada Auditor' },
  { id: 'usr_2', name: 'Bob Builder' },
];

function mockDataSource(rows: any[] = USERS) {
  return { find: vi.fn().mockResolvedValue({ data: rows }) } as any;
}

function renderPicker(recipientType: string, dataSource: any, value = '') {
  return render(
    <RecipientPickerField
      value={value}
      onChange={vi.fn()}
      field={{ name: 'recipient_id' } as any}
      dataSource={dataSource}
      dependentValues={{ recipient_type: recipientType }}
    />,
  );
}

describe('RecipientPickerField — candidate query', () => {
  it('orders candidates with the structured $orderby form, never a clause string', async () => {
    const ds = mockDataSource();
    renderPicker('user', ds);

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    const [object, params] = ds.find.mock.calls[0];
    expect(object).toBe('sys_user');
    expect(params.$orderby).toEqual({ name: 'asc' });
    // A bare string is what regressed; assert the shape explicitly.
    expect(typeof params.$orderby).not.toBe('string');
  });

  it('queries the object mapped to each recipient type', async () => {
    for (const [type, object] of [
      ['user', 'sys_user'],
      ['team', 'sys_team'],
      ['business_unit', 'sys_business_unit'],
      ['unit_and_subordinates', 'sys_business_unit'],
    ] as const) {
      const ds = mockDataSource([]);
      const { unmount } = renderPicker(type, ds);
      await waitFor(() => expect(ds.find).toHaveBeenCalled());
      expect(ds.find.mock.calls[0][0]).toBe(object);
      unmount();
    }
  });

  it('shows the loaded records as options once the list is opened', async () => {
    const ds = mockDataSource();
    renderPicker('user', ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByText('Ada Auditor')).toBeInTheDocument();
    expect(screen.getByText('Bob Builder')).toBeInTheDocument();
  });
});

describe('RecipientPickerField — keeping the stored recipient', () => {
  function renderControlled(initialType: string, value: string, onChange: any) {
    const ds = mockDataSource();
    const view = render(
      <RecipientPickerField
        value={value}
        onChange={onChange}
        field={{ name: 'recipient_id' } as any}
        dataSource={ds}
        dependentValues={{ recipient_type: initialType }}
      />,
    );
    const rerenderWith = (type: string) =>
      view.rerender(
        <RecipientPickerField
          value={value}
          onChange={onChange}
          field={{ name: 'recipient_id' } as any}
          dataSource={ds}
          dependentValues={{ recipient_type: type }}
        />,
      );
    return { ...view, rerenderWith };
  }

  it('keeps the saved recipient when the type arrives late (edit form hydrating)', async () => {
    // The edit dialog mounts the widget before the record lands, so
    // recipient_type is '' on the first render and 'user' on the next. That is
    // hydration, not the admin changing the type — clearing there wiped the
    // saved recipient and the blank got persisted on save.
    const onChange = vi.fn();
    const { rerenderWith } = renderControlled('', 'usr_1', onChange);
    rerenderWith('user');
    await waitFor(() => expect(onChange).not.toHaveBeenCalled());
  });

  it('clears the recipient when the admin actually switches type', async () => {
    const onChange = vi.fn();
    const { rerenderWith } = renderControlled('user', 'usr_1', onChange);
    rerenderWith('team');
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(''));
  });

  it('does not clear when the type is unset back to empty', async () => {
    const onChange = vi.fn();
    const { rerenderWith } = renderControlled('user', 'usr_1', onChange);
    rerenderWith('');
    await waitFor(() => expect(onChange).not.toHaveBeenCalled());
  });
});

describe('RecipientPickerField — localizable copy', () => {
  it('takes the placeholder from a per-type key rather than the raw enum value', async () => {
    // With no I18nProvider the widget falls back to the English defaults, so
    // the assertion is on the *wording*: 'Select a business unit' can only come
    // from the keyed string — interpolating the enum produced
    // 'Select a business unit' only by accident and 'Select a unit and
    // subordinates' for the next type over.
    const ds = mockDataSource([]);
    renderPicker('unit_and_subordinates', ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(await screen.findByText('Select a business unit')).toBeInTheDocument();
    expect(screen.queryByText(/unit and subordinates/i)).not.toBeInTheDocument();
  });

  it('prompts for a recipient type before one is chosen', () => {
    renderPicker('', mockDataSource([]));
    expect(screen.getByText('Select a recipient type first.')).toBeInTheDocument();
  });
});

/**
 * objectui#7611 (ADR-0131 D3/D7) — a position recipient is picked from the
 * REGISTRY: the console metadata store's `position` items, never `sys_position`
 * rows, and never a merge of the two.
 */
describe('RecipientPickerField — position candidates come from the registry (objectui#7611)', () => {
  const POSITIONS = [
    { name: 'sales_manager', label: 'Sales Manager' },
    { name: 'account_exec', label: 'Account Executive' },
  ];

  function metadataStore(items: unknown[]): MetadataContextValue & { ensureType: ReturnType<typeof vi.fn> } {
    return {
      apps: [], objects: [], dashboards: [], reports: [], pages: [],
      loading: false, error: null,
      refresh: async () => {}, invalidate: () => {},
      ensureType: vi.fn().mockResolvedValue(items),
      getItem: async () => null,
      getItemsByType: () => [],
    } as any;
  }

  function renderInStore(store: MetadataContextValue | null, ds: any, value = '', onChange = vi.fn()) {
    const picker = (
      <RecipientPickerField
        value={value}
        onChange={onChange}
        field={{ name: 'recipient_id' } as any}
        dataSource={ds}
        dependentValues={{ recipient_type: 'position' }}
      />
    );
    return render(store ? <MetadataCtx.Provider value={store}>{picker}</MetadataCtx.Provider> : picker);
  }

  it('lists the position items of the registry and never queries sys_position', async () => {
    const store = metadataStore(POSITIONS);
    const ds = mockDataSource([{ id: 'row_1', name: 'row_only_position' }]);
    renderInStore(store, ds);

    await waitFor(() => expect(store.ensureType).toHaveBeenCalledWith('position'));
    fireEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByText('Sales Manager')).toBeInTheDocument();
    expect(screen.getByText('Account Executive')).toBeInTheDocument();
    // One source: a row the registry does not hold is not offered, and the
    // data source is never asked.
    expect(screen.queryByText('row_only_position')).not.toBeInTheDocument();
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('stores the chosen item by its machine name', async () => {
    const store = metadataStore(POSITIONS);
    const onChange = vi.fn();
    renderInStore(store, mockDataSource([]), '', onChange);

    await waitFor(() => expect(store.ensureType).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByText('Account Executive'));
    expect(onChange).toHaveBeenCalledWith('account_exec');
  });

  it('degrades to the text input when no metadata store is mounted', () => {
    const ds = mockDataSource([]);
    renderInStore(null, ds, 'sales_manager');
    // No reader of the registry ⇒ no list to offer; the stored name stays
    // editable instead of an empty list that can never fill.
    expect(screen.getByDisplayValue('sales_manager')).toBeInTheDocument();
    expect(ds.find).not.toHaveBeenCalled();
  });
});
