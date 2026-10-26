/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12423 — the list toolbar's default shape: Filter, Sort, Display and
 * Search on the bar, everything else inside Display.
 *
 * Every fixture here offers the WHOLE wide toolbar — hide fields, row color,
 * a two-visualization switcher, inline edit, refresh and export — so an
 * absence from the bar is the default shape at work, not a control nobody
 * offered. `compactToolbar: false` is the control: the same fixture draws the
 * wide buttons again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';

const RECORDS = [{ id: '1', name: 'Acme', stage: 'won' }];

function makeDataSource() {
  return {
    find: vi.fn().mockResolvedValue({ data: RECORDS, total: 1 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    // `name` is declared so the object has a searchable field: an object with
    // none draws no Search (objectui#12966), and this fixture offers every control.
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'account',
      fields: { name: { name: 'name', type: 'text', label: 'Name' } },
    }),
  };
}

const FULL: ListViewSchema = {
  type: 'list-view',
  objectName: 'account',
  viewType: 'grid',
  fields: ['name', 'stage'],
  userActions: { hideFields: true, rowColor: true },
  exportOptions: { formats: ['csv'] },
  kanban: { groupByField: 'stage' },
  appearance: { allowedVisualizations: ['grid', 'kanban'] },
} as ListViewSchema;

/** What the grid was last handed, read off a stand-in registered for `object-grid`. */
let gridProps: Record<string, unknown> | undefined;
let previousGrid: ReturnType<typeof ComponentRegistry.get>;

function mount(schema: Partial<ListViewSchema> = {}, props: Record<string, unknown> = {}) {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource as never}>
      <ListView
        schema={{ ...FULL, ...schema } as ListViewSchema}
        dataSource={dataSource as never}
        showViewSwitcher
        onInlineEditChange={vi.fn()}
        {...props}
      />
    </SchemaRendererProvider>,
  );
  return dataSource;
}

/** The buttons drawn directly in the tool cluster, by test id, in order. */
function clusterButtons(): Array<string | null> {
  const cluster = document.querySelector('[data-print-hide]');
  if (!cluster) throw new Error('no tool cluster');
  return Array.from(cluster.querySelectorAll('button'))
    .filter((b) => !b.closest('[data-radix-popper-content-wrapper]'))
    .map((b) => b.getAttribute('data-testid'));
}

async function openDisplay(): Promise<HTMLElement> {
  const trigger = screen.getByTestId('toolbar-display-trigger');
  fireEvent.click(trigger);
  return screen.findByTestId('view-settings-content');
}

beforeEach(() => {
  gridProps = undefined;
  previousGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', (props: any) => {
    gridProps = props;
    return <div data-testid="grid-stub" />;
  });
});

afterEach(() => {
  cleanup();
  if (previousGrid) ComponentRegistry.register('object-grid', previousGrid as any);
});

