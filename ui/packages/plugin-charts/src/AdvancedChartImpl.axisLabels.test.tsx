/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Regression: the X-axis tick formatter rendered the raw category value
 * verbatim even when the caller supplied a resolved display label for it via
 * `config[value].label` — the same lookup already used for series names and
 * pie/donut legend entries, just missing for the axis.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: 480, height: 320 }),
  };
});

import AdvancedChartImpl from './AdvancedChartImpl';
import { normalizeChartSchema } from './normalizeChartSchema';

afterEach(cleanup);

const DATA = [
  { status: 'active', count: 5 },
  { status: 'archived', count: 2 },
];

describe('AdvancedChartImpl — axis tick label resolution', () => {
  it('renders the resolved config label instead of the raw enum value', () => {
    const { container } = render(
      <AdvancedChartImpl
        chartType="bar"
        data={DATA}
        xAxisKey="status"
        series={[{ dataKey: 'count', label: 'Count' }]}
        config={{
          count: { label: 'Count' },
          active: { label: '合作中' },
          archived: { label: 'Archived' },
        }}
      />,
    );
    expect(container.textContent).toContain('合作中');
    expect(container.textContent).toContain('Archived');
    expect(container.textContent).not.toContain('active');
    expect(container.textContent).not.toContain('archived');
  });

  it('falls back to the raw value when no config label is set (no regression)', () => {
    const { container } = render(
      <AdvancedChartImpl
        chartType="bar"
        data={DATA}
        xAxisKey="status"
        series={[{ dataKey: 'count', label: 'Count' }]}
      />,
    );
    expect(container.textContent).toMatch(/active/);
  });
});

/**
 * objectstack#36988 — the VALUE axis: two ticks never share a label.
 *
 * The card's data: one bucket at 1/3, the rest 0. recharts lays five ticks over
 * that domain at a 0.085 step (0, 0.085, 0.17, 0.255, 0.34), and the compact
 * fallback, capped at one fraction digit, printed them `0, 0.1, 0.2, 0.3, 0.3`
 * — two ticks with one label, which no reader can tell apart. The fallback now
 * prints as many digits as the axis' tick step needs, so distinct tick values
 * read as distinct labels; with a declared percent `format` (what the report
 * hands a `'0.0%'` measure's chart) the same ticks read as percents.
 */
describe('AdvancedChartImpl — value-axis ticks on a small domain (objectstack#36988)', () => {
  const RATE = [
    { priority: 'High', rate: 1 / 3 },
    { priority: 'Medium', rate: 0 },
    { priority: 'Low', rate: 0 },
  ];
  const PRIORITIES = new Set(RATE.map((r) => r.priority));

  /** The value tick labels the left axis draws, in order. */
  const valueTicks = (c: HTMLElement) =>
    [...c.querySelectorAll('text.recharts-cartesian-axis-tick-value')]
      .filter((t) => t.getAttribute('orientation') === 'left')
      .map((t) => (t.textContent ?? '').trim())
      .filter((t) => !PRIORITIES.has(t));

  function draw(extra: Record<string, unknown> = {}, data: Record<string, unknown>[] = RATE) {
    const { container } = render(
      <AdvancedChartImpl
        chartType="column"
        data={data}
        xAxisKey="priority"
        series={[{ dataKey: 'rate', label: 'Rate' }]}
        isAnimationActive={false}
        {...extra}
      />,
    );
    return valueTicks(container);
  }

  it('with no axis format, every tick reads a label of its own', () => {
    const ticks = draw();
    // At least three drawn, so an empty or collapsed axis cannot pass.
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(new Set(ticks).size).toBe(ticks.length);
    expect(ticks).toEqual(['0', '0.085', '0.17', '0.255', '0.34']);
  });

  it('with a declared percent format, the ticks read as percents', () => {
    // The value-axis key exactly as a report hands it for a `'0.0%'` measure
    // (`DatasetReportRenderer.chartChrome.test.tsx`), through the translation
    // `ChartRenderer` applies.
    const { yAxes } = normalizeChartSchema({ type: 'chart', yAxis: [{ format: '0.0%' }] }, 'en');
    const ticks = draw({ yAxes });
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(new Set(ticks).size).toBe(ticks.length);
    expect(ticks.every((t) => t.endsWith('%'))).toBe(true);
    expect(ticks).toEqual(['0.0%', '8.5%', '17.0%', '25.5%', '34.0%']);
  });

  it('a declared format too coarse for the step still keeps the ticks apart', () => {
    // A tenth of the card's rate: ticks 0, 0.0085, 0.017, 0.0255, 0.034. A
    // whole-percent `'0%'` printed the last two as `3%`; the 0.85-point step
    // needs two more places, which the pattern's own (none) do not cut.
    const ticks = draw({ yAxes: [{ format: '0%' }] }, RATE.map((r) => ({ ...r, rate: r.rate / 10 })));
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(new Set(ticks).size).toBe(ticks.length);
    expect(ticks).toEqual(['0%', '0.85%', '1.7%', '2.55%', '3.4%']);
  });
});
