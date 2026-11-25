// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37053 — a report chart hands its chart the measure's format
 * facts, so the value axis prints the measure's units beside the table.
 *
 * objectstack#36988 passed a fraction-scale percent pattern on the chart's
 * value-axis `format` key, and left three measures on the chart's default axis
 * because that key (a d3-style pattern) cannot say what the table prints for
 * them: a percent already in percentage points (`percentScale: 'whole'`), a
 * declared currency, and a per-row currency (`currencyField`). Each series now
 * carries the measure's `{ format, currency, percentScale }` as the chart
 * renderer's internal `series[].measureFormat` (beside `aggregate`), which
 * `AdvancedChartImpl.measureAxisFormat-37053.test.tsx` (plugin-charts) draws
 * as `…%` and `CN¥…` ticks. The currency is the one the table prints a cell
 * with no row of its own in (`measureCellCurrency`), so a per-row currency
 * column hands none and its axis keeps plain numbers.
 *
 * This pin stops at the schema the registered chart component receives, as
 * the objectstack#36988 pin in `DatasetReportRenderer.chartChrome.test.tsx`
 * does: `plugin-report` does not depend on `plugin-charts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { DatasetReportRenderer } from '../DatasetReportRenderer';

let captured: { schema: Record<string, any> } | null = null;

beforeEach(() => {
  captured = null;
  ComponentRegistry.register('chart', (props: any) => {
    captured = props;
    return null;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const sourceOf = (result: unknown) => ({ queryDataset: vi.fn(async () => result) });

const ROWS = [
  { priority: 'urgent', measure: 100 / 3, currency_code: 'CNY' },
  { priority: 'high', measure: 0, currency_code: 'USD' },
  { priority: 'low', measure: 0, currency_code: 'CNY' },
];

const REPORT = {
  name: 'by_priority',
  type: 'tabular',
  dataset: 'metrics',
  rows: ['priority'],
  values: ['measure'],
  chart: { type: 'column', xAxis: 'priority', yAxis: 'measure' },
};

async function chartSchema(measure: Record<string, unknown>, report: Record<string, unknown> = REPORT) {
  const result = {
    rows: ROWS,
    fields: [
      { name: 'priority', type: 'text', label: 'Priority' },
      { name: 'measure', type: 'number', label: 'Measure', ...measure },
    ],
  };
  render(<DatasetReportRenderer report={report as never} dataSource={sourceOf(result) as never} />);
  await waitFor(() => expect(captured?.schema?.data?.length).toBe(ROWS.length));
  return captured!.schema;
}

describe('report chart series carry the measure’s format facts (objectstack#37053)', () => {
  it('SUBJECT: a whole-scale percent measure hands its pattern and scale, beside the table’s 33.3%', async () => {
    const schema = await chartSchema({ format: '0.0%', percentScale: 'whole' });
    expect(schema.series.map((s: { measureFormat?: unknown }) => s.measureFormat)).toEqual([
      { format: '0.0%', percentScale: 'whole' },
    ]);
    // Still no value-axis `format`: that key would read the points as a fraction.
    expect(schema).not.toHaveProperty('yAxis');
    expect(await screen.findByText('33.3%')).toBeInTheDocument();
  });

  it('SUBJECT: a fixed-currency measure hands its currency', async () => {
    const schema = await chartSchema({ format: '0,0.00', currency: 'CNY' });
    expect(schema.series.map((s: { measureFormat?: unknown }) => s.measureFormat)).toEqual([
      { format: '0,0.00', currency: 'CNY' },
    ]);
  });

  it('CONTROL: a per-row currency measure hands no currency — the axis has no single one', async () => {
    const schema = await chartSchema({ format: '0,0.00', currency: 'CNY', currencyField: 'currency_code' });
    expect(schema.series.map((s: { measureFormat?: unknown }) => s.measureFormat)).toEqual([{ format: '0,0.00' }]);
  });

  it('every series of a `seriesBy` split carries the one measure’s facts', async () => {
    const schema = await chartSchema(
      { format: '0.0%', percentScale: 'whole' },
      { ...REPORT, rows: ['priority', 'currency_code'], chart: { ...REPORT.chart, seriesBy: 'currency_code' } },
    );
    expect(schema.series.length).toBeGreaterThanOrEqual(2);
    for (const s of schema.series) expect(s.measureFormat).toEqual({ format: '0.0%', percentScale: 'whole' });
  });

  it('a fraction-scale percent keeps its value-axis `format` (objectstack#36988) beside the carrier', async () => {
    const schema = await chartSchema({ format: '0.0%' });
    expect(schema.yAxis).toEqual([{ format: '0.0%' }]);
    expect(schema.series[0].measureFormat).toEqual({ format: '0.0%' });
  });

  it('a measure stating no format facts hands no carrier', async () => {
    const schema = await chartSchema({});
    expect(schema.series[0]).not.toHaveProperty('measureFormat');
  });
});
