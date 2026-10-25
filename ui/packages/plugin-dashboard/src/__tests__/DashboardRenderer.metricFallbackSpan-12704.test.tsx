/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12704 — on a dashboard that declares `columns`, a metric widget
 * with no `layout` spans ONE row, the height the Studio designer gives a new
 * widget. It used to span two: the row floor is 5rem and a one-row tile grows
 * to its content, so the second row was the tile's empty lower half.
 *
 * What the tile's height then is, in a browser, is pinned by
 * `e2e/dashboard-metric-tile-height.spec.ts`; jsdom has no layout, so this file
 * pins the span the renderer writes.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import type { DashboardComponentSchema } from '@object-ui/types';
// Module scope, never inside a hook (AGENTS.md 测试纪律): the table resolves
// through the registry this barrel populates.
import '@object-ui/components';
import { DashboardRenderer } from '../DashboardRenderer';

afterEach(cleanup);

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

const renderDashboard = (widgets: Record<string, unknown>[]) =>
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <DashboardRenderer
        schema={{ type: 'dashboard', name: 'sales', columns: 12, widgets } as unknown as DashboardComponentSchema}
        dataSource={source()}
      />
    </I18nProvider>,
  );

/** The grid item's inline span, read off the nearest ancestor that carries one. */
const spanOf = (el: Element) => {
  const item = el.closest('[style*="grid-row"]') as HTMLElement | null;
  expect(item).not.toBeNull();
  return { column: item!.style.gridColumn, row: item!.style.gridRow };
};

describe('DashboardRenderer — the default span of a layout-less widget on a positioned grid (objectui#12704)', () => {
  it('gives a metric with no layout one row, quarter width', async () => {
    renderDashboard([METRIC]);
    await screen.findByText('1964500');

    expect(spanOf(screen.getByTestId('dataset-metric-heading'))).toEqual({ column: 'span 3', row: 'span 1' });
  });

  it('CONTROL: a metric with an authored layout keeps its own h', async () => {
    renderDashboard([{ ...METRIC, layout: { x: 0, y: 0, w: 4, h: 2 } }]);
    await screen.findByText('1964500');

    expect(spanOf(screen.getByTestId('dataset-metric-heading'))).toEqual({ column: 'span 4', row: 'span 2' });
  });

  it('CONTROL: a table with no layout keeps four rows, half width', async () => {
    renderDashboard([TABLE]);

    expect(spanOf(await screen.findByText('Pipeline Table'))).toEqual({ column: 'span 6', row: 'span 4' });
  });
});
