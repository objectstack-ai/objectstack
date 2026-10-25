/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12528 nail 3 — a dataset-bound metric tile is two lines, not four.
 *
 * `DashboardRenderer` framed a dataset-bound `metric` widget in its shared
 * card: a header (the title, then the description as a paragraph under a
 * rule), then `DatasetWidget`'s tile (the value, then the measure label). Four
 * lines for one number; HotCRM's Sales Performance tiles measured about
 * 215 px. Now the card draws no header for that widget: the tile draws the
 * title and the measure label on ONE line above the value, and the
 * description is the title's tooltip. The spec declares no widget key to show
 * it inline, so it shows nowhere else.
 *
 * objectui#12623 moved the measure label off the title's line: in a 150 px
 * tile it kept its width and cut the title to two or three letters. The title
 * now owns the first line and the label is a line under the value (and rides
 * in the title's tooltip), so the two pins below that asserted the shared line
 * assert the new order. Still two lines of text above the delta for a tile
 * that is wide enough; the width rules themselves are
 * `metricTileLayout-12623.test.tsx`'s.
 *
 * CONTROL: a non-metric dataset widget (a table) keeps the card header, and
 * its description paragraph, exactly as before.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import type { DashboardComponentSchema } from '@object-ui/types';
// Module scope (AGENTS.md 测试纪律): the renderer resolves non-dataset nodes
// through the registry this barrel populates.
import '@object-ui/components';
import { DashboardRenderer } from '../DashboardRenderer';

afterEach(cleanup);

const dashboard = (...widgets: Record<string, unknown>[]): DashboardComponentSchema =>
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
  description: 'Sum of open opportunity value',
  dataset: 'opportunity_metrics',
  values: ['total_amount'],
};

function renderDashboard(...widgets: Record<string, unknown>[]) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <DashboardRenderer schema={dashboard(...widgets)} dataSource={source()} />
    </I18nProvider>,
  );
}

describe('DashboardRenderer — a dataset-bound metric tile on two lines (objectui#12528)', () => {
  it('draws the title alone on the first line, then the value, then the measure label (objectui#12623)', async () => {
    const { container } = renderDashboard(METRIC);
    // The answered tile, not the loading one: a loading tile draws the same
    // heading line, and only the answer names the measure label.
    const value = await screen.findByText('1964500');
    const heading = screen.getByTestId('dataset-metric-heading');

    expect(within(heading).getByTestId('dataset-metric-title')).toHaveTextContent('Total Pipeline');
    // The title owns its line: the measure label is not on it.
    expect(within(heading).queryByTestId('dataset-metric-label')).toBeNull();
    // The heading line comes first, then the value, then the measure label,
    // drawn once.
    expect(heading.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(value.nextElementSibling).toBe(screen.getByTestId('dataset-metric-label'));
    expect(screen.getByTestId('dataset-metric-label')).toHaveTextContent('Total Amount');
    expect(container.textContent?.match(/Total Amount/g)).toHaveLength(1);
    // No card header for this widget: the title is drawn once, in the tile.
    expect(screen.getAllByText('Total Pipeline')).toHaveLength(1);
  });

  it('draws no description paragraph, and carries the description (then the measure label) as the title tooltip', async () => {
    const { container } = renderDashboard(METRIC);
    await screen.findByText('1964500');
    const title = screen.getByTestId('dataset-metric-title');

    // objectui#12623 — the measure label rides in the tooltip on its own line,
    // the one place it survives a tile too narrow to draw it.
    expect(title).toHaveAttribute('title', 'Sum of open opportunity value\nTotal Amount');
    expect(container.querySelector('p')).toBeNull();
    expect(container.textContent).not.toContain('Sum of open opportunity value');
  });

  it('CONTROL: a non-metric dataset widget keeps its card header and description paragraph', async () => {
    const { container } = renderDashboard({
      id: 'by_stage',
      type: 'table',
      title: 'Pipeline by Stage',
      description: 'Open opportunity value at each sales stage',
      dataset: 'opportunity_metrics',
      dimensions: ['stage'],
      values: ['total_amount'],
    });

    const header = await screen.findByText('Pipeline by Stage');
    expect(header).toHaveAttribute('title', 'Pipeline by Stage');
    const paragraph = screen.getByText('Open opportunity value at each sales stage');
    expect(paragraph.tagName).toBe('P');
    expect(container.querySelector('[data-testid="dataset-metric-heading"]')).toBeNull();
  });
});
