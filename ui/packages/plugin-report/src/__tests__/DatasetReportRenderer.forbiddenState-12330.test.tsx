// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A report whose dataset the viewer may not read shows the localized
 * no-access state, not the adapter's raw refusal (objectui#12330).
 *
 * Measured in a browser on HotCRM at `@objectstack/*` 18.0.0-next.0: a user
 * with no read on the dataset's object opened a report, the dataset query
 * answered 403, and the page drew a red error box reading `Analytics query
 * refused: this user may not read the data behind dataset "…". (server said:
 * [Analytics] Access denied: reading "…" is not permitted for this user.)`.
 * A dashboard tile refused the same way already drew its localized no-access
 * panel (objectui#10899), because `DatasetWidget` classifies the rejection
 * through the shared `classifyLoadError`. The report's dataset read had no such
 * branch.
 *
 * The rejection below carries the two fields `@object-ui/data-objectstack`'s
 * `AnalyticsForbiddenError` declares for this refusal (`httpStatus: 403`,
 * `code: 'PERMISSION_DENIED'`). The adapter half (that a 403 `PERMISSION_DENIED`
 * answer is thrown as exactly that) is pinned in the adapter's
 * `queryDataset.forbidden-10899.test.ts`. The class is not imported here:
 * this package does not depend on the adapter, and the renderer never reads the
 * class, only the two fields the classifier reads.
 *
 * Any other failure keeps its error box, so a real error is not hidden behind
 * "no access".
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { DatasetReportRenderer } from '../DatasetReportRenderer';

const RAW =
  'Analytics query refused: this user may not read the data behind dataset "opportunity_metrics". ' +
  '(server said: [Analytics] Access denied: reading "crm_opportunity" is not permitted for this user.)';

/** Everything the refusal names that must never reach the page. */
const SERVER_TEXT = /Analytics query refused|server said|Access denied|crm_opportunity|opportunity_metrics/;

/** The rejection `@object-ui/data-objectstack` throws for a 403 `PERMISSION_DENIED`. */
function refusal(fields: { httpStatus?: number; code?: string } = { httpStatus: 403, code: 'PERMISSION_DENIED' }) {
  return Object.assign(new Error(RAW), { name: 'AnalyticsForbiddenError', ...fields });
}

function refusingSource(error: unknown = refusal()) {
  return { queryDataset: vi.fn(async () => { throw error; }) };
}

const SUMMARY = {
  name: 'pipeline_coverage_by_quarter',
  type: 'summary',
  dataset: 'opportunity_metrics',
  rows: ['stage'],
  values: ['amount'],
} as const;

const MATRIX = {
  name: 'pipeline_by_stage_and_quarter',
  type: 'matrix',
  dataset: 'opportunity_metrics',
  rows: ['stage'],
  columns: ['quarter'],
  values: ['amount'],
} as const;

let chartRenders = 0;

beforeEach(() => {
  chartRenders = 0;
  ComponentRegistry.register('chart', () => {
    chartRenders += 1;
    return <div data-testid="chart-rendered" />;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DatasetReportRenderer: a read refusal renders the no-access state (objectui#12330)', () => {
  it.each([
    ['the adapter’s shape (403 + PERMISSION_DENIED)', { httpStatus: 403, code: 'PERMISSION_DENIED' }],
    ['a status alone (403)', { httpStatus: 403 }],
    ['a code alone (PERMISSION_DENIED)', { code: 'PERMISSION_DENIED' }],
  ])('%s: shows the no-access state and none of the server text', async (_label, fields) => {
    render(<DatasetReportRenderer report={SUMMARY as never} dataSource={refusingSource(refusal(fields)) as never} />);

    const state = await screen.findByTestId('dataset-report-forbidden');
    expect(state).toHaveTextContent('You don’t have access');
    expect(state).toHaveTextContent('You don’t have permission to view the data behind this report.');
    expect(screen.getByTestId('dataset-report')).not.toHaveTextContent(SERVER_TEXT);
  });

  it('is localized: a zh console reads the zh state', async () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        <DatasetReportRenderer report={SUMMARY as never} dataSource={refusingSource() as never} />
      </I18nProvider>,
    );

    const state = await screen.findByTestId('dataset-report-forbidden');
    expect(state).toHaveTextContent('无权访问');
    expect(state).toHaveTextContent('你没有查看该报表数据的权限。');
    expect(state).not.toHaveTextContent('You don’t have access');
  });

  it('the cross-tab draws the same state', async () => {
    render(<DatasetReportRenderer report={MATRIX as never} dataSource={refusingSource() as never} />);

    await screen.findByTestId('dataset-report-forbidden');
    expect(screen.getByTestId('dataset-report')).not.toHaveTextContent(SERVER_TEXT);
  });

  it('each joined block draws its own state', async () => {
    const joined = {
      name: 'pipeline_overview',
      type: 'joined',
      blocks: [
        { name: 'by_stage', type: 'summary', dataset: 'opportunity_metrics', rows: ['stage'], values: ['amount'] },
        { name: 'by_quarter', type: 'matrix', dataset: 'opportunity_metrics', rows: ['stage'], columns: ['quarter'], values: ['amount'] },
      ],
    };
    render(<DatasetReportRenderer report={joined as never} dataSource={refusingSource() as never} />);

    await waitFor(() => expect(screen.getAllByTestId('dataset-report-forbidden')).toHaveLength(2));
    expect(screen.getByTestId('dataset-joined-report')).not.toHaveTextContent(SERVER_TEXT);
  });

  it('a report with a chart draws the state ONCE: the chart adds no second state and no plot', async () => {
    const src = refusingSource();
    render(
      <DatasetReportRenderer
        report={{ ...SUMMARY, chart: { type: 'bar', xAxis: 'stage', yAxis: 'amount' } } as never}
        dataSource={src as never}
      />,
    );

    await screen.findByTestId('dataset-report-forbidden');
    // Both the chart's own query and the table's were refused.
    expect(src.queryDataset).toHaveBeenCalledTimes(2);
    expect(screen.getAllByTestId('dataset-report-forbidden')).toHaveLength(1);
    expect(screen.queryByTestId('chart-rendered')).toBeNull();
    expect(chartRenders).toBe(0);
    expect(screen.queryByText('Loading chart…')).toBeNull();
    expect(screen.getByTestId('dataset-report')).not.toHaveTextContent(SERVER_TEXT);
  });

  it('CONTROL: a 500 keeps the error box and its text, and draws no no-access state', async () => {
    const failure = Object.assign(new Error('Analytics query failed: the dataset query could not run.'), {
      httpStatus: 500,
      code: 'ANALYTICS_QUERY_FAILED',
    });
    render(<DatasetReportRenderer report={SUMMARY as never} dataSource={refusingSource(failure) as never} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Analytics query failed: the dataset query could not run.');
    expect(screen.queryByTestId('dataset-report-forbidden')).toBeNull();
  });
});
