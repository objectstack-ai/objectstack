/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10326 — the toolbar Search is not offered on `tree` or `chart` list
 * views (ruling 5825585515, letter A: a control that changes nothing is
 * withheld).
 *
 * THE DEFECT. The toolbar offered Search on every view. `tree` and `chart`
 * draw what they query for themselves, and neither query carries a term:
 * `ObjectTree`'s object-provider `find` sends `$filter` / `$top` / `$expand`,
 * and `ObjectChart`'s aggregate and dataset queries take no search at all. A
 * typed term changed only `ListView`'s own fetch — the record-count bar and
 * the export — and nothing drawn.
 *
 * WHAT IS PINNED.
 *
 *   - Search is absent on `tree` and on `chart`, whatever the chart's binding
 *     (bound to a semantic dataset, or unbound — the object-bound legacy
 *     binding this named retired in objectui#6152 round 15), and present on
 *     `grid` (the CONTROL) and on every other view kind, `gantt` included
 *     (objectui#10250 made its chart honour the term).
 *   - An authored `userActions.search: true` does not bring it back on those
 *     two views: `true` is the default, and the view still has no query to
 *     carry the term.
 *   - A term that is already set does not go on narrowing `ListView`'s own
 *     fetch while such a view is on screen, with no control there to show or
 *     clear it: neither a term the host restores at mount (`initialSearchTerm`,
 *     which app-shell's `ObjectView` reads back from per-view storage) nor one
 *     typed on a grid before switching. The term is KEPT, not cleared:
 *     switching back to the grid applies it again, and the host is never told
 *     to drop it.
 *
 * Each case first waits for the view's stand-in, so a mount that never reached
 * the view's render branch reads as a broken harness, never as a pass.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';


/** objectui#12423 — Display is the toolbar default; this file drives the WIDE form's buttons. */
const WIDE_TOOLBAR = { compactToolbar: false } as const;

const VIEW_NODE_TYPES = [
  'object-grid',
  'object-kanban',
  'object-calendar',
  'object-gallery',
  'object-timeline',
  'object-gantt',
  'object-map',
  'object-tree',
  'object-chart',
] as const;

for (const type of VIEW_NODE_TYPES) {
  ComponentRegistry.register(
    type,
    () => <div data-testid={`${type}-standin`} />,
    { namespace: 'test', label: `${type} stand-in`, category: 'view' },
  );
}

const objectDef = {
  name: 'duly_task',
  label: 'Task',
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text', label: 'Subject' },
    status: { name: 'status', type: 'text', label: 'Status' },
    estimate: { name: 'estimate', type: 'number', label: 'Estimate' },
    parent: { name: 'parent', type: 'text', label: 'Parent' },
    cover: { name: 'cover', type: 'text', label: 'Cover' },
    lat: { name: 'lat', type: 'number', label: 'Latitude' },
    lng: { name: 'lng', type: 'number', label: 'Longitude' },
    visible_from: { name: 'visible_from', type: 'date', label: 'Visible From' },
    due_date: { name: 'due_date', type: 'date', label: 'Due Date' },
  },
};

const rows = [
  { id: '1', subject: 'Task 1', status: 'open', estimate: 3, visible_from: '2026-01-01', due_date: '2026-01-05' },
];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: rows, total: rows.length })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => objectDef),
  } as never as { find: ReturnType<typeof vi.fn> };
}

const TREE_BLOCK = { parentField: 'parent' };
// objectui#6152 round 15: this view was "a chart bound to the list object",
// spelled with the legacy inline axes. Those axes are read by nothing now, so
// it is re-spelled as what that population has become, a `chart` view that
// names no `dataset` (the unbound node, which `ObjectChart` refuses on screen).
const DATASET_CHART_BLOCK = { chartType: 'bar', dataset: 'task_ds', dimensions: ['status'], values: ['total_estimate'] };

/** Every view kind, bound so its render branch has what it reads. */
const VIEWS = {
  grid: { viewType: 'grid' },
  kanban: { viewType: 'kanban', kanban: { groupByField: 'status' } },
  calendar: { viewType: 'calendar', calendar: { startDateField: 'due_date' } },
  gallery: { viewType: 'gallery', gallery: { coverField: 'cover' } },
  timeline: { viewType: 'timeline', timeline: { startDateField: 'due_date' } },
  gantt: { viewType: 'gantt', gantt: { titleField: 'subject', startDateField: 'visible_from', endDateField: 'due_date' } },
  map: { viewType: 'map', map: { latitudeField: 'lat', longitudeField: 'lng' } },
  tree: { viewType: 'tree', tree: TREE_BLOCK },
  unboundChart: { viewType: 'chart' },
  datasetChart: { viewType: 'chart', chart: DATASET_CHART_BLOCK },
} as const;

const STANDIN_OF: Record<keyof typeof VIEWS, string> = {
  grid: 'object-grid-standin',
  kanban: 'object-kanban-standin',
  calendar: 'object-calendar-standin',
  gallery: 'object-gallery-standin',
  timeline: 'object-timeline-standin',
  gantt: 'object-gantt-standin',
  map: 'object-map-standin',
  tree: 'object-tree-standin',
  unboundChart: 'object-chart-standin',
  datasetChart: 'object-chart-standin',
};

