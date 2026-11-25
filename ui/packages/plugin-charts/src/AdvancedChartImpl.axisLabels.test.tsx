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
import { formatMeasure } from '@object-ui/core';

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

/**
 * objectstack#37053 — a value axis prints its dataset measure's UNITS: a
 * whole-scale percent and a currency amount, beside a table that prints them
 * through `formatMeasure`.
 *
 * The chart's value-axis `format` key is a d3-style pattern (`formatterFor`):
 * it reads a `%` pattern as a 0–1 fraction and has no slot for an ISO
 * currency, so a report or dashboard chart over a `percentScale: 'whole'` rate
 * or a `CNY` amount printed bare numbers (`0` … `34`, `0` … `12K`) beside a
 * table printing `33.3%` and `¥12,000.00`. The producer now hands each series
 * the measure's `{ format, currency, percentScale }` (`series[].measureFormat`,
 * renderer-internal like `series[].aggregate`), and an axis whose series all
 * carry the same one prints that measure's units:
 *
 *  - a percent pattern through `formatMeasure` itself, at the column's scale;
 *  - a currency as the compact default carrying the currency's symbol.
 *
 * A per-row currency column (`currencyField`) has no single currency, so its
 * producer hands no `currency` and the axis keeps distinct plain numbers — the
 * control. Every chart here is built the way `ChartRenderer` builds it: the
 * schema through `normalizeChartSchema`, whose series reader is where the
 * carrier is kept or dropped.
 *
 * A new top-level `describe` in this axis-tick harness, beside the
 * objectstack#36988 one above it.
 */
