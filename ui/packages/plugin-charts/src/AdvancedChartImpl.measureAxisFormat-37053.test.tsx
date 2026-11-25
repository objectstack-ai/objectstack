/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
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

describe('a value axis prints its dataset measure’s units (objectstack#37053)', () => {
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
    expect(valueTicks(draw(rate, { format: '0.0%' }))).toEqual(['0.0%', '9.0%', '18.0%', '27.0%', '36.0%']);
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
    expect(ticks).toEqual(['0%', '0.85%', '1.7%', '2.55%', '3.4%']);
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
