/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * framework#3729 / objectui#2880 — the spec's `ChartConfig` presentation props
 * are honored, not silently dropped.
 *
 * `showLegend`, `title`/`subtitle`, `yAxis[].min/max/format/logarithmic`,
 * `series[].stack`, `series[].yAxis`, `annotations` and `interaction` were all
 * declared by `ChartConfigSchema`, reached this renderer, and did nothing —
 * exactly the silently-inert metadata ADR-0078 forbids. These pin the wiring
 * at the DOM/prop level so a future refactor cannot quietly drop them again.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

// Recharts' ResponsiveContainer measures via ResizeObserver, which reports 0×0
// under the headless DOM, so nothing paints. Fix its size.
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
  { status: 'open', total: 120, rate: 0.4 },
  { status: 'paid', total: 80, rate: 0.9 },
];

const base = {
  chartType: 'bar' as const,
  data: DATA,
  xAxisKey: 'status',
  series: [{ dataKey: 'total' }],
  isAnimationActive: false,
};

describe('AdvancedChartImpl — spec ChartConfig chrome', () => {
  it('renders title and subtitle above the plot', () => {
    render(<AdvancedChartImpl {...base} title="Invoice value" subtitle="by status" />);
    expect(screen.getByText('Invoice value')).toBeTruthy();
    expect(screen.getByText('by status')).toBeTruthy();
  });

  it('adds no wrapper chrome when neither is set', () => {
    const { container } = render(<AdvancedChartImpl {...base} />);
    // ChartFrame is a passthrough with no title/subtitle, so the container's
    // first child is still the chart itself.
    expect(container.querySelector('.text-muted-foreground')).toBeNull();
  });

  it('honors showLegend: false', () => {
    const { container: withLegend } = render(<AdvancedChartImpl {...base} />);
    const legendCount = withLegend.querySelectorAll('.recharts-legend-wrapper').length;
    cleanup();
    const { container: without } = render(<AdvancedChartImpl {...base} showLegend={false} />);
    expect(without.querySelectorAll('.recharts-legend-wrapper').length).toBeLessThan(legendCount);
  });
});

describe('AdvancedChartImpl — spec ChartAxis', () => {
  it('formats y ticks with the declared format instead of the compact default', () => {
    const { container } = render(
      <AdvancedChartImpl {...base} yAxes={[{ field: 'total', format: '$0,0.00' }]} />,
    );
    // Recharts 3 draws tick labels in their own z-index layer rather than
    // inside the axis group, so read every <text> and look for the currency
    // symbol — the compact default would render a bare "120".
    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent ?? '');
    expect(texts.some((t) => t.includes('$'))).toBe(true);
  });

  it('renders an axis title', () => {
    render(<AdvancedChartImpl {...base} yAxes={[{ field: 'total', title: 'Revenue' }]} />);
    expect(screen.getByText('Revenue')).toBeTruthy();
  });

  it('draws a second y-axis when two are declared', () => {
    const { container: single } = render(<AdvancedChartImpl {...base} />);
    const singleCount = single.querySelectorAll('.recharts-yAxis').length;
    cleanup();
    const { container: dual } = render(
      <AdvancedChartImpl
        {...base}
        series={[{ dataKey: 'total' }, { dataKey: 'rate', yAxis: 'right' }]}
        yAxes={[{ field: 'total' }, { field: 'rate', position: 'right' }]}
      />,
    );
    expect(dual.querySelectorAll('.recharts-yAxis').length).toBeGreaterThan(singleCount);
  });
});

describe('AdvancedChartImpl — spec series.stack', () => {
  /** X offsets of every drawn bar (Recharts 3 draws bars as <path>). */
  const barXs = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.recharts-bar-rectangle path')).map((p) => p.getAttribute('x'));

  it('stacks series sharing a stack group', () => {
    // Recharts stacks by `stackId`. Stacked: both series of a category share
    // one column band → 2 distinct x for 2 categories × 2 series. Grouped:
    // the bars sit side by side → 4 distinct x.
    const { container: stacked } = render(
      <AdvancedChartImpl
        {...base}
        series={[
          { dataKey: 'total', stack: 'g' },
          { dataKey: 'rate', stack: 'g' },
        ]}
      />,
    );
    const stackedXs = barXs(stacked);
    expect(stackedXs.length).toBe(4);
    expect(new Set(stackedXs).size).toBe(2);
    cleanup();

    const { container: grouped } = render(
      <AdvancedChartImpl {...base} series={[{ dataKey: 'total' }, { dataKey: 'rate' }]} />,
    );
    expect(new Set(barXs(grouped)).size).toBe(4);
  });
});

describe('AdvancedChartImpl — spec annotations', () => {
  it('draws a reference line for a line annotation', () => {
    const { container } = render(
      <AdvancedChartImpl {...base} annotations={[{ type: 'line', axis: 'y', value: 100, label: 'Target' }]} />,
    );
    expect(container.querySelectorAll('.recharts-reference-line').length).toBeGreaterThan(0);
    expect(screen.getByText('Target')).toBeTruthy();
  });

  it('draws a reference area for a region annotation', () => {
    const { container } = render(
      <AdvancedChartImpl {...base} annotations={[{ type: 'region', axis: 'y', value: 50, endValue: 100 }]} />,
    );
    expect(container.querySelectorAll('.recharts-reference-area').length).toBeGreaterThan(0);
  });

  it('draws nothing extra when no annotation is declared', () => {
    const { container } = render(<AdvancedChartImpl {...base} />);
    expect(container.querySelectorAll('.recharts-reference-line').length).toBe(0);
  });
});

describe('AdvancedChartImpl — spec container props (#3752)', () => {
  it('announces the accessibility description', () => {
    const { container } = render(<AdvancedChartImpl {...base} description="Invoice value by status" />);
    const el = container.querySelector('[data-slot="chart"]');
    expect(el?.getAttribute('role')).toBe('img');
    expect(el?.getAttribute('aria-label')).toBe('Invoice value by status');
  });

  it('leaves the container unlabelled when no description is declared', () => {
    // No description is not the same as an empty one — don't stamp role="img"
    // on an unlabelled graphic, which is worse for a screen reader than a
    // plain div it can skip.
    const { container } = render(<AdvancedChartImpl {...base} />);
    expect(container.querySelector('[data-slot="chart"]')?.getAttribute('role')).toBeNull();
  });

  it('applies an explicit height over the container default', () => {
    const { container } = render(<AdvancedChartImpl {...base} height={420} />);
    expect((container.querySelector('[data-slot="chart"]') as HTMLElement)?.style.height).toBe('420px');
  });

  it('lays y ticks at the declared stepSize', () => {
    const { container } = render(
      <AdvancedChartImpl {...base} yAxes={[{ field: 'total', min: 0, max: 120, stepSize: 40 }]} />,
    );
    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent ?? '');
    for (const tick of ['0', '40', '80', '120']) expect(texts).toContain(tick);
  });
});

describe('AdvancedChartImpl — spec interaction', () => {
  it('adds the brush when interaction.brush is on', () => {
    const { container } = render(<AdvancedChartImpl {...base} interaction={{ brush: true }} />);
    expect(container.querySelectorAll('.recharts-brush').length).toBeGreaterThan(0);
  });

  it('omits the brush by default', () => {
    const { container } = render(<AdvancedChartImpl {...base} />);
    expect(container.querySelectorAll('.recharts-brush').length).toBe(0);
  });
});
