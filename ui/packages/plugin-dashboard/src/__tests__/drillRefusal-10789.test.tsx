/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A drill whose filter this layer refuses is reported, not thrown, on the two
 * dashboard widgets that compose one — objectui#10789.
 *
 *  - `ObjectPivotTable` composed its filter with the clicked cell while
 *    RENDERING the drawer, so the click re-rendered the pivot into a
 *    `FilterOperatorError` and the error boundary.
 *  - `DatasetWidget` composes the widget filter with the clicked bucket inside
 *    its click handler, which threw out uncaught.
 *
 * Both lower through `composeDrillFilter` → `mergeFilterNodes`, the THROWING
 * converter form, and a spec `$not` — declared by `@objectstack/spec`, carried
 * by the widget's own read — is refused there. The pins assert the widget
 * stays mounted, no drawer opens and nothing is navigated to (never with the
 * scope dropped), and the refusal is logged naming the operator.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry, chartRowBucketId, type ChartSegmentClickEvent } from '@object-ui/core';
import { DrillNavigationProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';

/** Observe what reaches the drawer, if anything does. */
const drawerProps: Array<{ filter: unknown }> = [];
vi.mock('../DrillDownDrawer', () => ({
  DrillDownDrawer: ({ filter }: { filter: unknown }) => {
    drawerProps.push({ filter });
    return <div data-testid="drill-drawer" />;
  },
}));

import { ObjectPivotTable } from '../ObjectPivotTable';
import { DatasetWidget } from '../DatasetWidget';

/** `$not` — declared by the spec, refused by this layer's converter. */
const REFUSED = { $not: { region: 'apac' } };

let capturedChartProps: any = null;
beforeAll(() => {
  ComponentRegistry.register('chart', (props: any) => {
    capturedChartProps = props;
    return null;
  });
});

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  capturedChartProps = null;
  drawerProps.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const refusalWarnings = () =>
  warn.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.includes('drill-down refused'));

const ROWS = [
  { id: 'a', stage: 'won', source: 'web', region: 'emea', amount: 10 },
  { id: 'b', stage: 'won', source: 'web', region: 'apac', amount: 20 },
];

function renderPivot(filter: unknown, target: 'drawer' | 'navigate') {
  const openRecordList = vi.fn();
  render(
    <DrillNavigationProvider value={{ openRecordList }}>
      <ObjectPivotTable
        schema={{
          type: 'pivot',
          objectName: 'crm_opportunity',
          rowField: 'stage',
          columnField: 'source',
          valueField: 'amount',
          aggregation: 'sum',
          data: ROWS,
          filter,
          drillDown: { enabled: true, target },
        } as any}
        dataSource={{ find: vi.fn(async () => ({ data: [] })) }}
      />
    </DrillNavigationProvider>,
  );
  return openRecordList;
}

/**
 * The spec's own refusal, the drill seam's second refusing step: the array
 * dialect passes the converter untouched and `parseFilterAST` refuses a scalar
 * on a list operator.
 */
const SPEC_REFUSED = [['region', 'in', 'emea']];

describe('ObjectPivotTable — a refused drill filter (objectui#10789)', () => {
  it.each([
    ['converter refusal', 'drawer', REFUSED, '$not'],
    ['converter refusal', 'navigate', REFUSED, '$not'],
    ['spec refusal (array dialect)', 'drawer', SPEC_REFUSED, '$in'],
    ['spec refusal (array dialect)', 'navigate', SPEC_REFUSED, '$in'],
  ] as const)('%s, target %s — the pivot stays, nothing opens, the refusal is logged', (_label, target, filter, operator) => {
    const openRecordList = renderPivot(filter, target);
    fireEvent.click(screen.getByLabelText('Drill into stage=won, source=web'));

    // Still mounted: the click did not throw the pivot into a boundary.
    expect(screen.getByLabelText('Drill into stage=won, source=web')).toBeTruthy();
    expect(drawerProps).toHaveLength(0);
    expect(openRecordList).not.toHaveBeenCalled();
    expect(refusalWarnings()).toHaveLength(1);
    expect(refusalWarnings()[0]).toContain(operator);
  });

  it('CONTROL — a well-formed pivot filter still opens the drawer, scoped', () => {
    renderPivot({ region: 'emea' }, 'drawer');
    fireEvent.click(screen.getByLabelText('Drill into stage=won, source=web'));
    expect(drawerProps.length).toBeGreaterThan(0);
    expect(JSON.stringify(drawerProps[0].filter)).toContain('emea');
    expect(refusalWarnings()).toHaveLength(0);
  });
});

function renderDatasetWidget(filter: unknown) {
  const dataSource = {
    queryDataset: vi.fn(async () => ({
      rows: [{ status: 'Open', est_hours: 3 }],
      fields: [
        { name: 'status', type: 'text', label: 'Status' },
        { name: 'est_hours', type: 'number', label: 'Hours' },
      ],
      object: 'proj_task',
      dimensionFields: { status: 'status_id' },
      drillRawRows: [{ status: 'open' }],
    })),
  };
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false, resources: {} }}>
      <DatasetWidget
        widget={{
          type: 'bar',
          dataset: 'hours_by_status',
          dimensions: ['status'],
          values: ['est_hours'],
          filter,
          drillDown: { enabled: true },
        } as any}
        dataSource={dataSource as any}
      />
    </I18nProvider>,
  );
}

/** Click the first drawn bucket of the first series, the way the chart would. */
const clickFirstSegment = () => {
  const series = capturedChartProps.schema.series[0];
  const row = capturedChartProps.schema.data[0];
  const ev: ChartSegmentClickEvent = {
    category: String(row[capturedChartProps.schema.xAxisKey]),
    categoryId: chartRowBucketId(row),
    series: series.dataKey,
    seriesLabel: series.label,
    value: row[series.dataKey],
  };
  capturedChartProps.onSegmentClick(ev);
};

describe('DatasetWidget — a refused drill filter (objectui#10789)', () => {
  it.each([
    ['converter refusal', REFUSED, '$not'],
    // Object dialect, passed by the converter, refused by the spec's lowering.
    ['spec refusal', { owner: { $in: 'me' } }, '$in'],
  ] as const)('%s — opens no drawer and logs the refusal instead of throwing from the click', async (_label, filter, operator) => {
    renderDatasetWidget(filter);
    await waitFor(() => expect(capturedChartProps?.onSegmentClick).toBeTypeOf('function'));

    expect(() => clickFirstSegment()).not.toThrow();
    expect(screen.queryByTestId('drill-drawer')).toBeNull();
    expect(drawerProps).toHaveLength(0);
    expect(refusalWarnings()).toHaveLength(1);
    expect(refusalWarnings()[0]).toContain(operator);
  });

  it('CONTROL — a well-formed widget filter still opens the drawer, scoped', async () => {
    renderDatasetWidget({ owner: 'me' });
    await waitFor(() => expect(capturedChartProps?.onSegmentClick).toBeTypeOf('function'));
    React.act(() => clickFirstSegment());
    await waitFor(() => expect(drawerProps.length).toBeGreaterThan(0));
    expect(JSON.stringify(drawerProps[drawerProps.length - 1].filter)).toContain('owner');
    expect(refusalWarnings()).toHaveLength(0);
  });
});
