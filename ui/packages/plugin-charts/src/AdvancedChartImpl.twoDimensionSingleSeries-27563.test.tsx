/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * A pie, donut, funnel or treemap with TWO dimensions draws every group, or
 * refuses on the tile; it never draws the first group alone (objectstack#27563).
 *
 * `buildChartSeries` pivots a second dimension into series when the chart
 * carries one measure: one row per first-dimension value, one series per
 * second-dimension value. These four arms read `series[0]` alone, so a
 * `stage × owner` amount drew only `Ann`'s amounts, and `Bo` and `Cy` were
 * dropped with nothing on the chart saying so. The pivot is built here with
 * the same helper the dashboard widget and the inline chart call, so the
 * fixture is the shape the arms are really handed.
 *
 * - treemap draws every cell, nested under its first-dimension value;
 * - pie, donut and funnel have no geometry for a second series, so they refuse
 *   on the tile and name every group, instead of drawing the first one.
 *
 * The marks are read off the props each recharts element was rendered with,
 * not off jsdom pixels, which are not deterministic for a pie.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { buildChartSeries } from '@object-ui/core';

/** Every `data` prop each recharts element was rendered with, newest last. */
const drawn = {
  pie: [] as Array<{ data: Array<Record<string, unknown>>; dataKey: string }>,
  funnel: [] as Array<{ data: Array<Record<string, unknown>>; dataKey: string }>,
  treemap: [] as Array<Array<Record<string, any>>>,
  treemapProps: [] as Array<Record<string, any>>,
};

vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: 480, height: 320 }),
    Pie: (props: any) => {
      drawn.pie.push({ data: props.data, dataKey: props.dataKey });
      return <actual.Pie {...props} />;
    },
    Funnel: (props: any) => {
      drawn.funnel.push({ data: props.data, dataKey: props.dataKey });
      return <actual.Funnel {...props} />;
    },
    Treemap: (props: any) => {
      drawn.treemap.push(props.data);
      drawn.treemapProps.push(props);
      return <actual.Treemap {...props} />;
    },
  };
});

import AdvancedChartImpl from './AdvancedChartImpl';

afterEach(() => {
  cleanup();
  drawn.pie.length = 0;
  drawn.funnel.length = 0;
  drawn.treemap.length = 0;
  drawn.treemapProps.length = 0;
});

/** The dataset's answer: one row per (stage, owner) combination it found. */
const FLAT = [
  { stage: 'Prospect', owner: 'Ann', amount: 100 },
  { stage: 'Prospect', owner: 'Bo', amount: 50 },
  { stage: 'Proposal', owner: 'Ann', amount: 80 },
  { stage: 'Proposal', owner: 'Cy', amount: 40 },
  { stage: 'Won', owner: 'Bo', amount: 120 },
];

const pivot = (rows: Array<Record<string, unknown>>) =>
  buildChartSeries(rows, ['stage', 'owner'], ['amount']);

const oneDimension = (rows: Array<Record<string, unknown>>) =>
  buildChartSeries(rows, ['stage'], ['amount']);

const renderChart = (
  chartType: string,
  chart: { data: Array<Record<string, unknown>>; xAxisKey: string; series: unknown[] },
  extra: Record<string, unknown> = {},
) =>
  render(
    <AdvancedChartImpl
      chartType={chartType as any}
      data={chart.data as any}
      xAxisKey={chart.xAxisKey}
      series={chart.series as any}
      isAnimationActive={false}
      {...extra}
    />,
  );

/** The ONE-dimension aggregate of the same records: the regression control's input. */
const BY_STAGE = [
  { stage: 'Prospect', amount: 150 },
  { stage: 'Proposal', amount: 120 },
  { stage: 'Won', amount: 120 },
];

/** The drawn treemap as `parent: leaf=size, …` per first-dimension value. */
const treemapCells = () =>
  drawn.treemap[drawn.treemap.length - 1].map(
    (n) => `${n.name}: ${(n.children ?? []).map((c: any) => `${c.name}=${c.size}`).join(', ')}`,
  );

const refusalOf = (container: HTMLElement) => container.querySelector('[data-chart-error]');
const noteTexts = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-chart-note]')].map((n) => n.textContent);