function mount(view: Record<string, unknown>, listProps: Record<string, unknown> = {}) {
  const dataSource = makeDataSource();
  const schema = { type: 'list-view', objectName: 'duly_task', columns: ['subject'], ...view };
  render(
    <SchemaRendererProvider dataSource={dataSource as never}>
      <ListView schema={{ ...WIDE_TOOLBAR, ...schema } as never} dataSource={dataSource as never} {...listProps} />
    </SchemaRendererProvider>,
  );
  return dataSource;
}

const searchTrigger = () => screen.queryByTestId('search-icon-button');
const onScreen = (testId: string) => waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument());
/** The `$search` of every host (`ListView`) fetch, in order. */
const hostSearches = (dataSource: { find: ReturnType<typeof vi.fn> }) =>
  dataSource.find.mock.calls.map((c: unknown[]) => (c[1] as Record<string, unknown> | undefined)?.$search);
const settle = () => new Promise((r) => setTimeout(r, 50));

afterEach(cleanup);

describe('objectui#10326 — the toolbar Search is offered only where the view on screen can carry the term', () => {
  it('CONTROL: a grid view offers Search', async () => {
    mount(VIEWS.grid);
    await onScreen(STANDIN_OF.grid);
    expect(searchTrigger()).toBeInTheDocument();
  });

  it.each([
    ['tree', 'tree'],
    ['chart that names no dataset', 'unboundChart'],
    ['chart bound to a semantic dataset', 'datasetChart'],
  ] as const)('withholds Search on a %s view', async (_label, view) => {
    mount(VIEWS[view]);
    await onScreen(STANDIN_OF[view]);
    expect(searchTrigger()).not.toBeInTheDocument();
  });

  it.each(['kanban', 'calendar', 'gallery', 'timeline', 'gantt', 'map'] as const)(
    'keeps Search on a %s view',
    async (view) => {
      mount(VIEWS[view]);
      await onScreen(STANDIN_OF[view]);
      expect(searchTrigger()).toBeInTheDocument();
    },
  );

  it.each([
    ['tree', 'tree'],
    ['chart', 'unboundChart'],
  ] as const)('an authored `userActions.search: true` does not bring Search back on a %s view', async (_label, view) => {
    mount({ ...VIEWS[view], userActions: { search: true } });
    await onScreen(STANDIN_OF[view]);
    expect(searchTrigger()).not.toBeInTheDocument();
  });
});

describe('objectui#10326 — a term already set does not narrow ListView\'s fetch while a search-less view is on screen', () => {
  it('CONTROL: on a grid, a term the host restores at mount reaches the fetch and shows on the trigger', async () => {
    const dataSource = mount(VIEWS.grid, { initialSearchTerm: 'needle' });
    await onScreen(STANDIN_OF.grid);
    await waitFor(() => expect(hostSearches(dataSource).at(-1)).toBe('needle'));
    expect(screen.getByTestId('search-active-keyword')).toHaveTextContent('needle');
  });

  it.each([
    ['tree', 'tree'],
    ['chart that names no dataset', 'unboundChart'],
    ['chart bound to a semantic dataset', 'datasetChart'],
  ] as const)('on a %s view, a term the host restores at mount reaches no fetch', async (_label, view) => {
    const dataSource = mount(VIEWS[view], { initialSearchTerm: 'needle' });
    await onScreen(STANDIN_OF[view]);
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    await settle();
    expect(hostSearches(dataSource).every((s) => s === undefined)).toBe(true);
  });

  it('a term typed on a grid stops narrowing the fetch on a switch to tree or chart, and applies again back on the grid', async () => {
    const onSearchChange = vi.fn();
    const dataSource = mount(
      {
        viewType: 'grid',
        tree: TREE_BLOCK,
        // The dataset block: the switcher offers only a chart that binds
        // (objectui#6152 round 15 withdrew the legacy block's offer).
        chart: DATASET_CHART_BLOCK,
        appearance: { allowedVisualizations: ['grid', 'tree', 'chart'] },
      },
      { showViewSwitcher: true, onSearchChange },
    );
    await onScreen(STANDIN_OF.grid);

    fireEvent.click(screen.getByTestId('search-icon-button'));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'needle' } });
    await waitFor(() => expect(hostSearches(dataSource).at(-1)).toBe('needle'));

    const pick = (name: string) => {
      const trigger = screen.queryByTestId('view-switcher-dropdown');
      if (trigger) fireEvent.click(trigger);
      fireEvent.click(screen.queryByRole('tab', { name }) ?? screen.getByRole('button', { name }));
    };

    pick('Tree');
    await onScreen(STANDIN_OF.tree);
    expect(searchTrigger()).not.toBeInTheDocument();
    await waitFor(() => expect(hostSearches(dataSource).at(-1)).toBeUndefined());

    pick('Chart');
    await onScreen(STANDIN_OF.datasetChart);
    expect(searchTrigger()).not.toBeInTheDocument();
    await settle();
    expect(hostSearches(dataSource).at(-1)).toBeUndefined();

    pick('Grid');
    await onScreen(STANDIN_OF.grid);
    await waitFor(() => expect(hostSearches(dataSource).at(-1)).toBe('needle'));
    expect(screen.getByTestId('search-active-keyword')).toHaveTextContent('needle');
    // Kept, not cleared: the host was told the term once, and never to drop it.
    expect(onSearchChange.mock.calls).toEqual([['needle']]);
  });
});
