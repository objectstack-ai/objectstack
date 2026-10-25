// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12677 — a period-over-period delta from a zero baseline.
 *
 * A wire row `{ task_count: 10, task_count__compare: 0 }` drew the tile
 * "↑100% vs previous period": `computeMetricDelta` hard-coded `100` whenever the
 * previous value was 0. Going from 0 to 10 is not a 100% increase; a percent
 * change from zero is undefined. The delta now keeps its direction and states
 * no percentage (`value: null`), and every reader draws that as an em dash.
 *
 * The spec declares no spelling for "new from zero" (neither the dashboard
 * widget's `compareTo` nor `object-metric`'s), so the face is a symbol, not a
 * word: no locale pack carries it.
 *
 * Each surface that draws the delta is pinned here on the zero baseline, with
 * its two controls: `0 → 0` stays neutral at `0%`, and a non-zero baseline
 * keeps today's percentage.
 *   - the dataset-bound metric tile (`dataset-compare-trend`);
 *   - the cross-tab's in-cell comparison (`matrix-cell-compare`);
 *   - `ObjectMetricWidget`, whose derived trend `MetricWidget` paints.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import { DatasetWidget } from '../DatasetWidget';
import { ObjectMetricWidget, type ObjectMetricWidgetProps } from '../ObjectMetricWidget';

afterEach(cleanup);

const DASH = '—';
const Q2 = { close_date: { $gte: '2026-04-01', $lte: '2026-06-30' } };

const datasetSource = (rows: Record<string, unknown>[], fields: unknown[]) => ({
  queryDataset: vi.fn(async () => ({ rows, fields })),
});

const metricTile = (current: number, previous: number) =>
  render(
    <DatasetWidget
      widget={{
        type: 'metric', dataset: 'tasks', values: ['task_count'],
        filter: { ...Q2 }, compareTo: { kind: 'previousPeriod' },
      }}
      dataSource={datasetSource(
        [{ task_count: current, task_count__compare: previous }],
        [{ name: 'task_count', type: 'number', label: 'Tasks' }, { name: 'task_count__compare', type: 'number' }],
      )}
    />,
  );

describe('DatasetWidget metric tile — zero baseline (objectui#12677)', () => {
  it('draws 0 → 10 as an up arrow and a dash, never "100%"', async () => {
    metricTile(10, 0);
    const trend = await screen.findByTestId('dataset-compare-trend');
    const badge = trend.firstElementChild as HTMLElement;
    expect(badge.textContent).toBe(DASH);
    expect(trend).not.toHaveTextContent('%');
    expect(trend).not.toHaveTextContent('100');
    expect(badge.className).toMatch(/text-emerald-600/);
    expect(badge.querySelector('svg')).not.toBeNull();
    expect(trend).toHaveTextContent(/vs previous period/i);
  });

  it('draws 0 → -10 as a down dash', async () => {
    metricTile(-10, 0);
    const badge = (await screen.findByTestId('dataset-compare-trend')).firstElementChild as HTMLElement;
    expect(badge.textContent).toBe(DASH);
    expect(badge.className).toMatch(/text-rose-600/);
  });

  it('keeps 0 → 0 neutral at 0%', async () => {
    metricTile(0, 0);
    const badge = (await screen.findByTestId('dataset-compare-trend')).firstElementChild as HTMLElement;
    expect(badge.textContent).toBe('0%');
    expect(badge.className).toMatch(/text-muted-foreground/);
  });

  it('keeps a non-zero baseline at its percentage', async () => {
    metricTile(120, 100);
    const badge = (await screen.findByTestId('dataset-compare-trend')).firstElementChild as HTMLElement;
    expect(badge.textContent).toBe('20%');
  });
});

