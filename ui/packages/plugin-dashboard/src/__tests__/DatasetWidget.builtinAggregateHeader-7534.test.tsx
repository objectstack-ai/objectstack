/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7534 — the SURFACE pin for the other half of the built-in aggregate
 * seam: the captions that resolve through `buildDatasetFieldHelpers().header
 * Label` rather than through `buildChartSeries()`.
 *
 * `DatasetWidget.builtinAggregateLabel` (#7258) next door proves the chart
 * legend reads `计数`. This one proves the KPI caption and the table column
 * header beside it say the same word — the visible defect this card is about
 * was a dashboard whose bar legend read `计数` over a table header that still
 * read `Count`.
 *
 * Pure resolution order lives in `@object-ui/core`
 * (`dataset-format.builtinAggregate-7534`); what only a render can show is the
 * WIRING — that this widget resolves the six strings from its provider and
 * passes them into the helper. A declared-but-unwired seam is exactly the
 * shape #7258 was split to avoid repeating.
 *
 * DIRECTIONS, written before the reverse verification: both zh cases are RED
 * before the change (the caption/header read `Count`); the `en` case and the
 * author-declared case are GREEN on both sides.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { DatasetWidget } from '../DatasetWidget';

vi.mock('../DrillDownDrawer', () => ({ DrillDownDrawer: () => null }));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** What objectstack#14492 puts on the wire for the server's built-in count. */
const BUILTIN_COUNT = { name: 'count', type: 'number', label: 'Count', builtinAggregate: 'count' };
const STATUS = { name: 'status', type: 'string', label: 'Status' };

type WidgetSource = React.ComponentProps<typeof DatasetWidget>['dataSource'];

const sourceOf = (fields: Array<Record<string, unknown>>, rows: Array<Record<string, unknown>>) =>
  ({ queryDataset: vi.fn(async () => ({ rows, fields })) }) as unknown as WidgetSource;

function renderWidget(language: string, widget: Record<string, unknown>, dataSource: WidgetSource) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: {} }}>
      <DatasetWidget widget={widget} dataSource={dataSource} />
    </I18nProvider>,
  );
}

describe('DatasetWidget KPI caption — the built-in measure follows the locale (objectui#7534)', () => {
  const metricWidget = { type: 'metric', dataset: 'customer_count', dimensions: [], values: ['count'] };

  it('zh: the caption under the number reads 计数', async () => {
    renderWidget('zh', metricWidget, sourceOf([BUILTIN_COUNT], [{ count: 6 }]));
    expect(await screen.findByText('计数')).toBeTruthy();
    expect(screen.queryByText('Count')).toBeNull();
  });

  it('en: the same wire field captions Count', async () => {
    renderWidget('en', metricWidget, sourceOf([BUILTIN_COUNT], [{ count: 6 }]));
    expect(await screen.findByText('Count')).toBeTruthy();
  });

  it('zh: an author-declared measure keeps its verbatim label (objectui#4106)', async () => {
    const authored = { name: 'opp_count', type: 'number', label: 'Opportunities' };
    renderWidget(
      'zh',
      { type: 'metric', dataset: 'opps', dimensions: [], values: ['opp_count'] },
      sourceOf([authored], [{ opp_count: 6 }]),
    );
    expect(await screen.findByText('Opportunities')).toBeTruthy();
  });
});

describe('DatasetWidget table header — the built-in measure follows the locale (objectui#7534)', () => {
  const rows = [
    { status: '合作中', count: 3 },
    { status: '已流失', count: 1 },
  ];
  const tableWidget = { type: 'table', dataset: 'customers_by_status', dimensions: ['status'], values: ['count'] };

  it('zh: the measure column header reads 计数, not the wire`s English Count', async () => {
    renderWidget('zh', tableWidget, sourceOf([STATUS, BUILTIN_COUNT], rows));
    await waitFor(() => expect(screen.getByText('计数')).toBeTruthy());
    expect(screen.queryByText('Count')).toBeNull();
  });

  it('en: the same header reads Count', async () => {
    renderWidget('en', tableWidget, sourceOf([STATUS, BUILTIN_COUNT], rows));
    await waitFor(() => expect(screen.getByText('Count')).toBeTruthy());
  });
});
