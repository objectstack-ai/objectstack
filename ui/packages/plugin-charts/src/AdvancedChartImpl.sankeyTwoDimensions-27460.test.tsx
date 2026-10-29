/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * A sankey with TWO dimensions draws every (first → second dimension) flow
 * (objectstack#27460).
 *
 * `buildChartSeries` pivots a second dimension into series when the chart
 * carries one measure: one row per first-dimension value, one series per
 * second-dimension value. The sankey arm read `series[0]` alone, so a
 * `status × category` task count drew ONE root node (the first category,
 * `Alpha`) and its 3 / 2 / 2 flows, and the `Beta` and `Gamma` columns were
 * dropped with nothing on the chart saying so. The pivot is built here with
 * the same helper the dashboard widget and the inline chart call, so the
 * fixture is the shape the arm is really handed.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { buildChartSeries } from '@object-ui/core';

/** Every `data` prop the Sankey was rendered with, newest last. */
const sankeyData: Array<{ nodes: Array<{ name: string }>; links: Array<{ source: number; target: number; value: number }> }> = [];

vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: 480, height: 320 }),
    Sankey: (props: any) => {
      sankeyData.push(props.data);
      return <actual.Sankey {...props} />;
    },
  };
});

import AdvancedChartImpl from './AdvancedChartImpl';

afterEach(() => {
  cleanup();
  sankeyData.length = 0;
});

/** The dataset's answer: one row per (status, category) combination it found. */
const FLAT = [
  { status: 'Open', category: 'Alpha', task_count: 3 },
  { status: 'Open', category: 'Beta', task_count: 1 },
  { status: 'Done', category: 'Alpha', task_count: 2 },
  { status: 'Done', category: 'Gamma', task_count: 4 },
  { status: 'Blocked', category: 'Alpha', task_count: 2 },
  { status: 'Blocked', category: 'Beta', task_count: 5 },
];

const pivot = (rows: Array<Record<string, unknown>>) =>
  buildChartSeries(rows, ['status', 'category'], ['task_count']);

const renderPivot = (rows: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => {
  const { data, xAxisKey, series } = pivot(rows);
  return render(
    <AdvancedChartImpl
      chartType="sankey"
      data={data as any}
      xAxisKey={xAxisKey}
      series={series as any}
      isAnimationActive={false}
      {...extra}
    />,
  );
};

/** The drawn flows as `source → target: value`, read off the Sankey's own data. */
const drawnFlows = () => {
  const { nodes, links } = sankeyData[sankeyData.length - 1];
  return links.map((l) => `${nodes[l.source].name} → ${nodes[l.target].name}: ${l.value}`);
};

const noteTexts = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-chart-note="omitted-rows"]')].map((n) => n.textContent);

describe('objectstack#27460 — a two-dimension sankey draws every flow', () => {
  it('the fixture is a real pivot: three first-dimension rows, three series', () => {
    const { data, series } = pivot(FLAT);
    expect(data.map((r) => r.status)).toEqual(['Open', 'Done', 'Blocked']);
    expect(series.map((s) => s.label)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('draws one flow per (status, category) cell, valued by the measure', () => {
    const { container } = renderPivot(FLAT);
    expect(drawnFlows()).toEqual([
      'Open → Alpha: 3',
      'Open → Beta: 1',
      'Done → Alpha: 2',
      'Done → Gamma: 4',
      'Blocked → Alpha: 2',
      'Blocked → Beta: 5',
    ]);
    expect(container.querySelectorAll('.recharts-sankey-link')).toHaveLength(6);
    // Every first- and second-dimension value is a node, each drawn with its name.
    expect([...container.querySelectorAll('.recharts-sankey-node-label')].map((t) => t.textContent).sort()).toEqual(
      ['Alpha', 'Beta', 'Blocked', 'Done', 'Gamma', 'Open'],
    );
  });

  it('a combination the dataset did not answer is no flow and no omission', () => {
    // Open × Gamma, Done × Beta and Blocked × Gamma have no records: the pivot
    // writes no column for them, and the chart is complete.
    const { container } = renderPivot(FLAT);
    expect(noteTexts(container)).toEqual([]);
    expect(container.querySelector('[data-chart-error]')).toBeNull();
  });

  it('a carried cell that is not above zero is dropped, and the chart says so', () => {
    const rows = FLAT.map((r) => (r.status === 'Open' && r.category === 'Beta' ? { ...r, task_count: -1 } : r));
    const { container } = renderPivot(rows);
    expect(drawnFlows()).not.toContain('Open → Beta: -1');
    expect(drawnFlows()).toHaveLength(5);
    expect(noteTexts(container)).toEqual([
      'Showing 1 of 2 rows — 1 row has no Beta above zero, which a flow cannot draw.',
    ]);
  });

  it('no carried cell above zero is the no-positive-flow refusal, naming every column', () => {
    const rows = FLAT.map((r) => ({ ...r, task_count: 0 }));
    const { container } = renderPivot(rows);
    const refusal = container.querySelector('[data-chart-error="no-positive-flow"]');
    expect(refusal).not.toBeNull();
    expect([...refusal!.querySelectorAll('code')].map((c) => c.textContent)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('a flow click drills to its one cell; a node click does not drill', () => {
    const onChartClick = vi.fn();
    const { container } = renderPivot(FLAT, { onChartClick });
    const links = container.querySelectorAll('.recharts-sankey-link');
    fireEvent.click(links[3]);
    expect(onChartClick).toHaveBeenCalledTimes(1);
    expect(onChartClick).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'Done', series: 'Gamma', seriesLabel: 'Gamma', value: 4 }),
    );
    onChartClick.mockClear();
    for (const node of container.querySelectorAll('.recharts-sankey-node')) fireEvent.click(node);
    expect(onChartClick).not.toHaveBeenCalled();
  });
});

describe('objectstack#27460 — CONTROL: a one-series sankey is unchanged', () => {
  const ROWS = [
    { stage: 'New business', amount: 40 },
    { stage: 'Upsell', amount: 25 },
  ];

  it('flows from the measure root to each category', () => {
    render(
      <AdvancedChartImpl
        chartType="sankey"
        data={ROWS as any}
        xAxisKey="stage"
        series={[{ dataKey: 'amount', label: 'Amount' }] as any}
        isAnimationActive={false}
      />,
    );
    expect(drawnFlows()).toEqual(['Amount → New business: 40', 'Amount → Upsell: 25']);
  });

  it('a comparison overlay is never a flow: one current series stays one-level', () => {
    render(
      <AdvancedChartImpl
        chartType="sankey"
        data={ROWS.map((r) => ({ ...r, amount__compare: 10 })) as any}
        xAxisKey="stage"
        series={[
          { dataKey: 'amount', label: 'Amount', variant: 'current' },
          { dataKey: 'amount__compare', label: 'Amount · previous period', variant: 'comparison' },
        ] as any}
        isAnimationActive={false}
      />,
    );
    expect(drawnFlows()).toEqual(['Amount → New business: 40', 'Amount → Upsell: 25']);
  });
});
