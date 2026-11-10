/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12623 — every metric tile follows one layout rule, measured against
 * the TILE's own box.
 *
 * After objectui#12528 / #12573 the dataset-bound tile drew its title and its
 * measure label on one line, and the label did not shrink: in a 150 px tile
 * (a dashboard at 1024 px) the title was cut to two or three letters. Now:
 *
 *  - the title owns the first line: 13 px / 500, up to two lines with an
 *    ellipsis on the second (`line-clamp-2`);
 *  - the value never wraps (`whitespace-nowrap`) and is one step smaller below
 *    a 160 px tile (`text-xl`, `@[160px]:text-2xl`);
 *  - the measure label is an 11 px muted line under the value, hidden below a
 *    160 px tile (`hidden @[160px]:block`), and always in the title's tooltip.
 *
 * The width rules are container queries, so the tile's root carries
 * `@container`: a dashboard grid, a page block and the Studio's folded canvas
 * size the same tile differently, and the viewport says nothing about any of
 * them.
 *
 * jsdom has no layout, so this file pins the CONTRACT (the classes the rule is
 * made of, and which element carries each); the measured widths are in the
 * pull request, from a browser.
 *
 * Covered: the dataset-bound tile (`DatasetWidget`, through `DashboardRenderer`),
 * the plain tiles `MetricWidget` and `MetricCard`, and the object-bound tile
 * through the registry's `object-metric` block — the node a page's KPI blocks
 * (HotCRM's Sales Home) are authored as, so they follow with no code of their
 * own.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import type { DashboardComponentSchema } from '@object-ui/types';
// Module scope (AGENTS.md 测试纪律): the barrel registers `object-metric`, and
// the dashboard renderer resolves non-dataset nodes through the registry.
import '@object-ui/components';
import '../index';
import { DashboardRenderer } from '../DashboardRenderer';
import { MetricWidget } from '../MetricWidget';
import { MetricCard } from '../MetricCard';

afterEach(cleanup);

const classesOf = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

/** The title's contract: 13 px / 500, at most two lines. */
function expectTitleRule(title: Element) {
  const cls = classesOf(title);
  expect(cls).toEqual(expect.arrayContaining(['line-clamp-2', 'text-[13px]', 'font-medium', 'min-w-0']));
  // Not one line, and not cut to one: `truncate` would clip a long title to a
  // single line again.
  expect(cls).not.toContain('truncate');
}

/** The value's contract: never wraps; 20 px below a 160 px tile, 24 px from it. */
function expectValueRule(value: Element) {
  const cls = classesOf(value);
  expect(cls).toEqual(expect.arrayContaining(['whitespace-nowrap', 'text-xl', '@[160px]:text-2xl']));
  // The 24 px step is the container variant's alone, never unconditional.
  expect(cls).not.toContain('text-2xl');
}

/** The rules are read against the tile's own box. */
function expectTileContainer(inner: Element) {
  const box = inner.closest('.\\@container');
  expect(box).not.toBeNull();
  return box as HTMLElement;
}

describe('dataset-bound metric tile — the layout rule (objectui#12623)', () => {
  const source = () => ({
    queryDataset: vi.fn(async () => ({
      // A short value: a longer one takes the dataset tile's ladder, pinned in
      // `metricTileDatasetValueScale-27520.test.tsx`.
      rows: [{ total_amount: 196450 }],
      fields: [{ name: 'total_amount', label: 'Total Amount', type: 'number' }],
    })),
  });
  const METRIC = {
    id: 'total_pipeline_value',
    type: 'metric',
    title: 'Total Pipeline Value This Quarter',
    dataset: 'opportunity_metrics',
    values: ['total_amount'],
  };
  const renderTile = () =>
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <DashboardRenderer
          schema={{ type: 'dashboard', name: 'sales', widgets: [METRIC] } as unknown as DashboardComponentSchema}
          dataSource={source()}
        />
      </I18nProvider>,
    );

  it('gives the title the first line alone, up to two lines', async () => {
    renderTile();
    await screen.findByText('196450');
    const title = screen.getByTestId('dataset-metric-title');
    expectTitleRule(title);
    // Alone on its line: the heading row holds the title and nothing else.
    expect(screen.getByTestId('dataset-metric-heading').children).toHaveLength(1);
  });

  it('draws the value unwrapped, one step smaller below a 160 px tile', async () => {
    renderTile();
    expectValueRule(await screen.findByText('196450'));
  });

  it('draws the measure label under the value, 11 px, hidden below a 160 px tile, and keeps it in the tooltip', async () => {
    renderTile();
    const value = await screen.findByText('196450');
    const label = screen.getByTestId('dataset-metric-label');

    expect(value.nextElementSibling).toBe(label);
    expect(label).toHaveTextContent('Total Amount');
    const cls = classesOf(label);
    expect(cls).toEqual(expect.arrayContaining(['hidden', '@[160px]:block', 'text-[11px]', 'text-muted-foreground']));
    // Hidden by the TILE's width, never the viewport's.
    expect(cls.some((c) => /^(sm|md|lg|xl|2xl):/.test(c))).toBe(false);
    // Below 160 px the tooltip is where the label is read.
    expect(screen.getByTestId('dataset-metric-title').getAttribute('title')).toBe('Total Pipeline Value This Quarter\nTotal Amount');
  });

  it('measures every width rule against the tile, which holds the title, the value and the label', async () => {
    renderTile();
    const value = await screen.findByText('196450');
    const box = expectTileContainer(value);
    expect(box).toContainElement(screen.getByTestId('dataset-metric-title'));
    expect(box).toContainElement(screen.getByTestId('dataset-metric-label'));
  });

  it('keeps the rule while loading: the title line is drawn in the same tile box', () => {
    renderTile();
    // Before the answer: the heading is drawn, framed in the tile's box.
    const title = screen.getByTestId('dataset-metric-title');
    expectTitleRule(title);
    expectTileContainer(title);
    expect(screen.queryByTestId('dataset-metric-label')).toBeNull();
  });
});

