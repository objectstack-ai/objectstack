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
