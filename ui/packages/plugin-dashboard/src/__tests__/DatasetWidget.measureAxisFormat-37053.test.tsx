// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37053 — a dashboard chart widget over a percent measure prints
 * its value axis in percent, as its table prints the measure.
 *
 * The widget hands the chart one series per measure and, since
 * `@objectstack/spec` 17.5.0, no authored axis at all (`chartConfig.yAxis` is
 * refused on a widget), so nothing told the value axis what the measure's
 * numbers mean: a `percentScale: 'whole'` rate of 33.3 drew bare `0` … `36`
 * ticks. Each series now carries its measure's `{ format, currency,
 * percentScale }` (`series[].measureFormat`, renderer-internal beside
 * `aggregate`), and the axis prints that measure's units through the table's
 * own `formatMeasure`.
 *
 * No renderer stub: the chain is `DatasetWidget` → `SchemaRenderer` → the
 * registry's `chart` → `AdvancedChartImpl`, with the scoped
 * `getBoundingClientRect` stub `DatasetWidget.singleSeriesMeasures-11417.test.tsx`
 * uses to give the plot its box.
 */

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { formatMeasure } from '@object-ui/core';
// Registers `chart` in the ComponentRegistry the widget's `SchemaRenderer`
// resolves `{ type: 'chart' }` through.
import '@object-ui/plugin-charts';
import { DatasetWidget } from '../DatasetWidget';

const PLOT_BOX = { width: 480, height: 320 } as const;
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.classList?.contains('recharts-responsive-container')) {
      return {
        ...PLOT_BOX,
        top: 0,
        left: 0,
        right: PLOT_BOX.width,
        bottom: PLOT_BOX.height,
        x: 0,
        y: 0,
        toJSON() {},
      } as DOMRect;
    }
    return originalGetBoundingClientRect.call(this);
  };
});

afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

afterEach(cleanup);

const ROWS = [
  { priority: 'High', rate: 100 / 3, revenue: 12000 },
  { priority: 'Medium', rate: 0, revenue: 4500 },
  { priority: 'Low', rate: 0, revenue: 0 },
];
const CATEGORIES = new Set(ROWS.map((r) => r.priority));

/** The value tick labels the chart's left axis draws, in order. */
const valueTicks = (c: HTMLElement) =>
  [...c.querySelectorAll('text.recharts-cartesian-axis-tick-value')]
    .filter((t) => t.getAttribute('orientation') === 'left')
    .map((t) => (t.textContent ?? '').trim())
    .filter((t) => !CATEGORIES.has(t));

async function drawWidget(measure: string, facts: Record<string, unknown>) {
  const src = {
    queryDataset: vi.fn(async () => ({
      rows: ROWS,
      fields: [
        { name: 'priority', type: 'text', label: 'Priority' },
        { name: measure, type: 'number', label: 'Measure', ...facts },
      ],
    })),
  };
  const widget = { id: 'by_priority', type: 'bar', dataset: 'metrics', dimensions: ['priority'], values: [measure] };
  const view = render(<DatasetWidget widget={widget} dataSource={src} />);
  await waitFor(() => expect(valueTicks(view.container).length).toBeGreaterThanOrEqual(3), { timeout: 15000 });
  return valueTicks(view.container);
}

describe('a dashboard chart widget’s value axis prints its measure’s units (objectstack#37053)', () => {
  it('SUBJECT: a whole-scale percent measure’s ticks read percents, in the table’s own format', async () => {
    const ticks = await drawWidget('rate', { format: '0.0%', percentScale: 'whole' });
    expect(ticks).toEqual(['0.0%', '9.0%', '18.0%', '27.0%', '36.0%']);
    expect(ticks).toEqual([0, 9, 18, 27, 36].map((t) => formatMeasure(t, '0.0%', undefined, 'whole', 'en')));
  });

  it('a fixed-currency measure’s ticks carry its symbol', async () => {
    const ticks = await drawWidget('revenue', { format: '0,0.00', currency: 'CNY' });
    expect(ticks).toEqual(['CN¥0', 'CN¥3K', 'CN¥6K', 'CN¥9K', 'CN¥12K']);
  });

  it('CONTROL: a per-row currency measure keeps distinct plain-number ticks', async () => {
    const ticks = await drawWidget('revenue', { format: '0,0.00', currency: 'CNY', currencyField: 'currency_code' });
    expect(ticks).toEqual(['0', '3K', '6K', '9K', '12K']);
  });
});
