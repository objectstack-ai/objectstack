// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3135 — a dataset widget's `chartConfig.showLegend` must reach the chart
 * renderer. It never did: this component read `options` and nothing else, so
 * the flag was inert metadata — `false` still drew a legend, and `true` only
 * "worked" because the renderer defaults to showing one.
 *
 * Asserted at the source (the schema handed to the renderer), via a stubbed
 * SchemaRenderer — the same seam DatasetWidget.animation uses.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

let lastChartSchema: any = null;

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SchemaRenderer: (props: any) => {
    lastChartSchema = props.schema;
    return null;
  },
}));

import { DatasetWidget } from '../DatasetWidget';

afterEach(() => {
  cleanup();
  lastChartSchema = null;
});

const rows = [
  { type: '设备', total_count: 5 },
  { type: '质量', total_count: 3 },
];

const renderWidget = (chartConfig?: Record<string, unknown>) => {
  const src = { queryDataset: vi.fn(async () => ({ rows })) };
  render(
    <DatasetWidget
      widget={{
        type: 'pie',
        dataset: 'andon_metrics',
        dimensions: ['type'],
        values: ['total_count'],
        ...(chartConfig ? { chartConfig } : {}),
      }}
      dataSource={src}
    />,
  );
};

describe('DatasetWidget — chartConfig.showLegend (#3135)', () => {
  it('forwards showLegend: true', async () => {
    renderWidget({ type: 'pie', showLegend: true, showDataLabels: false });
    await waitFor(() => expect(lastChartSchema).not.toBeNull());
    expect(lastChartSchema.chartType).toBe('pie');
    expect(lastChartSchema.showLegend).toBe(true);
  });

  it('forwards showLegend: false', async () => {
    renderWidget({ type: 'pie', showLegend: false });
    await waitFor(() => expect(lastChartSchema).not.toBeNull());
    expect(lastChartSchema.showLegend).toBe(false);
  });

  // No declaration → the key stays off the schema so the renderer's own default
  // (legend shown) still decides. Every existing widget keeps its behaviour.
  it('omits the key when the widget declares no chartConfig', async () => {
    renderWidget();
    await waitFor(() => expect(lastChartSchema).not.toBeNull());
    expect('showLegend' in lastChartSchema).toBe(false);
  });
});
