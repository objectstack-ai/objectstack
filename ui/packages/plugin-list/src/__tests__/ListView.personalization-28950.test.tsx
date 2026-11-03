/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28950 — the list tells its host what of it differs from the
 * view (`onPersonalizationChange`), so the host can draw one 「Personalized」
 * marker and own the one reset.
 *
 * Every part is judged against the VIEW: where the host lays the reader's
 * state over the view's in `schema` (the console), the sort and the grouping
 * compare against `viewDefaults`, as hidden fields and density already do.
 * With the callback wired the Display control draws no reset of its own; the
 * sort popover's per-control reset stays. The host half (the marker, the reset
 * that clears the stored entry, the search cache and the `uf_*` params) is
 * pinned in app-shell's `ObjectView.listPersonalized-28950.test.tsx`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor, cleanup, act } from '@testing-library/react';
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
  userActions: { hideFields: true, sort: true, search: true, group: true, density: true },
} as ListViewSchema;

/** The view's own: what the console hands in `viewDefaults`. */
const VIEW_DEFAULTS: NonNullable<ListViewProps['viewDefaults']> = {
  sort: [{ field: 'name', order: 'asc' }],
  rowHeight: 'medium',
  hiddenFields: [],
  grouping: undefined,
};

let previousGrid: ReturnType<typeof ComponentRegistry.get>;

function mount(schema: Partial<ListViewSchema>, props: Partial<ListViewProps> = {}) {
  const dataSource = makeDataSource();
  const onPersonalizationChange = vi.fn();
  render(
    <SchemaRendererProvider dataSource={dataSource as never}>
      <ListView
        schema={{ ...BASE, sort: VIEW_DEFAULTS.sort, rowHeight: 'medium', ...schema } as ListViewSchema}
        dataSource={dataSource as never}
        viewDefaults={VIEW_DEFAULTS}
        onPersonalizationChange={onPersonalizationChange}
        {...props}
      />
    </SchemaRendererProvider>,
  );
  /** The parts of the latest report. */
  const reported = () => onPersonalizationChange.mock.calls.at(-1)?.[0] as string[] | undefined;
  return { dataSource, onPersonalizationChange, reported };
}

async function openDisplay(): Promise<HTMLElement> {
  await screen.findByTestId('grid-stub');
  fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
  return screen.findByTestId('view-settings-content');
}

beforeEach(() => {
  previousGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', () => <div data-testid="grid-stub" />);
});

afterEach(() => {
  cleanup();
  if (previousGrid) ComponentRegistry.register('object-grid', previousGrid as never);
});