describe('plain metric tiles — the same rule (objectui#12623)', () => {
  const wrap = (ui: React.ReactElement) =>
    render(<I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>{ui}</I18nProvider>);

  it('MetricWidget: the title is clamped to two lines with its full text as the tooltip; the value never wraps', () => {
    wrap(<MetricWidget label="Average Deal Size This Quarter" value={4210} icon="dollar-sign" />);
    const title = screen.getByText('Average Deal Size This Quarter');
    expectTitleRule(title);
    expect(title).toHaveAttribute('title', 'Average Deal Size This Quarter');
    const value = screen.getByText('4,210');
    expectValueRule(value);
    expect(expectTileContainer(value)).toContainElement(title);
  });

  it('MetricCard: the title is clamped to two lines; the value never wraps', () => {
    wrap(<MetricCard title="Open Opportunities Across All Regions" value="128" />);
    const title = screen.getByText('Open Opportunities Across All Regions');
    expectTitleRule(title);
    const value = screen.getByText('128');
    expectValueRule(value);
    expect(expectTileContainer(value)).toContainElement(title);
  });

  it('object-metric (a page KPI block, as HotCRM Sales Home authors it) draws the plain tile, so it follows the rule', () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <SchemaRendererProvider dataSource={undefined as never}>
          <SchemaRenderer
            schema={{
              type: 'object-metric',
              properties: { objectName: 'crm_opportunity', label: 'Revenue (Won)', icon: 'dollar-sign', fallbackValue: 42 },
            } as never}
          />
        </SchemaRendererProvider>
      </I18nProvider>,
    );
    const title = screen.getByText('Revenue (Won)');
    expectTitleRule(title);
    const value = screen.getByText('42');
    expectValueRule(value);
    expect(expectTileContainer(value)).toContainElement(title);
  });
});

/**
 * objectstack#32165 — a tile never draws a subtitle that only repeats its
 * title. QA on the showcase's Chart Gallery read "Avg Progress / 47.0 / Avg
 * Progress": the dataset-bound tile's title is the widget's title, and its
 * caption fell back to the measure label, which the dataset authors with the
 * same text. One rule decides it for every tile, on the localized texts the
 * tile draws (`metricTileSubtitle` in `../metricTile`).
 */
