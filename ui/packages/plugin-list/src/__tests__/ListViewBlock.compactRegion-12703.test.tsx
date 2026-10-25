/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12703 — a `list-view` block in a page region narrower than half the
 * page takes the compact posture: a header with the list's title and record
 * count over two-line rows, without the toolbar, the view tabs and the
 * row-number column. A region half the page or wider keeps the full list.
 *
 * Everything renders through the REAL page renderer (`@object-ui/components`)
 * and the REAL `list-view` registration, because the posture is decided
 * between the two: the page measures the region, the block reads it. A DOM
 * test has no layout, so the widths come from a stand-in `ResizeObserver` that
 * reports one width per observed element — the page body
 * (`[data-page-type] > div`) and each region's grid (`[data-region]`). The
 * grid is a spy: the full list is "the grid was mounted, with row numbers",
 * and the compact list is "the grid was never mounted".
 *
 * What is pinned:
 *  (a) the block in the `aside` (320 of 1200) draws no toolbar, no tabs and
 *      no grid (so no `#` column), and one two-line row per record: the
 *      view's first column over its second;
 *  (b) its header carries the block's title and the record count;
 *  (c) CONTROL — the block in `main` (856 of 1200) on the same page draws the
 *      full list: the toolbar and the grid, with row numbers;
 *  (d) CONTROL — a list outside any page region (the object list page's
 *      `ListView`, and the block with no page around it) is the full list.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup, within, fireEvent } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers the REAL page renderer and `page:card` (module scope, AGENTS.md §测试纪律).
import '@object-ui/components';
// Registers the REAL `list-view`.
import '../index';
import { ListView } from '../ListView';

const OBJECT = 'crm_event';

const rows = [
  { id: 'e-1', subject: 'Renewal review', location: 'Room 4', start_datetime: '2026-10-20T09:00:00Z' },
  { id: 'e-2', subject: 'Discovery call', location: 'Zoom', start_datetime: '2026-10-21T15:30:00Z' },
];

const objectDef = {
  name: OBJECT,
  label: 'Event',
  fields: {
    id: { name: 'id', type: 'text', label: 'Id' },
    subject: { name: 'subject', type: 'text', label: 'Subject' },
    location: { name: 'location', type: 'text', label: 'Location' },
    start_datetime: { name: 'start_datetime', type: 'datetime', label: 'Start' },
  },
};

interface GridSpyProps {
  showRowNumbers?: boolean;
}
let gridProps: GridSpyProps[] = [];

ComponentRegistry.register(
  'object-grid',
  (props: GridSpyProps) => {
    gridProps.push(props);
    return <div data-testid="grid-spy" />;
  },
  { namespace: 'test', label: 'Grid spy', category: 'view' },
);

const makeDataSource = () =>
  ({
    find: vi.fn(async () => rows),
    findOne: vi.fn(async () => null),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(async () => rows.length),
    getObjectSchema: vi.fn(async () => objectDef),
    getObjects: vi.fn(async () => []),
    onMutation: () => () => {},
  });

/** A `list-view` node in the page spelling (objectui#12099). */
const listBlock = (id: string, label: string) => ({
  type: 'list-view',
  id,
  label,
  properties: {
    data: { provider: 'object', object: OBJECT },
    columns: ['location', 'subject', 'start_datetime'],
  },
});

const salesHomeShape = {
  type: 'home',
  template: 'three-column',
  regions: [
    { name: 'main', components: [listBlock('main_list', 'Open events')] },
    {
      name: 'aside',
      width: 'medium',
      components: [
        {
          type: 'page:card',
          id: 'upcoming_events',
          properties: { title: 'Upcoming Events', children: [listBlock('aside_list', 'Upcoming')] },
        },
      ],
    },
  ],
};

/** Installs a `ResizeObserver` that reports these widths for the page body and each region. */
function stubWidths(widths: { page: number; regions: Record<string, number> }) {
  class WidthReportingObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      const region = target.getAttribute('data-region');
      const width = region != null
        ? widths.regions[region]
        : target.matches('[data-page-type] > div') ? widths.page : undefined;
      if (width === undefined) return;
      this.callback([{ target, contentRect: { width } } as unknown as ResizeObserverEntry], this as never);
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', WidthReportingObserver);
}

function renderWithData(node: React.ReactElement) {
  const dataSource = makeDataSource();
  const view = render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={dataSource as never}>{node}</SchemaRendererProvider>
    </ActionProvider>,
  );
  return { dataSource, ...view };
}

