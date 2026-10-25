/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12573 — a dataset-bound metric tile is two lines on BOTH dashboard
 * surfaces.
 *
 * objectui#12528 (PR #12572) dropped `DashboardRenderer`'s card header for a
 * dataset-bound `metric` widget and handed `DatasetWidget` a `heading`, so the
 * tile draws the title and the measure label on one line above the value.
 * `DashboardGridLayout` kept its own frame: a header with the title (and, in
 * edit mode, the drag handle), then the value, then the label — three lines.
 * It now hands `DatasetWidget` the same `heading`, so the two-line content has
 * one derivation (`DatasetWidget`'s heading row) for both surfaces, and its
 * edit-mode drag handle sits over the tile instead of in the dropped header.
 *
 * objectui#12623 moved the measure label off the title's line (in a 150 px tile
 * it kept its width and cut the title to two or three letters): the title owns
 * the first line, and the label is a line under the value that also rides in
 * the title's tooltip. The first two pins below assert that order on both
 * surfaces instead of the shared line; the width rules are
 * `metricTileLayout-12623.test.tsx`'s.
 *
 * Pins:
 *  - both surfaces: the metric draws the title alone before the value and the
 *    measure label after it, the label once, the title once, the description
 *    then the label as the title's tooltip;
 *  - CONTROL, both surfaces: a dataset-bound table and chart keep the card
 *    header and draw no metric heading;
 *  - `DashboardGridLayout` edit mode: the metric tile still carries exactly one
 *    `.drag-handle` (the element `dragConfig.handle` names), inside its grid
 *    item; out of edit mode it carries none;
 *  - CONTROL, `DashboardRenderer` positioned grid: `layout.h` keeps its meaning
 *    for the metric and for the chart and table (`gridRow: span h`), over the
 *    unchanged `minmax(5rem, auto)` row floor (triage scope 1).
 *
 * No `dist/` is involved: the root `vitest.config.mts` aliases every
 * `@object-ui/*` specifier to that package's `src/`, and the subjects are
 * imported relatively.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import type { DashboardComponentSchema } from '@object-ui/types';
// Module scope, never inside a hook (AGENTS.md 测试纪律): both surfaces resolve
// non-dataset nodes through the registries these barrels populate.
import '@object-ui/components';
import '@object-ui/plugin-charts';
import { DashboardRenderer } from '../DashboardRenderer';
import { DashboardGridLayout } from '../DashboardGridLayout';

afterEach(cleanup);

const dashboard = (widgets: Record<string, unknown>[], extras: Record<string, unknown> = {}): DashboardComponentSchema =>
  ({ type: 'dashboard', name: 'sales', widgets, ...extras }) as unknown as DashboardComponentSchema;

const source = () => ({
  queryDataset: vi.fn(async () => ({
    rows: [{ total_amount: 1964500, stage: 'won' }],
    fields: [
      { name: 'total_amount', label: 'Total Amount', type: 'number' },
      { name: 'stage', label: 'Stage', type: 'text' },
    ],
  })),
});

const METRIC = {
  id: 'total_pipeline_value',
  type: 'metric',
  title: 'Total Pipeline',
  description: 'Sum of open opportunity value',
  dataset: 'opportunity_metrics',
  values: ['total_amount'],
};

const TABLE = {
  id: 'by_stage_table',
  type: 'table',
  title: 'Pipeline Table',
  dataset: 'opportunity_metrics',
  dimensions: ['stage'],
  values: ['total_amount'],
};

const CHART = {
  id: 'by_stage_chart',
  type: 'bar',
  title: 'Pipeline Chart',
  dataset: 'opportunity_metrics',
  dimensions: ['stage'],
  values: ['total_amount'],
};

type Surface = (schema: DashboardComponentSchema, dataSource: unknown) => React.ReactElement;

const SURFACES: Array<[string, Surface]> = [
  ['DashboardRenderer', (schema, dataSource) => <DashboardRenderer schema={schema} dataSource={dataSource} />],
  ['DashboardGridLayout', (schema, dataSource) => <DashboardGridLayout schema={schema} dataSource={dataSource} />],
];

const renderOn = (surface: Surface, schema: DashboardComponentSchema) =>
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      {surface(schema, source())}
    </I18nProvider>,
  );