describe('the list toolbar defaults to Filter · Sort · Display · Search (objectui#12423)', () => {
  it('the bar draws exactly those four, in that order, for a view offering every control', async () => {
    mount();
    await screen.findByTestId('grid-stub');
    expect(clusterButtons()).toEqual([
      'toolbar-filter-trigger',
      'toolbar-sort-trigger',
      'toolbar-display-trigger',
      'search-icon-button',
    ]);
    // Named absences, each one a control the fixture offers.
    expect(screen.queryByRole('button', { name: /^hide fields/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^group/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^color/i })).toBeNull();
    expect(screen.queryByTestId('toolbar-inline-edit-toggle')).toBeNull();
    expect(screen.queryByTestId('refresh-button')).toBeNull();
    expect(screen.queryByRole('button', { name: /^export/i })).toBeNull();
    expect(screen.queryByTestId('view-switcher-segmented')).toBeNull();
  });

  it('control: `compactToolbar: false` draws the wide buttons again', async () => {
    mount({ compactToolbar: false });
    await screen.findByTestId('grid-stub');
    expect(screen.queryByTestId('toolbar-display-trigger')).toBeNull();
    expect(screen.getByRole('button', { name: /^hide fields/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^group/i })).toBeInTheDocument();
    expect(screen.getByTestId('toolbar-inline-edit-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('refresh-button')).toBeInTheDocument();
    expect(screen.getByTestId('view-switcher-segmented')).toBeInTheDocument();
  });

  it('Display carries Layout, Group, Hide fields, Density, Row numbers, Edit inline, Reset, Refresh and Export', async () => {
    mount();
    await screen.findByTestId('grid-stub');
    const trigger = screen.getByTestId('toolbar-display-trigger');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    const content = await openDisplay();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const panel = within(content);
    expect(panel.getByTestId('display-layout-row')).toContainElement(panel.getByTestId('view-switcher-segmented'));
    expect(panel.getByRole('button', { name: 'Group' })).toBeInTheDocument();
    expect(panel.getByRole('button', { name: 'Hide Fields' })).toBeInTheDocument();
    expect(panel.getByTestId('view-settings-density-cycle')).toBeInTheDocument();
    for (const id of ['display-row-numbers-toggle', 'toolbar-inline-edit-toggle']) {
      const toggle = panel.getByTestId(id);
      expect(toggle).toHaveAttribute('role', 'switch');
      expect(toggle).toHaveAttribute('aria-checked');
    }
    expect(panel.getByRole('switch', { name: 'Row numbers' })).toBe(panel.getByTestId('display-row-numbers-toggle'));
    expect(panel.getByRole('switch', { name: 'Edit inline' })).toBe(panel.getByTestId('toolbar-inline-edit-toggle'));
    expect(panel.getByTestId('display-reset-button')).toHaveTextContent('Reset to view default');
    expect(panel.getByTestId('refresh-button')).toBeInTheDocument();
    expect(panel.getByTestId('display-export-csv')).toHaveTextContent('Export as CSV');
  });

  it('the Layout row is drawn only when the list offers a visualization switch', async () => {
    mount({ appearance: { allowedVisualizations: ['grid'] } } as Partial<ListViewSchema>);
    await screen.findByTestId('grid-stub');
    const content = await openDisplay();
    expect(within(content).queryByTestId('display-layout-row')).toBeNull();
    // Its neighbours are still there: the absence is the row's, not the panel's.
    expect(within(content).getByTestId('view-settings-density-cycle')).toBeInTheDocument();
  });

  it('the count is absent by default, reads 1 after density changes, and Reset removes it', async () => {
    mount();
    await screen.findByTestId('grid-stub');
    expect(screen.queryByTestId('toolbar-display-count')).toBeNull();
    const content = await openDisplay();
    expect(within(content).getByTestId('display-reset-button')).toBeDisabled();

    fireEvent.click(within(content).getByTestId('view-settings-density-cycle'));
    await waitFor(() => expect(screen.getByTestId('toolbar-display-count')).toHaveTextContent('1'));

    fireEvent.click(within(content).getByTestId('display-reset-button'));
    await waitFor(() => expect(screen.queryByTestId('toolbar-display-count')).toBeNull());
    expect(within(content).getByTestId('view-settings-density-cycle')).toHaveTextContent('Compact');
  });

  it('Row numbers is on by default, reaches the grid, counts when off, and Reset turns it back on', async () => {
    mount();
    await screen.findByTestId('grid-stub');
    expect(gridProps?.showRowNumbers).toBe(true);
    const content = await openDisplay();
    const toggle = within(content).getByTestId('display-row-numbers-toggle');
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(toggle);
    await waitFor(() => expect(gridProps?.showRowNumbers).toBe(false));
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('toolbar-display-count')).toHaveTextContent('1');

    fireEvent.click(within(content).getByTestId('display-reset-button'));
    await waitFor(() => expect(gridProps?.showRowNumbers).toBe(true));
    expect(screen.queryByTestId('toolbar-display-count')).toBeNull();
  });

  it('the footer Refresh re-fetches, as the wide toolbar button does', async () => {
    const dataSource = mount();
    await screen.findByTestId('grid-stub');
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    const before = dataSource.find.mock.calls.length;
    const content = await openDisplay();
    fireEvent.click(within(content).getByTestId('refresh-button'));
    await waitFor(() => expect(dataSource.find.mock.calls.length).toBeGreaterThan(before));
  });
});
