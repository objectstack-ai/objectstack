/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27520 rows 7 and 17 — the list toolbar and the empty list, as
 * the RC walkthrough found them on the Tasks list.
 *
 *  - Row 7, filters: a filter row with no value yet is not a filter. It is
 *    not counted on the Filter badge, it does not make the list "No matching
 *    records", and it is not handed to the host's `onFilterChange` (which the
 *    console stores as the user's list state, so it came back after a reload).
 *    The panel itself still shows the row, so the user can finish it.
 *  - Row 7, sort: a date field's direction reads "Oldest → Newest". The list
 *    hands each field's type to the picker.
 *  - Row 7, search: the "No matching records" a search produced offers
 *    "Clear search". The search persists across navigation, so the user can
 *    come back to it.
 *  - Row 17: an empty list offers Create when the host gives a create path
 *    and the user may create, without the view having to author an inline
 *    `addRecord` block. An `addRecord: { enabled: false }` the author wrote
 *    still withholds it.
 *
 * Every case mounts the real `ListView` with the real `FilterBuilder` and
 * `SortBuilder`; each negative sits beside a control on the same rig.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { DataSource, ListViewSchema } from '@object-ui/types';
import type { FilterBuilderRow } from '@object-ui/components';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';

const OBJECT = 'task_27520';

const DEFINITION = {
  name: OBJECT,
  label: 'Task',
  fields: {
    title: { type: 'text', label: 'Title' },
    due_date: { type: 'date', label: 'Due Date' },
    priority: { type: 'number', label: 'Priority' },
  },
};

function emptyDataSource() {
  return {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => structuredClone(DEFINITION)),
  };
}

type Props = Partial<React.ComponentProps<typeof ListView>>;

function mount(node: Record<string, unknown> = {}, props: Props = {}) {
  const ds = emptyDataSource();
  const schema = {
    type: 'list-view',
    objectName: OBJECT,
    viewType: 'grid',
    columns: [{ field: 'title' }, { field: 'due_date' }, { field: 'priority' }],
    ...node,
  } as unknown as ListViewSchema;
  const utils = render(
    <SchemaRendererProvider dataSource={ds as unknown as DataSource}>
      <ListView schema={schema} dataSource={ds as unknown as DataSource} {...props} />
    </SchemaRendererProvider>,
  );
  return { ...utils, ds };
}

async function emptyState(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => expect(container.querySelector('[data-testid="empty-state"]')).not.toBeNull());
  return container.querySelector('[data-testid="empty-state"]') as HTMLElement;
}

type Row = FilterBuilderRow;
const COMPLETE: Row = { id: 'c1', field: 'title', operator: 'contains', value: 'launch' };
const NO_VALUE: Row = { id: 'c2', field: 'priority', operator: 'equals', value: '' };
const group = (...conditions: Row[]): React.ComponentProps<typeof ListView>['initialFilters'] =>
  ({ id: 'root', logic: 'and', conditions });

const filterTrigger = () => screen.getByTestId('toolbar-filter-trigger');

afterEach(() => {
  cleanup();
});

describe('row 7: a filter row with no value is not a filter', () => {
  it('the badge counts the finished rows only', async () => {
    mount({}, { initialFilters: group(COMPLETE, NO_VALUE) });
    await waitFor(() => expect(filterTrigger()).toHaveAccessibleName('Filter, 1 active'));
    expect(filterTrigger().textContent).toBe('1');
  });

  it('a group of unfinished rows only draws no badge and keeps the first-run copy', async () => {
    const { container } = mount({}, { initialFilters: group(NO_VALUE), onAddRecord: () => {} });
    const panel = await emptyState(container);
    expect(filterTrigger()).toHaveAccessibleName('Filter');
    expect(filterTrigger().textContent).toBe('');
    expect(panel.textContent).toMatch(/Nothing here yet/);
    expect(panel.textContent).not.toMatch(/No matching records/);
  });

  it('CONTROL: two finished rows count two', async () => {
    mount({}, { initialFilters: group(COMPLETE, { ...NO_VALUE, value: 3 }) });
    await waitFor(() => expect(filterTrigger()).toHaveAccessibleName('Filter, 2 active'));
  });

  it('"Add filter" draws the new row in the panel but hands the host only the finished rows', async () => {
    const onFilterChange = vi.fn();
    mount({}, { initialFilters: group(COMPLETE), onFilterChange });
    fireEvent.click(filterTrigger());
    const panel = (await screen.findByText('Filter Records')).closest('[role="dialog"]') as HTMLElement;
    // The object definition is what lists the fields; wait for it.
    await waitFor(() => expect(within(panel).getByRole('button', { name: /add filter/i })).toBeEnabled());
    const rowsBefore = within(panel).getAllByRole('button', { name: /remove condition/i }).length;

    fireEvent.click(within(panel).getByRole('button', { name: /add filter/i }));

    // The panel holds the unfinished row, so the user can finish it…
    await waitFor(() =>
      expect(within(panel).getAllByRole('button', { name: /remove condition/i })).toHaveLength(rowsBefore + 1),
    );
    // …but what the host stores is the filter that applies.
    expect(onFilterChange).toHaveBeenCalled();
    const stored = onFilterChange.mock.calls.at(-1)![0];
    expect(stored.conditions).toEqual([COMPLETE]);
    // And the badge did not move.
    expect(filterTrigger()).toHaveAccessibleName('Filter, 1 active');
  });
});

