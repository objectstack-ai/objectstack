/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7258 — the SURFACE pin for the built-in aggregate label seam, on
 * the widget the card was measured on: an AI-built customer dashboard's
 * "customers by status" bar, whose three category labels were already
 * localized (合作中 / 已流失 / 潜在) while the measure title read `Count`.
 *
 * The pure halves are pinned in `@object-ui/core` (`chart-series.builtinAggregate`)
 * and `@object-ui/i18n` (`builtinAggregateLabels-locale-parity-7258`). What
 * neither can show is the WIRING — that `DatasetWidget` actually resolves the
 * six strings through its provider and hands them to `buildChartSeries` — and
 * a seam nothing wires is the exact "declared but dead" shape this repo hunts.
 * So this file renders the widget under a real `I18nProvider` and reads the
 * series it handed the chart renderer.
 *
 * DIRECTIONS, written before the reverse verification was run: the zh
 * built-in case is RED before the change (the series reads `Count`); the `en`
 * case and both "verbatim" cases are GREEN on both sides.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { DatasetWidget } from '../DatasetWidget';

/** The slice of the chart renderer's props this file reads. */
interface CapturedChart {
  schema?: { series?: Array<{ dataKey: string; label?: string }>; data?: Array<Record<string, unknown>> };
}

/** Capture what the widget hands the chart renderer (jsdom lays out no SVG). */
let capturedChartProps: CapturedChart | null = null;
beforeAll(() => {
  ComponentRegistry.register('chart', (props: unknown) => {
    capturedChartProps = props as CapturedChart;
    return null;
  });
});

vi.mock('../DrillDownDrawer', () => ({ DrillDownDrawer: () => null }));

beforeEach(() => {
  // No `object` on the result, so the widget has no definition to probe; the
  // stub is here so any escape onto the network is loud rather than swallowed.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
});

afterEach(() => {
  cleanup();
  capturedChartProps = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The card's rows: categories already localized by the server. */
const ROWS = [
  { status: '合作中', count: 3 },
  { status: '已流失', count: 1 },
  { status: '潜在', count: 2 },
];

/** What objectstack#14492 puts on the wire for the server's built-in count. */
const BUILTIN_COUNT = { name: 'count', type: 'number', label: 'Count', builtinAggregate: 'count' };
const STATUS = { name: 'status', type: 'string', label: 'Status' };

type WidgetSource = React.ComponentProps<typeof DatasetWidget>['dataSource'];

const sourceOf = (fields: Array<Record<string, unknown>>, rows: Array<Record<string, unknown>> = ROWS) =>
  ({ queryDataset: vi.fn(async () => ({ rows, fields })) }) as unknown as WidgetSource;

function renderIn(language: string, dataSource: WidgetSource, values = ['count']) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: {} }}>
      <DatasetWidget
        widget={{ type: 'bar', dataset: 'customers_by_status', dimensions: ['status'], values }}
        dataSource={dataSource}
      />
    </I18nProvider>,
  );
}

/** The series labels the widget handed the renderer — the legend / axis text. */
const seriesLabels = (): Array<string | undefined> =>
  (capturedChartProps?.schema?.series ?? []).map((s) => s.label);

describe('DatasetWidget — the built-in aggregate title follows the locale (objectui#7258)', () => {
  it('zh: the server`s built-in count draws under 计数, not the wire`s English Count', async () => {
    renderIn('zh', sourceOf([STATUS, BUILTIN_COUNT]));
    await waitFor(() => expect(seriesLabels()).toEqual(['计数']));
    // The category labels are untouched by the seam — they were already right.
    expect((capturedChartProps?.schema?.data ?? []).map((r) => r.status)).toEqual(['合作中', '已流失', '潜在']);
  });

  it('en: the same wire field draws under Count', async () => {
    renderIn('en', sourceOf([STATUS, BUILTIN_COUNT]));
    await waitFor(() => expect(seriesLabels()).toEqual(['Count']));
  });

  it('zh: an author-declared measure keeps its verbatim label (objectui#4106)', async () => {
    const rows = ROWS.map(({ status, count }) => ({ status, opp_count: count }));
    renderIn('zh', sourceOf([STATUS, { name: 'opp_count', type: 'number', label: 'Opportunities' }], rows), [
      'opp_count',
    ]);
    await waitFor(() => expect(seriesLabels()).toEqual(['Opportunities']));
  });

  it('zh: a measure literally named `count` with NO discriminator keeps its own label', async () => {
    // Option A, rejected, stated on the surface: neither the name nor the
    // English text switches the lookup on — only the structural field does.
    renderIn('zh', sourceOf([STATUS, { name: 'count', type: 'number', label: 'Count' }]));
    await waitFor(() => expect(seriesLabels()).toEqual(['Count']));
  });
});