describe('DatasetWidget cross-tab cell — zero baseline (objectui#12677)', () => {
  it('stacks a dash under a cell whose comparison is 0, and keeps the others', async () => {
    const src = datasetSource(
      [
        { status: 'Open', priority: 'High', amount: 120, amount__compare: 0 },
        { status: 'Open', priority: 'Low', amount: 0, amount__compare: 0 },
        { status: 'Done', priority: 'High', amount: 120, amount__compare: 100 },
      ],
      [
        { name: 'status', type: 'string', label: 'Status' },
        { name: 'priority', type: 'string', label: 'Priority' },
        { name: 'amount', type: 'number', label: 'Amount' },
        { name: 'amount__compare', type: 'number' },
      ],
    );
    render(
      <DatasetWidget
        widget={{
          type: 'pivot', dataset: 'deals', dimensions: ['status', 'priority'], values: ['amount'],
          filter: { ...Q2 }, title: 'Deals', compareTo: { kind: 'previousYear' },
        }}
        dataSource={src}
      />,
    );
    const m = await screen.findByTestId('dataset-matrix');
    const cells = (label: string) =>
      [...(within(m).getByText(label).closest('tr') as HTMLElement).querySelectorAll('td')] as HTMLElement[];
    const deltaOf = (cell: HTMLElement) => {
      const stack = within(cell).getByTestId('matrix-cell-compare');
      return { stack, badge: stack.lastElementChild as HTMLElement };
    };

    const fromZero = deltaOf(cells('Open')[1]);
    expect(fromZero.stack).toHaveAttribute('data-direction', 'up');
    expect(fromZero.badge.textContent).toBe(DASH);
    expect(fromZero.stack).not.toHaveTextContent('%');

    const flatZero = deltaOf(cells('Open')[2]);
    expect(flatZero.stack).toHaveAttribute('data-direction', 'neutral');
    expect(flatZero.badge.textContent).toBe('0%');

    const nonZero = deltaOf(cells('Done')[1]);
    expect(nonZero.badge.textContent).toBe('20%');
  });
});

describe('ObjectMetricWidget — zero baseline (objectui#12677)', () => {
  // The current window's own start, resolved the way the widget resolves
  // `{current_quarter_start}` — the fixture used by `ObjectMetricWidget.compareTo`.
  const quarterStart = (d: Date) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const CURRENT_FROM = iso(quarterStart(new Date()));
  const renderWidget = (current: number, previous: number, extra: Record<string, unknown> = {}) => {
    const src = {
      aggregate: vi.fn(async (_object: string, q: { filter?: { created_at?: { $gte?: unknown } } }) => [
        { task_count: String(q?.filter?.created_at?.$gte) === CURRENT_FROM ? current : previous },
      ]),
    };
    render(
      <ObjectMetricWidget
        objectName="task"
        label="Tasks"
        aggregate={{ field: 'task', function: 'count' }}
        filter={{ created_at: { $gte: '{current_quarter_start}', $lte: '{current_quarter_end}' } }}
        compareTo={{ kind: 'previousYear' }}
        dataSource={src as unknown as ObjectMetricWidgetProps['dataSource']}
        {...extra}
      />,
    );
    return src;
  };

  it('draws 0 → 10 as a dash, never "100%"', async () => {
    const src = renderWidget(10, 0);
    await waitFor(() => expect(src.aggregate).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(DASH)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.getByText(/vs last year/i)).toBeInTheDocument();
  });

  it('replaces an authored trend with the dash rather than falling back to it', async () => {
    renderWidget(10, 0, { trend: { value: 99, direction: 'down', label: 'authored' } });
    expect(await screen.findByText(DASH)).toBeInTheDocument();
    expect(screen.queryByText('99%')).not.toBeInTheDocument();
  });

  it('keeps 0 → 0 neutral at 0%', async () => {
    renderWidget(0, 0);
    expect(await screen.findByText('0%')).toBeInTheDocument();
    expect(screen.queryByText(DASH)).not.toBeInTheDocument();
  });

  it('keeps a non-zero baseline at its percentage', async () => {
    renderWidget(120, 100);
    expect(await screen.findByText('20%')).toBeInTheDocument();
  });
});