describe('row 7: a date sort reads as time', () => {
  async function openSort() {
    fireEvent.click(await screen.findByRole('button', { name: /^sort/i }));
    const panel = (await screen.findByText('Sort Records')).closest('[role="dialog"]') as HTMLElement;
    return panel;
  }
  const directionOf = (panel: HTMLElement) => within(panel).getAllByRole('combobox')[1];

  it('a sort on a date field reads "Oldest → Newest"', async () => {
    mount({ sort: [{ field: 'due_date', order: 'asc' }] });
    const panel = await openSort();
    await waitFor(() => expect(directionOf(panel)).toHaveTextContent('Oldest → Newest'));
  });

  it('CONTROL: a sort on a text field reads "A → Z"', async () => {
    mount({ sort: [{ field: 'title', order: 'asc' }] });
    const panel = await openSort();
    await waitFor(() => expect(within(panel).getAllByRole('combobox')[0]).toHaveTextContent('Title'));
    expect(directionOf(panel)).toHaveTextContent('A → Z');
  });
});

describe('row 7: a search emptied list offers "Clear search"', () => {
  it('clicking it clears the search, tells the host, and the list is no longer "no matches"', async () => {
    const onSearchChange = vi.fn();
    const { container } = mount({}, { initialSearchTerm: 'zzz', onSearchChange });
    const panel = await emptyState(container);
    expect(panel.textContent).toMatch(/No matching records/);
    fireEvent.click(within(panel).getByRole('button', { name: 'Clear search' }));
    expect(onSearchChange).toHaveBeenLastCalledWith('');
    await waitFor(() =>
      expect(container.querySelector('[data-testid="empty-state"]')?.textContent).toMatch(/Nothing here yet/),
    );
    expect(screen.queryByTestId('search-active-keyword')).toBeNull();
  });

  it('CONTROL: a list emptied by the filter panel alone offers no "Clear search"', async () => {
    const { container } = mount({}, { initialFilters: group(COMPLETE) });
    const panel = await emptyState(container);
    expect(panel.textContent).toMatch(/No matching records/);
    expect(within(panel).queryByRole('button', { name: 'Clear search' })).toBeNull();
  });
});

describe('row 17: an empty list offers Create when the user may create', () => {
  it('a view with no inline addRecord block still offers the host\'s create', async () => {
    const onAddRecord = vi.fn();
    const { container } = mount({}, { onAddRecord });
    const panel = await emptyState(container);
    const add = panel.querySelector('[data-testid="empty-state-add-record"]') as HTMLElement | null;
    expect(add).not.toBeNull();
    fireEvent.click(add!);
    expect(onAddRecord).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: no create path from the host, no Create', async () => {
    const { container } = mount();
    const panel = await emptyState(container);
    expect(panel.querySelector('[data-testid="empty-state-add-record"]')).toBeNull();
  });

  it('an author\'s addRecord: { enabled: false } still withholds it', async () => {
    const { container } = mount({ addRecord: { enabled: false } }, { onAddRecord: () => {} });
    const panel = await emptyState(container);
    expect(panel.querySelector('[data-testid="empty-state-add-record"]')).toBeNull();
  });
});
