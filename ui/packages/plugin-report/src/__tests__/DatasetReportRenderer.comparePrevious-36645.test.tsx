/**
 * objectstack-ai/objectstack#36645 item 3 — 「Compare with previous period」
 * beside a report's period chip.
 *
 * The switch is the viewer's, like the period pick. While it is on and the
 * period names a window, the embedded chart's dataset query carries the
 * contract's `compareTo: { kind: 'previousPeriod', dimension }` and the chart
 * draws the earlier window beside the current one: a muted `comparison`
 * series on a bar / line chart, the previous number and the change under a
 * single number. The table beside the chart is not asked for a comparison.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import { DatasetReportRenderer } from '../DatasetReportRenderer';

// Radix Select opens on pointer events the DOM environment does not implement;
// the shim the dateRange test uses.
beforeAll(() => {
  class MockPointerEvent extends Event {
    button: number;
    ctrlKey: boolean;
    pointerType: string;
    constructor(type: string, props: PointerEventInit = {}) {
      super(type, props);
      this.button = props.button ?? 0;
      this.ctrlKey = props.ctrlKey ?? false;
      this.pointerType = props.pointerType ?? 'mouse';
    }
  }
  Object.assign(window, { PointerEvent: MockPointerEvent });
  Object.assign(HTMLElement.prototype, {
    hasPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    scrollIntoView: vi.fn(),
  });
});

// The chart's field-metadata read (`/api/v1/meta/object/...`) answers from a
// double for the whole file: it can run after a test body returns.
vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));

let chartProps: Record<string, any> | null = null;

beforeEach(() => {
  chartProps = null;
  ComponentRegistry.register('chart', (props: any) => {
    chartProps = props;
    return null;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * A dataset source that answers like the executor: with `compareTo` in the
 * selection, every row also carries `<measure>__compare`.
 */
function makeSource(opts: { refuseCompare?: boolean } = {}) {
  const selections: any[] = [];
  return {
    selections,
    queryDataset: vi.fn(async (_dataset: string, selection: any) => {
      selections.push(selection);
      if (selection.compareTo && opts.refuseCompare) {
        throw new Error('[dataset-executor] compareTo needs a dated window to shift');
      }
      const compare = !!selection.compareTo;
      const dims: string[] = selection.dimensions ?? [];
      const rows = dims.length === 0
        ? [{ amount: 50, ...(compare ? { amount__compare: 40 } : {}) }]
        : [
          { stage: 'Won', amount: 30, ...(compare ? { amount__compare: 20 } : {}) },
          { stage: 'Lost', amount: 10, ...(compare ? { amount__compare: 15 } : {}) },
        ];
      return {
        rows,
        fields: [{ name: 'amount', label: 'Amount', aggregate: 'sum' }],
        object: 'opportunity',
        dimensionFields: { stage: 'stage' },
        drillRawRows: rows.map((r) => ({ stage: 'stage' in r ? String(r.stage).toLowerCase() : undefined })),
        drillScopes: { amount: {} },
      };
    }),
  };
}

const BASE = {
  name: 'pipeline',
  type: 'summary',
  dataset: 'opportunity_metrics',
  rows: ['stage'],
  values: ['amount'],
  dateRange: { dimension: 'close_date', defaultRange: 'last_30_days' },
};

function renderReport(
  report: Record<string, unknown>,
  src: ReturnType<typeof makeSource>,
  opts: { language?: string; onDrill?: (args: unknown) => void } = {},
) {
  return render(
    <I18nProvider config={{ defaultLanguage: opts.language ?? 'en', detectBrowserLanguage: false }}>
      <SchemaRendererProvider dataSource={undefined}>
        <DatasetReportRenderer report={report} dataSource={src} onDrill={opts.onDrill} />
      </SchemaRendererProvider>
    </I18nProvider>,
  );
}

const compareSwitch = () => screen.getByRole('switch');
const chartSelections = (src: ReturnType<typeof makeSource>) =>
  src.selections.filter((s) => (s.dimensions ?? []).length <= 1 && !s.totals);