describe('objectstack#27563 — a two-dimension single-series chart draws every group or refuses', () => {
  it('the fixture is a real pivot: three first-dimension rows, three series', () => {
    const { data, series } = pivot(FLAT);
    expect(data.map((r) => r.stage)).toEqual(['Prospect', 'Proposal', 'Won']);
    expect(series.map((s) => s.label)).toEqual(['Ann', 'Bo', 'Cy']);
  });

  describe('treemap draws every cell, nested under its first-dimension value', () => {
    it('one leaf per (stage, owner) cell the dataset answered, sized by the measure', () => {
      const { container } = renderChart('treemap', pivot(FLAT));
      expect(treemapCells()).toEqual([
        'Prospect: Prospect / Ann=100, Prospect / Bo=50',
        'Proposal: Proposal / Ann=80, Proposal / Cy=40',
        'Won: Won / Bo=120',
      ]);
      // A combination with no records (Prospect × Cy, …) is no leaf and no omission.
      expect(noteTexts(container)).toEqual([]);
      expect(refusalOf(container)).toBeNull();
      // Recharts laid out and painted all five leaves.
      expect(container.querySelectorAll('.recharts-treemap-depth-2')).toHaveLength(5);
    });

    it('the leaves of one first-dimension value share its colour; the values differ', () => {
      renderChart('treemap', pivot(FLAT));
      const parents = drawn.treemap[drawn.treemap.length - 1];
      for (const p of parents) {
        for (const leaf of p.children) expect(leaf.fill).toBe(p.fill);
      }
      expect(new Set(parents.map((p) => p.fill)).size).toBe(parents.length);
    });

    it('a carried cell that is not above zero is not drawn, and the chart says which group lost it', () => {
      const rows = FLAT.map((r) => (r.stage === 'Won' && r.owner === 'Bo' ? { ...r, amount: -5 } : r));
      const { container } = renderChart('treemap', pivot(rows));
      expect(treemapCells()).toEqual([
        'Prospect: Prospect / Ann=100, Prospect / Bo=50',
        'Proposal: Proposal / Ann=80, Proposal / Cy=40',
      ]);
      expect(noteTexts(container)).toEqual([
        '1 of 2 rows has no Bo above zero — this chart sizes by value, so that row is not drawn to scale.',
      ]);
    });

    it('no cell above zero is the magnitude refusal, naming every group it tested', () => {
      const rows = FLAT.map((r) => ({ ...r, amount: 0 }));
      const { container } = renderChart('treemap', pivot(rows));
      expect(refusalOf(container)?.getAttribute('data-chart-error')).toBe('no-positive-magnitude');
      expect([...refusalOf(container)!.querySelectorAll('code')].map((c) => c.textContent)).toEqual(['Ann', 'Bo', 'Cy']);
      expect(drawn.treemap).toHaveLength(0);
    });

    it('clicking a leaf drills to its cell: the first-dimension value and the group', () => {
      const onChartClick = vi.fn();
      renderChart('treemap', pivot(FLAT), { onChartClick });
      const leaf = { ...drawn.treemap[drawn.treemap.length - 1][1].children[1], depth: 2 };
      drawn.treemapProps[drawn.treemapProps.length - 1].onClick(leaf);
      expect(onChartClick).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'Proposal', series: 'Cy', seriesLabel: 'Cy', value: 40 }),
      );
    });

    it('REGRESSION: a one-dimension treemap draws exactly as before, one flat leaf per row', () => {
      const { container } = renderChart('treemap', oneDimension(BY_STAGE));
      expect(drawn.treemap[drawn.treemap.length - 1].map((n) => `${n.name}=${n.size}`)).toEqual([
        'Prospect=150',
        'Proposal=120',
        'Won=120',
      ]);
      expect(drawn.treemap[drawn.treemap.length - 1].every((n) => n.children === undefined)).toBe(true);
      expect(refusalOf(container)).toBeNull();
    });

    it('REGRESSION: a comparison overlay is not a group — a compared treemap stays one level', () => {
      const { data, xAxisKey, series } = oneDimension(BY_STAGE);
      renderChart('treemap', {
        data,
        xAxisKey,
        series: [
          { ...series[0], variant: 'current' },
          { dataKey: 'amount__compare', label: 'Amount · previous', variant: 'comparison' },
        ],
      });
      expect(drawn.treemap[drawn.treemap.length - 1].map((n) => n.name)).toEqual(['Prospect', 'Proposal', 'Won']);
    });
  });

  describe.each(['pie', 'donut', 'funnel'] as const)('%s refuses on the tile and names every group', (family) => {
    const marks = () => (family === 'funnel' ? drawn.funnel : drawn.pie);

    it('draws no mark of the first group alone', () => {
      const { container } = renderChart(family, pivot(FLAT));
      expect(marks()).toHaveLength(0);
      expect(container.querySelector('.recharts-surface')).toBeNull();
    });

    it('the refusal names the family and every group', () => {
      const { container } = renderChart(family, pivot(FLAT));
      const refusal = refusalOf(container)!;
      expect(refusal.getAttribute('data-chart-error')).toBe('one-series-family');
      expect(refusal.getAttribute('role')).toBe('status');
      expect([...refusal.querySelectorAll('code')].map((c) => c.textContent)).toEqual(['Ann', 'Bo', 'Cy']);
      expect(refusal.textContent).toContain(`A ${family} draws one series, and this chart carries 3:`);
    });

    it(`REGRESSION: a one-dimension ${family} draws exactly as before, one mark per row`, () => {
      const { container } = renderChart(family, oneDimension(BY_STAGE));
      expect(refusalOf(container)).toBeNull();
      const last = marks()[marks().length - 1];
      expect(last.dataKey).toBe('amount');
      expect(last.data.map((r) => r.stage)).toHaveLength(3);
    });

    it('REGRESSION: no rows is the empty chart it always was, not a refusal', () => {
      const { container } = renderChart(family, { data: [], xAxisKey: 'stage', series: pivot(FLAT).series });
      expect(refusalOf(container)).toBeNull();
    });
  });
});
