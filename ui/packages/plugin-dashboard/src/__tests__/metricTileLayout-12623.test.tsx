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
      rows: [{ total_amount: 1964500 }],
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
    await screen.findByText('1964500');
    const title = screen.getByTestId('dataset-metric-title');
    expectTitleRule(title);
    // Alone on its line: the heading row holds the title and nothing else.
    expect(screen.getByTestId('dataset-metric-heading').children).toHaveLength(1);
  });

  it('draws the value unwrapped, one step smaller below a 160 px tile', async () => {
    renderTile();
    expectValueRule(await screen.findByText('1964500'));
  });

  it('draws the measure label under the value, 11 px, hidden below a 160 px tile, and keeps it in the tooltip', async () => {
    renderTile();
    const value = await screen.findByText('1964500');
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
    const value = await screen.findByText('1964500');
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