const regionOf = (container: HTMLElement, name: string): HTMLElement => {
  const el = container.querySelector(`[data-region="${name}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`no region ${name}`);
  return el;
};

afterEach(() => {
  gridProps = [];
  cleanup();
  vi.unstubAllGlobals();
});

describe('a list block in a region narrower than half the page is compact (objectui#12703)', () => {
  it('(a)(b) the aside block draws a header and two-line rows, and no toolbar, tabs or grid', async () => {
    stubWidths({ page: 1200, regions: { main: 856, aside: 320 } });
    const { container } = renderWithData(<SchemaRenderer schema={salesHomeShape as never} />);
    const aside = regionOf(container, 'aside');

    await waitFor(() => expect(within(aside).getAllByTestId('list-compact-row')).toHaveLength(2));

    // (a) No object-list chrome: no toolbar control, no tab strip, no grid
    // (the `#` column is the grid's), no record-count bar.
    expect(within(aside).queryByTestId('toolbar-filter-trigger')).toBeNull();
    expect(within(aside).queryByRole('tablist')).toBeNull();
    expect(within(aside).queryByTestId('grid-spy')).toBeNull();
    expect(within(aside).queryByTestId('record-count-bar')).toBeNull();

    // Each row: the view's first column, its second muted below.
    const [first, second] = within(aside).getAllByTestId('list-compact-row');
    expect(within(first).getByTestId('list-compact-primary').textContent).toContain('Room 4');
    expect(within(first).getByTestId('list-compact-secondary').textContent).toContain('Renewal review');
    expect(within(second).getByTestId('list-compact-primary').textContent).toContain('Zoom');
    expect(within(second).getByTestId('list-compact-secondary').textContent).toContain('Discovery call');

    // (b) The header: the block's title and its record count.
    expect(within(aside).getByTestId('list-compact-title').textContent).toBe('Upcoming');
    expect(within(aside).getByTestId('list-compact-count').textContent).toBe('2');
  });

  it('(c) CONTROL: the main block on the same page draws the full list, with row numbers', async () => {
    stubWidths({ page: 1200, regions: { main: 856, aside: 320 } });
    const { container } = renderWithData(<SchemaRenderer schema={salesHomeShape as never} />);
    const main = regionOf(container, 'main');

    await waitFor(() => expect(within(main).getByTestId('grid-spy')).toBeTruthy());
    expect(within(main).getByTestId('toolbar-filter-trigger')).toBeTruthy();
    expect(within(main).queryByTestId('list-compact-header')).toBeNull();
    expect(within(main).queryByTestId('list-compact-rows')).toBeNull();
    // Exactly one grid mounted on the page — main's — and it numbers its rows.
    expect(container.querySelectorAll('[data-testid="grid-spy"]')).toHaveLength(1);
    expect(gridProps[gridProps.length - 1]?.showRowNumbers).toBe(true);
  });

  it('a region whose width is not known keeps the full list', async () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const { container } = renderWithData(<SchemaRenderer schema={salesHomeShape as never} />);
    const aside = regionOf(container, 'aside');
    await waitFor(() => expect(within(aside).getByTestId('grid-spy')).toBeTruthy());
    expect(within(aside).queryByTestId('list-compact-rows')).toBeNull();
  });

  it('a compact row is a control that reaches the row-click handler a grid row reaches', async () => {
    const onRowClick = vi.fn();
    const view = render(
      <ListView
        schema={{ type: 'list-view', objectName: OBJECT, columns: ['subject', 'location'] } as never}
        dataSource={makeDataSource() as never}
        compact
        onRowClick={onRowClick}
      />,
    );
    await waitFor(() => expect(view.getAllByTestId('list-compact-row')).toHaveLength(2));
    fireEvent.click(within(view.getAllByTestId('list-compact-row')[0]).getByRole('button'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0][0]).toMatchObject({ id: 'e-1' });
  });
});

describe('a list outside any page region is unchanged (objectui#12703)', () => {
  it('(d) CONTROL: the object list page ListView draws the full list', async () => {
    stubWidths({ page: 1200, regions: {} });
    const view = renderWithData(
      <ListView
        schema={{ type: 'list-view', objectName: OBJECT, columns: ['subject', 'location'] } as never}
        dataSource={makeDataSource() as never}
      />,
    );
    await waitFor(() => expect(view.getByTestId('grid-spy')).toBeTruthy());
    expect(view.getByTestId('toolbar-filter-trigger')).toBeTruthy();
    expect(view.queryByTestId('list-compact-rows')).toBeNull();
    expect(gridProps[gridProps.length - 1]?.showRowNumbers).toBe(true);
  });

  it('(d) CONTROL: the list-view block with no page around it draws the full list', async () => {
    stubWidths({ page: 1200, regions: {} });
    const view = renderWithData(<SchemaRenderer schema={listBlock('bare', 'Bare') as never} />);
    await waitFor(() => expect(view.getByTestId('grid-spy')).toBeTruthy());
    expect(view.queryByTestId('list-compact-rows')).toBeNull();
  });
});
