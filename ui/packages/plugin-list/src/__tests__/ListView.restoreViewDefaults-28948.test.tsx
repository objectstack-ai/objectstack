/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28948 — the list's "Reset to view default" is told apart from a
 * choice.
 *
 * A host that stores the user's own hidden fields, density and sort (the
 * console) hands the view's values in `viewDefaults` and wires
 * `onRestoreViewDefaults`. The Display control's reset and the sort popover's
 * reset then name the parts they returned to the view's own through that
 * callback, and never write the view's values through the controls' doors
 * (`onHiddenFieldsChange`, `schema.onDensityChange`, `onSortChange`), which
 * the host would store as the user's choice. The host's own half (the parts
 * cleared from the stored entry) is pinned at the host seam, in app-shell's
 * `ObjectView.userListState-12418.test.tsx`.
 *
 * CONTROL: without the callback the reset writes through the doors, exactly
 * as `ListView.displayResetBaseline-12949.test.tsx` pins.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';
import { ListView, type ListViewProps } from '../ListView';

const RECORDS = [{ id: '1', name: 'Acme', stage: 'won', amount: 3 }];
const OBJECT_DEF = {
  name: 'account',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: { type: 'text', label: 'Stage' },
    amount: { type: 'number', label: 'Amount' },
  },
};

function makeDataSource() {
  return {
    find: vi.fn().mockResolvedValue({ data: RECORDS, total: 1 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_DEF),
  };
}

const BASE: ListViewSchema = {
  type: 'list-view',
  objectName: 'account',
  viewType: 'grid',
  fields: ['name', 'stage', 'amount'],
  userActions: { hideFields: true, sort: true },
} as ListViewSchema;

let previousGrid: ReturnType<typeof ComponentRegistry.get>;

function element(schema: Partial<ListViewSchema>, props: Partial<ListViewProps>, dataSource: ReturnType<typeof makeDataSource>) {
  return (
    <SchemaRendererProvider dataSource={dataSource as never}>
      <ListView schema={{ ...BASE, ...schema } as ListViewSchema} dataSource={dataSource as never} {...props} />
    </SchemaRendererProvider>
  );
}

function mount(schema: Partial<ListViewSchema>, props: Partial<ListViewProps> = {}) {
  const dataSource = makeDataSource();
  const view = render(element(schema, props, dataSource));
  return {
    dataSource,
    rerender: (nextSchema: Partial<ListViewSchema>, nextProps: Partial<ListViewProps> = props) =>
      view.rerender(element(nextSchema, nextProps, dataSource)),
  };
}

async function openDisplay(): Promise<HTMLElement> {
  await screen.findByTestId('grid-stub');
  fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
  return screen.findByTestId('view-settings-content');
}

async function openSort(dataSource: ReturnType<typeof makeDataSource>) {
  await screen.findByTestId('grid-stub');
  await waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: /^sort/i }));
  await screen.findByText('Sort Records');
}

beforeEach(() => {
  previousGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', () => <div data-testid="grid-stub" />);
});

afterEach(() => {
  cleanup();
  if (previousGrid) ComponentRegistry.register('object-grid', previousGrid as never);
});