describe('a subtitle equal to the title is not drawn (objectstack#32165)', () => {
  const wrap = (ui: React.ReactElement, language = 'en') =>
    render(<I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>{ui}</I18nProvider>);

  const datasetTile = (widget: Record<string, unknown>) =>
    wrap(
      <DashboardRenderer
        schema={{ type: 'dashboard', name: 'gallery', widgets: [widget] } as unknown as DashboardComponentSchema}
        dataSource={{
          queryDataset: vi.fn(async () => ({
            rows: [{ avg_progress: 47 }],
            fields: [{ name: 'avg_progress', label: 'Avg Progress', type: 'number' }],
          })),
        }}
      />,
    );
  const TILE = { id: 'kpi_avg_progress', type: 'metric', dataset: 'task_metrics', values: ['avg_progress'] };

  it('dataset-bound tile: a measure label equal to the title draws no caption, and the tooltip names it once', async () => {
    datasetTile({ ...TILE, title: 'Avg Progress' });
    await screen.findByText('47');
    expect(screen.queryByTestId('dataset-metric-label')).toBeNull();
    // The caption's line is kept, empty and hidden from assistive tech, so
    // tiles side by side keep their lines aligned.
    const spacer = screen.getByTestId('dataset-metric-label-spacer');
    expect(spacer).toHaveAttribute('aria-hidden', 'true');
    expect(spacer.textContent?.trim()).toBe('');
    expect(screen.getAllByText('Avg Progress')).toHaveLength(1);
    expect(screen.getByTestId('dataset-metric-title')).toHaveAttribute('title', 'Avg Progress');
  });

  it('dataset-bound tile: equal up to case and spacing still counts as the title', async () => {
    datasetTile({ ...TILE, title: '  avg   progress ' });
    await screen.findByText('47');
    expect(screen.queryByTestId('dataset-metric-label')).toBeNull();
  });

  it('dataset-bound tile: a description equal to the title gives way to a distinct measure label', async () => {
    datasetTile({ ...TILE, title: 'Task Progress', description: 'Task Progress' });
    await screen.findByText('47');
    expect(screen.getByTestId('dataset-metric-label')).toHaveTextContent('Avg Progress');
  });

  it('CONTROL dataset-bound tile: a distinct measure label is still the caption', async () => {
    datasetTile({ ...TILE, title: 'Task Progress' });
    await screen.findByText('47');
    expect(screen.getByTestId('dataset-metric-label')).toHaveTextContent('Avg Progress');
    expect(screen.getByTestId('dataset-metric-title')).toHaveAttribute('title', 'Task Progress\nAvg Progress');
  });

  it('MetricWidget: a description equal to the label is not drawn', () => {
    const { container } = wrap(<MetricWidget label="Revenue" value={42} description="Revenue" />);
    expect(screen.getAllByText('Revenue')).toHaveLength(1);
    expect(container.querySelector('.text-muted-foreground.mt-1')).toBeNull();
  });

  it('MetricWidget: the localized description is compared with the localized label', () => {
    wrap(
      <MetricWidget label={{ en: 'Revenue', 'zh-CN': '收入' }} value={42} description={{ en: 'Booked revenue', 'zh-CN': '收入' }} />,
      'zh-CN',
    );
    expect(screen.getAllByText('收入')).toHaveLength(1);
  });

  it('MetricWidget: the trend label is kept, and takes the place of a description that repeats the label', () => {
    wrap(<MetricWidget label="Revenue" value={42} description="Revenue" trend={{ value: 12, direction: 'up', label: 'vs last month' }} />);
    expect(screen.getAllByText('Revenue')).toHaveLength(1);
    expect(screen.getByText('vs last month')).toBeInTheDocument();
  });

  it('CONTROL MetricWidget: a distinct description is drawn', () => {
    wrap(<MetricWidget label="Revenue" value={42} description="Closed-won, this quarter" />);
    expect(screen.getByText('Closed-won, this quarter')).toBeInTheDocument();
  });

  it('MetricCard: a description equal to the title is not drawn; a distinct one is (CONTROL)', () => {
    wrap(<MetricCard title="Open Deals" value="12" description="Open Deals" />);
    expect(screen.getAllByText('Open Deals')).toHaveLength(1);
    cleanup();
    wrap(<MetricCard title="Open Deals" value="12" description="All owners" />);
    expect(screen.getByText('All owners')).toBeInTheDocument();
  });

  it('object-metric: a description equal to the label is not drawn', () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <SchemaRendererProvider dataSource={undefined as never}>
          <SchemaRenderer
            schema={{
              type: 'object-metric',
              properties: { objectName: 'crm_opportunity', label: 'Revenue (Won)', description: 'Revenue (Won)', fallbackValue: 42 },
            } as never}
          />
        </SchemaRendererProvider>
      </I18nProvider>,
    );
    expect(screen.getAllByText('Revenue (Won)')).toHaveLength(1);
  });
});

/**
 * objectstack#32165 — a dataset-bound metric tile sits in the middle of its
 * card. The card spans its grid rows (two 5 rem rows, 176 px measured), the
 * tile's content is about 90 px, and it drew at the top of an empty card. The
 * card is now a column whose body takes the rest of the box; the tile's
 * `justify-center` centres it. jsdom has no layout: this pins the classes; the
 * measured heights are in the pull request.
 */
describe('a dataset-bound metric tile is centred in its card (objectstack#32165)', () => {
  it('makes the card a column and the body fill it; a chart card is untouched (CONTROL)', async () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <DashboardRenderer
          schema={{
            type: 'dashboard',
            name: 'gallery',
            columns: 12,
            widgets: [
              { id: 'kpi', type: 'metric', title: 'Total Tasks', dataset: 'task_metrics', values: ['task_count'], layout: { x: 0, y: 0, w: 4, h: 2 } },
              { id: 'tbl', type: 'table', title: 'By Status', dataset: 'task_metrics', dimensions: ['status'], values: ['task_count'], layout: { x: 4, y: 0, w: 8, h: 4 } },
            ],
          } as unknown as DashboardComponentSchema}
          dataSource={{
            queryDataset: vi.fn(async () => ({
              rows: [{ task_count: 10, status: 'done' }],
              fields: [
                { name: 'task_count', label: 'Tasks', type: 'number' },
                { name: 'status', label: 'Status', type: 'text' },
              ],
            })),
          }}
        />
      </I18nProvider>,
    );
    const caption = await screen.findByTestId('dataset-metric-label');
    const tile = caption.closest('.justify-center') as HTMLElement;
    expect(tile).not.toBeNull();
    const body = tile.parentElement!.parentElement!;
    const card = body.parentElement!;
    expect(card).toHaveClass('flex', 'flex-col');
    expect(body).toHaveClass('flex', 'flex-1', 'flex-col');
    expect(tile.parentElement).toHaveClass('flex-1');

    const tableCard = screen.getByText('By Status').closest('.overflow-hidden') as HTMLElement;
    expect(tableCard).not.toHaveClass('flex-col');
  });
});
