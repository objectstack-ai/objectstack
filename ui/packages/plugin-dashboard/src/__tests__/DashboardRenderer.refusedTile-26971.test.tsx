/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26971 item 1 — a viewer who may not read the data behind a
 * dataset tile does not see a permission-error tile, and the other tiles
 * still render.
 *
 * Measured on HotCRM's Sales Performance dashboard: a viewer holding only a
 * marketing permission set saw 14 tiles answer and the 15th draw "You don't
 * have permission to view the data behind this widget" (its dataset query
 * answered 403). Outside design mode `DashboardRenderer` now leaves that tile
 * out of the layout, Card frame and title included, once the server refuses
 * the query as a READ refusal (`DatasetWidget`'s `onForbidden`). The 403 stays
 * the enforcement: nothing is hidden before the server answers.
 *
 * CONTROLS: in design mode the refused tile stays and draws the no-access
 * state (objectui#10899), so the author can still see and select it; and a
 * failure that is not a read refusal keeps the tile and its error alert.
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
  ({ type: 'dashboard', name: 'sales_performance', widgets }) as unknown as DashboardComponentSchema;

const READABLE = {
  id: 'pipeline_by_stage',
  type: 'table',
  title: 'Pipeline by Stage',
  dataset: 'opportunity_metrics',
  dimensions: ['stage'],
  values: ['deal_count'],
};
const REFUSED = {
  id: 'quota_attainment',
  type: 'table',
  title: 'Quota Attainment by Rep',
  dataset: 'forecast_metrics',
  dimensions: ['owner'],
  values: ['attainment'],
};

function readRefusal() {
  return Object.assign(new Error('Analytics query refused: this user may not read the data behind dataset "forecast_metrics".'), {
    name: 'AnalyticsForbiddenError',
    httpStatus: 403,
    code: 'PERMISSION_DENIED',
  });
}

/** Answers every dataset but `forecast_metrics`, which it refuses with `failure()`. */
function source(failure: () => Error = readRefusal) {
  return {
    queryDataset: vi.fn(async (dataset: string) => {
      if (dataset === 'forecast_metrics') throw failure();
      return {
        rows: [{ stage: 'Closed Won', deal_count: 7 }],
        fields: [
          { name: 'stage', label: 'Stage', type: 'text' },
          { name: 'deal_count', label: 'Deals', type: 'number' },
        ],
        object: 'opportunity',
      };
    }),
  };
}

describe('DashboardRenderer — a tile whose data the viewer may not read is left out (objectstack#26971)', () => {
  it('drops the refused tile, frame and title included, and keeps the readable one', async () => {
    const src = source();
    render(<DashboardRenderer schema={dashboard(READABLE, REFUSED)} dataSource={src} />);

    // The readable tile answers.
    expect(await screen.findByText('Closed Won')).toBeInTheDocument();
    expect(screen.getByText('Pipeline by Stage')).toBeInTheDocument();
    // The refused tile was asked (no client-side guess), and once the server
    // refused it, nothing of it is left: no no-access state, no titled frame.
    expect(src.queryDataset).toHaveBeenCalledWith('forecast_metrics', expect.anything());
    await waitFor(() => expect(screen.queryByText('Quota Attainment by Rep')).toBeNull());
    expect(screen.queryByTestId('dataset-widget-forbidden')).toBeNull();
    expect(screen.queryByText(/don’t have (access|permission)/)).toBeNull();
  });

  it('CONTROL — in design mode the refused tile stays and draws the no-access state', async () => {
    render(
      <DashboardRenderer
        schema={dashboard(READABLE, REFUSED)}
        dataSource={source()}
        designMode
        onWidgetClick={() => {}}
      />,
    );

    expect(await screen.findByTestId('dataset-widget-forbidden')).toHaveTextContent('You don’t have access');
    expect(screen.getByTestId('dashboard-preview-widget-quota_attainment')).toHaveTextContent('Quota Attainment by Rep');
    expect(await screen.findByText('Closed Won')).toBeInTheDocument();
  });

  it('CONTROL — a failure that is not a read refusal keeps the tile and its error', async () => {
    render(
      <DashboardRenderer
        schema={dashboard(READABLE, REFUSED)}
        dataSource={source(() => new Error('Dataset query failed: 400 Bad Request — relationship not declared in include'))}
      />,
    );

    expect(await screen.findByText(/relationship not declared in include/)).toBeInTheDocument();
    expect(screen.getByText('Quota Attainment by Rep')).toBeInTheDocument();
    expect(await screen.findByText('Closed Won')).toBeInTheDocument();
  });
});
