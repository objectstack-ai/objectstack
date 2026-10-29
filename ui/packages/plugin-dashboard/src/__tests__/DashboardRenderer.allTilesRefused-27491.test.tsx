/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27491 — a viewer whose every dashboard tile is refused sees one
 * no-access statement, not the header over an empty canvas.
 *
 * Each refused dataset tile is still left out (objectstack#26971, pinned in
 * `DashboardRenderer.refusedTile-26971.test.tsx`). When that leaves nothing to
 * draw, the canvas shows the console's refused-dashboard face once
 * (`dashboard-all-widgets-forbidden`). A partial refusal keeps reflowing with
 * no message; design mode keeps every tile and its own no-access state
 * (objectui#10899); a failure that is not a read refusal keeps its tiles and
 * their errors.
 *
 * The refusal carries the two fields `@object-ui/data-objectstack`'s
 * `AnalyticsForbiddenError` declares (`httpStatus: 403`,
 * `code: 'PERMISSION_DENIED'`), as `DatasetWidget.forbiddenState-10899.test.tsx`
 * builds it.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import type { DashboardComponentSchema } from '@object-ui/types';
// Module scope (AGENTS.md 测试纪律): the table tile renders onward through the
// registry this barrel populates.
import '@object-ui/components';
import { DashboardRenderer } from '../DashboardRenderer';

beforeEach(() => {
  // The dimension-label metadata probe (`useDatasetDimensionMeta`) falls back
  // to the global fetch; answer it locally so no case reaches the network.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const dashboard = (...widgets: Record<string, unknown>[]): DashboardComponentSchema =>
  ({ type: 'dashboard', name: 'pipeline_dashboard', title: 'Pipeline Dashboard', widgets }) as unknown as DashboardComponentSchema;

const TOTAL_PIPELINE = {
  id: 'total_pipeline',
  type: 'metric',
  title: 'Total Pipeline',
  dataset: 'opportunity_metrics',
  values: ['total_amount'],
};
const BY_STAGE = {
  id: 'pipeline_by_stage',
  type: 'table',
  title: 'Pipeline by Stage',
  dataset: 'opportunity_metrics',
  dimensions: ['stage'],
  values: ['deal_count'],
};
const READABLE = {
  id: 'open_tasks',
  type: 'table',
  title: 'Open Tasks',
  dataset: 'task_metrics',
  dimensions: ['status'],
  values: ['task_count'],
};

function readRefusal() {
  return Object.assign(new Error('Analytics query refused: this user may not read the data behind dataset "opportunity_metrics".'), {
    name: 'AnalyticsForbiddenError',
    httpStatus: 403,
    code: 'PERMISSION_DENIED',
  });
}

/** Refuses `opportunity_metrics` with `failure()`; answers every other dataset. */
function source(failure: () => Error = readRefusal) {
  return {
    queryDataset: vi.fn(async (dataset: string) => {
      if (dataset === 'opportunity_metrics') throw failure();
      return {
        rows: [{ status: 'Open', task_count: 4 }],
        fields: [
          { name: 'status', label: 'Status', type: 'text' },
          { name: 'task_count', label: 'Tasks', type: 'number' },
        ],
        object: 'task',
      };
    }),
  };
}

describe('DashboardRenderer — every tile refused draws one no-access panel (objectstack#27491)', () => {
  it('draws the panel once every tile is refused, and no tile title or per-tile face', async () => {
    const src = source();
    render(<DashboardRenderer schema={dashboard(TOTAL_PIPELINE, BY_STAGE)} dataSource={src} />);

    const panel = await screen.findByTestId('dashboard-all-widgets-forbidden');
    expect(panel).toHaveTextContent('You don’t have access');
    expect(panel).toHaveTextContent('You don’t have permission to view the data behind this dashboard.');
    // Both tiles were asked: the panel follows the server's refusals, never a guess.
    expect(src.queryDataset).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Total Pipeline')).toBeNull();
    expect(screen.queryByText('Pipeline by Stage')).toBeNull();
    expect(screen.queryByTestId('dataset-widget-forbidden')).toBeNull();
  });

  it('draws the same panel in the mobile layout', async () => {
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 500 });
    try {
      const { container } = render(<DashboardRenderer schema={dashboard(TOTAL_PIPELINE, BY_STAGE)} dataSource={source()} />);

      expect(await screen.findByTestId('dashboard-all-widgets-forbidden')).toBeInTheDocument();
      // Non-vacuity: the mobile layout is the one drawn (its metric row is a 2-column grid).
      expect(container.innerHTML).toContain('grid-cols-2');
      expect(screen.queryByText('Total Pipeline')).toBeNull();
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
    }
  });

  it('a partial refusal draws no panel and keeps the readable tile', async () => {
    const src = source();
    render(<DashboardRenderer schema={dashboard(TOTAL_PIPELINE, READABLE, BY_STAGE)} dataSource={src} />);

    expect(await screen.findByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Open Tasks')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Pipeline by Stage')).toBeNull());
    expect(screen.queryByText('Total Pipeline')).toBeNull();
    expect(screen.queryByTestId('dashboard-all-widgets-forbidden')).toBeNull();
  });

  it('CONTROL — in design mode every refused tile stays with its own no-access state, and no panel', async () => {
    render(
      <DashboardRenderer
        schema={dashboard(TOTAL_PIPELINE, BY_STAGE)}
        dataSource={source()}
        designMode
        onWidgetClick={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getAllByTestId('dataset-widget-forbidden')).toHaveLength(2));
    expect(screen.getByTestId('dashboard-preview-widget-total_pipeline')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-preview-widget-pipeline_by_stage')).toHaveTextContent('Pipeline by Stage');
    expect(screen.queryByTestId('dashboard-all-widgets-forbidden')).toBeNull();
  });

  it('CONTROL — a failure that is not a read refusal keeps every tile and its error, and no panel', async () => {
    render(
      <DashboardRenderer
        schema={dashboard(TOTAL_PIPELINE, BY_STAGE)}
        dataSource={source(() => new Error('Dataset query failed: 400 Bad Request — relationship not declared in include'))}
      />,
    );

    await waitFor(() => expect(screen.getAllByText(/relationship not declared in include/)).toHaveLength(2));
    expect(screen.getByText('Total Pipeline')).toBeInTheDocument();
    expect(screen.getByText('Pipeline by Stage')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-all-widgets-forbidden')).toBeNull();
  });
});