describe.each(SURFACES)('%s — a dataset-bound metric tile on two lines (objectui#12573)', (_name, surface) => {
  it('draws the title alone above the value and the measure label under it, each once (objectui#12623)', async () => {
    const { container } = renderOn(surface, dashboard([METRIC]));
    // The answered tile: only the answer names the measure label.
    const value = await screen.findByText('1964500');
    const heading = screen.getByTestId('dataset-metric-heading');

    expect(within(heading).getByTestId('dataset-metric-title')).toHaveTextContent('Total Pipeline');
    expect(within(heading).queryByTestId('dataset-metric-label')).toBeNull();
    expect(heading.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(value.nextElementSibling).toBe(screen.getByTestId('dataset-metric-label'));
    expect(screen.getByTestId('dataset-metric-label')).toHaveTextContent('Total Amount');
    expect(container.textContent?.match(/Total Amount/g)).toHaveLength(1);
    // No card header: the title is drawn once, in the tile.
    expect(screen.getAllByText('Total Pipeline')).toHaveLength(1);
  });

  it('carries the description, then the measure label, as the title tooltip, the description drawn nowhere else', async () => {
    const { container } = renderOn(surface, dashboard([METRIC]));
    await screen.findByText('1964500');

    expect(screen.getByTestId('dataset-metric-title')).toHaveAttribute('title', 'Sum of open opportunity value\nTotal Amount');
    expect(container.textContent).not.toContain('Sum of open opportunity value');
  });

  it.each([
    ['table', TABLE],
    ['chart', CHART],
  ])('CONTROL: a dataset-bound %s keeps its card header and draws no metric heading', async (_kind, widget) => {
    const { container } = renderOn(surface, dashboard([widget]));
    const header = await screen.findByText(widget.title);

    expect(header).toHaveAttribute('title', widget.title);
    expect(container.querySelector('[data-testid="dataset-metric-heading"]')).toBeNull();
  });
});

describe('DashboardGridLayout — the metric tile keeps its edit-mode drag handle (objectui#12573)', () => {
  const tileOf = (title: string) => {
    const item = screen.getByText(title).closest('.react-grid-item');
    expect(item).not.toBeNull();
    return item as HTMLElement;
  };

  it('draws one `.drag-handle` on the metric tile in edit mode, and none out of it', async () => {
    renderOn(SURFACES[1]![1], dashboard([METRIC, TABLE]));
    // The answered metric (the table draws the same number in a cell).
    await screen.findByTestId('dataset-metric-label');

    expect(tileOf('Total Pipeline').querySelectorAll('.drag-handle')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /Edit Layout/ }));

    const metricTile = tileOf('Total Pipeline');
    const handles = metricTile.querySelectorAll('.drag-handle');
    expect(handles).toHaveLength(1);
    // The handle is the element react-grid-layout starts a drag from
    // (`dragConfig.handle: ".drag-handle"`), and the item is draggable.
    expect(metricTile.className).toContain('react-draggable');
    // Still two lines in edit mode: the heading row is drawn, no header.
    expect(within(metricTile).getByTestId('dataset-metric-heading')).toBeInTheDocument();
    expect(within(metricTile).getAllByText('Total Pipeline')).toHaveLength(1);

    // CONTROL: the table keeps its handle in its card header, beside the title.
    const tableTile = tileOf('Pipeline Table');
    const tableHandles = tableTile.querySelectorAll('.drag-handle');
    expect(tableHandles).toHaveLength(1);
    expect(tableHandles[0]!.parentElement).toBe(screen.getByText('Pipeline Table').parentElement);
  });
});

describe('DashboardRenderer — `layout.h` keeps its meaning on a positioned grid (objectui#12573 triage scope 1)', () => {
  it('CONTROL: metric, chart and table each span their declared rows over the unchanged row floor', async () => {
    const widgets = [
      { ...METRIC, layout: { x: 0, y: 0, w: 3, h: 2 } },
      { ...CHART, layout: { x: 3, y: 0, w: 4, h: 4 } },
      { ...TABLE, layout: { x: 7, y: 0, w: 5, h: 3 } },
    ];
    const { container } = renderOn(SURFACES[0]![1], dashboard(widgets, { columns: 12 }));
    await screen.findByTestId('dataset-metric-label');

    const grid = container.querySelector('[style*="grid-auto-rows"]') as HTMLElement | null;
    expect(grid?.style.gridAutoRows).toBe('minmax(5rem, auto)');

    const spanOf = (el: Element) => (el.closest('[style*="grid-row"]') as HTMLElement).style.gridRow;
    expect(spanOf(screen.getByTestId('dataset-metric-heading'))).toBe('span 2');
    expect(spanOf(screen.getByText('Pipeline Chart'))).toBe('span 4');
    expect(spanOf(screen.getByText('Pipeline Table'))).toBe('span 3');
  });
});
