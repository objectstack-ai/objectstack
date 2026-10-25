// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8219 item 1 — how wide a dashboard's widgets are in the designer
 * preview.
 *
 * Measured on a live render: inside the Studio canvas the preview pinned the
 * dashboard grid to a 768px minimum, and a dashboard with ONE widget showed it
 * at its authored half span, so the only chart on the page used half of a grid
 * that was itself wider than the canvas. The filer's direction: a lone widget
 * fills the grid width.
 *
 * Pinned both ways, through the REAL `DashboardRenderer`:
 * - one widget: it spans every column of the grid, and the grid carries no
 *   768px minimum;
 * - several widgets: the grid keeps the 768px minimum and every widget keeps
 *   its authored span, so multi-widget dashboards lay out exactly as before.
 *
 * Height is not overridden: rows keep the renderer's floor per authored row
 * (`layout.h`) and grow with the widget's content.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
// Module-scope import of the lazily loaded renderer, so the preview's
// `React.lazy` factory resolves at once instead of racing the test's wait
// window (AGENTS.md, flaky-test discipline).
import '@object-ui/plugin-dashboard';

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

import { DashboardPreview } from './DashboardPreview';

afterEach(cleanup);

type Widget = Record<string, unknown>;

function renderPreview(widgets: Widget[], editing = true) {
  return render(
    <DashboardPreview
      type="dashboard"
      name="customer_dashboard"
      draft={{ name: 'customer_dashboard', label: 'Customers', widgets }}
      editing={editing}
      selection={null}
      onSelectionChange={() => {}}
      onPatch={() => {}}
      locale="en-US"
    />,
  );
}

/** The dashboard grid host and the widget cells laid out on it. */
async function readGrid(container: HTMLElement, count: number) {
  return waitFor(() => {
    const cells = Array.from(container.querySelectorAll<HTMLElement>('[style*="grid-column"]'));
    if (cells.length !== count) throw new Error(`expected ${count} widget cells, saw ${cells.length}`);
    const grid = cells[0].parentElement!;
    const template = grid.style.gridTemplateColumns;
    const columns = Number(/^repeat\((\d+),/.exec(template)?.[1]);
    if (!Number.isFinite(columns) || columns < 1) {
      throw new Error(`grid has no positioned column template: "${template}"`);
    }
    return { grid, cells, columns };
  });
}

function spanOf(cell: HTMLElement): number {
  return Number(/^span (\d+)$/.exec(cell.style.gridColumn)?.[1]);
}

function hasMinWidthPin(container: HTMLElement): boolean {
  return container.querySelector('.min-w-\\[768px\\]') !== null;
}

// The widget the live measurement was taken on: one chart, authored at half of
// a 12-column grid.
const LONE_CHART: Widget = {
  id: 'by_industry',
  type: 'chart',
  title: 'By industry',
  layout: { x: 0, y: 0, w: 6, h: 4 },
};

describe('DashboardPreview — a lone widget fills the grid (objectui#8219)', () => {
  it('one widget authored at half span spans every grid column, with no 768px minimum', async () => {
    const { container } = renderPreview([LONE_CHART]);
    const { cells, columns } = await readGrid(container, 1);
    expect(spanOf(cells[0])).toBe(columns);
    expect(hasMinWidthPin(container)).toBe(false);
    // Height is the authored row count, not a new fixed height.
    expect(cells[0].style.gridRow).toBe('span 4');
  });

  it('one layout-less widget spans every grid column too', async () => {
    const { container } = renderPreview([{ id: 'total', type: 'metric', title: 'Total' }]);
    const { cells, columns } = await readGrid(container, 1);
    expect(spanOf(cells[0])).toBe(columns);
    expect(hasMinWidthPin(container)).toBe(false);
  });

  it('the run (non-design) preview of one widget fills the grid as well', async () => {
    const { container } = renderPreview([LONE_CHART], false);
    const { cells, columns } = await readGrid(container, 1);
    expect(spanOf(cells[0])).toBe(columns);
    expect(hasMinWidthPin(container)).toBe(false);
  });
});

describe('DashboardPreview — several widgets keep their layout (objectui#8219)', () => {
  it('keeps the 768px minimum, the 12-column grid and every authored span', async () => {
    const { container } = renderPreview([
      { id: 'k1', type: 'metric', title: 'Revenue', layout: { x: 0, y: 0, w: 3, h: 2 } },
      { id: 'k2', type: 'metric', title: 'Orders', layout: { x: 3, y: 0, w: 3, h: 2 } },
      LONE_CHART,
    ]);
    const { cells, columns } = await readGrid(container, 3);
    expect(columns).toBe(12);
    expect(cells.map(spanOf)).toEqual([3, 3, 6]);
    expect(cells.map((c) => c.style.gridRow)).toEqual(['span 2', 'span 2', 'span 4']);
    expect(hasMinWidthPin(container)).toBe(true);
  });

  it('two layout-less widgets keep the renderer defaults and the 768px minimum', async () => {
    const { container } = renderPreview([
      { id: 'c1', type: 'chart', title: 'A', layout: { x: 0, y: 0, w: 6, h: 4 } },
      { id: 'c2', type: 'chart', title: 'B' },
    ]);
    const { cells, columns } = await readGrid(container, 2);
    expect(columns).toBe(12);
    expect(cells.map(spanOf)).toEqual([6, 6]);
    expect(hasMinWidthPin(container)).toBe(true);
  });
});