describe('AdvancedChartImpl — a value axis prints its dataset measure’s units (objectstack#37053)', () => {
  /** The display locale the chart resolves with no provider mounted. */
  const LOCALE = 'en';

  const CATEGORIES = new Set(['High', 'Medium', 'Low']);

  /** The value tick labels the left axis draws, in order. */
  const valueTicks = (c: HTMLElement) =>
    [...c.querySelectorAll('text.recharts-cartesian-axis-tick-value')]
      .filter((t) => t.getAttribute('orientation') === 'left')
      .map((t) => (t.textContent ?? '').trim())
      .filter((t) => !CATEGORIES.has(t));

  /** The data labels the bars print (`showDataLabels`). */
  const dataLabels = (c: HTMLElement) =>
    [...c.querySelectorAll('.recharts-label-list text')].map((t) => (t.textContent ?? '').trim());

  /**
   * Draw one column chart over `rows`, its `value` series carrying `measureFormat`
   * exactly as a producer hands it, through the translation `ChartRenderer`
   * applies to every schema.
   */
  function draw(
    rows: Array<{ priority: string; value: number }>,
    measureFormat: Record<string, unknown> | undefined,
    extra: Record<string, unknown> = {},
  ) {
    const spec = normalizeChartSchema({
      type: 'chart',
      chartType: 'column',
      xAxisKey: 'priority',
      series: [{ dataKey: 'value', label: 'Value', ...(measureFormat ? { measureFormat } : {}) }],
      ...extra,
    });
    const { container } = render(
      <AdvancedChartImpl
        chartType="column"
        data={rows}
        xAxisKey="priority"
        series={spec.series}
        yAxes={spec.yAxes}
        showDataLabels={spec.showDataLabels}
        isAnimationActive={false}
      />,
    );
    return container;
  }

  // The SLA report's rate, stored as percentage points: one bucket at 33.3%.
  const WHOLE_RATE = [
    { priority: 'High', value: 100 / 3 },
    { priority: 'Medium', value: 0 },
    { priority: 'Low', value: 0 },
  ];
  // An amount column, in thousands of yuan.
  const AMOUNTS = [
    { priority: 'High', value: 12000 },
    { priority: 'Medium', value: 4500 },
    { priority: 'Low', value: 0 },
  ];

  it('SUBJECT: a whole-scale percent measure’s ticks read percents, in the table’s own format', () => {
    const measure = { format: '0.0%', percentScale: 'whole' };
    const ticks = valueTicks(draw(WHOLE_RATE, measure));
    expect(ticks).toEqual(['0.0%', '9.0%', '18.0%', '27.0%', '36.0%']);
    // The table prints the bucket's value through `formatMeasure` at the same
    // scale and pattern; each tick is that function's reading of its tick.
    expect(formatMeasure(100 / 3, '0.0%', undefined, 'whole', LOCALE)).toBe('33.3%');
    expect(ticks).toEqual([0, 9, 18, 27, 36].map((t) => formatMeasure(t, '0.0%', undefined, 'whole', LOCALE)));
  });

  it('SUBJECT: a fixed-currency measure’s ticks carry its symbol', () => {
    const ticks = valueTicks(draw(AMOUNTS, { format: '0,0.00', currency: 'CNY' }));
    expect(ticks).toEqual(['CN¥0', 'CN¥3K', 'CN¥6K', 'CN¥9K', 'CN¥12K']);
    // The symbol is the one the table prints the amount with.
    expect(formatMeasure(12000, '0,0.00', 'CNY', undefined, LOCALE)).toBe('CN¥12,000.00');
  });

  it('CONTROL: a per-row currency measure (no single currency) keeps distinct plain-number ticks', () => {
    // A `currencyField` column's producer hands its pattern and no currency.
    const ticks = valueTicks(draw(AMOUNTS, { format: '0,0.00' }));
    expect(ticks).toEqual(['0', '3K', '6K', '9K', '12K']);
    expect(new Set(ticks).size).toBe(ticks.length);
    expect(ticks.some((t) => /[¥$€£%]/.test(t))).toBe(false);
  });

  it('a fraction-scale percent measure reads percents through the carrier alone (the dashboard’s case)', () => {
    const rate = WHOLE_RATE.map((r) => ({ ...r, value: r.value / 100 }));
    expect(valueTicks(draw(rate, { format: '0.0%' }))).toEqual(['0.0%', '8.5%', '17.0%', '25.5%', '34.0%']);
  });

  it('a declared axis `format` still wins — the report’s fraction-scale `yAxis[0].format` path (objectstack#36988)', () => {
    const rate = [
      { priority: 'High', value: 1 / 3 },
      { priority: 'Medium', value: 0 },
      { priority: 'Low', value: 0 },
    ];
    const ticks = valueTicks(draw(rate, { format: '0.0%' }, { yAxis: [{ format: '0.0%' }] }));
    expect(ticks).toEqual(['0.0%', '8.5%', '17.0%', '25.5%', '34.0%']);
  });

  it('a pattern too coarse for the step gains the places the step needs, so no two ticks share a label', () => {
    const rate = [
      { priority: 'High', value: 3.4 },
      { priority: 'Medium', value: 0 },
      { priority: 'Low', value: 0 },
    ];
    const ticks = valueTicks(draw(rate, { format: '0%', percentScale: 'whole' }));
    // `formatMeasure` prints a pattern's places as a fixed width, so every tick
    // carries the two the 0.85-point step needs.
    expect(ticks).toEqual(['0.00%', '0.85%', '1.70%', '2.55%', '3.40%']);
    expect(new Set(ticks).size).toBe(ticks.length);
  });

  it('data labels print with the axis’ measure format', () => {
    const labels = dataLabels(draw(WHOLE_RATE, { format: '0.0%', percentScale: 'whole' }, { showDataLabels: true }));
    expect(labels).toContain('33.3%');
  });

  it('two series formatted differently on one axis keep the default axis', () => {
    const spec = normalizeChartSchema({
      type: 'chart',
      chartType: 'column',
      xAxisKey: 'priority',
      series: [
        { dataKey: 'value', measureFormat: { format: '0.0%', percentScale: 'whole' } },
        { dataKey: 'other', measureFormat: { format: '0,0.00', currency: 'CNY' } },
      ],
    });
    const { container } = render(
      <AdvancedChartImpl
        chartType="column"
        data={WHOLE_RATE.map((r) => ({ ...r, other: r.value }))}
        xAxisKey="priority"
        series={spec.series}
        isAnimationActive={false}
      />,
    );
    const ticks = valueTicks(container);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.some((t) => /[¥%]/.test(t))).toBe(false);
  });
});