describe('the list reports what of it differs from the view (objectstack#28950)', () => {
  it('a list that is the view\'s own reports no part, once', async () => {
    const { onPersonalizationChange } = mount({});
    await screen.findByTestId('grid-stub');
    await waitFor(() => expect(onPersonalizationChange).toHaveBeenCalled());
    expect(onPersonalizationChange).toHaveBeenCalledTimes(1);
    expect(onPersonalizationChange).toHaveBeenCalledWith([]);
  });

  it('a sort the host laid over the view\'s is `sort`, judged against `viewDefaults`', async () => {
    const { reported } = mount({ sort: [{ field: 'amount', order: 'desc' }] } as Partial<ListViewSchema>);
    await screen.findByTestId('grid-stub');
    await waitFor(() => expect(reported()).toEqual(['sort']));
  });

  it('a search term and a Filter panel condition are `search` and `filters`', async () => {
    const { reported } = mount({}, {
      initialSearchTerm: 'Alan',
      initialFilters: { id: 'root', logic: 'and', conditions: [{ id: 'c1', field: 'name', operator: 'contains', value: 'Acme' }] } as never,
    });
    await screen.findByTestId('grid-stub');
    await waitFor(() => expect(reported()).toEqual(['filters', 'search']));
  });

  it('a panel row with no value yet is not a filter', async () => {
    const { reported } = mount({}, {
      initialFilters: { id: 'root', logic: 'and', conditions: [{ id: 'c1', field: 'name', operator: 'contains', value: '' }] } as never,
    });
    await screen.findByTestId('grid-stub');
    await waitFor(() => expect(reported()).toEqual([]));
  });

  it('a grouping the host laid over the view\'s (the URL\'s) is `grouping`; the view\'s own is not', async () => {
    const grouping = { fields: [{ field: 'stage', order: 'asc', collapsed: false }] };
    const first = mount({ grouping } as Partial<ListViewSchema>);
    await waitFor(() => expect(first.reported()).toEqual(['grouping']));
    cleanup();

    const second = mount({ grouping } as Partial<ListViewSchema>, { viewDefaults: { ...VIEW_DEFAULTS, grouping } as never });
    await waitFor(() => expect(second.onPersonalizationChange).toHaveBeenCalled());
    await waitFor(() => expect(second.reported()).toEqual([]));
  });

  it('CONTROL: `viewDefaults` without a `grouping` key leaves the grouping `schema` opened with as the view\'s', async () => {
    const grouping = { fields: [{ field: 'stage', order: 'asc', collapsed: false }] };
    const { sort, rowHeight, hiddenFields } = VIEW_DEFAULTS;
    const { reported, onPersonalizationChange } = mount({ grouping } as Partial<ListViewSchema>, { viewDefaults: { sort, rowHeight, hiddenFields } });
    await waitFor(() => expect(onPersonalizationChange).toHaveBeenCalled());
    await waitFor(() => expect(reported()).toEqual([]));
  });

  it('stored hidden fields and density are `hiddenFields` and `density`', async () => {
    const { reported } = mount({ hiddenFields: ['amount'], rowHeight: 'compact' } as Partial<ListViewSchema>);
    await screen.findByTestId('grid-stub');
    await waitFor(() => expect(reported()).toEqual(['hiddenFields', 'density']));
  });

  it('a Display-only change is reported as the reader makes it, and the report follows it back', async () => {
    const { reported } = mount({}, { defaultRowNumbers: true });
    const content = await openDisplay();
    await waitFor(() => expect(reported()).toEqual([]));

    fireEvent.click(within(content).getByTestId('display-row-numbers-toggle'));
    await waitFor(() => expect(reported()).toEqual(['rowNumbers']));

    fireEvent.click(within(content).getByTestId('display-row-numbers-toggle'));
    await waitFor(() => expect(reported()).toEqual([]));
  });

  it('a search typed into the list is reported, and clearing it takes the part back out', async () => {
    const { reported } = mount({});
    await screen.findByTestId('grid-stub');
    await waitFor(() => expect(reported()).toEqual([]));
    fireEvent.click(screen.getByTestId('search-icon-button'));
    const input = await screen.findByPlaceholderText(/search/i);

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Alan' } });
    });
    await waitFor(() => expect(reported()).toEqual(['search']));
    await act(async () => {
      fireEvent.change(input, { target: { value: '' } });
    });
    await waitFor(() => expect(reported()).toEqual([]));
  });
});

describe('with the callback wired, the host owns the one reset (objectstack#28950)', () => {
  it('the Display control draws no "Reset to view default" of its own', async () => {
    mount({ hiddenFields: ['amount'] } as Partial<ListViewSchema>);
    const content = await openDisplay();
    expect(within(content).queryByTestId('display-reset-button')).toBeNull();
  });

  it('CONTROL: without the callback the Display control keeps its reset', async () => {
    mount({ hiddenFields: ['amount'] } as Partial<ListViewSchema>, { onPersonalizationChange: undefined });
    const content = await openDisplay();
    expect(within(content).getByTestId('display-reset-button')).toBeTruthy();
  });

  it('the sort popover keeps its per-control reset', async () => {
    const { dataSource } = mount({ sort: [{ field: 'amount', order: 'desc' }] } as Partial<ListViewSchema>, {
      onRestoreViewDefaults: vi.fn(),
    });
    await screen.findByTestId('grid-stub');
    await waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^sort/i }));
    await screen.findByText('Sort Records');
    expect(screen.getByTestId('sort-reset-default')).toBeEnabled();
  });
});
