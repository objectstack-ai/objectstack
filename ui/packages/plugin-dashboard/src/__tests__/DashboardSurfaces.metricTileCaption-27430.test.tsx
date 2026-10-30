/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27430 row 2 — a dataset-bound `metric` tile captions its value
 * with the widget's `description` when one is authored, and with the measure
 * label otherwise.
 *
 * The tile drew the measure label ("Total Amount") under every value, and the
 * widget's `description` (the spec's `DashboardWidget.description`, "Widget
 * description text below the header"), which says what the number counts,
 * only in the title's tooltip. Now the description is the caption, in the
 * measure label's place: the tile keeps its two lines of text, and the
 * measure label still rides in the title's tooltip, under the description.
 *
 * Pins, on both dashboard surfaces (`DashboardRenderer`, `DashboardGridLayout`):
 *  - a described metric: the caption under the value is the description, drawn
 *    once; the measure label is drawn nowhere but the tooltip;
 *  - an undescribed metric (and one whose description is empty): the caption is
 *    the measure label, as before;
 *  - an inline per-locale description map: the caption follows the UI language;
 *  - CONTROL: a dataset-bound table draws no metric caption (`DashboardRenderer`'s
 *    card-header description paragraph is pinned in
 *    `DashboardRenderer.metricTileDensity-12528.test.tsx`).
 *
 * No `dist/` is involved: the root `vitest.config.mts` aliases every
 * `@object-ui/*` specifier to that package's `src/`, and the subjects are
 * imported relatively.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import type { DashboardComponentSchema } from '@object-ui/types';
// Module scope, never inside a hook (AGENTS.md 测试纪律): both surfaces resolve
// non-dataset nodes through the registries these barrels populate.
import '@object-ui/components';
import { DashboardRenderer } from '../DashboardRenderer';
import { DashboardGridLayout } from '../DashboardGridLayout';

afterEach(cleanup);

const dashboard = (widgets: Record<string, unknown>[]): DashboardComponentSchema =>
  ({ type: 'dashboard', name: 'sales', widgets }) as unknown as DashboardComponentSchema;

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
  description: 'Open opportunities, all owners',
  dataset: 'opportunity_metrics',
  values: ['total_amount'],
};

type Surface = (schema: DashboardComponentSchema, dataSource: unknown) => React.ReactElement;

const SURFACES: Array<[string, Surface]> = [
  ['DashboardRenderer', (schema, dataSource) => <DashboardRenderer schema={schema} dataSource={dataSource} />],
  ['DashboardGridLayout', (schema, dataSource) => <DashboardGridLayout schema={schema} dataSource={dataSource} />],
];

const renderOn = (surface: Surface, schema: DashboardComponentSchema, language = 'en') =>
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      {surface(schema, source())}
    </I18nProvider>,
  );

describe.each(SURFACES)('%s — the metric tile caption (objectstack#27430)', (_name, surface) => {
  it('draws an authored description as the caption under the value, once, in place of the measure label', async () => {
    const { container } = renderOn(surface, dashboard([METRIC]));
    const value = await screen.findByText('1964500');
    const caption = screen.getByTestId('dataset-metric-label');

    expect(value.nextElementSibling).toBe(caption);
    expect(caption).toHaveTextContent('Open opportunities, all owners');
    expect(container.textContent?.match(/Open opportunities, all owners/g)).toHaveLength(1);
    // The measure label is no longer drawn; the title's tooltip still carries
    // it, under the description.
    expect(container.textContent).not.toContain('Total Amount');
    expect(screen.getByTestId('dataset-metric-title')).toHaveAttribute(
      'title',
      'Open opportunities, all owners\nTotal Amount',
    );
  });

  it.each([
    ['declares no description', undefined],
    ['declares an empty description', ''],
  ])('falls back to the measure label when the widget %s', async (_case, description) => {
    renderOn(surface, dashboard([{ ...METRIC, description }]));
    const value = await screen.findByText('1964500');

    expect(value.nextElementSibling).toBe(screen.getByTestId('dataset-metric-label'));
    expect(screen.getByTestId('dataset-metric-label')).toHaveTextContent('Total Amount');
  });

  it('follows the UI language for an inline per-locale description', async () => {
    renderOn(
      surface,
      dashboard([{ ...METRIC, description: { en: 'Open opportunities, all owners', 'zh-CN': '所有负责人的未结商机' } }]),
      'zh-CN',
    );
    await screen.findByText('1964500');

    expect(screen.getByTestId('dataset-metric-label')).toHaveTextContent('所有负责人的未结商机');
  });

  it('CONTROL: a dataset-bound table draws no metric caption', async () => {
    const { container } = renderOn(surface, dashboard([{
      id: 'by_stage',
      type: 'table',
      title: 'Pipeline by Stage',
      description: 'Open opportunity value at each sales stage',
      dataset: 'opportunity_metrics',
      dimensions: ['stage'],
      values: ['total_amount'],
    }]));

    // The answered table: its cell draws the value.
    await screen.findByText('Pipeline by Stage');
    await screen.findAllByText(/1,?964,?500/);
    expect(container.querySelector('[data-testid="dataset-metric-label"]')).toBeNull();
    expect(container.querySelector('[data-testid="dataset-metric-heading"]')).toBeNull();
  });
});