describe('「Compare with previous period」 on a report (objectstack-ai/objectstack#36645)', () => {
  it('is off at first: the switch is offered, and no query carries compareTo', async () => {
    const src = makeSource();
    renderReport({ ...BASE, chart: { type: 'bar', xAxis: 'stage', yAxis: 'amount' } }, src);
    await waitFor(() => expect(chartProps?.schema?.series).toBeDefined());
    expect(screen.getByTestId('report-compare-previous')).toHaveTextContent('Compare with previous period');
    expect(compareSwitch()).not.toBeChecked();
    for (const selection of src.selections) expect(selection).not.toHaveProperty('compareTo');
    expect(chartProps!.schema.series.map((s: any) => s.dataKey)).toEqual(['amount']);
  });

  it('turned on, the chart queries the previous period on the window dimension and draws it as a comparison series', async () => {
    const src = makeSource();
    renderReport({ ...BASE, chart: { type: 'bar', xAxis: 'stage', yAxis: 'amount' } }, src);
    await waitFor(() => expect(chartProps?.schema?.series).toBeDefined());
    const before = src.selections.length;

    fireEvent.click(compareSwitch());
    await waitFor(() => expect(chartProps!.schema.series).toHaveLength(2));
    expect(compareSwitch()).toBeChecked();

    // Exactly one new query: the chart's. It keeps its window and adds compareTo.
    const after = src.selections.slice(before);
    expect(after).toHaveLength(1);
    expect(after[0].compareTo).toEqual({ kind: 'previousPeriod', dimension: 'close_date' });
    expect(after[0].timeDimensions).toEqual([{ dimension: 'close_date', dateRange: 'last_30_days' }]);
    expect(after[0].dimensions).toEqual(['stage']);

    const [current, previous] = chartProps!.schema.series;
    expect(current).toMatchObject({ dataKey: 'amount', label: 'Amount' });
    expect(current.variant).toBeUndefined();
    expect(previous).toEqual({
      dataKey: 'amount__compare',
      label: 'Amount · vs previous period',
      variant: 'comparison',
      aggregate: 'sum',
    });
    // Both periods reach the chart on the same bucket.
    const won = chartProps!.schema.data.find((r: any) => r.stage === 'Won');
    expect(won).toMatchObject({ amount: 30, amount__compare: 20 });

    // Turned off again: one series, and the query no longer compares.
    fireEvent.click(compareSwitch());
    await waitFor(() => expect(chartProps!.schema.series).toHaveLength(1));
    expect(src.selections[src.selections.length - 1]).not.toHaveProperty('compareTo');
  });

  it('on the window\'s own date axis, each current bucket carries the earlier value the executor keyed onto it', async () => {
    // The executor restates the earlier window's buckets in the current
    // window's keys, pairing them by position from each window's start; the
    // chart plots those rows as they come, one comparison value per month.
    const selections: any[] = [];
    const src = {
      selections,
      queryDataset: vi.fn(async (_dataset: string, selection: any) => {
        selections.push(selection);
        const compare = !!selection.compareTo;
        const months: Array<[string, number, number]> = [['2026-09', 2, 1], ['2026-10', 2, 1], ['2026-11', 3, 1]];
        const dims: string[] = selection.dimensions ?? [];
        const rows = dims.includes('issued_on')
          ? months.map(([m, cur, prev]) => ({ issued_on: m, amount: cur, ...(compare ? { amount__compare: prev } : {}) }))
          : [{ amount: 7 }];
        return { rows, fields: [{ name: 'amount', label: 'Amount', aggregate: 'count' }], object: 'invoice', dimensionFields: { issued_on: 'issued_on' } };
      }),
    };
    renderReport(
      {
        ...BASE,
        rows: ['issued_on'],
        dateRange: { dimension: 'issued_on', defaultRange: 'last_90_days' },
        chart: { type: 'bar', xAxis: 'issued_on', yAxis: 'amount' },
      },
      src as unknown as ReturnType<typeof makeSource>,
    );
    await waitFor(() => expect(chartProps?.schema?.series).toBeDefined());
    fireEvent.click(compareSwitch());
    await waitFor(() => expect(chartProps!.schema.series).toHaveLength(2));

    const chartQuery = selections.find((s) => s.compareTo);
    expect(chartQuery).toMatchObject({
      dimensions: ['issued_on'],
      timeDimensions: [{ dimension: 'issued_on', dateRange: 'last_90_days' }],
      compareTo: { kind: 'previousPeriod', dimension: 'issued_on' },
    });
    expect(chartProps!.schema.xAxisKey).toBe('issued_on');
    expect(chartProps!.schema.data.map((r: any) => [r.issued_on, r.amount, r.amount__compare])).toEqual([
      ['2026-09', 2, 1],
      ['2026-10', 2, 1],
      ['2026-11', 3, 1],
    ]);
  });

  it('a line chart draws the comparison series too', async () => {
    const src = makeSource();
    renderReport({ ...BASE, chart: { type: 'line', xAxis: 'stage', yAxis: 'amount' } }, src);
    await waitFor(() => expect(chartProps?.schema?.series).toBeDefined());
    fireEvent.click(compareSwitch());
    await waitFor(() => expect(chartProps!.schema.series).toHaveLength(2));
    expect(chartProps!.schema.series[1].variant).toBe('comparison');
  });

  it('a mark of the earlier window drills nothing; a current mark still drills', async () => {
    const src = makeSource();
    const onDrill = vi.fn();
    renderReport({ ...BASE, chart: { type: 'bar', xAxis: 'stage', yAxis: 'amount' } }, src, { onDrill });
    await waitFor(() => expect(chartProps?.onChartClick).toBeTypeOf('function'));
    fireEvent.click(compareSwitch());
    await waitFor(() => expect(chartProps!.schema.series).toHaveLength(2));

    act(() => chartProps!.onChartClick({ category: 'Won', series: 'amount__compare' }));
    expect(onDrill).not.toHaveBeenCalled();

    act(() => chartProps!.onChartClick({ category: 'Won', series: 'amount' }));
    await waitFor(() => expect(onDrill).toHaveBeenCalledTimes(1));
  });

  it('All time names no window: the switch turns off and cannot be turned on, and nothing is compared', async () => {
    const src = makeSource();
    renderReport({ ...BASE, chart: { type: 'bar', xAxis: 'stage', yAxis: 'amount' } }, src);
    await waitFor(() => expect(chartProps?.schema?.series).toBeDefined());
    fireEvent.click(compareSwitch());
    await waitFor(() => expect(chartProps!.schema.series).toHaveLength(2));

    fireEvent.pointerDown(screen.getByRole('combobox', { name: 'Date range' }), { button: 0 });
    fireEvent.click(await screen.findByRole('option', { name: 'All time' }));

    await waitFor(() => expect(chartProps!.schema.series).toHaveLength(1));
    expect(compareSwitch()).not.toBeChecked();
    expect(compareSwitch()).toBeDisabled();
    const last = src.selections[src.selections.length - 1];
    expect(last).not.toHaveProperty('timeDimensions');
    expect(last).not.toHaveProperty('compareTo');
  });

  it('a single number shows the previous period and the change under it', async () => {
    const src = makeSource();
    renderReport({ ...BASE, chart: { type: 'metric', yAxis: 'amount' } }, src);
    await screen.findByTestId('dataset-report-metric');
    expect(screen.queryByTestId('dataset-report-metric-previous')).toBeNull();

    fireEvent.click(compareSwitch());
    const previous = await screen.findByTestId('dataset-report-metric-previous');
    expect(previous).toHaveTextContent('vs previous period');
    expect(previous).toHaveTextContent('40');
    // 50 against 40: up a quarter.
    expect(screen.getByTestId('dataset-report-metric-change')).toHaveTextContent('+25%');
    const metricQuery = chartSelections(src).find((s) => (s.dimensions ?? []).length === 0 && s.compareTo);
    expect(metricQuery?.compareTo).toEqual({ kind: 'previousPeriod', dimension: 'close_date' });
  });

  it.each([
    ['a donut', { type: 'donut', xAxis: 'stage', yAxis: 'amount' }],
    ['a table chart', { type: 'table', xAxis: 'stage', yAxis: 'amount' }],
    ['a chart split by a second dimension', { type: 'bar', xAxis: 'stage', yAxis: 'amount', seriesBy: 'owner' }],
  ])('is not offered on %s, which has no second series to draw it as', async (_name, chart) => {
    const src = makeSource();
    renderReport({ ...BASE, chart }, src);
    await screen.findByTestId('report-date-range');
    await waitFor(() => expect(src.selections.length).toBeGreaterThan(0));
    expect(screen.queryByTestId('report-compare-previous')).toBeNull();
  });

  it('is not offered on a report without a period', async () => {
    const src = makeSource();
    const { dateRange: _none, ...noPeriod } = BASE;
    renderReport({ ...noPeriod, chart: { type: 'bar', xAxis: 'stage', yAxis: 'amount' } }, src);
    await waitFor(() => expect(chartProps?.schema?.series).toBeDefined());
    expect(screen.queryByTestId('report-compare-previous')).toBeNull();
  });

  it('a refused comparison is said where the chart was, not dropped silently', async () => {
    const src = makeSource({ refuseCompare: true });
    renderReport({ ...BASE, chart: { type: 'bar', xAxis: 'stage', yAxis: 'amount' } }, src);
    await waitFor(() => expect(chartProps?.schema?.series).toBeDefined());
    fireEvent.click(compareSwitch());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('compareTo needs a dated window to shift');
  });

  it('reads 「和上一期对比」 on a zh-CN console', async () => {
    const src = makeSource();
    renderReport({ ...BASE, chart: { type: 'bar', xAxis: 'stage', yAxis: 'amount' } }, src, { language: 'zh-CN' });
    expect(await screen.findByTestId('report-compare-previous')).toHaveTextContent('和上一期对比');
  });
});