describe('a host wiring `onRestoreViewDefaults` is told the reset, not handed the view\'s values as a choice (objectstack#28948)', () => {
  it('the Display reset of hidden fields names `hiddenFields` and writes nothing through `onHiddenFieldsChange`', async () => {
    const onHiddenFieldsChange = vi.fn();
    const onRestoreViewDefaults = vi.fn();
    mount(
      { hiddenFields: ['amount', 'stage'] },
      { viewDefaults: { hiddenFields: ['amount'] }, onHiddenFieldsChange, onRestoreViewDefaults },
    );
    const content = await openDisplay();
    fireEvent.click(within(content).getByTestId('display-reset-button'));

    expect(onRestoreViewDefaults).toHaveBeenCalledTimes(1);
    expect(onRestoreViewDefaults).toHaveBeenCalledWith(['hiddenFields']);
    expect(onHiddenFieldsChange).not.toHaveBeenCalled();
    // The list shows the view's own at once.
    await waitFor(() => expect(screen.queryByTestId('toolbar-display-count')).toBeNull());
  });

  it('the Display reset of density names `rowHeight`, writes nothing through `onDensityChange`, and follows the host\'s clear', async () => {
    const onDensityChange = vi.fn();
    const onRestoreViewDefaults = vi.fn();
    const props = { viewDefaults: { rowHeight: 'tall' as const }, onRestoreViewDefaults };
    const { rerender } = mount({ rowHeight: 'compact', onDensityChange } as Partial<ListViewSchema>, props);
    const content = await openDisplay();
    expect(within(content).getByTestId('view-settings-density-cycle')).toHaveTextContent('Compact');

    fireEvent.click(within(content).getByTestId('display-reset-button'));
    expect(onRestoreViewDefaults).toHaveBeenCalledTimes(1);
    expect(onRestoreViewDefaults).toHaveBeenCalledWith(['rowHeight']);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onDensityChange).not.toHaveBeenCalled();

    // The host clears the stored density: `schema.rowHeight` is the view's own again.
    rerender({ rowHeight: 'tall', onDensityChange } as Partial<ListViewSchema>, props);
    await waitFor(() =>
      expect(within(screen.getByTestId('view-settings-content')).getByTestId('view-settings-density-cycle')).toHaveTextContent('Spacious'),
    );
    expect(screen.queryByTestId('toolbar-display-count')).toBeNull();
    expect(onDensityChange).not.toHaveBeenCalled();
  });

  it('both differ: one call names both parts', async () => {
    const onRestoreViewDefaults = vi.fn();
    const onHiddenFieldsChange = vi.fn();
    mount(
      { hiddenFields: ['stage'], rowHeight: 'compact' } as Partial<ListViewSchema>,
      { viewDefaults: { rowHeight: 'medium' }, onHiddenFieldsChange, onRestoreViewDefaults },
    );
    const content = await openDisplay();
    fireEvent.click(within(content).getByTestId('display-reset-button'));

    expect(onRestoreViewDefaults).toHaveBeenCalledTimes(1);
    expect(onRestoreViewDefaults).toHaveBeenCalledWith(['hiddenFields', 'rowHeight']);
    expect(onHiddenFieldsChange).not.toHaveBeenCalled();
  });

  it('the sort reset returns to `viewDefaults.sort`, names `sort`, and writes nothing through `onSortChange`', async () => {
    const onSortChange = vi.fn();
    const onRestoreViewDefaults = vi.fn();
    const { dataSource } = mount(
      // `schema.sort` is the user's own stored sort; the view's is `viewDefaults.sort`.
      { sort: [{ field: 'amount', order: 'desc' }] } as Partial<ListViewSchema>,
      { viewDefaults: { sort: [{ field: 'name', order: 'asc' }] }, onSortChange, onRestoreViewDefaults },
    );
    await openSort(dataSource);
    expect((dataSource.find.mock.calls.at(-1)?.[1] as { $orderby?: unknown }).$orderby).toEqual([{ field: 'amount', order: 'desc' }]);
    const reset = screen.getByTestId('sort-reset-default');
    expect(reset).toBeEnabled();

    fireEvent.click(reset);
    expect(onRestoreViewDefaults).toHaveBeenCalledTimes(1);
    expect(onRestoreViewDefaults).toHaveBeenCalledWith(['sort']);
    expect(onSortChange).not.toHaveBeenCalled();
    // The list is now at the view's own sort, and asks the server for it.
    await waitFor(() => expect(screen.getByTestId('sort-reset-default')).toBeDisabled());
    await waitFor(() => {
      const lastQuery = dataSource.find.mock.calls.at(-1)?.[1] as { $orderby?: unknown } | undefined;
      expect(lastQuery?.$orderby).toEqual([{ field: 'name', order: 'asc' }]);
    });
  });

  it('CONTROL: removing every sort level is a choice, and still goes through `onSortChange` as `[]`', async () => {
    const onSortChange = vi.fn();
    const onRestoreViewDefaults = vi.fn();
    const { dataSource } = mount(
      { sort: [{ field: 'amount', order: 'desc' }] } as Partial<ListViewSchema>,
      { viewDefaults: { sort: [{ field: 'name', order: 'asc' }] }, onSortChange, onRestoreViewDefaults },
    );
    await openSort(dataSource);
    const remove = screen.getAllByRole('button', { name: 'Remove sort' });
    fireEvent.click(remove[0]);

    await waitFor(() => expect(onSortChange).toHaveBeenLastCalledWith([]));
    expect(onRestoreViewDefaults).not.toHaveBeenCalled();
  });

  it('CONTROL: settings outside the preference reset as before and name nothing', async () => {
    const onRestoreViewDefaults = vi.fn();
    mount({}, { viewDefaults: {}, onRestoreViewDefaults, defaultRowNumbers: true });
    const content = await openDisplay();
    fireEvent.click(within(content).getByTestId('display-row-numbers-toggle'));
    await waitFor(() => expect(within(content).getByTestId('display-reset-button')).toBeEnabled());
    fireEvent.click(within(content).getByTestId('display-reset-button'));
    expect(onRestoreViewDefaults).not.toHaveBeenCalled();
  });
});
