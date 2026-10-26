// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #2756 — dashboard charts must render at final geometry on the FIRST committed
 * frame. Recharts' entrance animation is a requestAnimationFrame tween that
 * starts at height 0 and, inside react-grid-layout's mount-time measurement
 * churn, can freeze there — the axes/labels paint but the bars never draw until
 * an unrelated re-render. #2727's settle re-mount tried to heal that live and
 * didn't. The deterministic fix: dashboard chart widgets pass
 * `isAnimationActive: false`, so there is no tween to freeze.
 *
 * This asserts the wiring at the source — the chart schema DatasetWidget hands
 * to the renderer carries the flag — captured via a stubbed SchemaRenderer.
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

describe('DatasetWidget — dashboard chart animation (#2756)', () => {
  it('hands the chart renderer isAnimationActive: false so bars draw on first paint', async () => {
    const src = { queryDataset: vi.fn(async () => ({
      rows: [
        { status: '合作中', count: 5 },
        { status: '已流失', count: 3 },
        { status: '潜在', count: 4 },
      ],
    })) };

    render(
      <DatasetWidget
        widget={{ type: 'bar', dataset: 'crm', dimensions: ['status'], values: ['count'] }}
        dataSource={src}
      />,
    );

    // Once data resolves the chart branch renders through SchemaRenderer.
    await waitFor(() => expect(lastChartSchema).not.toBeNull());
    expect(lastChartSchema.type).toBe('chart');
    expect(lastChartSchema.chartType).toBe('bar');
    // The fix: the entrance-animation tween is turned off.
    expect(lastChartSchema.isAnimationActive).toBe(false);
  });
});
