/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The refresh control shares a row instead of taking one (objectui#11694).
 *
 * "Refresh All" (with its record-count badge) used to be a `col-span-full`
 * grid item of its own between the filter bar and the widgets. In the
 * positioned grid (explicit `columns`) every implicit row carries the
 * `minmax(5rem, auto)` floor, so the control and the filter bar each claimed
 * a 5rem row plus the grid gap, and a filtered dashboard's first row of charts
 * fell below the fold at 1440x900 (the before/after real-layout reading is on
 * the pull request for objectui#11694; this file pins the mechanism, which a
 * layout-free DOM can see).
 *
 * What these pin, BY RENDERING:
 *
 *   filter bar declared -> the control sits in the filter bar's grid item
 *   no filter bar, header drawn -> the control sits in the header's grid item
 *   neither -> the control is the only full-width item, alone in its row
 *
 * and, in the positioned grid, that the full-width rows above the widgets are
 * explicit `auto` tracks (so the 5rem floor stays on widget rows), counted
 * exactly: one `auto` too many would strip the floor off the first widget row,
 * which is how a chart collapses to nothing.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { DashboardComponentSchema } from '@object-ui/types';
import { DashboardRenderer } from '../DashboardRenderer';

afterEach(cleanup);

const noop = () => {};

function dashboard(extra: Record<string, unknown> = {}): DashboardComponentSchema {
  return {
    type: 'dashboard',
    name: 'ops',
    label: 'Delivery Operations',
    columns: 12,
    widgets: [],
    ...extra,
  } as unknown as DashboardComponentSchema;
}

const FILTERS = { dateRange: { field: 'created_at', defaultRange: 'last_90_days', allowCustomRange: true } };

/** The grid item (a direct child of the dashboard root) holding `el`. */
function gridItemOf(root: Element, el: Element): Element {
  let node: Element | null = el;
  while (node && node.parentElement !== root) node = node.parentElement;
  if (!node) throw new Error('element is not inside the dashboard root');
  return node;
}

const refreshButton = () => screen.getByRole('button', { name: 'Refresh dashboard' });

describe('DashboardRenderer refresh control row (objectui#11694)', () => {
  it('sits in the filter bar row, with its record count, and takes no row of its own', () => {
    const { container } = render(
      <DashboardRenderer schema={dashboard(FILTERS)} onRefresh={noop} recordCount={12} hideHeaderText />,
    );
    const root = container.firstElementChild!;

    const filterBar = screen.getByTestId('dashboard-filter-bar');
    expect(gridItemOf(root, refreshButton())).toBe(gridItemOf(root, filterBar));
    expect(gridItemOf(root, screen.getByText('12 records'))).toBe(gridItemOf(root, filterBar));
    // One full-width item above the (empty) widget list, not two.
    expect(root.children.length).toBe(1);
    expect(root.className).toContain('grid-rows-[auto]');
  });

  it('sits in the header row when there is no filter bar and the header is drawn', () => {
    const { container } = render(
      <DashboardRenderer schema={dashboard({ header: { showTitle: true } })} onRefresh={noop} />,
    );
    const root = container.firstElementChild!;

    const headerItem = gridItemOf(root, screen.getByText('Delivery Operations'));
    expect(headerItem.matches('.col-span-full.mb-4')).toBe(true);
    expect(gridItemOf(root, refreshButton())).toBe(headerItem);
    expect(root.children.length).toBe(1);
    expect(root.className).toContain('grid-rows-[auto]');
  });

  it('prefers the filter bar row over the header row when both exist', () => {
    const { container } = render(
      <DashboardRenderer schema={dashboard({ ...FILTERS, header: { showTitle: true } })} onRefresh={noop} />,
    );
    const root = container.firstElementChild!;

    const headerItem = gridItemOf(root, screen.getByText('Delivery Operations'));
    const filterItem = gridItemOf(root, screen.getByTestId('dashboard-filter-bar'));
    expect(gridItemOf(root, refreshButton())).toBe(filterItem);
    expect(headerItem).not.toBe(filterItem);
    expect(root.children.length).toBe(2);
    expect(root.className).toContain('grid-rows-[auto_auto]');
  });

  it('stands alone in a content-sized row when no filter bar or header row exists (console chrome)', () => {
    const { container } = render(
      <DashboardRenderer schema={dashboard({ header: { showTitle: true } })} onRefresh={noop} hideHeaderText />,
    );
    const root = container.firstElementChild!;

    expect(root.children.length).toBe(1);
    expect(gridItemOf(root, refreshButton()).textContent).toBe('Refresh All');
    expect(root.className).toContain('grid-rows-[auto]');
  });

  it('declares no auto track when nothing sits above the widgets, and none in the responsive grid', () => {
    const positioned = render(<DashboardRenderer schema={dashboard()} />);
    expect(positioned.container.firstElementChild!.className).not.toContain('grid-rows-');
    positioned.unmount();

    // No `columns` and no layout wider than 4 => the responsive flow grid,
    // whose `auto-rows-min` rows are content-sized already.
    const responsive = render(
      <DashboardRenderer schema={dashboard({ columns: undefined, ...FILTERS })} onRefresh={noop} />,
    );
    const root = responsive.container.firstElementChild!;
    expect(root.className).toContain('auto-rows-min');
    expect(root.className).not.toContain('grid-rows-');
  });
});
